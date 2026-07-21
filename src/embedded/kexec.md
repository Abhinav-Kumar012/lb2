# Kexec: Fast Reboot and Crash Dumps

## Overview

kexec is a Linux kernel mechanism that allows **loading and booting a new kernel from a running kernel** without going through the BIOS/firmware. It has two primary use cases:

1. **Fast reboot (`kexec -e`)**: Skip the BIOS/POST and boot directly into a new kernel, reducing reboot time from minutes to seconds.
2. **Crash dumps (`kdump`)**: Load a secondary "capture" kernel that boots when the primary kernel panics, capturing the crashed kernel's memory for post-mortem analysis.

kexec works by loading the new kernel image into memory while the current kernel is running, then transferring control to the new kernel when triggered.

## System Calls

### kexec_load (Legacy)

```c
#include <linux/kexec.h>

long kexec_load(unsigned long entry, unsigned long nr_segments,
                struct kexec_segment *segments, unsigned long flags);
```

The legacy `kexec_load()` system call loads a kernel image into memory:

```c
struct kexec_segment {
    void __user *buf;      /* Data buffer in userspace */
    size_t bufsz;          /* Size of buffer */
    void __user *mem;      /* Destination in kernel memory */
    size_t memsz;          /* Size of destination */
};
```

**Flags:**

| Flag | Description |
|------|-------------|
| `KEXEC_ON_CRASH` | Load for crash kernel (kdump) |
| `KEXEC_PRESERVE_CONTEXT` | Preserve current context (hibernate) |
| `KEXEC_FILE_NO_INITRAMFS` | No initramfs needed |

### kexec_file_load (Modern)

```c
long kexec_file_load(int kernel_fd, int initrd_fd,
                     unsigned long cmdline_len, const char __user *cmdline,
                     unsigned long flags);
```

The modern `kexec_file_load()` uses file descriptors instead of memory buffers:

```c
/* Load a new kernel */
int kernel_fd = open("/boot/vmlinuz-6.1.0", O_RDONLY);
int initrd_fd = open("/boot/initrd.img-6.1.0", O_RDONLY);
const char *cmdline = "root=/dev/sda1 ro";

syscall(__NR_kexec_file_load, kernel_fd, initrd_fd,
        strlen(cmdline) + 1, cmdline, 0);
```

**Advantages over kexec_load:**

- **Simpler API**: just pass file descriptors and command line
- **Signature verification**: supports IMA and secure boot verification
- **No userspace memory staging**: kernel reads files directly
- **More secure**: reduced attack surface

**Flags:**

| Flag | Description |
|------|-------------|
| `KEXEC_FILE_UNLOAD` | Unload previously loaded kernel |
| `KEXEC_FILE_ON_CRASH` | Load for crash kernel |
| `KEXEC_FILE_NO_INITRAMFS` | No initramfs needed |
| `KEXEC_FILE_DEBUG` | Enable debug output |

## Fast Reboot

### How It Works

```
Current kernel (running)
    │
    │  kexec_load() — load new kernel into reserved memory
    │
    │  kexec -e (or reboot with kexec flag)
    │
    ↓
┌──────────────────────┐
│  kexec_reboot()      │
│  1. Disable IRQs     │
│  2. Shut down devices│
│  3. Load new kernel  │
│  4. Jump to entry    │
└──────────────────────┘
    │
    ↓
New kernel boots (skips BIOS)
```

### Usage

```bash
# Load a kernel for fast reboot
kexec -l /boot/vmlinuz-6.1.0 \
      --initrd=/boot/initrd.img-6.1.0 \
      --command-line="root=/dev/sda1 ro quiet"

# Execute the loaded kernel
kexec -e

# Or: reboot using kexec (systemd)
systemctl kexec
```

### Benefits

- **Speed**: Reboot in 2–5 seconds instead of 30–120 seconds (no BIOS POST)
- **Server farms**: massive time savings when rebooting hundreds of machines
- **Updates**: fast kernel updates with minimal downtime

### Limitations

- **No firmware re-initialization**: hardware state may not be fully reset
- **ACPI**: tables from the old kernel are reused
- **KASLR**: new kernel may have different ASLR offsets
- **Device state**: devices may retain state from the old kernel
- **Not a cold boot**: memory errors or hardware issues won't be cleared

## Kdump (Crash Dumps)

### Architecture

```
┌──────────────────────────────────────────────┐
│              Normal Operation                 │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Production Kernel (kernel 1)        │    │
│  │  Running normally                    │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Crash Kernel (kernel 2) — loaded    │    │
│  │  but NOT running                     │    │
│  │  (reserved memory area)              │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘

Kernel 1 panics!
    │
    ↓
┌──────────────────────────────────────────────┐
│              Crash Event                     │
│                                              │
│  1. Panic handler triggers kexec             │
│  2. Control transfers to crash kernel        │
│  3. Crash kernel boots in reserved memory    │
│  4. Old kernel's memory is /proc/vmcore      │
│  5. Crash dump saved to disk/network         │
└──────────────────────────────────────────────┘
```

### Setup

#### Step 1: Reserve Memory for Crash Kernel

Add to kernel command line (GRUB):

```bash
# In /etc/default/grub
GRUB_CMDLINE_LINUX="crashkernel=256M"

# Or more specific (range-based reservation)
GRUB_CMDLINE_LINUX="crashkernel=256M@64M"

# Update GRUB
update-grub
```

Memory reservation sizes:

| System RAM | Recommended crashkernel |
|------------|----------------------|
| < 4 GB | 128M |
| 4–16 GB | 256M |
| 16–64 GB | 512M |
| > 64 GB | 1G+ |

#### Step 2: Load the Crash Kernel

```bash
# Load crash kernel
kexec -p /boot/vmlinuz-$(uname -r) \
      --initrd=/boot/initrd.img-$(uname -r) \
      --command-line="$(cat /proc/cmdline) irqpoll maxcpus=1 reset_devices"

# The -p flag means "load for panic" (kdump mode)
```

The crash kernel command line typically includes:

| Parameter | Purpose |
|-----------|---------|
| `irqpoll` | Try all IRQs (crash kernel may not have correct IRQ routing) |
| `maxcpus=1` | Boot only on one CPU (the one that panicked) |
| `reset_devices` | Attempt to reset devices |
| `1` or `single` | Boot to single-user mode |
| `root=/dev/...` | Root filesystem |

#### Step 3: Automatic Loading (systemd)

```bash
# Enable kdump service
systemctl enable kdump
systemctl start kdump

# Check status
systemctl status kdump
kdump-config show
```

### Saving Crash Dumps

After the crash kernel boots, the old kernel's memory is available at `/proc/vmcore`. Various mechanisms save it:

#### Local Disk

```bash
# makedumpfile: compressed, filtered dump
makedumpfile -l -d 31 /proc/vmcore /var/crash/vmcore.dump

# Compression levels:
#   -d 0  = no filter (all pages)
#   -d 1  = exclude zero pages
#   -d 2  = exclude zero and cache pages
#   -d 4  = exclude user data pages
#   -d 8  = exclude free pages
#   -d 31 = all filters combined
```

#### Network (SSH/SCP)

```bash
# Save to remote server
makedumpfile -l -d 31 /proc/vmcore | ssh user@server "cat > /var/crash/vmcore.dump"

# Or using netdump/diskdump protocols
```

#### Remote Dump Server

```bash
# Configure /etc/kdump.conf
ssh user@dumpserver
path /var/crash
core_collector makedumpfile -l -d 31
```

### Analyzing Crash Dumps

```bash
# Using the crash utility
crash /usr/lib/debug/boot/vmlinux-$(uname -r) /var/crash/vmcore

# Inside crash:
crash> bt              # Backtrace of crashed task
crash> bt -a           # All tasks
crash> log             # Kernel log (dmesg)
crash> ps              # Process list
crash> vm              # Virtual memory info
crash> files           # Open files
crash> kmem -i         # Memory usage
crash> sys             # System info
crash> irq             # IRQ info
crash> mod             # Loaded modules
crash> rd -d <addr>    # Read memory
crash> struct task_struct <addr>  # Inspect data structures
```

## Implementation

### kexec_load Flow

```c
/* In kernel/kexec.c */
SYSCALL_DEFINE4(kexec_load, unsigned long, entry, unsigned long, nr_segments,
                struct kexec_segment __user *, segments, unsigned long, flags)
{
    /* 1. Validate arguments */
    /* 2. Check capabilities (CAP_SYS_BOOT) */
    /* 3. Copy segments from userspace */
    /* 4. If KEXEC_ON_CRASH: validate crash kernel memory reservation */
    /* 5. Load segments into kernel memory */
    /* 6. Store the loaded image in kimage (per-flag: normal vs crash) */
}
```

### kexec_execute

When `kexec -e` is called (or the system reboots with kexec flag):

```c
/* In kernel/kexec.c */
void kernel_kexec(void)
{
    struct kimage *image;

    image = kexec_image;
    if (!image)
        return;

    /* 1. Freeze all CPUs (except the executing one) */
    /* 2. Suspend devices */
    /* 3. Disable IRQs */
    /* 4. Machine-specific reboot hook */
    /* 5. Jump to the new kernel's entry point */
}
```

### Crash Path

When the kernel panics:

```c
/* In kernel/panic.c */
void panic(const char *fmt, ...)
{
    /* ... existing panic handling ... */

    /* Try kexec if a crash kernel is loaded */
    if (kexec_crash_loaded()) {
        /* Disable preemption, stop other CPUs */
        /* Jump to crash kernel */
        machine_kexec(kexec_image);
    }
}
```

### machine_kexec (Architecture-Specific)

```c
/* In arch/x86/kernel/relocate_kernel_64.S */
/* Assembly code that:
 * 1. Switches to a new page table (identity mapping)
 * 2. Copies the new kernel to its load address
 * 3. Jumps to the new kernel's entry point
 */
```

The relocation code runs in a special identity-mapped environment since the old kernel's page tables will be destroyed.

## Kernel Configuration

```bash
CONFIG_KEXEC=y              # Enable kexec_load
CONFIG_KEXEC_FILE=y         # Enable kexec_file_load
CONFIG_KEXEC_SIG=y          # Require signature on kexec images
CONFIG_KEXEC_SIG_FORCE=y    # Enforce signature verification
CONFIG_CRASH_DUMP=y         # Enable crash dump support
CONFIG_PROC_VMCORE=y        # Enable /proc/vmcore
CONFIG_DEBUG_INFO=y         # Required for crash analysis
CONFIG_DEBUG_INFO_DWARF4=y  # DWARF4 debug info
```

## Security Considerations

### Secure Boot

With secure boot, kexec loading is restricted:

```bash
# Check if kexec signature is required
cat /sys/kernel/kexec_loaded
cat /sys/kernel/kexec_crash_loaded

# Signed kexec: kernel verifies image signature
CONFIG_KEXEC_SIG=y
CONFIG_KEXEC_SIG_FORCE=y
```

Without `KEXEC_SIG_FORCE`, unsigned kernels can be loaded if the platform doesn't enforce signature checking.

### CAP_SYS_BOOT

```bash
# kexec_load requires CAP_SYS_BOOT
# Typically only root has this capability
```

### Lockdown Mode

When the kernel is in lockdown mode (integrity or confidentiality), kexec is restricted:

```bash
# Check lockdown status
cat /sys/kernel/security/lockdown
# [none] integrity confidentiality

# In integrity mode: kexec requires signed images
# In confidentiality mode: kexec is disabled entirely
```

## Troubleshooting

### Common Issues

```bash
# Crash kernel not loading — check reservation
dmesg | grep -i crash
# "Reserving 256MB of memory at X for crashkernel"

# Check if crash kernel is loaded
kdump-config show

# Check reserved memory
cat /proc/iomem | grep -i crash

# Verify kexec binary
kexec --version
```

### Memory Reservation Failures

```bash
# If crashkernel reservation fails, try:
# 1. Different offset
crashkernel=256M@256M

# 2. Range-based reservation
crashkernel=256M-1G:128M,1G-:256M
# (128M for systems with 256M-1G RAM, 256M for 1G+ systems)

# 3. High memory reservation
crashkernel=512M,high
```

### Crash Kernel Boot Issues

```bash
# If crash kernel fails to boot:
# 1. Check crash kernel command line
# 2. Ensure initramfs has necessary drivers
# 3. Try adding 'debug' to crash kernel command line
# 4. Check serial console output if available

# Enable early console for crash kernel
# Add to crash kernel cmdline:
earlycon=uart8250,io,0x3f8,115200n8
```

### vmcore Analysis Issues

```bash
# If crash can't read vmcore:
# 1. Ensure vmlinux has debug info
# 2. Check makedumpfile filtering level
# 3. Verify vmcore isn't truncated

# Check vmcore header
file /var/crash/vmcore.dump
# Should show: "kdump captured vmcore"

# Verify debug info
crash> sym panic
# Should show the symbol address
```

## Integration with initramfs

For kdump, a special initramfs is often needed:

```bash
# Ubuntu/Debian
sudo apt install linux-crashdump
# Automatically sets up kdump

# RHEL/CentOS/Fedora
sudo yum install kexec-tools
sudo systemctl enable kdump

# Generate kdump initramfs
mkdumprd /boot/initramfs-$(uname -r)kdump.img $(uname -r)
```

### Custom kdump initramfs

```bash
# /etc/kdump.conf
# Destination
ext4 /dev/sda1
# Path on destination
path /var/crash
# Core collector
core_collector makedumpfile -l -d 31
# Extra binaries
extra_bins /usr/bin/vim
# Hook scripts
kdump_post /usr/local/bin/kdump-notify.sh
```

## Source Files

- `kernel/kexec.c` — kexec_load and kexec_file_load system calls
- `kernel/kexec_core.c` — core kexec functionality
- `kernel/kexec_file.c` — file-based kexec loading
- `kernel/crash_core.c` — crash dump core
- `kernel/crash_dump.c` — /proc/vmcore implementation
- `arch/x86/kernel/machine_kexec_64.c` — x86_64 kexec implementation
- `arch/x86/kernel/relocate_kernel_64.S` — assembly relocation code
- `include/linux/kexec.h` — kexec data structures
- `include/uapi/linux/kexec.h` — userspace API
- `fs/proc/vmcore.c` — /proc/vmcore filesystem

## Further Reading

- **Documentation/admin-guide/kdump/kdump.rst** — comprehensive kdump documentation
- **Documentation/admin-guide/kdump/vmcoreinfo.rst** — vmcoreinfo format
- **Documentation/devicetree/bindings/chosen/kexec.yaml** — DT kexec bindings
- **man kexec** — kexec(8) manual page
- **man crash** — crash(8) analysis tool
- **LWN: kexec** — <https://lwn.net/Articles/138222/>
- **kexec-tools** — <https://github.com/horms/kexec-tools>
- **makedumpfile** — <https://github.com/makedumpfile/makedumpfile>
- **crash utility** — <https://github.com/crash-utility/crash>

## See Also

- [Stack Traces](../debugging/stack-trace.md) — analyzing crash dumps
- [Kernel Panic](../debugging/panic.md) — panic handling
- [Boot Process](../boot/overview.md) — kernel boot sequence
- [ACPI](../firmware/acpi.md) — ACPI table handling during kexec
- [Secure Boot](../security/secure-boot.md) — secure boot and kexec
