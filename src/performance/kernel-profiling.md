# Kernel Profiling

## Overview

Kernel profiling is the practice of measuring where the kernel (and userspace) spends CPU time, memory, and other resources. The primary profiling tool in Linux is **perf**, a powerful performance analysis toolkit built into the kernel.

Profiling helps identify bottlenecks, optimize code paths, and understand system behavior under real workloads.

> **See also:** [ftrace](./ftrace.md), [eBPF](./ebpf.md), [SystemTap](./systemtap.md)

---

## perf: The Linux Profiling Toolkit

### Architecture

perf uses **hardware performance counters** (PMU — Performance Monitoring Unit) and **software events** to collect samples:

```
┌──────────────────────────────────────────┐
│              Userspace                    │
│   perf record / perf report / perf stat  │
└──────────────────┬───────────────────────┘
                   │ perf_event_open() syscall
┌──────────────────▼───────────────────────┐
│           perf_event Subsystem            │
│   kernel/events/core.c                   │
│   ┌─────────────┐  ┌──────────────────┐ │
│   │ HW Counters │  │ SW Events        │ │
│   │ (PMU)       │  │ (sched, tracep.) │ │
│   └─────────────┘  └──────────────────┘ │
└──────────────────────────────────────────┘
```

### Prerequisites

```bash
# Install perf (Debian/Ubuntu)
sudo apt install linux-tools-common linux-tools-$(uname -r)

# Install perf (RHEL/Fedora)
sudo dnf install perf

# Verify
perf version
```

---

## perf record

### Basic CPU Profiling

```bash
# Profile the entire system for 10 seconds
sudo perf record -a -g -- sleep 10

# Profile a specific command
sudo perf record -g ./my_program

# Profile a specific process
sudo perf record -p <pid> -g -- sleep 30

# Profile with call graph (dwarf-based)
sudo perf record -a -g --call-graph dwarf -- sleep 10

# Profile with frame pointer call graph
sudo perf record -a -g --call-graph fp -- sleep 10
```

### Key Options

| Option                  | Description                              |
|------------------------|------------------------------------------|
| `-a`                   | System-wide (all CPUs)                   |
| `-g`                   | Record call graphs                       |
| `-p <pid>`             | Target specific process                  |
| `-t <tid>`             | Target specific thread                   |
| `-e <event>`           | Specify event (default: `cpu-cycles`)    |
| `-F <freq>`            | Sampling frequency (Hz)                  |
| `-c <count>`           | Sample every N events                    |
| `--call-graph dwarf`   | DWARF-based unwinding (most reliable)    |
| `--call-graph fp`      | Frame pointer unwinding (faster)         |
| `--call-graph lbr`     | Last Branch Record (Intel CPUs only)     |
| `-o <file>`            | Output file (default: `perf.data`)       |
| `-- sleep <N>`         | Record for N seconds                     |

### Event Selection

```bash
# Default: cpu-cycles
sudo perf record -a -- sleep 5

# Cache misses
sudo perf record -e cache-misses -a -- sleep 5

# Branch mispredictions
sudo perf record -e branch-misses -a -- sleep 5

# Context switches
sudo perf record -e context-switches -a -- sleep 5

# Page faults
sudo perf record -e page-faults -a -- sleep 5

# Multiple events
sudo perf record -e cycles,instructions,cache-misses -a -- sleep 5

# Tracepoint events
sudo perf record -e 'sched:sched_switch' -a -- sleep 5

# Software events
sudo perf record -e cpu-clock -a -- sleep 5
```

### List Available Events

```bash
# Hardware events
perf list hw

# Software events
perf list sw

# Tracepoints
perf list tracepoint

# All events
perf list

# PMU-specific events
perf list pmu
```

---

## perf report

### Interactive Report

```bash
# Default interactive view
sudo perf report

# With call graph
sudo perf report --call-graph

# Sort by overhead
sudo perf report --sort=dso,symbol

# Show specific fields
sudo perf report --stdio --sort comm,dso,symbol
```

### Report Options

| Option              | Description                              |
|---------------------|------------------------------------------|
| `--stdio`           | Text output (no TUI)                     |
| `--sort`            | Sort by fields (comm,dso,symbol,etc.)    |
| `--call-graph`      | Show call graph                          |
| `--percent-limit N` | Hide symbols below N% overhead           |
| `-n`                | Show sample counts                       |
| `--header`          | Show perf.data header info               |

### Reading the Output

```
# Overhead  Command      Shared Object        Symbol
# ........  ...........  ...................  ........................
    12.34%  my_program   libc-2.31.so         [.] __memcpy_avx2
     8.21%  my_program   my_program           [.] process_data
     5.67%  swapper      [kernel.kallsyms]    [k] schedule
     3.45%  my_program   my_program           [.] main
```

- **Overhead** — Percentage of samples in this symbol
- **`[.]`** — Userspace symbol
- **`[k]`** — Kernel symbol
- **`[g]`** — Guest kernel (virtualization)

---

## Flame Graphs

### What Are Flame Graphs?

Flame graphs visualize stack traces from profiling data. The x-axis shows the stack profile population (not time), and the y-axis shows stack depth. Wide frames represent functions that appear frequently in stack traces.

### Generating Flame Graphs

```bash
# 1. Record with call graphs
sudo perf record -a -g -- sleep 30

# 2. Generate folded stacks
sudo perf script | stackcollapse-perf.pl > out.folded

# 3. Generate SVG
flamegraph.pl out.folded > flamegraph.svg
```

### Installing FlameGraph Tools

```bash
git clone https://github.com/brendangregg/FlameGraph
cd FlameGraph
export PATH=$PATH:$(pwd)
```

### On-CPU vs. Off-CPU Flame Graphs

```bash
# On-CPU flame graph (where time is spent on CPU)
sudo perf record -a -g -F 99 -- sleep 30
sudo perf script | stackcollapse-perf.pl | flamegraph.pl > cpu.svg

# Off-CPU flame graph (where time is spent blocking)
# Requires BCC/bpftrace
sudo offcputime -f 30 | stackcollapse.pl | flamegraph.pl --color=io > offcpu.svg
```

### Differential Flame Graphs

Compare two profiles to find regressions:

```bash
# Record baseline
sudo perf record -a -g -- sleep 30
sudo perf script | stackcollapse-perf.pl > base.folded

# Record with changes applied
sudo perf record -a -g -- sleep 30
sudo perf script | stackcollapse-perf.pl > new.folded

# Generate differential graph
difffolded.pl base.folded new.folded | flamegraph.pl > diff.svg
```

---

## Hotspot Analysis

### Finding CPU Hotspots

```bash
# Top functions by CPU time
sudo perf top

# Or from a recording
sudo perf report --stdio --sort symbol --percent-limit 1
```

### perf annotate

Disassemble and annotate with sample counts:

```bash
# Annotate a specific function
sudo perf annotate process_data

# Output shows per-instruction sample counts:
#  Percent | Source code & Disassembly
#  --------+---------------------------
#    45.2% | mov    (%rsi),%rax
#    23.1% | mov    %rax,(%rdi)
#     8.4% | add    $0x8,%rsi
```

### perf stat

Count events instead of sampling:

```bash
# Basic statistics
sudo perf stat ./my_program

# System-wide stats
sudo perf stat -a -- sleep 10

# Custom events
sudo perf stat -e cycles,instructions,cache-misses,branch-misses ./my_program

# Per-CPU stats
sudo perf stat -a -A -- sleep 10

# Detailed stats (memory, cache, etc.)
sudo perf stat -d ./my_program
```

### Interpreting perf stat Output

```
     1,234,567,890  cycles
       987,654,321  instructions  # 0.80 insn per cycle (IPC)
        12,345,678  cache-misses  # 4.5% of all cache refs
         2,345,678  branch-misses # 2.1% of all branches
       5.012345678  seconds time elapsed
```

- **IPC (Instructions Per Cycle)** — Higher is better; <1.0 suggests memory stalls
- **Cache miss rate** — High values indicate memory bottlenecks
- **Branch miss rate** — High values suggest unpredictable branches

---

## Advanced Profiling Techniques

### Sampling Frequency Tuning

```bash
# High frequency (detailed but more overhead)
sudo perf record -F 10000 -a -g -- sleep 10

# Low frequency (less overhead, coarser)
sudo perf record -F 99 -a -g -- sleep 10

# Event-based (sample every N events)
sudo perf record -c 100000 -a -g -- sleep 10
```

### Profiling Specific Events

```bash
# Memory loads/stores
sudo perf record -e cpu/mem-loads/pp -a -- sleep 10
sudo perf record -e cpu/mem-stores/pp -a -- sleep 10

# LLC (Last Level Cache) misses
sudo perf record -e LLC-load-misses -a -- sleep 10

# NUMA events
sudo perf record -e node-loads -a -- sleep 10

# Scheduler events
sudo perf record -e 'sched:sched_switch' -a -- sleep 10

# Block I/O events
sudo perf record -e 'block:block_rq_complete' -a -- sleep 10
```

### Hardware Breakpoints

```bash
# Watch a memory address for reads
sudo perf record -e mem:0x7ffc12345678:r -p <pid> -- sleep 10

# Watch for writes
sudo perf record -e mem:0x7ffc12345678:w -p <pid> -- sleep 10
```

### Intel Processor Trace (PT)

```bash
# Record with Intel PT (full execution trace)
sudo perf record -e intel_pt// -a -- sleep 5

# Decode the trace
sudo perf script --itrace=i10us --ns
```

---

## perf scripting

### Custom Analysis with perf script

```bash
# Raw output
sudo perf script

# With specific fields
sudo perf script --header --fields comm,pid,tid,cpu,time,event,ip,sym,dso

# Filter by symbol
sudo perf script --symbol-filter my_function

# Python scripting
sudo perf script -s script.py
```

### Example Python Script

```python
# perf script -s analyze.py
from __future__ import print_function
import os, sys

def process_event(param_dict):
    event = param_dict['ev_name']
    comm = param_dict['comm']
    symbol = param_dict['symbol']
    print(f"{comm}: {event} in {symbol}")

def trace_end():
    print("Processing complete")
```

---

## Continuous Profiling

### perf in Production

```bash
# Low-overhead continuous profiling
sudo perf record -a -g -F 49 --call-graph dwarf \
     -o /var/log/perf/perf-$(date +%s).data -- sleep 300

# Rotate old profiles
find /var/log/perf -name 'perf-*.data' -mtime +7 -delete
```

### Integration with Monitoring

```bash
# Prometheus + perf_exporter
# Or use Parca, Pyroscope, or Datadog Continuous Profiler

# Generate profiles for cloud analysis
sudo perf record -a -g -F 99 -- sleep 60
sudo perf script > profile.txt
# Upload to profiling service
```

---

## Kernel-Specific Profiling

### Profiling Kernel Code Only

```bash
# Kernel symbols only
sudo perf record -a -g -K -- sleep 10

# Userspace symbols only
sudo perf record -a -g -U -- sleep 10
```

### Profiling Module Code

```bash
# Profile a specific kernel module
sudo perf record -e 'module:my_module:*' -- sleep 10

# Annotate kernel module
sudo perf annotate -m my_module
```

### Profiling Interrupt Handlers

```bash
# Record IRQ events
sudo perf record -e 'irq:*' -a -- sleep 10

# Profile specific interrupt
sudo perf record -e 'irq:irq_handler_entry' -a -- sleep 10
```

---

## Tools Built on perf

| Tool          | Description                              |
|---------------|------------------------------------------|
| `perf top`    | Real-time CPU profiling                  |
| `perf stat`   | Event counting                           |
| `perf bench`  | Kernel benchmarking                      |
| `perf lock`   | Lock contention analysis                 |
| `perf sched`  | Scheduler analysis                       |
| `perf mem`    | Memory access profiling                  |
| `perf trace`  | Syscall tracing (like strace)            |
| `perf kvm`    | KVM guest profiling                      |

---

## Common Workflows

### Finding CPU Bottlenecks

```bash
# Step 1: Quick overview
sudo perf top

# Step 2: Record detailed profile
sudo perf record -a -g -F 99 -- sleep 30

# Step 3: Analyze
sudo perf report --call-graph

# Step 4: Generate flame graph
sudo perf script | stackcollapse-perf.pl | flamegraph.pl > cpu.svg
```

### Finding Memory Bottlenecks

```bash
# Cache miss analysis
sudo perf stat -d -a -- sleep 10

# Detailed memory profiling
sudo perf record -e LLC-load-misses -a -g -- sleep 10
sudo perf report
```

### Finding I/O Bottlenecks

```bash
# Block I/O profiling
sudo perf record -e 'block:*' -a -- sleep 10
sudo perf script

# Off-CPU analysis (blocking time)
# Use bpftrace or bcc tools
```

---

## Further Reading

- [perf Wiki](https://perf.wiki.kernel.org/)
- [Brendan Gregg: Linux perf tools](https://www.brendangregg.com/perf.html)
- [Brendan Gregg: Flame Graphs](https://www.brendangregg.com/flamegraphs.html)
- [perf Tutorial](https://perf.wiki.kernel.org/index.php/Tutorial)
- [kernel.org: perf_event](https://www.kernel.org/doc/html/latest/admin-guide/perf/)
- [Intel Performance Counter Monitor](https://github.com/intel/pcm)
- **Systems Performance** — Brendan Gregg

> **Related topics:** [ftrace](./ftrace.md), [eBPF Profiling](./ebpf.md), [SystemTap](./systemtap.md), [CPU Performance Counters](./pmu.md)
