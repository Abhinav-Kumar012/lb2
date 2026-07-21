# AF_PACKET — Raw Sockets and Packet Capture

## Overview

`AF_PACKET` is a Linux socket family that allows applications to send and receive
packets at the link layer (Layer 2) directly, bypassing the kernel's normal TCP/IP
stack processing. It is the foundation for packet capture tools (tcpdump, Wireshark),
network monitoring systems, and high-performance traffic analysis frameworks.

AF_PACKET provides access to raw Ethernet frames, making it indispensable for
network diagnostics, intrusion detection systems (IDS), and custom protocol
implementations that need to operate below the IP layer.

## History

AF_PACKET has evolved significantly since its introduction:

- **Linux 2.0**: Initial packet socket support, `TPACKET_V1` ring buffer
- **Linux 2.6**: Introduction of `TPACKET_V2` with improved alignment and VLAN
  tag support
- **Linux 3.2** (2012): `TPACKET_V3` — flexible block-based ring buffer with
  support for variable-length frames and configurable block sizes
- **Linux 3.x–5.x**: Ongoing performance improvements including busy-polling
  support, mmap enhancements, and AF_XDP integration

## Socket Creation

### Basic Raw Socket

```c
#include <sys/socket.h>
#include <linux/if_packet.h>
#include <net/ethernet.h>

int fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
```

- `SOCK_RAW`: delivers complete link-layer frames including the MAC header
- `SOCK_DGRAM`: strips the link-layer header before delivery

### Protocol Filtering

The third argument filters by EtherType:

| Value         | Meaning                           |
|---------------|-----------------------------------|
| `ETH_P_ALL`   | All protocols (promiscuous mode)  |
| `ETH_P_IP`    | IPv4 only                         |
| `ETH_P_ARP`   | ARP only                          |
| `ETH_P_IPV6`  | IPv6 only                         |

### Promiscuous Mode

To capture all traffic on a network segment (not just traffic destined for the
local host), enable promiscuous mode on the interface:

```c
struct packet_mreq mreq = {
    .mr_ifindex = ifindex,
    .mr_type = PACKET_MR_PROMISC,
};
setsockopt(fd, SOL_PACKET, PACKET_ADD_MEMBERSHIP, &mreq, sizeof(mreq));
```

## Ring Buffers: TPACKET_V1, V2, V3

### The Problem with recvmsg()

Using standard `recvmsg()` for packet capture has significant overhead: each
packet requires a system call, kernel-to-user memory copy, and context switch.
At high packet rates, this becomes the bottleneck.

### Mmap Ring Buffers

AF_PACKET solves this by mapping a shared ring buffer between kernel and user
space. The kernel writes captured frames into the ring; the application reads
them directly from mapped memory, eliminating per-packet copies and system calls.

### TPACKET_V1 (Legacy)

The original implementation. Each frame in the ring has a fixed-size header
(`struct tpacket_hdr`) followed by the packet data. Simple but inflexible —
fixed frame size wastes memory for small packets.

### TPACKET_V2 (Improved)

Introduced in Linux 2.6. Key improvements:

- Better alignment for VLAN tag insertion (`tp_vlan_tci` field)
- Support for multiple VLAN tags (QinQ)
- `struct tpacket2_hdr` replaces `tpacket_hdr`

```c
int version = TPACKET_V2;
setsockopt(fd, SOL_PACKET, PACKET_VERSION, &version, sizeof(version));
```

### TPACKET_V3 (Block-Based)

Introduced in **Linux 3.2** by Chetan Loke. The most flexible and performant
version:

**Key Design Changes:**

1. **Block-based**: frames are grouped into blocks rather than individual frames
2. **Variable-length frames**: blocks can contain frames of different sizes
3. **Configurable block size**: tuned for L2 cache or page size alignment
4. **Timer-based flushing**: blocks are released to userspace either when full
   or after a configurable timeout (even if partially filled)

**Ring Buffer Layout:**

```
+------------------+------------------+------------------+---
|     Block 0      |     Block 1      |     Block 2      |
| [hdr][frame]...  | [hdr][frame]...  | [hdr][frame]...  |
+------------------+------------------+------------------+---
       ^                    ^
       |                    |
  kernel writes here   userspace reads here
```

**Configuration:**

```c
struct tpacket_req3 req = {
    .tp_block_size = 1 << 22,      /* 4 MiB per block */
    .tp_block_nr   = 64,           /* 64 blocks */
    .tp_frame_size = TPACKET_V3,   /* ignored in V3, kernel sets optimal */
    .tp_frame_nr   = 0,            /* computed from block_size * block_nr */
    .tp_retire_blk_tov = 64,       /* block timeout in ms */
    .tp_sizeof_priv = 0,           /* private data area per block */
    .tp_feature_req_word = TP_FT_REQ_FILL_RXHASH,
};
setsockopt(fd, SOL_PACKET, PACKET_RX_RING, &req, sizeof(req));
```

**Reading Frames in V3:**

```c
/* Map the ring */
void *ring = mmap(NULL, size, PROT_READ | PROT_WRITE,
                  MAP_SHARED, fd, 0);

/* Poll for available blocks */
struct pollfd pfd = { .fd = fd, .events = POLLIN };
poll(&pfd, 1, -1);

/* Process block */
struct tpacket_block_desc *block = ring + block_offset;
if (!(block->hdr.bh1.block_status & TP_STATUS_USER))
    continue;

/* Iterate frames within block */
struct tpacket3_hdr *frame = (void *)block + block->hdr.bh1.offset_to_first_pkt;
for (uint32_t i = 0; i < block->hdr.bh1.num_pkts; i++) {
    /* Process frame at (uint8_t *)frame + frame->tp_mac */
    frame = (struct tpacket3_hdr *)((uint8_t *)frame + frame->tp_next_offset);
}

/* Release block back to kernel */
block->hdr.bh1.block_status = TP_STATUS_KERNEL;
```

## Packet Fanout

For multi-threaded capture, AF_PACKET supports **fanout** — distributing packets
across multiple sockets (and thus threads) based on configurable policies.

```c
int fanout_group = 0x1234;  /* arbitrary group ID */
int fanout_type = FANOUT_HASH;  /* or FANOUT_CPU, FANOUT_RND, etc. */
int fanout_arg = (fanout_group | (fanout_type << 16));
setsockopt(fd, SOL_PACKET, PACKET_FANOUT, &fanout_arg, sizeof(fanout_arg));
```

### Fanout Policies

| Policy              | Behavior                                    |
|---------------------|---------------------------------------------|
| `FANOUT_HASH`       | Hash-based flow distribution (per-flow affinity) |
| `FANOUT_CPU`        | Route packets to the socket on the processing CPU |
| `FANOUT_RND`        | Random distribution                         |
| `FANOUT_ROLLOVER`   | Fill sockets sequentially (rollover on full)|
| `FANOUT_CBPF`       | Custom BPF program for distribution         |
| `FANOUT_EBPF`       | Custom eBPF program for distribution        |
| `FANOUT_FLAG_DEFRAG`| Defragment IP before hashing (for flow consistency) |
| `FANOUT_FLAG_ROLLOVER` | Enable rollover as fallback on overload  |

### Fanout with BPF

eBPF-based fanout allows custom packet distribution logic:

```c
/* Attach eBPF program for fanout decision */
int fanout_arg = fanout_group | (FANOUT_EBPF << 16);
setsockopt(fd, SOL_PACKET, PACKET_FANOUT, &fanout_arg, sizeof(fanout_arg));
/* Then setsockopt with PACKET_FANOUT_DATA pointing to BPF fd */
```

## BPF Filtering

AF_PACKET sockets support classic BPF (cBPF) filters to accept only relevant
packets in kernel space, reducing the volume of data transferred to userspace:

```c
/* tcpdump -i eth0 port 80 → compiled BPF program */
struct sock_filter filter[] = { /* ... compiled BPF bytecode ... */ };
struct sock_fprog prog = {
    .len = sizeof(filter) / sizeof(filter[0]),
    .filter = filter,
};
setsockopt(fd, SOL_SOCKET, SO_ATTACH_FILTER, &prog, sizeof(prog));
```

For more advanced filtering, eBPF programs can be attached via `SO_ATTACH_BPF`.

## AF_PACKET vs. AF_XDP

AF_XDP (Express Data Path), introduced in Linux 4.18, is the modern successor
for high-performance packet processing:

| Aspect          | AF_PACKET            | AF_XDP                      |
|-----------------|----------------------|-----------------------------|
| Hook point      | Above driver         | Driver-level (zero-copy)    |
| Performance     | Good (mmap ring)     | Excellent (UMEM, zero-copy) |
| Hardware offload| No                   | Some NICs support it        |
| Kernel bypass   | No                   | Yes (XDP_PASS drops to stack)|
| Maturity        | Stable, widely used  | Newer, fewer drivers        |
| Use case        | Capture, monitoring  | High-speed forwarding, NFV  |

AF_PACKET remains the standard for packet capture and monitoring. AF_XDP is
preferred for high-throughput packet processing where kernel bypass is acceptable.

## Performance Considerations

### Ring Buffer Sizing

- Larger rings absorb burst traffic without packet drops
- Block size should align with L2 cache line size or page size
- Monitor `tp_drops` in `tpacket_stats` for ring overflow detection

### Busy Polling

Enable busy polling to reduce latency by spinning in the socket poll instead
of sleeping:

```bash
echo 50 > /proc/sys/net/core/busy_read  # microseconds
```

### CPU Affinity

Pin capture threads to specific CPUs and use `FANOUT_CPU` for optimal cache
behavior and NUMA locality.

### Interrupt Coalescing

Modern NICs support interrupt coalescing, which batches multiple packets before
generating an interrupt. This reduces CPU overhead but increases latency. Tune
via `ethtool -C`.

## Security Implications

### Capabilities

Creating `AF_PACKET` sockets requires `CAP_NET_RAW` or membership in a user
namespace with network access. In unprivileged containers (see
[user namespace security](../../containers/user-namespace-security.md)), this
capability may not be available.

### Kernel Lockdown

When the kernel is in **lockdown integrity** mode (see
[Kernel Lockdown](../../security/lockdown.md)), `AF_PACKET` with `ETH_P_ALL`
is restricted because raw packet injection could compromise kernel integrity.

### Promiscuous Mode Detection

Promiscuous mode can be detected by remote hosts through crafted ARP probes
or monitoring for unexpected responses to unicast frames addressed to other
MAC addresses.

## Usage Examples

### Minimal Packet Capture (C)

```c
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <linux/if_packet.h>
#include <net/ethernet.h>
#include <arpa/inet.h>

int main(void) {
    int fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    if (fd < 0) { perror("socket"); return 1; }

    unsigned char buf[65535];
    while (1) {
        ssize_t n = recvfrom(fd, buf, sizeof(buf), 0, NULL, NULL);
        if (n > 0) {
            printf("Captured %zd bytes: %02x:%02x:%02x:%02x:%02x:%02x → "
                   "%02x:%02x:%02x:%02x:%02x:%02x  EtherType=0x%04x\n",
                   n,
                   buf[6], buf[7], buf[8], buf[9], buf[10], buf[11],
                   buf[0], buf[1], buf[2], buf[3], buf[4], buf[5],
                   ntohs(*(uint16_t *)(buf + 12)));
        }
    }
}
```

### TPACKET_V3 Capture with Timeout

```c
#include <sys/mman.h>
#include <sys/socket.h>
#include <linux/if_packet.h>
#include <pollfd.h>

#define BLOCK_SIZE  (1 << 22)  /* 4 MiB */
#define BLOCK_NR    64
#define FRAME_SIZE  2048

int setup_ring_v3(int fd) {
    struct tpacket_req3 req = {
        .tp_block_size     = BLOCK_SIZE,
        .tp_block_nr       = BLOCK_NR,
        .tp_frame_size     = FRAME_SIZE,
        .tp_frame_nr       = (BLOCK_SIZE * BLOCK_NR) / FRAME_SIZE,
        .tp_retire_blk_tov = 100,  /* 100ms timeout */
        .tp_sizeof_priv    = 0,
        .tp_feature_req_word = 0,
    };
    return setsockopt(fd, SOL_PACKET, PACKET_RX_RING, &req, sizeof(req));
}

int main(void) {
    int fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    int version = TPACKET_V3;
    setsockopt(fd, SOL_PACKET, PACKET_VERSION, &version, sizeof(version));
    setup_ring_v3(fd);

    size_t ring_size = BLOCK_SIZE * BLOCK_NR;
    void *ring = mmap(NULL, ring_size, PROT_READ | PROT_WRITE,
                      MAP_SHARED, fd, 0);

    struct pollfd pfd = { .fd = fd, .events = POLLIN };
    while (poll(&pfd, 1, 500) > 0) {
        struct tpacket_block_desc *bdesc = ring;
        for (int i = 0; i < BLOCK_NR; i++) {
            if (bdesc->hdr.bh1.block_status & TP_STATUS_USER) {
                /* Process frames in block */
                bdesc->hdr.bh1.block_status = TP_STATUS_KERNEL;
            }
            bdesc = (void *)bdesc + BLOCK_SIZE;
        }
    }
}
```

### tcpdump Internals

`tcpdump` uses AF_PACKET with `TPACKET_V2` (or V3 on newer versions) and cBPF
filters. Its capture pipeline:

1. Opens `AF_PACKET` socket with `SOCK_RAW`
2. Sets `TPACKET_V2` or `V3` ring buffer
3. Compiles display filter to cBPF via libpcap and attaches via `SO_ATTACH_FILTER`
4. Maps ring buffer and processes frames in a tight loop

## Common Pitfalls

1. **Forgetting promiscuous mode**: without it, you only see broadcast, multicast,
   and traffic addressed to the local interface.
2. **Undersized rings**: causes packet drops under burst traffic. Monitor
   `PACKET_STATISTICS` for drop counts.
3. **V1/V2/V3 confusion**: mixing struct types across versions leads to silent
   corruption or EINVAL errors.
4. **Endianness**: EtherType in the socket call must be in network byte order
   (`htons()`).
5. **Namespaces**: AF_PACKET sockets in containers are limited by the container's
   network namespace and capabilities.

## See Also

- [AF_XDP](af-xdp.md) — modern high-performance alternative
- [eBPF](../ebpf/bpf-overview.md) — programmable packet filtering and processing
- [User Namespace Security](../../containers/user-namespace-security.md) —
  capability restrictions for raw sockets
- [Kernel Lockdown](../../security/lockdown.md) — security restrictions on raw
  packet access
- [Ring Buffer](../../debugging/ring-buffer.md) — the lockless ring buffer
  architecture underlying TPACKET

## Further Reading

- **Kernel source**: `net/packet/af_packet.c`, `include/uapi/linux/if_packet.h`
- **Documentation**: `Documentation/networking/packet_mmap.rst`
- **man page**: `packet(7)`
- **LWN article**: ["The TPACKET_V3 packet capture mechanism"](https://lwn.net/Articles/418388/)
- **Chetan Loke's paper**: "Scalable Packet Capture and Analysis" — original
  TPACKET_V3 design rationale
- **libpcap**: the canonical packet capture library, abstracting AF_PACKET across
  platforms
