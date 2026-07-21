# Sockmap

Sockmap is a BPF-based mechanism that redirects packets between sockets
**inside the kernel**, bypassing the normal networking stack entirely.  It
enables high-performance socket-to-socket forwarding, load balancing, and
protocol parsing without copying data to user space.

---

## 1. Motivation

Consider a proxy: bytes arrive on one socket, the proxy reads them, processes
them, and writes them to another socket.  This involves two copies (kernel→user,
user→kernel), two system calls, and context switches.  Sockmap eliminates this
by letting BPF programs redirect sk_buff or sk_msg between sockets while the
data remains entirely in kernel space.

---

## 2. Architecture

```
 ┌──────────┐    BPF redirect    ┌──────────┐
 │  Socket A │ ───────────────►  │  Socket B │
 │  (ingress)│                   │  (egress) │
 └──────────┘                    └──────────┘
       ▲                              ▲
       │                              │
   BPF_PROG_TYPE_SK_SKB          BPF_PROG_TYPE_SK_MSG
   (parse/verdict)               (parse/verdict)
```

### 2.1 Components

| Component | Role |
|---|---|
| **Sockmap** | `BPF_MAP_TYPE_SOCKMAP` — stores socket references |
| **Sockhash** | `BPF_MAP_TYPE_SOCKHASH` — hash-indexed variant |
| **Stream verdict** | `BPF_PROG_TYPE_SK_SKB` attached to sockmap |
| **sk_msg** | `BPF_PROG_TYPE_SK_MSG` for sendmsg hooks |
| **`bpf_sk_redirect_map()`** | Helper to redirect to a sockmap entry |
| **`bpf_msg_redirect_map()`** | Helper for sk_msg redirection |

---

## 3. Creating and Using a Sockmap

### 3.1 Create the Map

```c
int sock_map = bpf_create_map(BPF_MAP_TYPE_SOCKMAP,
                              sizeof(int),   /* key */
                              sizeof(int),   /* value (fd placeholder) */
                              64,            /* max entries */
                              0);
```

Or in BPF skeleton / libbpf:

```c
struct {
    __uint(type, BPF_MAP_TYPE_SOCKMAP);
    __uint(max_entries, 64);
    __type(key, int);
    __type(value, int);
} sock_map SEC(".maps");
```

### 3.2 Insert Sockets

```c
int key = 0;
int fd  = accept(server_fd, ...);
bpf_map_update_elem(sock_map, &key, &fd, BPF_ANY);
```

### 3.3 Attach a BPF Program

The program type determines the hook point:

| Type | Hook | Use Case |
|---|---|---|
| `BPF_PROG_TYPE_SK_SKB` | `BPF_SK_SKB_STREAM_VERDICT` | TCP stream parsing |
| `BPF_PROG_TYPE_SK_SKB` | `BPF_SK_SKB_VERDICT` | UDP per-packet verdict |
| `BPF_PROG_TYPE_SK_MSG` | `BPF_SK_MSG_VERDICT` | sendmsg/sendpage hook |

```c
bpf_prog_attach(prog_fd, sock_map,
                BPF_SK_SKB_STREAM_VERDICT, 0);
```

---

## 4. `BPF_SK_SKB_STREAM_VERDICT`

This is the most common sockmap program type.  It is invoked for every
chunk of data received on a socket that is in the sockmap.

### 4.1 Program Signature

```c
SEC("sk_skb/stream_verdict")
int bpf_prog(struct __sk_buff *skb)
{
    int key = 0;
    return bpf_sk_redirect_map(skb, &sock_map, key, 0);
}
```

### 4.2 Return Values

| Return | Meaning |
|---|---|
| `SK_PASS` | Deliver data to the socket's recv queue normally |
| `SK_DROP` | Drop the data |
| `bpf_sk_redirect_map()` | Redirect to another socket in the map |

### 4.3 Parsing Example

A BPF program can parse a protocol header, extract a routing key, and
redirect:

```c
SEC("sk_skb/stream_verdict")
int verdict(struct __sk_buff *skb)
{
    struct proto_hdr *hdr;

    if (skb->len < sizeof(*hdr))
        return SK_DROP;

    hdr = (void *)(long)skb->data;
    int key = hdr->stream_id % 64;

    return bpf_sk_redirect_map(skb, &sock_map, key, 0);
}
```

---

## 5. sk_msg

`BPF_PROG_TYPE_SK_MSG` hooks into the `sendmsg()` and `sendfile()` paths.
Instead of intercepting received data, it intercepts data being sent.

### 5.1 Key Differences from sk_skb

| Feature | sk_skb | sk_msg |
|---|---|---|
| Hook | recv path | send path |
| Data | `struct __sk_buff` | `struct sk_msg_md` |
| Helper | `bpf_sk_redirect_map` | `bpf_msg_redirect_map` |
| Chunking | Stream segments | Full messages |
| Use case | Protocol routing | Send-side filtering/routing |

### 5.2 Example

```c
SEC("sk_msg")
int bpf_msg_verdict(struct sk_msg_md *msg)
{
    if (msg->size > 4096)
        return SK_DROP;

    int key = 1;
    return bpf_msg_redirect_map(msg, &sock_map, key, BPF_F_INGRESS);
}
```

---

## 6. Socket Redirection Internals

### 6.1 `bpf_sk_redirect_map()`

```c
u64 bpf_sk_redirect_map(struct __sk_buff *skb,
                        void *map, u32 key, u64 flags);
```

This stores the target socket in `skb->redir_index` and returns `SK_REDIRECT`.
The kernel then calls `__sock_map_redirect()` which:

1. Looks up the target socket in the map.
2. Calls the target socket's `sk_prot->recvmsg` or enqueues to the receive
   buffer directly.
3. The data never passes through the TCP/IP stack.

### 6.2 Performance

Sockmap redirection avoids:

* Routing table lookups
* Netfilter hooks
* Socket buffer allocation for the network path
* Context switches (no syscall on the receive side)

Throughput improvements of **2-5×** are typical for proxy workloads compared
to a user-space proxy on the same machine.

---

## 7. `apply_bytes` and `cork`ing

For stream protocols, the BPF program may want to buffer data until a full
message is available:

### 7.1 `bpf_msg_apply_bytes()`

```c
bpf_msg_apply_bytes(msg, bytes_consumed);
```

Tells the kernel "I've processed `bytes_consumed` bytes of this message;
only invoke me again for the remainder."

### 7.2 `bpf_msg_cork_bytes()`

```c
bpf_msg_cork_bytes(msg, required_size);
```

Buffers data in the kernel until at least `required_size` bytes are
available, then invokes the BPF program once.  Essential for protocol
parsing (e.g., HTTP headers).

---

## 8. Sockmap vs. Other BPF Mechanisms

| Mechanism | Where | What |
|---|---|---|
| **Sockmap** | Socket layer | Redirect between sockets |
| **TC (cls_bpf)** | Network device | Redirect between interfaces |
| **XDP** | Driver level | Drop/redirect before skb |
| **Socket filter** | Socket layer | Filter/modify per-packet |

Sockmap operates **above** the TCP/IP stack.  TC and XDP operate **below**
it.  Sockmap is the right choice when the goal is to route data between
sockets on the same host.

---

## 9. Use Cases

### 9.1 Layer-7 Load Balancer

Parse HTTP/1.1 or gRPC headers in BPF, extract the path or service name,
and redirect to the appropriate backend socket.

### 9.2 Service Mesh Sidecar Acceleration

Envoy sidecars spend most of their time copying data between two sockets.
Sockmap can redirect directly, cutting latency by 30-50%.

### 9.3 Multi-stream Multiplexing

A single TCP connection carries multiple logical streams (like HTTP/2).
BPF demuxes the stream ID and redirects each stream to its own socket for
parallel processing.

### 9.4 Kernel TLS (kTLS) Offload

Sockmap integrates with kTLS.  Data can be redirected after TLS decryption,
processed by BPF, and re-encrypted on the egress socket — all without
touching user space.

---

## 10. Limitations

* Only works with **connected** sockets (TCP, Unix stream).  UDP support is
  limited and experimental.
* The BPF program runs in the **softirq** context for sk_skb and in the
  **syscall** context for sk_msg.  Heavy processing may cause latency spikes.
* `SOCKMAP` entries use integer keys; `SOCKHASH` is needed for hash-based
  lookups.
* Maximum map size is typically 65535 entries.
* Not all socket types support all operations (e.g., `splice()` through
  sockmap has quirks).

---

## 11. Further Reading

* **LWN: [BPF and Sockmap](https://lwn.net/Articles/731133/)**
* **LWN: [Socket redirection with BPF](https://lwn.net/Articles/776717/)**
* **Documentation: `Documentation/networking/sockmap.rst`**
* **Brendan Gregg's BPF sockmap examples**
* **John Fastabend's sockmap talks (Netdev 0x12, LPC 2018)**
* **Source: `net/core/sock_map.c`**

---

## Cross-References

* [BPF Overview](../bpf/index.md) — BPF program types and helpers
* [XDP](./xdp.md) — lower-level packet processing
* [kTLS](./ktls.md) — kernel TLS integration
* [Socket Layer](./sockets.md) — the socket subsystem
* [TC and cls_bpf](./tc.md) — traffic control BPF
