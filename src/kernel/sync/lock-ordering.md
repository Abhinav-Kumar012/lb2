# Lock Ordering

## Introduction

Lock ordering is the discipline of acquiring multiple locks in a consistent, predefined order across all code paths in the kernel. It is the primary defense against **ABBA deadlocks** — the most common class of deadlock where two CPUs each hold one lock and wait for the other.

The Linux kernel is a massive concurrent program with thousands of locks. Without a disciplined ordering scheme, deadlocks would be inevitable. This chapter covers the theory and practice of lock ordering, the ABBA deadlock pattern, nesting rules, and the annotations that help lockdep enforce ordering at runtime.

## The ABBA Deadlock

### The Problem

When two CPUs acquire two locks in different orders, a deadlock can occur:

```c
/* Thread A (CPU 0) */
spin_lock(&lock_a);     /* Acquires A */
spin_lock(&lock_b);     /* Blocks: B held by Thread B */

/* Thread B (CPU 1) */
spin_lock(&lock_b);     /* Acquires B */
spin_lock(&lock_a);     /* Blocks: A held by Thread A */
```

```mermaid
graph LR
    subgraph "CPU 0 (Thread A)"
        A1[Hold lock_a] --> A2[Wait for lock_b]
    end
    subgraph "CPU 1 (Thread B)"
        B1[Hold lock_b] --> B2[Wait for lock_a]
    end
    A2 -.->|Blocked by| B1
    B2 -.->|Blocked by| A1
```

Neither thread can make progress — this is a **deadlock**.

### The Solution: Consistent Ordering

Define a global ordering: **always acquire lock_a before lock_b**. If all code paths follow this rule, the deadlock cannot occur:

```c
/* Thread A (correct) */
spin_lock(&lock_a);
spin_lock(&lock_b);     /* OK: A before B matches the ordering */

/* Thread B (correct) */
spin_lock(&lock_a);     /* Acquire A first, even though we need B */
spin_lock(&lock_b);
```

## Lock Ordering Rules

### Rule 1: Establish a Global Hierarchy

Assign each lock a position in a global ordering. When acquiring multiple locks, always acquire them in increasing order:

```c
/*
 * Lock ordering:
 *   1. sb_lock (superblock lock)
 *   2. inode_lock (inode lock)
 *   3. page_lock (page lock)
 *   4. mapping->tree_lock (address space lock)
 */

/* CORRECT: acquiring in order */
spin_lock(&sb_lock);
mutex_lock(&inode_lock);
spin_lock(&page_lock);

/* WRONG: out of order — potential deadlock */
spin_lock(&page_lock);
spin_lock(&sb_lock);  /* Violates ordering: page_lock > sb_lock */
```

### Rule 2: Document the Ordering

Every lock in the kernel should have a documented position in the ordering. This is often done with comments:

```c
/*
 * Ordering:
 *   dentry->d_lock
 *   inode->i_lock
 *   inode->i_mutex
 *   sb->s_lock
 */
```

### Rule 3: Never Acquire a "Higher" Lock While Holding a "Lower" Lock

```c
/* If lock_a has order 5 and lock_b has order 10: */

/* CORRECT: lower → higher */
spin_lock(&lock_a);  /* order 5 */
spin_lock(&lock_b);  /* order 10 */

/* WRONG: higher → lower */
spin_lock(&lock_b);  /* order 10 */
spin_lock(&lock_a);  /* order 5 — DEADLOCK RISK */
```

### Rule 4: Use Lock Nesting for Required Combinations

When you need both locks but the natural ordering doesn't match your code structure, restructure to acquire locks in the correct order:

```c
/* You need both inode->i_mutex and page lock, but the ordering
 * requires inode->i_mutex first */

/* CORRECT */
mutex_lock(&inode->i_mutex);
spin_lock(&mapping->tree_lock);
/* ... */
spin_unlock(&mapping->tree_lock);
mutex_unlock(&inode->i_mutex);
```

## Lock Classes

The kernel uses **lock classes** to track ordering relationships. Multiple lock instances can share the same class if they have the same ordering constraints:

```c
/* All inodes share the same lock class for i_mutex */
struct inode {
    struct mutex i_mutex;  /* Same class for all inodes */
};

/* But inode->i_mutex and sb->s_lock are different classes */
```

Lockdep tracks ordering between classes, not individual lock instances. This prevents false positives when two locks of the same class are acquired in different orders (which is fine — they're the same type and the same task can't hold two instances simultaneously in a conflicting way).

### Lockdep Annotations

```c
/* Define a lock class explicitly */
spin_lock_init(&my_lock);
lockdep_set_class(&my_lock, &my_lock_class);

/* Or for spinlocks with static initialization */
DEFINE_SPINLOCK(my_lock);

/* Subclass: allows multiple instances of the same class
 * to be nested (e.g., multiple inode locks) */
mutex_lock_nested(&inode->i_mutex, I_MUTEX_PARENT);
mutex_lock_nested(&child_inode->i_mutex, I_MUTEX_CHILD);
```

## Common Lock Ordering in Linux

### VFS (Virtual File System) Ordering

```
1. sb_writers (superblock write holders)
2. sb->s_umount (superblock unmount)
3. inode->i_rwsem (inode read/write semaphore)
4. inode->i_mutex (inode mutex — legacy name)
5. mapping->i_mmap_rwsem
6. page lock (per-page)
```

### Memory Management Ordering

```
1. mm->mmap_lock (mmap semaphore)
2. mm->page_table_lock (page table spinlock)
3. lru_lock (per-zone LRU lock)
4. page lock
5. mapping->tree_lock (xarray lock)
```

### Networking Ordering

```
1. sock->sk_lock (socket lock)
2. net->packet.sklist_lock
3. dev->tx_global_lock
4. qdisc lock
5. netfilter hooks
```

### Block I/O Ordering

```
1. q->sysfs_lock (queue sysfs)
2. q->queue_lock (queue lock)
3. bio->bi_lock
4. page lock
```

## Practical Examples

### Example 1: Transfer Between Two Lists

When you need to move an item between two lists protected by different locks:

```c
/* WRONG: potential ABBA deadlock */
spin_lock(&list_a_lock);
spin_lock(&list_b_lock);  /* If another thread does list_b → list_a, DEADLOCK */
list_move(&entry->list, &list_b);
spin_unlock(&list_b_lock);
spin_unlock(&list_a_lock);

/* CORRECT: always acquire in same order */
if (&list_a_lock < &list_b_lock) {
    spin_lock(&list_a_lock);
    spin_lock(&list_b_lock);
} else {
    spin_lock(&list_b_lock);
    spin_lock(&list_a_lock);
}
list_move(&entry->list, &list_b);
spin_unlock(&list_b_lock);
spin_unlock(&list_a_lock);

/* BETTER: use a dedicated ordering or double-locked helper */
spin_lock(&list_a_lock);
spin_lock(&list_b_lock);  /* Safe because ordering is enforced by convention */
```

### Example 2: Lock Ordering with trylock

When the natural ordering doesn't match your code, use `trylock` to avoid blocking:

```c
/* You need lock_b but already hold lock_a (wrong order) */
spin_lock(&lock_a);

if (spin_trylock(&lock_b)) {
    /* Got both locks */
    /* ... */
    spin_unlock(&lock_b);
} else {
    /* Can't get lock_b without violating ordering */
    spin_unlock(&lock_a);

    /* Acquire in correct order */
    spin_lock(&lock_b);
    spin_lock(&lock_a);
    /* ... */
    spin_unlock(&lock_a);
    spin_unlock(&lock_b);
}
```

### Example 3: Hierarchical Locking (Tree Structures)

When locking a tree, always lock from root to leaf:

```c
void lock_tree_path(struct tree_node *leaf)
{
    struct tree_node *node;
    struct tree_node *path[MAX_DEPTH];
    int depth = 0;

    /* Build path from leaf to root */
    for (node = leaf; node; node = node->parent)
        path[depth++] = node;

    /* Lock from root to leaf */
    while (--depth >= 0)
        mutex_lock(&path[depth]->lock);
}
```

## The trylock Escape Hatch

When you cannot determine the ordering at compile time, `trylock` provides a deadlock-free way to attempt acquisition:

```c
/* Lock-free attempt pattern */
retry:
    spin_lock(&known_lock);

    if (!spin_trylock(&unknown_order_lock)) {
        spin_unlock(&known_lock);
        /* Maybe yield or back off */
        cpu_relax();
        goto retry;
    }

    /* Got both locks */
    /* ... */
    spin_unlock(&unknown_order_lock);
    spin_unlock(&known_lock);
```

**Warning**: This pattern can livelock if both sides retry indefinitely. Use it sparingly and consider if a better ordering exists.

## Lock Ordering and Performance

Lock ordering constraints can sometimes force you to acquire locks earlier than necessary, increasing hold times:

```c
/* Ideal: acquire lock only when needed */
process_data(data);
spin_lock(&lock);
list_add(&data->list, &my_list);
spin_unlock(&lock);

/* Required by ordering: acquire earlier */
spin_lock(&lock);        /* Acquired earlier than needed */
process_data(data);      /* Hold time increased */
list_add(&data->list, &my_list);
spin_unlock(&lock);
```

To mitigate this:
1. **Restructure code** to match the ordering naturally
2. **Split locks** into finer-grained locks with compatible ordering
3. **Use lock-free approaches** (RCU, atomics) where possible
4. **Use trylock** to avoid blocking when the ordering is ambiguous

## Debugging Ordering Violations

### Lockdep (Runtime)

Lockdep automatically detects ordering violations at runtime. See [Lockdep](lockdep.md).

### Manual Documentation

Maintain a lock ordering document for your subsystem:

```c
/*
 * Lock Ordering for my_subsystem:
 *
 *   1. subsystem_mutex (global subsystem lock)
 *   2. device->dev_lock (per-device lock)
 *   3. queue->q_lock (per-queue lock)
 *   4. buffer->buf_lock (per-buffer lock)
 *
 * Rules:
 *   - Never acquire a higher-numbered lock while holding a lower one
 *   - If you need both device->dev_lock and queue->q_lock,
 *     always acquire device->dev_lock first
 */
```

### Sparse Annotations

The `sparse` static checker can identify some lock ordering issues, though it's less capable than lockdep:

```c
/* __acquires() and __releases() annotations */
void __acquires(rcu) rcu_read_lock(void);
void __releases(rcu) rcu_read_unlock(void);
```

## Advanced: Lock Inversion

Lock inversion is a subtle form of ordering violation where the ordering depends on runtime values:

```c
/* Thread A: lock(parent) then lock(child) */
mutex_lock(&parent->lock);
mutex_lock(&child->lock);  /* child is child of parent */

/* Thread B: lock(some_node) then lock(parent) */
mutex_lock(&some_node->lock);
mutex_lock(&parent->lock);
/* If some_node == child, this is an inversion! */
```

Lockdep detects this by tracking the ordering graph. The solution is to use **lockdep subclasses** to distinguish between different nesting levels:

```c
mutex_lock_nested(&parent->lock, SINGLE_DEPTH_NESTING);
mutex_lock_nested(&child->lock, DOUBLE_DEPTH_NESTING);
```

## References

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- [Linux Kernel Documentation: Lock ordering](https://www.kernel.org/doc/html/latest/locking/lockdep-design.html)
- [Jonathan Corbet: "Locking patterns"](https://lwn.net/Articles/185667/)
- [Paul McKenney: "Lockdep: the Linux lock validator"](https://lwn.net/Articles/185500/)
- [Robert Love: "Linux Kernel Development" — Chapter 10: Kernel Synchronization](https://www.oreilly.com/library/view/linux-kernel-development/9780768696974/)

## Related Topics

- [Synchronization Overview](overview.md) — When and why locks are needed
- [Lockdep](lockdep.md) — Runtime lock dependency validator
- [Spinlocks](spinlocks.md) — Busy-wait locks
- [Mutexes](mutexes.md) — Sleeping locks
- [RCU](rcu.md) — Lock-free read-side synchronization
