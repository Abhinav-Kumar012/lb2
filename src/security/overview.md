# Linux Security Overview

## Introduction

Linux security is a multi-layered discipline that encompasses kernel-level protections, discretionary and mandatory access controls, cryptographic subsystems, and user-space hardening mechanisms. Unlike monolithic security models found in some operating systems, Linux provides a composable security architecture where administrators can layer defenses to match their threat model. This chapter provides a comprehensive overview of the Linux security landscape, establishing the conceptual foundation for the detailed chapters that follow.

Understanding Linux security requires thinking in terms of **defense in depth** — no single mechanism is sufficient. A properly secured Linux system combines kernel hardening, access control, process isolation, network filtering, cryptographic verification, and monitoring into a cohesive whole.

## Defense in Depth

Defense in depth is a military strategy adapted for information security: if one layer fails, the next layer continues to protect the asset. On a Linux system, these layers form a hierarchy from hardware to application.

### The Layered Security Model

```mermaid
graph TB
    subgraph "Hardware Layer"
        HW1[UEFI Secure Boot]
        HW2[TPM]
        HW3[CPU Security Features]
    end

    subgraph "Kernel Layer"
        K1[Seccomp BPF]
        K2[Capabilities]
        K3[LSM - SELinux / AppArmor]
        K4[Namespaces & Cgroups]
        K5[Crypto Subsystem]
    end

    subgraph "System Layer"
        S1[PAM Authentication]
        S2[File Permissions / ACLs]
        S3[Service Management]
        S4[Network Filtering]
    end

    subgraph "Application Layer"
        A1[Sandboxing]
        A2[Input Validation]
        A3[TLS / Encryption]
    end

    HW1 --> K1
    HW2 --> K5
    HW3 --> K1
    K1 --> S1
    K2 --> S2
    K3 --> S2
    K4 --> S3
    K5 --> A3
    S1 --> A1
    S2 --> A1
    S3 --> A2
    S4 --> A2
```

Each layer assumes the layer above it (closer to the user) may fail:

| Layer | Protects Against | Example Mechanisms |
|-------|------------------|--------------------|
| Hardware | Physical attacks, bootkits | Secure Boot, TPM, IOMMU |
| Kernel | Privilege escalation, code execution | seccomp, capabilities, LSM |
| System | Unauthorized access, lateral movement | PAM, file permissions, iptables |
| Application | Data breaches, injection attacks | Sandboxing, input validation |

### Principle of Least Privilege

Every layer should operate with the minimum privileges required:

```bash
# Running a web server as a dedicated user, not root
sudo -u www-data /usr/sbin/apache2

# Dropping capabilities after binding to port 80
# (see capabilities.md for details)

# Using seccomp to restrict syscalls for a process
# (see seccomp.md for details)
```

## Attack Surface Analysis

The attack surface of a Linux system consists of all points where an unauthorized user can attempt to enter or extract data. Understanding and minimizing attack surface is fundamental to security.

### Categories of Attack Surface

```mermaid
mindmap
  root((Attack Surface))
    Network
      Open ports
      Listening services
      Protocol implementations
      Firewall rules
    Local
      Setuid binaries
      Writable files
      Cron jobs
      Kernel interfaces
    Physical
      Console access
      USB ports
      Boot media
      BIOS/UEFI
    Software
      Package vulnerabilities
      Configuration errors
      Supply chain
      Dependencies
```

### Measuring Attack Surface

```bash
# List all listening network services
ss -tlnp
# Expected output:
# State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
# LISTEN  0       128     0.0.0.0:22          0.0.0.0:*          users:(("sshd",pid=1234,fd=3))
# LISTEN  0       511     0.0.0.0:80          0.0.0.0:*          users:(("nginx",pid=5678,fd=6))

# Find all SUID binaries on the system
find / -perm -4000 -type f 2>/dev/null
# Expected output:
# /usr/bin/passwd
# /usr/bin/sudo
# /usr/bin/su
# /usr/bin/newgrp
# /usr/bin/chsh
# /usr/bin/chfn
# /usr/bin/gpasswd
# /usr/bin/mount
# /usr/bin/umount
# /usr/lib/openssh/ssh-keysign

# Count installed packages (each is potential attack surface)
dpkg --list 2>/dev/null | wc -l    # Debian/Ubuntu
rpm -qa 2>/dev/null | wc -l        # RHEL/Fedora

# List all kernel modules
lsmod | wc -l

# Check for world-writable files
find / -xdev -type f -perm -0002 2>/dev/null
```

### Reducing Attack Surface

```bash
# Disable unnecessary services
sudo systemctl disable --now cups
sudo systemctl disable --now avahi-daemon

# Remove unnecessary packages
sudo apt purge telnet rsh-client     # Debian/Ubuntu

# Disable unused kernel modules
echo "install dccp /bin/true" | sudo tee /etc/modprobe.d/dccp.conf
echo "install sctp /bin/true" | sudo tee /etc/modprobe.d/sctp.conf

# Restrict kernel module loading
echo "kernel.modules_disabled = 1" | sudo tee /etc/sysctl.d/99-modules.conf
# WARNING: This is irreversible until reboot — load all needed modules first
```

## Linux Security Architecture

### Kernel Security Subsystems

The Linux kernel provides several security subsystems, many of which are implemented through the **Linux Security Module (LSM)** framework.

```mermaid
graph LR
    subgraph "LSM Framework"
        direction TB
        LSM[LSM Hook Infrastructure]
        SEL[SELinux]
        AA[AppArmor]
        SMACK[SMACK]
        TOMOYO[TOMOYO]
        YAMA[Yama]
        LOADPIN[LoadPin]
        LOCKDOWN[Lockdown]
    end

    LSM --> SEL
    LSM --> AA
    LSM --> SMACK
    LSM --> TOMOYO
    LSM --> YAMA
    LSM --> LOADPIN
    LSM --> LOCKDOWN

    subgraph "Non-LSM Security"
        CAP[Capabilities]
        SEC[Seccomp]
        NS[Namespaces]
        CG[Cgroups]
    end

    APP[Application] --> LSM
    APP --> CAP
    APP --> SEC
    APP --> NS
```

### LSM Framework

The LSM framework was introduced in Linux 2.6 to provide a general mechanism for mandatory access controls. LSM places **hooks** at critical points in the kernel — before access is granted to files, processes, sockets, and other kernel objects. Each LSM implementation can approve or deny the request.

```c
/* Simplified example of an LSM hook in the kernel */
/* From security/security.c */

int security_file_open(struct file *file)
{
    int rc = 0;

    /* Each registered LSM gets to inspect and potentially deny */
    rc = call_int_hook(file_open, 0, file);
    return rc;
}
```

Only one **major LSM** can be active at a time (SELinux, AppArmor, SMACK, or TOMOYO), but **minor LSMs** (Yama, LoadPin, Lockdown) can stack with a major LSM starting with Linux 5.4+.

```bash
# Check which LSM is active
cat /sys/kernel/security/lsm
# Example output: lockdown,capability,yama,apparmor

# The order matters — the first major LSM listed is the primary one
```

### Security Context Flow

```mermaid
sequenceDiagram
    participant User
    participant Shell
    participant Kernel
    participant LSM
    participant DAC
    participant Filesystem

    User->>Shell: cat /etc/shadow
    Shell->>Kernel: open("/etc/shadow", O_RDONLY)
    Kernel->>LSM: security_file_open()
    LSM->>LSM: Check MAC policy
    alt Policy allows
        LSM->>Kernel: ALLOW (return 0)
        Kernel->>DAC: Check DAC permissions
        DAC->>DAC: uid/gid vs file owner/group
        alt DAC allows
            DAC->>Kernel: ALLOW
            Kernel->>Filesystem: Read inode
            Filesystem->>Kernel: File data
            Kernel->>Shell: File descriptor
            Shell->>User: File contents
        else DAC denies
            DAC->>Kernel: DENY
            Kernel->>Shell: EACCES
            Shell->>User: Permission denied
        end
    else Policy denies
        LSM->>Kernel: DENY (return -EACCES)
        Kernel->>Shell: EACCES
        Shell->>User: Permission denied (MAC)
    end
```

## Core Security Components

### 1. Discretionary Access Control (DAC)

The traditional Unix permission model — the file owner *discretionarily* decides who can access their files. This is the baseline, covered in detail in [Security Model](./security-model.md).

```bash
# Basic DAC example
ls -l /etc/passwd
# -rw-r--r-- 1 root root 2847 Jul 15 10:00 /etc/passwd
#  ^^^        ^^^^ ^^^^
#  |          |    |
#  |          |    Group (root): read
#  |          Owner (root): read, write
#  Others: read
```

### 2. Mandatory Access Control (MAC)

MAC policies are set by the system administrator and cannot be overridden by users. Two major implementations:

- **SELinux** — Label-based, used by RHEL, Fedora, CentOS, Android. See [SELinux](./selinux.md).
- **AppArmor** — Path-based, used by Ubuntu, SUSE, Debian. See [AppArmor](./apparmor.md).

### 3. Capabilities

Instead of the all-or-nothing root model, Linux capabilities divide root's power into discrete units. See [Capabilities](./capabilities.md).

```bash
# Example: granting only network capabilities to a process
sudo setcap cap_net_bind_service,cap_net_raw+ep /usr/bin/myapp

# Verify
getcap /usr/bin/myapp
# /usr/bin/myapp cap_net_bind_service,cap_net_raw=ep
```

### 4. Seccomp

Seccomp (Secure Computing Mode) restricts the system calls a process can make. See [Seccomp](./seccomp.md).

### 5. Namespaces and Cgroups

While primarily used for containerization, namespaces and cgroups are security mechanisms:

```bash
# Create a minimal isolated environment
unshare --mount --uts --ipc --net --pid --fork /bin/bash

# The process now has its own:
# - Mount namespace (isolated filesystem view)
# - UTS namespace (hostname)
# - IPC namespace (shared memory, semaphores)
# - Network namespace (independent network stack)
# - PID namespace (process ID space)
```

### 6. Cryptographic Subsystem

The kernel provides cryptographic primitives used by filesystem encryption, network security, and more. See [Cryptography](./cryptography.md).

### 7. Authentication (PAM)

Pluggable Authentication Modules provide a flexible framework for user authentication. See [PAM](./pam.md).

## Security by Distro

Different distributions make different security trade-offs:

| Distribution | Default MAC | Init System | Crypto Default | Notable Security Features |
|-------------|-------------|-------------|----------------|--------------------------|
| RHEL / CentOS Stream | SELinux (enforcing) | systemd | LUKS2 | FIPS certification, CIS profiles |
| Fedora | SELinux (enforcing) | systemd | LUKS2 | Early adoption of security features |
| Ubuntu | AppArmor | systemd | LUKS2 | Unattended-upgrades by default |
| Debian | AppArmor | systemd | LUKS2 | Conservative, stable security |
| Arch Linux | None | systemd | User choice | Minimal defaults, user responsibility |
| Alpine | None | OpenRC | User choice | musl libc (smaller attack surface) |
| Android | SELinux (enforcing) | init | FBE | Strong app sandboxing via SELinux + seccomp |

## Security Auditing Framework

Linux provides the **audit** subsystem for tracking security-relevant events:

```bash
# Check if auditd is running
sudo systemctl status auditd

# Add a watch rule to monitor /etc/passwd for changes
sudo auditctl -w /etc/passwd -p wa -k passwd_changes

# Search audit logs for the key
sudo ausearch -k passwd_changes
# ----
# time->Tue Jul 21 10:30:45 2026
# type=PROCTITLE msg=audit(1690000245.123:456): proctitle="useradd newuser"
# type=PATH msg=audit(1690000245.123:456): item=1 name="/etc/passwd" ...
# type=SYSCALL msg=audit(1690000245.123:456): arch=c000003e syscall=264 ...

# List all audit rules
sudo auditctl -l
```

See [Auditing and Monitoring](../observability/audit.md) for comprehensive coverage.

## Security Compliance Standards

Linux security is often measured against formal standards:

- **CIS Benchmarks** — Center for Internet Security provides detailed hardening guides. See [Hardening](./hardening.md).
- **STIG** — Security Technical Implementation Guide (DoD). Automated via OpenSCAP.
- **PCI-DSS** — Payment card industry requirements.
- **HIPAA** — Healthcare data protection.
- **FIPS 140-2/3** — Cryptographic module validation.

```bash
# Using OpenSCAP to evaluate CIS compliance
sudo oscap xccdf eval \
  --profile xccdf_org.ssgproject.content_profile_cis_level2_server \
  --results results.xml \
  --report report.html \
  /usr/share/xml/scap/ssg/content/ssg-ubuntu2204-ds.xml
```

## Threat Model

Understanding what you're defending against shapes your security choices:

```mermaid
graph TD
    subgraph "Threat Actors"
        T1[Script Kiddies]
        T2[Opportunistic Attackers]
        T3[Targeted Attackers]
        T4[Insider Threats]
        T5[Nation-State]
    end

    subgraph "Attack Vectors"
        V1[Network Exploits]
        V2[Social Engineering]
        V3[Supply Chain]
        V4[Physical Access]
        V5[Credential Theft]
    end

    subgraph "Defenses"
        D1[Firewall + IDS]
        D2[Training + Phishing Filters]
        D3[Package Signing + Reproducible Builds]
        D4[Secure Boot + Encryption]
        D5[MFA + Key Management]
    end

    T1 --> V1
    T2 --> V1
    T2 --> V5
    T3 --> V2
    T3 --> V3
    T4 --> V5
    T4 --> V4
    T5 --> V3
    T5 --> V2

    V1 --> D1
    V2 --> D2
    V3 --> D3
    V4 --> D4
    V5 --> D5
```

## Quick Security Checklist

```bash
# 1. System updates
sudo apt update && sudo apt upgrade -y          # Debian/Ubuntu
sudo dnf update -y                               # Fedora/RHEL

# 2. Firewall enabled
sudo ufw enable                                  # Ubuntu
sudo firewall-cmd --state                         # RHEL

# 3. SSH hardened
grep -E "^(PermitRootLogin|PasswordAuthentication|Port)" /etc/ssh/sshd_config
# Should see:
# PermitRootLogin no
# PasswordAuthentication no
# Port 2222  (or similar non-standard port)

# 4. SELinux/AppArmor active
getenforce                                       # SELinux: should return "Enforcing"
sudo aa-status                                   # AppArmor: profiles loaded

# 5. Automatic security updates
sudo dpkg-reconfigure -plow unattended-upgrades  # Debian/Ubuntu

# 6. Fail2ban or similar
sudo systemctl status fail2ban

# 7. Audit logging
sudo systemctl status auditd

# 8. Kernel parameters hardened
sysctl net.ipv4.conf.all.rp_filter               # Should be 1
sysctl net.ipv4.conf.all.accept_redirects         # Should be 0
sysctl kernel.randomize_va_space                   # Should be 2
```

## References

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [LWN.net - Linux and free software news](https://lwn.net/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- Linux Kernel Documentation — Security: https://www.kernel.org/doc/html/latest/security/
- Linux Security Module Framework: https://www.kernel.org/doc/html/latest/security/lsm.html
- NIST SP 800-123 — Guide to General Server Security: https://csrc.nist.gov/publications/detail/sp/800-123/final
- CIS Benchmarks: https://www.cisecurity.org/cis-benchmarks
- Red Hat Enterprise Linux Security Guide: https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/security_hardening/
- Ubuntu Security Documentation: https://ubuntu.com/security
- Arch Linux Security Wiki: https://wiki.archlinux.org/title/Security
- Linux Audit Project: https://people.redhat.com/sgrubb/audit/

## Related Topics

- [Unix Security Model](./security-model.md) — DAC, permissions, users, groups
- [SELinux](./selinux.md) — Mandatory Access Control on RHEL/Fedora
- [AppArmor](./apparmor.md) — Path-based MAC on Ubuntu/SUSE
- [Seccomp](./seccomp.md) — Syscall filtering
- [Capabilities](./capabilities.md) — Fine-grained root privileges
- [PAM](./pam.md) — Authentication framework
- [Cryptography](./cryptography.md) — Kernel crypto, LUKS, dm-crypt
- [Hardening](./hardening.md) — Practical hardening guide
- [Secure Boot](./secure-boot.md) — UEFI Secure Boot chain
