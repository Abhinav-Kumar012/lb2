# Page Table Isolation (PTI) — Meltdown Mitigation

## Overview

**Kernel Page Table Isolation (KPTI)**, originally called **KAISER** (Kernel
Address Isolation to have Side-channels Efficiently Removed), is a security
feature that mitigates the **Meltdown** vulnerability (CVE-2017-5754) by
separating user-space and kernel-space page tables. Before KPTI, Linux used
a single set of page tables that mapped both user and kernel memory, with
kernel memory marked as non-accessible to user-space code. Meltdown exploited
a race condition in out-of-order execution to read kernel memory despite these
protections.

KPTI was merged in **Linux 4.15** (January 2018) under extreme time pressure
following the public disclosure of Meltdown and Spectre.

## The Meltdown Vulnerability

### What Meltdown Exploits

Meltdown exploits a fundamental property of modern CPUs: **speculative
execution**. The vulnerability allows an unprivileged user-space process to
read arbitrary kernel memory.

### The Attack Mechanism

1. The attacker executes an instruction that speculatively reads kernel memory
2. The CPU realizes the access is unauthorized and rolls back the architectural
   state
3. However, the **microarchitectural state** (cache contents) is not rolled back
4. The attacker uses a **cache side channel** (e.g., Flush+Reload) to determine
   which cache lines were loaded, revealing the kernel memory content

```
Attacker Code:
    mov rax, [kernel_address]     ; Speculatively reads kernel memory
    mov rbx, [array + rax * 8]   ; Access array based on kernel byte
    ; ↑ This loads array[kernel_byte] into cache

    ; After the fault is handled, the attacker times access to array[0..255]
    ; The fast access reveals the kernel byte value
```

### Affected Processors

Meltdown primarily affected:

- **Intel Core processors** (most generations before 9th gen / Coffee Lake)
- **ARM Cortex-A75** and some other ARM cores
- **Not affected**: AMD processors (by design — they don't speculatively
  execute memory accesses that would fault)

### Impact

- **Confidentiality**: complete read access to all kernel memory from user space
- **No privilege escalation**: Meltdown reads memory but doesn't modify it
- **Cross-process**: can read other processes' memory, kernel keys, etc.
- **VM escape**: can potentially read host kernel memory from a guest VM

## KPTI Design

### The Problem KPTI Solves

Before KPTI, the Linux kernel mapped all of its memory into every process's
page table, marked with the **supervisor bit** (bit 2 of page table entries)
set:

```
Page Table (Before KPTI):
+---------------------+
| User-space mappings | ← Accessible (US=1)
| 0x0000_0000_0000    |
| ...                 |
+---------------------+
| Kernel-space mappings| ← Not accessible (US=0)
| 0xFFFF_8000_0000    |
| ...                 |
+---------------------+
```

The kernel memory was present in the page table but marked non-accessible.
Meltdown exploited the fact that the CPU **speculatively accessed** kernel
memory before checking the permission bit.

### The KPTI Solution

KPTI maintains **two separate sets of page tables** for each process:

1. **User page tables**: contain only user-space mappings + minimal kernel
   entry/exit trampolines
2. **Kernel page tables**: contain both user-space and kernel-space mappings
   (full mapping)

```
User Page Tables (active in user mode):
+---------------------+
| User-space mappings | ← Full access (US=1)
| 0x0000_0000_0000    |
| ...                 |
+---------------------+
| Kernel entry/exit   | ← Minimal trampoline code
| trampolines only    |    (just enough for syscall/interrupt entry)
+---------------------+

Kernel Page Tables (active in kernel mode):
+---------------------+
| User-space mappings | ← Present but inaccessible (US=0)
| 0x0000_0000_0000    |
+---------------------+
| Kernel-space mappings| ← Full access (US=0)
| 0xFFFF_8000_0000    |
| ...                 |
+---------------------+
```

### How It Works

1. **In user mode**: the CPU uses the user page tables. Kernel memory is not
   present at all (not just permission-denied), so speculative execution
   cannot access it.

2. **On syscall/interrupt entry**: the kernel switches to the kernel page
   tables (with a `CR3` register switch on x86).

3. **On return to user mode**: the kernel switches back to the user page
   tables.

4. The **PCID** (Process Context Identifier) feature is used to avoid full
   TLB flushes on every page table switch.

## Implementation Details

### x86 Implementation

```c
/* arch/x86/mm/pti.c */

void pti_init(void)
{
    /* Check if KPTI is needed */
    if (!boot_cpu_has(X86_FEATURE_PTI))
        return;

    /* Allocate user page table pages */
    pti_init_user_pagetable();

    /* Clone kernel entries into user page tables */
    pti_clone_kernel_text();
    pti_clone_entry_text();
}
```

### Page Table Switch (CR3)

On x86, the page table base is stored in the `CR3` register. KPTI switches
CR3 on every kernel entry/exit:

```c
/* Simplified syscall entry path */
SYM_INNER_LABEL(entry_SYSCALL_64_after_hwframe, SYM_L_GLOBAL)
    /* Switch to kernel page tables */
    movq    %rsp, %rdi
    /* ... save state ... */
    SWITCH_TO_KERNEL_CR3 scratch_reg=%rdi
    /* ... continue with kernel page tables active ... */
```

```c
/* Return to user space */
SYM_INNER_LABEL(swapgs_restore_regs_and_return_to_usermode, SYM_L_GLOBAL)
    /* ... restore state ... */
    SWITCH_TO_USER_CR3 scratch_reg=%rdi
    /* ... return to user space with user page tables ... */
```

### PCID (Process Context Identifiers)

PCID avoids TLB flushes on CR3 switches by tagging TLB entries with a 12-bit
identifier:

```c
/* Each process has two PCIDs:
 * - One for user page tables
 * - One for kernel page tables
 */
#define PTI_USER_PCID       1
#define PTI_KERNEL_PCID     0

/* CR3 with PCID */
#define PTI_USER_PGTABLE_MASK  (PTI_USER_PCID | X86_CR3_PCID_NOFLUSH)
```

When switching between user and kernel page tables, the PCID is changed but
the TLB is not flushed — entries from both page table sets coexist in the TLB,
tagged with their respective PCIDs.

### PCID Availability

Not all x86 CPUs support PCID:

- **With PCID**: CR3 switch is fast (~a few cycles), TLB entries preserved
- **Without PCID**: CR3 switch requires full TLB flush, significantly more
  expensive

```bash
# Check if PCID is available
grep pcid /proc/cpuinfo
```

### Minimal Kernel Entry Trampolines

The user page tables must contain enough kernel code to handle the transition:

```c
/* arch/x86/mm/pti.c */
static void pti_clone_entry_text(void)
{
    /* Map the syscall entry point into user page tables */
    pti_clone_pmd(entry_SYSCALL_64);

    /* Map interrupt entry points */
    pti_clone_pmd(entry_SYSENTER_compat);
    pti_clone_pmd(entry_INT80_compat);
}
```

These trampolines are the **only** kernel code visible in user page tables.
They execute with user page tables active, switch to kernel page tables, and
then continue with the full kernel mapping.

## Performance Impact

### Overhead Sources

1. **CR3 switches**: on every syscall/interrupt entry and exit
2. **TLB pressure**: two sets of page table entries compete for TLB space
3. **PCID management**: overhead of PCID allocation and tracking
4. **TLB misses**: more frequent TLB misses due to reduced effective TLB
   capacity
5. **User page table memory**: additional memory for the second set of page
   tables

### Measured Overhead

| Workload                  | Overhead (with PCID) | Overhead (without PCID) |
|--------------------------|----------------------|-------------------------|
| Syscall-heavy (lmbench)  | 2–5%                 | 10–30%                  |
| Compute-intensive        | 0–1%                 | 0–2%                    |
| Database (OLTP)          | 1–3%                 | 5–15%                   |
| Network (packets/sec)    | 3–8%                 | 15–40%                  |
| General desktop          | 1–3%                 | 5–10%                   |
| Kernel compilation       | 2–5%                 | 10–20%                  |

The overhead is highly workload-dependent:

- **Syscall-heavy workloads** (databases, web servers, networking): most
  affected because every syscall triggers two CR3 switches
- **Compute-intensive workloads** (scientific computing, rendering):
  minimally affected because most time is spent in user mode
- **I/O-heavy workloads**: moderately affected due to interrupt-driven
  CR3 switches

### PCID vs. No-PCID

PCID makes a dramatic difference:

```bash
# Force disable PCID (for benchmarking)
# Add to kernel command line: nopcid

# Check PCID status
dmesg | grep -i pcid
```

Without PCID, each CR3 switch flushes the entire TLB, causing:

- Immediate TLB miss on return to user mode (user page table entries were
  flushed)
- Immediate TLB miss on next syscall (kernel page table entries were flushed)
- This cascading TLB thrashing is the primary source of overhead

### Mitigation for Performance-Critical Workloads

1. **Use PCID-capable hardware**: all modern CPUs (Skylake and later) support PCID
2. **Reduce syscall frequency**: batch operations, use `io_uring` instead of
   individual I/O syscalls
3. **Kernel samepage merging (KSM)**: can help with TLB pressure for workloads
   with shared memory
4. **Huge pages**: reduce TLB pressure by using 2 MiB or 1 GiB pages

## Boot-Time Configuration

### Command Line Options

```bash
# Enable KPTI (default on most kernels)
pti=on

# Disable KPTI (DANGEROUS — vulnerable to Meltdown)
pti=off

# Auto-detect (enable only on affected CPUs)
pti=auto
```

### Runtime Detection

```bash
# Check if KPTI is enabled
grep pti /proc/cmdline
# or
dmesg | grep -i pti
# or
cat /sys/devices/system/cpu/vulnerabilities/meltdown
# "Mitigation: PTI"           → KPTI enabled
# "Vulnerable"                → KPTI disabled or not needed
# "Not affected"              → CPU not vulnerable
```

### Kernel Configuration

```bash
CONFIG_PAGE_TABLE_ISOLATION=y
# or
# CONFIG_PAGE_TABLE_ISOLATION is not set  # (dangerous)
```

## Relationship to Other Mitigations

### Spectre vs. Meltdown

| Vulnerability | Variant | Mitigation  | KPTI Helps? |
|--------------|---------|-------------|-------------|
| Meltdown      | CVE-2017-5754 | KPTI     | Yes (primary) |
| Spectre v1    | CVE-2017-5753 | LFENCE, array_index_nospec | No |
| Spectre v2    | CVE-2017-5715 | IBRS, retpoline, STIBP | Partially |
| Spectre v3a   | CVE-2018-3640 | Microcode | No |
| Spectre v4    | CVE-2018-3639 | SSBD      | No |
| L1TF          | CVE-2018-3620 | L1D flush, PTE inversion | Yes (complementary) |

KPTI primarily mitigates **Meltdown** and **L1TF** (L1 Terminal Fault). For
Spectre variants, separate mitigations are needed.

### Retpoline

Retpoline mitigates Spectre v2 (indirect branch speculation) by replacing
indirect jumps with a safe sequence:

```c
/* retpoline: replaces indirect call */
call retpoline_rax
/* ... */
retpoline_rax:
    call .spec_trap
.spec_trap:
    lfence
    jmp .spec_trap
```

KPTI and retpoline are complementary — both are typically enabled.

### IBRS/IBPB/STIBP

Hardware mitigations for Spectre v2:

- **IBRS** (Indirect Branch Restricted Speculation): restricts speculation
  after indirect branches
- **IBPB** (Indirect Branch Prediction Barrier): flushes branch predictor
  state
- **STIBP** (Single Thread Indirect Branch Predictors): prevents sibling
  hyperthreads from influencing branch prediction

```bash
# Check all CPU vulnerability mitigations
grep . /sys/devices/system/cpu/vulnerabilities/*
```

## Impact on Specific Kernel Features

### Context Switches

Each context switch involves:

1. Saving/restoring register state (normal)
2. Switching CR3 to the new process's page tables (normal)
3. With KPTI: the user page tables are switched, but kernel page tables
   remain per-CPU (shared)

The overhead is minimal because context switches already involve CR3 switches.

### Interrupts

Hardware interrupts entering from user mode trigger:

1. CR3 switch from user to kernel page tables
2. Interrupt handling with kernel page tables
3. CR3 switch back to user page tables on return

This doubles the CR3 switches per interrupt compared to non-KPTI.

### Kernel Threads

Kernel threads (no user-space component) use only the kernel page tables.
KPTI adds no overhead for pure kernel threads.

### eBPF

eBPF programs run in the kernel, so they use kernel page tables. However,
eBPF maps accessible from user space are mapped in both page table sets.

## ARM64 Implementation

ARM64 implements KPTI using **translation table base register (TTBR) switching**:

```c
/* arch/arm64/mm/pti.c */
void pti_init(void)
{
    /* Allocate user page tables */
    pti_init_user_pagetable();

    /* Clone necessary kernel entries */
    pti_clone_kernel_mappings();
}
```

The ARM64 implementation uses:

- `TTBR0_EL1`: user-space page table base
- `TTBR1_EL1`: kernel-space page table base

KPTI on ARM64 is simpler because the hardware already separates user and
kernel page tables via `TTBR0`/`TTBR1`. The mitigation ensures `TTBR1` is
not accessible when in user mode.

## Future Directions

### Hardware Mitigations

Newer CPUs include hardware-level mitigations:

- **Intel CET (Control-flow Enforcement Technology)**: helps with Spectre
  variants
- **Shadow Stack**: prevents ROP attacks that could bypass KPTI
- **Hardware domain isolation**: future CPUs may provide native isolation
  that makes KPTI unnecessary

### KPTI Optimization

Ongoing kernel work focuses on reducing KPTI overhead:

- **Fewer trampoline pages**: minimize kernel code visible in user page tables
- **Better PCID management**: smarter allocation to reduce TLB pressure
- **Selective KPTI**: only enable for untrusted code (e.g., seccomp sandbox
  processes)

## Monitoring and Debugging

### Check Mitigation Status

```bash
# Comprehensive vulnerability status
grep . /sys/devices/system/cpu/vulnerabilities/*

# Specific to Meltdown
cat /sys/devices/system/cpu/vulnerabilities/meltdown

# Kernel log messages
dmesg | grep -i 'meltdown\|pti\|page.table.isolation'
```

### Performance Measurement

```bash
# Measure syscall overhead with/without KPTI
# Run lmbench lat_syscall benchmark
# Compare with pti=on vs pti=off (if security permits)

# Monitor TLB misses
perf stat -e dTLB-load-misses,dTLB-store-misses -a sleep 10
```

### Kernel Statistics

```bash
# TLB flush statistics (if available)
cat /proc/vmstat | grep tlb
```

## See Also

- [Kernel Lockdown](../security/lockdown.md) — another kernel security
  hardening feature
- [User Namespace Security](../containers/user-namespace-security.md) —
  namespace-level security considerations
- [Ring Buffer](../debugging/ring-buffer.md) — kernel data structures
  affected by performance mitigations
- [local_lock](../kernel/sync/local-lock.md) — per-CPU synchronization
  affected by context switch overhead

## Further Reading

- **Kernel source**: `arch/x86/mm/pti.c`, `arch/x86/include/asm/pti.h`
- **Documentation**: `Documentation/admin-guide/hw-vuln/meltdown.rst`
- **KAISER paper**: ["KASLR is Dead: Long Live KASLR"](https://gruss.cc/files/kaiser.pdf) —
  original academic paper by Daniel Gruss et al.
- **Google Project Zero**: ["Reading privileged memory with a side-channel"](https://googleprojectzero.blogspot.com/2018/01/reading-privileged-memory-with-side.html) —
  Meltdown disclosure blog post
- **LWN article**: ["The state of kernel page-table isolation"](https://lwn.net/Articles/741878/) —
  implementation details
- **LWN article**: ["Retpoline: a mitigation for Spectre variant 2"](https://lwn.net/Articles/743265/) —
  related mitigation
- **Intel whitepaper**: ["Retpoline: A Branch Target Injection Mitigation"](https://www.intel.com/content/www/us/en/developer/articles/technical/software-security-guidance/technical-documentation/retpoline-branch-target-injection-mitigation.html)
- **commit 6214c64**: "x86/pti: Kernel Page Table Isolation" — main KPTI merge
