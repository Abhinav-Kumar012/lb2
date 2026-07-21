# local_lock — Per-CPU Locking for PREEMPT_RT

## Overview

`local_lock` is a kernel synchronization primitive designed to provide **per-CPU
mutual exclusion** with semantics compatible with the `PREEMPT_RT` (real-time
preemption) patch set. It replaces the traditional pattern of disabling
preemption or interrupts to protect per-CPU data, offering a unified API that
works correctly in both non-RT and RT kernels.

In a non-RT kernel, `local_lock` typically compiles to preemption or interrupt
disabling. In a `PREEMPT_RT` kernel, it becomes a **sleeping lock** (a per-CPU
`rt_mutex`), allowing the critical section to be preempted while still
preventing concurrent access from other CPUs to the same per-CPU data.

## The Problem It Solves

### Traditional Per-CPU Protection

Before `local_lock`, kernel code protected per-CPU data with:

```c
/* Disabling preemption ensures the task stays on the same CPU */
preempt_disable();
/* Access per-CPU variable */
this_cpu_write(per_cpu_var, value);
preempt_enable();
```

Or with interrupts disabled for interrupt-safe access:

```c
local_irq_disable();
this_cpu_write(per_cpu_var, value);
local_irq_enable();
```

### The PREEMPT_RT Problem

`PREEMPT_RT` converts spinlocks into sleeping locks, which means:

- `preempt_disable()` no longer prevents preemption (it becomes a migration
  disable, but the task can still be preempted by higher-priority tasks)
- `spin_lock()` becomes a sleeping lock, so it cannot be used in interrupt
  context
- Disabling interrupts is still possible but defeats the purpose of RT by
  introducing unbounded latency

This creates a gap: there was no clean way to protect per-CPU data in RT
kernels that works in all contexts (process, softirq, hardirq).

### local_lock as the Solution

`local_lock` provides a per-CPU lock that:

1. **In non-RT kernels**: compiles to `preempt_disable()` / `preempt_enable()` —
   zero overhead
2. **In RT kernels**: becomes a per-CPU `rt_mutex` — preemptible, priority-
   inheriting, and correct
3. **Works in all contexts**: process, softirq, and hardirq (with appropriate
   variants)

## API Reference

### Basic Usage

```c
#include <linux/local_lock.h>

DEFINE_LOCAL_LOCK(my_lock);

void update_per_cpu_data(void) {
    local_lock(&my_lock);
    /* Safe access to per-CPU data */
    this_cpu_write(my_counter, this_cpu_read(my_counter) + 1);
    local_unlock(&my_lock);
}
```

### Variants

| Function                      | Context     | Non-RT Behavior     | RT Behavior            |
|-------------------------------|-------------|---------------------|------------------------|
| `local_lock(&lock)`           | Process     | `preempt_disable()` | `rt_mutex_lock()`      |
| `local_unlock(&lock)`         | Process     | `preempt_enable()`  | `rt_mutex_unlock()`    |
| `local_lock_bh(&lock)`        | Softirq     | `local_bh_disable()`| `rt_mutex_lock()`      |
| `local_unlock_bh(&lock)`      | Softirq     | `local_bh_enable()` | `rt_mutex_unlock()`    |
| `local_lock_irq(&lock)`       | Hardirq     | `local_irq_disable()`| `rt_mutex_lock()`     |
| `local_unlock_irq(&lock)`     | Hardirq     | `local_irq_enable()` | `rt_mutex_unlock()`   |
| `local_lock_irqsave(&lock, f)`| Hardirq     | `local_irq_save()`  | `rt_mutex_lock()`      |
| `local_unlock_irqrestore(&lock, f)`| Hardirq | `local_irq_restore()`| `rt_mutex_unlock()` |

### Nested Bottom-Half Variant

The `local_lock_nested_bh` variant is specifically designed for code paths that
can be called from both process context and softirq (bottom-half) context, using
the **same** lock instance. It prevents deadlocks when a softirq interrupts a
process-context critical section that holds the same lock:

```c
DEFINE_LOCAL_LOCK(my_bh_lock);

void called_from_process(void) {
    local_lock_bh(&my_bh_lock);
    shared_bh_and_process_code();
    local_unlock_bh(&my_bh_lock);
}

void called_from_softirq(void) {
    /* Must use local_lock_nested_bh() — not local_lock() — to safely
     * acquire a lock that may already be held by a process-context
     * caller that was interrupted by this softirq.
     *
     * Non-RT: disables bottom halves (prevents re-entrant softirq)
     * RT: acquires the per-CPU rt_mutex with a nested lockdep annotation
     */
    local_lock_nested_bh(&my_bh_lock);
    shared_bh_and_process_code();
    local_unlock_nested_bh(&my_bh_lock);
}
```

Using plain `local_lock()` from softirq context when the same lock is taken with
`local_lock_bh()` from process context will trigger **lockdep warnings** because
lockdep cannot establish the correct nesting relationship. `local_lock_nested_bh()`
provides the proper lockdep annotation to suppress false positives while still
detecting real deadlocks.

## Implementation Details

### Non-RT Kernel

In a standard kernel without `PREEMPT_RT`, `local_lock` is essentially a no-op
or maps directly to preemption control:

```c
/* Simplified — actual implementation uses macros */
static inline void local_lock(local_lock_t *lock) {
    preempt_disable();
}

static inline void local_unlock(local_lock_t *lock) {
    preempt_enable();
}
```

This adds zero overhead beyond what `preempt_disable()` already costs.

### RT Kernel

In a `PREEMPT_RT` kernel, `local_lock` becomes a per-CPU `rt_mutex`:

```c
/* Simplified RT implementation */
typedef struct {
    struct rt_mutex __percpu *lock;
} local_lock_t;

static inline void local_lock(local_lock_t *l) {
    rt_mutex_lock(this_cpu_ptr(l->lock));
}

static inline void local_unlock(local_lock_t *l) {
    rt_mutex_unlock(this_cpu_ptr(l->lock));
}
```

The `rt_mutex` provides:

- **Priority inheritance**: if a high-priority task waits on a lock held by a
  low-priority task, the holder temporarily inherits the higher priority
- **Bounded wait time**: no unbounded spinning
- **Preemptibility**: the lock holder can be preempted by unrelated tasks

### Migration Disable

A critical detail: `local_lock` in RT kernels also disables **migration** —
the task cannot be moved to a different CPU while holding the lock. This
ensures the per-CPU data access remains on the correct CPU.

In non-RT kernels, `preempt_disable()` inherently prevents migration.

## When to Use local_lock

### Appropriate Use Cases

1. **Per-CPU counters and statistics**: updating per-CPU performance counters
2. **Per-CPU caches**: managing per-CPU slab caches or object pools
3. **Per-CPU lists**: manipulating per-CPU linked lists
4. **Per-CPU timers**: managing per-CPU timer wheels
5. **Any per-CPU data**: accessed from process context, softirq, or hardirq

### When NOT to Use local_lock

- **Shared data**: if data is accessed from multiple CPUs, use a regular
  spinlock, mutex, or RCU
- **Long critical sections**: in non-RT kernels, `local_lock` disables
  preemption, which increases scheduling latency
- **NMI context**: local_lock is not NMI-safe; use `local_lock_irqsave()` or
  dedicated NMI protection

## Real-World Usage in the Kernel

### Per-CPU Memory Allocator

The kernel's per-CPU page allocator uses `local_lock` to protect per-CPU page
caches:

```c
/* mm/page_alloc.c (simplified) */
struct per_cpu_pages {
    local_lock_t lock;
    /* ... page lists ... */
};

void free_unref_page(struct page *page) {
    struct per_cpu_pages *pcp;
    unsigned long flags;

    local_lock_irqsave(&pcp_lock, flags);
    pcp = this_cpu_ptr(&per_cpu_pages);
    /* Add page to per-CPU free list */
    local_unlock_irqrestore(&pcp_lock, flags);
}
```

### Network Statistics

Per-CPU network statistics use `local_lock_bh` for softirq-safe access:

```c
/* net/core/dev.c (simplified) */
void dev_sw_netstats_rx_add(struct net_device *dev, unsigned int len) {
    struct pcpu_sw_netstats *tstats;
    local_lock_bh(&dev->pcpu_lock);
    tstats = this_cpu_ptr(dev->tstats);
    tstats->rx_bytes += len;
    tstats->rx_packets++;
    local_unlock_bh(&dev->pcpu_lock);
}
```

### Scheduler

The scheduler uses local_lock variants to protect per-CPU run queue data
structures in an RT-compatible manner.

## Migration from Legacy Patterns

### Before local_lock

```c
/* Old pattern — broken on PREEMPT_RT */
DEFINE_SPINLOCK(per_cpu_lock);

void update_data(void) {
    spin_lock(&per_cpu_lock);
    __this_cpu_write(my_var, new_value);
    spin_unlock(&per_cpu_lock);
}
```

Problems on RT:
- `spin_lock()` becomes a sleeping lock → cannot use in hardirq/softirq
- `preempt_disable()` doesn't prevent preemption on RT
- Using `local_irq_disable()` adds unbounded latency

### After local_lock

```c
/* New pattern — works on all configurations */
DEFINE_LOCAL_LOCK(per_cpu_lock);

void update_data(void) {
    local_lock(&per_cpu_lock);
    __this_cpu_write(my_var, new_value);
    local_unlock(&per_cpu_lock);
}

/* Or for softirq context */
void update_data_bh(void) {
    local_lock_bh(&per_cpu_lock);
    __this_cpu_write(my_var, new_value);
    local_unlock_bh(&per_cpu_lock);
}
```

## Debugging

### Lockdep Support

`local_lock` is fully integrated with lockdep. Common warnings include:

- **"BUG: sleeping function called from invalid context"**: using a sleeping
  local_lock variant in a non-sleeping context
- **"inconsistent lock state"**: mixing local_lock variants incorrectly
- **Deadlock detection**: circular dependency between local_lock and other locks

### CONFIG_DEBUG_LOCK_ALLOC

Enable this config option to track lock ownership and nesting, which helps
identify incorrect local_lock usage patterns.

## Performance Considerations

### Non-RT Kernels

`local_lock` compiles to `preempt_disable()`/`preempt_enable()`, which on most
architectures is a simple per-CPU counter increment/decrement. Cost is typically
1–2 cycles.

### RT Kernels

`local_lock` becomes a per-CPU `rt_mutex`. The cost includes:

- Lock acquisition: ~50–200 ns (depending on contention and priority
  inheritance overhead)
- Migration disable: included in the lock acquisition cost
- Memory: one `rt_mutex` per CPU per lock instance

### Contention

Because `local_lock` is per-CPU, contention is rare — only preemption by a
higher-priority task on the same CPU can cause the lock to be contended. In
practice, this is infrequent.

## See Also

- [Kernel Lockdown](../../security/lockdown.md) — security context for kernel
  synchronization
- [Page Table Isolation](../../performance/page-table-isolation.md) — another
  per-CPU performance consideration
- [Thermal Framework](../drivers/thermal.md) — uses per-CPU data protected by
  local locks

## Further Reading

- **Kernel source**: `include/linux/local_lock.h`, `include/linux/local_lock_internal.h`
- **Documentation**: `Documentation/locking/rt-mutex.rst`
- **LWN article**: ["Sleeping spinlocks and realtime"](https://lwn.net/Articles/778953/) —
  PREEMPT_RT locking overview
- **Thomas Gleixner's talk**: "PREEMPT_RT: Locking and Synchronization" —
  Linux Plumbers Conference
- **commit 5be3a75**: "local_lock: Add local_lock() infrastructure"
- **PREEMPT_RT wiki**: https://wiki.linuxfoundation.org/realtime/start —
  comprehensive RT locking documentation
