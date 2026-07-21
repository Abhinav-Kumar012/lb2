# ftrace — Kernel Function Tracing

## Introduction

ftrace is the Linux kernel's built-in function tracer. Originally designed for tracing
kernel function calls, it has evolved into a comprehensive tracing framework that supports
function profiling, event tracing, interrupt latency measurement, and more. Unlike perf,
which focuses on sampling, ftrace provides detailed trace records for every event.

ftrace operates entirely within the kernel through the `tracefs` filesystem (typically
mounted at `/sys/kernel/debug/tracing` or `/sys/kernel/tracing`). It requires no
external tools for basic use — just `echo` and `cat` — though `trace-cmd` provides a
much more convenient interface.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Space                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  trace-cmd   │  │  KernelShark │  │  cat/echo        │  │
│  │  (frontend)  │  │  (GUI)       │  │  (direct access) │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘  │
└─────────┼─────────────────┼─────────────────┼───────────────┘
          │                 │                 │
   ┌──────▼─────────────────▼─────────────────▼───────────────┐
   │                    tracefs filesystem                      │
   │              /sys/kernel/tracing/                          │
   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
   │  │ current_tracer│ │ set_event   │  │ trace_marker    │  │
   │  │ trace        │ │ per_cpu/cpu0│  │ trace_pipe      │  │
   │  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
   └─────────┼────────────────┼──────────────────┼────────────┘
             │                │                  │
   ┌─────────▼────────────────▼──────────────────▼────────────┐
   │                   Tracing Infrastructure                   │
   │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
   │  │ Function     │  │ Event        │  │ Trace          │ │
   │  │ Tracer       │  │ Tracing      │  │ Output         │ │
   │  │              │  │ (tracepoints)│  │ (ring buffer)  │ │
   │  └──────────────┘  └──────────────┘  └────────────────┘ │
   │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
   │  │ kprobes       │  │ Histograms  │  │ Trace          │ │
   │  │ (dynamic)     │  │ (hist)      │  │ Instances      │ │
   │  └──────────────┘  └──────────────┘  └────────────────┘ │
   └─────────────────────────────────────────────────────────┘
```

## tracefs Filesystem

The tracefs filesystem is the primary interface to ftrace. Understanding its structure
is essential.

```bash
# Mount tracefs (usually auto-mounted)
sudo mount -t tracefs tracefs /sys/kernel/tracing

# Or check if it's already mounted
mount | grep tracefs
# tracefs on /sys/kernel/tracing type tracefs (rw,relatime)
# tracefs on /sys/kernel/debug/tracing type tracefs (rw,relatime)

# List key files
ls /sys/kernel/tracing/
```

### Key Files

| File | Purpose |
|------|---------|
| `current_tracer` | Read/set the active tracer |
| `trace` | Read the trace buffer |
| `trace_pipe` | Read and consume trace events (blocking) |
| `tracing_on` | Enable/disable tracing (1/0) |
| `buffer_size_kb` | Per-CPU ring buffer size |
| `set_event` | Enable/disable specific events |
| `trace_marker` | Write user messages into the trace |
| `available_tracers` | List available tracers |
| `available_filter_functions` | List traceable functions |
| `set_ftrace_filter` | Filter which functions to trace |
| `set_ftrace_pid` | Trace only specific PIDs |

## Function Tracer

The function tracer records every kernel function call. It's the original ftrace feature.

### Basic Function Tracing

```bash
# Check available tracers
cat /sys/kernel/tracing/available_tracers
# nop function function_graph wakeup wakeup_rt preemptirqsoff

# Enable function tracer
echo function > /sys/kernel/tracing/current_tracer

# Start tracing
echo 1 > /sys/kernel/tracing/tracing_on

# Let it run for a bit, then read the trace
cat /sys/kernel/tracing/trace | head -50

# Stop tracing
echo 0 > /sys/kernel/tracing/tracing_on
```

### Example Output

```
# tracer: function
#
#                              _-----=> irqs-off
#                             / _----=> need-resched
#                            | / _---=> hardirq/softirq
#                            || / _--=> preempt-depth
#                            ||| /     delay
#           TASK-PID   CPU#  ||||    TIMESTAMP  FUNCTION
#              | |       |   ||||       |         |
          <idle>-0     [000] d..1    45.123456: _raw_spin_lock_irqsave <-hrtimer_interrupt
          <idle>-0     [000] d..1    45.123457: ktime_get_update_offsets_now <-hrtimer_interrupt
          <idle>-0     [000] d..1    45.123458: __hrtimer_run_queues <-hrtimer_interrupt
          <idle>-0     [000] d..1    45.123459: _raw_spin_unlock_irqrestore <-hrtimer_interrupt
          <idle>-0     [000] ..s1    45.123460: tick_sched_timer <-__hrtimer_run_queues
          <idle>-0     [000] ..s1    45.123461: tick_do_update_jiffies64 <-tick_sched_timer
```

The flags column shows:
- `d` — interrupts disabled
- `.` — irqs enabled
- `s` — in softirq
- `h` — in hardirq
- `N` — need resched
- `.` — no preempt

### Filtering Functions

```bash
# Trace only specific functions
echo do_sys_open > /sys/kernel/tracing/set_ftrace_filter
echo function > /sys/kernel/tracing/current_tracer
echo 1 > /sys/kernel/tracing/tracing_on

# Trace multiple functions
echo "do_sys_open do_sys_openat2" > /sys/kernel/tracing/set_ftrace_filter

# Use wildcards
echo "sched_*" > /sys/kernel/tracing/set_ftrace_filter

# Exclude functions
echo "schedule" > /sys/kernel/tracing/set_ftrace_notrace

# List functions matching a pattern
cat /sys/kernel/tracing/available_filter_functions | grep "sched_"

# Clear filters
echo > /sys/kernel/tracing/set_ftrace_filter
echo > /sys/kernel/tracing/set_ftrace_notrace
```

### Per-PID Tracing

```bash
# Trace only a specific process
echo 1234 > /sys/kernel/tracing/set_ftrace_pid

# Trace current shell and children
echo $$ > /sys/kernel/tracing/set_ftrace_pid

# Disable PID filtering (trace everything)
echo > /sys/kernel/tracing/set_ftrace_pid
```

## Function Graph Tracer

The function_graph tracer shows function call hierarchies with timing information,
similar to a call graph profiler. It's one of the most useful ftrace tracers.

### Basic Usage

```bash
echo function_graph > /sys/kernel/tracing/current_tracer
echo 1 > /sys/kernel/tracing/tracing_on
# ... do something ...
echo 0 > /sys/kernel/tracing/tracing_on
cat /sys/kernel/tracing/trace
```

### Example Output

```
# tracer: function_graph
#
# CPU  DURATION                  FUNCTION CALLS
# |     |   |                     |   |   |   |
 0)               |  do_sys_open() {
 0)   0.523 us    |    getname();
 0)               |    do_filp_open() {
 0)   0.157 us    |      path_init();
 0)               |      link_path_walk() {
 0)   0.089 us    |        walk_component();
 0)   0.076 us    |        walk_component();
 0)   1.234 us    |      }
 0)   0.098 us    |      do_open();
 0)   2.891 us    |    }
 0)   0.087 us    |    putname();
 0)   4.567 us    |  }
```

Reading the output:
- `+` — function is being entered (continued on next line)
- `}` — function returned
- Duration is shown in microseconds (us) or milliseconds (ms)
- Indentation shows call depth
- `/* comment */` markers indicate special events within a function

### Configuring Function Graph

```bash
# Set max depth of call graph
echo 5 > /sys/kernel/tracing/max_graph_depth

# Filter by function
echo do_sys_open > /sys/kernel/tracing/set_graph_function

# Clear filter
echo > /sys/kernel/tracing/set_graph_function

# Show overhead (time not accounted for by children)
echo 1 > /sys/kernel/tracing/options/funcgraph-overhead

# Show function return address
echo 1 > /sys/kernel/tracing/options/funcgraph-proc

# Show CPU info
echo 1 > /sys/kernel/tracing/options/funcgraph-cpu

# Show absolute time instead of relative
echo 1 > /sys/kernel/tracing/options/funcgraph-abstime
```

## Event Tracing

Event tracing uses static tracepoints (pre-defined in the kernel source) to trace
specific events like scheduler activity, I/O operations, and more.

### Available Events

```bash
# List all available events
ls /sys/kernel/tracing/events/

# Events are organized by subsystem:
#   block/    - Block I/O events
#   ext4/     - ext4 filesystem events
#   irq/      - Interrupt events
#   kmem/     - Kernel memory events
#   net/      - Network events
#   sched/    - Scheduler events
#   signal/   - Signal events
#   syscalls/ - System call events
#   task/     - Task events

# List events in a subsystem
ls /sys/kernel/tracing/events/sched/

# Read event format
cat /sys/kernel/tracing/events/sched/sched_switch/format
# name: sched_switch
# ID: 283
# format:
#   field:unsigned short common_type;
#   field:unsigned char common_flags;
#   field:unsigned char common_preempt_count;
#   field:int common_pid;
#   field:char prev_comm[16];
#   field:pid_t prev_pid;
#   field:int prev_prio;
#   field:long prev_state;
#   field:char next_comm[16];
#   field:pid_t next_pid;
#   field:int next_prio;
```

### Enabling Events

```bash
# Enable a specific event
echo 1 > /sys/kernel/tracing/events/sched/sched_switch/enable

# Enable all events in a subsystem
echo 1 > /sys/kernel/tracing/events/sched/enable

# Enable all events (very noisy!)
echo 1 > /sys/kernel/tracing/events/enable

# Disable specific event
echo 0 > /sys/kernel/tracing/events/sched/sched_switch/enable

# Disable all events
echo 0 > /sys/kernel/tracing/events/enable

# Use set_event interface
echo "sched_switch sched_wakeup" > /sys/kernel/tracing/set_event
```

### Example: Tracing Scheduler Events

```bash
echo "sched_switch sched_wakeup" > /sys/kernel/tracing/set_event
echo 1 > /sys/kernel/tracing/tracing_on
sleep 1
echo 0 > /sys/kernel/tracing/tracing_on
cat /sys/kernel/tracing/trace
```

```
# tracer: nop
#
#                                TASK-PID   CPU#     TIMESTAMP  COMM            FUNCTION
#                                   | |       |        |         |                |
              cat-12345 [002]  1234.567890: sched_switch: prev_comm=cat prev_pid=12345 prev_prio=120 prev_state=S ==> next_comm=bash next_pid=1234 next_prio=120
            bash-1234  [002]  1234.567891: sched_wakeup: comm=cat pid=12345 prio=120 target_cpu=002
          <idle>-0     [000]  1234.567892: sched_switch: prev_comm=swapper/0 prev_pid=0 prev_prio=120 prev_state=R ==> next_comm=kworker/0:1 next_pid=15 prio=120
```

### Event Filtering

```bash
# Filter events by field values
echo "prev_pid == 1234" > /sys/kernel/tracing/events/sched/sched_switch/filter

# Complex filters
echo "prev_pid == 1234 || next_pid == 1234" > /sys/kernel/tracing/events/sched/sched_switch/filter

# String filter
echo 'prev_comm == "bash"' > /sys/kernel/tracing/events/sched/sched_switch/filter

# Clear filter
echo 0 > /sys/kernel/tracing/events/sched/sched_switch/filter
```

## kprobes — Dynamic Tracing

kprobes allow you to dynamically insert tracepoints at almost any kernel function
address. They are the foundation for dynamic kernel tracing.

### Types of Probes

```
┌─────────────────────────────────────────────┐
│ Kernel Function: do_sys_open()               │
│                                             │
│ Entry:  ┌──────────┐                        │
│         │ kprobe    │ ← triggered on entry   │
│         └──────────┘                        │
│         ... function body ...                │
│ Return: ┌──────────┐                        │
│         │ kretprobe │ ← triggered on return  │
│         └──────────┘                        │
└─────────────────────────────────────────────┘
```

### Using kprobes with tracefs

```bash
# Add a kprobe at do_sys_open
echo 'p:myprobe do_sys_open filename=+0(%si):string flags=%dx' > /sys/kernel/tracing/kprobe_events

# Enable the probe
echo 1 > /sys/kernel/tracing/events/kprobes/myprobe/enable

# Read trace
cat /sys/kernel/tracing/trace_pipe

# Add a kretprobe (return probe)
echo 'r:myretprobe do_sys_open ret=$retval' > /sys/kernel/tracing/kprobe_events

# Enable
echo 1 > /sys/kernel/tracing/events/kprobes/myretprobe/enable

# List all kprobes
cat /sys/kernel/tracing/kprobe_events

# Remove a probe
echo '-:myprobe' >> /sys/kernel/tracing/kprobe_events
echo '-:myretprobe' >> /sys/kernel/tracing/kprobe_events
```

### kprobe Argument Syntax

```bash
# Register arguments (x86-64 ABI)
# %di, %si, %dx, %cx, %r8, %r9  (first 6 args)
# %ax (return value)

# Fetch a string argument
echo 'p:myprobe do_sys_open filename=+0(%si):string' > /sys/kernel/tracing/kprobe_events

# Fetch an integer argument
echo 'p:myprobe do_sys_open flags=%dx' > /sys/kernel/tracing/kprobe_events

# Fetch memory at address
echo 'p:myprobe do_sys_open filename=+0(%si):string flags=%dx:x32' > /sys/kernel/tracing/kprobe_events

# Fetch stack pointer
echo 'p:myprobe do_sys_open stack=%bp:x64' > /sys/kernel/tracing/kprobe_events
```

## Trace-cmd — User-Friendly Frontend

`trace-cmd` is a command-line tool that wraps ftrace, providing a much more convenient
interface.

### Installation

```bash
# Debian/Ubuntu
sudo apt install trace-cmd

# RHEL/Fedora
sudo dnf install trace-cmd

# Arch
sudo pacman -S trace-cmd
```

### Basic Usage

```bash
# Record a trace
sudo trace-cmd record -e sched_switch -e sched_wakeup sleep 1

# Read the trace
trace-cmd report | head -50

# Record function graph
sudo trace-cmd record -p function_graph -g do_sys_open sleep 1
trace-cmd report

# Record function tracer
sudo trace-cmd record -p function -l "sched_*" sleep 1
trace-cmd report

# Record with specific events
sudo trace-cmd record -e block:block_rq_issue -e block:block_rq_complete dd if=/dev/zero of=/tmp/test bs=1M count=100

# Record all scheduler events
sudo trace-cmd record -e sched sleep 5
trace-cmd report | head -100
```

### trace-cmd Example Session

```bash
$ sudo trace-cmd record -p function_graph -g do_sys_openat2 cat /dev/null
  Plugin 'function_graph'
  Hit Ctrl^C to stop recording

$ trace-cmd report | head -30
# CPU  DURATION                  FUNCTION CALLS
# |     |   |                     |   |   |   |
 1)               |  do_sys_openat2() {
 1)   0.452 us    |    getname();
 1)               |    do_filp_open() {
 1)   0.123 us    |      path_init();
 1)               |      link_path_walk() {
 1)   0.067 us    |        walk_component();
 1)   0.789 us    |      }
 1)   0.089 us    |      do_open();
 1)   2.123 us    |    }
 1)   0.078 us    |    putname();
 1)   3.456 us    |  }
```

### trace-cmd Stream (Live Tracing)

```bash
# Stream events in real-time
sudo trace-cmd stream -e sched_switch

# Stream with function graph
sudo trace-cmd stream -p function_graph -g do_sys_open

# Stream to file
sudo trace-cmd stream -e sched_switch > trace_output.txt
```

### trace-cmd Profile

```bash
# Profile function calls
sudo trace-cmd profile -p function -l "sched_*" sleep 5
trace-cmd report --profile

# Output:
#  Function                               Hit      Time        Avg         s^2
#  --------                               ---      ----        ---         ---
#  schedule                               5234    12.345ms     2.358us     1.234us
#  schedule_timeout                        123     1.234ms     10.032us    5.678us
#  __schedule                              5234    11.111ms     2.123us     0.987us
```

## Histograms (hist triggers)

ftrace histograms allow you to build in-kernel histograms of events without
exporting individual trace records.

### Basic Histogram

```bash
# Create a histogram of sched_switch events by next_comm
echo 'hist:key=next_comm:val=hitcount:sort=hitcount.desc' > \
    /sys/kernel/tracing/events/sched/sched_switch/trigger

# Enable the event
echo 1 > /sys/kernel/tracing/events/sched/sched_switch/enable

# Wait for data collection
sleep 5

# Read the histogram
cat /sys/kernel/tracing/events/sched/sched_switch/hist

# Output:
# { next_comm: bash                          } hitcount:        234
# { next_comm: kworker/0:1                   } hitcount:        156
# { next_comm: cat                           } hitcount:         89
# { next_comm: swapper/0                     } hitcount:         45
# Totals:
#   Hits: 524
#   Entries: 4
#   Dropped: 0

# Remove the trigger
echo '!hist:key=next_comm:val=hitcount:sort=hitcount.desc' > \
    /sys/kernel/tracing/events/sched/sched_switch/trigger
```

### Advanced Histograms

```bash
# Histogram with multiple keys
echo 'hist:key=next_comm,next_pid:val=hitcount' > \
    /sys/kernel/tracing/events/sched/sched_switch/trigger

# Histogram with latency measurement
echo 'hist:key=next_comm:val=lat:lat=hitcount' > \
    /sys/kernel/tracing/events/sched/sched_wakeup/trigger

# Histogram with buckets (log2)
echo 'hist:key=bytes_req:val=hitcount:buckets=8' > \
    /sys/kernel/tracing/events/kmem/kmalloc/trigger

# Conditional histogram
echo 'hist:key=next_comm:val=hitcount:if prev_pid==1234' > \
    /sys/kernel/tracing/events/sched/sched_switch/trigger

# Histogram with timestamps
echo 'hist:key=next_comm:val=ts0:ts0=common_timestamp.usecs' > \
    /sys/kernel/tracing/events/sched/sched_switch/trigger
```

## trace_marker — User-Space Annotations

`trace_marker` allows user-space programs to write messages into the kernel trace
buffer, enabling correlation of user events with kernel activity.

```bash
# Write a marker
echo "Starting computation" > /sys/kernel/tracing/trace_marker

# In a program:
# fd = open("/sys/kernel/tracing/trace_marker", O_WRONLY);
# write(fd, "checkpoint: data loaded\n", 24);
```

### Example: Correlating User and Kernel Events

```bash
# Enable scheduler events
echo 1 > /sys/kernel/tracing/events/sched/sched_switch/enable
echo function_graph > /sys/kernel/tracing/current_tracer
echo 1 > /sys/kernel/tracing/tracing_on

# Write markers from user space
echo "=== START ===" > /sys/kernel/tracing/trace_marker
./myprogram
echo "=== END ===" > /sys/kernel/tracing/trace_marker

echo 0 > /sys/kernel/tracing/tracing_on
cat /sys/kernel/tracing/trace | grep -A5 -B5 "START\|END"
```

## Trace Instances

Trace instances create separate trace buffers, allowing independent tracing
of different subsystems.

```bash
# Create an instance
sudo mkdir /sys/kernel/tracing/instances/myinstance

# Configure the instance
echo function_graph > /sys/kernel/tracing/instances/myinstance/current_tracer
echo sched_switch > /sys/kernel/tracing/instances/myinstance/set_event
echo 1 > /sys/kernel/tracing/instances/myinstance/tracing_on

# Read the instance trace
cat /sys/kernel/tracing/instances/myinstance/trace

# Remove the instance
sudo rmdir /sys/kernel/tracing/instances/myinstance
```

## KernelShark — GUI Visualization

KernelShark is a graphical front-end for ftrace traces.

```bash
# Install
sudo apt install kernelshark

# Record a trace
sudo trace-cmd record -e sched -e block sleep 5

# Open in KernelShark
kernelshark trace.dat
```

KernelShark provides:
- Timeline view of all CPUs
- Per-task timelines
- Event filtering
- Function graph visualization
- Latency markers
- Search and bookmarks

## Ftrace Tracers Reference

| Tracer | Description |
|--------|-------------|
| `nop` | No tracing (default) |
| `function` | Trace kernel function calls |
| `function_graph` | Hierarchical function call graph with timing |
| `wakeup` | Trace task wakeup latency (max) |
| `wakeup_rt` | Trace RT task wakeup latency |
| `preemptoff` | Trace preemption disabled regions |
| `irqsoff` | Trace interrupts disabled regions |
| `preemptirqsoff` | Combine preemptoff and irqsoff |
| `blk` | Block I/O tracing |
| `mmiotrace` | Memory-mapped I/O tracing |
| `hwlat` | Hardware latency detection |

## Best Practices

1. **Use `trace-cmd` instead of raw tracefs** — it handles setup/teardown cleanly
2. **Use instances for parallel traces** — isolate different trace targets
3. **Use histograms for statistics** — avoid flooding the trace buffer with individual events
4. **Filter aggressively** — ftrace can generate massive amounts of data
5. **Use function_graph for timing** — function tracer only shows call frequency
6. **Use trace_marker for correlation** — correlate user-space actions with kernel events
7. **Save traces with `trace-cmd record`** — for later analysis and sharing
8. **Use KernelShark for visualization** — timelines are easier to read than text

## References

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- [ftrace Documentation](https://www.kernel.org/doc/html/latest/trace/ftrace.html)
- [trace-cmd man page](https://man7.org/linux/man-pages/man1/trace-cmd.1.html)
- [KernelShark](https://kernelshark.org/)
- [Steven Rostedt's ftrace tutorial](https://lwn.net/Articles/370423/)
- [Brendan Gregg's ftrace page](https://www.brendangregg.com/blog/2014-07-01/perf-ftrace.html)

## Related Topics

- [eBPF](./ebpf.md) — Programmable tracing with BPF
- [perf](./perf.md) — Sampling-based profiling
- [Kernel Debugging](./kernel-debugging.md) — KGDB, KDB, crash
- [GDB](./gdb.md) — Source-level debugging
