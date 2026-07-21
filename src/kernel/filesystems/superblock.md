# Superblock

## Introduction

The superblock is one of the most fundamental data structures in the Linux Virtual File System (VFS). It represents a mounted filesystem instance and contains all the metadata needed to manage that instance: filesystem type, block size, state flags, and pointers to operations. Every mounted filesystem — whether ext4, XFS, btrfs, NFS, or tmpfs — has exactly one superblock structure in kernel memory for each mount.

The superblock serves as the anchor point from which the entire filesystem tree is traversed. When you run `mount`, the kernel creates a superblock (or reuses an existing one), reads the on-disk superblock structure into memory, and initializes the VFS `struct super_block` accordingly.

## The `struct super_block`

### Definition

```c
/* Simplified from include/linux/fs.h */
struct super_block {
    struct list_head    s_list;           /* List of all super_blocks */
    dev_t               s_dev;            /* Device identifier */
    unsigned char       s_blocksize_bits; /* Block size in bits */
    unsigned long       s_blocksize;      /* Block size in bytes */
    loff_t              s_maxbytes;       /* Max file size */
    struct file_system_type *s_type;      /* Filesystem type */
    const struct super_operations *s_op;  /* Superblock operations */
    struct dentry       *s_root;          /* Root dentry */
    struct rw_semaphore  s_umount;        /* Unmount semaphore */
    atomic_t             s_active;        /* Active reference count */
    struct block_device *s_bdev;          /* Backing block device */
    void                *s_fs_info;       /* Filesystem-specific info */
    unsigned long        s_flags;         /* Mount flags */
    unsigned long        s_iflags;        /* Internal SB flags */
    struct hlist_bl_head s_roots;         /* Cached root dentries */
    struct list_head     s_inodes;        /* All inodes on this SB */
    spinlock_t           s_inode_list_lock;
    struct list_head     s_mounts;        /* Mount objects */
    /* ... many more fields ... */
};
```

### Key Fields

| Field | Purpose |
|-------|---------|
| `s_type` | Pointer to `file_system_type` (e.g., `ext4_fs_type`) |
| `s_op` | VFS-callable operations (`alloc_inode`, `destroy_inode`, `sync_fs`, etc.) |
| `s_root` | The root dentry — entry point to the filesystem tree |
| `s_bdev` | Block device this filesystem lives on (NULL for virtual FS) |
| `s_fs_info` | Filesystem-private data (e.g., `struct ext4_sb_info`) |
| `s_flags` | Mount flags: `MS_RDONLY`, `MS_NOEXEC`, `MS_NOSUID`, etc. |
| `s_blocksize` | Logical block size (typically 4096 bytes) |
| `s_maxbytes` | Maximum file size supported by this filesystem |
| `s_active` | Reference count; when it hits zero, the superblock is destroyed |

## `super_operations`

Each filesystem implements the `super_operations` interface:

```c
struct super_operations {
    struct inode *(*alloc_inode)(struct super_block *sb);
    void (*destroy_inode)(struct inode *);
    void (*dirty_inode)(struct inode *, int flags);
    int (*write_inode)(struct inode *, struct writeback_control *wbc);
    int (*drop_inode)(struct inode *);
    void (*evict_inode)(struct inode *);
    void (*put_super)(struct super_block *);
    int (*sync_fs)(struct super_block *sb, int wait);
    int (*freeze_super)(struct super_block *);
    int (*freeze_fs)(struct super_block *);
    int (*thaw_super)(struct super_block *);
    int (*unfreeze_fs)(struct super_block *);
    int (*statfs)(struct dentry *, struct kstatfs *);
    int (*remount_fs)(struct super_block *, int *, char *);
    void (*umount_begin)(struct super_block *);
    int (*show_options)(struct seq_file *, struct dentry *);
    /* ... */
};
```

### Operation Descriptions

| Operation | When Called | Typical Behavior |
|-----------|------------|------------------|
| `alloc_inode` | When a new inode is needed | Allocate FS-specific inode struct (includes `struct inode`) |
| `destroy_inode` | When inode refcount reaches zero | Free the FS-specific inode struct |
| `dirty_inode` | When an inode is modified | Mark inode as needing writeback (e.g., set `I_DIRTY`) |
| `write_inode` | During writeback (pdflush/buffer flush) | Write inode metadata to disk |
| `drop_inode` | When `iput()` is called | Return 1 to delete inode, 0 to cache it |
| `evict_inode` | When inode is being evicted from cache | Truncate file, free blocks, remove from inode hash |
| `put_super` | During `umount` | Release FS-specific superblock info, flush data |
| `sync_fs` | During `sync(2)` or `fsync` on a file | Flush all dirty metadata and data to disk |
| `freeze_super` | `fsfreeze` command | Quiesce the filesystem (stop writes) for snapshots |
| `thaw_super` | After freeze | Resume normal operations |
| `statfs` | `statfs(2)` / `df` command | Report filesystem statistics (blocks free, total, etc.) |
| `remount` | `mount -o remount` | Change mount options without unmounting |
| `show_options` | `/proc/mounts` read | Display current mount options |

### Example: ext4 super_operations

```c
static const struct super_operations ext4_sops = {
    .alloc_inode    = ext4_alloc_inode,
    .destroy_inode  = ext4_destroy_inode,
    .dirty_inode    = ext4_dirty_inode,
    .write_inode    = ext4_write_inode,
    .drop_inode     = ext4_drop_inode,
    .evict_inode    = ext4_evict_inode,
    .put_super       = ext4_put_super,
    .sync_fs        = ext4_sync_fs,
    .freeze_super   = ext4_freeze,
    .thaw_super     = ext4_unfreeze,
    .statfs         = ext4_statfs,
    .remount_fs     = ext4_remount,
    .show_options   = ext4_show_options,
};
```

## Superblock Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Allocated: mount(2) syscall
    Allocated --> Initialized: read_super() / fill_super()
    Initialized --> Active: s_root dentry created
    Active --> Active: normal I/O operations
    Active --> ReadOnly: remount(ro) or error
    ReadOnly --> Active: remount(rw)
    Active --> Frozen: freeze_super()
    Frozen --> Active: thaw_super()
    Active --> Unmounting: umount(2)
    Unmounting --> Destroyed: put_super() + s_active → 0
    Destroyed --> [*]
```

### Mount: Creating a Superblock

When `mount(2)` is called:

1. **Lookup filesystem type** — VFS searches its registered `file_system_type` list
2. **Check existing superblock** — If the same device is already mounted, reuse its superblock (for bind mounts or additional mountpoints)
3. **Allocate superblock** — `sget()` allocates a new `struct super_block`
4. **Call `fill_super`** — The filesystem-specific function reads the on-disk superblock, validates it, initializes `s_fs_info`, sets up `s_op`, and creates the root inode/dentry

```c
/* Simplified mount flow in VFS */
int vfs_get_super(struct fs_context *fc,
                  enum vfs_get_super_keying keying,
                  int (*fill_super)(struct super_block *sb,
                                    struct fs_context *fc)) {
    struct super_block *s;

    /* sget_fc() finds or creates a superblock */
    s = sget_fc(fc, test_key, set_key);
    if (IS_ERR(s))
        return PTR_ERR(s);

    if (!s->s_root) {
        /* New superblock — call filesystem's fill_super */
        int error = fill_super(s, fc);
        if (error) {
            deactivate_super(s);
            return error;
        }
        s->s_flags |= SB_ACTIVE;
    }
    /* ... create mount object and attach ... */
}
```

### Unmount: Destroying a Superblock

```mermaid
sequenceDiagram
    participant U as User (umount)
    participant VFS as VFS
    participant SB as Superblock
    participant FS as Filesystem

    U->>VFS: umount("/mnt/data")
    VFS->>VFS: Check for busy inodes/dentries
    VFS->>SB: s_active decremented
    SB->>FS: sync_fs(sb, 1) — flush all dirty data
    SB->>FS: put_super(sb) — release FS-specific info
    SB->>VFS: Free s_fs_info, block device
    SB->>VFS: Remove from super_blocks list
    VFS->>U: Success
```

If there are still-open files or working directories under the mount, `umount` fails with `EBUSY` (unless lazy unmount with `MNT_DETACH` is used).

## Superblock and Inode Relationship

Every inode belongs to exactly one superblock. The superblock tracks all its inodes:

```mermaid
graph TB
    SB[super_block] --> |"s_op → alloc_inode/destroy_inode"| INO1[inode 1]
    SB --> INO2[inode 2]
    SB --> INO3[inode 3]
    SB --> |"s_root"| ROOT[root dentry]
    INO1 --> |"i_sb → back-pointer"| SB
    INO2 --> |"i_sb"| SB
    INO3 --> |"i_sb"| SB
    SB --> |"s_list"| SB_LIST["Global list of all super_blocks"]
```

```bash
# View all superblocks in /proc
$ cat /proc/filesystems
nodev   sysfs
nodev   tmpfs
        ext4
        xfs
        btrfs

# See mounted superblocks
$ cat /proc/mounts
# or
$ mount -t ext4,xfs
```

## Sync and Writeback

### Global Sync

```bash
# Force all filesystems to flush dirty data
$ sync

# This triggers sync_fs() on every active superblock
# Also triggered by: reboot, halt, sysrq
```

### Per-Filesystem Sync

```bash
# syncfs(2) — sync only one filesystem
$ python3 -c "
import os, ctypes
fd = os.open('/mnt/data', os.O_RDONLY)
ctypes.CDLL('libc.so.6').syncfs(fd)
os.close(fd)
"
```

### Kernel Background Writeback

The kernel periodically writes back dirty data:

```bash
# Writeback tunables (in /proc/sys/vm/)
$ sysctl vm.dirty_ratio          # % of RAM allowed dirty before sync
vm.dirty_ratio = 20
$ sysctl vm.dirty_background_ratio  # % of RAM before background writeback
vm.dirty_background_ratio = 10
$ sysctl vm.dirty_expire_centisecs  # Dirty data older than this is written
vm.dirty_expire_centisecs = 3000
$ sysctl vm.dirty_writeback_centisecs  # How often writeback threads wake
vm.dirty_writeback_centisecs = 500
```

### Freeze/Thaw

Filesystem freeze is used for consistent snapshots:

```bash
# Freeze the filesystem (quiesce all writes)
$ fsfreeze --freeze /mnt/data

# Take a snapshot (LVM, device mapper, etc.)
$ lvcreate --snapshot --size=1G --name=snap /dev/vg0/data

# Thaw the filesystem (resume writes)
$ fsfreeze --unfreeze /mnt/data
```

Internally, `fsfreeze` calls `freeze_super()` → `freeze_fs()` on the superblock, which blocks all new write I/O until thaw.

## Superblock Flags

```c
/* Mount flags (s_flags) */
#define SB_RDONLY       1       /* Read-only mount */
#define SB_NOSUID       2       /* Ignore suid/sgid bits */
#define SB_NODEV        4       /* Disallow device access */
#define SB_NOEXEC       8       /* Disallow program execution */
#define SB_SYNCHRONOUS  16      /* Writes are synchronous */
#define SB_MANDLOCK     64      /* Mandatory locking */
#define SB_DIRSYNC      128     /* Directory modifications synchronous */
#define SB_NOATIME      1024    /* Don't update access times */
#define SB_NODIRATIME   2048    /* Don't update directory access times */
#define SB_SILENT       32768   /* Suppress kernel messages */
```

```bash
# View flags for a mounted filesystem
$ cat /proc/mounts | grep " / "
/dev/sda1 / ext4 rw,relatime,errors=remount-ro 0 0

# The flags after the options are the superblock flags
# rw → SB_RDONLY is NOT set
```

## Filesystem Registration

Each filesystem type registers a `file_system_type` structure:

```c
struct file_system_type {
    const char *name;
    int fs_flags;
    int (*init_fs_context)(struct fs_context *);
    const struct fs_parameter_spec *parameters;
    struct dentry *(*mount)(struct file_system_type *, int,
                            const char *, void *);
    void (*kill_sb)(struct super_block *);
    struct module *owner;
    struct file_system_type *next;
    struct hlist_head fs_supers;  /* All superblocks of this type */
};

/* Example: ext4 */
static struct file_system_type ext4_fs_type = {
    .owner      = THIS_MODULE,
    .name       = "ext4",
    .init_fs_context = ext4_init_fs_context,
    .parameters = ext4_param_specs,
    .kill_sb    = kill_block_super,
    .fs_flags   = FS_REQUIRES_DEV,
};
```

## References

- [VFS documentation](https://www.kernel.org/doc/html/latest/filesystems/vfs.html)
- [Superblock operations](https://www.kernel.org/doc/html/latest/filesystems/vfs.html#superblock-operations)
- [include/linux/fs.h source](https://github.com/torvalds/linux/blob/master/include/linux/fs.h)

## Further Reading

- https://www.kernel.org/doc/html/latest/filesystems/vfs.html
- https://www.kernel.org/doc/html/latest/filesystems/ext4/super.html
- https://lwn.net/Articles/576276/ — "A new kernel mount API"
- https://man7.org/linux/man-pages/man2/mount.2.html
- https://man7.org/linux/man-pages/man2/sync.2.html

## Related Topics

- [inode](./inode.md) — Inodes are children of the superblock
- [file-ops](./file-ops.md) — File operations work with inodes from the superblock
- [mounting](./mounting.md) — How superblocks are created during mount
- [overlayfs](./overlayfs.md) — OverlayFS superblock management
