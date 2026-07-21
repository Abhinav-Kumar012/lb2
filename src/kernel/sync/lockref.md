# lockref: Lock + Reference Count Optimization

## Overview

lockref is a kernel data structure that combines a **spinlock** and a **reference count** into a single 8-byte aligned entity, enabling an optimized **cmpxchg fast path** that avoids taking the lock for common operations (increment, decrement, and read). It is used extensively in the VFS layer for dentry and inode reference counting, where these operations are extremely frequent.

The key insight is that on 64-bit architectures, a spinlock (4 bytes) and a reference count (4 bytes) fit in a single 8-byte word, allowing atomic compare-and-exchange (cmpxchg) operations to update both simultaneously without acquiring the lock.

## Motivation

In the VFS path lookup code, `dget()` (increment dentry refcount) and `dput()` (decrement dentry refcount) are called millions of times per second on busy systems. Taking a spinlock for every refcount operation is expensive due to:

- **Cache-line bouncing**: the lock word causes cache-line invalidations across CPUs
- **Lock contention**: multiple CPUs competing for the same lock
- **Pipeline stalls**: lock acquire/release involves memory barriers

lockref solves this by using cmpxchg to perform the operation atomically on the combined lock+refcount word, avoiding the lock entirely for the uncontended case.

## Data Structure

```c
struct lockref {
    union {
#if USE_LOCKREF
        aligned_u64 lockref;  /* 8-byte combined value */
#endif
        struct {
            spinlock_t lock;   /* 4 bytes */
            int count;         /* 4 bytes */
        };
    };
};
```

### Memory Layout (64-bit)

```
Bytes 0-3: Spinlock (ticket lock or qspinlock)
Bytes 4-7: Reference count (int32)

As a single 64-bit value (little-endian):
[refcount:32 | spinlock:32]
```

The alignment is critical: `lockref` must be 8-byte aligned so the combined 64-bit value doesn't straddle a cache line or word boundary.

### The lockref_fast Path

The 64-bit combined value enables the fast path:

```c
/* Pseudocode for lockref_inc() fast path */
bool lockref_inc(struct lockref *lockref)
{
    /* Atomically read the combined 8-byte value */
    u64 old = READ_ONCE(lockref->lockref);

    /* Check: lock must be unlocked AND count must be valid */
    if (LOCKREF_COUNT(old) < LOCKREF_MAX &&
        LOCKREF_IS_UNLOCKED(old)) {
        /* Try cmpxchg: increment count, keep lock unlocked */
        u64 new_val = old + (1ULL << LOCKREF_COUNT_SHIFT);
        if (cmpxchg64(&lockref->lockref, old, new_val) == old)
            return true;  /* Success! Lock not taken */
    }
    return false;  /* Fall back to slow path */
}
```

The fast path works when:
1. The spinlock is currently **unlocked**
2. The reference count is within valid bounds (not negative, not at max)
3. No other CPU modified the value between the read and cmpxchg

If any condition fails, the code falls back to the **slow path** which acquires the spinlock normally.

## API

```c
#include <linux/lockref.h>

/* Initialize a lockref */
void lockref_init(struct lockref *lockref);

/* Initialize with a specific count */
void lockref_init_count(struct lockref *lockref, int count);

/* Increment reference count (returns true if fast path succeeded) */
bool lockref_inc(struct lockref *lockref);

/* Decrement reference count; returns true if count > 0 after decrement.
 * Returns false if count reached 0 or fast path failed. */
bool lockref_dec_not_zero(struct lockref *lockref);

/* Decrement reference count (may go negative). Returns the old count. */
bool lockref_dec_return(struct lockref *lockref);

/* Decrement and return true if count became 0 (caller should free) */
bool lockref_put_not_zero(struct lockref *lockref);

/* Decrement; return true if count became exactly 0 */
bool lockref_put_or_lock(struct lockref *lockref);

/* Mark the dentry/lockref as dead (sets count to -128) */
void lockref_mark_dead(struct lockref *lockref);

/* Check if count is positive */
bool lockref_get_not_dead(struct lockref *lockref);
```

### Macro Helpers for Fast Path

```c
#define LOCKREF_COUNT_SHIFT   32
#define LOCKREF_COUNT_MASK    0xFFFFFFFF00000000ULL
#define LOCKREF_LOCK_MASK     0x00000000FFFFFFFFULL
#define LOCKREF_COUNT(val)    ((int)((val) >> 32))
#define LOCKREF_LOCK(val)     ((val) & LOCKREF_LOCK_MASK)
#define LOCKREF_IS_UNLOCKED(val) (LOCKREF_LOCK(val) == 0)
```

## Use in VFS: dentry

The primary user of lockref is `struct dentry`:

```c
struct dentry {
    /* ... */
    struct lockref d_lockref;  /* lock + reference count */
    /* ... */
};
```

### dget() and dput()

```c
/* Increment dentry reference count */
struct dentry *dget(struct dentry *dentry)
{
    if (dentry)
        lockref_inc(&dentry->d_lockref);
    return dentry;
}

/* Decrement dentry reference count */
void dput(struct dentry *dentry)
{
    if (dentry) {
        if (lockref_put_or_lock(&dentry->d_lockref)) {
            /* Fast path: refcount > 0, nothing to do */
            return;
        }
        /* Slow path: refcount hit 0, need to handle dentry destruction */
        __dput(dentry);
    }
}
```

In path lookup (`walk_component`, `lookup_fast`, etc.), dentries are pinned and unpinned constantly. The lockref fast path eliminates lock contention for these hot operations.

### Performance Impact

Benchmarks show:

- **lockref fast path**: ~10–20 ns per operation (cmpxchg only)
- **Slow path (spinlock)**: ~50–100 ns per operation
- **Contention scaling**: lockref scales linearly with CPU count; spinlock does not

On workloads like `find /` or `git status` on large trees, lockref provides measurable improvement (10–30% faster path lookup on multi-core systems).

## Implementation Details

### Atomic 64-bit Operations

The fast path relies on `cmpxchg64()`, which is:

- **x86_64**: Single `lock cmpxchg8b` or `lock cmpxchg` instruction
- **ARM64**: `ldxr`/`stxr` loop (or `cas` with LSE atomics)
- **32-bit architectures**: **Not supported** — falls back to always taking the lock

On 32-bit architectures, `USE_LOCKREF` is set to 0, and all lockref operations degenerate to spinlock + counter:

```c
#ifndef USE_LOCKREF
#define USE_LOCKREF 1
#endif

/* 32-bit: no cmpxchg64, disable fast path */
#if !defined(CONFIG_64BIT) || !defined(CONFIG_SMP)
#undef USE_LOCKREF
#define USE_LOCKREF 0
#endif
```

### Memory Ordering

The fast path uses:

- `READ_ONCE()` for the initial atomic read of the 64-bit value
- `cmpxchg64()` which provides full memory barriers (acquire + release)
- No additional barriers needed because cmpxchg is already sequentially consistent

### Handling Stale Reads

The cmpxchg can fail if another CPU modified the value between the `READ_ONCE` and `cmpxchg`. In that case, the fast path simply returns false and the slow path (with the actual spinlock) handles it. This is the standard lock-free retry pattern.

### Dead Marking

When a dentry is being freed, `lockref_mark_dead()` sets the count to a large negative value (`-128`). The fast path checks for this:

```c
bool lockref_get_not_dead(struct lockref *lockref)
{
    u64 old = READ_ONCE(lockref->lockref);
    for (;;) {
        s32 count = LOCKREF_COUNT(old);
        if (count < 0)
            return false;  /* Dead */
        if (LOCKREF_IS_UNLOCKED(old)) {
            u64 new_val = old + (1ULL << LOCKREF_COUNT_SHIFT);
            if (cmpxchg64_relaxed(&lockref->lockref, old, new_val) == old)
                return true;
            old = READ_ONCE(lockref->lockref);
        } else {
            /* Slow path: lock is held */
            spin_lock(&lockref->lock);
            if (lockref->count >= 0) {
                lockref->count++;
                spin_unlock(&lockref->lock);
                return true;
            }
            spin_unlock(&lockref->lock);
            return false;
        }
    }
}
```

### Bounds Checking

The fast path validates that the count is within safe bounds before attempting cmpxchg:

- Count must be ≥ 0 (not dead)
- Count must be ≤ `LOCKREF_MAX` (not overflowed)
- Lock must be unlocked

If any condition fails, the slow path with proper locking handles the edge case.

## Related Optimizations

lockref is part of a broader pattern in the kernel of avoiding locks for hot-path operations:

| Technique | Used For | Mechanism |
|-----------|----------|-----------|
| lockref | dentry refcount | cmpxchg on lock+count |
| atomic_t | simple counters | Single-word atomic ops |
| percpu_counter | distributed counters | Per-CPU fast path |
| RCU | read-mostly data | Lock-free reads |
| seqlock | read-mostly with rare writes | Sequence counter |

## Debugging

### Lock Statistics

lockref operations that fall back to the slow path are tracked via lockstat:

```bash
# Enable lock statistics
echo 1 > /proc/lock_stat

# View statistics
cat /proc/lock_stat | grep d_lockref
```

High fallback rates indicate contention on specific dentries.

### Lockdep

lockref's spinlock is registered with lockdep. If you see lockdep warnings involving `d_lockref`, it usually indicates a lock ordering violation in the VFS.

### Count Anomalies

If a dentry's reference count goes negative unexpectedly, it indicates a use-after-free or double-put bug. The kernel has debug checks:

```bash
# Enable lockref debugging
CONFIG_DEBUG_LOCKREF=y
```

With this enabled, the kernel warns if a lockref count goes negative or if an operation on a dead lockref is attempted.

## Performance Considerations

### Cache-Line Alignment

The lockref structure should be cache-line aligned for best performance. If two lockrefs share the same cache line, false sharing can degrade performance:

```c
/* Best practice: align to cache line */
struct dentry {
    /* ... */
    struct lockref d_lockref ____cacheline_aligned_in_smp;
    /* ... */
};
```

### Read-Mostly Workloads

For read-mostly workloads (e.g., many concurrent `stat()` calls on the same file), the lockref fast path handles all operations without any lock acquisition. This scales perfectly.

### Write-Heavy Workloads

If many CPUs are constantly incrementing and decrementing the same lockref, cmpxchg failures increase and more operations fall back to the slow path. This is still better than always taking the lock, but the benefit diminishes.

## Source Files

- `lib/lockref.c` — lockref implementation (fast path and slow path)
- `include/linux/lockref.h` — data structure and inline helpers
- `fs/dcache.c` — primary user (dentry refcounting)
- `fs/namei.c` — path lookup using dget/dput

## Further Reading

- **Documentation/locking/lockref.rst** — kernel documentation
- **LWN: Scaling dcache with lockref** — <https://lwn.net/Articles/565734/>
- **Commit introducing lockref** — search for "lockref" in `git log`
- **Linus Torvalds' explanation** — LKML discussion on the design rationale

## See Also

- [Dentry Cache](../filesystems/dcache.md) — VFS dentry cache
- [RCU](../sync/rcu.md) — Read-Copy-Update synchronization
- [Spinlocks](../sync/spinlock.md) — spinlock implementation
- [Atomic Operations](../sync/atomic.md) — kernel atomic operations
- [cmpxchg](../arch/cmpxchg.md) — compare-and-exchange primitives
