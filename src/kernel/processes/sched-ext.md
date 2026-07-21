# sched_ext: Extensible Scheduler Class

## Introduction

**sched_ext** is a Linux kernel scheduler class (introduced in Linux 6.12) whose behavior is defined by **BPF programs**. It exports a full scheduling interface, enabling any scheduling algorithm to be implemented as a BPF program and loaded dynamically — without recompiling or rebooting the kernel.

sched_ext sits between the `fair_sched_class` (CFS/EEVDF) and `idle_sched_class` in the scheduling class hierarchy. When a BPF scheduler is loaded, it handles all `SCHED_NORMAL`, `SCHED_BATCH`, `SCHED_IDLE`, and `SCHED_EXT` tasks.

```text
stop_sched_class  (highest priority)
dl_sched_class
rt_sched_class
fair_sched_class
ext_sched_class   ← sched_ext (BPF-defined)
idle_sched_class  (lowest priority)
```

## Key Properties

| Property | Description |
|----------|-------------|
| **BPF-defined behavior** | The scheduling algorithm is implemented entirely in a BPF program attached to sched_ext |
| **Flexible CPU grouping** | A BPF scheduler can group CPUs however it sees fit (per-core, per-cluster, per-NUMA-node, etc.) |
| **Dynamic on/off** | Can be turned on and off at any time without rebooting |
| **System integrity guaranteed** | On error, stall, or SysRq-S, the kernel falls back to the default scheduler automatically |
| **Full task coverage** | Handles SCHED_NORMAL, SCHED_BATCH, SCHED_IDLE, and SCHED_EXT tasks when active |

## Kernel Configuration

sched_ext requires these kernel config options:

```text
CONFIG_BPF=y
CONFIG_SCHED_CLASS_EXT=y
CONFIG_BPF_SYSCALL=y
CONFIG_BPF_JIT=y
CONFIG_DEBUG_INFO_BTF=y
```

The primary config option is `CONFIG_SCHED_CLASS_EXT`. Without it, the sched_ext scheduling class does not exist in the kernel.

## BPF Scheduler Interface

A BPF scheduler implements callbacks via `struct sched_ext_ops`. The key callbacks are:

| Callback | Purpose |
|----------|---------|
| `select_cpu()` | Choose which CPU a task should run on |
| `enqueue()` | Called when a task becomes runnable |
| `dequeue()` | Called when a task is no longer runnable |
| `dispatch()` | Dispatch a task to a specific CPU's local DSQ |
| `running()` | A task has started executing on a CPU |
| `stopping()` | A task has stopped executing on a CPU |
| `init_task()` | Initialize per-task scheduling state |
| `exit_task()` | Clean up per-task scheduling state |
| `init()` | Called when the scheduler is loaded |
| `exit()` | Called when the scheduler is unloaded |

### Dispatch Queues (DSQs)

sched_ext uses **dispatch queues** (DSQs) as the interface between the BPF scheduler and the kernel:

- **`SCX_DSQ_GLOBAL`**: A global FIFO queue shared by all CPUs
- **`SCX_DSQ_LOCAL`**: Per-CPU local queues (highest priority)
- **Custom DSQs**: Created by the BPF scheduler for arbitrary CPU grouping

The BPF scheduler can dispatch tasks to any DSQ. The kernel consumes tasks from DSQs and runs them.

### Partial Switching

The `SCX_OPS_SWITCH_PARTIAL` flag allows a BPF scheduler to opt into **partial switching** — it only handles tasks it explicitly cares about. Tasks it doesn't handle fall through to the default fair scheduler (CFS/EEVDF) automatically.

```c
SEC(".struct_ops")
struct sched_ext_ops my_ops = {
    /* ... callbacks ... */
    .name          = "my_scheduler",
    .timeout_ms    = 5000,
    .flags         = SCX_OPS_SWITCH_PARTIAL,
};
```

## Example: Minimal Global FIFO Scheduler

The kernel source tree includes example sched_ext schedulers under `tools/sched_ext/`. The simplest is `scx_simple.bpf.c`:

```c
/* tools/sched_ext/scx_simple.bpf.c — Minimal global FIFO scheduler */
#include <scx/common.bpf.h>

char _license[] SEC("license") = "GPL";

/* Called when a task becomes runnable */
void BPF_STRUCT_OPS(simple_enqueue, struct task_struct *p, u64 enq_flags)
{
    /* Dispatch directly to the global FIFO queue */
    scx_bpf_dispatch(p, SCX_DSQ_GLOBAL, SCX_SLICE_DFL, enq_flags);
}

/* Called to select a CPU for a task */
s32 BPF_STRUCT_OPS(simple_select_cpu, struct task_struct *p, s32 prev_cpu,
                   u64 wake_flags)
{
    if (scx_bpf_test_and_clear_cpu_idle(prev_cpu))
        return prev_cpu;
    return prev_cpu;
}

s32 BPF_STRUCT_OPS_SLEEPABLE(simple_init)
{
    return scx_bpf_create_dsq(SCX_DSQ_GLOBAL, -1);
}

void BPF_STRUCT_OPS(simple_exit, struct scx_exit_info *ei)
{
    /* Cleanup on exit */
}

SEC(".struct_ops")
struct sched_ext_ops simple_ops = {
    .enqueue       = (void *)simple_enqueue,
    .select_cpu    = (void *)simple_select_cpu,
    .init          = (void *)simple_init,
    .exit          = (void *)simple_exit,
    .name          = "simple",
    .timeout_ms    = 0,
};
```

## Debug and Diagnostics

sched_ext exposes several sysfs files for monitoring:

| File | Description |
|------|-------------|
| `/sys/kernel/sched_ext/state` | Current sched_ext state (enabled/disabled) |
| `/sys/kernel/sched_ext/root/ops` | Name of the currently loaded BPF scheduler ops |
| `/sys/kernel/sched_ext/enable_seq` | Monotonically increasing sequence number for enable/disable events |
| `/sys/kernel/sched_ext/<name>/events` | Per-scheduler diagnostic counters |

```bash
# Check if sched_ext is active
$ cat /sys/kernel/sched_ext/state
enabled

# See which scheduler is loaded
$ cat /sys/kernel/sched_ext/root/ops
scx_simple

# View diagnostic counters
$ cat /sys/kernel/sched_ext/scx_simple/events
```

## Building and Loading

```bash
# Build (from kernel source tree)
$ make -C tools/sched_ext

# Load the scheduler
$ sudo ./scx_simple

# Verify it's active
$ cat /sys/kernel/sched_ext/state
enabled
$ cat /sys/kernel/sched_ext/root/ops
simple

# Unload (Ctrl+C or kill) — tasks revert to CFS/EEVDF automatically
```

## Error Handling and Safety

sched_ext is designed for safety:

1. **Timeout**: If a BPF scheduler doesn't dispatch a task within `timeout_ms` milliseconds, the scheduler is unloaded and all tasks revert to the default class.
2. **Error on BPF program crash**: If the BPF program traps or errors, the scheduler is unloaded gracefully.
3. **SysRq-S**: Pressing SysRq-S forces sched_ext off and restores the default scheduler.
4. **No lockups**: The kernel guarantees that even a buggy BPF scheduler cannot lock up the system.

## Use Cases

- **Rapid prototyping**: Test new scheduling algorithms without recompiling the kernel
- **Workload-specific tuning**: Deploy specialized schedulers for gaming, real-time audio, server workloads, etc.
- **Research**: Experiment with scheduling policies in production-like environments safely
- **Container orchestration**: Custom schedulers that understand container boundaries and QoS requirements
- **Energy efficiency**: Implement power-aware scheduling policies

## References

- [sched_ext Kernel Documentation](https://docs.kernel.org/scheduler/sched-ext.html)
- [sched_ext GitHub / Community](https://sched-ext.github.io/)
- [BPF and sched_ext (LWN)](https://lwn.net/Articles/922405/)
- [Kernel source: kernel/sched/ext.c](https://elixir.bootlin.com/linux/latest/source/kernel/sched/ext.c)
- [Kernel source: tools/sched_ext/](https://elixir.bootlin.com/linux/latest/source/tools/sched_ext)
- [Kernel source: include/linux/sched/ext.h](https://elixir.bootlin.com/linux/latest/source/include/linux/sched/ext.h)

## Related Topics

- [Scheduler Overview](scheduler.md) — Linux scheduler architecture and scheduling classes
- [CFS Internals](cfs.md) — The default scheduling class for normal tasks
- [EEVDF Scheduler](eevdf.md) — The successor to CFS
- [BPF / eBPF](../bpf/overview.md) — The BPF subsystem used by sched_ext
