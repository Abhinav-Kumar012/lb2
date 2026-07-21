# ext4 Filesystem

## Introduction

ext4 (fourth extended filesystem) is the default filesystem for most Linux distributions. It evolved
from ext3 (which added journaling to ext2), with major additions including extent-based block
allocation, delayed allocation, nanosecond timestamps, and support for very large filesystems (up
to 1 EiB). ext4 is a mature, battle-tested filesystem that balances performance, reliability, and
feature richness.

ext4 was merged into the mainline kernel in 2006 (2.6.19) and became stable in 2.6.28. It remains
the workhorse filesystem for desktops, servers, and embedded systems alike.

## On-Disk Layout

An ext4 filesystem is divided into block groups, each containing a chunk of data blocks plus
metadata to manage them:

```
┌─────────┬──────────┬──────────┬─────────┬──────────────────┬──────────┐
│   Boot  │  Group   │  Group   │  Block  │     Inode        │   Data   │
│  Block  │  Desc 0  │  Desc 1  │  Bitmap │     Bitmap       │  Blocks  │
│ (1024B) │  Table   │  ...     │         │                  │          │
└─────────┴──────────┴──────────┴─────────┴──────────────────┴──────────┘
```

### Block Groups

Each block group contains:

- **Superblock**: Copy of the filesystem superblock (for redundancy)
- **Group descriptors**: Metadata about each block group
- **Block bitmap**: Tracks which blocks in this group are allocated
- **Inode bitmap**: Tracks which inodes in this group are allocated
- **Inode table**: Array of on-disk inodes
- **Data blocks**: Actual file data

```c
/* ext4 group descriptor */
struct ext4_group_desc {
    __le32  bg_block_bitmap_lo;       /* Block bitmap block */
    __le32  bg_inode_bitmap_lo;       /* Inode bitmap block */
    __le32  bg_inode_table_lo;        /* Inode table block */
    __le16  bg_free_blocks_count_lo;  /* Free blocks count */
    __le16  bg_free_inodes_count_lo;  /* Free inodes count */
    __le16  bg_used_dirs_count_lo;    /* Directories count */
    __le16  bg_flags;                 /* EXT4_BG_flags */
    __le32  bg_exclude_bitmap_lo;     /* Snapshot exclusion bitmap */
    __le16  bg_block_bitmap_csum_lo;  /* crc32c(s_uuid+grp_num+bitmap) */
    __le16  bg_inode_bitmap_csum_lo;
    __le32  bg_itable_unused_lo;      /* Unused inodes count */
    __le16  bg_checksum;              /* crc16(s_uuid+group_num+desc) */
    /* 64-bit fields follow for 64-bit feature */
    __le32  bg_block_bitmap_hi;
    __le32  bg_inode_bitmap_hi;
    __le32  bg_inode_table_hi;
    __le16  bg_free_blocks_count_hi;
    __le16  bg_free_inodes_count_hi;
    __le16  bg_used_dirs_count_hi;
    __le16  bg_itable_unused_hi;
    __le32  bg_exclude_bitmap_hi;
    __le16  bg_block_bitmap_csum_hi;
    __le16  bg_inode_bitmap_csum_hi;
    __u32   bg_reserved;
};
```

### Flexible Block Groups (flex_bg)

With `flex_bg` enabled, metadata (bitmaps, inode tables) from multiple block groups is stored
together in the first group of the "flex group." This improves sequential read performance for
metadata-heavy operations:

```mermaid
graph LR
    subgraph "Flex Group 0 (4 block groups)"
        BG0["Block Group 0<br/>ALL bitmaps<br/>ALL inode tables<br/>Data blocks"]
        BG1["Block Group 1<br/>Data blocks only"]
        BG2["Block Group 2<br/>Data blocks only"]
        BG3["Block Group 3<br/>Data blocks only"]
    end
```

## Extent-Based Block Mapping

The most significant improvement in ext4 over ext3 is extent-based block mapping. Instead of
storing individual block numbers (indirect blocks), ext4 stores extents — contiguous runs of
blocks:

```c
/* On-disk extent structure */
struct ext4_extent {
    __le32  ee_block;      /* First logical block covered */
    __le16  ee_len;        /* Number of blocks covered (max 32768) */
    __le16  ee_start_hi;   /* Upper 16 bits of physical block */
    __le32  ee_start_lo;   /* Lower 32 bits of physical block */
};

/* Extent index — points to an extent block */
struct ext4_extent_idx {
    __le32  ei_block;      /* First logical block covered by this index */
    __le32  ei_leaf_lo;    /* Lower 32 bits of extent block */
    __le16  ei_leaf_hi;    /* Upper 16 bits of extent block */
    __le16  ei_unused;
};

/* Extent header — at the start of each extent block */
struct ext4_extent_header {
    __le16  eh_magic;      /* 0xF30A */
    __le16  eh_entries;    /* Number of valid entries */
    __le16  eh_max;        /* Capacity of store in entries */
    __le16  eh_depth;      /* Depth of tree (0 = leaf node) */
    __le32  eh_generation; /* Generation for snapshots */
};
```

### Extent Tree Structure

The extent tree is stored in `i_block[]` (the 60 bytes of the inode that were used for indirect
blocks in ext2/ext3):

```mermaid
graph TD
    subgraph "Inode (i_block[15])"
        EH["Extent Header<br/>depth=1, entries=3"]
        IDX0["Index: block 0 → Extent Block A"]
        IDX1["Index: block 10000 → Extent Block B"]
        IDX2["Index: block 50000 → Extent Block C"]
    end

    subgraph "Extent Block A"
        EA_H["Header: depth=0, entries=2"]
        EA_E0["Extent: blocks 0-999 → physical 50000-50999"]
        EA_E1["Extent: blocks 1000-4999 → physical 80000-83999"]
    end

    subgraph "Extent Block B"
        EB_H["Header: depth=0, entries=1"]
        EB_E0["Extent: blocks 10000-20000 → physical 200000-210000"]
    end

    subgraph "Extent Block C"
        EC_H["Header: depth=0, entries=3"]
        EC_E0["Extent: blocks 50000-55000 → physical 500000-505000"]
        EC_E1["Extent: blocks 55001-60000 → physical 600000-605000"]
        EC_E2["Extent: blocks 60001-65000 → physical 700000-705000"]
    end

    EH --> IDX0
    EH --> IDX1
    EH --> IDX2
    IDX0 --> EA_H
    IDX1 --> EB_H
    IDX2 --> EC_H
```

### Extent Advantages Over Indirect Blocks

| Property | Indirect Blocks | Extents |
|----------|----------------|---------|
| Storage for 1GB file | ~260 entries | ~1-4 extents |
| Sequential read overhead | Lookup each block | One extent lookup |
| Fragmentation tracking | Not possible | Per-extent |
| Max contiguous write | 12 blocks (direct) | 32768 blocks (128MB) |
| Metadata overhead | High for large files | Very low |

## Journaling (JBD2)

ext4 uses the JBD2 (Journaling Block Device 2) layer for metadata journaling. See
[Journaling](./journaling.md) for the complete treatment.

### Journal Modes

ext4 supports three journaling modes:

#### 1. `data=ordered` (default)

Metadata is journaled; data blocks are written to disk before the metadata commit. This ensures
that after a crash, you never see stale data in a newly created/truncated file.

```mermaid
sequenceDiagram
    participant App as Application
    participant JBD2 as Journal (JBD2)
    participant Data as Data Blocks
    participant Meta as Metadata Blocks

    App->>Data: Write data blocks
    Data-->>App: Data written
    App->>JBD2: Start transaction
    JBD2->>Meta: Record metadata changes in journal
    JBD2->>JBD2: Commit journal transaction
    JBD2->>Meta: Write metadata to final location
    Note over Data,Meta: Data is guaranteed on disk before metadata commit
```

#### 2. `data=writeback`

Metadata is journaled; data is written whenever the OS decides. Faster but may expose stale data
after a crash.

#### 3. `data=journal`

Both data and metadata are journaled. Safest but slowest — every write goes through the journal.

### Journal Structure

The journal is stored in a regular file or a dedicated inode (inode 8):

```bash
# View journal location
$ sudo tune2fs -l /dev/sda1 | grep "Journal inode"
Journal inode:            8

# Journal size
$ sudo tune2fs -l /dev/sda1 | grep "Journal size"
Journal size:             128M

# View journal status
$ sudo debugfs -R 'stat <8>' /dev/sda1
```

## Block Allocation: mballoc

The multi-block allocator (mballoc) is ext4's primary block allocator. It tries to allocate
contiguous blocks to improve performance:

### Allocation Strategy

```mermaid
flowchart TD
    A[Allocation Request: N blocks] --> B{Try goal allocation}
    B -->|Success| C[Return blocks near goal]
    B -->|Fail| D{Try buddy allocator}
    D -->|Success| E[Return contiguous blocks]
    D -->|Fail| F{Try near-past allocation}
    F -->|Success| G[Return blocks near previous allocation]
    F -->|Fail| H[Try any free blocks]
    H --> I[Return best available]
```

### Buddy Allocator

mballoc uses a buddy allocator within each block group. The buddy bitmap tracks free space at
different granularities (1, 2, 4, 8, ..., 2048 blocks):

```c
/* Simplified buddy allocator operation */
struct ext4_free_extent {
    ext4_lblk_t fe_logical;   /* Logical block number */
    ext4_grpblk_t fe_start;   /* Physical block within group */
    ext4_group_t fe_group;     /* Block group number */
    int fe_len;                /* Number of blocks */
};

/* Allocation path */
static int ext4_mb_find_by_goal(struct ext4_allocation_context *ac)
{
    /* Try to allocate near the goal position */
    struct ext4_free_extent ex;
    /* Search buddy bitmap for contiguous free extent */
    /* Prefer extents that align with the goal */
}
```

### Preallocation

ext4 uses preallocation to reduce fragmentation:

- **Per-inode preallocation**: When a file grows, extra blocks are preallocated beyond the current
  write position.
- **Per-group preallocation**: A pool of preallocated blocks is maintained per block group.
- **Directory preallocation**: Directories get extra blocks preallocated when created.

```bash
# View preallocation settings
$ cat /proc/sys/fs/ext4/ext4_mb_stream_req
16  # Threshold for streaming allocation

$ cat /proc/sys/fs/ext4/ext4_mb_order1_req
2   # Minimum blocks for order-1 allocation

$ cat /proc/sys/fs/ext4/ext4_mb_max_to_scan
200 # Max groups to scan before giving up
```

## Delayed Allocation

With delayed allocation (delalloc), ext4 does not allocate blocks immediately when data is written
to the page cache. Instead, it waits until writeback time (typically 30 seconds or when memory
pressure triggers dirty page writeback):

```mermaid
sequenceDiagram
    participant App as Application
    participant PC as Page Cache
    participant MB as mballoc
    participant Disk as Disk

    App->>PC: write(fd, buf, 1MB)
    PC->>PC: Mark pages dirty (no block allocation yet!)
    PC-->>App: Return 1MB

    Note over PC: ~30 seconds later...

    PC->>MB: Writeback: need blocks for 1MB
    MB->>MB: Find best contiguous extent
    MB-->>PC: Allocated 256 contiguous blocks
    PC->>Disk: Write 1MB to contiguous location
```

Benefits:
- Better allocation decisions (knows full write extent at allocation time)
- Fewer extents per file
- Reduced fragmentation

Risks:
- Data loss on crash if fsync not called (data in page cache but not on disk)
- This is the origin of the "ext4 data loss" controversy from 2009

## Online Defragmentation

ext4 supports online defragmentation through the `FALLOC_FL_DEFRAG` flag and the `e4defrag` tool:

```bash
# Defragment a single file
$ sudo e4defrag /path/to/fragmented/file

# Check fragmentation
$ sudo e4defrag -c /path/to/fragmented/file
  Total/best extents             127/12
  Average size per extent        32.1 KB
  Fragmentation score            38
  [0-30 no problem]: [31-55 file itself can be optimized]
  [56-74 defragment recommended]: [75-100 defragment urgently]

# Defragment entire filesystem
$ sudo e4defrag /mount/point
```

### Online Defrag Internals

```c
/* ext4 online defrag: exchange extents between temp and original file */
static int ext4_ext_swap_inode_data(handle_t *handle, struct inode *orig_inode,
                                     struct inode *donor_inode)
{
    /* 1. Allocate extents in donor file in optimal layout */
    /* 2. Copy data from original to donor */
    /* 3. Atomically swap extent trees */
    /* 4. Free original (now fragmented) extents */
}
```

## Filesystem Features and Options

### Feature Flags

```bash
# View filesystem features
$ sudo tune2fs -l /dev/sda1 | grep "Filesystem features"
Filesystem features: has_journal ext_attr resize_inode dir_index filetype
  needs_recovery extent flex_bg sparse_super large_file huge_file
  uninit_bg dir_nlink extra_isize

# Enable a feature
$ sudo tune2fs -O metadata_csum_seed /dev/sda1
```

### Common Mount Options

```bash
# View current mount options
$ mount | grep ext4
/dev/sda1 on / type ext4 (rw,relatime,errors=remount-ro)

# Common options in /etc/fstab
# /dev/sda1  /  ext4  defaults,noatime,commit=60  0  1
```

| Option | Effect |
|--------|--------|
| `noatime` | Don't update access time (performance boost) |
| `data=ordered` | Default journaling mode |
| `data=writeback` | Faster but less safe |
| `journal_data` | Full data journaling |
| `commit=60` | Journal commit interval (seconds, default 5) |
| `discard` | Issue TRIM commands to SSDs |
| `nodelalloc` | Disable delayed allocation |
| `barrier=0` | Disable write barriers (dangerous!) |

## Tuning and Optimization

### Key sysfs/debugfs Parameters

```bash
# Block allocation tuning
$ cat /proc/sys/fs/ext4/ext4_mb_min_to_scan    # Min groups scanned
$ cat /proc/sys/fs/ext4/ext4_mb_max_to_scan    # Max groups scanned
$ cat /proc/sys/fs/ext4/ext4_mb_order1_req     # Order-1 allocation threshold

# Journal tuning
$ sudo tune2fs -J size=256 /dev/sda1           # Resize journal
$ sudo tune2fs -o journal_data_writeback /dev/sda1

# inode cache
$ sudo tune2fs -i 8192 /dev/sda1               # inode-to-blocks ratio

# Reserved blocks (default 5%)
$ sudo tune2fs -m 1 /dev/sda1                  # Reduce to 1% on large disks
```

### Performance Benchmarking

```bash
# Sequential write test
$ dd if=/dev/zero of=/mnt/test bs=1M count=1024 oflag=direct
1024+0 records in
1024+0 records out
1073741824 bytes (1.1 GB, 1.0 GiB) copied, 3.2 s, 335 MB/s

# Random read/write with fio
$ fio --name=random-write --ioengine=libaio --rw=randwrite \
    --bs=4k --numjobs=4 --size=1G --runtime=60 --direct=1 \
    --filename=/mnt/test/fio-test

# Metadata benchmark: creating many files
$ mkdir /mnt/test/files && cd /mnt/test/files
$ time for i in $(seq 1 100000); do touch file_$i; done
```

## fsck and Repair

```bash
# Check filesystem (unmounted)
$ sudo e2fsck -f /dev/sda1
e2fsck 1.47.0 (5-Feb-2023)
Pass 1: Checking inodes, blocks, and sizes
Pass 2: Checking directory structure
Pass 3: Checking directory connectivity
Pass 4: Checking reference counts
Pass 5: Checking group summary information
/dev/sda1: 248000/2621440 files (0.3% non-contiguous), 4500000/10485760 blocks

# Check without modifying (dry run)
$ sudo e2fsck -n /dev/sda1

# Resize an ext4 filesystem
$ sudo resize2fs /dev/sda1 50G    # Resize to 50GB
$ sudo resize2fs /dev/sda1        # Resize to fill partition
```

## Filesystem Creation

```bash
# Basic creation
$ sudo mkfs.ext4 /dev/sdb1

# With custom parameters
$ sudo mkfs.ext4 -t ext4 -b 4096 -i 4096 -L "data" -O \
    ^has_journal,extents,huge_file,flex_bg,uninit_bg,dir_nlink,extra_isize \
    /dev/sdb1

# Options explained:
# -b 4096       Block size (4096 is default and recommended)
# -i 4096       Bytes per inode (more inodes for many-small-files workloads)
# -L "data"     Volume label
# -O            Feature flags to enable (^ prefix disables)
```

## Block and Inode Allocation Policy

ext4 recognizes that data locality is a desirable quality for a filesystem. On spinning disks, keeping related blocks near each reduces head movement and speeds up I/O. On SSDs, locality increases transfer size per request and reduces total request count, potentially concentrating writes on single erase blocks for faster rewrites.

### Anti-Fragmentation Tricks

ext4 employs five key strategies to combat fragmentation:

1. **Multi-block allocator speculation**: When a file is first created, the block allocator speculatively allocates 8 KiB of disk space, assuming the space will be written soon. If correct (common for small files), the file data is written as a single multi-block extent.

2. **Delayed allocation**: When a file needs more blocks, the filesystem defers deciding exact disk placement until dirty buffers are written out. By not committing to placement until necessary (commit timeout, `sync()`, or memory pressure), ext4 makes better location decisions.

3. **Data-inode colocation**: ext4 tries to keep a file's data blocks in the same block group as its inode, reducing the seek penalty when reading the inode to find data blocks.

4. **Directory colocation**: All inodes in a directory are placed in the same block group when feasible, since files in a directory may be related.

5. **Block group spreading**: Directories created in the root directory are placed in the least heavily loaded block group, encouraging top-level directories to spread across the disk.

### e4defrag

If these mechanisms fail, `e4defrag` can defragment files:

```bash
# Check fragmentation
$ sudo e4defrag -c /path/to/file

# Defragment a single file
$ sudo e4defrag /path/to/file

# Defragment entire filesystem
$ sudo e4defrag /mount/point
```

## Snapshot Support (via LVM)

ext4 itself does not support snapshots, but they can be achieved through LVM:

```bash
# Create LVM snapshot
$ sudo lvcreate -s -n snap_root -L 5G /dev/vg0/root

# Mount snapshot for backup
$ sudo mount -o ro /dev/vg0/snap_root /mnt/snapshot

# Merge snapshot back (rollback)
$ sudo lvconvert --merge /dev/vg0/snap_root
```

## Common Operations

```bash
# View filesystem info
$ sudo tune2fs -l /dev/sda1

# Dump filesystem metadata
$ sudo dumpe2fs /dev/sda1 | less

# Debug filesystem interactively
$ sudo debugfs /dev/sda1
debugfs: ls /
debugfs: stat <2>
debugfs: blocks <2621441>

# Enable/disable features on live filesystem
$ sudo tune2fs -O metadata_csum /dev/sda1

# Fragmentation report
$ sudo filefrag -v /path/to/file
Filesystem type is: ef53
File size of /path/to/file is 1073741824 (262144 blocks of 4096 bytes)
 ext:     logical_offset:        physical_offset: length:   expected: flags:
   0:        0..   262143:      500000..    762143: 262144:
```

## Further Reading

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- [ext4 wiki (kernel.org)](https://ext4.wiki.kernel.org/) — Official ext4 documentation
- [ext4 Disk Layout](https://ext4.wiki.kernel.org/index.php/Ext4_Disk_Layout) — On-disk format specification
- [ext4 Howto](https://ext4.wiki.kernel.org/index.php/Ext4_Howto) — Usage guide
- [Linux kernel: fs/ext4/](https://elixir.bootlin.com/linux/latest/source/fs/ext4) — ext4 source code
- [Theodore Ts'o's blog](https://thunk.org/tytso/) — ext4 maintainer's writings
- [LWN: ext4 and delayed allocation](https://lwn.net/Articles/273912/) — Delalloc discussion

## Related Topics

- [VFS](./vfs.md) — The virtual filesystem layer
- [Inode](./inode.md) — Inode structure used by ext4
- [Dentry](./dentry.md) — Directory entry caching
- [Journaling](./journaling.md) — JBD2 journaling layer
- [procfs](./procfs.md) — /proc filesystem
- [sysfs](./sysfs.md) — /sys filesystem
