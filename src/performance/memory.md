# Memory Performance

## Introduction

Memory performance is often the hidden bottleneck in Linux systems. Memory bandwidth, latency, cache behavior, huge pages, NUMA topology, and page cache efficiency all significantly impact application performance. This chapter covers memory performance analysis, including tools and techniques for identifying and resolving memory-related performance issues.

## Memory Bandwidth and Latency

### Measuring Memory Bandwidth

```bash
# Using Intel Memory Latency Checker (MLC)
mlc --bandwidth_matrix
# Intel(R) Memory Latency Checker - v3.9
# Measuring injected bandwidth and latency...
#
# Injected Bandwidth (MB/s) per each local NUMA node
# NUMA node     0       1
#    0       85432   45678
#    1       43210   84567
#
# NUMA node    0       1
#    0       0.00    100.00
#    1      100.00    0.00

# Using numactl for bandwidth test
# Install Intel MLC or use STREAM benchmark
# STREAM benchmark:
git clone https://github.com/jeffhammond/STREAM.git
cd STREAM
make
./stream
# Function    Best Rate MB/s  Avg time     Min time     Max time
# Copy:           85678.1234  0.012345     0.012340     0.012350
# Scale:          84567.8901  0.012456     0.012450     0.012460
# Add:            89012.3456  0.016789     0.016780     0.016790
# Triad:          88901.2345  0.016801     0.016790     0.016810
```

### Measuring Memory Latency

```bash
# Using Intel MLC
mlc --latency_matrix
# Intel(R) Memory Latency Checker - v3.9
#
# Latency (ns) per each local NUMA node
# NUMA node     0       1
#    0        72.3   134.5
#    1       131.2    71.8

# Using perf for memory latency profiling
perf stat -e LLC-loads,LLC-load-misses,LLC-stores -- sleep 5
#     1,234,567,890  LLC-loads
#        56,789,012  LLC-load-misses     # 4.60% miss rate
#       567,890,123  LLC-stores
```

## Huge Pages

Huge pages reduce TLB (Translation Lookaside Buffer) misses by using larger memory pages (2 MiB or 1 GiB instead of 4 KiB).

### Why Huge Pages?

```mermaid
flowchart TD
    subgraph "Regular 4K Pages (1GB virtual)"
        TLB4K["TLB entries needed:<br>1GB / 4KB = 262,144<br>TLB has ~1536 entries<br>→ Many misses!"]
    end
    subgraph "2MB Huge Pages (1GB virtual)"
        TLB2M["TLB entries needed:<br>1GB / 2MB = 512<br>TLB has ~1536 entries<br>→ Fits! Few misses"]
    end
    subgraph "1GB Huge Pages (1GB virtual)"
        TLB1G["TLB entries needed:<br>1GB / 1GB = 1<br>→ Perfect!"]
    end
```
### Transparent Huge Pages (THP)

```bash
# Check THP status
cat /sys/kernel/mm/transparent_hugepage/enabled
# [always] madvise never

# Disable THP (recommended for databases)
echo never > /sys/kernel/mm/transparent_hugepage/enabled

# Disable for specific processes
madvise(addr, length, MADV_NOHUGEPAGE)

# Check THP usage
grep AnonHugePages /proc/meminfo
# AnonHugePages:   2097152 kB

# Per-process THP usage
grep -i huge /proc/1234/smaps | head
# AnonHugePages:    512000 kB
```

### Static Huge Pages

```bash
# Allocate static huge pages at boot
# Add to kernel command line:
# hugepagesz=2M hugepages=1024

# Or at runtime
echo 1024 > /proc/sys/vm/nr_hugepages

# Check allocation
cat /proc/meminfo | grep Huge
# HugePages_Total:    1024
# HugePages_Free:      512
# HugePages_Rsvd:      256
# HugePages_Surp:        0
# Hugepagesize:       2048 kB

# 1GB huge pages
echo 4 > /sys/kernel/mm/hugepages/hugepages-1048576kB/nr_hugepages

# Mount hugetlbfs
mount -t hugetlbfs -o pagesize=2M none /mnt/huge

# Use huge pages with applications
# Java: -XX:+UseLargePages
# MySQL: innodb_buffer_pool_chunk_size aligned to huge page size
# PostgreSQL: huge_pages = on

# Per-process huge page usage
grep -i huge /proc/1234/smaps
# AnonHugePages:    512000 kB
# ShmemHugePages:        0 kB
# ShmemPmdMapped:        0 kB
# FileHugePages:         0 kB
```

## Page Cache

The page cache caches file data in RAM, reducing disk I/O:

```bash
# View page cache statistics
free -m
#               total        used        free      shared  buff/cache   available
# Mem:          32000       12000        2000         500       18000       19500
# buff/cache = page cache + buffer cache

# Detailed cache info
cat /proc/meminfo | grep -E "Cached|Buffers|Dirty|Writeback"
# Buffers:          654320 kB
# Cached:         18234560 kB
# Dirty:            123456 kB
# Writeback:          1234 kB
# Dirty:             123456 kB
# Writeback:           1234 kB

# Page cache hit rate (using cachestat)
bpftrace -e '
tracepoint:filemap:mm_filemap_add_to_page_cache {
    @add = count();
}
interval:s:1 {
    printf("cache adds/s: %d\n", @add);
    @add = 0;
}'

# Using perf for cache hit rate
perf stat -e cache-references,cache-misses -- sleep 5
```

### Page Cache Pressure

```bash
# vm.swappiness: tendency to swap vs drop page cache
cat /proc/sys/vm/swappiness
# 60

# Lower = prefer dropping page cache over swapping
echo 10 > /proc/sys/vm/swappiness

# vm.vfs_cache_pressure: tendency to reclaim dentry/inode caches
cat /proc/sys/vm/vfs_cache_pressure
# 100

# Lower = keep metadata caches longer
echo 50 > /proc/sys/vm/vfs_cache_pressure
```

### Dropping Page Cache

```bash
# Drop page cache (safe, no data loss)
echo 1 > /proc/sys/vm/drop_caches

# Drop dentries and inodes
echo 2 > /proc/sys/vm/drop_caches

# Drop everything
echo 3 > /proc/sys/vm/drop_caches

# View before/after
free -m
echo 3 > /proc/sys/vm/drop_caches
free -m
```

## NUMA Memory Performance

### NUMA Memory Policies

```bash
# Check current NUMA policy
numactl --show
# policy: default
# prefer node: 0
# physcpubind: 0 1 2 3 4 5 6 7 16 17 18 19 20 21 22 23
# cpubind: 0 1
# nodebind: 0 1
# membind: 0 1

# Bind to specific NUMA node
numactl --membind=0 ./myapp
numactl --membind=1 ./myapp

# Interleave across all nodes (good for large allocations)
numactl --interleave=all ./myapp

# Prefer a node (fallback allowed)
numactl --preferred=0 ./myapp

# Check process NUMA stats
numastat -p mysqld
# Per-node process memory usage (in MBs)
#                 Node 0   Node 1    Total
# --------------- ------   ------   ------
# 1234 (mysqld)    8234     1234     9468
```

### NUMA Auto-Balancing

```bash
# Enable/disable automatic NUMA balancing
cat /proc/sys/kernel/numa_balancing
# 1

# Disable for consistent performance
echo 0 > /proc/sys/kernel/numa_balancing

# NUMA balancing scan parameters
cat /proc/sys/kernel/numa_balancing_scan_delay_ms
# 1000
cat /proc/sys/kernel/numa_balancing_scan_period_min_ms
# 1000
cat /proc/sys/kernel/numa_balancing_scan_period_max_ms
# 60000
cat /proc/sys/kernel/numa_balancing_scan_size_mb
# 256
```

## Memory Performance Monitoring

### vmstat

```bash
vmstat -w 1
# procs -----------------------memory---------------------- ---swap-- -----io---- -system-- --------cpu--------
#   r   b         swpd         free         buff            cache   si   so       bi    bo   in   cs  us  sy  id  wa  st
#   2   0            0      2048576       654320         18234560    0    0        0     0  500 1000  25   5  67   2   0
# Key columns:
# si/so: swap in/out (should be 0 for healthy system)
# free: free memory
# buff/cache: cached memory
# us/sy/id/wa: CPU user/system/idle/wait
```

### /proc/meminfo

```bash
cat /proc/meminfo
# MemTotal:       32768000 kB
# MemFree:         2048576 kB
# MemAvailable:   19922944 kB
# Buffers:          654320 kB
# Cached:         18234560 kB
# SwapCached:            0 kB
# Active:         12345678 kB
# Inactive:       18765432 kB
# Active(anon):    8234567 kB
# Inactive(anon):  1234567 kB
# Active(file):   12345678 kB
# Inactive(file): 18765432 kB
# Unevictable:      123456 kB
# Mlocked:          123456 kB
# SwapTotal:       8388608 kB
# SwapFree:        8388608 kB
# Dirty:            123456 kB
# Writeback:          1234 kB
# AnonPages:       8234567 kB
# Mapped:          2345678 kB
# Shmem:            567890 kB
# KReclaimable:    1234567 kB
# Slab:            1567890 kB
# SReclaimable:    1234567 kB
# SUnreclaim:       333323 kB
# KernelStack:       12345 kB
# PageTables:        34567 kB
# NFS_Unstable:          0 kB
# Bounce:                0 kB
# WritebackTmp:          0 kB
# CommitLimit:    24772608 kB
# Committed_AS:   16234567 kB
# VmallocTotal:   34359738367 kB
# VmallocUsed:       56789 kB
# VmallocChunk:          0 kB
# Percpu:           234567 kB
# HardwareCorrupted:     0 kB
# AnonHugePages:   2097152 kB
# ShmemHugePages:        0 kB
# ShmemPmdMapped:        0 kB
# FileHugePages:         0 kB
# FilePmdMapped:         0 kB
# HugePages_Total:    1024
# HugePages_Free:      512
# HugePages_Rsvd:      256
# HugePages_Surp:        0
# Hugepagesize:       2048 kB
# Hugetlb:         2097152 kB
# DirectMap4k:    12345678 kB
# DirectMap2M:    18765432 kB
# DirectMap1G:     2097152 kB
```

### Per-Process Memory

```bash
# Process memory map
cat /proc/1234/status | grep -i mem
# VmPeak:  12345678 kB
# VmSize:  12345678 kB
# VmLck:         0 kB
# VmPin:         0 kB
# VmHWM:    8234567 kB
# VmRSS:    8234567 kB
# RssAnon:   8234567 kB
# RssFile:    123456 kB
# RssShmem:    56789 kB
# VmData:   8234567 kB
# VmStk:       136 kB
# VmExe:    1234567 kB
# VmLib:     234567 kB
# VmPTE:      3456 kB
# VmSwap:        0 kB

# smaps rollup for detailed memory breakdown
cat /proc/1234/smaps_rollup
# 00400000-7f8000000000 ---p 00000000 00:00 0    [rollup]
# Rss:             8234567 kB
# Pss:             8234567 kB
# Pss_Anon:        8234567 kB
# Pss_File:         123456 kB
# Pss_Shmem:         56789 kB
# Shared_Clean:      12345 kB
# Shared_Dirty:      23456 kB
# Private_Clean:    123456 kB
# Private_Dirty:   8234567 kB
# Referenced:      8234567 kB
# Anonymous:       8234567 kB
# LazyFree:              0 kB
# AnonHugePages:   2097152 kB
# ShmemPmdMapped:        0 kB
# Shared_Hugetlb:        0 kB
# Private_Hugetlb:       0 kB
# Swap:                  0 kB
# SwapPss:               0 kB
# Locked:                0 kB
```

## Memory Bandwidth Monitoring with perf

```bash
# Intel Memory Bandwidth Monitoring (MBM)
perf stat -e offcore_response.all_data_rd.l3_miss.snoop_none -- sleep 5

# Or using cgroup memory bandwidth
# Check cgroup memory stats
cat /sys/fs/cgroup/myapp/memory.stat
# cache 123456789
# rss 234567890
# rss_huge 123456789
# mapped_file 1234567
# dirty 0
# writeback 0
# pgpgin 123456
# pgpgout 234567
# pgfault 345678
# pgmajfault 1234
# inactive_anon 0
# active_anon 234567890
# inactive_file 123456789
# active_file 0
```

## OOM Killer

When the system runs out of memory, the OOM killer terminates processes:

```bash
# View OOM events
dmesg | grep -i oom
# [12345.678901] Out of memory: Kill process 1234 (java) score 850 or sacrifice child

# Check OOM scores
cat /proc/1234/oom_score
# 850

# Protect a process from OOM killer
echo -1000 > /proc/1234/oom_score_adj
# Range: -1000 (never kill) to 1000 (always prefer)

# For critical services
echo -1000 > /proc/$(pidof sshd)/oom_score_adj
```

## References

- Gregg, B. *Systems Performance: Enterprise and the Cloud*, 2nd Edition.
- [Linux Memory Management Documentation](https://www.kernel.org/doc/html/latest/admin-guide/mm/)
- [NUMA Deep Dive](https://frankdenneman.nl/2016/07/07/numa-deep-dive-part-1-uma-numa/)
- [Huge Pages Documentation](https://www.kernel.org/doc/html/latest/admin-guide/mm/hugetlbpage.html)

## Further Reading

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [LWN.net - Linux and free software news](https://lwn.net/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- <https://www.brendangregg.com/linuxperf.html> - Linux performance tools
- <https://www.kernel.org/doc/html/latest/admin-guide/sysctl/vm.html> - VM sysctl documentation
- <https://www.intel.com/content/www/us/en/developer/articles/tool/intelr-memory-latency-checker.html> - Intel MLC
- <https://github.com/jeffhammond/STREAM> - STREAM benchmark

## Related Topics

- [Performance Overview](overview.md)
- [CPU Performance](cpu.md)
- [NUMA Optimization](numa.md)
- [I/O Performance](io.md)
