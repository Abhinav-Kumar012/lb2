# UBIFS: Unsorted Block Image File System

## Overview

UBIFS (Unsorted Block Image File System) is a flash file system designed for **raw NAND flash** devices. It was developed by Nokia and the University of Szeged, and merged into the Linux kernel in 2008. UBIFS operates on top of UBI (Unsorted Block Images), which handles wear leveling and bad block management for raw NAND.

UBIFS is the successor to JFFS2, addressing many of its scalability limitations. While JFFS2 stores the entire file system structure in RAM and mounts slowly on large flash devices, UBIFS uses an on-flash index tree and scales to large flash sizes (multiple GiB).

### Key Characteristics

- Designed for raw NAND flash (not for eMMC/SD which have FTL)
- Operates on top of UBI layer
- Write-back caching (vs. JFFS2's write-through)
- On-flash indexing (B-tree) for fast mounting
- Compression support (LZO, zlib, zstd)
- Power-cut recovery
- Space accounting ("dark" and "free" space concepts)

## Architecture

```
┌───────────────────────────────────┐
│           VFS Layer               │
├───────────────────────────────────┤
│           UBIFS                   │
│  ┌──────────┬──────────────────┐  │
│  │ TNC      │ Journal          │  │
│  │ (B-tree) │ (commit)         │  │
│  ├──────────┴──────────────────┤  │
│  │ LEB Management              │  │
│  ├─────────────────────────────┤  │
│  │ Garbage Collector           │  │
│  ├─────────────────────────────┤  │
│  │ Compression (LZO/zlib/zstd) │  │
│  └─────────────────────────────┘  │
├───────────────────────────────────┤
│           UBI Layer               │
│  ┌─────────────────────────────┐  │
│  │ Wear Leveling               │  │
│  │ Bad Block Management        │  │
│  │ LEB ↔ PEB Mapping          │  │
│  └─────────────────────────────┘  │
├───────────────────────────────────┤
│         MTD (NAND Driver)         │
├───────────────────────────────────┤
│        Raw NAND Flash             │
└───────────────────────────────────┘
```

## UBI Layer

UBIFS depends on UBI (also covered in [UBI](../drivers/ubi.md)), which provides:

### Wear Leveling

NAND flash has a limited number of erase cycles per block (typically 10K–100K for SLC, 1K–10K for MLC). UBI distributes erases evenly across all physical erase blocks (PEBs) to prevent premature wear on any single block.

### Bad Block Management

NAND flash ships with known bad blocks and may develop more during its lifetime. UBI maintains a mapping table that hides bad PEBs from UBIFS, presenting only good logical erase blocks (LEBs).

### LEB ↔ PEB Mapping

UBI maintains a mapping from logical erase blocks (LEBs) seen by UBIFS to physical erase blocks (PEBs) on the flash. This mapping is dynamic and can change at any time due to wear leveling or scrub operations. UBIFS never knows the physical location of its data.

### UBI Volumes

UBIFS lives on a UBI volume. A UBI device can have multiple volumes, each presenting a contiguous range of LEBs:

```bash
# Create a UBI volume
ubinfo -a /dev/ubi0
ubimkvol /dev/ubi0 -N rootfs -s 200MiB
```

## On-Flash Layout

### Node Types

UBIFS stores data in several types of on-flash nodes:

- **Indexing nodes**: Internal nodes of the B-tree (TNC)
- **Data nodes**: Leaf nodes containing actual file data
- **Inode nodes**: File metadata (size, timestamps, permissions)
- **Dentry nodes**: Directory entries (file name → inode mapping)
- **Truncation nodes**: Record file truncations
- **Commit start node**: Marks beginning of a commit
- **Master node**: Two copies at fixed LEBs (LPT area), contains superblock info

### LEB Assignment

The flash is divided into several areas:

| Area | Purpose | LEBs |
|------|---------|------|
| LPT (LEB Property Tree) | Space accounting for all LEBs | Fixed |
| Orphan area | Orphaned inodes | Fixed |
| Main area | Data, inodes, index nodes, dentries | Majority |

### Superblock and Master Nodes

UBIFS has two master node LEBs (for redundancy). Each master node contains:

```c
struct ubifs_mst_node {
    __le64 highest_inum;      /* Highest inode number used */
    __le64 cmt_no;            /* Commit number */
    __le32 flags;             /* Various flags */
    __le32 log_lnum;          /* Start of log LEB */
    __le64 root_lnum;         /* LEB of B-tree root */
    __le32 root_offs;         /* Offset in LEB */
    __le32 root_len;          /* Length of root node */
    __le64 gc_lnum;           /* GC head LEB */
    __le32 gc_offs;           /* GC head offset */
    // ... more fields
};
```

## TNC: Tree Node Cache

The TNC is UBIFS's **B-tree index** that maps (inum, block, size) keys to on-flash locations. It is the core data structure for file lookups.

### Key Format

```c
/* UBIFS key: 64-bit, encodes inode number, block number, type */
union ubifs_key {
    uint8_t u8[UBIFS_MAX_KEY_LEN]; /* 8 bytes */
    /* Layout: [inum:32 | block:24 | type:8] (varies by type) */
};
```

### TNC Cache

The TNC is cached in RAM for fast lookups. On mount, UBIFS reads the entire index from flash into memory:

- **Hot nodes**: recently accessed, kept in RAM
- **Cold nodes**: evicted to save memory
- **LRU list**: manages the TNC cache eviction

The TNC cache is the reason UBIFS can mount faster than JFFS2—it doesn't need to scan the entire flash; it reads the index directly.

### TNC Operations

```c
/* Look up a key in the TNC */
int ubifs_tnc_lookup(struct ubifs_info *c, const union ubifs_key *key,
                     void *node);

/* Insert a node into the TNC */
int ubifs_tnc_add(struct ubifs_info *c, const union ubifs_key *key,
                  int lnum, int offs, int len, const uint8_t *hash);

/* Remove a node from the TNC */
int ubifs_tnc_remove(struct ubifs_info *c, const union ubifs_key *key);

/* Look up a range of keys */
int ubifs_tnc_lookup_range(struct ubifs_info *c,
                           const union ubifs_key *from,
                           const union ubifs_key *to,
                           union ubifs_key *key, void *node);
```

## Write-Back Caching

Unlike JFFS2 (which writes data synchronously), UBIFS implements **write-back caching**:

1. **Dirty data** is kept in the page cache.
2. **Periodic write-back** (`dirty_writeback_interval`, default 5s) flushes dirty pages.
3. **Sync** (`fsync`, `fdatasync`) forces data to flash.
4. **Write-back buffer** (`wbuf`): each LEB being written to has a write buffer that coalesces small writes into NAND page-sized writes.

### Write Buffer (wbuf)

NAND flash writes in page-sized units (typically 2 KiB or 4 KiB). UBIFS uses write buffers to avoid partial page writes:

```c
struct ubifs_wbuf {
    struct ubifs_info *c;
    void *buf;          /* Write buffer */
    int lnum;           /* Current LEB */
    int offs;           /* Current offset in LEB */
    int avail;          /* Available space */
    int used;           /* Used space */
    int size;           /* Buffer size (= min I/O unit) */
    spinlock_t lock;
    // ...
};
```

Small writes are buffered. When the buffer is full, it is written to flash in a single NAND page write. This improves performance significantly on NAND with large page sizes.

## Garbage Collection

UBIFS has a garbage collector (GC) that reclaims dirty space. Unlike JFFS2 which uses a log-structured approach, UBIFS uses a more traditional approach:

### How GC Works

1. Select a "dirty" LEB (one with both valid and obsolete nodes).
2. Copy all valid nodes from that LEB to a new LEB.
3. Update the TNC to point to the new locations.
4. Erase the old LEB and return it to the free pool.

### GC Head

UBIFS maintains a "GC head" LEB—the next LEB to be used for GC output. This is recorded in the master node.

### Dark Space

A unique UBIFS concept: **dark space** is the amount of space that would become available if the GC ran. It accounts for the fact that GC needs working space to copy data during reclaim.

```c
/* Free space calculation */
free = c->main_bytes - c->lst.taken_cnt * c->leb_size;
dark = c->lst.dark_cnt * c->leb_size;
available = free + dark - c->lst.idx_growth;
```

UBIFS guarantees that writes won't fail due to out-of-space by tracking both free and dark space and refusing writes when available space is too low.

## LEB Management

### LEB Properties

Each LEB has associated properties tracked in the LPT area:

```c
struct ubifs_lprops {
    int free;       /* Free bytes */
    int dirty;      /* Dirty bytes (obsolete data) */
    int flags;      /* LEB type and flags */
    int lnum;       /* LEB number */
};
```

### LEB Types

| Type | Purpose |
|------|---------|
| `UBIFS_DATA_LNODE` | Data nodes |
| `UBIFS_INO_LNODE` | Inode nodes |
| `UBIFS_DENT_LNODE` | Directory entry nodes |
| `UBIFS_IDX_NODE` | Index nodes |
| `UBIFS_GC_LNODE` | Garbage collector head |
| `UBIFS_LOG_LNODE` | Journal log |

### LPT (LEB Property Tree)

The LPT is a compact on-flash structure that tracks the state of every LEB. It has its own area of LEBs at the start of the flash, separate from the main area.

The LPT is loaded at mount time and kept in RAM, providing O(1) access to any LEB's properties. It is updated during commits.

## Journaling

UBIFS uses a **log** area for journaling. The log records changes that haven't been committed yet.

### Write Path

1. Write new data/index nodes to the main area.
2. Record the LEB/offset in the TNC (in RAM).
3. The write buffer ensures data is actually on flash.

### Commit Process

A commit freezes the current state and writes all dirty TNC nodes to flash:

1. **Sync the write buffers** — flush all pending data to flash.
2. **Write dirty TNC nodes** — update the on-flash index.
3. **Write the new master node** — atomically update the superblock.
4. **Free the log area** — old log entries are no longer needed.

Commits are triggered by:
- Timer (every 3–5 seconds, configurable)
- Sync request (fsync)
- Running out of log space
- Memory pressure

### Power-Cut Recovery

After an unclean shutdown, UBIFS replays the log:

1. Read the master node (two copies for redundancy).
2. Find the last committed state.
3. Replay any uncommitted changes from the log.
4. Rebuild the TNC from the on-flash index plus log replay.

This ensures that UBIFS is always consistent after a power cut, with at most a few seconds of data loss (the uncommitted writes).

## Compression

UBIFS supports transparent compression of data nodes:

### Supported Compressors

| Compressor | Speed | Ratio | Notes |
|------------|-------|-------|-------|
| LZO | Fast | Medium | Default, best for general use |
| zlib | Slow | High | Good for read-mostly data |
| zstd | Medium | High | Modern alternative to zlib |

### Per-Inode Compression

Compression can be set per-inode via extended attributes or mount options:

```bash
# Mount with zlib compression
mount -t ubifs -o compr=zlib ubi0:rootfs /mnt

# Per-file compression via chattr
chattr +c zlib file.txt   # (if supported)
```

### Compression Granularity

Each **data node** (containing one `max_write_size` chunk of data, typically 4 KiB–128 KiB) is compressed independently. This allows random reads without decompressing the entire file.

The compressor is selected at write time. If compression doesn't save space (compressed size ≥ original), the node is stored uncompressed.

## Mount Options

```bash
mount -t ubifs ubi0:rootfs /mnt

# Options:
#   compr=none|lzo|zlib|zstd  — compression algorithm
#   bulk_read=yes|no            — enable read-ahead
#   no_chk_data_crc             — skip CRC checks on data (faster reads)
#   chk_data_crc                — verify CRC on all data reads
#   no_chk_data_crc             — skip data CRC (speed vs integrity)
#   max_bud_bytes=N             — max size of uncommitted data
#   log_lebs=N                  — number of LEBs for the log
#   max_leb_cnt=N               — max number of LEBs (for sub-page writes)
```

## Usage Example

### Creating a UBIFS Image

```bash
# First, create a UBI image from a directory
mkfs.ubifs -r /path/to/rootfs -m 2048 -e 126976 -c 2048 -o rootfs.ubifs

# Parameters:
#   -m 2048     : min I/O size (NAND page size)
#   -e 126976   : logical erase block size
#   -c 2048     : max LEB count (volume size)
#   -o output   : output file

# Then, create a UBI image containing UBIFS
ubinize -o ubi.img -m 2048 -p 128KiB ubinize.cfg
```

The `ubinize.cfg`:

```ini
[rootfs]
mode=ubi
image=rootfs.ubifs
vol_id=0
vol_size=200MiB
vol_name=rootfs
vol_type=dynamic
```

### Flashing to NAND

```bash
# Using nandwrite
flash_erase /dev/mtd0 0 0
nandwrite -p /dev/mtd0 ubi.img

# Using UBI tools
ubiattach -m 0 -d 0
ubimkvol /dev/ubi0 -N rootfs -m
ubiupdatevol /dev/ubi0_0 ubi.img
```

### Runtime

```bash
# Mount
mount -t ubifs ubi0:rootfs /mnt

# Check space
df -h /mnt
ubinfo -a /dev/ubi0

# Force garbage collection (indirectly)
sync
echo 3 > /proc/sys/vm/drop_caches

# UBIFS debug info
cat /sys/kernel/debug/ubifs/ubifs0/stat
```

## Comparison with Other Flash File Systems

| Feature | UBIFS | JFFS2 | YAFFS2 | F2FS |
|---------|-------|-------|--------|------|
| Target | Raw NAND | Raw NAND | Raw NAND | eMMC/SSD |
| Index | On-flash B-tree | In-RAM | In-RAM | On-flash |
| Mount speed | Fast | Slow | Medium | Fast |
| Write-back | Yes | No (write-through) | No | Yes |
| Compression | LZO/zlib/zstd | zlib/lzo/rubin | No | LZO/zstd |
| Scalability | Good | Poor (RAM) | Medium | Good |
| Wear leveling | Via UBI | Via MTD | Via MTD | Via FTL |

## Source Files

- `fs/ubifs/` — UBIFS implementation
  - `super.c` — mount/unmount
  - `file.c` — file operations
  - `dir.c` — directory operations
  - `tnc.c` — Tree Node Cache (B-tree)
  - `gc.c` — garbage collector
  - `journal.c` — journal/log management
  - `lpt.c` — LEB Property Tree
  - `io.c` — I/O operations and write buffers
  - `compress.c` — compression framework
  - `replay.c` — log replay on mount
  - `commit.c` — commit process
  - `sb.c` — superblock handling
  - `master.c` — master node handling
  - `orphan.c` — orphan inode management
  - `budget.c` — space budget (dark space)
  - `log.c` — log area management
  - `misc.h` — utility functions

## Further Reading

- **Documentation/filesystems/ubifs.rst** — comprehensive UBIFS documentation
- **Documentation/filesystems/ubifs-authentication.rst** — UBIFS authentication support
- **UBIFS design document** — `Documentation/filesystems/ubifs-design.pdf` (if available)
- **UBI documentation** — `Documentation/mtd/ubi.rst`
- **UBIFS project page** — <https://www.linux-mtd.infradead.org/doc/ubifs.html>
- **LWN: UBIFS** — <https://lwn.net/Articles/276025/>
- **NAND Flash constraints** — understanding why UBIFS exists vs. generic block file systems

## See Also

- [UBI](../drivers/ubi.md) — UBI layer (wear leveling, bad block management)
- [JFFS2](../filesystems/jffs2.md) — predecessor flash file system
- [MTD](../drivers/mtd.md) — Memory Technology Device layer
- [F2FS](../filesystems/f2fs.md) — flash-friendly file system for eMMC/SSD
