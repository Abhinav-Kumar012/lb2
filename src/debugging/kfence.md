# KFENCE: Low-Overhead Sampling Memory Error Detector

## Introduction

KFENCE (Kernel Electric-Fence) is a low-overhead sampling-based memory error detector
for the Linux kernel. Introduced in Linux 5.12, KFENCE detects heap memory errors
such as out-of-bounds accesses, use-after-free, and invalid-free operations at runtime.
Unlike KASAN (Kernel Address Sanitizer), which incurs significant performance overhead
(2-3x), KFENCE uses a sampling approach that adds less than 1% overhead, making it
suitable for production systems. KFENCE works by placing guard pages around sampled
slab allocations, causing immediate page faults on invalid access.

## Design Overview

```mermaid
graph TD
    A[Slab Allocator] --> B{Sample Decision}
    B -->|99.99%: Normal allocation| C[Standard slab cache]
    B -->|0.01%: Sample| D[KFENCE Pool]
    D --> E[Left Guard Page]
    E --> F[Allocated Object]
    F --> G[Right Guard Page]
    G --> H[Poison / Free State]
```

### How KFENCE Works

KFENCE maintains a small pool of memory pages set aside for sampled allocations:

```
Memory Layout:
┌──────────────┐
│ Guard Page   │  ← Unmapped (PAGE_NONE)
│ (no access)  │     Any access = immediate page fault
├──────────────┤
│ Object       │  ← The actual allocation
│ (4K page)    │     Valid only while allocated
├──────────────┤
│ Guard Page   │  ← Unmapped (PAGE_NONE)
│ (no access)  │     Any access = immediate page fault
└──────────────┘
```

When an allocation is sampled by KFENCE:
1. It's placed between two **guard pages** (unmapped pages)
2. Adjacent objects in the slab cache are **not** affected
3. Any out-of-bounds access hits the guard page → page fault → error report

## Error Detection Capabilities

```mermaid
graph TD
    A[Memory Access] --> B{KFENCE allocation?}
    B -->|No| C[Normal access]
    B -->|Yes| D{Access within bounds?}
    D -->|Yes| E{Object state?}
    D -->|No| F[PAGE FAULT → OOB Report]
    E -->|Allocated| G[Access allowed]
    E -->|Freed| H[PAGE FAULT → Use-After-Free Report]
```

### Detected Error Types

| Error Type | Detection Mechanism | Example |
|-----------|-------------------|---------|
| Heap out-of-bounds read | Guard page fault | Reading past allocation end |
| Heap out-of-bounds write | Guard page fault | Writing past allocation end |
| Use-after-free | Guard page + poison check | Accessing freed memory |
| Double-free | Free-list state check | Calling kfree() twice |
| Invalid-free | Address validation | kfree() on non-KFENCE address |

## KFENCE Pool

```c
/* mm/kfence/core.c - pool initialization */
#define KFENCE_POOL_SIZE (CONFIG_KFENCE_NUM_OBJECTS * 2 * PAGE_SIZE)

static struct kfence_metadata kfence_metadata[CONFIG_KFENCE_NUM_OBJECTS];
static char *kfence_pool;

static int __init kfence_init_pool(void)
{
    /* Allocate the KFENCE pool (typically 1-2 MB) */
    kfence_pool = memblock_alloc(KFENCE_POOL_SIZE, PAGE_SIZE);

    /* Map guard pages as PAGE_NONE (no access) */
    /* Map object pages as normal */
    for (i = 0; i < CONFIG_KFENCE_NUM_OBJECTS; i++) {
        unsigned long addr = (unsigned long)kfence_pool +
                              i * 2 * PAGE_SIZE;

        /* Left guard page */
        set_memory_np(addr, 1);

        /* Object page: initially also PAGE_NONE (freed state) */
        set_memory_np(addr + PAGE_SIZE, 1);

        /* Right guard page */
        set_memory_np(addr + 2 * PAGE_SIZE, 1);
    }

    return 0;
}
```

### Metadata Tracking

```c
struct kfence_metadata {
    struct list_head list;          /* Free list linkage */
    struct kmem_cache *cache;       /* Source slab cache */
    unsigned long obj_addr;         /* Object address */
    unsigned long allocated_by;     /* Allocation stack trace */
    unsigned long freed_by;         /* Free stack trace */
    bool is_redzone;                /* In redzone (freed) state */
    /* ... */
};
```

## Sampling Mechanism

KFENCE allocates objects from its pool at a configurable sampling rate:

```c
/* mm/kfence/core.c - allocation sampling */
static struct kfence_metadata *kfence_alloc_from_pool(void)
{
    struct kfence_metadata *meta;

    /* Check if sampling interval has elapsed */
    if (!time_after(jiffies, kfence_sample_interval))
        return NULL;

    /* Pick the next free object from the pool */
    if (list_empty(&kfence_freelist))
        return NULL;

    meta = list_first_entry(&kfence_freelist,
                             struct kfence_metadata, list);
    list_del(&meta->list);

    /* Map the object page */
    set_memory_rw(meta->obj_addr, 1);

    /* Poison the memory (detect use-after-free) */
    memset((void *)meta->obj_addr, KFENCE_KMALLOC_REDZONE, PAGE_SIZE);

    return meta;
}
```

### Integration with SLAB/SLUB

```c
/* mm/kfence/hooks.c - hook into slab allocator */
void *__kfence_kmalloc(struct kmem_cache *s, size_t size, gfp_t flags)
{
    struct kfence_metadata *meta;
    unsigned long addr;

    /* Should we sample this allocation? */
    if (!kfence_sample_interval || !kfence_is_enabled())
        return NULL;

    /* Get a KFENCE object from the pool */
    meta = kfence_alloc_from_pool();
    if (!meta)
        return NULL;

    addr = meta->obj_addr;

    /* Track metadata */
    meta->cache = s;
    meta->allocated_by = _RET_IP_;

    /* Align the object within the KFENCE page */
    return (void *)(addr + kfence_guarded_slab_offset(s, size));
}

/* Hook into kfree() */
void __kfence_kfree(void *addr)
{
    struct kfence_metadata *meta = kfence_metadata_of(addr);

    if (!meta) return;

    /* Record the free stack trace */
    meta->freed_by = _RET_IP_;

    /* Poison the freed memory */
    memset(addr, KFENCE_KMALLOC_REDZONE, meta->cache->object_size);

    /* Unmap the object page (now a guard page) */
    set_memory_np(meta->obj_addr, 1);

    /* Return to free list */
    kfence_return_to_pool(meta);
}
```

## Page Fault Handler

When a guard page is accessed, KFENCE's page fault handler detects the error:

```c
/* mm/kfence/core.c - fault handler */
static vm_fault_t kfence_handle_page_fault(unsigned long addr,
                                            struct pt_regs *regs)
{
    struct kfence_metadata *meta;
    bool is_write;
    int report_type;

    meta = kfence_metadata_for_addr(addr);
    if (!meta)
        return VM_FAULT_SIGBUS;  /* Not a KFENCE page */

    /* is_write is provided by the architecture-specific fault handler */
    /* (passed as parameter, not derived from regs->ip) */

    if (meta->is_redzone) {
        if (meta->freed_by)
            report_type = KFENCE_ERROR_UAF;
        else
            report_type = KFENCE_ERROR_OOB;
    } else {
        report_type = KFENCE_ERROR_OOB;
    }

    /* Generate a detailed report */
    kfence_report_error(addr, is_write, report_type, meta, regs);

    return VM_FAULT_SIGBUS;
}
```

## Error Reports

KFENCE produces detailed reports in the kernel log:

```
==================================================================
BUG: KFENCE: out-of-bounds read in kfence_test+0x42/0x100

Out-of-bounds read at 0xffffffff82c0a001 (4B):
 kfence_test+0x42/0x100
 do_one_initcall+0x5b/0x300
 kernel_init_freeable+0x1a0/0x1f0

Allocated by task 1:
 kfence_alloc+0x50/0x80
 __kmalloc+0x120/0x300
 kfence_test_init+0x20/0x40
 do_one_initcall+0x5b/0x300

Freed by task 0:
 kfence_free+0x30/0x60
 kfree+0x100/0x200
 kfence_test_init+0x80/0x40

CPU: 0 PID: 1 Comm: swapper/0 Not tainted
Hardware: QEMU Standard PC
==================================================================
```

## Sysfs Interface

```
/sys/kernel/debug/kfence/
├── stats           # Allocation/error statistics
```

### Runtime Control

```bash
# Check KFENCE status
cat /proc/cmdline | grep kfence

# View KFENCE statistics
cat /sys/kernel/debug/kfence/stats

# Enable/disable at runtime (Linux 5.15+)
echo 1 > /sys/module/kfence/parameters/sample_interval
```

## Configuration

### Kernel Build Options

```
CONFIG_KFENCE=y
CONFIG_KFENCE_NUM_OBJECTS=100       # Number of objects in pool (default: 100)
CONFIG_KFENCE_STRESS_TEST_FAULTS=0  # For testing only
```

### Boot Parameters

```
kfence.sample_interval=100   # Sample every 100ms (default)
kfence.num_objects=100       # Number of objects (default)
kfence.enable=1              # Enable/disable (default: 1)
```

### Typical Production Settings

```bash
# Boot with KFENCE enabled (low overhead)
# In GRUB or kernel cmdline:
kfence.sample_interval=100

# For catching more bugs (slightly higher overhead):
kfence.sample_interval=10
kfence.num_objects=200
```

## Comparison with KASAN

| Feature | KFENCE | KASAN |
|---------|--------|-------|
| Overhead | < 1% | 2-3x |
| Detection rate | Statistical | Deterministic |
| Memory overhead | ~1-2 MB fixed | ~1/4 of RAM |
| Production use | ✓ | ✗ (too slow) |
| Stack errors | ✗ | ✓ (KASAN stack) |
| Global variables | ✗ | ✓ |
| Out-of-bounds | ✓ | ✓ |
| Use-after-free | ✓ | ✓ |
| Double-free | ✓ | ✓ |
| Uninitialized memory | ✗ | ✓ (KMSAN) |

### When to Use Each

```mermaid
graph TD
    A[Memory Bug Detected in Production] --> B{Can reproduce in dev?}
    B -->|Yes| C[Use KASAN for detailed analysis]
    B -->|No| D[Enable KFENCE in production]
    D --> E[Wait for next occurrence]
    E --> F[KFENCE catches it with stack trace]
    F --> G[Fix and disable KFENCE]

    H[Development/CI] --> I[Use KASAN always]
    I --> J[Full coverage]
```

## Advanced: Custom Redzone Patterns

KFENCE uses specific byte patterns to detect different error conditions:

```c
/* Poison values */
#define KFENCE_KMALLOC_REDZONE  0xAA  /* Allocated redzone */
#define KFENCE_FREE_REDZONE     0xBB  /* Freed memory pattern */
#define KFENCE_PADDING_REDZONE  0xCC  /* Padding bytes */

/* When object is freed:
 * Bytes 0x00..0x0F: Free header
 * Bytes 0x10..0x1F: KFENCE_FREE_REDZONE (0xBB)
 * ... all filled with 0xBB
 */
```

## Debugging with KFENCE

### Reproducing KFENCE Bugs

Since KFENCE is sampling-based, bugs may take time to appear. Strategies:

```bash
# 1. Decrease sampling interval (catch more bugs)
kfence.sample_interval=1

# 2. Increase pool size (more concurrent samples)
kfence.num_objects=500

# 3. Combine with KASAN for development
# (KASAN for deterministic, KFENCE for production)
```

### KFENCE + ktest

```bash
#!/bin/bash
# Run workload repeatedly with KFENCE enabled
for i in $(seq 1 1000); do
    ./my_test_program
    dmesg | grep -q "BUG: KFENCE" && {
        echo "KFENCE bug found on iteration $i!"
        dmesg | tail -50
        break
    }
done
```

## Performance Impact

Measured on typical server workloads:

| Workload | KFENCE Overhead | Notes |
|----------|----------------|-------|
| Kernel compilation | < 0.5% | Build system benchmark |
| Redis | < 0.3% | Throughput benchmark |
| PostgreSQL | < 0.5% | pgbench |
| Nginx | < 0.2% | HTTP request throughput |
| MySQL | < 0.5% | sysbench |

## Cross-References

- [Slab Allocator](../kernel/memory/slab-allocator.md) - How kernel heap allocation works
- [Page Allocator](../kernel/memory/page-allocator.md) - Underlying page management
- [Sanitizers](sanitizers.md) - KASAN, KMSAN, KCSAN
- [Valgrind](valgrind.md) - Userspace memory error detection
- [Kernel Debugging](kernel-debugging.md) - General kernel debugging techniques
- [ftrace](ftrace.md) - Function tracing for debugging
- [OOM Killer](../kernel/memory/oom-killer.md) - Out-of-memory handling

## Further Reading

- [KFENCE documentation](https://www.kernel.org/doc/html/latest/dev-tools/kfence.html)
- [KFENCE: Low-overhead sampling-based memory safety (LWN.net)](https://lwn.net/Articles/831367/)
- [KFENCE design document (Google)](https://docs.google.com/document/d/1KEx2TQGLZIz5YPp3dCJc9DFHiJlbmXjnxxwLxsSvUjE/)
- [KFENCE patches (lore.kernel.org)](https://lore.kernel.org/linux-mm/?q=kfence)
- [Alexander Potapenko's KFENCE talk](https://www.youtube.com/watch?v=Qn6kFjPwQXQ)
- [KASAN documentation](https://www.kernel.org/doc/html/latest/dev-tools/kasan.html)
- [Google's KernelSanitizer page](https://github.com/google/sanitizers)
