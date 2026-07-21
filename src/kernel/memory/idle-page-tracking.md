# Idle Page Tracking

Idle page tracking is a kernel mechanism that identifies memory pages which have
not been accessed over a configurable observation period. It is the foundation
for memory-tiering, proactive reclaim, and cold-page demotion on systems with
heterogeneous memory (e.g., DRAM + CXL / PMEM).

> **Introduced:** Linux 4.3 (per-page idle bits via `/sys/kernel/mm/page_idle`)  
> **Enhanced:** Linux 5.15+ (DAMON-based idle tracking with lower overhead)

---

## How It Works

The kernel maintains a per-page **idle bit** in a bitmap exposed through sysfs.
User space (or kernel subsystems) can:

1. **Set** idle bits on a set of pages (mark them "potentially idle").
2. **Wait** for a period.
3. **Read** back the bits — cleared bits indicate the page was accessed.

This two-phase approach avoids continuous access-flag scanning and keeps
overhead proportional to the number of pages monitored.

### Key Characteristics

- Works on **page-frame granularity** (typically 4 KiB).
- Requires no special hardware; uses the CPU's page-table Accessed bit.
- Overhead scales with the number of pages marked, not total RAM.
- Suitable for background daemons (e.g., `memory-tierd`, custom scripts).

---

## `/sys/kernel/mm/page_idle`

The primary interface is a sysfs bitmap file:

```
/sys/kernel/mm/page_idle/bitmap
```

Each bit corresponds to one page frame (PFN). Bit *N* → PFN *N*.

### Operations

| Operation | Mechanism | Effect |
|-----------|-----------|--------|
| **Mark idle** | Write `1` to bits for target PFNs | Sets the idle bit; next access clears it |
| **Clear idle** | Write `0` to bits | Removes idle tracking for those pages |
| **Read status** | Read the bitmap | Bit=1 → not accessed since last mark; Bit=0 → accessed |

### Reading Idle Pages

```bash
# Determine page size
PAGE_SIZE=$(getconf PAGE_SIZE)   # usually 4096

# Read the bitmap (binary; 8 bytes = 64 pages)
dd if=/sys/kernel/mm/page_idle/bitmap bs=8 count=1 skip=$((PFN / 64)) 2>/dev/null \
  | xxd -p
```

### Marking Pages Idle

```bash
# Mark a specific page frame as idle
echo $((1 << (PFN % 64))) > /sys/kernel/mm/page_idle/bitmap
```

In practice, user-space tools iterate over `/proc/<pid>/pagemap` to resolve
virtual addresses → PFNs, then mark those PFNs in the idle bitmap.

### User-Space Workflow

```
┌─────────────────────────────────────────────────┐
│  1. Read /proc/<pid>/pagemap to get PFNs        │
│  2. Write idle bits to page_idle/bitmap         │
│  3. Sleep (observation window)                  │
│  4. Read page_idle/bitmap back                  │
│  5. Bit still set → page was NOT accessed (cold)│
│     Bit cleared  → page was accessed     (hot)  │
└─────────────────────────────────────────────────┘
```

### Example: Finding Cold Pages of a Process

```python
import struct, os, time

PAGE_SIZE = os.sysconf("SC_PAGE_SIZE")
IDLE_PATH = "/sys/kernel/mm/page_idle/bitmap"

def get_pfn(pid, vaddr):
    """Resolve virtual address to page frame number."""
    index = (vaddr // PAGE_SIZE) * 8
    with open(f"/proc/{pid}/pagemap", "rb") as f:
        f.seek(index)
        entry = struct.unpack("Q", f.read(8))[0]
    return entry & 0x7FFFFFFFFFFFFF

def mark_idle(pfn):
    byte_off = (pfn // 64) * 8
    bit = 1 << (pfn % 64)
    with open(IDLE_PATH, "r+b") as f:
        f.seek(byte_off)
        val = struct.unpack("Q", f.read(8))[0]
        f.seek(byte_off)
        f.write(struct.pack("Q", val | bit))

def is_idle(pfn):
    byte_off = (pfn // 64) * 8
    bit = 1 << (pfn % 64)
    with open(IDLE_PATH, "rb") as f:
        f.seek(byte_off)
        val = struct.unpack("Q", f.read(8))[0]
    return bool(val & bit)

# --- Main ---
pid = 1234
vaddrs = [0x7ffc12340000, 0x7ffc12341000]  # example addresses

pfns = [get_pfn(pid, v) for v in vaddrs]
for p in pfns:
    mark_idle(p)

time.sleep(60)  # observe for 60 seconds

cold = [p for p in pfns if is_idle(p)]
print(f"Cold pages (not accessed in 60s): {cold}")
```

---

## Integration with DAMON

**DAMON** (Data Access MONitor) provides a more sophisticated, lower-overhead
approach to tracking memory access patterns. Starting with Linux 5.15, DAMON
can feed idle-page information into the kernel's memory management subsystem
directly.

### DAMON vs. Raw page_idle

| Aspect | `page_idle` bitmap | DAMON |
|--------|--------------------|-------|
| **Overhead** | Proportional to pages marked | Adaptive sampling; low & bounded |
| **Granularity** | Per-page (4 KiB) | Region-based (configurable) |
| **Kernel integration** | User-space driven | In-kernel schemes (reclaim, tiering) |
| **Scalability** | Limited at scale (TB RAM) | Designed for large memories |
| **Interface** | Sysfs bitmap | Sysfs + debugfs + DAMON API |

### DAMON-Based Idle Tracking

DAMON monitors access patterns by sampling page-table Accessed bits at the
**region** level. Regions are dynamically split/merged based on access hotness:

```
┌────────────────────────────────────────────────┐
│              DAMON Region Tracking             │
│                                                │
│  Region A (hot):  accessed frequently → keep   │
│  Region B (warm): accessed occasionally        │
│  Region C (cold): no access for N intervals    │
│       → candidate for demotion / reclaim       │
└────────────────────────────────────────────────┘
```

### DAMON Sysfs Interface

```bash
# Enable DAMON
echo on > /sys/kernel/mm/damon/admin/kdamonds/nr

# Configure monitoring target (e.g., all physical memory)
echo 0 > /sys/kernel/mm/damon/admin/kdamonds/0/state
echo physical > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/operations

# Set monitoring parameters
echo 1000 > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/monitoring_attrs/intervals/sample_us
echo 100000 > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/monitoring_attrs/intervals/aggr_us
echo 10000000 > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/monitoring_attrs/intervals/update_us

# Apply a "cold page" scheme: pages not accessed for 2 aggregation intervals
# are reclaimed
echo 2 > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/schemes/0/access_pattern/sz/min
echo max > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/schemes/0/access_pattern/sz/max
echo 0 > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/schemes/0/access_pattern/nr_accesses/min
echo 0 > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/schemes/0/access_pattern/nr_accesses/max
echo 2 > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/schemes/0/access_pattern/age/min
echo max > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/schemes/0/access_pattern/age/max
echo pageout > /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/schemes/0/action

# Start monitoring
echo on > /sys/kernel/mm/damon/admin/kdamonds/0/state
```

### DAMON Sysfs Tree Layout

```
/sys/kernel/mm/damon/admin/
└── kdamonds/
    └── 0/
        ├── state              # on|off|commit|update_schemes_stats|...
        ├── pid                # target PID (for virtual address spaces)
        └── contexts/
            └── 0/
                ├── operations # vaddr|physical
                ├── monitoring_attrs/
                │   ├── intervals/
                │   │   ├── sample_us
                │   │   ├── aggr_us
                │   │   └── update_us
                │   └── nr_regions/
                │       ├── min
                │       └── max
                └── schemes/
                    └── 0/
                        ├── action       # noop|pageout|pageout|lru_prio|lru_deprivo|...
                        └── access_pattern/
                            ├── sz/
                            ├── nr_accesses/
                            └── age/
```

---

## Memory Tiering with Idle Tracking

On systems with multiple memory tiers (DRAM, CXL, PMEM), idle page tracking
enables **demotion** of cold pages to slower, cheaper tiers:

```
┌──────────────────────────────────────────────────────┐
│                    DRAM (Hot Tier)                    │
│  Active pages: frequently accessed                   │
│                                                      │
│  ┌──────────────┐                                    │
│  │ Idle Tracking │──cold──→  CXL / PMEM (Cold Tier)  │
│  │  + DAMON     │←─hot────  Promote back if accessed │
│  └──────────────┘                                    │
└──────────────────────────────────────────────────────┘
```

### Kernel Config for Tiering

```
CONFIG_DAMON=y
CONFIG_DAMON_VADDR=y          # virtual address space monitoring
CONFIG_DAMON_PADDR=y          # physical address space monitoring
CONFIG_DAMON_SYSFS=y          # sysfs interface
CONFIG_DAMON_RECLAIM=y        # proactive reclaim scheme
CONFIG_DAMON_LRU_PRIO=y       # LRU prioritization
```

### Proactive Reclaim (DAMON_RECLAIM)

When `CONFIG_DAMON_RECLAIM=y`, the kernel can proactively reclaim cold pages
before memory pressure hits:

```bash
# Check DAMON reclaim stats
cat /sys/kernel/mm/damon/admin/kdamonds/0/contexts/0/schemes/0/stats/nr_reclaimed
```

---

## The `/proc/<pid>/smaps` Interface

Idle page information is also partially reflected in `/proc/<pid>/smaps`:

```bash
# View memory region details including Referenced/Idle hints
cat /proc/1234/smaps | grep -E "^(Size|Rss|Referenced|LazyFree)"
```

The `Referenced` field reflects pages accessed since last clearing, which
overlaps conceptually with idle tracking.

---

## Performance Considerations

| Concern | Mitigation |
|---------|------------|
| Bitmap I/O overhead for large PFN ranges | Use `pread`/`pwrite` with offsets; batch PFNs into 64-page blocks |
| Race between marking and reading | Acceptable for statistical sampling; not for exact accounting |
| Huge pages | Idle bits track base pages; huge page faults clear the bit for all constituent pages |
| NUMA awareness | Bitmap is global; correlate with NUMA node via `/sys/devices/system/node/` |

### Reducing Overhead

- Use **DAMON** for systems with >64 GiB RAM.
- For `page_idle`, only mark pages belonging to target processes.
- Batch operations: set/read 64 PFNs per 8-byte read/write.

---

## Relation to Other Memory Features

- **Idle page tracking** identifies *which* pages are cold.
- **[LRU lists](/kernel/memory)** use age-based heuristics for reclaim order.
- **[DAMON](/kernel/memory/damon)** automates the mark-wait-act cycle.
- **[hugetlb](/kernel/memory/hugetlb)** pages have separate idle semantics.
- **Memory compaction** operates on reclaimable pages, including idle pages.

---

## Troubleshooting

### `page_idle/bitmap` returns all zeros

- Ensure you are **setting** idle bits before waiting.
- Check that the PFN range is valid (`/proc/iomem`).
- Verify kernel config: `CONFIG_IDLE_PAGE_TRACKING=y`.

### DAMON shows no regions

- Confirm `state` is `on`.
- Check `nr_regions/min` is not set too high.
- Review `dmesg | grep damon` for errors.

### High CPU usage from idle tracking loop

- Increase the observation window (sleep longer between mark and read).
- Reduce the set of monitored pages.
- Switch to DAMON for adaptive sampling.

---

## Further Reading

- [Kernel docs: Idle Page Tracking](https://www.kernel.org/doc/html/latest/admin-guide/mm/idle_page_tracking.html)
- [Kernel docs: DAMON](https://www.kernel.org/doc/html/latest/mm/damon/index.html)
- [DAMON design document](https://damonitor.github.io/doc/html/latest/)
- [LWN: Idle page tracking (2015)](https://lwn.net/Articles/643739/)
- [LWN: DAMON for memory management](https://lwn.net/Articles/858728/)
- [Memory tiering in Linux — CXL and beyond](https://lwn.net/Articles/894846/)
- See also: [LRU Page Management](/kernel/memory), [DAMON](/kernel/memory/damon), [Page Reclaim](/kernel/memory/reclaim)
