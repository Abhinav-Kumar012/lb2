# Cross-Compilation

## Introduction

Cross-compilation is the process of building software on one computing platform (the **host**) to run on a different platform (the **target**). In Embedded Linux development, this is essential because embedded targets (ARM, MIPS, RISC-V) typically lack the resources to compile their own software, and development workstations (x86_64) are far more powerful for building.

Cross-compilation touches every layer of an embedded system: the bootloader, kernel, libraries, and applications. Understanding toolchains, sysroots, and the various configure/cmake integration patterns is critical for efficient embedded development.

## Host vs Target

```mermaid
graph LR
    subgraph Host (Build Machine)
        HOST_ARCH[x86_64 Linux]
        TOOLCHAIN[Cross Toolchain<br/>aarch64-linux-gnu-gcc]
        SYSROOT[Sysroot<br/>Target libraries & headers]
    end
    subgraph Target (Embedded Device)
        TARGET_ARCH[ARM64 / ARM32 / RISC-V / MIPS]
        BINARY[Cross-compiled Binary]
    end
    HOST_ARCH -->|cross-compile| BINARY
    TOOLCHAIN --> BINARY
    SYSROOT --> TOOLCHAIN
    BINARY -->|deploy| TARGET_ARCH
```

## Toolchain Components

A cross-compilation toolchain consists of:

| Component | Purpose | Example |
|-----------|---------|---------|
| **Binutils** | Assembler, linker, object tools | `aarch64-linux-gnu-ld`, `aarch64-linux-gnu-as` |
| **Compiler** | C/C++ compiler | `aarch64-linux-gnu-gcc`, `aarch64-linux-gnu-g++` |
| **C Library** | Standard library | glibc, musl, uClibc-ng |
| **Debugger** | Remote debugging | `aarch64-linux-gnu-gdb` |
| **Sysroot** | Target headers and libraries | `/opt/sysroot/usr/include/`, `/opt/sysroot/usr/lib/` |

### Toolchain Naming Convention

```
<arch>-<vendor>-<os>-<libc>-<abi>

Examples:
aarch64-linux-gnu-gcc          # ARM64, Linux, glibc, standard ABI
arm-linux-gnueabihf-gcc        # ARM32, Linux, glibc, hard-float
arm-none-eabi-gcc              # ARM32, bare-metal, no OS (for firmware)
riscv64-linux-gnu-gcc          # RISC-V 64, Linux, glibc
mipsel-linux-gnu-gcc           # MIPS little-endian, Linux, glibc
aarch64-buildroot-linux-gnu-gcc # ARM64, Buildroot-built toolchain
```

## Obtaining Toolchains

### Pre-built Toolchains

```bash
# Linaro toolchains (ARM, well-maintained)
# https://developer.arm.com/tools-and-software/open-source-software/developer-tools/gnu-toolchain/downloads
wget https://developer.arm.com/-/media/Files/downloads/gnu/13.2.rel1/binrel/arm-gnu-toolchain-13.2.rel1-x86_64-aarch64-none-linux-gnu.tar.xz
tar xf arm-gnu-toolchain-*.tar.xz
export PATH=$PWD/arm-gnu-toolchain-*/bin:$PATH

# Verify
aarch64-none-linux-gnu-gcc --version
# aarch64-none-linux-gnu-gcc (Arm GNU Toolchain 13.2.rel1) 13.2.1

# Debian/Ubuntu packages
apt install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
apt install gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf
apt install gcc-riscv64-linux-gnu g++-riscv64-linux-gnu

# Verify installation
dpkg -L gcc-aarch64-linux-gnu
# /usr/bin/aarch64-linux-gnu-gcc
# /usr/bin/aarch64-linux-gnu-g++
# /usr/bin/aarch64-linux-gnu-ld
# ...
```

### Building a Toolchain with crosstool-NG

```bash
# crosstool-NG builds custom toolchains
# https://crosstool-ng.github.io/

git clone https://github.com/crosstool-ng/crosstool-ng.git
cd crosstool-ng
./bootstrap && ./configure --prefix=$HOME/ct-ng && make && make install

# Configure toolchain
mkdir ~/ct-build && cd ~/ct-build
ct-ng aarch64-unknown-linux-gnu  # Start with a sample
ct-ng menuconfig
# Options:
#   Operating System → Linux kernel version
#   C library → glibc / musl / uClibc-ng
#   C compiler → GCC version
#   Debug facilities → gdb, strace, ltrace
#   Companion libraries → zlib, expat, etc.

# Build (takes 15-60 minutes)
ct-ng build

# Output in ~/x-tools/aarch64-unknown-linux-gnu/
ls ~/x-tools/aarch64-unknown-linux-gnu/bin/
# aarch64-unknown-linux-gnu-gcc
# aarch64-unknown-linux-gnu-g++
# aarch64-unknown-linux-gnu-ld
# ...
```

### Building with Buildroot

```bash
# Buildroot can build a complete toolchain
make menuconfig
# Toolchain →
#   Toolchain type → Buildroot toolchain
#   C library → musl / glibc / uClibc-ng
#   GCC compiler version → 13.x
#   Enable C++ support
#   Enable Fortran support (if needed)

make toolchain
# Output: output/host/bin/aarch64-linux-gnu-gcc
```

## Sysroot

The sysroot is a directory containing the target system's headers and libraries. It provides the environment that the cross-compiler needs to find target libraries and headers.

```bash
# Typical sysroot structure
/opt/sysroot/
├── etc/
│   └── ld.so.conf
├── lib/
│   ├── libc.so.6
│   ├── libm.so.6
│   ├── libpthread.so.0
│   └── ld-linux-aarch64.so.1
├── usr/
│   ├── include/
│   │   ├── stdio.h
│   │   ├── linux/
│   │   │   ├── kernel.h
│   │   │   └── ...
│   │   └── openssl/
│   │       └── ssl.h
│   ├── lib/
│   │   ├── libssl.so
│   │   ├── libcrypto.so
│   │   └── pkgconfig/
│   └── share/
│       └── pkgconfig/
└── opt/
    └── vendor/
        └── lib/
```

### Using Sysroot with GCC

```bash
# Specify sysroot
aarch64-linux-gnu-gcc --sysroot=/opt/sysroot -o hello hello.c

# The compiler will look for:
# Headers: /opt/sysroot/usr/include/
# Libraries: /opt/sysroot/usr/lib/
# Dynamic linker: /opt/sysroot/lib/ld-linux-aarch64.so.1

# Check default sysroot of toolchain
aarch64-linux-gnu-gcc -print-sysroot
# (empty if no default sysroot configured)

# Set default sysroot when building toolchain
# In crosstool-NG: Paths and misc options → Prefix directory
# In Buildroot: output/host/aarch64-buildroot-linux-gnu/sysroot/
```

### Creating a Sysroot from a Target System

```bash
# Copy libraries and headers from a running target
rsync -avz --include='*.so*' --include='*.h' \
  --exclude='*' \
  target:/usr/lib/ /opt/sysroot/usr/lib/
rsync -avz target:/usr/include/ /opt/sysroot/usr/include/

# Or use the target's root filesystem as sysroot
# (common with Buildroot/Yocto)
export SYSROOT=/path/to/buildroot/output/host/aarch64-buildroot-linux-gnu/sysroot
aarch64-linux-gnu-gcc --sysroot=$SYSROOT -o app app.c
```

## Cross-Compiling Applications

### Simple C Program

```bash
# hello.c
#include <stdio.h>
int main() {
    printf("Hello from ARM64!\n");
    return 0;
}

# Cross-compile
aarch64-linux-gnu-gcc -o hello hello.c -static
# -static links all libraries into the binary (no runtime dependencies)

file hello
# hello: ELF 64-bit LSB executable, ARM aarch64, version 1 (GNU/Linux),
#         statically linked, for GNU/Linux 3.7.0, not stripped

# Dynamic linking (needs sysroot with shared libraries)
aarch64-linux-gnu-gcc -o hello hello.c
# Needs ld-linux-aarch64.so.1 and libc.so.6 at runtime

# Verify dependencies
aarch64-linux-gnu-readelf -d hello | grep NEEDED
# 0x00000001 (NEEDED) Shared library: [libc.so.6]
```

### Autotools Projects

```bash
# Many open-source projects use autotools (./configure && make)

# Create a cross-compilation config file
cat > aarch64-linux-gnu.txt << 'EOF'
[host_machine]
system = 'linux'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'

[binaries]
c = 'aarch64-linux-gnu-gcc'
cpp = 'aarch64-linux-gnu-g++'
ar = 'aarch64-linux-gnu-ar'
strip = 'aarch64-linux-gnu-strip'
pkgconfig = 'pkg-config'

[built-in options]
c_args = ['--sysroot=/opt/sysroot']
c_link_args = ['--sysroot=/opt/sysroot']
EOF

# Autotools cross-compilation
./configure \
  --host=aarch64-linux-gnu \
  --build=x86_64-linux-gnu \
  --prefix=/usr \
  --with-sysroot=/opt/sysroot \
  CC=aarch64-linux-gnu-gcc \
  CXX=aarch64-linux-gnu-g++ \
  CFLAGS="--sysroot=/opt/sysroot" \
  LDFLAGS="--sysroot=/opt/sysroot"

make -j$(nproc)
make install DESTDIR=/opt/output
```

### CMake Projects

```bash
# CMake toolchain file
cat > aarch64-toolchain.cmake << 'EOF'
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)

set(CMAKE_SYSROOT /opt/sysroot)
set(CMAKE_STAGING_PREFIX /opt/output/usr)

set(CMAKE_C_COMPILER aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)

set(CMAKE_FIND_ROOT_PATH /opt/sysroot)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
EOF

# Build with CMake
mkdir build && cd build
cmake -DCMAKE_TOOLCHAIN_FILE=../aarch64-toolchain.cmake ..
make -j$(nproc)
make install DESTDIR=/opt/output
```

### Meson Projects

```bash
# Meson cross file
cat > aarch64-cross.ini << 'EOF'
[host_machine]
system = 'linux'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'

[binaries]
c = 'aarch64-linux-gnu-gcc'
cpp = 'aarch64-linux-gnu-g++'
ar = 'aarch64-linux-gnu-ar'
strip = 'aarch64-linux-gnu-strip'
pkgconfig = 'pkg-config'

[built-in options]
c_args = ['--sysroot=/opt/sysroot']
c_link_args = ['--sysroot=/opt/sysroot']

[properties]
sys_root = '/opt/sysroot'
pkg_config_libdir = '/opt/sysroot/usr/lib/pkgconfig'
EOF

# Build with Meson
meson setup --cross-file aarch64-cross.ini builddir/
meson compile -C builddir/
meson install -C builddir/ --destdir=/opt/output
```

### pkg-config Integration

```bash
# pkg-config needs to find target .pc files, not host ones
export PKG_CONFIG_PATH=/opt/sysroot/usr/lib/pkgconfig:/opt/sysroot/usr/share/pkgconfig
export PKG_CONFIG_SYSROOT_DIR=/opt/sysroot
export PKG_CONFIG_LIBDIR=/opt/sysroot/usr/lib/pkgconfig

# Or use a wrapper script
cat > /usr/local/bin/aarch64-pkg-config << 'EOF'
#!/bin/bash
export PKG_CONFIG_PATH=/opt/sysroot/usr/lib/pkgconfig
export PKG_CONFIG_SYSROOT_DIR=/opt/sysroot
exec pkg-config "$@"
EOF
chmod +x /usr/local/bin/aarch64-pkg-config
```

## Cross-Compiling the Linux Kernel

```bash
# Download kernel source
git clone --depth=1 https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git
cd linux

# Configure for target
# Use a defconfig as starting point
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- defconfig

# Customize
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- menuconfig

# Build kernel image
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- Image -j$(nproc)
# Output: arch/arm64/boot/Image

# Build compressed image (ARM)
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- Image.gz -j$(nproc)

# Build device tree blobs
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- dtbs -j$(nproc)

# Build kernel modules
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- modules -j$(nproc)

# Install modules to sysroot
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- \
  INSTALL_MOD_PATH=/opt/output modules_install
```

See [U-Boot](./uboot.md) for kernel booting and [Device Tree](./device-tree.md) for hardware description.

## Cross-Compiling U-Boot

```bash
# Download U-Boot source
git clone https://source.denx.de/u-boot/u-boot.git
cd u-boot

# Configure for target board
make CROSS_COMPILE=aarch64-linux-gnu- rpi_4_defconfig

# Customize
make CROSS_COMPILE=aarch64-linux-gnu- menuconfig

# Build
make CROSS_COMPILE=aarch64-linux-gnu- -j$(nproc)
# Output: u-boot.bin, u-boot.img, u-boot.srec
```

## Common Cross-Compilation Issues

### Library Not Found

```bash
# Error: /usr/bin/ld: cannot find -lssl
# Solution: Ensure library is in sysroot
ls /opt/sysroot/usr/lib/libssl*
# If missing, cross-compile the library first

# Cross-compile OpenSSL
cd openssl
./Configure linux-aarch64 \
  --prefix=/opt/sysroot/usr \
  --openssldir=/opt/sysroot/usr/ssl \
  --cross-compile-prefix=aarch64-linux-gnu-
make -j$(nproc)
make install DESTDIR=/opt/sysroot
```

### Wrong Headers

```bash
# Error: fatal error: linux/spi/spidev.h: No such file or directory
# Solution: Install kernel headers in sysroot

cd linux
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- \
  INSTALL_HDR_PATH=/opt/sysroot/usr headers_install
```

### Endianness Issues

```bash
# Cross-compiling for big-endian ARM
aarch64_be-linux-gnu-gcc -o hello hello.c
# Verify
file hello
# hello: ELF 64-bit MSB executable, ARM aarch64...

# QEMU testing
qemu-aarch64_be ./hello
```

### Linker Script Issues

```bash
# Some projects have hardcoded paths
# Solution: Use sed to fix paths or set environment variables
export CC="aarch64-linux-gnu-gcc --sysroot=/opt/sysroot"
export LD="aarch64-linux-gnu-ld --sysroot=/opt/sysroot"
```

## Distributed Cross-Compilation

```bash
# distcc — distributed compilation
# Install distcc on build nodes
apt install distcc

# Set up distcc
export DISTCC_HOSTS="localhost/4 buildserver1/8 buildserver2/8"
export CC="distcc aarch64-linux-gnu-gcc"

# Use with make
make -j32 CC="distcc aarch64-linux-gnu-gcc"

# IceCream (openSUSE build system)
# Similar concept with automatic load balancing
```

## Testing Cross-Compiled Binaries

```bash
# 1. QEMU user-mode emulation
qemu-aarch64 -L /opt/sysroot ./hello
# Or register binfmt_misc for transparent execution

# 2. QEMU system emulation
qemu-system-aarch64 -machine virt -cpu cortex-a72 -m 1024 \
  -kernel Image -dtb virt.dtb \
  -drive file=rootfs.ext4,if=virtio \
  -append "root=/dev/vda console=ttyAMA0" \
  -nographic

# 3. Deploy to target hardware
scp hello target:/tmp/
ssh target /tmp/hello

# 4. Run with strace (on target)
strace ./hello
```

## References

1. GCC Cross-Compiler Documentation. [https://gcc.gnu.org/onlinedocs/gccint/Cross_002dCompilation.html](https://gcc.gnu.org/onlinedocs/gccint/Cross_002dCompilation.html)
2. crosstool-NG Documentation. [https://crosstool-ng.github.io/docs/](https://crosstool-ng.github.io/docs/)
3. Bootlin Toolchains. [https://toolchains.bootlin.com/](https://toolchains.bootlin.com/)
4. Yocto Project SDK Manual. [https://docs.yoctoproject.org/sdk-manual/](https://docs.yoctoproject.org/sdk-manual/)

## Further Reading

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [LWN.net - Linux and free software news](https://lwn.net/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- [crosstool-NG](https://crosstool-ng.github.io/)
- [Bootlin Pre-built Toolchains](https://toolchains.bootlin.com/)
- [ARM GNU Toolchain Downloads](https://developer.arm.com/tools-and-software/open-source-software/developer-tools/gnu-toolchain/downloads)
- [Buildroot Cross-Compilation](https://buildroot.org/downloads/manual/manual.html#_cross_compilation_toolchain)
- [Meson Cross Compilation](https://mesonbuild.com/Cross-compilation.html)

## Related Topics

- [Embedded Linux Overview](./overview.md) — Embedded Linux fundamentals
- [U-Boot](./uboot.md) — Bootloader cross-compilation
- [Device Tree](./device-tree.md) — Hardware description
- [ARM Architecture](./arm.md) — ARM-specific details
