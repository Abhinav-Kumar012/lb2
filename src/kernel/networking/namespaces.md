# Network Namespaces

## Introduction

Network namespaces provide complete isolation of the network stack in Linux. Each namespace has its own network interfaces, routing tables, firewall rules, sockets, and `/proc/net` filesystem. This is the foundation of Linux container networking — every container (Docker, LXC, Kubernetes pod) gets its own network namespace, giving it a completely independent network environment.

Network namespaces are one of several namespace types in Linux (PID, mount, UTS, IPC, user, cgroup, time). They were introduced in Linux 2.6.29 (2009) and have become essential for modern container infrastructure.

## Network Namespace Architecture

```mermaid
graph TD
    subgraph "Default Namespace (Host)"
        H[Host eth0 10.0.0.1]
        BR[br0]
        VE1[veth host end]
    end
    subgraph "Namespace ns1 (Container 1)"
        V1[veth ns1 end]
        LO1[lo 127.0.0.1]
    end
    subgraph "Namespace ns2 (Container 2)"
        V2[veth ns2 end]
        LO2[lo 127.0.0.1]
    end
    
    H --> BR
    VE1 --> BR
    VE1 ---|veth pair| V1
    V2 ---|veth pair| BR
```

## Basic Operations

### Creating and Managing Namespaces

```bash
# Create a network namespace
ip netns add ns1

# List namespaces
ip netns list
# ns1

# Execute a command in a namespace
ip netns exec ns1 ip addr show
# 1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN
#     link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00

# Delete a namespace
ip netns del ns1

# Identify a process's namespace
ls -la /proc/$$/ns/net
# lrwxrwxrwx 1 root root 0 ... /proc/1234/ns/net -> 'net:[4026531840]'

# Find all processes in a namespace
lsns -t net
#         NS TYPE NPID  PID  USER  NETNSID  NSFS  COMMAND
# 4026531840 net    1    1  root unassigned       /sbin/init
# 4026532400 net  500  500  root        0        containerd
```

### Bringing Up Loopback

Namespaces start with loopback down. You must bring it up for localhost to work:

```bash
ip netns add ns1
ip netns exec ns1 ip link set lo up
ip netns exec ns1 ping 127.0.0.1
# PING 127.0.0.1 (127.0.0.1) 56(84) bytes of data.
# 64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.025 ms
```

## Veth Pairs

A veth (virtual Ethernet) pair is a virtual network device that comes in pairs. Packets transmitted on one end appear on the other end, creating a tunnel between namespaces.

### Creating Veth Pairs

```bash
# Create a veth pair
ip link add veth0 type veth peer name veth1

# Verify both ends exist
ip link show veth0
# veth0@veth1: <BROADCAST,MULTICAST,M-DOWN> mtu 1500 ...
ip link show veth1
# veth1@veth0: <BROADCAST,MULTICAST,M-DOWN> mtu 1500 ...

# Move one end into a namespace
ip link set veth1 netns ns1

# Configure inside namespace
ip netns exec ns1 ip addr add 10.0.0.2/24 dev veth1
ip netns exec ns1 ip link set veth1 up
ip netns exec ns1 ip link set lo up

# Configure host end
ip addr add 10.0.0.1/24 dev veth0
ip link set veth0 up

# Test connectivity
ip netns exec ns1 ping 10.0.0.1
# PING 10.0.0.1 (10.0.0.1) 56(84) bytes of data.
# 64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=0.045 ms
```

### Multiple Namespaces Connected via Bridge

```bash
# Create namespaces
ip netns add ns1
ip netns add ns2

# Create bridge on host
ip link add br0 type bridge
ip link set br0 up

# Create veth pairs and connect to bridge
ip link add veth-ns1 type veth peer name veth-ns1-br
ip link add veth-ns2 type veth peer name veth-ns2-br

ip link set veth-ns1 netns ns1
ip link set veth-ns2 netns ns2

ip link set veth-ns1-br master br0
ip link set veth-ns2-br master br0

# Configure namespace interfaces
ip netns exec ns1 ip addr add 10.0.1.1/24 dev veth-ns1
ip netns exec ns1 ip link set veth-ns1 up
ip netns exec ns1 ip link set lo up

ip netns exec ns2 ip addr add 10.0.1.2/24 dev veth-ns2
ip netns exec ns2 ip link set veth-ns2 up
ip netns exec ns2 ip link set lo up

# Bring up host-side interfaces
ip link set veth-ns1-br up
ip link set veth-ns2-br up

# Test connectivity between namespaces
ip netns exec ns1 ping 10.0.1.2
# PING 10.0.1.2 (10.0.1.2) 56(84) bytes of data.
# 64 bytes from 10.0.1.2: icmp_seq=1 ttl=64 time=0.067 ms

# Full network diagram
ip netns exec ns1 ip route add default via 10.0.1.254
```

## Routing Between Namespaces

### Direct Routing (No Bridge)

```bash
# Create namespaces
ip netns add ns1
ip netns add ns2

# Create veth pairs
ip link add veth-h1 type veth peer name veth-n1
ip link add veth-h2 type veth peer name veth-n2

# Move ends into namespaces
ip link set veth-n1 netns ns1
ip link set veth-n2 netns ns2

# Configure host interfaces
ip addr add 10.0.1.1/24 dev veth-h1
ip addr add 10.0.2.1/24 dev veth-h2
ip link set veth-h1 up
ip link set veth-h2 up

# Configure namespace interfaces
ip netns exec ns1 ip addr add 10.0.1.2/24 dev veth-n1
ip netns exec ns1 ip link set veth-n1 up
ip netns exec ns1 ip link set lo up
ip netns exec ns1 ip route add default via 10.0.1.1

ip netns exec ns2 ip addr add 10.0.2.2/24 dev veth-n2
ip netns exec ns2 ip link set veth-n2 up
ip netns exec ns2 ip link set lo up
ip netns exec ns2 ip route add default via 10.0.2.1

# Enable IP forwarding on host
sysctl -w net.ipv4.ip_forward=1

# Test: ns1 -> ns2 goes through host routing
ip netns exec ns1 traceroute 10.0.2.2
# 1  10.0.1.1  0.123 ms
# 2  10.0.2.2  0.234 ms
```

## NAT for Internet Access

Namespaces without a route to the host's default gateway need NAT:

```bash
# Create namespace with internet access via NAT
ip netns add ns1
ip link add veth-h type veth peer name veth-n
ip link set veth-n netns ns1

ip addr add 192.168.100.1/24 dev veth-h
ip link set veth-h up

ip netns exec ns1 ip addr add 192.168.100.2/24 dev veth-n
ip netns exec ns1 ip link set veth-n up
ip netns exec ns1 ip link set lo up
ip netns exec ns1 ip route add default via 192.168.100.1

# Enable forwarding
sysctl -w net.ipv4.ip_forward=1

# Set up NAT (assuming eth0 is the host's internet-facing interface)
iptables -t nat -A POSTROUTING -s 192.168.100.0/24 -o eth0 -j MASQUERADE
iptables -A FORWARD -i veth-h -o eth0 -j ACCEPT
iptables -A FORWARD -i eth0 -o veth-h -m state --state RELATED,ESTABLISHED -j ACCEPT

# Test internet access from namespace
ip netns exec ns1 ping 8.8.8.8
# PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.
# 64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=2.34 ms

# DNS resolution
ip netns exec ns1 bash -c "echo 'nameserver 8.8.8.8' > /etc/resolv.conf"
ip netns exec ns1 nslookup google.com
```

## Using `ip netns exec`

Run any program in a network namespace:

```bash
# Run a shell in a namespace
ip netns exec ns1 bash

# Run a server in a namespace
ip netns exec ns1 python3 -m http.server 8080

# Run tcpdump in a namespace
ip netns exec ns1 tcpdump -i veth-n1

# Run iperf3 server in namespace, client on host
ip netns exec ns1 iperf3 -s &
iperf3 -c 10.0.1.2

# Run a full container-like environment
ip netns exec ns1 unshare --mount --pid --fork /bin/bash
```

## Docker and Network Namespaces

Docker creates a network namespace for each container:

```bash
# Find a container's network namespace
CONTAINER_ID=$(docker ps -q --filter "name=mycontainer")

# Method 1: via /proc
PID=$(docker inspect --format '{{.State.Pid}}' $CONTAINER_ID)
ls -la /proc/$PID/ns/net

# Method 2: Docker's symlink
ls /var/run/docker/netns/

# Enter container's namespace
nsenter -t $PID -n ip addr show

# View all container namespaces
for cid in $(docker ps -q); do
    name=$(docker inspect --format '{{.Name}}' $cid | sed 's/\///')
    pid=$(docker inspect --format '{{.State.Pid}}' $cid)
    nsenter -t $pid -n ip -br addr show | grep -v lo
    echo "--- $name ---"
done
```

## Kubernetes Pod Networking

In Kubernetes, all containers in a pod share the same network namespace:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: mypod
spec:
  containers:
  - name: app
    image: nginx
  - name: sidecar
    image: busybox
    command: ["sleep", "3600"]
```

```bash
# Both containers share the same network namespace
# They can talk via localhost

# In production, CNI plugins (Calico, Flannel, Cilium) manage namespaces
# Typically via veth pairs connecting to a bridge or overlay network

# View pod network namespace
crictl inspect <container_id> | grep netns
```

## Named Namespaces (Persistent)

Named namespaces persist until explicitly deleted, even if no processes are using them:

```bash
# Create named namespace
ip netns add myns

# Run with unshare (unnamed namespace — dies with process)
unshare --net bash

# Bind-mount a namespace to persist it
touch /var/run/netns/persistent-ns
mount --bind /proc/$$/ns/net /var/run/netns/persistent-ns
# Now visible via ip netns list

# Or use ip netns (automatically managed)
ip netns add myns
# Creates /var/run/netns/mys automatically
```

## Network Namespace + Other Namespaces

```bash
# Full isolation: network + PID + mount + hostname
unshare --net --pid --mount --uts --fork bash

# Inside, set hostname
hostname container1
echo "hostname: $(hostname)"

# Mount proc (for ps to work)
mount -t proc proc /proc
ps aux

# All networking commands work in isolated namespace
ip link add lo type lo
ip link set lo up
ip addr add 127.0.0.1/8 dev lo
```

## Debugging Network Namespaces

```bash
# List all namespaces
ip netns list

# Find processes in each namespace
for ns in $(ip netns list); do
    echo "=== $ns ==="
    ip netns pids $ns | while read pid; do
        ps -p $pid -o pid,comm
    done
done

# Run commands in all namespaces
for ns in $(ip netns list); do
    echo "=== $ns ==="
    ip netns exec $ns ip -br addr show
done

# Capture traffic in a namespace
ip netns exec ns1 tcpdump -i any -w /tmp/ns1.pcap

# Check connectivity
ip netns exec ns1 ping -c 3 10.0.0.1

# View routing table
ip netns exec ns1 ip route show

# View ARP table
ip netns exec ns1 ip neigh show

# View firewall rules
ip netns exec ns1 iptables -L -n -v

# Move a process between namespaces
nsenter -t $PID --net=/var/run/netns/target-ns

# View namespace file descriptors
ls -la /var/run/netns/
# total 0
# -r--r--r-- 1 root root 0 ... ns1
# -r--r--r-- 1 root root 0 ... ns2

# Network namespace ID (netnsid)
ip netns list-id
```

## Programmatic Namespace Manipulation

```c
#include <sched.h>
#include <sys/mount.h>

/* Create new network namespace */
int create_netns(void)
{
    if (unshare(CLONE_NEWNET) < 0)
        return -1;
    
    /* Bring up loopback */
    /* ... use netlink or system("ip link set lo up") ... */
    return 0;
}

/* Move process to existing namespace */
#include <fcntl.h>
#include <sched.h>

int join_netns(pid_t target_pid)
{
    char path[64];
    int fd;
    
    snprintf(path, sizeof(path), "/proc/%d/ns/net", target_pid);
    fd = open(path, O_RDONLY);
    if (fd < 0)
        return -1;
    
    if (setns(fd, CLONE_NEWNET) < 0) {
        close(fd);
        return -1;
    }
    
    close(fd);
    return 0;
}
```

## References

- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- [Kernel Namespaces Documentation](https://docs.kernel.org/networking/scaling.html)
- [man-pages: namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [man-pages: network_namespaces(7)](https://man7.org/linux/man-pages/man7/network_namespaces.7.html)
- [LWN: Network namespaces](https://lwn.net/Articles/219827/)
- [LWN: Namespaces in operation](https://lwn.net/Articles/531114/)
- [Docker networking deep dive](https://docs.docker.com/network/)

## Related Topics

- [Bridging](./bridging.md) — Connecting namespace interfaces
- [Veth Pairs](./namespaces.md#veth-pairs) — Virtual Ethernet tunnels
- [Netlink](./netlink.md) — Programmatic namespace management
- [VLANs](./vlans.md) — VLANs in namespaced environments
- [Traffic Control](./tc.md) — QoS per namespace
