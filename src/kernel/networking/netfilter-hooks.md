# Netfilter Hooks

## Overview

**Netfilter** is the Linux kernel's framework for packet filtering, NAT, and packet mangling. It provides a series of **hook points** in the network stack where kernel modules can register callback functions to inspect, modify, or drop packets.

Netfilter is the foundation for `iptables`, `nftables`, and numerous third-party networking modules.

> **See also:** [iptables and nftables](./iptables.md), [Conntrack](./conntrack.md), [NAT](./nat.md)

---

## Hook Points (NF_INET_*)

The kernel defines five hook points for IPv4/IPv6 traffic. Each corresponds to a specific location in the packet processing path:

| Hook Constant         | Chain Name (iptables) | Location                                   |
|-----------------------|-----------------------|--------------------------------------------|
| `NF_INET_PRE_ROUTING` | `PREROUTING`         | After packet arrives, before routing decision |
| `NF_INET_LOCAL_IN`    | `INPUT`              | Packet destined for local delivery         |
| `NF_INET_FORWARD`     | `FORWARD`            | Packet being forwarded to another host     |
| `NF_INET_LOCAL_OUT`   | `OUTPUT`             | Packet originating from local processes    |
| `NF_INET_POST_ROUTING`| `POSTROUTING`        | After routing decision, before transmission|

Additionally, for ARP:

| Hook Constant       | Description                    |
|---------------------|--------------------------------|
| `NF_ARP_IN`         | Incoming ARP packet            |
| `NF_ARP_OUT`        | Outgoing ARP packet            |
| `NF_ARP_FORWARD`    | Forwarded ARP packet           |

### Packet Flow Diagram

```
                            ┌─────────────┐
  Network Interface ──────►│PRE_ROUTING   │
                            └──────┬──────┘
                                   │
                           ┌───────▼───────┐
                           │ Routing        │
                           │ Decision       │
                           └───┬───────┬───┘
                               │       │
                    ┌──────────▼┐   ┌──▼──────────┐
                    │ LOCAL_IN   │   │ FORWARD      │
                    │ (to local) │   │ (to another) │
                    └──────┬────┘   └───────┬──────┘
                           │                │
                    ┌──────▼─────┐   ┌──────▼──────┐
                    │ Local      │   │POST_ROUTING  │
                    │ Process    │   └──────┬──────┘
                    └──────┬─────┘          │
                           │                ▼
                    ┌──────▼─────┐   Network Interface
                    │ LOCAL_OUT  │
                    └──────┬─────┘
                           │
                           ▼
                    ┌─────────────┐
                    │POST_ROUTING │
                    └──────┬──────┘
                           │
                           ▼
                    Network Interface
```

---

## Return Values

Netfilter hook functions return one of these verdicts:

| Verdict                | Value | Meaning                                       |
|------------------------|-------|-----------------------------------------------|
| `NF_DROP`             | 0     | Drop the packet silently                      |
| `NF_ACCEPT`           | 1     | Accept; continue normal processing            |
| `NF_STOLEN`           | 2     | Packet consumed by hook; don't continue       |
| `NF_QUEUE`            | 3     | Queue to userspace (via `nfnetlink_queue`)    |
| `NF_REPEAT`           | 4     | Call this hook again                          |
| `NF_STOP`             | 5     | Accept but stop calling other hooks           |

### Stolen vs. Drop

- `NF_STOLEN` — The hook takes ownership of the `sk_buff`. Used for asynchronous processing (e.g., queueing for later).
- `NF_DROP` — The `sk_buff` is freed by the caller.

---

## Hook Priority

When multiple modules register hooks at the same point, they execute in **priority order** (lower number = higher priority):

| Priority Constant              | Value | Typical Use                    |
|--------------------------------|-------|--------------------------------|
| `NF_IP_PRI_CONNTRACK_DEFRAG`  | -400  | Connection tracking defrag     |
| `NF_IP_PRI_RAW`                | -300  | Raw table processing           |
| `NF_IP_PRI_SELINUX_FIRST`     | -225  | SELinux first hook             |
| `NF_IP_PRI_CONNTRACK`         | -200  | Connection tracking             |
| `NF_IP_PRI_MANGLE`            | -150  | Packet mangling                |
| `NF_IP_PRI_NAT_DST`           | -100  | Destination NAT (conntrack)    |
| `NF_IP_PRI_FILTER`            | 0     | Standard filtering (iptables)  |
| `NF_IP_PRI_SECURITY`          | 50    | Security table                 |
| `NF_IP_PRI_NAT_SRC`           | 100   | Source NAT (conntrack)         |
| `NF_IP_PRI_CONNTRACK_HELPER`  | 200   | Connection tracking helpers    |
| `NF_IP_PRI_CONNTRACK_CONFIRM` | `INT_MAX` | Final conntrack confirm    |

---

## nf_hook_ops Structure

Kernel modules register hooks by filling in `struct nf_hook_ops`:

```c
#include <linux/netfilter.h>

static unsigned int my_hook_fn(void *priv,
                               struct sk_buff *skb,
                               const struct nf_hook_state *state)
{
    struct iphdr *iph = ip_hdr(skb);

    if (iph->protocol == IPPROTO_ICMP) {
        pr_info("ICMP packet from %pI4\n", &iph->saddr);
    }

    return NF_ACCEPT;
}

static struct nf_hook_ops my_hook_ops = {
    .hook        = my_hook_fn,
    .hooknum     = NF_INET_PRE_ROUTING,
    .pf          = PF_INET,           /* IPv4 */
    .priority    = NF_IP_PRI_FILTER,
};

static int __init my_module_init(void)
{
    return nf_register_net_hook(&init_net, &my_hook_ops);
}

static void __exit my_module_exit(void)
{
    nf_unregister_net_hook(&init_net, &my_hook_ops);
}

module_init(my_module_init);
module_exit(my_module_exit);
MODULE_LICENSE("GPL");
```

### Key Fields

| Field        | Description                                        |
|-------------|----------------------------------------------------|
| `.hook`     | Callback function pointer                          |
| `.hooknum`  | Which hook point (`NF_INET_*`)                     |
| `.pf`       | Protocol family: `PF_INET` (IPv4) or `PF_INET6`   |
| `.priority` | Execution order among hooks at the same point      |

### Network Namespaces

`nf_register_net_hook()` registers a hook within a specific network namespace. Use `&init_net` for the default namespace, or pass the appropriate `struct net *` for container-specific hooks.

---

## Base Chains in nftables

In **nftables**, chains are classified as either **base chains** (attached to a netfilter hook) or **regular chains** (called by jump/goto from base chains).

### Creating a Base Chain

```bash
# Create a base chain attached to NF_INET_INPUT, priority 0 (filter)
nft add chain ip mytable myinput '{ type filter hook input priority 0; policy accept; }'

# NAT base chain at PREROUTING, priority -100 (dstnat)
nft add chain ip mytable prerouting '{ type nat hook prerouting priority -100; policy accept; }'
```

### Chain Types

| Type     | Allowed Hooks                              | Typical Priority |
|----------|-------------------------------------------|------------------|
| `filter` | All hooks                                 | 0                |
| `nat`    | `PREROUTING`, `INPUT`, `OUTPUT`, `POSTROUTING` | -100 (dst), 100 (src) |
| `route`  | `OUTPUT`                                  | -100             |

### Verdict Processing

In nftables, rules within a chain return **verdicts**:

| Verdict   | Effect                                       |
|-----------|----------------------------------------------|
| `accept`  | Allow the packet (equivalent to `NF_ACCEPT`) |
| `drop`    | Drop the packet (equivalent to `NF_DROP`)    |
| `queue`   | Send to userspace queue                      |
| `continue`| Continue evaluating next rule                |
| `jump`    | Jump to another chain (return after)         |
| `goto`    | Go to another chain (no return)              |

---

## Connection Tracking Integration

Netfilter hooks are tightly integrated with **conntrack**. The conntrack subsystem registers hooks at:

1. `NF_INET_PRE_ROUTING` (priority -200) — For incoming packets
2. `NF_INET_LOCAL_OUT` (priority -100) — For locally generated packets
3. `NF_INET_LOCAL_IN` (priority 200) — Helper attachment
4. `NF_INET_POST_ROUTING` (priority 200) — Final confirmation

```bash
# View connection tracking table
conntrack -L

# View conntrack statistics
cat /proc/net/stat/nf_conntrack
```

> **See also:** [Connection Tracking](./conntrack.md)

---

## Hook Multiplicity

Multiple hooks can coexist at the same point. The kernel iterates through them in priority order:

```
NF_INET_PRE_ROUTING (priority order):
  [-400] conntrack_defrag
  [-300] raw processing
  [-200] conntrack
  [-150] mangle
  [-100] DNAT
  [   0] filter (user rules)
  ...
```

Each hook independently returns `NF_ACCEPT`, `NF_DROP`, etc. If **any** hook drops the packet, processing stops and the packet is dropped.

---

## Userspace Queueing (NFQUEUE)

Packets can be sent to userspace for inspection via `NF_QUEUE`:

```bash
# iptables: queue packets to userspace NFQUEUE number 1
iptables -A INPUT -p tcp --dport 80 -j NFQUEUE --queue-num 1

# nftables equivalent
nft add rule ip mytable input tcp dport 80 queue num 1
```

Userspace programs use `libnetfilter_queue` to receive and verdict packets:

```c
/* Pseudocode: receive and accept */
struct nfq_handle *h = nfq_open();
nfq_create_queue(h, 1, callback, NULL);
/* callback returns NF_ACCEPT or NF_DROP */
```

---

## Debugging

### /proc and /sys Entries

```bash
# View registered hooks
cat /proc/net/netfilter/nf_log

# View netfilter statistics
cat /proc/net/stat/nf_conntrack

# View nf_log per-protocol
ls /proc/sys/net/netfilter/nf_log/
```

### Tracing with nftrace (nftables)

```bash
# Enable tracing for matched packets
nft add rule ip mytable input tcp dport 22 nftrace set 1

# View trace events
nft monitor trace
```

### Kernel Logging

```c
/* In a hook function */
pr_debug("netfilter: packet from %pI4 to %pI4\n",
         &iph->saddr, &iph->daddr);
```

Use dynamic debug to selectively enable:

```bash
echo "file net/ipv4/netfilter/*.c +p" > /sys/kernel/debug/dynamic_debug/control
```

> **See also:** [Dynamic Debug](../../debugging/dynamic-debug.md), [Netfilter Logging](./nf-log.md)

---

## IPv6 Hooks

The same five hook points exist for IPv6 (`PF_INET6`):

```c
static struct nf_hook_ops my_hook_ops = {
    .hook     = my_hook_fn_v6,
    .hooknum  = NF_INET_PRE_ROUTING,
    .pf       = PF_INET6,
    .priority = NF_IP_PRI_FILTER,
};
```

Use `ipv6_hdr(skb)` instead of `ip_hdr(skb)` to access the IPv6 header.

---

## Writing a Complete Module

```c
#include <linux/module.h>
#include <linux/netfilter.h>
#include <linux/ip.h>

static unsigned int count_packets;

static unsigned int hook_fn(void *priv,
                            struct sk_buff *skb,
                            const struct nf_hook_state *state)
{
    count_packets++;
    return NF_ACCEPT;
}

static struct nf_hook_ops ops = {
    .hook     = hook_fn,
    .hooknum  = NF_INET_FORWARD,
    .pf       = PF_INET,
    .priority = NF_IP_PRI_LAST,
};

static int __init mod_init(void)
{
    return nf_register_net_hook(&init_net, &ops);
}

static void __exit mod_exit(void)
{
    nf_unregister_net_hook(&init_net, &ops);
    pr_info("Forwarded %u packets\n", count_packets);
}

module_init(mod_init);
module_exit(mod_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Kernel Developer");
```

---

## Further Reading

- [Netfilter.org](https://www.netfilter.org/) — Official project page
- [Linux kernel source: `include/uapi/linux/netfilter.h`](https://elixir.bootlin.com/linux/latest/source/include/uapi/linux/netfilter.h)
- [Linux kernel source: `net/netfilter/core.c`](https://elixir.bootlin.com/linux/latest/source/net/netfilter/core.c)
- [nftables wiki](https://wiki.nftables.org/)
- **Linux Kernel Networking: Implementation and Theory** — Rami Rosen
- [LWN: A brief history of nftables](https://lwn.net/Articles/744528/)
- [Netfilter Hooks](https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-3.html)

> **Related topics:** [iptables](./iptables.md), [eBPF and XDP](./ebpf-xdp.md), [Netfilter Logging](./nf-log.md), [Conntrack](./conntrack.md)
