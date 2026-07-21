# zpool: Compressed Memory Pool

## Overview

zpool is a compressed memory pool abstraction in the Linux kernel that provides a common interface for storing compressed pages in memory. It serves as the backend storage mechanism for **zswap**, the compressed swap cache. zpool itself is not a swap device—it is a generic compressed page allocator that can use different compression-oriented allocators.

The zpool API was introduced to unify and abstract the storage layer that zswap (and potentially other subsystems) uses to hold compressed data in RAM, avoiding duplication of allocator logic across different compressed memory backends.

## Architecture

```
┌─────────────────────────────────────┐
│           zswap (frontswap)         │
├─────────────────────────────────────┤
│            zpool API                │
├──────────┬──────────┬───────────────┤
│  ZBUD    │ Z3FOLD   │  zsmalloc    │
│ (2 pages)│(3 pages) │  (variable)  │
└──────────┴──────────┴───────────────┘
```

zpool sits between consumers like zswap and the low-level allocators. A consumer creates a zpool with a specified type, then uses `zpool_malloc()` / `zpool_free()` to store and retrieve compressed pages. The actual memory layout and compaction strategy are delegated entirely to the chosen allocator.

## Allocators

### ZBUD

ZBUD stores up to **two compressed pages** in a single 4 KiB "bud" page. It is the simplest allocator:

- Each buddy page holds exactly 0, 1, or 2 compressed objects.
- If two objects are stored and one is freed, the remaining object can be relocated by the buddy allocator, enabling memory reclaim.
- Maximum compression ratio is capped at 2:1 (two objects per page).

ZBUD was the original zpool allocator. Its simplicity makes it predictable, but the 2:1 ratio ceiling limits storage density.

### Z3FOLD

Z3FOLD stores up to **three compressed pages** per buddy page:

- Uses a more sophisticated header to track three slots of variable size within each 4 KiB page.
- Allows up to 3:1 compression ratio, improving density over ZBUD.
- Supports compactible pages: when a slot is freed, the remaining entries can be rearranged to reduce fragmentation.
- Requires a lock per page for slot manipulation.

Z3FOLD was added as an improvement over ZBUD for zswap workloads where higher density matters.

### zsmalloc

zsmalloc is a general-purpose compressed page allocator not originally designed for zpool, but later integrated:

- Groups objects of similar size into "size classes," each backed by contiguous pages (called "zspages").
- Achieves very high density when many small compressed pages of similar size exist.
- Objects can span multiple physical pages within a zspage, so individual object freeing requires a mapping table.
- Compaction support allows defragmentation of zspages.

zsmalloc is generally the best choice for zswap when density is the priority, though it has higher per-operation overhead than ZBUD or Z3FOLD.

## zpool API

The zpool API is defined in `<linux/zpool.h>`:

```c
/* Create a zpool of the given type (e.g., "z3fold", "zbud", "zsmalloc") */
struct zpool *zpool_create_pool(const char *type, const char *name,
                                gfp_t gfp);

/* Allocate compressed storage, returns a handle */
void *zpool_malloc(struct zpool *pool, size_t size, gfp_t gfp);

/* Free a previously allocated handle */
void zpool_free(struct zpool *pool, void *handle);

/* Map a handle to access its data */
void *zpool_map_handle(struct zpool *pool, void *handle,
                       enum zpool_mapmode mapmode);

/* Unmap a handle */
void zpool_unmap_handle(struct zpool *pool, void *handle);

/* Total size in bytes */
u64 zpool_get_total_size(struct zpool *pool);

/* Register a new allocator type */
int zpool_register_driver(const char *type, struct zpool_driver *driver);

/* Unregister an allocator type */
void zpool_unregister_driver(struct zpool_driver *driver);
```

### Handle Model

zpool uses a **handle-based** interface rather than raw pointers. The consumer receives an opaque `void *handle` from `zpool_malloc()`. To access the underlying memory, the consumer calls `zpool_map_handle()` which returns a virtual address. This indirection allows allocators like zsmalloc to store objects in memory that is not permanently mapped.

The `zpool_mapmode` enum controls mapping permissions:

- `ZPOOL_MM_RW` — read/write access
- `ZPOOL_MM_RO` — read-only access
- `ZPOOL_MM_WO` — write-only access

## Relationship with zswap

zswap is the primary consumer of zpool. When a page is swapped out:

1. zswap compresses the page.
2. zswap calls `zpool_malloc()` to allocate space for the compressed data.
3. The compressed data is copied into the zpool allocation.
4. A mapping from swap entry to zpool handle is stored.

When the page is swapped in:

1. zswap looks up the handle for the swap entry.
2. `zpool_map_handle()` provides access to the compressed data.
3. The data is decompressed back to a page.
4. `zpool_free()` releases the compressed storage.

If zpool allocation fails (memory pressure), zswap can evict compressed pages to the actual swap device.

## Configuration

### Boot-time

```
# Select the zpool allocator for zswap
zpool=z3fold

# Or via zswap parameter
zswap.zpool=zsmalloc
```

### Runtime (via sysfs)

```bash
# Check current zswap pool type
cat /sys/module/zswap/parameters/zpool

# Enable/disable zswap
echo 1 > /sys/module/zswap/parameters/enabled
```

### Allocator Module Parameters

Each allocator has its own module parameters:

```bash
# Z3FOLD
# No special parameters; uses default buddy allocator pages

# zsmalloc
# Page order for zspages is auto-tuned, but can be influenced
```

## Allocator Selection Guide

| Criterion | ZBUD | Z3FOLD | zsmalloc |
|-----------|------|--------|----------|
| Max ratio | 2:1 | 3:1 | ~3.5:1+ |
| Complexity | Low | Medium | High |
| Compaction | Yes | Yes | Yes |
| Per-page lock | No | Yes | No (per-class) |
| Best for | Predictability | Balance | Density |

In practice, **zsmalloc** is recommended for most workloads. Z3FOLD is a good middle ground. ZBUD is largely historical.

## Implementation Details

### Registration

Each allocator registers itself as a zpool driver:

```c
static struct zpool_driver z3fold_driver = {
    .type =     "z3fold",
    .malloc =   z3fold_alloc,
    .free =     z3fold_free,
    .map =      z3fold_map,
    .unmap =    z3fold_unmap,
    .total_size = z3fold_get_pool_size,
};
```

When a consumer calls `zpool_create_pool("z3fold", ...)`, zpool looks up the registered driver and delegates all operations.

### Compaction and Reclaim

All three allocators support compaction to varying degrees:

- **ZBUD**: If a buddy page has one freed slot, the remaining object can be relocated, and the page returned to the buddy allocator.
- **Z3FOLD**: Supports in-place compaction—when a slot is freed, remaining objects are shifted to consolidate free space. A workqueue (`z3fold_compact`) periodically scans for reclaimable pages.
- **zsmalloc**: Supports full zspage compaction where objects are migrated from partially-empty zspages to consolidate them, freeing entire zspages.

### Memory Accounting

zpool does not independently account for memory. The consumer (zswap) is responsible for tracking how much memory is used. `zpool_get_total_size()` reports the raw allocation size of the pool, which includes internal fragmentation.

## Debugging

### /sys/kernel/debug/zpool/

If debugfs is mounted, each zpool instance exposes:

```bash
# List pools and their statistics
cat /sys/kernel/debug/zpool/zswap/pool_name
cat /sys/kernel/debug/zpool/zswap/total_size
cat /sys/kernel/debug/zpool/zswap/mem_limit
```

### Kernel Messages

```bash
# Check which allocator is in use
dmesg | grep zpool

# Check zswap status
dmesg | grep zswap
```

### vmstat Counters

```bash
# zswap activity shows through swap counters
grep -i zswap /proc/vmstat
```

## Performance Considerations

- **Compression ratio vs. speed**: zsmalloc has the best ratio but higher per-operation cost. ZBUD is fastest but wastes space.
- **Fragmentation**: All allocators suffer from fragmentation under mixed allocation/free patterns. Periodic compaction mitigates this.
- **Locking**: Z3FOLD uses per-page locks; zsmalloc uses per-class locks. Under heavy concurrent access, locking behavior differs significantly.
- **NUMA awareness**: The allocators have varying degrees of NUMA-awareness. zsmalloc attempts to allocate from the local NUMA node.

## Relationship with zswapfront

In newer kernels, there is also a `zswapfront` mechanism that uses zpool for front-end compressed caching independent of swap. This allows more flexible use of compressed memory storage.

## Source Files

- `mm/zpool.c` — zpool API implementation
- `mm/zbud.c` — ZBUD allocator
- `mm/z3fold.c` — Z3FOLD allocator
- `mm/zsmalloc.c` — zsmalloc allocator
- `mm/zswap.c` — primary zpool consumer

## Further Reading

- **Documentation/mm/zpool.rst** — kernel documentation for the zpool API
- **Documentation/mm/zswap.rst** — zswap documentation covering zpool integration
- **Documentation/mm/zsmalloc.rst** — zsmalloc internals and design
- **LWN: A compressed memory allocator** — <https://lwn.net/Articles/546009/>
- **LWN: z3fold** — <https://lwn.net/Articles/636218/>
- **zswap design document** — `Documentation/vm/zswap.txt` (older kernels)

## See Also

- [zswap](../mm/zswap.md) — compressed swap cache
- [zram](../drivers/zram.md) — compressed RAM-based block device
- [Swap](../mm/swap.md) — Linux swap subsystem
- [Memory Management](../mm/index.md) — overview of Linux MM
