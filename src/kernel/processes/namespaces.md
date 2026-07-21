# Linux Namespaces

## Introduction

Namespaces are the fundamental kernel mechanism for **resource isolation** in Linux. They provide processes with an isolated view of system resources, making each process (or group of processes) believe they have their own dedicated instance of a global resource. Combined with [cgroups](./cgroups.md) for resource limits, namespaces form the foundation of Linux containers.

The concept is deceptively simple: wrap a global resource so that processes inside the namespace see one version, while processes outside see another. But the implications are profound—a single Linux kernel can safely host multiple isolated environments, each with its own PID tree, network stack, mount points, hostname, and more.

As of Linux 6.1, there are **8 namespace types**. This page covers each in detail.

## The Eight Namespace Types

### 1. PID Namespace (`CLONE_NEWPID`)

The PID namespace isolates the process ID number space. Processes in different PID namespaces can have the same PID. The first process in a new PID namespace gets PID 1 and acts as an init process, inheriting responsibility for reaping orphaned children.

```c
#define _GNU_SOURCE
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

static int child_func(void *arg) {
    printf("Child PID (inside namespace): %d\n", getpid());
    printf("Parent PID (inside namespace): %d\n", getppid());
    return 0;
}

int main() {
    const int STACK_SIZE = 1024 * 1024;
    char *stack = malloc(STACK_SIZE);

    // Clone with new PID namespace
    pid_t pid = clone(child_func, stack + STACK_SIZE,
                      CLONE_NEWPID | SIGCHLD, NULL);

    printf("Child PID (from parent): %d\n", pid);
    waitpid(pid, NULL, 0);
    free(stack);
    return 0;
}
```

```bash
# Output:
# Child PID (from parent): 42
# Child PID (inside namespace): 1    ← PID 1 inside the namespace!
# Parent PID (inside namespace): 0   ← parent is "outside"
```

**Key rules:**
- The first process gets PID 1 (namespace init)
- If PID 1 dies, the entire namespace is killed (unless a subreaper is configured)
- `/proc/sys/kernel/pid_max` applies per namespace
- PID namespaces are hierarchical—child namespaces see parent PIDs

### 2. Network Namespace (`CLONE_NEWNET`)

Network namespaces provide isolated network stacks—each with its own interfaces, routing tables, firewall rules, and port numbers. This is the most commonly used namespace type after PID.

```bash
# Create a network namespace
ip netns add mynetns

# List namespaces
ip netns list
# mynetns

# Run a command inside the namespace
ip netns exec mynetns ip addr
# 1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN
#     link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00

# Bring up loopback
ip netns exec mynetns ip link set lo up

# Create a veth pair (virtual ethernet cable)
ip link add veth0 type veth peer name veth1

# Move one end into the namespace
ip link set veth1 netns mynetns

# Configure both ends
ip addr add 10.0.0.1/24 dev veth0
ip link set veth0 up

ip netns exec mynetns ip addr add 10.0.0.2/24 dev veth1
ip netns exec mynetns ip link set veth1 up

# Test connectivity
ip netns exec mynetns ping 10.0.0.1
# PING 10.0.0.1 (10.0.0.1) 56(84) bytes of data.
# 64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=0.045 ms
```

### 3. Mount Namespace (`CLONE_NEWNS`)

Mount namespaces isolate the set of filesystem mount points seen by a group of processes. Changes to the mount table in one namespace don't affect others.

```bash
# Create an isolated mount view
unshare --mount -- bash

# Inside: mount a tmpfs
mount -t tmpfs tmpfs /mnt
echo "secret data" > /mnt/data.txt

# This mount is invisible outside this namespace!
exit
ls /mnt/data.txt 2>&1
# ls: cannot access '/mnt/data.txt': No such file or directory
```

**Mount propagation types** control whether mount events cross namespace boundaries:

| Type | Description |
|------|-------------|
| `MS_SHARED` | Events propagate to and from peer groups |
| `MS_PRIVATE` | No propagation |
| `MS_SLAVE` | Receives from master, doesn't propagate back |
| `MS_BIND` | Bind mount, propagation inherited |

```bash
# Check mount propagation
findmnt -o TARGET,PROPAGATION /
# TARGET PROPAGATION
# /      shared

# Make a mount point private (prevents leaks)
mount --make-private /my/mount

# Or at mount time
mount --bind --make-private /source /target
```

### 4. UTS Namespace (`CLONE_NEWUTS`)

The UTS namespace isolates the hostname and NIS domain name. ("UTS" comes from the Unix Timesharing System, from which the `uname` struct originates.)

```bash
# Create UTS namespace
unshare --uts -- bash

# Change hostname inside namespace
hostname isolated-host
hostname
# isolated-host

# Original host is unchanged
exit
hostname
# myserver
```

### 5. IPC Namespace (`CLONE_NEWIPC`)

IPC namespaces isolate System V IPC objects and POSIX message queues. Processes in different IPC namespaces cannot communicate via shared memory, semaphores, or message queues.

```bash
# Create IPC namespace
unshare --ipc -- bash

# Inside: create a shared memory segment
ipcmk -M 1024
# Shared memory id: 0

# Outside the namespace: cannot see it
ipcs -m | grep "$(whoami)"
# (nothing from the namespace)
```

### 6. User Namespace (`CLONE_NEWUSER`)

User namespaces isolate user and group ID mappings. A process can have UID 0 inside a user namespace while having a completely different UID outside. This is a critical security feature for unprivileged containers.

```bash
# Create user namespace (unprivileged!)
unshare --user --map-root-user -- bash

# Inside: we're root
id
# uid=0(root) gid=0(root)

# Outside: still our normal user
# (check from another terminal)
ps -o pid,user,comm -p $(pgrep bash)
#   PID USER     COMMAND
# 12345 myuser   bash
```

```c
/* Mapping UIDs: write to /proc/PID/uid_map */
/* Format: ns_id outside_id count */
#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>

int main() {
    // Map UID 0 inside to UID 1000 outside
    int fd = open("/proc/self/uid_map", O_WRONLY);
    dprintf(fd, "0 1000 1\n");
    close(fd);

    // Deny setgroups (required before writing gid_map)
    fd = open("/proc/self/setgroups", O_WRONLY);
    dprintf(fd, "deny\n");
    close(fd);

    // Map GID similarly
    fd = open("/proc/self/gid_map", O_WRONLY);
    dprintf(fd, "0 1000 1\n");
    close(fd);
    return 0;
}
```

### 7. Cgroup Namespace (`CLONE_NEWCGROUP`)

Cgroup namespaces (Linux 4.6+) virtualize the view of the cgroup hierarchy. A process inside a cgroup namespace sees its cgroup as the root, hiding the real path.

```bash
# Without cgroup namespace:
cat /proc/self/cgroup
# 0::/system.slice/docker-abc123.scope

# With cgroup namespace:
unshare --cgroup -- bash
cat /proc/self/cgroup
# 0::/                    ← appears as root!
```

### 8. Time Namespace (`CLONE_NEWTIME`)

Time namespaces (Linux 5.6+) allow per-namespace offsets for `CLOCK_MONOTONIC` and `CLOCK_BOOTTIME`. This is useful for checkpoint/restore and containers that need different boot times.

```bash
# Check time namespace support
ls /proc/self/ns/time
# /proc/self/ns/time

# Create time namespace with offsets
# (requires writing to /proc/PID/timens_offsets)
unshare --time -- bash
# Format: clockid secs nanosecs
echo "monotonic 7200 0" > /proc/self/timens_offsets
# Adds 2 hours to monotonic clock inside this namespace
```

## Clone Flags

Namespaces are created using clone flags passed to `clone()`, `clone3()`, `unshare()`, or `setns()`:

```c
/* All namespace clone flags */
#define CLONE_NEWCGROUP   0x02000000  /* New cgroup namespace */
#define CLONE_NEWIPC      0x08000000  /* New IPC namespace */
#define CLONE_NEWNET      0x40000000  /* New network namespace */
#define CLONE_NEWNS       0x00020000  /* New mount namespace */
#define CLONE_NEWPID      0x20000000  /* New PID namespace */
#define CLONE_NEWUSER     0x10000000  /* New user namespace */
#define CLONE_NEWUTS      0x04000000  /* New UTS namespace */
#define CLONE_NEWTIME     0x00000080  /* New time namespace */
```

**Multiple namespaces can be combined:**

```bash
# Create a process with ALL namespaces isolated
unshare --pid --net --mount --uts --ipc --user --cgroup --time \
    --fork --mount-proc -- bash

# Inside: completely isolated environment
ps aux
# USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
# root         1  0.0  0.0  7236  4024 pts/0    S    10:00   0:00 bash
# root         2  0.0  0.0 10068  3364 pts/0    R+   10:00   0:00 ps aux
```

## Using `unshare` and `nsenter`

### `unshare` — Run Programs in New Namespaces

```bash
# Basic usage
unshare [options] [program [arguments]]

# Common flags
--pid      New PID namespace (use with --fork)
--net      New network namespace
--mount    New mount namespace
--uts      New UTS namespace
--ipc      New IPC namespace
--user     New user namespace
--cgroup   New cgroup namespace
--time     New time namespace
--fork     Fork before executing (required for --pid)
--mount-proc  Mount new /proc (required for --pid to show correct PIDs)
--map-root-user  Map current user to root in new user namespace

# Example: isolated build environment
unshare --mount --pid --fork --mount-proc -- bash -c "
    mount -t proc proc /proc
    mount -t tmpfs tmpfs /tmp
    echo 'Build environment ready'
    make
"
```

### `nsenter` — Enter Existing Namespaces

```bash
# Enter a process's namespaces
nsenter [options] [program [arguments]]

# Enter all namespaces of PID 1234
nsenter --target 1234 --all -- bash

# Enter specific namespaces
nsenter --target 1234 --net --pid -- bash

# Enter by file descriptor
nsenter --net=/var/run/netns/mynetns -- bash

# Common flags
-t, --target PID     Target process
-m, --mount[=FILE]   Mount namespace
-u, --uts[=FILE]     UTS namespace
-i, --ipc[=FILE]     IPC namespace
-n, --net[=FILE]     Network namespace
-p, --pid[=FILE]     PID namespace
-C, --cgroup[=FILE]  Cgroup namespace
-U, --user[=FILE]    User namespace
-T, --time[=FILE]    Time namespace
-a, --all            Enter all namespaces
```

**Practical example — debugging a container:**

```bash
# Get the container's init PID
CONTAINER_PID=$(docker inspect --format '{{.State.Pid}}' mycontainer)

# Enter the container's namespaces
nsenter --target $CONTAINER_PID --all -- bash

# Now you're "inside" the container with full host tools
ip addr        # Container's network
ps aux         # Container's processes
mount          # Container's mounts
```

## `/proc/[pid]/ns/` — Namespace File Descriptors

Each process exposes its namespace references as files under `/proc/[pid]/ns/`:

```bash
ls -la /proc/self/ns/
# lrwxrwxrwx 1 root root 0 ... cgroup -> 'cgroup:[4026531835]'
# lrwxrwxrwx 1 root root 0 ... ipc -> 'ipc:[4026531839]'
# lrwxrwxrwx 1 root root 0 ... mnt -> 'mnt:[4026531840]'
# lrwxrwxrwx 1 root root 0 ... net -> 'net:[4026531969]'
# lrwxrwxrwx 1 root root 0 ... pid -> 'pid:[4026531836]'
# lrwxrwxrwx 1 root root 0 ... pid_for_children -> 'pid:[4026531836]'
# lrwxrwxrwx 1 root root 0 ... time -> 'time:[4026531834]'
# lrwxrwxrwx 1 root root 0 ... time_for_children -> 'time:[4026531834]'
# lrwxrwxrwx 1 root root 0 ... user -> 'user:[4026531837]'
# lrwxrwxrwx 1 root root 0 ... uts -> 'uts:[4026531838]'
```

**The inode numbers** (e.g., `4026531835`) uniquely identify a namespace. Two processes with the same inode number are in the same namespace.

```bash
# Compare namespaces of two processes
readlink /proc/1234/ns/net
# net:[4026531969]
readlink /proc/5678/ns/net
# net:[4026531969]
# Same namespace!

# Keep a namespace alive by holding a file descriptor
exec 3</proc/1234/ns/net
# The namespace persists even if PID 1234 exits
```

## Namespace Lifecycle Diagram

```mermaid
graph TD
    A["clone(CLONE_NEWPID | CLONE_NEWNET | CLONE_NEWNS)"] --> B["New child process"]
    B --> C["New PID namespace<br/>PID 1"]
    B --> D["New network namespace<br/>lo only"]
    B --> E["New mount namespace<br/>inherits mounts"]
    C --> F["Child creates<br/>grandchildren"]
    F --> G["Grandchild gets PID 2<br/>in child's namespace"]
    E --> H["mount --make-private /<br/>isolate mount table"]
    D --> I["ip link add veth0<br/>create virtual NIC"]

    J["Parent process<br/>(original namespaces)"] --> A

    style A fill:#e53e3e,color:#fff
    style B fill:#3182ce,color:#fff
    style J fill:#718096,color:#fff
```

## Combining Namespaces with cgroups

The full container recipe uses both together:

```bash
#!/bin/bash
# Create a minimal container

# 1. Create namespaces
unshare --pid --net --mount --uts --ipc --user \
    --map-root-user --fork --mount-proc -- bash -c '
    # 2. Set hostname
    hostname my-container

    # 3. Mount minimal filesystem
    mount -t tmpfs tmpfs /tmp
    mount -t proc proc /proc

    # 4. (In production: mount rootfs, pivot_root, etc.)

    # 5. Apply cgroup limits (from outside, before pivot)
    # (done by the container runtime)

    exec /bin/bash
'
```

```bash
# Verify isolation
hostname          # my-container
ps aux            # only container processes
ip link show      # only container interfaces
cat /proc/cgroups # container cgroup view
```

## Kernel Configuration

```bash
# Verify namespace support
grep -E 'CONFIG_(UTS|IPC|USER|PID|NET|NS|CGROUP)_NS' /boot/config-$(uname -r)
# CONFIG_UTS_NS=y
# CONFIG_IPC_NS=y
# CONFIG_USER_NS=y
# CONFIG_PID_NS=y
# CONFIG_NET_NS=y
# CONFIG_NS=y
# CONFIG_CGROUP_NS=y

# Time namespace
grep CONFIG_TIME_NS /boot/config-$(uname -r)
# CONFIG_TIME_NS=y
```

## References

- [namespaces(7) man page](https://man7.org/linux/man-pages/man7/namespaces.7.html) — Comprehensive reference
- [Linux kernel namespace docs](https://www.kernel.org/doc/Documentation/networking/net_namespace.txt)
- [User namespaces and security](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)
- [Introducing Linux Network Namespaces](https://blog.scottlowe.org/2013/09/04/introducing-linux-network-namespaces/)
- [unshare(1) man page](https://man7.org/linux/man-pages/man1/unshare.1.html)
- [nsenter(1) man page](https://man7.org/linux/man-pages/man1/nsenter.1.html)

## Related Topics

- [Control Groups (cgroups)](./cgroups.md) — Resource limits paired with namespaces
- [Process Groups](./process-groups.md) — Process grouping mechanisms
- [Systemd Services](../../admin/process-management.md) — systemd's use of namespaces
