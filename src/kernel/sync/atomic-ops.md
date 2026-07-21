# Atomic Operations

## Introduction

Atomic operations are the most fundamental building blocks for lock-free synchronization in the Linux kernel. They guarantee that an operation on a single variable completes indivisibly — no other CPU can observe the variable in an intermediate state. When combined with memory barriers, atomic operations enable the construction of complex lock-free data structures and algorithms.

The Linux kernel provides atomic operations for integers (`atomic_t`, `atomic64_t`), bit operations (`set_bit`, `clear_bit`, `test_and_set_bit`), and the powerful compare-and-swap primitive (`cmpxchg`). Understanding these primitives and their memory ordering guarantees is essential for writing correct concurrent kernel code.

## atomic_t: Atomic Integers

`atomic_t` is a 32-bit atomic integer type. It wraps an `int` in a structure to prevent direct (non-atomic) access:

```c
typedef struct {
    int counter;
} atomic_t;
```

### Initialization

```c
/* Static */
ATOMIC_INIT(0);

/* Dynamic */
atomic_t v;
atomic_set(&v, 0);

/* Read (not atomic on all architectures) */
int val = atomic_read(&v);
```

### Arithmetic Operations

```c
atomic_t v = ATOMIC_INIT(0);

atomic_add(5, &v);           /* v += 5 */
atomic_sub(3, &v);           /* v -= 3 */
atomic_inc(&v);              /* v++ */
atomic_dec(&v);              /* v-- */

/* Return the new value */
int new = atomic_add_return(5, &v);  /* v += 5; return v; */
int new = atomic_sub_return(3, &v);  /* v -= 3; return v; */
int new = atomic_inc_return(&v);     /* v++; return v; */
int new = atomic_dec_return(&v);     /* v--; return v; */

/* Return the old value */
int old = atomic_add_return_relaxed(5, &v);  /* Relaxed ordering */

/* Conditional decrement — decrement only if non-zero */
int was_zero = atomic_dec_and_test(&v);  /* v--; return v==0; */
int was_positive = atomic_sub_and_test(5, &v);  /* v -= 5; return v==0; */

/* Add and test */
int is_zero = atomic_add_negative(-1, &v);  /* v -= 1; return v < 0; */
```

### Compare-and-Swap

```c
/* If *v == old, set *v = new. Returns the old value. */
int old = atomic_cmpxchg(&v, old, new);

/* If *v == old, set *v = new (relaxed ordering) */
int old = atomic_cmpxchg_relaxed(&v, old, new);

/* Atomic exchange — set *v = new, return old */
int old = atomic_xchg(&v, new);
```

### Atomic Bit Operations on Integers

```c
atomic_t flags = ATOMIC_INIT(0);

atomic_or(FLAG_A, &flags);       /* flags |= FLAG_A */
atomic_and(~FLAG_A, &flags);     /* flags &= ~FLAG_A */
atomic_xor(FLAG_A, &flags);      /* flags ^= FLAG_A */

/* Atomic fetch-and-modify */
int old = atomic_fetch_or(FLAG_A, &flags);
int old = atomic_fetch_and(~FLAG_A, &flags);
int old = atomic_fetch_xor(FLAG_A, &flags);
```

## atomic64_t: 64-bit Atomic Integers

For 64-bit atomic operations, use `atomic64_t`:

```c
atomic64_t v;
atomic64_set(&v, 0);
atomic64_add(1, &v);
atomic64_inc(&v);
s64 val = atomic64_read(&v);
s64 old = atomic64_cmpxchg(&v, expected, desired);
s64 old = atomic64_xchg(&v, new);
```

On 64-bit architectures, `atomic64_t` operations are native. On 32-bit architectures, they may use spinlock-based emulation (slower).

## Bit Operations

### Atomic Bit Manipulation

```c
unsigned long flags = 0;

/* Set bit nr */
set_bit(nr, &flags);

/* Clear bit nr */
clear_bit(nr, &flags);

/* Change (toggle) bit nr */
change_bit(nr, &flags);

/* Test bit nr */
int bit = test_bit(nr, &flags);

/* Test and set — returns previous value */
int was_set = test_and_set_bit(nr, &flags);

/* Test and clear */
int was_set = test_and_clear_bit(nr, &flags);

/* Test and change (toggle) */
int was_set = test_and_change_bit(nr, &flags);
```

**Important**: `set_bit()`, `clear_bit()`, etc. are truly atomic — they use locked instructions on x86 (e.g., `LOCK BTS`, `LOCK BTR`). Plain bit assignments (`flags |= (1 << nr)`) are NOT atomic.

### Non-atomic Bit Operations

For per-CPU data or data protected by locks:

```c
__set_bit(nr, &flags);
__clear_bit(nr, &flags);
__change_bit(nr, &flags);
__test_and_set_bit(nr, &flags);
__test_and_clear_bit(nr, &flags);
```

These are faster but not safe for concurrent access from multiple CPUs.

## compare-and-swap (cmpxchg)

The `cmpxchg` family is the most powerful atomic primitive — it enables lock-free algorithms by allowing conditional atomic updates:

```c
/* 32-bit cmpxchg */
typeof(*ptr) old = cmpxchg(ptr, old_val, new_val);
/* Returns: old value
 * If old == old_val, then *ptr = new_val (success)
 * If old != old_val, *ptr is unchanged (failure) */

/* 64-bit cmpxchg */
typeof(*ptr) old = cmpxchg64(ptr, old_val, new_val);

/* 128-bit cmpxchg (where supported) */
typeof(*ptr) old = cmpxchg128(ptr, old_val, new_val);
```

### CAS Loop Pattern

The standard pattern for using cmpxchg is a retry loop:

```c
/* Atomically increment a shared counter using CAS */
void atomic_cas_increment(atomic_long_t *counter)
{
    long old, new;
    
    do {
        old = atomic_long_read(counter);
        new = old + 1;
    } while (atomic_long_cmpxchg(counter, old, new) != old);
    /* Loop if cmpxchg failed (another CPU changed the value) */
}
```

### Lock-Free Linked List Insertion

```c
/* Lock-free insertion at head using cmpxchg */
void lockfree_push(struct lockfree_stack *stack, struct node *node)
{
    struct node *old_head;
    
    do {
        old_head = READ_ONCE(stack->head);
        node->next = old_head;
    } while (cmpxchg(&stack->head, old_head, node) != old_head);
}
```

## Memory Barriers

Atomic operations have different memory ordering guarantees. The Linux kernel provides several ordering levels:

### Ordering Levels

| Level | Suffix | Guarantee |
|-------|--------|-----------|
| Sequential Consistency | (none) | Full ordering: all prior ops visible before this op, all subsequent ops visible after |
| Acquire | `_acquire` | Subsequent loads/stores see effects of this operation |
| Release | `_release` | Prior loads/stores are visible when this operation is observed |
| Relaxed | `_relaxed` | Only atomicity guaranteed, no ordering |

```c
/* Sequential consistency (strongest, default) */
atomic_set(&v, 1);
int val = atomic_read(&v);
atomic_cmpxchg(&v, old, new);

/* Acquire ordering */
int val = atomic_read_acquire(&v);
int old = atomic_cmpxchg_acquire(&v, old, new);

/* Release ordering */
atomic_set_release(&v, 1);
int old = atomic_cmpxchg_release(&v, old, new);

/* Relaxed ordering (weakest) */
int val = atomic_read_relaxed(&v);
int old = atomic_cmpxchg_relaxed(&v, old, new);
```

### Explicit Memory Barriers

```c
/* Full barrier — all prior loads and stores complete before any subsequent */
smp_mb();

/* Write barrier — all prior stores complete before any subsequent stores */
smp_wmb();

/* Read barrier — all prior loads complete before any subsequent loads */
smp_rmb();

/* Data dependency barrier — ensures dependent loads are ordered */
smp_read_barrier_depends();

/* Compiler barrier — prevents compiler reordering only */
barrier();

/* Before/after I/O */
mb();
wmb();
rmb();
```

### x86 vs ARM Memory Ordering

x86 is **strongly ordered** — loads are not reordered with loads, stores are not reordered with stores, and loads are not reordered with older stores. On x86:
- `smp_mb()` = `lock; addl $0,0(%rsp)` (full barrier)
- `smp_wmb()` = `barrier()` (compiler only)
- `smp_rmb()` = `barrier()` (compiler only)

ARM is **weakly ordered** — all reorderings are possible. On ARM:
- `smp_mb()` = `dmb ish` (data memory barrier)
- `smp_wmb()` = `dmb ishst` (store barrier)
- `smp_rmb()` = `dmb ishld` (load barrier)

### Control and Data Dependencies

```c
/* Control dependency: if (cond) then store */
if (condition)
    WRITE_ONCE(data, value);  /* CPU guarantees: the store happens after the branch */

/* Data dependency: store depends on prior load */
p = READ_ONCE(pointer);
p->field = value;  /* CPU guarantees: the store to p->field happens after reading p */

/* WRITE_ONCE and READ_ONCE prevent compiler optimizations */
```

## The STORE_ONCE and LOAD_ONCE Pattern

The kernel provides `WRITE_ONCE()` and `READ_ONCE()` to prevent the compiler from doing surprising things:

```c
/* Prevent compiler from optimizing away, merging, or tearing the access */
WRITE_ONCE(shared_var, value);
int val = READ_ONCE(shared_var);
```

Without `WRITE_ONCE()` / `READ_ONCE()`, the compiler might:
- Split a 64-bit store into two 32-bit stores (torn read)
- Cache the value in a register and never re-read from memory
- Merge adjacent writes into a single write
- Reorder the access relative to other operations

## Atomic Operations and Lock-Free Algorithms

### Per-CPU Counter Pattern

```c
DEFINE_PER_CPU(long, my_counter);

void increment_counter(void)
{
    preempt_disable();
    this_cpu_inc(my_counter);
    preempt_enable();
}

long read_counter(void)
{
    long sum = 0;
    int cpu;

    for_each_possible_cpu(cpu)
        sum += per_cpu(my_counter, cpu);

    return sum;
}
```

### Atomic Flags Pattern

```c
#define FLAG_ACTIVE    0
#define FLAG_DIRTY     1
#define FLAG_LOCKED    2

unsigned long flags = 0;

/* Set active flag, return previous value */
if (!test_and_set_bit(FLAG_ACTIVE, &flags)) {
    /* We were the first to set it */
    do_activation();
}

/* Clear dirty flag atomically */
test_and_clear_bit(FLAG_DIRTY, &flags);
```

### Wait-Free Read Pattern

```c
/* Single writer, multiple readers — no locks needed */
static int __read_mostly sysctl_value = 42;

/* Writer (under mutex) */
mutex_lock(&writer_mutex);
WRITE_ONCE(sysctl_value, new_value);
mutex_unlock(&writer_mutex);

/* Reader (any context, no locking) */
int val = READ_ONCE(sysctl_value);
```

## Common Pitfalls

### Non-Atomic RMW on Shared Data

```c
/* BAD: Not atomic! */
shared_var++;

/* GOOD: Atomic */
atomic_inc(&shared_atomic_var);
```

### Torn Reads/Writes

```c
/* BAD: 64-bit write may be torn on 32-bit arch */
shared_64bit_var = value;

/* GOOD: Use atomic64_t or WRITE_ONCE */
atomic64_set(&shared_64bit_var, value);
WRITE_ONCE(shared_64bit_var, value);  /* 64-bit arch only */
```

### Missing Memory Barriers

```c
/* BAD: On weakly-ordered archs, writer may reorder */
data = 42;
ready = 1;

/* GOOD: Explicit barrier */
data = 42;
smp_wmb();       /* Or use smp_store_release */
ready = 1;

/* Reader */
while (!READ_ONCE(ready))
    cpu_relax();
smp_rmb();       /* Or use smp_load_acquire */
printk("%d\n", data);  /* Now guaranteed to see 42 */
```

### Using Plain Variables with Concurrent Access

```c
/* BAD: Compiler may optimize, tear, or cache */
if (shared_flag) {
    do_something();
}

/* GOOD: Use READ_ONCE to ensure a fresh read */
if (READ_ONCE(shared_flag)) {
    do_something();
}
```

## Debugging Atomic Operations

### KCSAN (Kernel Concurrency Sanitizer)

```
CONFIG_KCSAN=y
```

KCSAN detects data races by monitoring concurrent accesses to the same memory location:

```
BUG: KCSAN: data-race in my_reader / my_writer

read to 0xffff888012345678 of size 4 by task 1234 on CPU 0:
 my_reader+0x23/0x45

write to 0xffff888012345678 of size 4 by task 5678 on CPU 1:
 my_writer+0x45/0x67
```

### CONFIG_DEBUG_ATOMIC_SLEEP

Warns when sleeping in atomic context (e.g., while holding a spinlock or inside `rcu_read_lock()`).

## Summary Table

| Operation | Type | Atomic? | Returns |
|-----------|------|---------|---------|
| `atomic_add()` | RMW | Yes | void |
| `atomic_add_return()` | RMW | Yes | new value |
| `atomic_cmpxchg()` | CAS | Yes | old value |
| `atomic_xchg()` | Exchange | Yes | old value |
| `set_bit()` | RMW | Yes | void |
| `test_and_set_bit()` | RMW | Yes | old bit |
| `cmpxchg()` | CAS | Yes | old value |
| `smp_mb()` | Barrier | N/A | N/A |
| `smp_wmb()` | Barrier | N/A | N/A |
| `smp_rmb()` | Barrier | N/A | N/A |
| `READ_ONCE()` | Load | N/A | value |
| `WRITE_ONCE()` | Store | N/A | N/A |

## References

- [Linux Kernel Documentation: Atomic Types](https://www.kernel.org/doc/html/latest/core-api/atomic_ops.html)
- [Linux Kernel Documentation: Memory Barriers](https://www.kernel.org/doc/html/latest/core-api/wrappers/memory-barriers.html)
- [Linux Kernel Source: Documentation/memory-barriers.txt](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/Documentation/memory-barriers.txt)
- [Paul E. McKenney: "Memory Barriers: a Hardware View for Software Hackers"](https://www2.rdrop.com/users/paulmck/scalability/paper/whymb.2010.07.23a.pdf)
- [LWN: "A formal kernel memory-ordering model"](https://lwn.net/Articles/718628/)
- [LWN: "Who's afraid of a big bad optimizing compiler?"](https://lwn.net/Articles/793253/)

## Related Topics

- [Synchronization Overview](overview.md) — When and why synchronization is needed
- [Spinlocks](spinlocks.md) — Lock-based synchronization
- [RCU](rcu.md) — Uses atomic operations and memory barriers
- [Seqlocks](seqlocks.md) — Uses atomic sequence counters
- [Lockdep](lockdep.md) — Debugging synchronization issues
