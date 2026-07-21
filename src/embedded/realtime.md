# Real-Time Linux

Real-time (RT) computing demands deterministic, bounded response times. This
chapter covers the PREEMPT_RT patch, RT scheduling classes, latency tuning
techniques, cyclictest benchmarking, and the journey of real-time Linux from
out-of-tree patch toward mainline inclusion.

---

## 1. What Is Real-Time?

A real-time system must meet **timing deadlines**, not just be "fast." The
metric that matters is **worst-case latency** — the maximum time between an
event and the system's response.

| Type | Deadline Miss Consequence | Example |
|------|---------------------------|---------|
| Hard RT | Catastrophic failure | Aircraft flight control |
| Firm RT | Useless result, no harm | Video frame decoding |
| Soft RT | Degraded quality | Audio playback, robotics |

**Important:** Real-time ≠ fast. A system that responds in 10 μs 99.99% of
the time but occasionally takes 100 ms is *not* real-time. A system that
*always* responds within 1 ms *is*.

---

## 2. Standard Linux vs PREEMPT_RT

### 2.1 Preemption Models

Linux offers several preemption levels, configurable at compile time:

```mermaid
flowchart LR
    subgraph Preemption Models
        NONE["PREEMPT_NONE<br/>Server default"]
        VOL["PREEMPT_VOLUNTARY<br/>Desktop default"]
        FULL["PREEMPT (full)<br/>Low-latency desktop"]
        RT["PREEMPT_RT<br/>Real-time"]
    end
    NONE -->|more preemptive| VOL
    VOL -->|more preemptive| FULL
    FULL -->|most preemptive| RT
```

| Model | Preemptible | Typical Latency | Use Case |
|-------|-------------|-----------------|----------|
| `PREEMPT_NONE` | Only at userspace/kernel boundary | 1–10 ms | Servers |
| `PREEMPT_VOLUNTARY` | + explicit preemption points | 0.5–5 ms | Desktops |
| `PREEMPT` | + most kernel code | 0.1–1 ms | Audio workstations |
| `PREEMPT_RT` | + IRQ threads, spinlocks → mutexes | 10–100 μs | Industrial, robotics |

### 2.2 What PREEMPT_RT Changes

The RT patch makes several fundamental changes to the kernel:

1. **Spinlocks → Sleeping locks** — Most `spinlock_t` become `rt_mutex`,
   allowing preemption in critical sections
2. **IRQ threading** — All interrupt handlers run in kernel threads with
   schedulable priorities
3. **Priority inheritance** — Prevents priority inversion on RT mutexes
4. **Deterministic timing** — `hrtimers` with nanosecond precision

```mermaid
flowchart TB
    subgraph Standard Kernel
        IRQ1[IRQ handler] -->|runs in interrupt context| SPIN1[spin_lock]
        SPIN1 -->|disables preemption| CRIT1[critical section]
    end
    subgraph PREEMPT_RT
        IRQ2[IRQ thread] -->|schedulable priority| MUTEX1[rt_mutex]
        MUTEX1 -->|sleeping lock, priority inheritance| CRIT2[critical section]
    end
```

---

## 3. RT Scheduling Classes

Linux has three scheduling classes relevant to real-time:

### 3.1 SCHED_FIFO

First-in, first-out. A RT task runs until it yields or a higher-priority task
becomes runnable.

```c
#include <sched.h>

struct sched_param param;
param.sched_priority = 80;  /* 1–99, higher = higher priority */
sched_setscheduler(0, SCHED_FIFO, &param);
```

### 3.2 SCHED_RR

Round-robin among same-priority tasks. Time quantum is configurable:

```bash
# Set RR time quantum for priority 80
chrt -r -p 80 <pid>

# Check scheduling policy
chrt -p <pid>
```

### 3.3 SCHED_DEADLINE (Linux 3.14+)

Admission-controlled Earliest Deadline First (EDF) scheduling:

```c
#include <sched.h>

struct sched_attr attr = {
    .size = sizeof(attr),
    .sched_policy = SCHED_DEADLINE,
    .sched_runtime = 2000000,    /* 2 ms in nanoseconds */
    .sched_deadline = 5000000,   /* 5 ms */
    .sched_period = 5000000,     /* 5 ms */
};
sched_setattr(0, &attr, 0);
```

The kernel guarantees the task meets its deadline if admission control passes:

```bash
# Check admission
dmesg | grep "deadline"
```

### 3.4 Priority Mapping

```
Priority 99  ─── Highest RT (SCHED_FIFO/SCHED_RR)
Priority 50  ─── Mid-range RT
Priority 1   ─── Lowest RT
Priority 0   ─── SCHED_NORMAL (CFS)
```

**Warning:** Never run RT tasks at priority 99 — the kernel watchdog and
migration threads use this priority. Use 1–98 for application RT tasks.

---

## 4. Building a PREEMPT_RT Kernel

### 4.1 Obtain the Patch

```bash
# Check available versions
# https://cdn.kernel.org/pub/linux/kernel/projects/rt/

KERNEL_VERSION=6.6
RT_PATCH=6.6-rt18

wget https://cdn.kernel.org/pub/linux/kernel/projects/rt/6.6/patch-${RT_PATCH}.patch.xz
```

### 4.2 Apply and Build

```bash
# Download kernel source
wget https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${KERNEL_VERSION}.tar.xz
tar xf linux-${KERNEL_VERSION}.tar.xz
cd linux-${KERNEL_VERSION}

# Apply RT patch
xzcat ../patch-${RT_PATCH}.patch.xz | patch -p1

# Configure
make menuconfig
# → General setup → Preemption Model (Fully Preemptible Kernel (Real-Time))
# → Processor type and features → Timer frequency (1000 Hz)

# Build
make -j$(nproc)
sudo make modules_install
sudo make install
```

### 4.3 Verify RT Kernel

```bash
uname -v
# Should show: SMP PREEMPT_RT

cat /sys/kernel/realtime
# Should be: 1
```

---

## 5. Latency Tuning

### 5.1 CPU Isolation

Isolate CPUs from the kernel scheduler so only RT tasks run on them:

```bash
# Boot parameter: isolate CPUs 2 and 3
isolcpus=2,3

# Or at runtime (requires cpuset cgroup)
echo 2-3 > /sys/fs/cgroup/cpuset/myrt/cpuset.cpus
```

### 5.2 IRQ Affinity

Pin interrupts away from isolated CPUs:

```bash
# Move all IRQs to CPU 0-1
for irq in /proc/irq/*/smp_affinity; do
    echo 3 > $irq   # bitmask: 0b0011 = CPUs 0,1
done

# Pin specific IRQ to CPU 0
echo 1 > /proc/irq/42/smp_affinity
```

### 5.3 Disable Power Management

C-States and P-States introduce unpredictable latency:

```bash
# Disable C-states (idle states)
echo 1 > /sys/devices/system/cpu/cpu*/cpuidle/state*/disable

# Set performance governor
for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    echo performance > $cpu
done
```

### 5.4 Disable NMI Watchdog

```bash
# Boot parameter
nmi_watchdog=0

# Or runtime
echo 0 > /proc/sys/kernel/nmi_watchdog
```

### 5.5 Lock Memory

Prevent RT tasks from being swapped out:

```c
#include <sys/mman.h>

mlockall(MCL_CURRENT | MCL_FUTURE);
```

### 5.6 Thread Affinity

Pin RT threads to isolated CPUs:

```c
#include <sched.h>

cpu_set_t cpuset;
CPU_ZERO(&cpuset);
CPU_SET(2, &cpuset);  /* Pin to CPU 2 */
pthread_setaffinity_np(thread, sizeof(cpuset), &cpuset);
```

---

## 6. cyclictest — Measuring Latency

### 6.1 What Is cyclictest?

`cyclictest` is the standard tool for measuring real-time latency. It sets up a
periodic timer and measures the difference between expected and actual wake-up
times.

### 6.2 Running cyclictest

```bash
# Basic test: all CPUs, 100μs period, 100000 iterations
sudo cyclictest -t1 -p80 -i100 -l100000 -a 2-3 -m --policy fifo

# Explanation:
# -t1        : 1 thread per CPU
# -p80       : priority 80
# -i100      : 100μs interval
# -l100000   : 100000 loops
# -a 2-3     : affinity to CPUs 2,3
# -m         : lock memory
# --policy fifo : use SCHED_FIFO
```

### 6.3 Interpreting Results

```
T: 0 ( 3456) P:80 I:100 C: 100000 Min:      1 Act:    3 Avg:    2 Max:      15
T: 1 ( 3457) P:80 I:100 C: 100000 Min:      1 Act:    4 Avg:    3 Max:      18
```

| Column | Meaning |
|--------|---------|
| `T` | Thread number |
| `P` | Priority |
| `I` | Interval (μs) |
| `C` | Iteration count |
| `Min` | Minimum latency (μs) |
| `Avg` | Average latency (μs) |
| `Max` | Maximum latency (μs) ← **the critical metric** |

### 6.4 Acceptable Latency Targets

| System | Max Latency Target |
|--------|--------------------|
| Untuned PREEMPT_RT kernel | < 100 μs |
| Tuned PREEMPT_RT kernel | < 50 μs |
| Industrial control | < 20 μs |
| Audio processing | < 500 μs |

### 6.5 Histogram Output

```bash
sudo cyclictest -t1 -p80 -i100 -l1000000 -a2 -m \
    --histogram=100 -q

# Output: latency histogram in gnuplot format
# View with gnuplot:
gnuplot -e "plot 'hist.txt' with impulses"
```

---

## 7. Benchmarking Suite

### 7.1 hackbench — Scheduler Stress

```bash
hackbench -l 10000 -g 4
# Measures context switch and scheduler overhead
```

### 7.2 rt-tests Package

```bash
sudo apt install rt-tests

# Available tools:
# cyclictest   — latency measurement
# hackbench    — scheduler stress
# pip_stress   — priority inversion stress
# pi_stress    — priority inheritance stress
# signaltest   — signal delivery latency
# ptsematest   — POSIX mutex latency
# svsematest   — System V semaphore latency
```

### 7.3 osnoise — OS Noise Tracer (Linux 5.14+)

```bash
# Enable osnoise tracer
echo osnoise > /sys/kernel/tracing/current_tracer
cat /sys/kernel/tracing/trace_pipe

# Or use the osnoise tool
sudo cyclictest --osnoise
```

---

## 8. Real-World RT Application Architecture

```mermaid
flowchart TD
    subgraph Isolated CPUs 2-3
        RT_THREAD[RT Control Thread<br/>SCHED_FIFO prio 80]
        IRQ_THREAD[IRQ Thread<br/>Pinned to CPU 2]
    end
    subgraph General CPUs 0-1
        MONITOR[Monitoring Thread<br/>SCHED_OTHER]
        LOG[Logging Thread<br/>SCHED_OTHER]
        NET[Network Thread<br/>SCHED_OTHER]
    end
    IRQ_THREAD -->|shared memory| RT_THREAD
    RT_THREAD -->|ring buffer| MONITOR
    MONITOR --> LOG
    MONITOR --> NET
```

### 8.1 Minimal RT Application

```c
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <sched.h>
#include <sys/mman.h>
#include <time.h>

#define PERIOD_NS 1000000  /* 1 ms */

void *rt_thread(void *arg) {
    struct timespec next;
    clock_gettime(CLOCK_MONOTONIC, &next);

    while (1) {
        /* Do real-time work here */
        /* ... */

        /* Sleep until next period */
        next.tv_nsec += PERIOD_NS;
        while (next.tv_nsec >= 1000000000) {
            next.tv_sec++;
            next.tv_nsec -= 1000000000;
        }
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, NULL);
    }
    return NULL;
}

int main(void) {
    /* Lock memory */
    mlockall(MCL_CURRENT | MCL_FUTURE);

    /* Create RT thread */
    pthread_t thread;
    pthread_attr_t attr;
    struct sched_param param;

    pthread_attr_init(&attr);
    pthread_attr_setinheritsched(&attr, PTHREAD_EXPLICIT_SCHED);
    pthread_attr_setschedpolicy(&attr, SCHED_FIFO);
    param.sched_priority = 80;
    pthread_attr_setschedparam(&attr, &param);

    /* Pin to isolated CPU */
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(2, &cpuset);
    pthread_attr_setaffinity_np(&attr, sizeof(cpuset), &cpuset);

    pthread_create(&thread, &attr, rt_thread, NULL);
    pthread_join(thread, NULL);
    return 0;
}
```

Compile with:

```bash
# Use RT-safe memory allocation (no malloc in RT path)
gcc -O2 -o rt_app rt_app.c -lpthread -lrt
```

---

## 9. PREEMPT_RT Mainline Status

The PREEMPT_RT patchset has been progressively merged into mainline Linux:

| Version | Merged Feature |
|---------|----------------|
| 2.6.18 | RT-mutex with priority inheritance |
| 3.x | IRQ threading infrastructure |
| 5.3 | printk deferred printing |
| 5.15 | Forced IRQ threading |
| 5.18 | Local locks |
| 6.x | Ongoing spinlock conversions |
| 6.12 | **PREEMPT_RT fully merged** (announced Oct 2024) |

As of Linux 6.12, `PREEMPT_RT` is a mainline configuration option with no
out-of-tree patches required.

---

## 10. Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Using `malloc()` in RT path | Pre-allocate all memory, use `mlockall()` |
| Logging from RT thread | Use lock-free ring buffer, log from non-RT thread |
| Priority inversion | Use `PTHREAD_PRIO_INHERIT` mutexes |
| Running at priority 99 | Use 1–98; 99 is reserved for kernel |
| Forgetting CPU isolation | Use `isolcpus` + `cpuset` cgroup |
| Using `sleep()` in RT path | Use `clock_nanosleep()` with `TIMER_ABSTIME` |

---

## Further Reading

- [PREEMPT_RT Wiki — wiki.linuxfoundation.org](https://wiki.linuxfoundation.org/realtime/start)
- [RT Wiki — kernel.org](https://kernel.org/wiki/realtime)
- [cyclictest Documentation — rt-tests](https://wiki.linuxfoundation.org/realtime/documentation/howto/tools/rt-tests)
- [SCHED_DEADLINE — docs.kernel.org](https://docs.kernel.org/scheduler/sched-deadline.html)
- [Real-Time Linux in Mainline — LWN.net](https://lwn.net/Articles/953752/)
- [PREEMPT_RT Merged (6.12) — LWN.net](https://lwn.net/Articles/993498/)
- [Latency Debugging — docs.kernel.org](https://docs.kernel.org/trace/events.html)
- [rt-tests GitHub](https://github.com/jirka-h/rt-tests)
- [cyclictest(1) man page](https://man7.org/linux/man-pages/man1/cyclictest.1.html)
- [sched(7) — scheduling policies](https://man7.org/linux/man-pages/man7/sched.7.html)
