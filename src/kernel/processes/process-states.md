# Process States

## Introduction

Every process in Linux exists in one of several **states** at any given time. The state determines what the scheduler can do with the process — whether it can be run, must wait for an event, or is being terminated. Understanding process states is essential for debugging (interpreting `ps` output), performance analysis (identifying blocked processes), and kernel development (knowing when state transitions occur).

The state is stored in the `state` field of `task_struct`:

```c
/* include/linux/sched.h */
struct task_struct {
    /* -1 unrunnable, 0 runnable, >0 stopped */
    volatile long __state;
    /* ... */
};
```

## The States

### TASK_RUNNING (0)

A task in `TASK_RUNNING` state is either:
- **Currently executing** on a CPU, or
- **On the run queue** (ready to run, waiting for a CPU)

This is the only state where a task can actually execute. All runnable tasks are in this state.

```c
/* include/linux/sched.h */
#define TASK_RUNNING            0x0000
```

**Key insight**: `TASK_RUNNING` doesn't mean the task is actually using the CPU — it means the task is *ready* to use it. On a 4-core system with 8 runnable tasks, 4 are on CPUs and 4 are waiting in the run queue, but all 8 are in `TASK_RUNNING`.

```bash
# TASK_RUNNING shows as 'R' in ps
$ ps -eo pid,stat,comm | grep R
  PID STAT COMMAND
    1 Ss   systemd
  500 Ss   bash
  600 R    gcc        ← Currently running or on run queue
  601 R+   stress-ng  ← Running, foreground process
```

### TASK_INTERRUPTIBLE (1)

A task in `TASK_INTERRUPTIBLE` state is **sleeping**, waiting for some condition to become true (e.g., I/O completion, timer expiry, signal arrival). It can be woken by:
- The condition becoming true
- Receiving a signal

```c
#define TASK_INTERRUPTIBLE      0x0001
```

**When a task enters this state**:
- Waiting for I/O (`read()`, `write()`, `select()`, `poll()`)
- Waiting on a condition variable or semaphore
- Sleeping (`sleep()`, `nanosleep()`)
- Waiting for a child process (`wait()`)

```bash
# TASK_INTERRUPTIBLE shows as 'S' in ps
$ ps -eo pid,stat,comm | grep S
  PID STAT COMMAND
    1 Ss   systemd     ← Sleeping, interruptible
  500 Ss   bash        ← Waiting for input
  700 S    sshd        ← Waiting for connection
```

```c
/* Example: sleeping in kernel */
static ssize_t my_read(struct file *file, char __user *buf,
                        size_t count, loff_t *ppos)
{
    struct my_device *dev = file->private_data;

    /* Set state to TASK_INTERRUPTIBLE */
    set_current_state(TASK_INTERRUPTIBLE);

    /* Wait for data */
    while (!data_available(dev)) {
        /* Check for signals */
        if (signal_pending(current))
            return -ERESTARTSYS;

        /* Sleep until woken or signal */
        schedule();
        set_current_state(TASK_INTERRUPTIBLE);
    }

    /* We have data, set state back to TASK_RUNNING */
    set_current_state(TASK_RUNNING);

    /* Read data */
    return read_data(dev, buf, count);
}
```

### TASK_UNINTERRUPTIBLE (2)

A task in `TASK_UNINTERRUPTIBLE` state is sleeping but **cannot be interrupted by signals**. It's used when the task must wait for a condition that will happen very soon, and waking up for a signal would be counterproductive.

```c
#define TASK_UNINTERRUPTIBLE    0x0002
```

**When a task enters this state**:
- Disk I/O (waiting for hardware completion)
- Some locks (mutexes in certain configurations)
- Memory page faults (waiting for page to be read from disk)

```bash
# TASK_UNINTERRUPTIBLE shows as 'D' in ps
$ ps -eo pid,stat,comm | grep D
  PID STAT COMMAND
  800 D    dd          ← Waiting for disk I/O
  801 D+   sync        ← Flushing filesystem buffers
```

**D state problems**: A process stuck in `TASK_UNINTERRUPTIBLE` for too long is a common source of system hangs. This can happen with:
- Unresponsive NFS servers (NFS mounts with `hard` option)
- Stuck storage devices
- Deadlocked kernel code

```bash
# Find processes stuck in D state
$ ps aux | awk '$8 ~ /D/'
root  800  0.0  0.0  0  0 ?  D  10:00  0:00 [kworker]

# Check for blocked processes
$ cat /proc/$PID/status | grep State
State:  D (disk sleep)

# View blocked process stack
$ cat /proc/$PID/stack
[<0>] call_rwsem_down_read_slowpath+0x123/0x456
[<0>] __do_fault+0x78/0x340
[<0>] handle_mm_fault+0x123/0x456
```

### TASK_STOPPED (4)

A task in `TASK_STOPPED` state has been stopped by a signal (`SIGSTOP`, `SIGTSTP`, `SIGTTIN`, `SIGTTOU`). It can only be continued by `SIGCONT`.

```c
#define TASK_STOPPED            0x0004
```

```bash
# Stop a process
$ kill -STOP 1234

# TASK_STOPPED shows as 'T' in ps
$ ps -eo pid,stat,comm | grep T
  PID STAT COMMAND
 1234 T    myapp       ← Stopped by signal

# Continue the process
$ kill -CONT 1234
```

### TASK_TRACED (8)

A task in `TASK_TRACED` state is being traced by a debugger (ptrace). It's similar to `TASK_STOPPED` but indicates the stop is due to a ptrace event.

```c
#define TASK_TRACED             0x0008
```

```bash
# Traced processes show as 't' in ps
$ ps -eo pid,stat,comm | grep t
  PID STAT COMMAND
 1234 t+   myapp       ← Traced by debugger
```

### EXIT_ZOMBIE (32) / EXIT_DEAD (128)

```c
#define EXIT_ZOMBIE             0x0020
#define EXIT_DEAD               0x0080
```

**Zombie** (`EXIT_ZOMBIE`): A process that has exited but whose parent hasn't called `wait()` yet. The kernel retains the `task_struct` so the parent can read the exit status.

**EXIT_DEAD**: The final state — the parent has called `wait()`, and the `task_struct` is about to be freed.

```bash
# Zombie processes show as 'Z' in ps
$ ps -eo pid,stat,comm | grep Z
  PID STAT COMMAND
 1234 Z    myapp       ← Zombie (parent hasn't waited)

# Find zombies
$ ps aux | awk '$8 ~ /Z/'
```

```c
/* How a process becomes a zombie */
/* kernel/exit.c */
void __noreturn do_exit(long code)
{
    /* ... cleanup ... */

    /* Notify parent */
    exit_notify(tsk, group_dead);

    /* Become a zombie */
    tsk->exit_state = EXIT_ZOMBIE;

    /* Wait for parent to call wait() */
    do_task_dead();
}
```

## Extended States

### __TASK_KILLABLE

A combination of `TASK_UNINTERRUPTIBLE` and a fatal signal check:

```c
#define TASK_KILLABLE           (TASK_WAKEKILL | TASK_UNINTERRUPTIBLE)
#define TASK_WAKEKILL           0x0020
```

A task in `TASK_KILLABLE` is uninterruptible except for fatal signals (`SIGKILL`). This is used for operations that must complete but shouldn't make the system unkillable:

```c
/* Waiting for I/O that can be interrupted by SIGKILL */
long io_schedule_killable(void)
{
    set_current_state(TASK_KILLABLE);
    return io_schedule();
}
```

### TASK_IDLE

```c
#define TASK_IDLE               0x0002  /* Same as TASK_UNINTERRUPTIBLE in older kernels */
```

Used for idle tasks that shouldn't contribute to load average:

```bash
# Idle tasks show in kernel log
$ dmesg | grep "idle"
```

### TASK_PARKED / TASK_NOLOAD

```c
#define TASK_PARKED             0x0040
#define TASK_NOLOAD             0x0400
```

- `TASK_PARKED`: Used for parked kernel threads
- `TASK_NOLOAD`: Task doesn't count toward load average

## State Transitions

### Complete State Diagram

```mermaid
stateDiagram-v2
    [*] --> TASK_RUNNING: fork()/clone()

    TASK_RUNNING --> TASK_INTERRUPTIBLE: wait_event(), sleep()
    TASK_RUNNING --> TASK_UNINTERRUPTIBLE: Disk I/O, mutex lock
    TASK_RUNNING --> TASK_STOPPED: SIGSTOP, SIGTSTP
    TASK_RUNNING --> TASK_TRACED: ptrace attach
    TASK_RUNNING --> EXIT_ZOMBIE: do_exit()

    TASK_INTERRUPTIBLE --> TASK_RUNNING: Wake up, signal received
    TASK_UNINTERRUPTIBLE --> TASK_RUNNING: Wake up (condition met)
    TASK_KILLABLE --> TASK_RUNNING: Wake up or SIGKILL

    TASK_STOPPED --> TASK_RUNNING: SIGCONT
    TASK_TRACED --> TASK_RUNNING: ptrace detach, SIGCONT

    EXIT_ZOMBIE --> EXIT_DEAD: Parent calls wait()
    EXIT_DEAD --> [*]: task_struct freed
```

### Transition Code

The state is set using helper functions:

```c
/* include/linux/sched.h */

/* Set state (memory barrier ensures visibility) */
#define set_current_state(state_value)                      \
    do {                                                    \
        debug_normal_state_change(state_value);             \
        smp_store_mb(current->__state, (state_value));      \
    } while (0)

/* Set state without memory barrier (faster, use when already protected) */
#define __set_current_state(state_value)                    \
    do {                                                    \
        debug_normal_state_change(state_value);             \
        current->__state = (state_value);                   \
    } while (0)

/* Special version for TASK_RUNNING (no barrier needed) */
#define __set_task_state(tsk, state_value)                  \
    do {                                                    \
        debug_task_state_change((tsk), (state_value));      \
        (tsk)->__state = (state_value);                     \
    } while (0)
```

### The Wait Queue Pattern

Wait queues are the standard mechanism for sleeping and waking:

```c
/* include/linux/wait.h */
struct wait_queue_head {
    spinlock_t lock;
    struct list_head task_list;
};

/* Typical wait queue usage */
DECLARE_WAIT_QUEUE_HEAD(my_wq);
int data_ready = 0;

/* Producer (waker) */
void produce_data(void) {
    data_ready = 1;
    wake_up_interruptible(&my_wq);
}

/* Consumer (waiter) */
int consume_data(void) {
    wait_event_interruptible(my_wq, data_ready);
    if (signal_pending(current))
        return -ERESTARTSYS;

    data_ready = 0;
    return 0;
}
```

### Wait Queue Internals

```c
/* kernel/sched/wait.c */
int __wait_event_interruptible(struct wait_queue_head *wq_head,
                                int condition)
{
    int ret = 0;
    DEFINE_WAIT(wait);

    for (;;) {
        prepare_to_wait(&wq_head, &wait, TASK_INTERRUPTIBLE);
        if (condition)
            break;
        if (!signal_pending(current)) {
            schedule();
            continue;
        }
        ret = -ERESTARTSYS;
        break;
    }
    finish_wait(&wq_head, &wait);
    return ret;
}

void prepare_to_wait(struct wait_queue_head *wq_head,
                     struct wait_queue_entry *wq_entry, int state)
{
    unsigned long flags;

    wq_entry->flags &= ~WQ_FLAG_EXCLUSIVE;
    spin_lock_irqsave(&wq_head->lock, flags);
    if (list_empty(&wq_entry->entry))
        __add_wait_queue(wq_head, wq_entry);
    set_current_state(state);
    spin_unlock_irqrestore(&wq_head->lock, flags);
}
```

## Load Average and Process States

### How Load Average Is Calculated

The Linux load average counts tasks in `TASK_RUNNING` and `TASK_UNINTERRUPTIBLE`:

```c
/* kernel/sched/core.c */
void calc_global_load(void)
{
    /* Count runnable tasks + uninterruptible tasks */
    long nr_active = atomic_long_read(&calc_load_tasks);

    /* Exponential moving average */
    avenrun[0] = calc_load(avenrun[0], EXP_1, nr_active);
    avenrun[1] = calc_load(avenrun[1], EXP_5, nr_active);
    avenrun[2] = calc_load(avenrun[2], EXP_15, nr_active);
}
```

```bash
$ cat /proc/loadavg
0.50 0.40 0.35 2/500 12345
# ^^^^^^^^^^^^^^^^^  ^^^  ^^^^^
# 1min 5min 15min   2 running / 500 total  PID
```

**Implication**: Tasks stuck in `TASK_UNINTERRUPTIBLE` (D state) increase the load average, even though they're not using the CPU. This is why a system with stuck NFS mounts shows high load.

## Practical Examples

### Process State Inspection

```bash
# Detailed state information
$ cat /proc/$PID/status
Name:   myapp
State:  S (sleeping)
Tgid:   1234
Pid:    1234
PPid:   500

# State field in /proc/PID/stat
$ cat /proc/$PID/stat | awk '{print $3}'
S

# Symbol table for states
# R = TASK_RUNNING
# S = TASK_INTERRUPTIBLE
# D = TASK_UNINTERRUPTIBLE (disk sleep)
# T = TASK_STOPPED
# t = TASK_TRACED
# Z = EXIT_ZOMBIE
# X = EXIT_DEAD
# x = TASK_DEAD (old)
# K = TASK_WAKEKILL
# W = TASK_WAKING
# P = TASK_PARKED
```

### Debugging D-State Processes

```bash
# Find all D-state processes
$ ps aux | awk '$8 == "D"'

# Get kernel stack of D-state process
$ cat /proc/$PID/stack
[<0>] __schedule+0x234/0x567
[<0>] schedule+0x45/0x89
[<0>] schedule_timeout+0x123/0x234
[<0>] wait_for_completion+0x89/0x123
[<0>] blk_execute_rq+0x45/0x89

# Trace what the process is waiting for
$ sudo strace -p $PID
# (may show the system call that's blocking)

# For NFS issues
$ cat /proc/mounts | grep nfs
```

### Zombie Cleanup

```bash
# Find zombies and their parents
$ ps -eo pid,ppid,stat,comm | grep Z
  PID  PPID STAT COMMAND
 1234   500 Z    myapp

# Check parent process
$ ps -p 500 -o pid,stat,comm
  PID STAT COMMAND
  500 Ss   bash

# If parent is ignoring SIGCHLD, you can't clean up zombies
# Solution: kill the parent (zombies are reparented to init which reaps them)
$ kill 500
```

### State Transition Tracing

```bash
# Trace state changes with ftrace
$ sudo trace-cmd record -e 'sched:sched_switch' -e 'sched:sched_process_state' -p $PID -- sleep 5
$ trace-cmd report | head -20
  task-1234  [000] 12345.678: sched_switch: prev_comm=myapp prev_pid=1234 prev_prio=120 ==> next_comm=bash next_pid=500 next_prio=120

# Using perf
$ sudo perf record -e 'sched:sched_process_state' -p $PID -- sleep 5
$ sudo perf script
```

## Further Reading

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- [Linux kernel: include/linux/sched.h](https://elixir.bootlin.com/linux/latest/source/include/linux/sched.h)
- [Linux kernel: kernel/sched/core.c](https://elixir.bootlin.com/linux/latest/source/kernel/sched/core.c)
- [Linux man pages: proc(5)](https://man7.org/linux/man-pages/man5/proc.5.html)
- [Linux man pages: ps(1)](https://man7.org/linux/man-pages/man1/ps.1.html)
- [Understanding the Linux Kernel, 3rd Edition - Chapter 3: Processes](https://www.oreilly.com/library/view/understanding-the-linux/0596005652/)
- [LWN: The states of a process](https://lwn.net/Articles/102686/)

## Related Topics

- [Processes and Threads](processes-and-threads.md) — What a process is in Linux
- [task_struct Deep Dive](task-struct.md) — The `state` field and its meaning
- [Scheduler Overview](scheduler.md) — How the scheduler uses process states
- [Context Switching](context-switching.md) — What happens during state transitions
- [Signals](signals.md) — How signals interact with process states
