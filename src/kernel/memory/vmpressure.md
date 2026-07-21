# vmpressure — Memory Pressure Notifications

## Overview

`vmpressure` is a kernel subsystem that monitors memory pressure levels and generates
notifications when the system experiences varying degrees of memory scarcity. It acts
as a bridge between the kernel's page reclaim mechanisms and userspace consumers,
enabling proactive memory management decisions before the system reaches a critical
OOM (Out of Memory) state.

Unlike direct OOM killer invocation, vmpressure provides graduated feedback —
**low**, **medium**, and **critical** — that lets userspace daemons, cgroups, and
container orchestrators respond proportionally.

## History and Motivation

The vmpressure interface was introduced by Anton Vorontsov and contributed to the
mainline kernel in **Linux 3.8** (2013). The original motivation was to provide a
mechanism for Android's low-memory killer daemon (lmkd) and similar userspace agents
to receive timely, structured notifications about memory stress, replacing ad-hoc
polling of `/proc/meminfo` or other heuristics.

Prior to vmpressure, the kernel offered no intermediate signal between "everything is
fine" and "OOM killer is shooting processes." The vmpressure subsystem fills this gap
by computing a pressure ratio based on reclaim efficiency.

## How Memory Pressure Is Calculated

### Reclaim Scanning vs. Reclaim Efficiency

The vmpressure subsystem hooks into the kernel's page reclaim path (mm/vmpressure.c).
Every time the kswapd daemon or direct reclaim scans pages, vmpressure tracks:

- **Scanned**: the number of pages examined during reclaim
- **Reclaimed**: the number of pages actually freed

The pressure ratio is:

```
pressure = (scanned - reclaimed) / scanned * 100
```

A high ratio means reclaim is spending a lot of effort but freeing few pages — the
system is under memory stress.

### Workqueue-Based Smoothing

Raw reclaim events are noisy. vmpressure uses a kernel workqueue to aggregate
samples over a window and compute a smoothed pressure value. This prevents
transient spikes from triggering false alarms.

### Pressure Levels

| Level      | Threshold  | Meaning                                        |
|------------|------------|------------------------------------------------|
| `low`      | ~60%       | Minor reclaim inefficiency; background pressure |
| `medium`   | ~80%       | Significant reclaim difficulty; action advised  |
| `critical` | ~95%       | Reclaim nearly failing; imminent OOM risk       |

These thresholds are defined in `mm/vmpressure.c` and are not currently tunable at
runtime, though some downstream kernels (Android, Chrome OS) adjust them.

## Kernel Internals

### Data Structures

```c
struct vmpressure {
    unsigned long scanned;
    unsigned long reclaimed;
    unsigned long tree_scanned;
    unsigned long tree_reclaimed;
    /* ... */
    struct vmpressure_levels levels[VMPRESSURE_NUM_LEVELS];
};
```

Each memory cgroup (`memcg`) has its own `vmpressure` instance, enabling per-cgroup
pressure tracking.

### Call Sites

The primary call sites are:

- `vmpressure()` — invoked from `shrink_node()` during reclaim
- `vmpressure_prio()` — invoked when reclaim priority changes
- `vmpressure_memcg()` — invoked per-memcg during cgroup reclaim

### Event Delivery

vmpressure exposes events via:

1. **cgroup file interface**: `memory.pressure_level` (eventfd-based notification)
2. **PSI (Pressure Stall Information)**: the newer PSI subsystem (`/proc/pressure/memory`)
   subsumes many vmpressure use cases with finer granularity

## cgroup Integration

### memory cgroup v1

In cgroup v1, vmpressure is exposed under:

```
/sys/fs/cgroup/memory/<cgroup>/memory.pressure_level
```

Userspace registers for notifications using an `eventfd` via `cgroup.event_control`:

```bash
# Register for medium pressure events
echo "7 memory.pressure_level medium" > /sys/fs/cgroup/memory/<cgroup>/cgroup.event_control
```

Where `7` is the eventfd file descriptor.

### cgroup v2

In cgroup v2, the direct vmpressure event file is less commonly used because PSI
provides a more general interface:

```
/sys/fs/cgroup/<cgroup>/memory.pressure
```

PSI reports "some" and "full" stall percentages, which correlate with vmpressure
levels but are computed differently (based on time stalled rather than reclaim
efficiency).

## Userspace Consumers

### Android lmkd

Android's `lmkd` (Low Memory Killer Daemon) is the primary consumer of vmpressure
on mobile devices. It listens for pressure events and kills background processes
to free memory before the kernel's OOM killer acts indiscriminately.

### systemd

systemd can use cgroup memory pressure notifications to trigger actions like
service restarts or resource limit adjustments via `MemoryPressureWatch=` in
unit files (added in systemd 250+).

### Custom Daemons

Any userspace process with access to the cgroup hierarchy can register for
vmpressure events. A typical pattern:

```c
int efd = eventfd(0, EFD_NONBLOCK);
/* register efd with cgroup.event_control for desired level */
struct epoll_event ev = { .events = EPOLLIN, .data.fd = efd };
epoll_ctl(epfd, EPOLL_CTL_ADD, efd, &ev);
/* ... epoll_wait loop ... */
uint64_t count;
read(efd, &count, sizeof(count));
/* pressure event received — take action */
```

## Relationship to PSI

The **Pressure Stall Information (PSI)** subsystem, merged in Linux 4.20, provides
a more general and arguably superior mechanism for pressure monitoring:

| Aspect        | vmpressure              | PSI                          |
|---------------|-------------------------|------------------------------|
| Metric        | Reclaim efficiency (%)  | Time stalled (seconds/sec)   |
| Granularity   | Three discrete levels   | Continuous "some"/"full"     |
| Resources     | Memory only             | CPU, memory, I/O             |
| Interface     | eventfd via cgroup      | `/proc/pressure/{cpu,mem,io}` |
| cgroup v2     | Supported but secondary | Primary interface             |

PSI is the recommended mechanism for new code, but vmpressure remains in use
for backward compatibility, especially in Android.

## Tuning and Debugging

### Sysctls

There are no direct sysctls for vmpressure. Reclaim behavior is influenced by:

- `vm.swappiness` — swap vs. file-backed reclaim preference
- `vm.vfs_cache_pressure` — dentry/inode cache reclaim aggressiveness
- `vm.watermark_scale_factor` — kswapd wakeup thresholds

### Tracing

vmpressure events can be traced via ftrace:

```bash
echo 1 > /sys/kernel/debug/tracing/events/vmpressure/enable
cat /sys/kernel/debug/tracing/trace_pipe
```

### Observability

Check per-cgroup pressure (cgroup v2):

```bash
cat /sys/fs/cgroup/<cgroup>/memory.pressure
# some avg10=0.00 avg60=0.00 avg300=0.00 total=0
# full avg10=0.00 avg60=0.00 avg300=0.00 total=0
```

## Configuration Examples

### Container Memory Pressure Monitoring (cgroup v2)

```bash
#!/bin/bash
CGROUP_PATH="/sys/fs/cgroup/mycontainer"
MEMORY_PRESSURE_FILE="$CGROUP_PATH/memory.pressure"

# Monitor for "some" pressure (at least one task stalled)
while true; do
    some=$(grep 'some' "$MEMORY_PRESSURE_FILE" | awk '{print $2}' | cut -d= -f2)
    full=$(grep 'full' "$MEMORY_PRESSURE_FILE" | awk '{print $2}' | cut -d= -f2)
    if (( $(echo "$full > 50" | bc -l) )); then
        echo "CRITICAL: full memory pressure at $full%"
        # Trigger container scale-up or OOM action
    elif (( $(echo "$some > 25" | bc -l) )); then
        echo "WARNING: some memory pressure at $some%"
    fi
    sleep 5
done
```

### systemd Unit with Memory Pressure

```ini
[Unit]
Description=Memory-sensitive Service

[Service]
ExecStart=/usr/bin/my-app
MemoryPressureWatch=on
MemoryPressureThresholdSec=10s
```

## Common Pitfalls

1. **Ignoring cgroup context**: vmpressure events are per-cgroup; a "low" event in
   a child cgroup doesn't mean the host is under pressure.
2. **Confusing vmpressure with PSI**: they use different metrics. A vmpressure
   "medium" event doesn't directly map to a specific PSI value.
3. **Relying solely on vmpressure**: for comprehensive memory management, combine
   with PSI, OOM scores, and cgroup memory limits.
4. **Event flooding**: under extreme pressure, events can fire rapidly. Use
   throttling or debouncing in userspace handlers.

## See Also

- [Page Table Isolation](../../performance/page-table-isolation.md) — memory-related
  performance mitigations
- [Kernel Lockdown](../../security/lockdown.md) — security constraints affecting
  memory debugging
- [Thermal Framework](../drivers/thermal.md) — another kernel subsystem using
  graduated notification levels

## Further Reading

- **Kernel source**: `mm/vmpressure.c`, `include/linux/vmpressure.h`
- **Documentation**: `Documentation/admin-guide/cgroup-v2.rst` (memory.pressure section)
- **PSI documentation**: `Documentation/accounting/psi.rst`
- **LWN article**: ["Memory pressure notifications"](https://lwn.net/Articles/524806/) —
  original design discussion
- **Android lmkd**: `system/memory/lmkd` — reference consumer implementation
- **commit 783a5900** — "mm: vmpressure: a new memory pressure notification mechanism"
