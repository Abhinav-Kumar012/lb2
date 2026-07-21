# eBPF — Extended Berkeley Packet Filter

## Introduction

eBPF (extended Berkeley Packet Filter) is a revolutionary technology in the Linux kernel
that allows safe, efficient, and programmable execution of code within the kernel space
without modifying the kernel source or loading kernel modules. Originally designed for
packet filtering, eBPF has evolved into a general-purpose execution engine that powers
networking, security, tracing, and observability tools.

eBPF programs are compiled into a special bytecode, verified by the kernel's eBPF
verifier for safety, and JIT-compiled to native machine code for performance. This
makes eBPF both safe (no kernel crashes from buggy programs) and fast (near-native
execution speed).

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        User Space                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │   bcc tools  │  │   bpftrace   │  │ Custom BPF programs│  │
│  │ (Python API) │  │ (DSL)        │  │ (C + libbpf)       │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬─────────────┘  │
└─────────┼─────────────────┼─────────────────┼─────────────────┘
          │                 │                 │
   ┌──────▼─────────────────▼─────────────────▼─────────────────┐
   │                    bpf() System Call                         │
   │              (load, attach, interact)                        │
   └──────────────────────────┬──────────────────────────────────┘
                              │
   ┌──────────────────────────▼──────────────────────────────────┐
   │                     Kernel Space                             │
   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
   │  │  eBPF        │  │  eBPF        │  │  eBPF Maps       │ │
   │  │  Verifier    │  │  JIT Compiler│  │  (key-value store)│ │
   │  │              │  │              │  │                  │ │
   │  └──────────────┘  └──────────────┘  └──────────────────┘ │
   │                                                             │
   │  ┌──────────────────────────────────────────────────────┐  │
   │  │              Attachment Points                         │  │
   │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │  │
   │  │  │kprobes   │ │tracepoints│ │XDP       │ │tc        │ │  │
   │  │  │uprobes   │ │perf events│ │socket    │ │cgroup    │ │  │
   │  │  └──────────┘ └──────────┘ └──────────┘ └─────────┘  │  │
   │  └──────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────┘
```

## BPF Programs

### Program Types

eBPF programs are attached to different hooks in the kernel. The program type
determines what the program can do and where it can be attached:

| Program Type | Attachment Point | Use Case |
|-------------|-----------------|----------|
| `BPF_PROG_TYPE_XDP` | Network driver | High-performance packet processing |
| `BPF_PROG_TYPE_SCHED_CLS` | Traffic control | Packet classification |
| `BPF_PROG_TYPE_KPROBE` | Kernel functions | Kernel tracing |
| `BPF_PROG_TYPE_TRACEPOINT` | Tracepoints | Event tracing |
| `BPF_PROG_TYPE_PERF_EVENT` | Perf events | Performance monitoring |
| `BPF_PROG_TYPE_SOCKET_FILTER` | Sockets | Packet filtering |
| `BPF_PROG_TYPE_CGROUP_SKB` | Cgroups | Container networking |
| `BPF_PROG_TYPE_LSM` | Linux Security Module | Security policies |
| `BPF_PROG_TYPE_SYSCALL` | System calls | Syscall filtering |

### Writing BPF Programs

BPF programs are written in C (restricted subset) and compiled to BPF bytecode:

```c
// simple_tracepoint.c — Trace sys_enter_openat
#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>

// BPF map to store event counts
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, __u64);
} event_count SEC(".maps");

SEC("tracepoint/syscalls/sys_enter_openat")
int trace_openat(struct trace_event_raw_sys_enter *ctx) {
    __u32 key = 0;
    __u64 *value;

    value = bpf_map_lookup_elem(&event_count, &key);
    if (value)
        __sync_fetch_and_add(value, 1);

    return 0;
}

char LICENSE[] SEC("license") = "GPL";
```

Compile and load:
```bash
# Compile BPF program
clang -O2 -target bpf -g -c simple_tracepoint.c -o simple_tracepoint.o

# Load using bpftool
sudo bpftool prog load simple_tracepoint.o /sys/fs/bpf/simple_tracepoint

# Or use libbpf-based loader
```

### BPF Verifier

The eBPF verifier ensures program safety before loading:

```
┌──────────────────────────────────────────────┐
│              BPF Verifier                     │
│                                              │
│  1. Control flow analysis                    │
│     - No unreachable code                    │
│     - No infinite loops                      │
│     - All paths terminate                    │
│                                              │
│  2. Memory safety                            │
│     - All memory accesses are bounds-checked │
│     - No out-of-bounds reads/writes          │
│     - Stack depth ≤ 512 bytes                │
│                                              │
│  3. Type safety                              │
│     - Pointer types verified                 │
│     - No unsafe casts                        │
│     - Map access validated                   │
│                                              │
│  4. Program limits                           │
│     - Max 1M instructions (complexity)       │
│     - Max 512 bytes stack                    │
│     - Max 64 nested calls                    │
└──────────────────────────────────────────────┘
```

## BPF Maps

Maps are the primary data structure for BPF programs. They are key-value stores
accessible from both BPF programs and user space.

### Map Types

| Type | Description | Use Case |
|------|-------------|----------|
| `BPF_MAP_TYPE_HASH` | Hash table | General key-value lookup |
| `BPF_MAP_TYPE_ARRAY` | Fixed-size array | Index-based access |
| `BPF_MAP_TYPE_PERCPU_HASH` | Per-CPU hash table | Lock-free counters |
| `BPF_MAP_TYPE_PERCPU_ARRAY` | Per-CPU array | Per-CPU statistics |
| `BPF_MAP_TYPE_LRU_HASH` | LRU hash table | Bounded-size cache |
| `BPF_MAP_TYPE_RINGBUF` | Ring buffer | High-throughput event streaming |
| `BPF_MAP_TYPE_STACK_TRACE` | Stack traces | Profiling |
| `BPF_MAP_TYPE_PROG_ARRAY` | BPF programs | Tail calls |
| `BPF_MAP_TYPE_HASH_OF_MAPS` | Map of maps | Nested data structures |

### Map Operations

```c
// Define a map
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u32);           // PID
    __type(value, __u64);         // count
} pid_count SEC(".maps");

// Lookup
__u64 *val = bpf_map_lookup_elem(&pid_count, &pid);
if (val) {
    __sync_fetch_and_add(val, 1);
} else {
    __u64 init = 1;
    bpf_map_update_elem(&pid_count, &pid, &init, BPF_ANY);
}

// Delete
bpf_map_delete_elem(&pid_count, &pid);

// Iterate (from user space)
__u32 key, next_key;
while (bpf_map_get_next_key(fd, &key, &next_key) == 0) {
    // process next_key
    key = next_key;
}
```

### Ring Buffer (Preferred for Events)

```c
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);  // 256KB
} events SEC(".maps");

struct event {
    __u32 pid;
    char comm[16];
    char filename[256];
};

SEC("tracepoint/syscalls/sys_enter_openat")
int trace_openat(struct trace_event_raw_sys_enter *ctx) {
    struct event *e;

    // Reserve space in ring buffer
    e = bpf_ringbuf_reserve(&events, sizeof(struct event), 0);
    if (!e)
        return 0;

    // Fill event data
    e->pid = bpf_get_current_pid_tgid() >> 32;
    bpf_get_current_comm(&e->comm, sizeof(e->comm));
    bpf_probe_read_user_str(&e->filename, sizeof(e->filename),
                            (void *)ctx->args[1]);

    // Submit to user space
    bpf_ringbuf_submit(e, 0);
    return 0;
}
```

## BCC — BPF Compiler Collection

BCC provides a Python (and Lua) frontend for writing BPF programs. It compiles
BPF C code on the fly and provides convenient APIs.

### Installation

```bash
# Ubuntu/Debian
sudo apt install bpfcc-tools python3-bpfcc

# RHEL/Fedora
sudo dnf install bcc-tools bcc

# From source
git clone https://github.com/iovisor/bcc.git
mkdir bcc/build; cd bcc/build
cmake ..
make && sudo make install
```

### BCC Python Example

```python
#!/usr/bin/env python3
# opensnoop.py — Trace open() syscalls
from bcc import BPF

# BPF program
bpf_text = """
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

struct data_t {
    u32 pid;
    u64 ts;
    char comm[TASK_COMM_LEN];
    char fname[256];
};

BPF_PERF_OUTPUT(events);

TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    struct data_t data = {};

    data.pid = bpf_get_current_pid_tgid() >> 32;
    data.ts = bpf_ktime_get_ns();
    bpf_get_current_comm(&data.comm, sizeof(data.comm));
    bpf_probe_read_user_str(&data.fname, sizeof(data.fname),
                            args->filename);

    events.perf_submit(args, &data, sizeof(data));
    return 0;
}
"""

# Load BPF program
b = BPF(text=bpf_text)

# Process events
def print_event(cpu, data, size):
    event = b["events"].event(data)
    print(f"{event.comm.decode():16s} {event.pid:6d} {event.fname.decode()}")

b["events"].open_perf_buffer(print_event)

print(f"{'COMM':16s} {'PID':>6s} FILENAME")
while True:
    b.perf_buffer_poll()
```

### BCC Tools

BCC ships with dozens of ready-to-use tools:

```bash
# List all BCC tools
ls /usr/share/bcc/tools/

# Tracing tools
sudo opensnoop              # Trace open() syscalls
sudo execsnoop              # Trace new processes
sudo biolatency             # Block I/O latency histogram
sudo cachestat              # Page cache hit/miss stats
sudo tcpconnect             # Trace TCP connections
sudo tcplife                # Trace TCP sessions with duration
sudo profile                # CPU profiling (sampling)
sudo funccount              # Count kernel function calls
sudo funclatency            # Function latency histogram
sudo trace                  # Trace arbitrary kernel functions
sudo argdist               # Distribution of function arguments
sudo drsnoop               # Trace direct reclaim events
sudo oomkill               # Trace OOM kills
sudo memleak               # Detect memory leaks
sudo hardirqs              # Hard interrupt time
sudo softirqs              # Soft interrupt time
sudo runqlat               # Run queue latency
sudo cpudist               # On-CPU time distribution
```

### Example: Using BCC Tools

```bash
# Trace all open() calls
$ sudo opensnoop
PID    COMM               FD ERR PATH
1234   bash                3   0 /etc/passwd
5678   cat                 3   0 /etc/hostname

# Block I/O latency histogram
$ sudo biolatency -D
Tracing block device I/O... Hit Ctrl-C to end.

disk = sda
     usecs          : count    distribution
         0 -> 1     : 0       |                                      |
         2 -> 3     : 0       |                                      |
         4 -> 7     : 3       |*                                     |
         8 -> 15    : 12      |*****                                 |
        16 -> 31    : 45      |********************                  |
        32 -> 63    : 89      |****************************************|
        64 -> 127   : 34      |***************                       |
       128 -> 255   : 8       |***                                   |
       256 -> 511   : 2       |*                                     |

# CPU profiling
$ sudo profile -F 99
Sampling at 99 Hertz of all threads by user + kernel stack... Hit Ctrl-C to end.

    compute_matrix
    main
    __libc_start_main
    [unknown]
    -                myprogram
        45

    memcpy_avx_unaligned_erms
    compute_matrix
    main
    __libc_start_main
    -                myprogram
        30
```

## bpftrace — High-Level Tracing Language

bpftrace provides a DTrace-like language for writing eBPF programs concisely.

### Installation

```bash
# Ubuntu/Debian
sudo apt install bpftrace

# RHEL/Fedora
sudo dnf install bpftrace

# Arch
sudo pacman -S bpftrace
```

### One-Liners

```bash
# Trace open() syscalls
bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%s %s\n", comm, str(args->filename)); }'

# Count syscalls by process
bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'

# Histogram of read() bytes
bpftrace -e 'tracepoint:syscalls:sys_exit_read /args->ret > 0/ { @bytes = hist(args->ret); }'

# Trace process creation
bpftrace -e 'tracepoint:sched:sched_process_exec { printf("exec: %s (pid=%d)\n", comm, pid); }'

# Count function calls
bpftrace -e 'kprobe:do_sys_open { @[comm] = count(); }'

# Trace disk I/O latency
bpftrace -e 'tracepoint:block:block_rq_issue { @start[args->dev] = nsecs; } tracepoint:block:block_rq_complete /@start[args->dev]/ { @usecs = hist((nsecs - @start[args->dev]) / 1000); delete(@start[args->dev]); }'

# Trace TCP connections
bpftrace -e 'kprobe:tcp_connect { printf("connect: %s -> %d\n", comm, ((struct sock *)arg0)->__sk_common.skc_dport); }'

# Profile CPU stack traces
bpftrace -e 'profile:hz:99 { @[kstack] = count(); }'
```

### bpftrace Programs

```bt
#!/usr/bin/env bpftrace
// latency.bt — Measure syscall latency

tracepoint:raw_syscalls:sys_enter {
    @start[tid] = nsecs;
}

tracepoint:raw_syscalls:sys_exit /@start[tid]/ {
    $latency = (nsecs - @start[tid]) / 1000;
    @us = hist($latency);
    @total_us = sum($latency);
    @count = count();
    delete(@start[tid]);
}

END {
    printf("\nTotal syscalls: ");
    print(@count);
    printf("\nTotal latency (us): ");
    print(@total_us);
    printf("\nLatency histogram (us):\n");
    print(@us);
}
```

```bash
chmod +x latency.bt
sudo ./latency.bt
```

### bpftrace Language Reference

```
Probe types:
  kprobe:function          — Kernel function entry
  kretprobe:function       — Kernel function return
  uprobe:path:function     — User function entry
  uretprobe:path:function  — User function return
  tracepoint:category:name — Kernel tracepoint
  profile:hz:99            — Timed sampling
  interval:s:1             — Periodic output
  software:event:count     — Software events
  hardware:event:count     — Hardware events

Built-in variables:
  pid, tid                 — Process/thread ID
  comm                     — Process name
  nsecs                    — Nanosecond timestamp
  kstack, ustack           — Kernel/user stack trace
  arg0-arg9                — Function arguments
  retval                   — Return value
  ctx                      — Raw context

Map functions:
  @name = count()          — Count events
  @name = sum(x)           — Sum values
  @name = hist(x)          — Histogram
  @name = lhist(x,min,max,step) — Linear histogram
  @name = min(x)           — Minimum
  @name = max(x)           — Maximum
  @name = avg(x)           — Average
  @name = stats(x)         — Statistics (count, avg, total)
```

## XDP — eXpress Data Path

XDP is the lowest-level programmable hook in the Linux networking stack. It processes
packets before the kernel allocates an `sk_buff`, enabling line-rate packet processing.

### XDP Architecture

```
┌────────────────────────────────────────────────┐
│                 Network Stack                    │
│                                                 │
│  ┌──────────┐                                   │
│  │   XDP    │ ← Earliest hook point             │
│  │  Program │   (before sk_buff allocation)     │
│  └────┬─────┘                                   │
│       │ Actions:                                │
│       │  XDP_PASS    → continue to stack        │
│       │  XDP_DROP    → drop packet              │
│       │  XDP_TX      → bounce back on same NIC  │
│       │  XDP_REDIRECT→ redirect to another NIC  │
│       │  XDP_ABORTED → error (drop + trace)     │
│       ▼                                         │
│  ┌──────────┐                                   │
│  │ sk_buff  │ ← Normal kernel networking        │
│  │ allocation│                                   │
│  └──────────┘                                   │
└────────────────────────────────────────────────┘
```

### XDP Program Example

```c
// xdp_drop.c — Drop packets from specific IP
#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <arpa/inet.h>

SEC("xdp")
int xdp_drop_prog(struct xdp_md *ctx) {
    void *data = (void *)(long)ctx->data;
    void *data_end = (void *)(long)ctx->data_end;

    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end)
        return XDP_PASS;

    if (eth->h_proto != htons(ETH_P_IP))
        return XDP_PASS;

    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end)
        return XDP_PASS;

    // Drop packets from 10.0.0.1
    if (ip->saddr == htonl(0x0A000001))
        return XDP_DROP;

    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
```

```bash
# Compile
clang -O2 -target bpf -g -c xdp_drop.c -o xdp_drop.o

# Load on interface
sudo ip link set dev eth0 xdp obj xdp_drop.o sec xdp

# Or using bpftool
sudo bpftool net attach xdp id 123 dev eth0

# Remove
sudo ip link set dev eth0 xdp off
```

## Tracepoints and kprobes with BPF

### Tracepoint Programs

```c
// tracepoint_example.c
#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>

struct event {
    __u32 pid;
    char comm[16];
    char filename[256];
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");

SEC("tracepoint/syscalls/sys_enter_openat")
int handle_openat(struct trace_event_raw_sys_enter *ctx) {
    struct event *e;

    e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (!e)
        return 0;

    e->pid = bpf_get_current_pid_tgid() >> 32;
    bpf_get_current_comm(e->comm, sizeof(e->comm));

    const char *filename = (const char *)ctx->args[1];
    bpf_probe_read_user_str(e->filename, sizeof(e->filename), filename);

    bpf_ringbuf_submit(e, 0);
    return 0;
}
```

### kprobe Programs

```c
// kprobe_example.c
#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u32);
    __type(value, __u64);
} start SEC(".maps");

SEC("kprobe/do_sys_openat2")
int BPF_KPROBE(do_sys_openat2) {
    u64 ts = bpf_ktime_get_ns();
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    bpf_map_update_elem(&start, &pid, &ts, BPF_ANY);
    return 0;
}

SEC("kretprobe/do_sys_openat2")
int BPF_KRETPROBE(do_sys_openat2_ret) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    u64 *tsp = bpf_map_lookup_elem(&start, &pid);
    if (!tsp)
        return 0;

    u64 delta = bpf_ktime_get_ns() - *tsp;
    bpf_map_delete_elem(&start, &pid);

    // Log latency (in a real tool, use a histogram map)
    bpf_printk("open latency: %llu ns\n", delta);
    return 0;
}
```

## libbpf — The Modern BPF Library

libbpf is the recommended library for writing BPF applications. It uses BPF CO-RE
(Compile Once — Run Everywhere) for portability.

### CO-RE (Compile Once, Run Everywhere)

```c
// co_re_example.c — Portable kernel data access
#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>

SEC("tp/task/task_rename")
int handle_task_rename(struct trace_event_raw_task_rename *ctx) {
    struct task_struct *task = (void *)bpf_get_current_task();

    // CO-RE: field access is resolved at load time
    int pid = BPF_CORE_READ(task, pid);
    int tgid = BPF_CORE_READ(task, tgid);
    char comm[16];
    BPF_CORE_READ_STR_INTO(&comm, task, comm);

    bpf_printk("rename: pid=%d tgid=%d comm=%s\n", pid, tgid, comm);
    return 0;
}
```

### libbpf Skeleton

```c
// main.c — Using generated skeleton
#include "my_prog.skel.h"

int main() {
    struct my_prog *skel;

    skel = my_prog__open();
    my_prog__load(skel);
    my_prog__attach(skel);

    // Read from maps
    while (1) {
        sleep(1);
        __u32 key = 0;
        __u64 value;
        bpf_map__lookup_elem(skel->maps.event_count, &key,
                            sizeof(key), &value, sizeof(value), 0);
        printf("Count: %lu\n", value);
    }

    my_prog__destroy(skel);
    return 0;
}
```

```bash
# Build with libbpf
clang -O2 -target bpf -g -c my_prog.c -o my_prog.o
bpftool gen skeleton my_prog.o > my_prog.skel.h
clang -o main main.c -lbpf -lelf -lz
```

## bpftool — BPF Inspection Tool

```bash
# List loaded BPF programs
sudo bpftool prog list

# Show program details
sudo bpftool prog show id 123

# Dump BPF program instructions
sudo bpftool prog dump xlated id 123

# Dump JIT-compiled code
sudo bpftool prog dump jited id 123

# List BPF maps
sudo bpftool map list

# Dump map contents
sudo bpftool map dump id 456

# Pin a program
sudo bpftool prog load my_prog.o /sys/fs/bpf/my_prog

# Attach to XDP
sudo bpftool net attach xdp id 123 dev eth0

# List BPF links
sudo bpftool link list
```

## BPF CO-RE and libbpf-bootstrap

```bash
# Clone libbpf-bootstrap
git clone https://github.com/libbpf/libbpf-bootstrap.git
cd libbpf-bootstrap

# Build minimal example
make -C examples/c minimal

# Build with custom program
# Edit examples/c/minimal.bpf.c and examples/c/minimal.c
make -C examples/c minimal
```

## Best Practices

1. **Use ring buffers over perf buffers** — better performance and multi-producer support
2. **Use CO-RE for portability** — avoid writing version-specific code
3. **Keep BPF programs small** — large programs are harder to verify and may fail
4. **Use bpftrace for quick investigations** — it's faster than writing full BPF programs
5. **Use BCC tools as a starting point** — then customize with libbpf for production
6. **Test with bpftool** — verify programs load and maps are correct
7. **Use `bpf_printk` for debugging** — output goes to `/sys/kernel/debug/tracing/trace_pipe`
8. **Handle map errors** — always check return values from map operations

## BPF Standardization (IETF)

From the kernel documentation at `docs.kernel.org/bpf/standardization/index.html`:

The BPF standardization effort is being pursued through the **IETF BPF Working Group**. The goal is to make BPF a cross-platform, standardized technology. The IETF working group is defining:

- **BPF Instruction Set Architecture (ISA)**: A formal specification of the BPF instruction set, making it possible for non-Linux implementations to be BPF-compatible.
- **BPF ABI Recommended Conventions and Guidelines v1.0**: ABI conventions for BPF programs to ensure portability.

The kernel docs at `docs.kernel.org/bpf/` serve as the authoritative reference, covering: the eBPF verifier, libbpf, BTF (BPF Type Format), the `bpf()` syscall API, helper functions, kfuncs (BPF kernel functions), program types, BPF maps, BPF iterators, and testing/debugging.

The Cilium project also maintains a comprehensive [BPF and XDP Reference Guide](https://docs.cilium.io/en/latest/bpf/) that goes into great technical depth.

## BPF Kernel Documentation Index

The kernel documentation at docs.kernel.org/bpf/ covers these topics:

- **eBPF Verifier** — The safety verifier that checks BPF programs before loading
- **libbpf** — The recommended C library for BPF applications
- **BPF Standardization** — Efforts to standardize BPF across platforms
- **BTF (BPF Type Format)** — Type information for CO-RE and debugging
- **Syscall API** — The `bpf()` system call interface
- **Helper Functions** — Kernel functions callable from BPF programs
- **kfuncs** — BPF kernel functions (newer, more flexible than helpers)
- **Program Types** — All available BPF program attachment points
- **BPF Maps** — Key-value data structures for BPF programs
- **BPF Iterators** — Iterate over kernel data structures from BPF
- **BPF Licensing** — GPL requirements for certain helper functions

## BPF Standardization

The BPF standardization effort aims to make BPF portable across different kernel versions and operating systems. Key components:

- **CO-RE (Compile Once, Run Everywhere)**: Uses BTF to resolve kernel structure layouts at load time
- **BPF Type Format (BTF)**: Compact type information embedded in the kernel and BPF programs
- **Standardized helpers/kfuncs**: A stable API surface for BPF programs

## kfuncs (BPF Kernel Functions)

kfuncs are the modern replacement for BPF helper functions. They are regular kernel functions exposed to BPF programs through a registration mechanism:

```c
/* kfunc declaration in kernel code */
__bpf_kfunc void bpf_task_acquire(struct task_struct *p);

/* Usage in BPF program */
struct task_struct *task = (struct task_struct *)bpf_get_current_task();
bpf_task_acquire(task);  /* kfunc call */
```

kfuncs provide:
- More flexibility than helpers (can access any kernel function)
- Better type safety through BTF
- Easier addition of new functionality
- Scoped availability (only certain program types can call certain kfuncs)

## BPF Design Decisions (from kernel docs)

From the kernel documentation at `docs.kernel.org/bpf/bpf_design_QA.html`:

### BPF Is NOT a Generic VM or Instruction Set

BPF is **not** a generic instruction set like x64 or arm64. It is **not** a generic virtual machine. BPF is a **generic instruction set with a C calling convention**, designed specifically to run in the Linux kernel (written in C). The instruction set is compatible with x64 and arm64 calling conventions and accounts for quirks of other architectures.

### C Calling Convention Constraints

- **Single return value**: Only register R0 is used for return values.
- **Maximum 5 arguments**: Registers R1–R5 for function arguments.
- **No access to instruction pointer or return address**.
- **No access to stack pointer** — only the frame pointer (R10) is accessible. LLVM defines R11 as the stack pointer internally but ensures generated code never uses it.

### Why C Calling Convention?

Because BPF programs run in the Linux kernel (written in C), using C calling convention enables:
- Zero-overhead calls between kernel and BPF programs
- JIT-compiled BPF programs are indistinguishable from native kernel C code
- Seamless interoperability with kernel helper functions and BPF maps

### Verifier Limits

| Limit | Value | Description |
|-------|-------|-------------|
| `BPF_MAXINSNS` | 4096 | Max instructions for unprivileged BPF programs |
| Complexity limit | 1,000,000 | Max instructions explored during analysis |
| Stack depth | 512 bytes | Maximum stack usage |
| Nested calls | ~8 | Max bpf-to-bpf call depth |

The verifier recognizes `pointer + bounded_register` expressions (not just `pointer + constant`). The development process guarantees future kernels accept all programs accepted by earlier versions.

### Instruction Design Philosophy

- **No flags register**: BPF avoided introducing a flags register (impossible to make generic across CPU architectures). Compare-and-jump instructions are used instead.
- **BPF_DIV doesn't map 1:1 to x64 div**: To avoid x64-specific complexity, plus it needs a div-by-zero runtime check.
- **Implicit prologue/epilogue**: Required because architectures like SPARC have register windows, and BPF needs safe division-by-zero handling.
- **New instructions must map to hardware**: `BPF_JLT` and `BPF_JLE` were added because they had native CPU equivalents. Instructions without HW mapping will not be accepted.

### BPF Safety Guarantees

- **Cannot call arbitrary kernel functions**: Only registered helpers and kfuncs.
- **Cannot overwrite arbitrary kernel memory**: Verifier prevents it.
- **Cannot overwrite arbitrary user memory**: Only properly validated pointers.
- **No stable ABI for kprobe attachment points**: Internal kernel functions can change.
- **Tracepoints are NOT part of the stable ABI**: They can change between kernel versions.

### BPF Stack and 32-bit Subregisters

- BPF 32-bit subregisters must zero the upper 32 bits of BPF registers.
- This makes BPF somewhat inefficient for 32-bit CPU architectures.\- True 32-bit registers will NOT be added to BPF.
- Some optimizations exist for JIT performance on 32-bit architectures.

## References

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [LWN.net - Linux and free software news](https://lwn.net/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- [eBPF.io](https://ebpf.io/)
- [BPF Documentation](https://docs.kernel.org/bpf/index.html)
- [BCC Project](https://github.com/iovisor/bcc)
- [bpftrace](https://github.com/bpftrace/bpftrace)
- [libbpf](https://github.com/libbpf/libbpf)
- [Cilium BPF Documentation](https://docs.cilium.io/en/latest/bpf/)
- [XDP Project](https://www.iovisor.org/technology/xdp)
- [BPF Standardization (kernel docs)](https://docs.kernel.org/bpf/standardization/index.html)
- [BPF Design Q&A (kernel docs)](https://docs.kernel.org/bpf/bpf_design_QA.html)

## Related Topics

- [ftrace](./ftrace.md) — Kernel function tracing (complementary to eBPF)
- [perf](./perf.md) — Hardware performance counters and sampling
- [strace](./strace-ltrace.md) — System call tracing (higher overhead alternative)
- [Kernel Debugging](./kernel-debugging.md) — KGDB, KDB, and crash utility
