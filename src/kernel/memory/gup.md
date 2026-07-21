# GUP — get_user_pages

`get_user_pages()` (GUP) is the kernel interface that pins user-space memory
into kernel address space so that devices, RDMA, or other subsystems can
perform DMA directly on those pages.  It is one of the most performance- and
security-sensitive paths in the Linux memory subsystem.

---

## 1. Why Pinning Is Needed

Certain hardware — NICs, GPUs, NVMe controllers, RDMA HCAs — performs DMA
from/to physical addresses.  If the kernel allowed those addresses to be
swapped or migrated while DMA is in flight, data corruption or IOMMU faults
would follow.  GUP solves this by elevating page reference counts so the
page reclaim and compaction paths leave the pages alone.

---

## 2. Core API Variants

| Function | Direction | Returns |
|---|---|---|
| `get_user_pages()` | Read/write | Array of `struct page *` |
| `get_user_pages_remote()` | Remote process | Same, with `mm_struct` arg |
| `get_user_pages_fast()` (GUP-fast) | Lockless fast-path | Uses RCU, no `mmap_lock` |
| `pin_user_pages()` | DMA pinning | Elevated refcount, special accounting |

`pin_user_pages()` was introduced in 5.6 to distinguish DMA pinning from
ordinary "I want to read this page" usage.  It uses `FOLL_PIN` and applies
extra checks so that compound pages and huge pages are handled correctly.

---

## 3. Flags

### 3.1 `FOLL_LONGTERM`

Pins that may last for seconds or longer (RDMA registrations, persistent
mappings) **must** set `FOLL_LONGTERM`.  This flag tells GUP to:

* Avoid pinning pages that are on the CMA (Contiguous Memory Allocator)
  region — CMA needs movable pages for huge allocations.
* Trigger migration of movable pages to non-movable zones before pinning.
* Fail rather than silently corrupting memory compaction.

Introduced in commit `64e3ab2` (5.2) and later backported.

### 3.2 Other Common Flags

| Flag | Meaning |
|---|---|
| `FOLL_WRITE` | Require write access (COW if needed) |
| `FOLL_FORCE` | Force access even to PROT_NONE (debuggers) |
| `FOLL_NOWAIT` | Don't block on IO |
| `FOLL_FAST_ONLY` | Only try GUP-fast, fall back to error |
| `FOLL_PCI_P2PDMA` | Allow peer-to-peer PCI BAR pages |

---

## 4. GUP-Fast Path

`get_user_pages_fast()` avoids taking `mmap_lock` entirely.  It walks the
page table under RCU:

```
rcu_read_lock()
  walk page table
  if PTE is present and not special → grab ref
rcu_read_unlock()
```

If the fast path fails (page not present, THP split needed, etc.) it returns
a short count and the caller decides whether to fall back to the slow path
with `mmap_lock`.

### 4.1 Performance Characteristics

GUP-fast is **much** faster — often 5-10× — because `mmap_lock` is a global
bottleneck on machines with hundreds of threads.  However, it cannot handle:

* Pages that require fault-in (`FOLL_POPULATE`)
* Pages that need COW (`FOLL_WRITE` on read-only mapping)
* Pages that need migration (`FOLL_LONGTERM` on movable pages)

---

## 5. DMA Pinning and `FOLL_PIN`

When hardware performs DMA, ordinary page references are not enough.  The
`pin_user_pages()` family sets `FOLL_PIN`, which:

1. Uses `page_maybe_dma_pinned()` to track that this page is pinned for DMA.
2. Prevents `page_migrate_one()` from migrating the page while pinned.
3. Triggers special accounting in the page-type system so that CMA and
   memory-failure paths know the page cannot be moved.

```c
long pin_user_pages(struct mm_struct *mm, unsigned long start,
                    unsigned long pages, unsigned int gup_flags,
                    struct page **pages, struct vm_area_struct **vmas);
```

### 5.1 Unpinning

Every `pin_user_pages()` call **must** be balanced with
`unpin_user_page()` or `unpin_user_pages()`.  Failing to unpin leaks the
page permanently — it can never be reclaimed or migrated.

```c
unpin_user_page(page);               /* single */
unpin_user_pages(pages, npages);     /* batch */
```

---

## 6. ODP — On-Demand Paging

Traditional GUP pins pages before DMA starts.  **ODP** (used by mlx5 RDMA
drivers) reverses this: pages are *not* pinned up front.  Instead, when the
HCA accesses an unmapped address, a page-fault is delivered to the driver,
which then calls `get_user_pages()` just-in-time.

### 6.1 How ODP Works

```
HCA accesses VA → translation fails
  → HCA sends page-fault event to host
    → driver fault handler calls get_user_pages_remote()
      → page installed in HCA's page table
        → HCA retries the access
```

### 6.2 Advantages

* No long-term pins → no memory fragmentation.
* Works with `madvise(MADV_DONTNEED)` and `mmap` remapping.
* Lower memory overhead for large registrations.

### 6.3 Disadvantages

* Page faults add latency (typically 1-10 µs each).
* Requires HCA hardware support (mlx5, efa).
* More complex driver code.

### 6.4 Implicit ODP

In mlx5, **implicit ODP** covers the entire process address space with a
single registration.  No explicit `ibv_reg_mr()` call is needed; the HCA
faults on any address.  This is useful for applications that use many
scattered buffers.

---

## 7. Complications and Pitfalls

### 7.1 Long-Term Pins Break Compaction

A page pinned with `FOLL_LONGTERM` cannot be migrated.  If enough CMA or
movable-zone pages are pinned, compaction fails, and huge page allocations
start failing — even though free memory exists.  This was a major problem
before `FOLL_LONGTERM` enforcement (pre-5.2 kernels).

### 7.2 DMA to File-Backed Pages

Pinning file-backed (page-cache) pages for DMA is dangerous:

* The filesystem may truncate the file, freeing the page.
* Writeback may write stale data if the DMA writes after writeback starts.
* Some filesystems (tmpfs) don't support `FOLL_LONGTERM` at all.

Best practice: only pin anonymous pages or explicitly hugetlbfs pages.

### 7.3 Security: `FOLL_FORCE` and `ptrace`

`FOLL_FORCE` lets a process access memory even if the VMA is PROT_NONE.
This is used by debuggers and `process_vm_readv()`.  If an attacker can
trigger a GUP with `FOLL_FORCE` on another process, they can read secret
memory.  Mitigations include SELinux checks and `ptrace_may_access()`.

---

## 8. Recent Developments (6.x Kernels)

| Version | Change |
|---|---|
| 6.1 | Batched GUP (`pin_user_pages_fast` with large batches) |
| 6.3 | `page_maybe_dma_pinned()` accuracy improvements |
| 6.5 | GUP-fast supports PUD-level mappings (1 GiB pages) |
| 6.8 | Unification of `FOLL_PIN` and `FOLL_GET` accounting |

---

## 9. Debugging GUP Issues

* **`/proc/vmstat`** — `nr_foll_pin_acquired` / `nr_foll_pin_released` track
  pin/unpin balance.  If these diverge, there is a leak.
* **`page_ext` debug** — `CONFIG_DEBUG_PAGE_REF` adds refcount tracking.
* **lockdep** — `mmap_lock` ordering violations show up here.
* **KASAN** — use-after-free of page structs.

---

## 10. Further Reading

* **LWN: [The long-term GUP saga](https://lwn.net/Articles/807808/)**
* **LWN: [Pin user pages for DMA](https://lwn.net/Articles/812329/)**
* **Documentation: `Documentation/core-api/pin_user_pages.rst`**
* **Documentation: `Documentation/mm/gup.rst`**
* **Jason Gunthorpe's ODP talk, LPC 2019**
* **John Hubbard's GUP cleanup series (2019-2020)**

---

## Cross-References

* [Memory Management Overview](./index.md) — page allocator, zones, CMA
* [Huge Pages](./hugepages.md) — THP and hugetlb interactions with GUP
* [IOMMU](../drivers/iommu.md) — DMA address translation
* [RDMA](../networking/rdma.md) — primary consumer of GUP
* [Page Reclaim](./reclaim.md) — how pinned pages affect reclaim
