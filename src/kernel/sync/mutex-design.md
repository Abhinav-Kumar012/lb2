# Mutex Internals

The Linux kernel mutex (`struct mutex`) is the primary sleeping lock.  It is
designed for correctness, fairness, and performance in the uncontended case.
This page documents its internal design — owner counting, wait_lock, the
optimistic spin, and how it evolved from the original implementation to the
current qspinlock-based design.

---

## 1. Overview

```c
struct mutex {
    atomic_long_t       owner;      /* owner task + flags */
    raw_spinlock_t      wait_lock;  /* protects wait_list */
    struct list_head    wait_list;  /* queued waiters */
#ifdef CONFIG_MUTEX_SPIN_ON_OWNER
    struct optimistic_spin_queue osq; /* MCS optimistic spin */
#endif
};
```

| Field | Purpose |
|---|---|
| `owner` | Pointer to the owning `task_struct` with low bits for flags |
| `wait_lock` | A raw spinlock protecting the wait queue |
| `wait_list` | Linked list of `struct mutex_waiter` nodes |
| `osq` | Optimistic spin queue (MCS-based) for lock stealing |

---

## 2. Owner Counting

### 2.1 The `owner` Field

The `owner` field is an `atomic_long_t` that stores:

* **Bits [0..1]**: flags
* **Bit 0 (`MUTEX_FLAG_WAITERS`)**: at least one waiter exists
* **Bit 1 (`MUTEX_FLAG_HANDOFF`)**: handoff requested (fairness)
* **Bit 2 (`MUTEX_FLAG_PICKUP`)**: new owner must explicitly pick up
* **Bits [2/3..63]**: pointer to `struct task_struct` (aligned to 8 bytes)

### 2.2 Why Owner Tracking Matters

Unlike a simple spinlock, a mutex records **who** holds it.  This enables:

1. **Optimistic spinning** — a contender can check if the owner is running
   and spin in the hope that the owner will release soon.
2. **Debugging** — `CONFIG_DEBUG_MUTEXES` can detect double-unlock,
   unlock-by-non-owner, and deadlocks.
3. **Priority inheritance** — `rt_mutex` (which shares some design) can
   boost the owner's priority.  Regular mutexes don't do PI, but the
   infrastructure is there.

### 2.3 Extracting the Owner

```c
static inline struct task_struct *__mutex_owner(struct mutex *lock)
{
    return (struct task_struct *)(atomic_long_read(&lock->owner)
                                 & ~MUTEX_FLAGS);
}
```

---

## 3. The `wait_lock`

`wait_lock` is a `raw_spinlock_t` that protects the `wait_list`.  It is
held for very short durations — just long enough to:

1. Add or remove a waiter from the list.
2. Check or set the `MUTEX_FLAG_WAITERS` bit.
3. Transfer ownership upon unlock.

### 3.1 Why Not a Regular Spinlock?

`wait_lock` is a **raw** spinlock because it may be held in contexts where
preemption is disabled (inside the optimistic spin path).  Regular
spinlocks have preemption-awareness that would be redundant here.

### 3.2 Lock Ordering

```
mutex->wait_lock  (inner)
  └── held while modifying mutex->wait_list

task_struct->pi_lock  (outer)
  └── used in rt_mutex to manage priority inheritance
```

---

## 4. Mutex Lock Slow Path

### 4.1 Fast Path: `mutex_trylock()`

```c
static inline bool __mutex_trylock(struct mutex *lock)
{
    struct task_struct *owner = __mutex_owner(lock);
    if (owner)
        return false;
    return atomic_long_try_cmpxchg_acquire(&lock->owner, &owner,
                                            (long)current);
}
```

This is a single `cmpxchg`.  If the mutex is free, the current task takes
it.  No spinning, no queuing — just one atomic operation.

### 4.2 Slow Path: `__mutex_lock_slowpath()`

```
__mutex_lock_slowpath()
  ├── optimistic_spin()        ← try to steal the lock
  │     ├── osq_lock()         ← enqueue in MCS optimistic queue
  │     ├── while (owner is running on a different CPU)
  │     │     cpu_relax()      ← spin
  │     ├── try to acquire     ← cmpxchg
  │     └── osq_unlock()       ← leave MCS queue on failure
  │
  └── __mutex_lock_common()    ← actual blocking
        ├── raw_spin_lock(&lock->wait_lock)
        ├── add to wait_list
        ├── set_current_state(TASK_UNINTERRUPTIBLE)
        ├── raw_spin_unlock(&lock->wait_lock)
        └── schedule()         ← sleep
```

---

## 5. Optimistic Spin

The optimistic spin is the key performance innovation in the mutex
implementation (added by Davidlohr Bueso in 3.15, refined through 4.x).

### 5.1 Rationale

When a mutex is held, the owner is likely to release it soon.  Instead of
going to sleep (which involves a context switch, scheduler overhead, and
cache pollution), the contender can **spin in place**.

### 5.2 Conditions for Optimistic Spinning

The contender will spin only if **all** of these are true:

1. The mutex has no current waiters (waiters have priority).
2. The owner is **running** on another CPU (not sleeping).
3. The task is not a real-time task (RT tasks should sleep, not spin).
4. `CONFIG_MUTEX_SPIN_ON_OWNER` is enabled.

### 5.3 MCS Optimistic Spin Queue

To avoid cache-line bouncing when multiple tasks spin simultaneously, the
optimistic spin uses an **MCS queue**:

```
Task A (spinning, holding MCS node)
  └── Task B (spinning, waiting on A's node)
        └── Task C (spinning, waiting on B's node)
```

Each task spins on its own local MCS node — no global atomic operations
during the spin.  When Task A acquires (or gives up), it passes the signal
to Task B.

### 5.4 The Spin Loop

```c
while (!__mutex_trylock(lock)) {
    if (__mutex_owner_is_running(lock))
        cpu_relax();   /* owner on CPU, keep spinning */
    else
        break;         /* owner sleeping, stop spinning */
}
```

### 5.5 Performance Impact

The optimistic spin reduces mutex latency by **30-50%** in contended
scenarios where the critical section is short (a few hundred nanoseconds).
It is particularly effective for:

* Page allocator locks
* VFS inode locks
* Slab allocator locks

---

## 6. Mutex Unlock

### 6.1 Fast Path

```c
static inline void __mutex_fastpath_unlock(atomic_long_t *addr,
                                           void (*fail_fn)(atomic_long_t *))
{
    if (atomic_long_cmpxchg_release(addr, (long)current, 0UL) != (long)current)
        fail_fn(addr);
}
```

If there are no waiters (the owner field is just the current task pointer
with no flags), a single `cmpxchg_release` clears it.  This is the common
uncontended case.

### 6.2 Slow Path: Wakeup

```
__mutex_unlock_slowpath()
  ├── raw_spin_lock(&lock->wait_lock)
  ├── if MUTEX_FLAG_WAITERS set:
  │     ├── pick first waiter from wait_list
  │     ├── set MUTEX_FLAG_PICKUP on owner
  │     └── wake_up_process(waiter->task)
  └── raw_spin_unlock(&lock->wait_lock)
```

### 6.3 Handoff Protocol

When `MUTEX_FLAG_HANDOFF` is set, the unlock path **directly transfers**
ownership to the next waiter instead of letting a spinner steal it.  This
prevents starvation:

```
Owner (unlocking)          Waiter (sleeping)
  │                            │
  ├─ set HANDOFF ────────────►│
  ├─ set PICKUP               │
  └─ wake_up_process() ──────►│ wakes up
                               │ sets current as owner
                               └─ clears PICKUP
```

Handoff is triggered when a waiter has been waiting for too long
(measured in `mutex_waiter` creation time).

---

## 7. Wait Queue: `struct mutex_waiter`

```c
struct mutex_waiter {
    struct list_head    list;
    struct task_struct  *task;
    struct ww_acquire_ctx *ww_ctx;  /* wound/wait context */
#ifdef CONFIG_DEBUG_MUTEXES
    unsigned long       ip;         /* return address for debugging */
#endif
};
```

Waiters are added to the `wait_list` in FIFO order.  The first waiter has
the highest priority for ownership transfer.

---

## 8. Debugging

### 8.1 `CONFIG_DEBUG_MUTEXES`

Enables:

* **Double-unlock detection** — `owner` is checked on unlock.
* **Non-owner unlock detection** — unlock must be called by the owner.
* **Use-before-init detection** — tracks initialization state.
* **Lockdep integration** — deadlock detection.

### 8.2 `CONFIG_DEBUG_LOCK_ALLOC`

Shows the lock hierarchy and detects potential deadlocks at runtime.

### 8.3 Lock Statistics

`CONFIG_LOCK_STATS` tracks:

* Contention count
* Wait time (min/max/avg)
* Hold time (min/max/avg)

Access via `/proc/lock_stat` (if enabled).

---

## 9. Comparison with Other Sleeping Locks

| Feature | mutex | rt_mutex | semaphore | rwsem |
|---|---|---|---|---|
| Exclusive | Yes | Yes | No (count) | Read/Write |
| Owner tracked | Yes | Yes | No | Optional |
| Priority inheriting | No | Yes | No | No |
| Optimistic spin | Yes | Yes | No | Yes |
| RT-friendly | No | Yes | No | No |
| Use case | General | RT | Counting | Read-heavy |

### 9.1 When to Use Which

* **`mutex`** — default choice for mutual exclusion.
* **`rt_mutex`** — when priority inversion is a concern (real-time).
* **`semaphore`** — when you need a counting semaphore (rare in new code).
* **`rwsem`** — when reads vastly outnumber writes.

---

## 10. Evolution

| Version | Change |
|---|---|
| 2.6.16 | Original mutex implementation (Ingo Molnar) |
| 2.6.18 | `MUTEX_FLAG_WAITERS` optimization |
| 3.15 | Optimistic spinning (Davidlohr Bueso) |
| 4.2 | MCS-based optimistic spin queue |
| 4.4 | Handoff protocol for fairness |
| 4.15 | qspinlock integration for wait_lock |
| 5.x | `atomic_long_t` owner (separate from task pointer) |
| 6.x | Continued refinements to osq and handoff timing |

---

## 11. Further Reading

* **LWN: [A new mutex implementation](https://lwn.net/Articles/575510/)**
* **LWN: [Mutexes and the optimistic spinning path](https://lwn.net/Articles/596626/)**
* **Documentation: `Documentation/locking/mutex-design.rst`**
* **Source: `kernel/locking/mutex.c` and `include/linux/mutex.h`**
* **Davidlohr Bueso's optimistic spin patches (2014)**
* **Waiman Long's qspinlock and mutex improvements**

---

## Cross-References

* [Locking Overview](./index.md) — spinlocks, rwlocks, RCU
* [qspinlock](./qspinlock.md) — the underlying spinlock mechanism
* [rt_mutex](./rt-mutex.md) — priority-inheriting mutex
* [rwsem](./rwsem.md) — reader-writer semaphore
* [Lockdep](../debugging/lockdep.md) — lock dependency validator
* [RCU](./rcu.md) — read-copy-update (lock-free alternative)
