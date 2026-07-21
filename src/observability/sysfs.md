# sysfs for Observability

## Introduction

sysfs (`/sys`) is a virtual filesystem that exports kernel data structures, their attributes, and the linkages between them to userspace. Unlike `/proc`, which focuses on process and system statistics, `/sys` exposes the **device model**—hardware devices, buses, drivers, and their configuration.

sysfs is essential for hardware observability: understanding what devices are present, how they're configured, and what state they're in.

## sysfs Structure

```bash
ls /sys/
# block/  bus/  class/  dev/  devices/  firmware/  fs/  kernel/  module/  power/
```

### Top-Level Directories

| Directory | Purpose |
|-----------|---------|
| `/sys/block/` | Block devices (disks, partitions) |
| `/sys/bus/` | Bus types (PCI, USB, SCSI) |
| `/sys/class/` | Device classes (net, block, tty) |
| `/sys/devices/` | Device tree (physical hierarchy) |
| `/sys/firmware/` | Firmware interfaces (ACPI, DMI) |
| `/sys/fs/` | Filesystem information |
| `/sys/kernel/` | Kernel configuration |
| `/sys/module/` | Loaded kernel modules |
| `/sys/power/` | Power management |

## /sys/devices: Device Tree

The `/sys/devices/` directory mirrors the physical hardware hierarchy:

```bash
# Physical device tree
ls /sys/devices/
# LNXSYSTM:00  pci0000:00  platform  pnp0  system  virtual

# PCI devices
ls /sys/devices/pci0000:00/
# 0000:00:00.0  0000:00:01.0  0000:00:02.0  0000:00:14.0  0000:00:16.0
# 0000:00:17.0  0000:00:1f.2  ...

# Specific PCI device
ls /sys/devices/pci0000:00/0000:00:17.0/
# ata1  ata2  ata3  ata4  class  config  device  driver  enable
# irq   local_cpulist  local_cpus  msix_bus  msix_irqs  numa_node
# power/  resource  resource0  subsystem  subsystem_device  subsystem_vendor
# uevent  vendor

# Device class and vendor
cat /sys/devices/pci0000:00/0000:00:17.0/class
# 0x010601  (SATA controller)
cat /sys/devices/pci0000:00/0000:00:17.0/vendor
# 0x8086  (Intel)
cat /sys/devices/pci0000:00/0000:00:17.0/device
# 0xa282
```

### NVMe Device Tree

```bash
# NVMe device path
ls /sys/devices/pci0000:40/0000:40:01.1/0000:41:00.0/
# address  class  config  device  driver  enable  firmware_node
# iommu/  iommu_group/  nvme  power/  resource  resource0  subsystem
# subsystem_device  subsystem_vendor  uevent  vendor

# NVMe controller
ls /sys/devices/pci0000:40/0000:40:01.1/0000:41:00.0/nvme/nvme0/
# address  cntlid  firmware_rev  hwmoni  model  ng0  serial
# state  subsystem  transport  uevent

cat /sys/devices/pci0000:40/0000:40:01.1/0000:41:00.0/nvme/nvme0/model
# Samsung SSD 970 EVO Plus 2TB

cat /sys/devices/pci0000:40/0000:40:01.1/0000:41:00.0/nvme/nvme0/state
# live
```

## /sys/class: Device Classes

`/sys/class/` provides a class-based view of devices (easier to navigate than the physical tree):

```bash
# Network interfaces
ls /sys/class/net/
# eth0  eth1  lo

# Block devices
ls /sys/class/block/
# loop0  loop1  nvme0n1  nvme0n1p1  sda  sda1  sda2

# SCSI devices
ls /sys/class/scsi_device/
# 0:0:0:0  0:0:1:0  1:0:0:0

# TTY devices
ls /sys/class/tty/
# console  tty0  tty1  ...  ttyS0  ttyS1  pts/  ptmx

# USB devices
ls /sys/class/usb/
# usb0  usb1  usb2

# Power supply
ls /sys/class/power_supply/
# AC0  BAT0

# Thermal zones
ls /sys/class/thermal/
# cooling_device0  thermal_zone0  thermal_zone1
```

### Network Device Information

```bash
# Network device details
ls /sys/class/net/eth0/
# addr_assign_type  carrier  device  duplex  flags  ifindex
# iflink  link_mode  mtu  name_assign_type  operstate  power/
# queues/  speed  statistics/  subsystem  tx_queue_len  type  uevent

# Link state
cat /sys/class/net/eth0/operstate
# up

# Speed (Mbps)
cat /sys/class/net/eth0/speed
# 10000

# Duplex
cat /sys/class/net/eth0/duplex
# full

# MTU
cat /sys/class/net/eth0/mtu
# 1500

# MAC address
cat /sys/class/net/eth0/address
# 00:11:22:33:44:55

# Statistics
ls /sys/class/net/eth0/statistics/
# collisions  multicast  rx_bytes  rx_compressed  rx_crc_errors
# rx_dropped  rx_errors  rx_fifo_errors  rx_frame_errors  rx_length_errors
# rx_missed_errors  rx_nohandler  rx_over_errors  rx_packets
# tx_aborted_errors  tx_bytes  tx_carrier_errors  tx_compressed
# tx_dropped  tx_errors  tx_fifo_errors  tx_heartbeat_errors
# tx_packets  tx_window_errors

cat /sys/class/net/eth0/statistics/rx_bytes
# 12345678901
cat /sys/class/net/eth0/statistics/rx_dropped
# 1234
```

### Block Device Information

```bash
# Block device details
ls /sys/block/sda/
# alignment_offset  bdi  capability  dev  device  discard_alignment
# events  events_async  events_poll_msecs  ext_range  hidden  holders
# inflight  integrity  mq  partitions  queue  range  removable  ro
# size  slaves  stat  subsystem  uevent

# Device size (sectors)
cat /sys/block/sda/size
# 976773168

# Queue parameters
ls /sys/block/sda/queue/
# add_random  discard_max_bytes  hw_sector_size  max_hw_sectors_kb
# max_sectors_kb  max_segment_size  max_segments  minimum_io_size
# nomerges  nr_requests  optimal_io_size  physical_block_size
# read_ahead_kb  rotational  scheduler  write_cache  write_same_max_bytes

# I/O scheduler
cat /sys/block/sda/queue/scheduler
# [mq-deadline] kyber bfq none

# Rotational (0 = SSD, 1 = HDD)
cat /sys/block/sda/queue/rotational
# 0

# Sector sizes
cat /sys/block/sda/queue/logical_block_size
# 512
cat /sys/block/sda/queue/physical_block_size
# 512

# Queue depth
cat /sys/block/sda/queue/nr_requests
# 256
```

## /sys/bus: Bus Information

```bash
# Available bus types
ls /sys/bus/
# acpi  container  cpu  edac  event_source  generic  hdaudio
# i2c  isa  machinecheck  mce  mdio_bus  media  memory
# mmc  node  nvme  pci  pcmcia  platform  scsi  serio  usb  virtio

# PCI devices
lspci | head -10
# 00:00.0 Host bridge: Intel Corporation Xeon E3-1200 v5/E3-1500 v5/6th Gen Core ...
# 00:01.0 PCI bridge: Intel Corporation Xeon E3-1200 v5/E3-1500 v5/6th Gen Core ...
# 00:14.0 USB controller: Intel Corporation 100 Series/C230 Series Chipset Family USB 3.0

# SCSI devices
ls /sys/bus/scsi/devices/
# 0:0:0:0  0:0:1:0  1:0:0:0

# USB devices
lsusb
# Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub
# Bus 001 Device 002: ID 046d:c077 Logitech, Inc. M105 Optical Mouse
```

## uevent Files

Every device in sysfs has a `uevent` file that contains device attributes:

```bash
# View device uevent
cat /sys/block/sda/uevent
# MAJOR=8
# MINOR=0
# DEVNAME=sda
# DEVTYPE=disk

# View NVMe uevent
cat /sys/class/nvme/nvme0/uevent
# MAJOR=10
# MINOR=154
# DEVNAME=nvme0

# Trigger uevent (re-add device)
echo add > /sys/block/sda/uevent
```

## Power Management

```bash
# Device power state
cat /sys/devices/pci0000:00/0000:00:17.0/power/runtime_status
# active

cat /sys/devices/pci0000:00/0000:00:17.0/power/control
# auto  (or "on" to prevent runtime PM)

# CPU frequency
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
# performance

cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq
# 2500000  (kHz)

# CPU idle states
cat /sys/devices/system/cpu/cpu0/cpuidle/state0/name
# POLL
cat /sys/devices/system/cpu/cpu0/cpuidle/state0/usage
# 1234567

# Thermal zones
cat /sys/class/thermal/thermal_zone0/temp
# 42000  (millidegrees Celsius = 42°C)

cat /sys/class/thermal/thermal_zone0/type
# acpitz
```

## Kernel Module Information

```bash
# List loaded modules via sysfs
ls /sys/module/
# ahci  btrfs  dm_crypt  ext4  kvm  nvme  xfs  ...

# Module parameters
ls /sys/module/nvme_core/parameters/
# default_ps_max_latency_us  io_timeout  max_retries  multipath

cat /sys/module/nvme_core/parameters/default_ps_max_latency_us
# 100000

# Module information
cat /sys/module/nvme_core/version
# 1.0
```

## /sys/fs: Filesystem Information

```bash
# cgroup information
ls /sys/fs/cgroup/
# blkio  cpu,cpuacct  cpuset  devices  freezer  memory  net_cls,net_prio  pids

# ext4 filesystem features
cat /sys/fs/ext4/sda1/options
# has_journal ...

# FUSE connections
ls /sys/fs/fuse/connections/
```

## Practical Examples

### Hardware Inventory Script

```bash
#!/bin/bash
echo "=== CPU ==="
lscpu | grep -E "Model name|CPU\(s\)|Thread|Core|Socket"

echo "=== Memory ==="
free -h | head -2

echo "=== Disks ==="
for disk in /sys/block/sd* /sys/block/nvme*; do
    [ -d "$disk" ] || continue
    name=$(basename $disk)
    size=$(cat $disk/size 2>/dev/null)
    rotational=$(cat $disk/queue/rotational 2>/dev/null)
    echo "$name: $(( size * 512 / 1073741824 )) GB (rotational=$rotational)"
done

echo "=== Network ==="
for iface in /sys/class/net/*; do
    [ -d "$iface" ] || continue
    name=$(basename $iface)
    [ "$name" = "lo" ] && continue
    speed=$(cat $iface/speed 2>/dev/null || echo "N/A")
    state=$(cat $iface/operstate 2>/dev/null)
    echo "$name: ${speed}Mbps ($state)"
done
```

## References

- [sysfs Documentation](https://www.kernel.org/doc/html/latest/filesystems/sysfs.html)
- [Linux Device Model](https://www.kernel.org/doc/html/latest/driver-api/driver-model/)
- [udev Documentation](https://www.kernel.org/doc/html/latest/admin-guide/udev.html)

## Further Reading

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [LWN.net - Linux and free software news](https://lwn.net/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- <https://www.kernel.org/doc/html/latest/filesystems/sysfs.html> - sysfs kernel documentation
- <https://www.kernel.org/doc/html/latest/driver-api/> - Driver API documentation
- <https://man7.org/linux/man-pages/man5/sysfs.5.html> - sysfs(5)

## Related Topics

- [Observability Overview](overview.md)
- [proc Filesystem](proc.md)
- [BPF and bpftrace](bpf-bpftrace.md)
