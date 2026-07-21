# Bcachefs — Copy-on-Write Filesystem for Linux

## Overview

Bcachefs is a modern, general-purpose, POSIX-compliant Linux filesystem designed
for robustness, performance, and flexibility. It uses a **copy-on-write (CoW)**
B-tree architecture and integrates features traditionally found in volume managers
and RAID controllers — such as compression, encryption, snapshots, and tiered
storage — directly into the filesystem layer.

Bcachefs was developed by **Kent Overstreet**, building on his earlier work with
bcache (block cache). After years of out-of-tree development, bcachefs was merged
into the **Linux 6.7** mainline kernel in late 2023.

## Design Philosophy

Bcachefs aims to combine the best features of existing CoW filesystems (ZFS, Btrfs)
while avoiding their architectural limitations:

- **Simplicity over complexity**: cleaner internal architecture, fewer layers of
  abstraction
- **Performance**: designed for both HDDs and SSDs with minimal tuning
- **Data integrity**: checksums, CoW semantics, and atomic operations throughout
- **Unified storage management**: no separate volume manager needed

## Architecture

### B-Tree Structure

Bcachefs uses a single, unified **extents-based B-tree** (called the "btree") as
its core data structure. Unlike Btrfs, which uses multiple specialized trees,
bcachefs stores all metadata in a hierarchy of btrees with different node types:

- **Inodes**: file metadata (permissions, timestamps, xattrs)
- **Extents**: file data mappings (with optional inline data for small files)
- **Dirents**: directory entries
- **Xattrs**: extended attributes
- **Alloc**: allocation and bucket state information
- **Snapshots**: snapshot topology

Each btree node is a sorted array of keys with an interior fan-out. Nodes are
CoW — modifications create new nodes rather than updating in place.

### Extent-Based Allocation

Bcachefs divides storage into **buckets** (typically 512 KiB to several MiB).
An allocator manages bucket state:

- **Available**: free for allocation
- **Dirty**: contains live data
- **Clean**: data has been flushed to stable storage
- **Stale**: data is no longer referenced (can be reclaimed)

This bucket-based approach simplifies garbage collection and supports multi-device
tiered storage natively.

### Journal

The journal provides atomicity for metadata operations. Bcachefs uses a
**log-structured journal** that records all metadata changes before they are
committed to btrees:

```
Journal → Btree nodes → Buckets on disk
```

On crash recovery, the journal is replayed to restore consistency. The journal
itself is checksummed and CoW.

## Copy-on-Write (CoW) Semantics

Every write in bcachefs follows CoW discipline:

1. Data is written to a **new** location (a fresh bucket or extent)
2. The btree is updated to point to the new location
3. The old location is marked stale and eventually reclaimed

This ensures that interrupted writes never corrupt existing data. CoW also
enables efficient snapshots — snapshot and source share the same extents until
a write diverges them.

### Overwrite Behavior

For in-place modifications (e.g., appending to a file), bcachefs may:

- **Append**: write new data to a new extent, extend the inode
- **Partial overwrite**: split the extent, write the modified portion to a new
  location, update btree pointers
- **Inline data**: very small files (< ~1 KiB) are stored directly in the btree
  node, avoiding separate data extents

## Compression

Bcachefs supports transparent compression with multiple algorithms:

| Algorithm    | Library         | Characteristics                |
|--------------|-----------------|--------------------------------|
| LZ4          | lz4             | Fast, moderate ratio           |
| ZSTD         | zstd            | Good ratio, configurable level |
| gzip         | zlib            | Legacy, broad compatibility    |

### Compression Configuration

```bash
# Set compression on a directory
bcachefs setattr --compression=zstd /mnt/bcachefs/data

# Set compression with level
bcachefs setattr --compression=zstd:3 /mnt/bcachefs/data
```

### How Compression Works

1. Data blocks are compressed before writing to extents
2. The extent records the compression algorithm and original size
3. Reads decompress transparently
4. Compression is per-extent — small extents that don't compress well are stored
   uncompressed

### Inline Compression

Small files can be stored compressed directly within btree nodes, eliminating
the data extent entirely and improving both space efficiency and read performance.

## Encryption

Bcachefs provides **full-disk encryption** (FDE) using the kernel's crypto API.
Encryption is configured at filesystem creation time and is transparent to
applications.

### Encryption Modes

- **ChaCha20 + Poly1305**: authenticated encryption (AEAD), recommended default
- **AES-256-XTS**: block cipher mode, traditional FDE approach

### Key Management

```bash
# Create encrypted filesystem
bcachefs format --encrypted /dev/sdb1
# Prompts for passphrase

# Unlock at mount time
bcachefs unlock /dev/sdb1  # prompts for passphrase
mount -t bcachefs /dev/sdb1 /mnt/secure
```

Bcachefs uses a two-level key hierarchy:

1. **Master key**: derived from the user's passphrase (via scrypt or argon2 KDF)
2. **Per-extent keys**: derived from the master key + extent nonce

Each extent has a unique nonce, preventing ciphertext reuse even for identical
plaintext blocks.

### Encryption vs. LUKS

Unlike dm-crypt/LUKS, bcachefs encryption is filesystem-aware:

- Metadata is encrypted alongside data
- Snapshots inherit encryption
- Compression can be applied before encryption (more effective than encrypting
  compressed data at the block layer)
- No need for a separate device-mapper layer

## Snapshots

Bcachefs supports **subvolume snapshots** — point-in-time, read-only copies of
directory trees that share unchanged extents with the source.

### Creating Snapshots

```bash
# Create a snapshot of a subvolume
bcachefs subvolume snapshot /mnt/bcachefs/data /mnt/bcachefs/snapshots/data-2024-01-15
```

### How Snapshots Work

1. A snapshot creates a new inode tree that references the same extents as the
   source
2. Extents are reference-counted — each extent tracks how many snapshots (and
   the source) reference it
3. When the source modifies a referenced extent, the CoW mechanism creates a
   new copy for the source (the snapshot retains the old version)
4. Unchanged extents remain shared, consuming no additional space

### Snapshot Operations

```bash
# List snapshots
bcachefs subvolume list /mnt/bcachefs

# Delete a snapshot (frees unreferenced extents)
bcachefs subvolume delete /mnt/bcachefs/snapshots/data-2024-01-15

# Rollback to a snapshot (destructive to source changes)
bcachefs subvolume rollback /mnt/bcachefs/data /mnt/bcachefs/snapshots/data-2024-01-15
```

### Snapshot Topology

Bcachefs tracks snapshot relationships in a dedicated btree. This enables:

- **Snapshot trees**: nested snapshots with parent-child relationships
- **Efficient deletion**: when a snapshot is deleted, only extents exclusively
  referenced by that snapshot are freed
- **Snapshot groups**: batch operations on related snapshots

## Tiered Storage

One of bcachefs's distinctive features is **native multi-device support** with
automatic data placement across storage tiers.

### Device Types

```bash
bcachefs format \
    --data_allowed=ssd_hdd \
    --foreground_target=ssd \
    --background_target=hdd \
    --promote_target=ssd \
    /dev/nvme0n1 /dev/sda
```

| Target          | Purpose                                        |
|-----------------|------------------------------------------------|
| `foreground_target` | New writes go here first (fast SSD)         |
| `background_target` | Data migrated here during GC (slow HDD)     |
| `promote_target`    | Frequently read data promoted here (SSD)    |
| `metadata_target`   | Btree nodes placed here (SSD recommended)   |

### Data Migration

Bcachefs implements a background garbage collector that can migrate data between
devices:

- **Write allocation**: new data is placed on the foreground target
- **GC migration**: during garbage collection, data can be moved to the
  background target if the foreground target is full or if the data is cold
- **Promotion**: frequently accessed data on the background target can be
  promoted to the foreground target

### RAID and Replication

Bcachefs supports multiple redundancy schemes:

- **Replication**: data written to N devices simultaneously
- **Erasure coding**: parity-based redundancy (RAID-like)

```bash
# RAID-1 (mirroring)
bcachefs format --data_replicas=2 /dev/sda /dev/sdb

# Erasure coding (4+2)
bcachefs format --data_replicas=1 --erasure_coding /dev/sda /dev/sdb /dev/sdc /dev/sdd /dev/sde /dev/sdf
```

## Scrubbing and Data Integrity

Bcachefs includes a background **scrub** mechanism that periodically reads all
data and verifies checksums:

```bash
# Trigger a scrub
bcachefs fsck /mnt/bcachefs
```

When scrub detects corruption:

1. If replicas exist, the good copy is used to repair the corrupted copy
2. If erasure coding is enabled, parity data is used for reconstruction
3. If no redundancy exists, the error is reported to userspace

## Operational Commands

### Filesystem Creation

```bash
# Basic
bcachefs format /dev/sdb1

# Multi-device with options
bcachefs format \
    --label=ssd.ssd1 /dev/nvme0n1 \
    --label=hdd.hdd1 /dev/sda /dev/sdb \
    --data_allowed=ssd_hdd \
    --foreground_target=ssd \
    --background_target=hdd \
    --compression=zstd \
    --encrypted \
    --block_size=4k
```

### Mounting

```bash
mount -t bcachefs /dev/sdb1 /mnt/bcachefs

# Multi-device (all members)
mount -t bcachefs /dev/nvme0n1:/dev/sda:/dev/sdb /mnt/bcachefs
```

### Filesystem Status

```bash
bcachefs fs usage /mnt/bcachefs    # Space usage by device and tier
bcachefs device list /mnt/bcachefs # Device status
```

## Performance Characteristics

### Strengths

- **Small random I/O**: CoW + B-tree provides excellent random read/write
- **Compression**: reduces I/O bandwidth for compressible workloads
- **Multi-device**: automatic tiering reduces need for manual data placement
- **Small file handling**: inline data storage avoids extent overhead

### Trade-offs

- **Write amplification**: CoW inherently writes more than in-place filesystems
  (ext4, XFS) for random overwrites
- **Fragmentation**: long-lived CoW filesystems can fragment over time (similar
  to Btrfs)
- **Journal overhead**: the journal adds latency to metadata-heavy workloads
- **Maturity**: as of Linux 6.7+, bcachefs is stable but lacks the decade of
  battle-testing that ext4 or XFS have

## Comparison with Other CoW Filesystems

| Feature          | Bcachefs      | Btrfs          | ZFS            |
|------------------|---------------|----------------|----------------|
| License          | GPL-2.0       | GPL-2.0        | CDDL           |
| Mainline Linux   | Yes (6.7+)    | Yes (3.x+)     | No (ZFS on Linux) |
| B-tree           | Single unified| Multiple trees | Merkle tree    |
| RAID             | Built-in      | Built-in       | Built-in       |
| Encryption       | Native        | Native (2.6+)  | Native         |
| Compression      | Native        | Native         | Native         |
| Deduplication    | Planned       | Native         | Native         |
| Snapshots        | Subvolume     | Subvolume      | Dataset        |
| Tiered storage   | Native        | No             | ZFS tiering    |
| Maturity         | New           | Mature         | Very mature    |

## Known Limitations (as of Linux 6.7)

- **No online fsck**: repair requires unmounting
- **No deduplication**: planned for future releases
- **Limited tooling**: bcachefs-tools is still evolving
- **No reflink/clone**: cross-file extent sharing not yet supported
- **Upgrade path**: no in-place conversion from ext4/Btrfs

## Troubleshooting

### Filesystem Check

```bash
bcachefs fsck /dev/sdb1
```

### Debugging

```bash
# Enable debug logging
echo 'bcachefs:7' > /proc/sys/kernel/printk  # very verbose

# Dump btree structure
bcachefs dump /dev/sdb1
```

### Common Issues

1. **"device already registered"**: multi-device filesystem requires all
   devices to be passed at mount time
2. **Slow mount**: large filesystems may take time to read the journal and
   rebuild in-memory state
3. **ENOSPC on "free" space**: bcachefs reserves space for CoW operations;
   `bcachefs fs usage` shows the actual situation

## See Also

- [Ring Buffer](../../debugging/ring-buffer.md) — data structures used in
  log-structured filesystems
- [Kernel Lockdown](../../security/lockdown.md) — restrictions on filesystem
  encryption key access
- [vmpressure](../memory/vmpressure.md) — memory pressure affecting filesystem
  cache behavior

## Further Reading

- **Kernel source**: `fs/bcachefs/`
- **Documentation**: `Documentation/filesystems/bcachefs/`
- **Bcachefs wiki**: https://bcachefs.org/
- **LWN article**: ["A new filesystem for Linux"](https://lwn.net/Articles/747355/) —
  design overview
- **LWN article**: ["Bcachefs makes progress"](https://lwn.net/Articles/934689/) —
  merge status and feature summary
- **Kent Overstreet's talk**: "bcachefs: a new COW filesystem for Linux" —
  Linux Plumbers Conference
- **Comparison**: https://bcachefs.org/Status/ — current feature status and
  known issues
