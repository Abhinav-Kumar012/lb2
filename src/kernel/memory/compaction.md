# Memory Compaction

## Overview

Memory compaction is a kernel mechanism that reclaims physically contiguous blocks of memory by relocating movable pages within a zone, creating larger free regions without requiring expensive reclaim operations. Introduced in Linux 2.6.35 by Mel Gorman, compaction is a critical component of the kernel's anti-fragmentation strategy and is the primary path through which high-order allocations (those larger than a single page) succeed under memory pressure.

Unlike memory defragmentation approaches that work at the filesystem level, memory compaction operates on physical page frames themselves, shuffling live pages to consolidate free space.

## The Fragmentation Problem

Physical memory fragmentation occurs when free pages exist in sufficient quantity but are scattered across many non-contiguous locations. A system might have hundreds of megabytes of free memory yet fail a 2MB (order-9) allocation because no contiguous 512 free pages exist.

### Types of Fragmentation

- **External fragmentation**: Free pages are interspersed with allocated pages, preventing large contiguous allocations
- **Internal fragmentation**: Allocated blocks are larger than needed, wasting space within the allocation

### Why Compaction Over Reclaim

Traditional reclaim (page eviction to swap or filesystem writeback) frees individual pages but does not consolidate them. Reclaim may free scattered pages throughout a zone, leaving fragmented free space. Compaction physically moves pages to create contiguous free regions, which is fundamentally different from simply increasing the free page count.

## Anti-Fragmentation Framework

The kernel classifies pages into migratetype categories to reduce fragmentation proactively:

### Migratetypes

| Migratetype | Description | Examples |
|---|---|---|
| `MIGRATE_UNMOVABLE` | Cannot be relocated | Kernel allocations, slab objects |
| `MIGRATE_MOVABLE` | Can be relocated freely | Userspace pages, page cache |
| `MIGRATE_RECLAIMABLE` | Can be freed under pressure | Dentries, inodes, some kernel caches |
| `MIGRATE_HIGHMOVABLE** | Movable pages with special treatment | (rare, experimental) |

### Pageblock Granularity

The kernel groups pages into **pageblocks** (typically 2^MAX_ORDER pages, often 512 pages or 2MB on x86). Each pageblock has an associated migratetype. When a page is first allocated, it is placed in a pageblock matching its migratetype. This heuristic keeps movable and unmovable pages in separate regions, making compaction more effective.

The migratetype of a pageblock is determined by the first allocation to it and can be changed (fallback) when an emergency allocation of a different type is needed.

### Free Page Lists

Each zone maintains per-migratetype free lists:

```
zone->free_area[order].free_list[migratetype]
```

This design ensures that when the kernel needs a movable page, it draws from movable pageblocks, preserving unmovable regions intact.

## Compaction Algorithm

Compaction uses a two-pass scanner approach operating within a single memory zone:

### 1. Migration Scanner (Bottom-Up)

Starting from the lowest PFN in the zone, the migration scanner searches for **movable** pages that can be relocated. It identifies pages that:
- Have a valid mapping (or no mapping but are swap-backed)
- Are not pinned (no elevated reference count, not under DMA)
- Are not locked by another subsystem
- Belong to the movable migratetype pageblock

### 2. Free Scanner (Top-Down)

Starting from the highest PFN in the zone, the free scanner searches for **free** pages. It identifies contiguous free blocks that can serve as migration destinations.

### 3. Migration

When both scanners find suitable candidates, pages are migrated from the migration scanner's position to the free scanner's position. This creates a gap that grows as migration proceeds, effectively compacting all movable pages toward one end of the zone.

### Convergence

The two scanners move toward each other. Compaction terminates when:
- The scanners meet (no more movable pages before free pages)
- A sufficient number of free pages have been gathered
- The process is making insufficient progress

## Compaction Entry Points

### Synchronous Compaction

Triggered during allocation when direct reclaim fails to produce enough contiguous pages:

```c
/* mm/page_alloc.c */
static struct page *
__alloc_pages_direct_compact(gfp_t gfp_mask, unsigned int order,
                             unsigned int alloc_flags,
                             const struct alloc_context *ac,
                             enum compact_priority prio,
                             enum compact_result *compact_result)
```

The caller blocks until compaction completes. This is the most expensive path but provides the highest chance of success.

### Asynchronous Compaction

Triggered proactively or in background:

```c
/* mm/compaction.c */
static enum compact_result compact_zone_order(struct zone *zone,
                                              int order, gfp_t gfp_mask,
                                              enum compact_priority prio,
                                              unsigned int alloc_flags,
                                              struct page **page)
```

Asynchronous compaction does not migrate pages that are currently locked or have elevated reference counts, trading effectiveness for lower latency.

### Proactive Compaction

Introduced in Linux 5.9, proactive compaction triggers compaction periodically based on a sysctl threshold rather than waiting for allocation failures:

```bash
# Set proactive compaction to compact when fragmentation score exceeds 50%
echo 50 > /proc/sys/vm/compaction_proactiveness
```

Range: 0 (disabled) to 100 (aggressive). Default: 20.

## Tuning and Interfaces

### Sysctl Parameters

```bash
# /proc/sys/vm/compaction_proactiveness
# Controls background proactive compaction aggressiveness (0-100)
echo 20 > /proc/sys/vm/compaction_proactiveness

# /proc/sys/vm/compact_unevictable_allowed
# Allow compaction to examine unevictable (mlocked) pages
# 0 = never, 1 = only in direct compaction, 2 = always
echo 1 > /proc/sys/vm/compact_unevictable_allowed
```

### Manual Trigger via compact_memory

Writing to `/proc/sys/vm/compact_memory` triggers synchronous compaction across all zones:

```bash
echo 1 > /proc/sys/vm/compact_memory
```

This is useful for:
- Testing whether compaction can recover contiguous memory
- Pre-compacting before a known large allocation
- Debugging fragmentation issues

### Per-Node Compaction

On NUMA systems, compaction can be triggered per-node:

```bash
echo 1 > /proc/sys/vm/compact_memory_node
# Or for specific node:
echo 1 > /sys/devices/system/node/node0/compact
```

### Compaction Statistics

```bash
# Per-zone compaction statistics
cat /proc/vmstat | grep compact
# compact_daemon_wake    - Number of times kcompactd woke
# compact_daemon_migrate - Pages migrated by kcompactd
# compact_daemon_free    - Free pages found by kcompactd
# compact_stall          - Direct compaction stalls
# compact_fail           - Failed compaction attempts
# compact_success        - Successful compaction attempts

# Zone info
cat /proc/zoneinfo | grep -A20 "Node"
```

## kcompactd: The Compaction Daemon

Each NUMA node runs a `kcompactd` kernel thread that performs background compaction. It wakes when:
- A zone's fragmentation score exceeds a threshold
- Proactive compaction is enabled and the score exceeds `compaction_proactiveness`
- A direct compaction request is made

### kcompactd Behavior

```c
/* mm/compaction.c */
static int kcompactd(void *p)
{
    // Sleep until woken by zone watermark or proactive trigger
    // Perform asynchronous compaction on the node's zones
    // Target order based on highest failed allocation
}
```

kcompactd works asynchronously and does not block allocation paths. It aims to pre-create contiguous regions so that future allocations succeed without triggering direct compaction.

## Compaction and THP (Transparent Huge Pages)

Compaction is particularly important for THP allocations. When a process touches memory and the kernel attempts to back it with a huge page:

1. The kernel checks for a free huge page
2. If none exists, it attempts compaction
3. If compaction succeeds, the huge page is allocated
4. If compaction fails, the kernel falls back to regular pages

THP allocation failures often indicate fragmentation that compaction could not resolve. Monitoring:

```bash
# THP compaction events
cat /proc/vmstat | grep thp_compact
# thp_compact_alloc    - Huge pages allocated after compaction
# thp_compact_failed   - Compaction failed for huge pages
# thp_compact_scanned  - Pages scanned during compaction
```

## Compaction vs. Reclaim vs. OOM

When an allocation fails, the kernel follows a hierarchy:

1. **Direct reclaim**: Evict pages to free memory (no spatial consolidation)
2. **Direct compaction**: Relocate movable pages to consolidate free space
3. **OOM killer**: Kill a process to reclaim large amounts of memory

The order depends on the allocation context and `gfp` flags. For order-0 allocations, reclaim is usually sufficient. For high-order allocations, compaction is the critical step between reclaim and OOM.

## Debugging Compaction Issues

### Monitoring Fragmentation

```bash
# Show fragmentation score per zone (0 = no fragmentation, 1000 = severe)
cat /sys/kernel/debug/extfrag/extfrag_index

# Show which allocation orders are likely to fail
cat /sys/kernel/debug/extfrag/unusable_index

# Detailed zone information
cat /proc/zoneinfo
```

### Tracepoints

```bash
# Enable compaction tracepoints
echo 1 > /sys/kernel/debug/tracing/events/compaction/mm_compaction_begin/enable
echo 1 > /sys/kernel/debug/tracing/events/compaction/mm_compaction_end/enable
echo 1 > /sys/kernel/debug/tracing/events/compaction/mm_compaction_migratepages/enable

# View traces
cat /sys/kernel/debug/tracing/trace_pipe
```

### Common Issues

- **Persistent fragmentation**: Often caused by long-lived unmovable allocations pinning pages in movable zones. Check slab usage and kernel allocations.
- **Compaction storms**: Excessive compaction can cause latency spikes. Monitor `compact_stall` in `/proc/vmstat`.
- **THP allocation failures**: Check if compaction is being attempted but failing, indicating severe fragmentation.

## Performance Considerations

- Compaction involves page migration, which requires copying page contents and updating page tables
- Synchronous compaction can cause significant latency (milliseconds to tens of milliseconds)
- Asynchronous compaction has lower impact but may not produce enough free regions
- On large-memory systems, compaction scanning can be expensive due to the search space
- Proactive compaction trades background CPU for reduced allocation latency

## Implementation Details

### Key Data Structures

```c
/* mm/compaction.c */
struct compact_control {
    struct list_head freepages;     /* List of free pages to migrate to */
    struct list_head migratepages;  /* Pages to migrate */
    unsigned long nr_freepages;     /* Number of free pages found */
    unsigned long nr_migratepages;  /* Number of pages to migrate */
    unsigned long free_pfn;         /* Free scanner position */
    unsigned long migrate_pfn;      /* Migration scanner position */
    unsigned long fast_start_pfn;   /* Fast search start */
    struct zone *zone;              /* Zone being compacted */
    int order;                      /* Allocation order being targeted */
    int migratetype;                /* Migratetype of target pages */
    enum compact_mode mode;         /* Sync or async */
    bool contended;                 /* Lock contention detected */
};
```

### Zone Watermarks and Compaction

Zone watermarks interact with compaction. When free memory falls below the low watermark, `kcompactd` is woken. If it falls below the minimum watermark, direct compaction and reclaim are forced.

## Further Reading

- **Kernel documentation**: `Documentation/admin-guide/sysctl/vm.rst` — compaction-related sysctls
- **Mel Gorman's talk**: "Memory Compaction" at LinuxCon Europe 2012
- **LWN article**: ["Memory compaction"](https://lwn.net/Articles/368869/) — original design overview
- **LWN article**: ["Proactive compaction"](https://lwn.net/Articles/816890/) — Linux 5.9 feature
- **Source**: `mm/compaction.c` — core compaction implementation
- **Source**: `mm/page_alloc.c` — allocation paths invoking compaction
- **Related**: [Transparent Huge Pages](./huge-pages.md) — THP and compaction interaction
- **Related**: [Memory Zones](./zones.md) — zone-based memory management
- **Related**: [OOM Killer](../mm/oom-killer.md) — last-resort memory recovery
- **Related**: [Memory Reclaim](./reclaim.md) — page reclaim mechanism
