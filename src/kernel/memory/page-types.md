# Page Types

## Overview

The Linux kernel manages physical memory through a **page frame** abstraction. Every physical page in the system is represented by a `struct page` and classified by its usage type. Understanding page types is essential for memory management debugging, performance tuning, and kernel development.

The kernel's page allocator (buddy system) hands out fixed-size blocks—typically **4 KiB** on x86-64—but pages serve radically different purposes once allocated. The type of a page determines how it is mapped, reclaimed, shared, and accounted.

> **See also:** [Memory Management Overview](./index.md), [Slab Allocator](./slab.md), [Huge Pages](./huge-pages.md)

---

## Anonymous Pages

### Characteristics

Anonymous pages have **no backing store on disk**. They hold:

- Process heap memory (`malloc`, `brk`, `mmap(MAP_ANONYMOUS)`)
- Stack space
- Copy-on-write (COW) duplicates of shared pages

```c
/* Typical creation paths */
vma->vm_flags |= VM_ANON;           /* Set in mm/mmap.c */
page = alloc_pages(GFP_HIGHUSER, 0); /* Allocate from highmem */
```

### Lifecycle

1. **Allocation** — On first access, the MMU triggers a page fault. The fault handler allocates a zero-filled page (or uses the [zero page](#zero-page) for reads).
2. **COW** — `fork()` marks parent pages read-only. A write fault duplicates the page.
3. **Swap** — Under memory pressure, the kernel writes anonymous pages to swap space via the `swap_cache`.
4. **Free** — When the owning process exits or `munmap` releases the VMA, pages return to the buddy allocator.

### Detection

```
$ cat /proc/<pid>/smaps | grep Anonymous
Anonymous:        4096 kB
```

In `/proc/vmstat`, `nr_anon_pages` tracks the global anonymous page count.

---

## File-Backed Pages

### Characteristics

File-backed pages cache contents of files from disk filesystems. They appear in:

- `mmap()` of regular files
- Page cache (read/write I/O buffering)
- Shared memory backed by `tmpfs`/`shmfs`

```c
/* In mm/filemap.c */
struct page *page_cache_get(struct address_space *mapping, pgoff_t index)
```

### Page Cache Integration

Every file-backed page is indexed by its `address_space` and offset (index). The radix tree (or XArray in newer kernels) maps `(mapping, index) → struct page`.

| State         | Description                                      |
|---------------|--------------------------------------------------|
| **Clean**     | Matches disk contents; can be discarded freely   |
| **Dirty**     | Modified in memory; must be written back first   |
| **Writeback** | Currently being flushed to disk                  |
| **Locked**    | Under I/O; other threads must wait               |

### Reclaim

The kernel reclaims file-backed pages through:

- **Direct reclaim** — Synchronous in the allocating context
- **kswapd** — Background daemon scanning LRU lists
- **Eviction** — Clean pages are freed; dirty pages are written back first

```
$ grep -i "nr_file_pages\|nr_dirty" /proc/vmstat
nr_file_pages 128450
nr_dirty 42
```

> **See also:** [Page Cache](../filesystems/page-cache.md), [Writeback](./writeback.md)

---

## Slab Pages

### Purpose

The **slab allocator** (SLAB/SLUB/SLOB) manages kernel objects smaller than a full page. Slab pages are subdivided into fixed-size **caches** for structures like `inode`, `dentry`, `task_struct`, and `sk_buff`.

```c
/* Creating a new cache */
struct kmem_cache *cache = kmem_cache_create(
    "my_object", sizeof(struct my_object),
    0, SLAB_HWCACHE_ALIGN, NULL);
```

### SLUB Internals (Default Allocator)

Each slab page belongs to a `kmem_cache` and is divided into **objects** of uniform size:

```
┌────────────────────────────────────────────────┐
│                  struct page                    │
│  slab_cache → kmem_cache                       │
│  freelist   → first free object                │
│  inuse      → number of allocated objects      │
│  objects    → total objects in this slab        │
└────────────────────────────────────────────────┘
```

### Monitoring

```
$ sudo cat /proc/slabinfo
# name            <active_objs> <num_objs> <objsize> <objperslab> <pagesperslab>
inode_cache           12450    12600      608           25            1
dentry                28300    28350      192           42            1
kmalloc-256            4800     4800      256           16            1
```

```
$ sudo slabtop -o | head -20   # Live view
```

> **See also:** [Slab Allocator Details](./slab.md), [`kmem_cache` API](../api/kmem-cache.md)

---

## HugeTLB Pages

### Overview

HugeTLB (Huge Translation Lookaside Buffer) pages are **pre-allocated large pages** that bypass the normal page-table hierarchy. On x86-64, supported sizes are:

| Size     | Page-Table Level | Allocation Flag        |
|----------|------------------|------------------------|
| 2 MiB    | PMD (Level 2)    | `MAP_HUGETLB` (default)|
| 1 GiB    | PUD (Level 3)    | `MAP_HUGETLB + 30`    |

### Configuration

```bash
# Reserve 10 x 2 MiB huge pages at boot
echo 10 > /proc/sys/vm/nr_hugepages

# Reserve 2 x 1 GiB huge pages
echo 2 > /sys/kernel/mm/hugepages/hugepages-1048576kB/nr_hugepages

# Check status
cat /proc/meminfo | grep -i huge
HugePages_Total:      10
HugePages_Free:        8
Hugepagesize:       2048 kB
```

### Usage in Applications

```c
void *ptr = mmap(NULL, 2 * 1024 * 1024,
                 PROT_READ | PROT_WRITE,
                 MAP_PRIVATE | MAP_ANONYMOUS | MAP_HUGETLB,
                 -1, 0);
```

### Advantages

- **Reduced TLB pressure** — Fewer page-table entries to traverse
- **Fewer page faults** — One fault covers 2 MiB instead of 4 KiB
- **Lower page-table overhead** — Fewer levels of translation

### Caveats

- Memory fragmentation can prevent allocation after boot
- Reserved but unused huge pages waste memory
- Not swappable in most configurations

> **See also:** [Transparent Huge Pages (THP)](./thp.md), [TLB Management](./tlb.md)

---

## Zero Page

### Mechanism

The **zero page** (`empty_zero_page`) is a single, globally shared page filled with zeros. When a process reads from an unmapped anonymous region (or reads new heap memory), the kernel maps the zero page **read-only** instead of allocating a fresh page.

```c
/* In mm/memory.c */
if (is_zero_pfn(pte_pfn(pte))) {
    /* Map the global zero page */
}
```

### Benefits

- **Memory savings** — Hundreds of processes sharing zero-filled regions use one physical page
- **Faster page faults** — No allocation or zeroing needed for read faults

### Detection

```
$ grep zero_page /proc/vmstat
zero_page_allocated 4582
```

A high count is normal; it reflects read faults on fresh memory.

---

## Guard Pages

### Purpose

A **guard page** is an unmapped page placed adjacent to a memory region to detect **out-of-bounds access**. When code reads or writes a guard page, the kernel raises `SIGSEGV`.

### Common Locations

| Location            | Protects Against             |
|---------------------|------------------------------|
| Stack guard page    | Stack overflow (grows down)  |
| `mprotect(PROT_NONE)` | Manual buffer overflow detection |
| `mmap` guard region | Heap overflow                |
| Kernel stack guard  | Kernel stack overflow (`CONFIG_VMAP_STACK`) |

### Stack Guard Example

```bash
$ ulimit -s          # Stack size limit
8192                 # 8 MiB

# The page immediately below the stack is the guard page
$ cat /proc/<pid>/maps | grep stack
7ffc12340000-7ffc12361000 rw-p 00000000 00:00 0    [stack]
```

### Kernel Guard Pages

With `CONFIG_VMAP_STACK=y`, kernel stacks are allocated with `vmalloc()` and surrounded by guard pages. A kernel stack overflow triggers:

```
kernel BUG at arch/x86/kernel/traps.c:xxx!
```

Instead of silent memory corruption.

---

## Page Type Detection

### In the Kernel

```c
/* Check if page is anonymous */
bool PageAnon(struct page *page);

/* Check if page is in the page cache (file-backed) */
bool PageSlab(struct page *page);
bool PageCompound(struct page *page);  /* Part of a large/huge page */

/* Check for zero page */
bool is_zero_pfn(unsigned long pfn);
```

### From Userspace

```bash
# Per-process page types
cat /proc/<pid>/smaps    # Detailed VMA-level info

# System-wide counters
grep -E "nr_(anon|file|slab|hugepages)" /proc/vmstat

# NUMA page distribution
cat /proc/zoneinfo
```

---

## Interaction Summary

```
                    ┌──────────────┐
                    │  Buddy       │
                    │  Allocator   │
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────▼──────┐ ┌────▼────┐  ┌──────▼──────┐
     │  Anonymous   │ │  Slab   │  │  File-Backed │
     │  Pages       │ │  Pages  │  │  Pages       │
     └──────┬──────┘ └─────────┘  └──────────────┘
            │
    ┌───────┼────────┐
    │       │        │
┌───▼──┐ ┌──▼──┐ ┌──▼────┐
│ COW  │ │Swap │ │ Zero  │
│ Dup  │ │ Out │ │ Page  │
└──────┘ └─────┘ └───────┘
```

---

## Further Reading

- [Linux kernel source: `include/linux/page-flags.h`](https://elixir.bootlin.com/linux/latest/source/include/linux/page-flags.h)
- [Linux kernel source: `mm/memory.c`](https://elixir.bootlin.com/linux/latest/source/mm/memory.c)
- **Understanding the Linux Virtual Memory Manager** — Mel Gorman
- [kernel.org: Hugetlbpage](https://www.kernel.org/doc/html/latest/admin-guide/mm/hugetlbpage.html)
- [LWN: The SLUB allocator](https://lwn.net/Articles/229984/)
- [proc(5) man page](https://man7.org/linux/man-pages/man5/proc.5.html)

> **Related topics:** [Page Allocator](./page-allocator.md), [Memory Zones](./zones.md), [NUMA](./numa.md), [OOM Killer](./oom-killer.md)
