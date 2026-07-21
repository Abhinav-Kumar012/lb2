# Summary

[Introduction](./introduction.md)

---

# Part I: Foundations

- [What Is Linux?](./foundations/what-is-linux.md)
- [History of Linux](./foundations/history.md)
- [Unix Heritage](./foundations/unix-heritage.md)
- [The Open Source Movement](./foundations/open-source.md)
- [Linux Distributions](./foundations/distributions.md)
- [The GPL and Licensing](./foundations/licensing.md)
- [POSIX Standards](./foundations/posix.md)

---

# Part II: The Linux Kernel

- [Kernel Overview](./kernel/overview.md)
- [Kernel Architecture](./kernel/architecture.md)
- [Kernel Build System (Kconfig / Kbuild)](./kernel/build-system.md)
- [Kernel Configuration](./kernel/configuration.md)
- [Kernel Modules](./kernel/modules.md)
- [Kernel Boot Process](./kernel/boot-process.md)
- [Kernel Command Line Parameters](./kernel/cmdline-params.md)
- [Kernel APIs](./kernel/apis.md)
- [Kernel Data Structures](./kernel/data-structures.md)

## Process Management

- [Processes and Threads](./kernel/processes/processes-and-threads.md)
- [Process Descriptors and task_struct](./kernel/processes/task-struct.md)
- [Process Creation: fork, vfork, clone](./kernel/processes/process-creation.md)
- [The Scheduler](./kernel/processes/scheduler.md)
- [Completely Fair Scheduler (CFS)](./kernel/processes/cfs.md)
- [EEVDF Scheduler](./kernel/processes/eevdf.md)
- [Real-Time Scheduling](./kernel/processes/realtime-scheduling.md)
- [Deadline Scheduling (SCHED_DEADLINE)](./kernel/processes/deadline-scheduling.md)
- [NUMA-Aware Scheduling](./kernel/processes/numa-scheduling.md)
- [Process Priorities and Nice Values](./kernel/processes/priorities.md)
- [Context Switching](./kernel/processes/context-switching.md)
- [Process States and Lifecycle](./kernel/processes/process-states.md)
- [Signals](./kernel/processes/signals.md)
- [Namespaces](./kernel/processes/namespaces.md)
- [Cgroups](./kernel/processes/cgroups.md)
- [Process Groups and Sessions](./kernel/processes/process-groups.md)

## Memory Management

- [Memory Management Overview](./kernel/memory/overview.md)
- [Virtual Memory](./kernel/memory/virtual-memory.md)
- [Paging and Page Tables](./kernel/memory/paging.md)
- [Page Frame Allocator](./kernel/memory/page-allocator.md)
- [Slab Allocator (SLAB/SLUB/SLOB)](./kernel/memory/slab-allocator.md)
- [vmalloc and kmalloc](./kernel/memory/vmalloc-kmalloc.md)
- [Memory Zones](./kernel/memory/zones.md)
- [NUMA Memory Management](./kernel/memory/numa.md)
- [Page Cache](./kernel/memory/page-cache.md)
- [Buffer Cache](./kernel/memory/buffer-cache.md)
- [Swap and Swappiness](./kernel/memory/swap.md)
- [OOM Killer](./kernel/memory/oom-killer.md)
- [Memory-Mapped I/O (mmap)](kernel/memory/mmap.md)
- [Huge Pages and THP](./kernel/memory/huge-pages.md)
- [Memory Compaction](./kernel/memory/compaction.md)
- [KSM (Kernel Same-page Merging)](./kernel/memory/ksm.md)
- [Memory Barriers](./kernel/memory/barriers.md)
- [Address Space Layout (ASLR)](./kernel/memory/aslr.md)

## Interrupts and Exceptions

- [Interrupts Overview](./kernel/interrupts/overview.md)
- [Hardware Interrupts and IRQs](./kernel/interrupts/hardware.md)
- [Interrupt Handlers](./kernel/interrupts/handlers.md)
- [Top and Bottom Halves](./kernel/interrupts/top-bottom-halves.md)
- [Softirqs](./kernel/interrupts/softirqs.md)
- [Tasklets](./kernel/interrupts/tasklets.md)
- [Workqueues](./kernel/interrupts/workqueues.md)
- [Interrupt Control and Masking](./kernel/interrupts/control.md)
- [Exceptions and Faults](./kernel/interrupts/exceptions.md)

## Synchronization and Locking

- [Synchronization Overview](./kernel/sync/overview.md)
- [Atomic Operations](./kernel/sync/atomic-ops.md)
- [Spinlocks](./kernel/sync/spinlocks.md)
- [Mutexes](./kernel/sync/mutexes.md)
- [Semaphores](./kernel/sync/semaphores.md)
- [Read-Copy-Update (RCU)](./kernel/sync/rcu.md)
- [Seqlocks](./kernel/sync/seqlocks.md)
- [Per-CPU Variables](./kernel/sync/per-cpu.md)
- [Read-Write Locks](./kernel/sync/rwlocks.md)
- [Completion Variables](./kernel/sync/completions.md)
- [Lock Ordering and Deadlock Prevention](./kernel/sync/lock-ordering.md)
- [Lockdep: Lock Dependency Validator](./kernel/sync/lockdep.md)

## Filesystems

- [VFS: Virtual File System](./kernel/filesystems/vfs.md)
- [The inode](./kernel/filesystems/inode.md)
- [Dentry Cache](./kernel/filesystems/dentry.md)
- [Superblock](./kernel/filesystems/superblock.md)
- [File Operations](./kernel/filesystems/file-ops.md)
- [ext4](./kernel/filesystems/ext4.md)
- [XFS](./kernel/filesystems/xfs.md)
- [Btrfs](./kernel/filesystems/btrfs.md)
- [ZFS on Linux](./kernel/filesystems/zfs.md)
- [F2FS](./kernel/filesystems/f2fs.md)
- [tmpfs](./kernel/filesystems/tmpfs.md)
- [procfs](./kernel/filesystems/procfs.md)
- [sysfs](./kernel/filesystems/sysfs.md)
- [devtmpfs](./kernel/filesystems/devtmpfs.md)
- [OverlayFS](./kernel/filesystems/overlayfs.md)
- [FUSE](./kernel/filesystems/fuse.md)
- [NFS](./kernel/filesystems/nfs.md)
- [CephFS](./kernel/filesystems/cephfs.md)
- [Filesystem Journaling](./kernel/filesystems/journaling.md)
- [Filesystem Mounting](./kernel/filesystems/mounting.md)

## Block I/O Layer

- [Block Layer Overview](./kernel/block/overview.md)
- [Block Devices](./kernel/block/devices.md)
- [I/O Schedulers](./kernel/block/io-schedulers.md)
- [Request Queues](./kernel/block/request-queues.md)
- [Bio Structures](./kernel/block/bio.md)
- [Device Mapper](./kernel/block/device-mapper.md)

## Networking Stack

- [Networking Overview](./kernel/networking/overview.md)
- [Socket Layer](./kernel/networking/sockets.md)
- [TCP/IP Implementation](./kernel/networking/tcpip.md)
- [Netfilter and iptables/nftables](./kernel/networking/netfilter.md)
- [Traffic Control (tc)](./kernel/networking/tc.md)
- [Network Namespaces](./kernel/networking/namespaces.md)
- [eBPF Networking](./kernel/networking/ebpf.md)
- [Netlink](./kernel/networking/netlink.md)
- [XDP (eXpress Data Path)](./kernel/networking/xdp.md)
- [Bonding and Teaming](./kernel/networking/bonding.md)
- [VLANs](./kernel/networking/vlans.md)
- [Bridging](./kernel/networking/bridging.md)
- [Wireless (cfg80211/mac80211)](./kernel/networking/wireless.md)

## Device Drivers

- [Driver Model Overview](./kernel/drivers/overview.md)
- [Character Devices](./kernel/drivers/char-devices.md)
- [Block Device Drivers](./kernel/drivers/block-drivers.md)
- [Network Device Drivers](./kernel/drivers/net-drivers.md)
- [PCI Subsystem](./kernel/drivers/pci.md)
- [USB Subsystem](./kernel/drivers/usb.md)
- [Device Tree](./kernel/drivers/device-tree.md)
- [ACPI](./kernel/drivers/acpi.md)
- [Platform Drivers](./kernel/drivers/platform-drivers.md)
- [I2C and SPI](./kernel/drivers/i2c-spi.md)
- [GPIO](./kernel/drivers/gpio.md)
- [DMA](./kernel/drivers/dma.md)
- [Interrupt Handling in Drivers](./kernel/drivers/interrupt-handling.md)

---

# Part III: System Programming

- [System Calls](./sysprog/syscalls.md)
- [File I/O (POSIX)](./sysprog/file-io.md)
- [Process Control (POSIX)](./sysprog/process-control.md)
- [Signals (POSIX)](./sysprog/signals.md)
- [Threads and Pthreads](./sysprog/threads.md)
- [Inter-Process Communication](./sysprog/ipc.md)
  - [Pipes and FIFOs](./sysprog/ipc/pipes.md)
  - [Message Queues](./sysprog/ipc/message-queues.md)
  - [Shared Memory](./sysprog/ipc/shared-memory.md)
  - [Semaphores (POSIX)](./sysprog/ipc/semaphores.md)
  - [Unix Domain Sockets](./sysprog/ipc/unix-sockets.md)
- [Memory Management (User Space)](./sysprog/memory.md)
- [Dynamic Linking](./sysprog/dynamic-linking.md)
- [ELF Binary Format](./sysprog/elf.md)
- [Inline Assembly](./sysprog/inline-asm.md)
- [io_uring](./sysprog/io-uring.md)
- [epoll](./sysprog/epoll.md)
- [poll and select](./sysprog/poll-select.md)
- [Event-Driven Programming](./sysprog/event-driven.md)
- [Asynchronous I/O (AIO)](./sysprog/aio.md)

---

# Part IV: Shell and Scripting

- [Shell Overview](./shell/overview.md)
- [Bash](./shell/bash.md)
- [Zsh](./shell/zsh.md)
- [Fish](./shell/fish.md)
- [POSIX Shell](./shell/posix-shell.md)
- [Shell Scripting Fundamentals](./shell/scripting-fundamentals.md)
- [Advanced Shell Scripting](./shell/scripting-advanced.md)
- [Regular Expressions](./shell/regex.md)
- [sed and awk](./shell/sed-awk.md)
- [grep and ripgrep](./shell/grep.md)
- [find and fd](./shell/find.md)
- [xargs](./shell/xargs.md)

---

# Part V: System Administration

- [System Administration Overview](./admin/overview.md)
- [User and Group Management](./admin/users-groups.md)
- [File Permissions and ACLs](./admin/permissions.md)
- [Process Management (ps, top, htop)](./admin/process-management.md)
- [Service Management with systemd](./admin/systemd.md)
- [SysV Init](./admin/sysvinit.md)
- [Package Management](./admin/package-management.md)
  - [dpkg and APT](./admin/packages/dpkg-apt.md)
  - [RPM and YUM/DNF](./admin/packages/rpm-dnf.md)
  - [Pacman](./admin/packages/pacman.md)
  - [Portage](./admin/packages/portage.md)
- [Disk Management](./admin/disk-management.md)
- [LVM](./admin/lvm.md)
- [RAID](./admin/raid.md)
- [Networking Configuration](./admin/networking-config.md)
- [Firewall Configuration](./admin/firewall.md)
- [Cron and Scheduled Tasks](./admin/cron.md)
- [Log Management](./admin/logging.md)
- [Backup Strategies](./admin/backup.md)
- [Performance Monitoring](./admin/performance.md)
- [System Rescue and Recovery](./admin/rescue.md)

---

# Part VI: Networking

- [Networking Fundamentals](./networking/fundamentals.md)
- [The OSI Model](./networking/osi-model.md)
- [TCP/IP Protocol Suite](./networking/tcpip-suite.md)
- [IP Addressing and Subnetting](./networking/ip-addressing.md)
- [IPv6](./networking/ipv6.md)
- [DNS](./networking/dns.md)
- [DHCP](./networking/dhcp.md)
- [HTTP and HTTPS](./networking/http.md)
- [TLS/SSL](./networking/tls.md)
- [SSH](./networking/ssh.md)
- [VPN Technologies](./networking/vpn.md)
- [BGP and OSPF](./networking/routing-protocols.md)
- [Network Troubleshooting](./networking/troubleshooting.md)
- [Wireshark and tcpdump](./networking/packet-capture.md)

---

# Part VII: Security

- [Security Overview](./security/overview.md)
- [Linux Security Model](./security/security-model.md)
- [SELinux](./security/selinux.md)
- [AppArmor](./security/apparmor.md)
- [Seccomp](./security/seccomp.md)
- [Linux Capabilities](./security/capabilities.md)
- [PAM (Pluggable Authentication Modules)](./security/pam.md)
- [Cryptography in Linux](./security/cryptography.md)
- [Keyring and Keys Management](./security/keyring.md)
- [Audit Framework](./security/audit.md)
- [Mandatory Access Control](./security/mac.md)
- [Hardening Guide](./security/hardening.md)
- [Rootkits and Detection](./security/rootkits.md)
- [Secure Boot](./security/secure-boot.md)

---

# Part VIII: Virtualization

- [Virtualization Overview](./virtualization/overview.md)
- [KVM](./virtualization/kvm.md)
- [QEMU](./virtualization/qemu.md)
- [Xen](./virtualization/xen.md)
- [libvirt](./virtualization/libvirt.md)
- [VFIO and Device Passthrough](./virtualization/vfio.md)
- [Virtio](./virtualization/virtio.md)
- [Virtual Networking](./virtualization/virtual-networking.md)
- [Virtual Storage](./virtualization/virtual-storage.md)

---

# Part IX: Containers

- [Containers Overview](./containers/overview.md)
- [Linux Primitives Behind Containers](./containers/primitives.md)
- [Docker Internals](./containers/docker-internals.md)
- [Containerd and CRI](./containers/containerd.md)
- [OCI Standards](./containers/oci.md)
- [Kubernetes and Linux](./containers/kubernetes.md)
- [cgroups v2](./containers/cgroups-v2.md)
- [Rootless Containers](./containers/rootless.md)
- [Podman](./containers/podman.md)
- [Container Security](./containers/security.md)

---

# Part X: Embedded Linux

- [Embedded Linux Overview](./embedded/overview.md)
- [Cross-Compilation](./embedded/cross-compilation.md)
- [Bootloader (U-Boot)](./embedded/uboot.md)
- [Device Tree Deep Dive](./embedded/device-tree.md)
- [Yocto Project](./embedded/yocto.md)
- [Buildroot](./embedded/buildroot.md)
- [ARM Architecture](./embedded/arm.md)
- [RISC-V Architecture](./embedded/riscv.md)
- [Real-Time Linux (PREEMPT_RT)](./embedded/realtime.md)
- [Android Linux Kernel](./embedded/android.md)

---

# Part XI: Debugging and Tracing

- [Debugging Overview](./debugging/overview.md)
- [GDB](./debugging/gdb.md)
- [strace and ltrace](./debugging/strace-ltrace.md)
- [perf](./debugging/perf.md)
- [ftrace](./debugging/ftrace.md)
- [eBPF and BCC](./debugging/ebpf.md)
- [SystemTap](./debugging/systemtap.md)
- [Kernel Debugging (KGDB, KDB)](./debugging/kernel-debugging.md)
- [Crash Dump Analysis (kdump/crash)](./debugging/crash-dump.md)
- [AddressSanitizer and KASAN](./debugging/sanitizers.md)
- [Valgrind](./debugging/valgrind.md)

---

# Part XII: Compiler Toolchains

- [GCC](./compilers/gcc.md)
- [Clang and LLVM](./compilers/clang-llvm.md)
- [Linker (ld, lld)](./compilers/linker.md)
- [Assembler (GAS)](./compilers/assembler.md)
- [Make and Makefiles](./compilers/make.md)
- [CMake](./compilers/cmake.md)
- [Ninja](./compilers/ninja.md)
- [Rust for Linux](./compilers/rust-for-linux.md)

---

# Part XIII: Architecture-Specific

- [x86 and x86_64](./arch/x86.md)
- [ARM and AArch64](./arch/arm.md)
- [RISC-V](./arch/riscv.md)
- [PowerPC](./arch/powerpc.md)
- [MIPS](./arch/mips.md)
- [Memory Models](./arch/memory-models.md)
- [Calling Conventions](./arch/calling-conventions.md)

---

# Part XIV: Storage

- [Storage Overview](./storage/overview.md)
- [SCSI and NVMe](./storage/scsi-nvme.md)
- [Block Devices and I/O](./storage/block-io.md)
- [LVM Deep Dive](./storage/lvm-deep-dive.md)
- [RAID Levels Explained](./storage/raid-explained.md)
- [Multipath I/O](./storage/multipath.md)
- [Storage Area Networks (SAN)](./storage/san.md)
- [Distributed Storage (Ceph)](./storage/ceph.md)

---

# Part XV: Performance Tuning

- [Performance Overview](./performance/overview.md)
- [CPU Performance](./performance/cpu.md)
- [Memory Performance](./performance/memory.md)
- [I/O Performance](./performance/io.md)
- [Network Performance](./performance/network.md)
- [NUMA Optimization](./performance/numa.md)
- [Kernel Tuning Parameters](./performance/kernel-params.md)
- [Benchmarking Tools](./performance/benchmarking.md)

---

# Part XVI: Observability

- [Observability Overview](./observability/overview.md)
- [proc Filesystem](./observability/proc.md)
- [sysfs](./observability/sysfs.md)
- [SystemTap](./observability/systemtap.md)
- [BPF and bpftrace](./observability/bpf-bpftrace.md)
- [Tracepoints](./observability/tracepoints.md)
- [Kprobes](./observability/kprobes.md)
- [Metrics Collection](./observability/metrics.md)
- [Prometheus and Grafana](./observability/prometheus-grafana.md)

---

# Part XVII: Build Systems and Distributions

- [Building the Kernel](./build/kernel-build.md)
- [Cross-Compilation](./build/cross-compilation.md)
- [Distribution Building](./build/distro-building.md)
- [Package Building](./build/package-building.md)
- [CI/CD for Kernel](./build/ci-cd.md)

---

# Part XVIII: History and Culture

- [Unix Timeline](./history/unix-timeline.md)
- [Linux Kernel Development Model](./history/development-model.md)
- [Linus Torvalds](./history/linus.md)
- [Key Kernel Subsystems](./history/subsystems.md)
- [Notable Kernel Versions](./history/notable-versions.md)
- [The Tanenbaum-Torvalds Debate](./history/tanenbaum-debate.md)

---

# Reference

- [Glossary](./reference/glossary.md)
- [Man Pages Index](./reference/man-pages.md)
- [Kernel Config Options](./reference/kernel-config.md)
- [Syscall Table](./reference/syscall-table.md)
- [Useful Commands](./reference/commands.md)
- [Further Reading](./reference/further-reading.md)
