# OrangeFS

OrangeFS (Orange File System) is an open-source **distributed parallel file
system** designed for high-performance computing (HPC) clusters.  It evolved
from the Parallel Virtual File System (PVFS2) and was merged into the Linux
kernel tree as an out-of-tree client with upstream VFS patches beginning in
4.x kernels.

---

## 1. History

| Year | Event |
|---|---|
| 1993 | PVFS1 developed at Clemson University |
| 2003 | PVFS2 rewritten with modular architecture |
| 2011 | Renamed to OrangeFS (Orange = "Open-source Rapid Network Geometry File System") |
| 2016 | Kernel client submitted for upstream merge |
| 2018 | Out-of-tree client stabilised for production HPC |

OrangeFS is maintained by the Parallel Architecture Research Lab (PARL) at
Clemson University and Omnibond Systems.

---

## 2. Architecture

OrangeFS has three tiers:

```
┌───────────────────────────────────────────┐
│              Clients                      │
│  (kernel module or user-space libpvfs2)   │
└──────────────┬────────────────────────────┘
               │  BMI (Buffered Messaging Interface)
               ▼
┌───────────────────────────────────────────┐
│           I/O Servers (dataservers)       │
│  Store file data in native filesystem     │
└──────────────┬────────────────────────────┘
               │
               ▼
┌───────────────────────────────────────────┐
│         Management Server (mdsrv)         │
│  Metadata, namespace, consistency         │
└───────────────────────────────────────────┘
```

### 2.1 Management Server

The management server (mdsrv) is a **single** process that:

* Stores and serves **metadata** (file names, permissions, timestamps,
  stripe configurations).
* Manages the **namespace** — the directory tree.
* Handles **distributed locking** for metadata consistency.
* Maintains the **file system configuration** (server topology, striping
  parameters).

It is the single point of consistency for metadata.  Data, however, flows
directly between clients and I/O servers.

### 2.2 I/O Servers (Data Servers)

Each I/O server:

* Stores file data in a local filesystem (ext4, XFS, etc.) under a
  designated storage directory.
* Serves read/write requests from clients.
* Can be distributed across many nodes for parallel I/O.

### 2.3 Clients

Two client modes:

| Mode | How | Use Case |
|---|---|---|
| **Kernel module** | VFS mount, standard POSIX I/O | Transparent to applications |
| **User-space library** | `libpvfs2`, direct API | MPI-IO, specialized apps |

---

## 3. BMI — Buffered Messaging Interface

BMI is the **transport abstraction layer** used by OrangeFS.  It provides a
uniform API over multiple network fabrics:

### 3.1 Supported Transports

| Transport | Module | Typical Use |
|---|---|---|
| TCP | `bmi_tcp` | Ethernet clusters |
| InfiniBand | `bmi_ib` | HPC clusters |
| Gemini/Aries | `bmi_gm` | Cray systems |
| Myrinet | `bmi_gm` | Legacy HPC |

### 3.2 BMI API

```c
int BMI_initialize(void *method_info, BMI_addr_t *listen_addr, int flags);
int BMI_post_send(BMI_addr_t addr, void *buffer, size_t size,
                  BMI_op_id_t *op_id, void *user_ptr);
int BMI_post_recv(BMI_addr_t addr, void *buffer, size_t size,
                  BMI_op_id_t *op_id, void *user_ptr);
int BMI_test(BMI_op_id_t op_id, int *outcount, BMI_error_t *error,
             void **user_ptr, int max_idle_time_ms);
```

The API is **asynchronous** — posts are non-blocking, and `BMI_test()` or
`BMI_testsome()` polls for completion.  This matches the event-driven
architecture of the OrangeFS servers.

### 3.3 Flow

```
Client                BMI layer              I/O Server
  │                      │                       │
  │  BMI_post_send()     │                       │
  │ ─────────────────►   │  TCP/IB send()        │
  │                      │ ─────────────────►    │
  │                      │                       │
  │                      │  TCP/IB recv()        │
  │                      │ ◄─────────────────    │
  │  BMI_test()          │                       │
  │ ◄─────────────────   │                       │
```

---

## 4. Data Distribution (Striping)

OrangeFS distributes file data across I/O servers using **striping**:

### 4.1 Striping Parameters

| Parameter | Meaning | Typical |
|---|---|---|
| `stripe_size` | Bytes per stripe per server | 64 KiB – 1 MiB |
| `stripe_count` | Number of I/O servers for this file | 4 – 64 |
| `distribution` | Round-robin, simple, or custom | round-robin |

### 4.2 Round-Robin Example

With 4 servers and 256 KiB stripes, a 1 MiB write distributes as:

```
Server 0: bytes [0, 256K)
Server 1: bytes [256K, 512K)
Server 2: bytes [512K, 768K)
Server 3: bytes [768K, 1024K)
Server 0: (next stripe, if file continues)
```

### 4.3 MPI-IO Integration

OrangeFS is a popular backend for MPI-IO (ROMIO).  The MPI-IO driver maps
MPI file views to OrangeFS stripes, enabling parallel I/O from hundreds of
MPI ranks without coordination through the metadata server.

---

## 5. Kernel VFS Client

### 5.1 Mounting

```bash
mount -t pvfs2 tcp://mgmt-server:3334 /mnt/orangefs
```

The kernel module (`orangefs.ko`) implements:

* `sb->s_op` (super operations)
* `inode->i_op` (inode operations)
* `file->f_op` (file operations)

Standard POSIX calls (`open`, `read`, `write`, `mmap`, `stat`) are
translated to OrangeFS protocol messages.

### 5.2 Protocol

OrangeFS uses a custom binary protocol over BMI:

```
┌──────────┬──────────┬──────────┬──────────┐
│  Magic   │  Opcode  │  Size    │  Payload │
│  4 bytes │  4 bytes │  4 bytes │  N bytes │
└──────────┴──────────┴──────────┴──────────┘
```

Opcodes include `PVFS_VFS_READ`, `PVFS_VFS_WRITE`, `PVFS_VFS_LOOKUP`,
`PVFS_VFS_CREATE`, `PVFS_VFS_REMOVE`, etc.

### 5.3 Caching

The kernel client has a **directory entry cache** (dcache integration) and
an **attribute cache** (timeout-based).  There is **no data cache** in the
kernel client — every read goes to the I/O server.  This is by design: the
client trusts the server for data consistency.

---

## 6. Configuration

### 6.1 Server Configuration (`orangefs.conf`)

```ini
[ORANGEFS_DEFAULTS]
EventLogging = none
ServerJobBMITimeoutSecs = 30
ClientJobBMITimeoutSecs = 30

[server]
Name = iorange
ID = 101
EventLogging = /var/log/orangefs-server.log
```

### 6.2 File System Configuration (`fs.conf`)

```ini
[fs]
Name = orangefs
ID = 104
RootHandle = 1073741823
StripeSize = 1048576
StripeCount = 4
DistributionName = roundrobin
```

---

## 7. Performance Characteristics

| Metric | Typical (1GbE) | Typical (100Gb IB) |
|---|---|---|
| Sequential read | 100 MB/s | 50+ GB/s (aggregate) |
| Sequential write | 80 MB/s | 40+ GB/s |
| Metadata ops | 10K ops/s | 50K+ ops/s |
| Small file IOPS | 5K | 100K+ |

Performance scales nearly linearly with the number of I/O servers for
large sequential transfers.  Metadata performance is limited by the single
management server.

---

## 8. Comparison with Other Distributed File Systems

| Feature | OrangeFS | Lustre | CephFS | BeeGFS |
|---|---|---|---|---|
| Metadata | Single server | MDS cluster | MDS cluster | Single/HA |
| Data | Direct to servers | OST-based | OSD-based | Direct |
| Striping | Configurable | Per-file | Object | Per-file |
| HPC focus | Yes | Yes | Less | Yes |
| POSIX | Yes | Yes | Yes (loose) | Yes |
| In-kernel client | Yes | Yes (ldiskfs) | Via FUSE/kclient | Yes |
| License | Apache-2.0 | GPLv2 | LGPL | GPLv2 |

---

## 9. Use Cases

* **HPC clusters** — parallel I/O for scientific simulations.
* **MPI applications** — native MPI-IO support via ROMIO.
* **Big data** — large-scale analytics with Hadoop (via FUSE or native).
* **Training clusters** — model checkpoint storage with parallel writes.

---

## 10. Further Reading

* **OrangeFS documentation: https://docs.orangefs.io/**
* **LWN: [OrangeFS: a new direction for PVFS](https://lwn.net/Articles/662090/)**
* **PVFS2 project page: https://www.pvfs.org/**
* **Source code: https://github.com/waltligon/orangefs**
* **Source: `fs/orangefs/` in the kernel tree**
* **LPC 2016: "Upstreaming the OrangeFS Kernel Client"**

---

## Cross-References

* [VFS Layer](./vfs.md) — the virtual filesystem interface
* [ext4](./ext4.md) — common backend filesystem for I/O servers
* [Distributed Locking](../sync/distributed-locking.md) — metadata consistency
* [NFS](./nfs.md) — another network filesystem approach
* [BeeGFS](./beegfs.md) — similar HPC filesystem
