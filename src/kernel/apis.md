# Kernel APIs

The Linux kernel exposes a rich set of internal APIs that device drivers and
other kernel subsystems use to interact with hardware, manage memory, handle
concurrency, and communicate with user space. Unlike user-space libraries
(which link against shared objects), kernel code calls these routines through
**exported symbols** — functions and data objects that the kernel's symbol
table makes available to loadable modules.

Understanding the kernel API surface is essential for anyone writing or
reviewing kernel code. This chapter covers the most commonly used APIs
grouped into logical families.

---

## 1. Exported Symbols

Every function or variable that a kernel module must call from another
translation unit must be **exported** via one of two macros:

```c
EXPORT_SYMBOL(symbol_name);
EXPORT_SYMBOL_GPL(symbol_name);
```

| Macro | Visibility |
|---|---|
| `EXPORT_SYMBOL` | Available to any module, regardless of license |
| `EXPORT_SYMBOL_GPL` | Available **only** to modules whose license is GPL-compatible |

### How Exporting Works

At build time the `EXPORT_SYMBOL` macro emits a special ELF section
(`__ksymtab` and friends) containing the symbol name and its address.
At module load time the kernel's module loader resolves references against
this table.

```text
$ grep -c EXPORT_SYMBOL /proc/kallsyms
6832
```

You can inspect the live symbol table at any time:

```bash
$ cat /proc/kallsyms | head -5
ffffffff81000000 T _text
ffffffff81000000 T _stext
ffffffff81000000 T startup_64
ffffffff81001000 T secondary_startup_64
ffffffff81001000 T __start_bss
```

### Adding Your Own Export

```c
/* drivers/misc/my_helper.c */
#include <linux/module.h>

int my_helper_do_work(int arg)
{
    return arg * 2;
}
EXPORT_SYMBOL_GPL(my_helper_do_work);
```

Any module that then includes the header and links against the symbol can
call `my_helper_do_work()` at runtime.

---

## 2. Kernel Library Routines (`lib/`)

The kernel ships a large collection of **general-purpose library routines**
under `lib/`. These are *not* tied to any specific subsystem.

### 2.1 String and Memory APIs

| Function | Purpose |
|---|---|
| `strcpy`, `strncpy` | Copy strings (prefer `strscpy`) |
| `strscpy` | Safer string copy with guaranteed NUL termination |
| `strlcpy` | Deprecated in kernel — use `strscpy` |
| `strcmp`, `strncmp`, `strchr`, `strrchr` | Compare / search strings |
| `strlen`, `strnlen` | Measure length |
| `memcpy`, `memmove`, `memset`, `memcmp` | Raw memory operations |
| `kstrdup`, `kstrndup`, `kfree` | Allocate a copy of a string in kernel memory |
| `kasprintf` | `sprintf` into a `kmalloc`'d buffer |
| `snprintf`, `scnprintf` | Bounded formatting |

#### `strscpy` — The Preferred String Copy

```c
char dest[32];

/* strscpy returns the number of bytes copied (excluding NUL),
   or -E2NOSPC if truncation occurred. */
ssize_t ret = strscpy(dest, src, sizeof(dest));
if (ret == -E2NOSPC)
    pr_warn("string truncated\n");
```

#### `kstrdup` — Duplicate a String

```c
char *copy = kstrdup(original, GFP_KERNEL);
if (!copy)
    return -ENOMEM;

/* use copy ... */
kfree(copy);
```

### 2.2 Linked Lists (`<linux/list.h>`)

The kernel's **doubly-linked circular list** is one of the most used data
structures:

```c
#include <linux/list.h>

struct my_entry {
    int data;
    struct list_head node;   /* must be embedded */
};

LIST_HEAD(my_list);

struct my_entry *e = kmalloc(sizeof(*e), GFP_KERNEL);
e->data = 42;
list_add_tail(&e->node, &my_list);

/* Iterate safely (safe against removal) */
struct my_entry *cur;
list_for_each_entry(cur, &my_list, node) {
    pr_info("data = %d\n", cur->data);
}
```

### 2.3 Bitmaps

```c
#include <linux/bitmap.h>

DECLARE_BITMAP(my_bits, 256);

set_bit(42, my_bits);
clear_bit(42, my_bits);
int val = test_bit(42, my_bits);
```

### 2.4 Sort and Search

```c
#include <linux/sort.h>

sort(array, count, sizeof(array[0]), my_cmp_func, NULL);
```

---

## 3. `copy_to_user` / `copy_from_user`

When a driver needs to transfer data between kernel space and user-space
buffers (e.g., in a `read()` or `write()` system call), it **must** use
the dedicated copy helpers rather than raw `memcpy`:

```c
#include <linux/uaccess.h>

/* Kernel → User (used in .read / .copy_to_user) */
unsigned long copy_to_user(void __user *to, const void *from, unsigned long n);

/* User → Kernel (used in .write / .copy_from_user) */
unsigned long copy_from_user(void *to, const void __user *from, unsigned long n);
```

### Why Not `memcpy`?

1. **Security**: Kernel code must not dereference user pointers without
   validation — the address may be unmapped, non-canonical, or deliberately
   crafted to fault.
2. **SMAP / PAN**: On modern x86 and ARM CPUs, Supervisor Mode Access
   Prevention traps direct kernel reads/writes of user pages.
3. **`access_ok` checks**: The helpers verify the range is in user space.

### Return Value

Both functions return the number of bytes **not** copied. A return of 0
means success:

```c
static ssize_t my_read(struct file *f, char __user *buf,
                        size_t len, loff_t *off)
{
    char data[] = "hello from kernel";

    if (copy_to_user(buf, data, sizeof(data)))
        return -EFAULT;

    return sizeof(data);
}
```

### Short-Copy Idiom

```c
if (copy_to_user(buf, kern_buf, len))
    return -EFAULT;    /* some or all bytes failed */
```

For variable-length copies where partial success is acceptable (rare in
drivers), check the return value and adjust.

---

## 4. `printk` and the Kernel Log Buffer

`printk` is the kernel's primary logging mechanism — analogous to
`printf` in user space, but writes into a ring buffer consumed by
`dmesg` and optionally forwarded to consoles.

### Log Levels

```c
#define KERN_EMERG   KERN_SOH "0"   /* system is unusable */
#define KERN_ALERT   KERN_SOH "1"   /* action must be taken */
#define KERN_CRIT    KERN_SOH "2"   /* critical conditions */
#define KERN_ERR     KERN_SOH "3"   /* error conditions */
#define KERN_WARNING KERN_SOH "4"   /* warning conditions */
#define KERN_NOTICE  KERN_SOH "5"   /* normal but significant */
#define KERN_INFO    KERN_SOH "6"   /* informational */
#define KERN_DEBUG   KERN_SOH "7"   /* debug-level messages */
```

### Convenience Macros

```c
pr_emerg("format, ...\n");
pr_alert("format, ...\n");
pr_crit("format, ...\n");
pr_err("format, ...\n");
pr_warn("format, ...\n");
pr_notice("format, ...\n");
pr_info("format, ...\n");
pr_debug("format, ...\n");   /* compiled out unless DEBUG is defined */
```

### `pr_fmt` — Module-Wide Prefix

```c
#define pr_fmt(fmt) KBUILD_MODNAME ": " fmt
#include <linux/module.h>
#include <linux/printk.h>

pr_info("driver loaded\n");
/* Output: "my_module: driver loaded" */
```

### Rate-Limited and Once-Only Variants

```c
/* At most once per 5 seconds */
pr_warn_ratelimited("buffer overflow detected\n");

/* Print only on the first invocation */
pr_warn_once("deprecated path taken\n");
```

### Dynamic Debug (`dyndbg`)

For `pr_debug()` calls to be active at runtime without recompilation, enable
the dynamic debug subsystem:

```bash
# Enable all pr_debug in my_module
echo 'module my_module +p' > /sys/kernel/debug/dynamic_debug/control

# Enable a specific file + line
echo 'file drivers/misc/my.c line 42 +p' > /sys/kernel/debug/dynamic_debug/control
```

---

## 5. Kernel Memory Allocation

### 5.1 `kmalloc` / `kfree`

```c
void *p = kmalloc(size, GFP_KERNEL);   /* may sleep */
void *p = kmalloc(size, GFP_ATOMIC);   /* cannot sleep (interrupt context) */
kfree(p);
```

GFP flags control the allocator's behavior:

| Flag | Meaning |
|---|---|
| `GFP_KERNEL` | Normal kernel allocation; may sleep, may reclaim |
| `GFP_ATOMIC` | Never sleep; use in interrupt / spinlock context |
| `GFP_DMA` | Allocate from ISA DMA zone (< 16 MiB) |
| `GFP_ZERO` | Zero the returned memory |

### 5.2 `vmalloc`

Allocates virtually contiguous pages (not necessarily physically contiguous).
Useful for large buffers:

```c
void *p = vmalloc(1 << 20);   /* 1 MiB */
vfree(p);
```

### 5.3 Slab Caches (`kmem_cache`)

For objects of a fixed size that are allocated/freed frequently:

```c
struct kmem_cache *cache = kmem_cache_create("my_obj",
                            sizeof(struct my_obj),
                            0, 0, NULL);

struct my_obj *obj = kmem_cache_alloc(cache, GFP_KERNEL);
kmem_cache_free(cache, obj);
kmem_cache_destroy(cache);
```

---

## 6. Concurrency Primitives (Brief Overview)

```mermaid
graph TD
    A[Concurrency Need] --> B{Sleeping Allowed?}
    B -- Yes --> C[Mutex / Semaphore]
    B -- No --> D[Spinlock]
    D --> E{Need IRQ safety?}
    E -- Yes --> F[spin_lock_irqsave]
    E -- No --> G[spin_lock]
    C --> H{Multiple readers?}
    H -- Yes --> I[rw_semaphore]
    H -- No --> J[mutex_lock]
```

| Primitive | Header | Context |
|---|---|---|
| `spinlock_t` | `<linux/spinlock.h>` | Non-sleeping, interrupt-safe |
| `struct mutex` | `<linux/mutex.h>` | Sleeping allowed |
| `struct rw_semaphore` | `<linux/rwsem.h>` | Reader-writer lock |
| `atomic_t` | `<linux/atomic.h>` | Lock-free integer ops |
| `refcount_t` | `<linux/refcount.h>` | Safe reference counting |
| `RCU` | `<linux/rcupdate.h>` | Read-mostly data structures |

---

## 7. Error Handling Conventions

The kernel uses **negative errno** values for errors. The `ERR_PTR` / `PTR_ERR`
family encodes errors into pointer return values:

```c
#include <linux/err.h>

struct device *dev = get_device();
if (IS_ERR(dev)) {
    int err = PTR_ERR(dev);   /* e.g., -ENODEV */
    return err;
}
```

Common idioms:

```c
return -ENODEV;       /* No such device */
return -ENOMEM;       /* Out of memory */
return -EINVAL;       /* Invalid argument */
return -EIO;          /* I/O error */
return -EACCES;       /* Permission denied */
```

---

## 8. Module Lifecycle APIs

```c
#include <linux/module.h>
#include <linux/init.h>

static int __init my_init(void) { /* ... */ return 0; }
static void __exit my_exit(void) { /* ... */ }

module_init(my_init);
module_exit(my_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Your Name");
MODULE_DESCRIPTION("A sample module");
```

---

## 9. Kernel API Map

```mermaid
graph LR
    subgraph "User-Space Interface"
        SYSCALL[syscalls]
        IOCTL[ioctl]
        PROC[/proc, /sys/]
    end
    subgraph "Kernel API Surface"
        VFS[VFS / file_operations]
        MM[Memory Management]
        KAPI[Core Kernel APIs]
        DRV[Driver Model]
    end
    subgraph "Hardware"
        HW[Devices]
    end
    SYSCALL --> VFS
    IOCTL --> VFS
    PROC --> KAPI
    VFS --> KAPI
    MM --> KAPI
    KAPI --> DRV
    DRV --> HW
```

---

## Further Reading

- [Linux kernel docs — Basic kernel library functions](https://docs.kernel.org/core-api/kernel-api.html)
- [Linux kernel docs — printk documentation](https://docs.kernel.org/core-api/printk-basics.html)
- [LWN: Export Symbol](https://lwn.net/Articles/830965/)
- [LWN: copy_to_user and friends](https://lwn.net/Articles/722267/)
- [Linux Device Drivers, 3rd Edition — Chapter 1](https://lwn.net/Kernel/LDD3/)

## Related Topics

- [Character Devices](drivers/char-devices.md) — registering file_operations that call these APIs
- [Device Model Overview](drivers/overview.md) — kobject and sysfs
- [Block Layer Overview](block/overview.md) — bio and request APIs
- [PCI Subsystem](drivers/pci.md) — PCI driver APIs
