# PowerPC Architecture

## Introduction

PowerPC (Performance Optimization With Enhanced RISC – Performance Computing) is a RISC instruction set architecture developed by the 1991 Apple–IBM–Motorola alliance (AIM). PowerPC has a distinguished history in computing: it powered Apple Macintosh systems from 1994 to 2006, drives IBM's enterprise server line (POWER), and remains a significant architecture in high-performance computing, enterprise servers, and embedded systems.

Linux on PowerPC has a long and robust history. The architecture's open firmware interface (OPAL), strong virtualization support (KVM), and enterprise reliability features make it a unique platform in the Linux ecosystem.

## Architecture Overview

### PowerPC Family

```mermaid
graph TD
    POWER["IBM POWER Architecture<br/>(1990)"]
    POWER --> PPC1["PowerPC 601<br/>(1993) — First PowerPC"]
    POWER --> PPC2["PowerPC 603/604<br/>(1994-95) — Desktop"]
    POWER --> PPC3["PowerPC 750 (G3)<br/>(1997) — Apple"]
    POWER --> PPC4["PowerPC 7400 (G4)<br/>(1999) — AltiVec SIMD"]
    POWER --> PPC5["PowerPC 970 (G5)<br/>(2003) — 64-bit Apple"]
    POWER --> POWER4["POWER4<br/>(2001) — Server"]
    POWER --> POWER5["POWER5<br/>(2004) — SMT"]
    POWER --> POWER7["POWER7<br/>(2010) — 8 cores"]
    POWER --> POWER8["POWER8<br/>(2014) — NVLink"]
    POWER --> POWER9["POWER9<br/>(2017) — OpenPOWER"]
    POWER --> POWER10["POWER10<br/>(2021) — PCIe5, DDR5"]
    
    PPC3 --> CELL["Cell Broadband Engine<br/>(2006) — PS3"]
    PPC4 --> EMBEDDED["Embedded: NXP/Freescale<br/>QorIQ, MPC8xxx"]
    
    style POWER10 fill:#f96,stroke:#333,stroke-width:2px
    style EMBEDDED fill:#bbf,stroke:#333
```

### Key Architecture Features

```
PowerPC Architecture Characteristics
─────────────────────────────────────
ISA Type:        RISC
Endianness:      Bi-endian (big-endian traditional, little-endian modern)
Register File:   32 GPRs, 32 FPRs, 32 VMX/VSX registers
Privilege Modes: Problem state (user) / Supervisor state (kernel)
Page Sizes:      4KB, 64KB, 16MB, 16GB
Addressing:      32-bit (legacy) / 64-bit (modern)
Virtualization:  Hardware virtualization (Hypervisor mode)
SIMD:            AltiVec/VMX (128-bit), VSX (128-bit)
Atomic:          Load-linked/store-conditional (lwarx/stwcx.)
Cache:           L1/L2/L3 coherent caches
```

## Registers

### General-Purpose Registers

```
PowerPC General-Purpose Registers
──────────────────────────────────
GPR0-GPR31 — 32 general-purpose registers (32 or 64-bit)

Special-purpose:
  GPR0    — Volatile, used as scratch by linker
  GPR1    — Stack pointer (by convention)
  GPR2    — TOC pointer (Table of Contents, for globals)
  GPR3-GPR10 — Function arguments and return values
  GPR11-GPR12 — Volatile, used by function prologues
  GPR13    — Thread-local storage pointer (PPC64 ELF ABI)
  GPR14-GPR31 — Callee-saved registers

Special Registers:
  LR       — Link register (return address)
  CTR      — Count register (loop counter, indirect branch)
  CR       — Condition register (8 × 4-bit fields)
  XER      — Integer exception register
  FPSCR    — FP status/control register
  MSR      — Machine state register (privilege, endian, etc.)
  PC       — Program counter (not directly accessible)
```

### Power ISA 3.0+ Register Extensions

```
VSX (Vector-Scalar Extension) Registers
────────────────────────────────────────
VSR0-VSR63 — 128-bit vector-scalar registers
  • Lower 64 bits: FPR0-FPR31 (shared with FP)
  • Full 128 bits: VMX VR0-VR31 (shared with AltiVec)
  • VSR32-VSR63: Additional 32 VSX-only registers

VMX/AltiVec Registers
──────────────────────
VR0-VR31 — 128-bit SIMD registers
  • 4×float32, 8×int16, 16×int8
  • Saturating arithmetic support
```

## Privilege Modes

### PowerPC Privilege Levels

```mermaid
graph TB
    subgraph "PowerPC Privilege Levels"
        HV["Hypervisor State<br/>(HV bit in MSR)<br/>KVM / PowerVM"]
        SUP["Supervisor State<br/>(PR bit = 0)<br/>Linux kernel"]
        PRB["Problem State<br/>(PR bit = 1)<br/>Applications"]
    end
    
    HV --> SUP --> PRB
    
    PRB -->|"System Call (sc)"| SUP
    SUP -->|"Hypervisor Call (hcall)"| HV
    
    style HV fill:#f96,stroke:#333,stroke-width:2px
    style SUP fill:#bbf,stroke:#333,stroke-width:2px
    style PRB fill:#9f9,stroke:#333
```

```
Privilege Mode Details
──────────────────────
Problem State (User):
  • PR bit = 1 in MSR
  • Cannot change MSR
  • Cannot access privileged SPRs
  • System calls via 'sc' instruction
  • Applications run here

Supervisor State (Kernel):
  • PR bit = 0, HV bit = 0
  • Full access to SPRs, memory management
  • Can enable/disable interrupts (EE bit in MSR)
  • Linux kernel runs here
  • Page table management

Hypervisor State:
  • HV bit = 1 in MSR
  • LPAR/hypervisor support
  • KVM, PowerVM
  • Virtual interrupt injection
  • Resource allocation to guests
```

## Memory Management

### Page Table Structure

```
PowerPC uses a hashed page table (64-bit) or
radix tree page table (POWER9+)

Radix Tree (POWER9+, preferred for Linux):
──────────────────────────────────────────
• Similar to x86_64 multi-level page tables
• 4 levels: PGD → PUD → PMD → PTE
• Page sizes: 4KB, 64KB, 2MB, 1GB
• Hardware page table walk
• Translation controlled by partition table

Hashed Page Table (legacy):
──────────────────────────
• Software-managed hash table
• Hardware does initial lookup
• Software (OS) handles misses (hash page fault)
• Better for sparse address spaces
```

### Memory Management Unit (MMU)

```c
/* PowerPC radix page table entry (64-bit) */
struct radix_pte {
    uint64_t valid:1;       /* Valid entry */
    uint64_t rpn:51;        /* Real (physical) page number */
    uint64_t reserved:3;    /* Reserved */
    uint64_t na:1;          /* No access */
    uint64_t ro:1;          /* Read only */
    uint64_t atomic:1;      /* Atomic access */
    uint64_t cache_inhibit:1; /* Caching inhibited */
    uint64_t coherent:1;    /* Memory coherence */
    uint64_t no_execute:1;  /* No execute */
    uint64_t referenced:1;  /* Referenced (software) */
    uint64_t changed:1;     /* Changed/dirty (software) */
    uint64_t reserved2:1;
};
```

## OPAL Firmware

### OpenPOWER Abstraction Layer

```mermaid
graph TB
    subgraph "OPAL Firmware Stack"
        HW[Hardware]
        SKIBOOT[Skiboot<br/>OPAL firmware<br/>Runs on host CPUs]
        SKIBOOT_HW[Skiboot<br/>Hardware Init]
        OPAL_RT[OPAL Runtime<br/>Services]
        
        HW --> SKIBOOT_HW
        SKIBOOT_HW --> SKIBOOT
        SKIBOOT --> OPAL_RT
    end
    
    subgraph "Linux"
        OPAL_DRV[opal.ko<br/>OPAL driver]
        KERNEL[Linux Kernel]
        OPAL_DRV --> KERNEL
    end
    
    OPAL_RT -->|"OPAL calls"| OPAL_DRV
    
    style SKIBOOT fill:#f96,stroke:#333,stroke-width:2px
    style OPAL_DRV fill:#bbf,stroke:#333,stroke-width:2px
```

```
OPAL Components
────────────────
Skiboot:
  • Open-source firmware (Apache 2.0)
  • Runs on the POWER processor itself
  • Initializes hardware
  • Provides runtime services to Linux
  • Replaces proprietary IBM firmware on OpenPOWER

OPAL Runtime Services:
  • Console I/O
  • RTC (real-time clock)
  • Sensor reading
  • Power management
  • PCI management
  • NVRAM access
  • Error handling (EEH)

Petitboot:
  • Bootloader running on top of OPAL
  • Linux-based (uses kexec)
  • Discovers bootable devices
  • Supports network boot (PXE)
```

### OPAL API

```c
/* OPAL call from Linux kernel */
#include <asm/opal-api.h>

/* OPAL call numbers (from opal-api.h) */
#define OPAL_CONSOLE_WRITE           1
#define OPAL_CONSOLE_READ            2
#define OPAL_RTC_READ                3
#define OPAL_RTC_WRITE               4
#define OPAL_CEC_POWER_DOWN          5
#define OPAL_CEC_REBOOT              6
#define OPAL_SENSOR_READ             7
#define OPAL_PCI_SET_POWER_STATE     117

/* Making an OPAL call from Linux */
static int64_t opal_call(int64_t token, int64_t nargs, ...)
{
    /* Assembly wrapper that calls into OPAL firmware */
    /* Uses OPAL entry point set up by skiboot */
}

/* Example: Console output through OPAL */
int64_t opal_console_write(int64_t term_number, __be64 *length,
                           const uint8_t *buffer)
{
    return opal_call(OPAL_CONSOLE_WRITE, 3, term_number,
                     length, buffer);
}
```

## KVM on PowerPC

### Hardware Virtualization Support

```
PowerPC Virtualization Features
───────────────────────────────
POWER7+:
  • Hardware virtualization (Hypervisor mode)
  • Virtual processor dispatch
  • Virtual interrupt delivery
  • Hardware page table for guests

POWER8:
  • Improved virtualization
  • 8 threads per core
  • Large L3 cache
  • CAPI (Coherent Accelerator)

POWER9:
  • Radix page tables for guests
  • Improved I/O virtualization
  • NVLink 2.0 (GPU interconnect)
  • OpenCAPI

POWER10:
  • Matrix Math Assist (MMA)
  • PCIe Gen5
  • Enhanced security (PEF — Protected Execution Facility)
  • Improved virtualization
```

### KVM on POWER

```bash
# Check if KVM is available on POWER
$ dmesg | grep -i kvm
[    0.123456] kvm: KVM for PowerPC Book3S 64 initialized

# KVM modules for PowerPC
$ lsmod | grep kvm
kvm_pr                 # KVM with PR (problem state) emulation
kvm_hv                  # KVM with hardware virtualization (HV)

# Create a VM (using QEMU)
$ qemu-system-ppc64le \
    -machine pseries,accel=kvm \
    -cpu POWER9 \
    -m 4G \
    -smp 4 \
    -drive file=vm-disk.qcow2,format=qcow2,if=virtio \
    -cdrom debian-12-ppc64el-netinst.iso \
    -nographic
```

### Linux PowerPC Code Organization

```
arch/powerpc/
├── boot/               — Boot code
├── configs/            — Defconfigs
│   ├── ppc64le_defconfig
│   ├── pseries_defconfig
│   └── powernv_defconfig
├── crypto/             — PowerPC crypto acceleration
├── include/            — PowerPC headers
├── kernel/             — Core kernel (exceptions, interrupts)
├── kvm/                — KVM virtualization
├── lib/                — PowerPC-optimized routines
├── mm/                 — Memory management (radix, hash)
├── net/                — BPF JIT
├── platforms/
│   ├── powernv/        — OPAL (bare metal)
│   ├── pseries/        — PowerVM (LPAR)
│   ├── cell/           — Cell Broadband Engine
│   ├── maple/          — Maple (Power Mac)
│   ├── ps3/            — PlayStation 3
│   └── chrp/           — Common Hardware Reference Platform
├── sysdev/             — System devices
├── Kconfig             — Configuration
└── Makefile            — Build rules
```

## Cross-Compiling for PowerPC

```bash
# Install toolchain
$ sudo apt-get install gcc-powerpc64le-linux-gnu

# Configure for PowerPC 64-bit little-endian (modern servers)
$ make ARCH=powerpc CROSS_COMPILE=powerpc64le-linux-gnu- \
    pseries_defconfig

# Or for OPAL (bare metal)
$ make ARCH=powerpc CROSS_COMPILE=powerpc64le-linux-gnu- \
    powernv_defconfig

# Build
$ make ARCH=powerpc CROSS_COMPILE=powerpc64le-linux-gnu- -j$(nproc)

# Output
$ ls arch/powerpc/boot/zImage.pseries
$ ls arch/powerpc/boot/zImage.epapr
```

## PowerPC in the Modern Era

### OpenPOWER Foundation

```
OpenPOWER Ecosystem
────────────────────
Founded: 2013 by IBM, Google, NVIDIA, Mellanox, Tyan
Goal: Open, collaborative POWER architecture development

Key contributions:
  • Open-source firmware (skiboot, petitboot)
  • Open hardware designs
  • Linux-first approach
  • POWER ISA opened (2019 — free to implement)

Members: 300+ companies
Notable: Raptor Computing (Talos II, Blackbird workstations)
```

### POWER10 Highlights

```
POWER10 Processor (2021)
────────────────────────
Cores:        Up to 15 per chip (up to 240 per system)
Threads:      4 SMT per core (SMT8 with 4 active)
Process:      7nm Samsung
Cache:        2MB L2/core, 120MB L3/chip
Memory:       DDR5, up to 4TB per socket
I/O:          PCIe Gen5, OpenCAPI 4.0, NVLink
Security:     PEF (Protected Execution Facility)
AI:           MMA (Matrix Math Assist) for INT8/BF16/FP32
Virtualization: Enhanced KVM, PowerVM improvements
```

## References and Further Reading

- Power ISA specification: https://openpowerfoundation.org/specifications/isa
- IBM POWER documentation: https://www.ibm.com/support/pages/power-documentation
- OPAL documentation: https://skiboot.readthedocs.io/
- Linux PowerPC kernel documentation: https://www.kernel.org/doc/html/latest/arch/powerpc/
- OpenPOWER Foundation: https://openpowerfoundation.org/
- Raptor Computing (OpenPOWER workstations): https://www.raptorcs.com/
- PowerPC ELF ABI: https://files.openpower.foundation/processed/7022e86f52e111ebb1b30242ac130002/607f84804072c948b2e3145050b7ab0c.pdf
- Linux on POWER: https://developer.ibm.com/linuxonpower/
- KVM on PowerPC: https://www.kernel.org/doc/html/latest/virt/kvm/
- "PowerPC Architecture" — IBM Redbooks

## Related Topics

- [x86 Architecture](./x86.md) — compare with CISC
- [ARM Architecture](./arm.md) — another RISC architecture
- [Memory Models](./memory-models.md) — PowerPC's relaxed memory model
- [Building the Kernel](../build/kernel-build.md) — building for PowerPC
- [Cross-Compilation](../build/cross-compilation.md) — PowerPC cross-compilation
