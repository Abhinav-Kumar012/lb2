# Networking Configuration

## Introduction

Network configuration is a fundamental system administration task. Whether setting up a simple server with a static IP or managing complex multi-interface routing, understanding Linux networking tools is essential. The Linux networking stack is one of the most powerful and flexible in the world, powering everything from embedded devices to the largest supercomputers and cloud infrastructure.

This page covers the modern `ip` command suite (replacing legacy `ifconfig`/`route`), the two major network management daemons (NetworkManager and systemd-networkd), and the traditional `/etc/network/interfaces` configuration format.

## The `ip` Command Suite

The `ip` command from the `iproute2` package is the modern, unified tool for network configuration. It replaces the legacy `ifconfig`, `route`, `arp`, and `netstat` commands.

### `ip link` — Link Layer (Interfaces)

```bash
# Show all interfaces
ip link show
# 1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
#     link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
# 2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
#     link/ether 52:54:00:12:34:56 brd ff:ff:ff:ff:ff:ff
#     altname enp0s3
# 3: eth1: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN mode DEFAULT group default qlen 1000
#     link/ether 52:54:00:78:9a:bc brd ff:ff:ff:ff:ff:ff

# Show specific interface
ip link show eth0

# Bring interface up/down
ip link set eth0 up
ip link set eth0 down

# Set MTU
ip link set eth0 mtu 9000  # Jumbo frames

# Set MAC address
ip link set eth0 address 52:54:00:aa:bb:cc

# Enable/disable promiscuous mode
ip link set eth0 promisc on

# Show statistics
ip -s link show eth0
#     RX:  bytes  packets  errors  dropped missed  mcast
#          123456    1234      0        0      0      0
#     TX:  bytes  packets  errors  dropped carrier collsns
#          654321    5678      0        0      0      0

# Show interface type details
ip -d link show eth0
```

### `ip addr` — IP Addresses

```bash
# Show all addresses
ip addr show
# 1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536
#     inet 127.0.0.1/8 scope host lo
#        valid_lft forever preferred_lft forever
#     inet6 ::1/128 scope host
#        valid_lft forever preferred_lft forever
# 2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500
#     inet 192.168.1.10/24 brd 192.168.1.255 scope global eth0
#        valid_lft forever preferred_lft forever
#     inet6 fe80::5054:ff:fe12:3456/64 scope link
#        valid_lft forever preferred_lft forever

# Show addresses on specific interface
ip addr show dev eth0

# Add IP address
ip addr add 192.168.1.10/24 dev eth0
ip addr add 10.0.0.1/24 dev eth0 label eth0:0  # Secondary address

# Add IPv6 address
ip addr add 2001:db8::1/64 dev eth0

# Delete IP address
ip addr del 192.168.1.10/24 dev eth0

# Flush all addresses on interface
ip addr flush dev eth1

# Show only IPv4
ip -4 addr show
# Show only IPv6
ip -6 addr show

# Show addresses in brief format
ip -br addr show
# lo               UNKNOWN        127.0.0.1/8 ::1/128
# eth0             UP             192.168.1.10/24 fe80::5054:ff:fe12:3456/64
```

### `ip route` — Routing

```bash
# Show routing table
ip route show
# default via 192.168.1.1 dev eth0 proto dhcp metric 100
# 192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.10 metric 100
# 10.0.0.0/8 via 192.168.1.254 dev eth0

# Show main routing table
ip route show table main

# Show all routing tables
ip route show table all

# Add default gateway
ip route add default via 192.168.1.1

# Add static route
ip route add 10.0.0.0/8 via 192.168.1.254
ip route add 172.16.0.0/16 via 192.168.1.254 dev eth0

# Add route with specific metric
ip route add 10.0.0.0/8 via 192.168.1.254 metric 200

# Delete route
ip route del 10.0.0.0/8

# Replace (add or update)
ip route replace 10.0.0.0/8 via 192.168.1.253

# Show route to specific destination
ip route get 8.8.8.8
# 8.8.8.8 via 192.168.1.1 dev eth0 src 192.168.1.10 uid 0

# Multi-path routing
ip route add default \
    nexthop via 192.168.1.1 weight 1 \
    nexthop via 192.168.2.1 weight 1

# Policy routing (multiple routing tables)
ip rule add from 192.168.1.0/24 table 100
ip route add default via 192.168.1.1 table 100
ip rule show
# 0:     from all lookup local
# 32764: from 192.168.1.0/24 lookup 100
# 32766: from all lookup main
# 32767: from all lookup default
```

### `ip neigh` — ARP/Neighbor Table

```bash
# Show neighbor (ARP) table
ip neigh show
# 192.168.1.1 dev eth0 lladdr 52:54:00:ff:ff:ff REACHABLE
# 192.168.1.100 dev eth0 lladdr 52:54:00:aa:bb:cc STALE

# Add static ARP entry
ip neigh add 192.168.1.200 lladdr 52:54:00:dd:ee:ff dev eth0

# Delete ARP entry
ip neigh del 192.168.1.200 dev eth0

# Flush ARP cache
ip neigh flush dev eth0

# Neighbor states: PERMANENT, NOARP, REACHABLE, STALE, DELAY, INCOMPLETE, FAILED
```

### Network Namespaces with `ip`

```bash
# Create network namespace
ip netns add testns

# List namespaces
ip netns list

# Run command in namespace
ip netns exec testns ip addr show

# Create veth pair and connect namespaces
ip link add veth0 type veth peer name veth1
ip link set veth1 netns testns

# Configure
ip addr add 10.0.0.1/24 dev veth0
ip link set veth0 up

ip netns exec testns ip addr add 10.0.0.2/24 dev veth1
ip netns exec testns ip link set veth1 up
ip netns exec testns ip link set lo up

# Test
ip netns exec testns ping 10.0.0.1
```

## NetworkManager

NetworkManager is the default network management daemon on most desktop and server distributions (RHEL, Fedora, Ubuntu desktop, etc.).

### `nmcli` — NetworkManager CLI

```bash
# Show connections
nmcli con show
# NAME                UUID                                  TYPE      DEVICE
# Wired connection 1  12345678-abcd-...                     ethernet  eth0
# Wired connection 2  87654321-dcba-...                     ethernet  eth1

# Show active connections
nmcli con show --active

# Show device status
nmcli dev status
# DEVICE  TYPE      STATE      CONNECTION
# eth0    ethernet  connected  Wired connection 1
# eth1    ethernet  disconnected  --
# lo      loopback  unmanaged  --

# Connection details
nmcli con show "Wired connection 1"
```

### Configuring with nmcli

```bash
# === Static IP ===
nmcli con mod "Wired connection 1" \
    ipv4.method manual \
    ipv4.addresses 192.168.1.10/24 \
    ipv4.gateway 192.168.1.1 \
    ipv4.dns "8.8.8.8,8.8.4.4"

# Apply changes
nmcli con up "Wired connection 1"

# === DHCP ===
nmcli con mod "Wired connection 1" \
    ipv4.method auto

# === Create new connection ===
nmcli con add type ethernet \
    con-name "server-net" \
    ifname eth1 \
    ipv4.method manual \
    ipv4.addresses 10.0.0.1/24

# === Modify DNS ===
nmcli con mod "server-net" ipv4.dns "10.0.0.53"
nmcli con mod "server-net" +ipv4.dns "8.8.8.8"  # Add additional

# === Bonding ===
nmcli con add type bond con-name bond0 ifname bond0 \
    bond.options "mode=active-backup,miimon=100"
nmcli con add type ethernet slave-type bond \
    con-name bond0-eth0 ifname eth0 master bond0
nmcli con add type ethernet slave-type bond \
    con-name bond0-eth1 ifname eth1 master bond0
nmcli con mod bond0 ipv4.method manual ipv4.addresses 192.168.1.10/24

# === VLAN ===
nmcli con add type vlan con-name vlan100 ifname eth0.100 \
    dev eth0 id 100 ipv4.method manual ipv4.addresses 10.100.0.1/24

# === WiFi ===
nmcli dev wifi list
nmcli dev wifi connect "SSID" password "password"
nmcli con mod "SSID" wifi-sec.key-mgmt wpa-psk
```

### NetworkManager Connection Files

```bash
# Connection files are stored in:
ls /etc/NetworkManager/system-connections/
# Wired connection 1.nmconnection

# View file
cat /etc/NetworkManager/system-connections/Wired\ connection\ 1.nmconnection
# [connection]
# id=Wired connection 1
# type=ethernet
# interface-name=eth0
#
# [ipv4]
# method=manual
# address1=192.168.1.10/24,192.168.1.1
# dns=8.8.8.8;8.8.4.4;
#
# [ipv6]
# method=auto
```

## systemd-networkd

`systemd-networkd` is a lightweight network management daemon, ideal for servers and containers.

### Configuration Files

```bash
# Network files are in /etc/systemd/network/

# /etc/systemd/network/10-eth0.network
[Match]
Name=eth0

[Network]
DHCP=no
Address=192.168.1.10/24
Gateway=192.168.1.1
DNS=8.8.8.8
DNS=8.8.4.4
Domains=example.com

[Route]
# Additional routes
Destination=10.0.0.0/8
Gateway=192.168.1.254
Metric=200
```

```bash
# /etc/systemd.network/20-eth1.network (DHCP)
[Match]
Name=eth1

[Network]
DHCP=yes

[DHCPv4]
UseDNS=yes
UseNTP=yes
RouteMetric=100
```

```bash
# /etc/systemd.network/30-bridge.netdev (Bridge)
[NetDev]
Name=br0
Kind=bridge

[Bridge]
STP=yes
```

```bash
# /etc/systemd.network/31-bridge.network
[Match]
Name=br0

[Network]
Address=192.168.1.10/24
Gateway=192.168.1.1
DNS=8.8.8.8
```

```bash
# /etc/systemd.network/32-bridge-slave.network
[Match]
Name=eth0

[Network]
Bridge=br0
```

### Managing systemd-networkd

```bash
# Enable and start
systemctl enable --now systemd-networkd

# Check status
systemctl status systemd-networkd
networkctl status
networkctl status eth0

# List links
networkctl list
# IDX LINK  TYPE     OPERATIONAL SETUP
#   1 lo    loopback carrier     unmanaged
#   2 eth0  ether    routable    configured
#   3 eth1  ether    off         unmanaged

# Reload configuration
networkctl reload

# Bring interface up/down
networkctl up eth0
networkctl down eth1
```

## Traditional `/etc/network/interfaces`

The Debian/Ubuntu traditional configuration format:

```bash
# /etc/network/interfaces

# Loopback
auto lo
iface lo inet loopback

# Primary interface (DHCP)
auto eth0
iface eth0 inet dhcp

# Static IP
auto eth1
iface eth1 inet static
    address 192.168.1.10/24
    gateway 192.168.1.1
    dns-nameservers 8.8.8.8 8.8.4.4
    dns-search example.com

# Secondary IP
auto eth1:0
iface eth1:0 inet static
    address 10.0.0.1/24

# Bonding
auto bond0
iface bond0 inet static
    address 192.168.1.10/24
    gateway 192.168.1.1
    bond-slaves eth0 eth1
    bond-mode active-backup
    bond-miimon 100

# Bridge
auto br0
iface br0 inet static
    address 192.168.1.10/24
    gateway 192.168.1.1
    bridge_ports eth0
    bridge_stp on

# VLAN
auto eth0.100
iface eth0.100 inet static
    address 10.100.0.1/24
    vlan-raw-device eth0

# Apply
systemctl restart networking
# Or:
ifup eth1
ifdown eth1
```

## DNS Configuration

```bash
# /etc/resolv.conf (managed by systemd-resolved or NetworkManager)
nameserver 8.8.8.8
nameserver 8.8.4.4
search example.com
options timeout:2 attempts:3

# systemd-resolved
systemctl status systemd-resolved
resolvectl status
resolvectl query example.com
resolvectl statistics

# /etc/hosts (static host entries)
127.0.0.1       localhost
192.168.1.10    myserver.example.com myserver
10.0.0.50       dbserver.example.com dbserver

# /etc/nsswitch.conf (name resolution order)
# hosts: files dns myhostname
```

## Network Configuration Workflow

```mermaid
graph TD
    A["1. Identify interfaces<br/>ip link show"] --> B["2. Choose management tool<br/>nmcli | networkd | /etc/network"]
    B --> C["3. Configure IP<br/>Static or DHCP"]
    C --> D["4. Set gateway/routing<br/>ip route"]
    D --> E["5. Configure DNS<br/>/etc/resolv.conf"]
    E --> F["6. Set hostname<br/>hostnamectl"]
    F --> G["7. Apply & test<br/>ping, curl, ss"]
    G --> H["8. Make persistent<br/>Save config files"]
    
    style A fill:#3182ce,color:#fff
    style C fill:#38a169,color:#fff
    style H fill:#d69e2e,color:#fff
```

## Legacy Tools (Deprecated)

```bash
# These still work but ip/nmcli are preferred:

# ifconfig (replaced by ip addr/link)
ifconfig eth0 192.168.1.10 netmask 255.255.255.0 up
ifconfig eth0

# route (replaced by ip route)
route add default gw 192.168.1.1
route -n

# arp (replaced by ip neigh)
arp -a

# netstat (replaced by ss)
netstat -tunlp
# Modern replacement:
ss -tunlp
```

## References

- [ip(8) man page](https://man7.org/linux/man-pages/man8/ip.8.html) — iproute2 reference
- [nmcli(1) man page](https://man7.org/linux/man-pages/man1/nmcli.1.html) — NetworkManager CLI
- [systemd-networkd(8)](https://www.freedesktop.org/software/systemd/man/latest/systemd-networkd.service.html)
- [interfaces(5) man page](https://man7.org/linux/man-pages/man5/interfaces.5.html) — Debian network config
- [ArchWiki: Network configuration](https://wiki.archlinux.org/title/Network_configuration)
- [iproute2 documentation](https://wiki.linuxfoundation.org/networking/iproute2)

## Related Topics

- [Firewall](./firewall.md) — Network traffic filtering
- [System Administration Overview](./overview.md) — Initial network setup
- [Namespaces](../kernel/processes/namespaces.md) — Network namespace isolation
- [Logging](./logging.md) — Network event logging
