# Mount Namespaces

## Overview

Mount namespaces are one of the foundational namespace types in Linux, providing isolation of the filesystem mount point hierarchy. Each mount namespace maintains its own view of the filesystem tree, allowing processes in different namespaces to see entirely different sets of mounted filesystems. Mount namespaces were the first namespace type implemented in Linux (2.4.19, 2002) and form the basis of container filesystem isolation.

The key mechanism that makes mount namespaces powerful is **mount propagation** — the ability to control how mount and unmount events propagate between namespaces. Understanding propagation modes (shared, private, slave, unbindable) is essential for correct container operation.

## Creating Mount Namespaces

### clone() System Call

Mount namespaces are created with the `CLONE_NEWNS` flag:

```c
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int child_func(void *arg) {
    printf("Child: in new mount namespace\n");
    // Mount operations here won't affect parent
    mount("tmpfs", "/tmp", "tmpfs", 0, NULL);
    printf("Child: /tmp is now tmpfs\n");
    return 0;
}

int main() {
    char *stack = malloc(1024 * 1024);
    pid_t pid = clone(child_func, stack + 1024 * 1024,
                      CLONE_NEWNS | SIGCHLD, NULL);
    waitpid(pid, NULL, 0);
    printf("Parent: /tmp is unchanged\n");
    return 0;
}
```

### unshare() System Call

A process can unshare its mount namespace from its parent:

```bash
# Create a new mount namespace and a new shell
sudo unshare --mount /bin/bash

# In the new namespace, mount operations are private
mount -t tmpfs tmpfs /mnt
ls /mnt
# Shows tmpfs contents

# In another terminal, the parent namespace doesn't see this mount
```

### setns() System Call

A process can join an existing mount namespace:

```c
int fd = open("/proc/<pid>/ns/mnt", O_RDONLY);
setns(fd, CLONE_NEWNS);
// Now in the target's mount namespace
```

## How Mount Namespaces Work

When a new mount namespace is created via `clone(CLONE_NEWNS)` or `unshare(CLONE_NEWNS)`:

1. The new namespace receives a **copy** of the parent namespace's mount tree
2. The `mount` structure reference counts are incremented
3. Subsequent mount/unmount operations in either namespace are independent (subject to propagation rules)
4. The mount tree is represented as a tree of `struct mount` objects in kernel space

### Mount Tree Structure

Each namespace has its own `struct mnt_namespace`:

```c
struct mnt_namespace {
    atomic_t count;
    struct ns_common ns;
    struct mount *root;          /* Root of the mount tree */
    struct list_head list;       /* List of all mounts in this ns */
    struct user_namespace *user_ns;
    struct ucounts *ucounts;
    unsigned int mounts;         /* Number of mounts */
    unsigned int pending_mounts; /* Mounts being propagated */
};
```

Each mount point is represented by `struct mount`:

```c
struct mount {
    struct hlist_node mnt_hash;     /* Hash table linkage */
    struct mount *mnt_parent;       /* Parent mount */
    struct dentry *mnt_mountpoint;  /* Dentry where mounted */
    struct vfsmount mnt;            /* VFS mount data */
    struct mnt_namespace *mnt_ns;   /* Owning namespace */
    /* ... */
    struct list_head mnt_slave;     /* Slave mounts */
    struct mount *mnt_master;       /* Master mount */
    struct list_head mnt_share;     /* Shared peer group */
    /* ... */
};
```

## Mount Propagation

Mount propagation controls how mount and unmount events in one namespace affect other namespaces. This is critical for containers to receive host filesystem updates (like device hotplug) while maintaining isolation.

### Propagation Types

#### Shared Mounts (MS_SHARED)

A shared mount belongs to a **peer group**. Mount and unmount events on any peer in the group propagate to all other peers:

```bash
# Create a shared mount
mount --make-shared /mnt

# Or when mounting
mount -o shared /dev/sdb1 /mnt
```

**Behavior:**
- Mounting under `/mnt` in namespace A causes it to appear under `/mnt` in all peer namespaces
- Unmounting similarly propagates
- Peer groups are identified by a shared group ID

```bash
# Demonstrate shared propagation
mount --make-shared /tmp/shared
unshare --mount bash
# In new namespace: mount is shared, so mounts propagate
mount /dev/sdc1 /tmp/shared/child
# Parent namespace also sees /tmp/shared/child
```

#### Private Mounts (MS_PRIVATE)

A private mount does not propagate events in either direction:

```bash
mount --make-private /mnt
# Or
mount -o private /dev/sdb1 /mnt
```

**Behavior:**
- Mount/unmount events on this mount do NOT propagate to other namespaces
- Events from other namespaces do NOT propagate to this mount
- This is the most isolated propagation mode
- Default mode for most mounts since Linux 2.6.15

#### Slave Mounts (MS_SLAVE)

A slave mount receives propagation from its **master** but does not propagate to the master:

```bash
mount --make-slave /mnt
# Or
mount -o slave /dev/sdb1 /mnt
```

**Behavior:**
- Events on the master mount propagate TO the slave (one-way)
- Events on the slave do NOT propagate to the master
- A slave mount can have only one master
- Multiple slaves can share the same master

**Use case:** A container needs to see new mounts made on the host (e.g., device hotplug) but should not affect the host's mount tree.

```bash
# Host creates shared mount
mount --make-shared /data

# Container namespace: mount is slave of host's /data
mount --bind /data /data
mount --make-slave /data

# Now: host mounts under /data appear in container
# But container mounts under /data don't appear on host
```

#### Unbindable Mounts (MS_UNBINDABLE)

An unbindable mount cannot be the source of a bind mount:

```bash
mount --make-unbindable /mnt
# Or
mount -o unbindable /dev/sdb1 /mnt
```

**Behavior:**
- `mount --bind /mnt/child /somewhere` fails
- Prevents accidental exposure of sensitive mount points
- Does not propagate events
- Useful for security: prevents namespace escape via bind mounts

### Propagation Summary

| Type | Propagates To Peers | Receives From Peers | Bindable | Use Case |
|---|---|---|---|---|
| **shared** | Yes | Yes | Yes | Host mount points that containers should see |
| **private** | No | No | Yes | Isolated mounts, default for containers |
| **slave** | No | Yes (from master) | Yes | Container mounts that need host updates |
| **unbindable** | No | No | No | Security-sensitive mount points |

### Peer Groups

A peer group is a set of shared mount instances that propagate events among themselves:

```bash
# Check peer group IDs
cat /proc/self/mountinfo | grep /mnt
# Output includes shared:X where X is the peer group ID
```

When a shared mount is bind-mounted, the bind mount joins the same peer group:

```bash
mount --make-shared /source
mount --bind /source /target
# /target is now in the same peer group as /source
cat /proc/self/mountinfo | grep -E "(source|target)"
# Both show "shared:N" with the same N
```

## Mount Propagation in Practice

### Container Runtime Behavior

Container runtimes like Docker, Podman, and LXC use mount propagation strategically:

```
Host namespace:
  /              (private)
  /var/lib/docker  (shared)  ← shared so containers can receive updates

Container namespace:
  /              (private)
  /proc          (private)
  /dev           (slave of host /dev)  ← receives device hotplug
```

### The /proc/<pid>/mountinfo File

This file shows detailed mount information including propagation:

```bash
cat /proc/self/mountinfo
# Format: mount_id parent_id major:minor root mount_point options
#         optional_fields propagation_type
# Example:
# 31 23 8:2 / / rw,relatime shared:1 - ext4 /dev/sda2 rw
# 121 31 0:42 / /tmp rw shared:25 - tmpfs tmpfs rw
```

The `shared:N` tag indicates shared propagation with peer group N.

### /proc/<pid>/mounts vs /proc/<pid>/mountinfo

- `/proc/<pid>/mounts`: Traditional mount listing (fstab format)
- `/proc/<pid>/mountinfo`: Extended format with propagation info, mount IDs, and optional fields

## Interaction with Other Namespaces

### PID Namespaces

Mount namespaces are often combined with PID namespaces. When a new PID namespace is created, `/proc` must be remounted:

```bash
unshare --mount --pid --fork bash
mount -t proc proc /proc
# Now /proc shows only processes in this PID namespace
```

### User Namespaces

In a user namespace, unprivileged users can create mount namespaces and perform certain mounts:

```bash
unshare --user --mount bash
# Can mount tmpfs, proc, sysfs within the namespace
mount -t tmpfs tmpfs /tmp
```

But cannot mount block devices or filesystems that require `CAP_SYS_ADMIN` in the initial user namespace.

### Network Namespaces

Network namespaces require `/sys` remounting to see the correct network devices:

```bash
unshare --mount --net bash
mount -t sysfs sysfs /sys
# Now /sys shows only the new namespace's network devices
```

## Implementation Details

### Mount Hash Table

Mounts are stored in a hash table keyed by the parent mount and the mountpoint dentry, enabling fast lookup:

```c
/* fs/mount.h */
#define MNT_HASH_MASK   0xFF
struct hlist_head mount_hashtable[MNT_HASH_MASK + 1];
```

### Mount Reference Counting

Mounts use reference counting to track usage across namespaces. When the last reference to a mount is dropped, it is freed. Mount propagation increases reference counts as mounts are shared across namespaces.

### __lookup_mnt()

```c
/* fs/namespace.c */
struct mount *__lookup_mnt(struct vfsmount *mnt, struct dentry *dentry)
{
    struct hlist_head *head = m_hash(mnt, dentry);
    struct mount *p;

    hlist_for_each_entry_rcu(p, head, mnt_hash) {
        if (&p->mnt_parent->mnt == mnt && p->mnt_mountpoint == dentry)
            return p;
    }
    return NULL;
}
```

## Systemd and Mount Namespaces

Systemd uses mount namespaces extensively:

- **PrivateTmp**: Each service gets a private `/tmp` via mount namespace
- **ProtectSystem**: Mounts `/usr` read-only in the service's namespace
- **ReadWritePaths/ReadOnlyPaths**: Controls mount visibility per service

```ini
# /etc/systemd/system/myservice.service
[Service]
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/myapp
```

## Debugging Mount Namespaces

### Listing Mounts in a Namespace

```bash
# Show mounts for a specific process
cat /proc/<pid>/mountinfo

# Count mounts in a namespace
wc -l /proc/<pid>/mountinfo

# Compare namespaces
diff <(cat /proc/1/mountinfo) <(cat /proc/<pid>/mountinfo)
```

### Finding Namespace Relationships

```bash
# Show namespace IDs
ls -la /proc/*/ns/mnt

# Two processes in same namespace?
readlink /proc/1/ns/mnt
readlink /proc/<pid>/ns/mnt
# Same inode number = same namespace
```

### nsenter

```bash
# Enter a process's mount namespace
nsenter --mount --target <pid> bash

# Enter multiple namespaces
nsenter --mount --pid --net --target <pid> bash
```

### Common Issues

- **Mounts leaking**: Shared propagation causing unexpected mount visibility
- **Missing mounts**: Slave propagation not configured; namespace created with private mounts
- **Cannot unmount**: Mount has children or is shared; use `MNT_DETACH` for lazy unmount
- **Permission denied**: Mount requires `CAP_SYS_ADMIN` in the relevant user namespace

## Security Considerations

- Mount namespaces alone do not restrict access to block devices; combine with device cgroups
- Shared mounts can leak host mount information into container namespaces
- Bind mounts of `/proc` or `/sys` can expose host information; always remount
- Unbindable mounts prevent namespace escape via bind mount attacks
- The `nosuid`, `nodev`, and `noexec` mount options should be used in container mount namespaces

## References

- [Mount namespaces man page](https://man7.org/linux/man-pages/man7/mount_namespaces.7.html)
- [Linux kernel source: fs/namespace.c](https://github.com/torvalds/linux/blob/master/fs/namespace.c)
- [LWN: Mount propagation](https://lwn.net/Articles/690679/)
- [LWN: A deeper look at mount namespaces](https://lwn.net/Articles/689671/)
- [Kernel documentation: sharedsubtree.txt](https://www.kernel.org/doc/html/latest/filesystems/sharedsubtree.txt)

## Further Reading

- **Kernel documentation**: `Documentation/filesystems/sharedsubtree.txt`
- **Kernel documentation**: `Documentation/admin-guide/namespaces/compatibility-lists.rst`
- **LWN article**: ["Mount propagation"](https://lwn.net/Articles/690679/)
- **LWN article**: ["A deeper look at mount namespaces"](https://lwn.net/Articles/689671/)
- **man pages**: `mount_namespaces(7)`, `mount(2)`, `unshare(2)`, `setns(2)`
- **Source**: `fs/namespace.c` — mount namespace implementation
- **Related**: [Network Namespaces](./network-namespaces.md) — network isolation
- **Related**: [PID Namespaces](./pid-namespaces.md) — process ID isolation
- **Related**: [User Namespaces](./user-namespaces.md) — UID/GID mapping
- **Related**: [Cgroups](../../cgroups/cgroups.md) — resource isolation companion
