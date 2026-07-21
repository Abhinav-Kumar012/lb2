# Mounting

## Introduction

Mounting is the process of attaching a filesystem to a specific point in the Linux directory tree. The `mount(2)` system call is the fundamental operation that makes a filesystem's contents accessible at a path. Modern Linux mounting is far more complex than the simple "attach device to directory" model: it supports mount namespaces, bind mounts, propagation types, overlay mounts, and a rich security model.

The mount system call has evolved significantly. The legacy `mount(2)` is a single syscall with flags and data arguments. Linux 5.2+ introduced a new mount API (`fsopen`, `fsconfig`, `fsmount`, `move_mount`) that splits the operation into discrete steps, enabling better error handling and more complex configurations.

## The mount(2) System Call

### Legacy API

```c
#include <sys/mount.h>

int mount(const char *source, const char *target,
          const char *filesystemtype, unsigned long mountflags,
          const void *data);
```

**Parameters:**
- `source` — Device path, remote path, or NULL (for virtual filesystems)
- `target` — Directory where the filesystem will be mounted
- `filesystemtype` — Filesystem type string (e.g., "ext4", "tmpfs", "nfs")
- `mountflags` — Bitmask of mount flags
- `data` — Filesystem-specific options string

### Mount Flags

```c
#define MS_RDONLY        1      /* Mount read-only */
#define MS_NOSUID        2      /* Ignore suid/sgid bits */
#define MS_NODEV         4      /* Disallow access to device files */
#define MS_NOEXEC        8      /* Disallow program execution */
#define MS_SYNCHRONOUS   16     /* Writes are synchronous */
#define MS_REMOUNT       32     /* Remount existing mount */
#define MS_MANDLOCK      64     /* Enable mandatory locking */
#define MS_DIRSYNC       128    /* Directory modifications synchronous */
#define MS_NOATIME       1024   /* Don't update access times */
#define MS_NODIRATIME    2048   /* Don't update directory access times */
#define MS_BIND          4096   /* Bind mount */
#define MS_MOVE          8192   /* Move mount to new location */
#define MS_REC           16384  /* Recursive (for bind/rbind) */
#define MS_SILENT        32768  /* Suppress kernel messages */
#define MS_POSIXACL      (1<<16) /* POSIX ACLs */
#define MS_UNBINDABLE    (1<<17) /* Make unbindable */
#define MS_PRIVATE       (1<<18) /* Make private */
#define MS_SLAVE         (1<<19) /* Make slave */
#define MS_SHARED        (1<<20) /* Make shared */
#define MS_RELATIME      (1<<21) /* Update atime if older than mtime */
#define MS_KERNMOUNT     (1<<22) /* Kernel-internal mount */
#define MS_I_VERSION     (1<<23) /* Update inode i_version */
#define MS_STRICTATIME   (1<<24) /* Always update atime */
#define MS_LAZYTIME      (1<<25) /* Lazy atime updates */
```

### Example Mount Calls

```c
/* Mount ext4 */
mount("/dev/sda1", "/mnt/data", "ext4", MS_NOATIME, "errors=remount-ro");

/* Mount tmpfs */
mount("tmpfs", "/tmp", "tmpfs", MS_NOSUID | MS_NODEV, "size=2G,mode=1777");

/* Bind mount */
mount("/home/user/docs", "/mnt/docs", NULL, MS_BIND, NULL);

/* Recursive bind mount */
mount("/home/user", "/mnt/user", NULL, MS_BIND | MS_REC, NULL);

/* Remount read-only */
mount(NULL, "/mnt/data", NULL, MS_REMOUNT | MS_RDONLY, NULL);

/* NFS mount */
mount("server:/share", "/mnt/nfs", "nfs", 0, "vers=4.2,hard,rsize=1048576");
```

## The New Mount API (Linux 5.2+)

The new API splits mounting into discrete steps:

```c
#include <sys/syscall.h>
#include <linux/mount.h>

/* Step 1: Create a filesystem context */
int fs_fd = syscall(__NR_fsopen, "ext4", FSOPEN_CLOEXEC);

/* Step 2: Configure the filesystem */
syscall(__NR_fsconfig, fs_fd, FSCONFIG_SET_STRING, "source", "/dev/sda1", 0);
syscall(__NR_fsconfig, fs_fd, FSCONFIG_SET_STRING, "errors", "remount-ro", 0);
syscall(__NR_fsconfig, fs_fd, FSCONFIG_SET_FLAG, "noatime", NULL, 0);
syscall(__NR_fsconfig, fs_fd, FSCONFIG_CMD_CREATE, NULL, NULL, 0);

/* Step 3: Create a mount object */
int mnt_fd = syscall(__NR_fsmount, fs_fd, FSMOUNT_CLOEXEC, MS_NOATIME);

/* Step 4: Attach to the directory tree */
syscall(__NR_move_mount, mnt_fd, "", AT_FDCWD, "/mnt/data",
        MOVE_MOUNT_F_EMPTY_PATH);
```

### New API Advantages

```mermaid
graph LR
    subgraph "Legacy mount(2)"
        L1["mount(source, target, type, flags, data)"]
        L2["All-or-nothing: success or error"]
    end
    subgraph "New Mount API"
        N1["fsopen(type) → fd"]
        N2["fsconfig(fd, key, value)"]
        N3["fsconfig(fd, key, value)"]
        N4["fsconfig(fd, CMD_CREATE)"]
        N5["fsmount(fd) → mnt_fd"]
        N6["move_mount(mnt_fd, target)"]
        N1 --> N2 --> N3 --> N4 --> N5 --> N6
    end
```

Benefits:
- **File descriptor based**: Mount objects are FDs, can be passed between processes
- **Better error reporting**: Each step can fail independently
- **Atomic configuration**: Options are accumulated before creation
- **Superseded source**: Can change source without re-mounting
- **Open-tree**: `open_tree()` to manipulate existing mounts

## Bind Mounts

Bind mounts make a directory or file visible at another location:

```bash
# Basic bind mount
mount --bind /source/dir /target/dir

# Bind mount a single file
mount --bind /etc/hostname /mnt/hostname

# Recursive bind mount (includes sub-mounts)
mount --rbind /source/dir /target/dir

# Read-only bind mount
mount --bind /source/dir /target/dir
mount -o remount,ro,bind /target/dir

# Equivalent to:
mount --bind --read-only /source/dir /target/dir
```

### Bind Mount Use Cases

```mermaid
graph TB
    subgraph "Container / Chroot"
        C1["/container"]
        C2["/container/bin"]
        C3["/container/lib"]
        C4["/container/etc"]
    end
    subgraph "Host System"
        H1["/usr/bin"]
        H2["/usr/lib"]
        H3["/etc"]
    end
    H1 -->|bind mount| C2
    H2 -->|bind mount| C3
    H3 -->|bind mount| C4
```

```bash
# Make /usr available in a chroot
mount --bind /usr /chroot/usr

# Overlay config files in a container
mount --bind /host/config/app.conf /container/etc/app.conf

# Share a directory between containers
mount --bind /shared/data /container1/data
mount --bind /shared/data /container2/data
```

## Mount Namespaces

Mount namespaces provide isolated views of the filesystem hierarchy. They are the foundation of containers.

### Creating a Mount Namespace

```bash
# unshare: create a new mount namespace
$ sudo unshare --mount /bin/bash

# In the new namespace, mount/unmount without affecting the host
$ mount -t tmpfs tmpfs /mnt
$ ls /mnt
# Only visible in this namespace

# In another terminal (original namespace):
$ ls /mnt
# Empty — the tmpfs mount is not visible here
```

### Mount Namespace Diagram

```mermaid
graph TB
    subgraph "Initial Namespace (PID 1)"
        M1["/ (rootfs)"]
        M2["/dev"]
        M3["/proc"]
        M4["/sys"]
        M5["/mnt/data"]
    end
    subgraph "New Namespace (container)"
        N1["/ (rootfs — shared initially)"]
        N2["/dev — devtmpfs"]
        N3["/proc — procfs"]
        N4["/sys — sysfs"]
        N5["/mnt/data — private"]
        N6["/app — overlayfs"]
    end
    M1 -.->|shared| N1
    N5 -.->|propagation: private| N5
```

### Mount Propagation

Mount propagation controls how mount and unmount events are shared between namespaces:

```mermaid
graph TD
    subgraph "Propagation Types"
        SHARED["Shared<br/>Events propagate bidirectionally"]
        PRIVATE["Private<br/>No propagation"]
        SLAVE["Slave<br/>One-way: parent → child"]
        UNBINDABLE["Unbindable<br/>Cannot be bind-mounted"]
    end
```

| Propagation | Behavior |
|-------------|----------|
| **shared** | Mount/unmount events propagate to peer mounts and vice versa |
| **private** | No events propagate in either direction |
| **slave** | Receives events from master, but doesn't propagate back |
| **unbindable** | Cannot be the source of a bind mount |

```bash
# View propagation types
$ findmnt -o TARGET,PROPAGATION
TARGET                        PROPAGATION
/                             shared
├─/proc                       shared
├─/dev                        shared
├─/sys                        shared
├─/run                        shared
└─/mnt/data                   private

# Change propagation type
mount --make-private /mnt/data
mount --make-shared /mnt/data
mount --make-slave /mnt/data
mount --make-unbindable /mnt/data

# Recursive propagation change
mount --make-rshared /
mount --make-rprivate /mnt
```

### Propagation in Container Runtimes

```bash
# Docker/Podman typically:
# 1. Create a new mount namespace
# 2. Set root to private propagation
# 3. Pivot root to new rootfs
# 4. Mount /proc, /sys, /dev as shared (for device hotplug)

# Example: container mount setup
unshare --mount --propagation private -- /bin/bash
mount --make-rprivate /
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
pivot_root /new_root /new_root/old_root
umount -l /old_root
```

## Remounting

```bash
# Remount read-only
mount -o remount,ro /mnt/data

# Remount with different options
mount -o remount,noatime,nodiratime /mnt/data

# Remount a bind mount
mount -o remount,bind,ro /mnt/docs

# Cannot change certain things via remount:
# - filesystem type
# - source device (use bind mount instead)
# - Some flags require full unmount+mount
```

## umount

```bash
# Unmount a filesystem
umount /mnt/data

# Lazy unmount (detach immediately, cleanup later)
umount -l /mnt/data

# Force unmount (even if busy — for NFS)
umount -f /mnt/nfs

# Unmount by device
umount /dev/sda1

# Unmount all filesystems of a type
umount -t nfs

# Recursive unmount (all mounts under a path)
umount -R /mnt/namespace
```

### What Happens During umount

```mermaid
sequenceDiagram
    participant U as User
    participant VFS as VFS
    participant FS as Filesystem
    participant SB as Superblock

    U->>VFS: umount("/mnt/data")
    VFS->>VFS: Check for busy inodes/dentries
    alt Busy
        VFS-->>U: EBUSY (open files or cwd)
    else Not busy
        VFS->>FS: sync_fs(sb, 1)
        VFS->>SB: Decrement s_active
        SB->>FS: put_super(sb)
        FS->>FS: Release resources
        VFS->>VFS: Remove mount from tree
        VFS-->>U: Success
    end
```

## /proc and /sys Mount Information

```bash
# View all mounts
$ cat /proc/mounts
# or
$ cat /proc/self/mountinfo

# mountinfo format (11 fields + optional):
# 36 35 98:0 /mnt1 /mnt2 rw,noatime master:1 - ext4 /dev/root rw,errors=continue

# Field meanings:
# 1: mount ID
# 2: parent mount ID
# 3: major:minor device numbers
# 4: root (path of mount within the filesystem)
# 5: mount point
# 6: mount options
# 7: optional fields (propagation, etc.)
# 8: separator (-)
# 9: filesystem type
# 10: source device
# 11: superblock options

# Find mount for a specific path
$ findmnt /mnt/data
TARGET    SOURCE    FSTYPE OPTIONS
/mnt/data /dev/sda1 ext4   rw,noatime,errors=remount-ro

# Find mount by device
$ findmnt -S /dev/sda1
```

## Implementation Details

### Key Source Files

- **`fs/namespace.c`** — Mount system calls and mount tree management (~4500 lines)
- **`fs/seq_file.c`** — `/proc/mounts` output
- **`include/linux/mount.h`** — Mount structure definitions
- **`include/uapi/linux/mount.h`** — User-visible mount flags

### Mount Structure

```c
/* Simplified from include/linux/mount.h */
struct vfsmount {
    struct dentry *mnt_root;        /* Root dentry of this mount */
    struct super_block *mnt_sb;     /* Superblock for this mount */
    int mnt_flags;                  /* Mount flags */
};

struct mount {
    struct hlist_node mnt_hash;     /* Hash table entry */
    struct mount *mnt_parent;       /* Parent mount */
    struct dentry *mnt_mountpoint;  /* Dentry where mounted */
    struct vfsmount mnt;            /* VFS mount structure */
    struct list_head mnt_mounts;    /* Child mounts */
    struct list_head mnt_child;     /* Link in parent's mnt_mounts */
    struct list_head mnt_instance;  /* Link in sb->s_mounts */
    const char *mnt_devname;        /* Device name */
    struct list_head mnt_list;      /* Global list of mounts */
    struct mnt_namespace *mnt_ns;   /* Owning namespace */
    /* ... */
};
```

## References

- [mount(2) man page](https://man7.org/linux/man-pages/man2/mount.2.html)
- [Mount API documentation](https://www.kernel.org/doc/html/latest/filesystems/mount_api.html)
- [namespaces(7) man page](https://man7.org/linux/man-pages/man7/namespaces.7.html)

## Further Reading

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- https://man7.org/linux/man-pages/man2/mount.2.html
- https://man7.org/linux/man-pages/man7/mount_namespaces.7.html
- https://man7.org/linux/man-pages/man2/pivot_root.2.html
- https://man7.org/linux/man-pages/man2/umount.2.html
- https://lwn.net/Articles/759499/ — "A new API for mount handling"

## Related Topics

- [superblock](./superblock.md) — Each mount has a superblock
- [tmpfs](./tmpfs.md) — Commonly mounted virtual filesystem
- [overlayfs](./overlayfs.md) — Uses mount namespaces for container layering
- [fuse](./fuse.md) — FUSE mounts via fusermount
