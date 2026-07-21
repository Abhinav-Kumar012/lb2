# NUMA Scheduling

## Introduction

On NUMA (Non-Uniform Memory Access) architectures, the time to access memory depends on **which CPU** accesses **which memory**. Memory directly attached to a CPU's node is "local" (fast, ~100ns), while memory on another node is "remote" (slower, ~150-300ns). The NUMA-aware scheduler in Linux ensures that tasks run on CPUs close to their memory, dramatically improving performance on multi-socket and chiplet-based systems.

Modern servers with multiple CPU sockets, AMD EPYC chiplets, and even Intel's hybrid architectures all exhibit NUMA characteristics. Without NUMA-aware scheduling, performance can degrade by **20-40%** for memory-intensive workloads.

## NUMA Architecture

### Hardware Topology

```mermaid
graph TB
    subgraph "NUMA Node 0"
        CPU0["CPU 0-15<br/>(Cores 0-15)"]
        MEM0["Local Memory<br/>64GB DDR5"]
        CPU0 --- MEM0
    end
    subgraph "NUMA Node 1"
        CPU1["CPU 16-31<br/>(Cores 16-31)"]
        MEM1["Local Memory<br/>64GB DDR5"]
        CPU1 --- MEM1
    end
    MEM0 <-->|"Interconnect<br/>(QPI/UPI/Infinity Fabric<br/>~150-300ns latency)"| MEM1

    style MEM0 fill:#38a169,color:#fff
    style MEM1 fill:#38a169,color:#fff
    style CPU0 fill:#3182ce,color:#fff
    style CPU1 fill:#3182ce,color:#fff
```

### Inspecting NUMA Topology

```bash
# Show NUMA nodes
numactl --hardware
# available: 2 nodes (0-1)
# node 0 cpus: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
# node 0 size: 65536 MB
# node 0 free: 32768 MB
# node 1 cpus: 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
# node 1 size: 65536 MB
# node 1 free: 48000 MB
# node distances:
# node   0   1
#   0:  10  21
#   1:  21  10

# Detailed topology
lstopo --no-io --of txt
# Or:
lscpu | grep -i numa
# NUMA node(s):        2
# NUMA node0 CPU(s):   0-15
# NUMA node1 CPU(s):   16-31

# Show distance matrix
cat /sys/devices/system/node/node*/distance
# 10 21
# 21 10

# Check NUMA memory info per node
cat /sys/devices/system/node/node0/meminfo
# Node 0 MemTotal:    67108864 kB
# Node 0 MemFree:     33554432 kB
# Node 0 MemUsed:     33554432 kB
```

## Scheduling Domains

The Linux scheduler organizes CPUs into a hierarchy of **scheduling domains**. Each domain represents a set of CPUs that share certain properties (caches, NUMA nodes, physical packages). The scheduler uses this hierarchy for load balancing decisions.

### Domain Hierarchy

```mermaid
graph TD
    MC["MC Domain (Multi-Core)<br/>All CPUs on same socket<br/>Fast migration"]
    MC --> SMT["SMT Domain (Hyper-Threads)<br/>Same physical core<br/>Fastest migration"]
    MC --> NUMA0["NUMA Domain (Node 0)<br/>CPUs 0-15<br/>Slower migration"]
    MC --> NUMA1["NUMA Domain (Node 1)<br/>CPUs 16-31<br/>Slowest migration"]

    style MC fill:#2b6cb0,color:#fff
    style SMT fill:#38a169,color:#fff
    style NUMA0 fill:#d69e2e,color:#fff
    style NUMA1 fill:#d69e2e,color:#fff
```

### Inspecting Scheduling Domains

```bash
# View scheduling domain information
cat /proc/sys/kernel/sched_domain/cpu0/domain0/name
# SMT
cat /proc/sys/kernel/sched_domain/cpu0/domain1/name
# MC
cat /proc/sys/kernel/sched_domain/cpu0/domain2/name
# NUMA

# Domain parameters
ls /proc/sys/kernel/sched_domain/cpu0/domain0/
# busy_factor        cache_nice_tries  imbalance_pct
# max_interval       min_interval      name
# newidle_idx        wake_idx          forkexec_idx

# Balance interval (ms)
cat /proc/sys/kernel/sched_domain/cpu0/domain0/min_interval
# 4
cat /proc/sys/kernel/sched_domain/cpu0/domain0/max_interval
# 400

# Imbalance percentage (higher = less eager to migrate)
cat /proc/sys/kernel/sched_domain/cpu0/domain2/imbalance_pct
# 125  (NUMA domain: more tolerant of imbalance)
```

## NUMA Balancing

Linux implements **Automatic NUMA Balancing** (since Linux 3.8) using a mechanism called **NUMA hinting faults**. The kernel periodically unmaps pages and notes which CPU faults on them, building a picture of which nodes access which memory.

### How NUMA Balancing Works

1. **Scan phase**: The kernel periodically clears PTE access bits on a task's pages
2. **Fault phase**: When the task accesses the page, a minor fault occurs
3. **Accounting**: The kernel records which NUMA node faulted and which node the page is on
4. **Migration decision**: If the page is accessed frequently from a remote node, it's migrated locally
5. **Task migration**: If most of a task's memory is on another node, the task may be migrated

```mermaid
sequenceDiagram
    participant Task
    participant Kernel
    participant Node0 as NUMA Node 0
    participant Node1 as NUMA Node 1

    Kernel->>Kernel: Periodic PTE scan
    Kernel->>Node1: Clear access bit on page (on Node 1)
    Task->>Node1: Access page → NUMA fault
    Kernel->>Kernel: Record: task on CPU0, page on Node1
    Note over Kernel: After N faults on same page...
    Kernel->>Node0: Migrate page to Node 0
    Task->>Node0: Access page → local hit!
```

### Configuring NUMA Balancing

```bash
# Enable/disable NUMA balancing (enabled by default)
cat /proc/sys/kernel/numa_balancing
# 1

echo 0 > /proc/sys/kernel/numa_balancing  # Disable
echo 1 > /proc/sys/kernel/numa_balancing  # Enable

# NUMA balancing settings (Linux 5.8+)
# Scan delay in milliseconds
cat /proc/sys/kernel/numa_balancing_scan_delay_ms
# 1000

# Scan period range
cat /proc/sys/kernel/numa_balancing_scan_period_min_ms
# 1000
cat /proc/sys/kernel/numa_balancing_scan_period_max_ms
# 60000

# Scan size (MB per scan)
cat /proc/sys/kernel/numa_balancing_scan_size_mb
# 256

# Promote/demote thresholds
cat /proc/sys/kernel/numa_balancing_promote_rate_limit_MBps
# 65536
```

### Monitoring NUMA Balancing

```bash
# NUMA event counters
grep -i numa /proc/vmstat
# numa_hit 12345678          ← Local allocation succeeded
# numa_miss 234567           ← Had to allocate on another node
# numa_foreign 123456        ← Another node's local memory used
# numa_interleave 8901       ← Interleaved allocations
# numa_local 12000000        ← Pages allocated locally
# numa_other 567890          ← Pages allocated remotely

# NUMA balancing stats
cat /proc/vmstat | grep numa_
# numa_pte_updates 45678     ← PTEs updated for NUMA
# numa_hint_faults 12345     ← Total hint faults
# numa_hint_faults_local 10000  ← Faults on local pages
# numa_pages_migrated 2345   ← Pages migrated between nodes

# Per-task NUMA stats
cat /proc/<pid>/numa_maps
# 00400000 default file=/usr/bin/myapp mapped=100 N0=80 N1=20
# 7f1234000000 anon dirty=50 active=45 N0=45 N1=5
# N0=80 means 80 pages on node 0, N1=20 means 20 pages on node 1

# Detailed per-VMA info
cat /proc/<pid>/numa_maps | column -t
```

## Memory Placement Policies

### Using `numactl`

```bash
# Run with memory interleaved across all nodes
numactl --interleave=all ./myapp

# Bind to node 0 (CPU and memory)
numactl --cpunodebind=0 --membind=0 ./myapp

# Bind to specific CPUs
numactl --cpubind=0-7 --membind=0 ./myapp

# Preferred node (fallback allowed)
numactl --preferred=0 ./myapp

# Local allocation (default)
numactl --localalloc ./myapp

# Complex: bind CPUs, interleave memory
numactl --cpunodebind=0 --interleave=0,1 ./myapp

# Check NUMA policy of running process
cat /proc/<pid>/numa_maps | head -5
# Shows memory layout and which nodes pages are on
```

### Memory Policies in Code

```c
#include <numaif.h>
#include <numa.h>
#include <stdlib.h>

int main() {
    /* Initialize libnuma */
    if (numa_available() < 0) {
        fprintf(stderr, "NUMA not available\n");
        return 1;
    }

    /* Set memory policy for the process */
    unsigned long nodemask = 1 << 0;  /* Node 0 */
    set_mempolicy(MPOL_BIND, &nodemask, sizeof(nodemask) * 8);

    /* Allocate memory — now goes to node 0 */
    void *ptr = malloc(1024 * 1024 * 512);  /* 512MB */
    memset(ptr, 0, 1024 * 1024 * 512);

    /* Or per-allocation policy */
    unsigned long target_node = 1;
    void *ptr2 = numa_alloc_onnode(1024 * 1024, target_node);

    /* Interleave allocation across nodes */
    set_mempolicy(MPOL_INTERLEAVE, NULL, 0);
    /* All subsequent allocations are interleaved */

    numa_free(ptr2, 1024 * 1024);
    return 0;
}
# Compile: gcc -lnuma numademo.c -o numademo
```

### Memory Tiering (Linux 5.15+)

Modern systems with multiple memory tiers (DRAM + CXL/persistent memory) use NUMA-based tiering:

```bash
# Check memory tiers
cat /sys/devices/system/node/node*/meminfo | grep -i tier

# Node 0: Fast tier (DRAM)
# Node 1: Slow tier (CXL/persistent memory)

# Auto-promotion settings
echo 1 > /proc/sys/kernel/numa_balancing  # Enable

# Migration threshold (pages accessed more than this get promoted)
cat /proc/sys/kernel/numa_balancing_promote_rate_limit_MBps
```

## Practical Performance Tuning

### Case Study: Database Server

```bash
# Bad: Database processes scattered across nodes
pg_start  # Runs on whatever CPU the scheduler picks

# Good: Pin PostgreSQL to node 0
numactl --cpunodebind=0 --membind=0 pg_start

# Or for specific shared_buffers allocation
numactl --interleave=all pg_start  # Better for shared buffers

# Check current NUMA distribution
numastat -p postgres
# Per-node process memory usage (MB)
#                  Node 0   Node 1    Total
# ---------------  ------   ------   ------
# postgres           4096        0     4096
```

### Identifying NUMA Issues

```bash
# Watch for NUMA misses in real-time
watch -n 1 'grep -E "numa_(hit|miss|local|other)" /proc/vmstat'

# High miss ratio indicates problem
# numa_miss / (numa_hit + numa_miss) > 0.1 = investigate!

# Check which processes have remote memory
for pid in $(pgrep myapp); do
    echo "PID $pid:"
    numastat -p $pid 2>/dev/null | grep -E "Total|Other"
done

# Find processes with significant remote allocation
numastat | grep -E "numa_miss|numa_foreign"
```

### System-wide NUMA Statistics

```bash
# Per-node summary
numastat
# node0           node1
# numa_hit      12345678    11234567
# numa_miss       234567      345678
# numa_foreign     345678      234567
# interleave_hit    8901        8901
# local_node     12000000    10900000
# other_node       567890      678901

# Per-process NUMA hit/miss
numastat -c | head -20
```

## NUMA and the Scheduler

The scheduler's NUMA placement decisions are influenced by several tunables:

```bash
# Scheduler migration cost (nanoseconds)
cat /proc/sys/kernel/sched_migration_cost_ns
# 500000  (0.5ms — includes cache warm-up time)

# NUMA balance interval
cat /proc/sys/kernel/sched_numa_balancing_period_min_ms
# 1000

# Threshold for task migration
cat /proc/sys/kernel/sched_numa_balancing_migrate_deferred
# 1  (defer migration to avoid bouncing)

# Preferred node for new tasks
cat /proc/sys/kernel/sched_numa_prefer_sibling
# 0
```

## References

- [NUMA-aware scheduling documentation](https://www.kernel.org/doc/Documentation/scheduler/sched-numa-balancing.txt)
- [numactl(8) man page](https://man7.org/linux/man-pages/man8/numactl.8.html)
- [set_mempolicy(2) man page](https://man7.org/linux/man-pages/man2/set_mempolicy.2.html)
- [Linux NUMA memory policy](https://www.kernel.org/doc/Documentation/admin-guide/mm/numa_memory_policy.rst)
- [Mel Gorman's NUMA balancing patches](https://lwn.net/Articles/524977/)

## Related Topics

- [Process Priorities](./priorities.md) — CPU scheduling priority
- [Deadline Scheduling](./deadline-scheduling.md) — Real-time scheduling
- [Cgroups](./cgroups.md) — cpuset controller for NUMA pinning
