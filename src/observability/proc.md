# proc Filesystem for Observability

## Introduction

The `/proc` filesystem is a pseudo-filesystem that provides a window into the kernel's internal data structures. It doesn't exist on disk—it's generated dynamically by the kernel when accessed. `/proc` is the foundation of Linux observability: every monitoring tool (`top`, `free`, `iostat`, `vmstat`, `ps`) reads from `/proc` under the hood.

Understanding `/proc` gives you direct access to kernel information without any additional tools.

## /proc Overview

```bash
ls /proc/
# 1  2  3  ...  self  cpuinfo  meminfo  stat  version  ...
```

### Process-Specific Entries

```bash
# Each process has a directory /proc/<pid>/
ls /proc/1/
# attr/    cgroup   comm     cpu      cwd@     environ  exe@     fd/      fdinfo/
# io       limits   maps     mem      mountinfo mounts   net/     ns/      oom_score
# oom_score_adj  pagemap  personality  root@    sched    sessionid  smaps
# smaps_rollup   stat     statm    status   syscall  task/    timers   wchan

# Process command line
cat /proc/1/cmdline | tr '\0' ' '
# /sbin/init

# Process environment
cat /proc/1/environ | tr '\0' '\n' | head -5
# PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin

# Process status
cat /proc/1/status
# Name:   systemd
# Umask:  0000
# State:  S (sleeping)
# Tgid:   1
# Ngid:   0
# Pid:    1
# PPid:   0
# TracerPid:  0
# Uid:    0   0   0   0
# Gid:    0   0   0   0
# FDSize: 256
# Groups:
# NStgid: 1
# NSpid:  1
# NSpgid: 1
# NSsid:  1
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
# Threads: 42
```

## /proc/stat: CPU Statistics

```bash
cat /proc/stat
# cpu  123456789 7890 23456789 8901234567 67890 0 12345 0 0 0
# cpu0 30864197 1972 5864197 2225308641 16972 0 3136 0 0 0
# cpu1 30864197 1972 5864197 2225308641 16972 0 3136 0 0 0
# ...
# intr 1234567890 123 456 789 ...
# ctxt 12345678901
# btime 1626784800
# processes 1234567
# procs_running 4
# procs_blocked 0
# softirq 1234567890 123456 789012 345678 ...

# Fields:
# cpu  user nice system idle iowait irq softirq steal guest guest_nice
# user: normal processes executing in user mode
# nice: niced processes executing in user mode
# system: processes executing in kernel mode
# idle: twiddling thumbs
# iowait: waiting for I/O to complete
# irq: servicing interrupts
# softirq: servicing softirqs
# steal: involuntary wait (virtual machines)
```

### CPU Utilization Calculation

```bash
# Calculate CPU utilization from /proc/stat
# Read twice, 1 second apart, calculate difference
cat /proc/stat | head -1
# cpu  123456789 7890 23456789 8901234567 67890 0 12345 0 0 0

# Utilization% = (1 - idle_delta / total_delta) * 100
```

## /proc/meminfo: Memory Statistics

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
# Slab:            1567890 kB
# SReclaimable:    1234567 kB
# SUnreclaim:       333323 kB
# KernelStack:       12345 kB
# PageTables:        34567 kB
# CommitLimit:    24772608 kB
# Committed_AS:   16234567 kB
# HugePages_Total:    1024
# HugePages_Free:      512
# HugePages_Rsvd:      256
# Hugepagesize:       2048 kB
```

### Key Memory Metrics

| Field | Description |
|-------|-------------|
| MemTotal | Total usable RAM |
| MemFree | Completely unused RAM |
| MemAvailable | Memory available for new allocations (estimate) |
| Buffers | Block device buffer cache |
| Cached | Page cache (file data in RAM) |
| Active | Recently used memory |
| Inactive | Candidate for reclaim |
| Dirty | Waiting to be written to disk |
| Slab | Kernel slab allocator memory |
| SReclaimable | Slab memory that can be freed |
| AnonPages | Anonymous memory (heap, stack, mmap) |

## /proc/diskstats: Disk I/O Statistics

```bash
cat /proc/diskstats | grep sda
#   8 0 sda 123456 789 12345678 9012 567890 123 45678901 2345 0 6789 11357

# Fields (14 columns):
# 1  major: Major device number
# 2  minor: Minor device number
# 3  name: Device name
# 4  reads_completed: Total reads completed
# 5  reads_merged: Reads merged (adjacent)
# 6  sectors_read: Total sectors read
# 7  read_time_ms: Total read time (ms)
# 8  writes_completed: Total writes completed
# 9  writes_merged: Writes merged
# 10 sectors_written: Total sectors written
# 11 write_time_ms: Total write time (ms)
# 12 io_in_progress: I/Os currently in progress
# 13 io_time_ms: Time doing I/Os (ms)
# 14 weighted_io_time_ms: Weighted I/O time (ms)
```

### Calculating I/O Metrics

```bash
# IOPS = delta(reads + writes) / delta(time)
# Throughput = delta(sectors * 512) / delta(time)
# Latency = delta(io_time) / delta(io_count)
# Utilization = delta(io_time) / delta(wall_time) * 100
```

## /proc/net: Network Statistics

```bash
# Network interface statistics
cat /proc/net/dev
# Inter-|   Receive                                                |  Transmit
#  face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo frame compressed
#   lo: 123456789 1234567    0    0    0     0          0         0 123456789 1234567    0    0    0     0       0         0
#  eth0: 12345678901 12345678 0 1234 0     0          0    123456 23456789012 23456789 0 567 0     0       0         0

# TCP connections
cat /proc/net/tcp | head -5
# sl  local_address rem_address   st tx_queue rx_queue ...
#  0: 00000000:0050 00000000:0000 0A 00000000:00000000
#  1: 0100007F:0035 00000000:0000 0A 00000000:00000000

# Socket statistics
cat /proc/net/sockstat
# sockets: used 1234
# TCP: inuse 567 orphan 12 tw 234 alloc 789 mem 1234
# UDP: inuse 234 mem 567
# UDPLITE: inuse 0
# RAW: inuse 0
# FRAG: inuse 0 memory 0

# TCP extended statistics
cat /proc/net/netstat | head -10
# TcpExt: SyncookiesSent SyncookiesRecv SyncookiesFailed ...
# TcpExt: 0 0 0 ...

# SNMP counters
cat /proc/net/snmp | head -10
# Ip: Forwarding DefaultTTL InReceives InHdrErrors ...
# Ip: 1 64 123456789 0 ...
```

## /proc/sys: Kernel Parameters

```bash
# View all sysctl parameters
ls /proc/sys/
# abi/  debug/  dev/  fs/  kernel/  net/  vm/

# VM parameters
ls /proc/sys/vm/
# dirty_background_bytes    dirty_expire_centisecs  min_free_kbytes
# dirty_background_ratio    dirty_ratio             nr_hugepages
# dirty_bytes               dirty_writeback_centisecs  overcommit_memory
# vfs_cache_pressure        swappiness              overcommit_ratio

# Network parameters
ls /proc/sys/net/core/
# netdev_budget  netdev_max_backlog  rmem_max  somaxconn  wmem_max

# Kernel parameters
ls /proc/sys/kernel/
# pid_max  sched_latency_ns  sched_min_granularity_ns  threads-max
```

## /proc Load Average and Uptime

```bash
# Load average
cat /proc/loadavg
# 5.67 4.32 3.21 4/1234 5678
# 1-min 5-min 15-min running/total last-pid

# Uptime
cat /proc/uptime
# 3628800.45 29030400.36
# uptime_seconds idle_seconds (across all CPUs)
```

## /proc Interrupts and Softirqs

```bash
# Hardware interrupts
cat /proc/interrupts | head -5
#            CPU0       CPU1       CPU2       CPU3
#   1:         42         0         0         0   IO-APIC   2-edge      timer
#   8:          0         0         0         1   IO-APIC   8-edge      rtc0
#  16:   12345678   23456789   34567890   45678901   PCI-MSI  524289-edge  eth0

# Soft interrupts
cat /proc/softirqs | head -5
#                     CPU0       CPU1       CPU2       CPU3
#          HI:          42         56         78         90
#       TIMER:    12345678   23456789   34567890   45678901
#      NET_TX:    12345678   23456789   34567890   45678901
#      NET_RX:    12345678   23456789   34567890   45678901
```

## /proc CPU Information

```bash
cat /proc/cpuinfo | head -20
# processor	: 0
# vendor_id	: GenuineIntel
# cpu family	: 6
# model		: 85
# model name	: Intel(R) Xeon(R) Gold 6248 CPU @ 2.50GHz
# stepping	: 7
# microcode	: 0x5003604
# cpu MHz		: 2500.000
# cache size	: 27648 KB
# physical id	: 0
# siblings	: 16
# core id		: 0
# cpu cores	: 8
# apicid		: 0
# initial apicid	: 0
# fpu		: yes
# fpu_exception	: yes
# cpuid level	: 22
# wp		: yes
# flags		: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr ...
```

## Practical Examples

### Real-Time CPU Monitor

```bash
#!/bin/bash
# Simple CPU monitor reading /proc/stat
while true; do
    cpu1=$(cat /proc/stat | head -1)
    sleep 1
    cpu2=$(cat /proc/stat | head -1)
    
    idle1=$(echo $cpu1 | awk '{print $5}')
    idle2=$(echo $cpu2 | awk '{print $5}')
    total1=$(echo $cpu1 | awk '{s=0; for(i=2;i<=NF;i++) s+=$i; print s}')
    total2=$(echo $cpu2 | awk '{s=0; for(i=2;i<=NF;i++) s+=$i; print s}')
    
    idle=$((idle2 - idle1))
    total=$((total2 - total1))
    cpu=$((100 * (total - idle) / total))
    
    echo "CPU: ${cpu}%"
done
```

### Process Memory Monitor

```bash
#!/bin/bash
# Monitor process memory via /proc
PID=$1
while true; do
    if [ -f /proc/$PID/status ]; then
        rss=$(grep VmRSS /proc/$PID/status | awk '{print $2}')
        vmsize=$(grep VmSize /proc/$PID/status | awk '{print $2}')
        echo "$(date +%H:%M:%S) RSS: ${rss}kB VSZ: ${vmsize}kB"
    else
        echo "Process $PID not found"
        break
    fi
    sleep 1
done
```

## References

- [proc(5) man page](https://man7.org/linux/man-pages/man5/proc.5.html)
- [Linux Kernel Documentation: /proc](https://www.kernel.org/doc/html/latest/filesystems/proc.html)
- [Understanding /proc](https://www.kernel.org/doc/html/latest/admin-guide/sysctl/)

## Further Reading

- <https://man7.org/linux/man-pages/man5/proc.5.html> - Complete proc(5) reference
- <https://www.kernel.org/doc/html/latest/filesystems/proc.html> - Kernel proc documentation
- <https://www.brendangregg.com/linuxperf.html> - Linux performance tools

## Related Topics

- [Observability Overview](overview.md)
- [sysfs](sysfs.md)
- [Metrics Collection](metrics.md)
- [BPF and bpftrace](bpf-bpftrace.md)
