# io_uring for Block I/O

## Introduction

`io_uring` is Linux's high-performance asynchronous I/O interface, introduced in
Linux 5.1 by Jens Axboe. While originally focused on file and network I/O, io_uring
has expanded to support block device operations with significant performance advantages
over traditional `read()`/`write()` and even legacy AIO. This page covers io_uring's
block I/O capabilities, including registered buffers, fixed files, and poll-mode
completion.

## Architecture Overview

```mermaid
graph TD
    A[User Space Application] --> B[Submission Queue - SQ]
    B --> C[io_uring Kernel Side]
    C --> D[Block I/O Layer]
    D --> E[Device Driver]
    E --> F[Completion Queue - CQ]
    F --> A

    subgraph "Shared Memory (no syscall)"
        B
        F
    end

    subgraph "Kernel"
        C
        D
        E
    end
```

io_uring uses two ring buffers shared between user space and kernel:

- **Submission Queue (SQ)**: User space posts I/O requests
- **Completion Queue (CQ)**: Kernel posts completion events

The key innovation: **no system calls** are needed for submitting and reaping I/O
when using the ring in polling mode.

## Core Concepts

### Submission Queue Entry (SQE)

Each I/O request is described by a `struct io_uring_sqe`:

```c
struct io_uring_sqe {
    __u8  opcode;          /* I/O operation type */
    __u8  flags;           /* SQE flags */
    __u16 ioprio;          /* I/O priority */
    __s32 fd;              /* File descriptor */
    __u64 off;             /* Offset into file/device */
    __u64 addr;            /* Buffer address */
    __u32 len;             /* Buffer length */
    __u64 user_data;       /* User-provided identifier */
    __u16 buf_index;       /* Registered buffer index */
    /* ... additional fields for advanced operations */
};
```

### Completion Queue Entry (CQE)

```c
struct io_uring_cqe {
    __u64 user_data;    /* Matches SQE user_data */
    __s32 res;          /* Result (bytes read/written or error) */
    __u32 flags;        /* CQE flags */
};
```

### Opcodes for Block I/O

| Opcode | Description |
|--------|-------------|
| `IORING_OP_READ` | Read from fd |
| `IORING_OP_WRITE` | Write to fd |
| `IORING_OP_READ_FIXED` | Read using registered buffer |
| `IORING_OP_WRITE_FIXED` | Write using registered buffer |
| `IORING_OP_FSYNC` | Sync file data |
| `IORING_OP_FALLOCATE` | Pre-allocate space |
| `IORING_OP_READV` | Vectored read (scatter-gather) |
| `IORING_OP_WRITEV` | Vectored write |

## Basic Block I/O with io_uring

### Setup

```c
#include <liburing.h>
#include <fcntl.h>
#include <stdio.h>

#define QUEUE_DEPTH 256

int main(void)
{
    struct io_uring ring;
    int ret;

    /* Initialize io_uring instance */
    ret = io_uring_queue_init(QUEUE_DEPTH, &ring, 0);
    if (ret < 0) {
        fprintf(stderr, "io_uring_queue_init: %s\n", strerror(-ret));
        return 1;
    }

    /* Open a block device */
    int fd = open("/dev/sda", O_RDWR | O_DIRECT);
    if (fd < 0) {
        perror("open");
        return 1;
    }

    /* ... submit I/O operations ... */

    io_uring_queue_exit(&ring);
    close(fd);
    return 0;
}
```

### Submitting a Read

```c
void submit_read(struct io_uring *ring, int fd, void *buf,
                 size_t count, off_t offset)
{
    struct io_uring_sqe *sqe;

    /* Get a submission queue entry */
    sqe = io_uring_get_sqe(ring);

    /* Prepare a read operation */
    io_uring_prep_read(sqe, fd, buf, count, offset);

    /* Set user_data for identifying the completion */
    sqe->user_data = (uint64_t)buf;

    /* Submit the SQE to the kernel */
    io_uring_submit(ring);
}
```

### Reaping Completions

```c
void reap_completions(struct io_uring *ring)
{
    struct io_uring_cqe *cqe;
    int ret;

    /* Wait for at least one completion */
    ret = io_uring_wait_cqe(ring, &cqe);
    if (ret < 0) {
        fprintf(stderr, "io_uring_wait_cqe: %s\n", strerror(-ret));
        return;
    }

    /* Check result */
    if (cqe->res < 0) {
        fprintf(stderr, "I/O error: %s\n", strerror(-cqe->res));
    } else {
        printf("Read %d bytes from buffer %p\n", cqe->res,
               (void *)cqe->user_data);
    }

    /* Mark CQE as consumed */
    io_uring_cqe_seen(ring, cqe);
}
```

## Registered Buffers

For high-throughput block I/O, registering buffers avoids per-I/O kernel page pinning:

```c
int register_buffers(struct io_uring *ring)
{
    #define NUM_BUFFERS 64
    #define BUFFER_SIZE (4096 * 256)  /* 1 MB per buffer */

    struct iovec iovecs[NUM_BUFFERS];
    void *buffers[NUM_BUFFERS];

    /* Allocate aligned buffers (required for O_DIRECT) */
    for (int i = 0; i < NUM_BUFFERS; i++) {
        if (posix_memalign(&buffers[i], 4096, BUFFER_SIZE)) {
            perror("posix_memalign");
            return -1;
        }
        iovecs[i].iov_base = buffers[i];
        iovecs[i].iov_len = BUFFER_SIZE;
    }

    /* Register buffers with io_uring */
    int ret = io_uring_register_buffers(ring, iovecs, NUM_BUFFERS);
    if (ret) {
        fprintf(stderr, "io_uring_register_buffers: %s\n", strerror(-ret));
        return -1;
    }

    return 0;
}
```

### Using Registered Buffers

```c
void submit_read_registered(struct io_uring *ring, int fd,
                            int buf_index, size_t count, off_t offset)
{
    struct io_uring_sqe *sqe = io_uring_get_sqe(ring);

    /* Use io_uring_prep_read_fixed for registered buffers */
    io_uring_prep_read_fixed(sqe, fd, NULL, count, offset, buf_index);

    sqe->flags |= IOSQE_FIXED_FILE;
    sqe->user_data = buf_index;

    io_uring_submit(ring);
}
```

### Benefits of Registered Buffers

```mermaid
graph LR
    A[Without Registration] --> B[Pin pages each I/O]
    B --> C[Page table walks]
    C --> D[TLB flushes]
    D --> E[Higher latency]

    F[With Registration] --> G[Pin pages once]
    G --> H[Reuse pinned pages]
    H --> I[Skip page pinning]
    I --> J[Lower latency]
```

## Fixed Files

Similar to registered buffers, registering file descriptors avoids repeated
file lookup overhead:

```c
int register_files(struct io_uring *ring, int *fds, int nr_fds)
{
    int ret = io_uring_register_files(ring, fds, nr_fds);
    if (ret) {
        fprintf(stderr, "io_uring_register_files: %s\n", strerror(-ret));
        return -1;
    }
    return 0;
}

/* Submit using fixed file (fd = index into registered array) */
void submit_with_fixed_file(struct io_uring *ring, int file_index,
                            void *buf, size_t len, off_t offset)
{
    struct io_uring_sqe *sqe = io_uring_get_sqe(ring);

    io_uring_prep_read(sqe, file_index, buf, len, offset);
    sqe->flags |= IOSQE_FIXED_FILE;

    io_uring_submit(ring);
}
```

### File Update

```c
/* Update a registered file descriptor (atomic swap) */
int update_registered_file(struct io_uring *ring, int index, int new_fd)
{
    return io_uring_register_files_update(ring, index, &new_fd, 1);
}
```

## Poll Mode (IORING_SETUP_SQPOLL)

For ultra-low latency, io_uring can poll the submission queue from a kernel thread,
eliminating the `io_uring_enter()` system call entirely:

```c
struct io_uring_params params = {};
struct io_uring ring;

/* Enable SQ polling */
params.flags = IORING_SETUP_SQPOLL;

/* Set how long the kernel thread waits before sleeping (ms) */
params.sq_thread_idle = 2000;

int ret = io_uring_queue_init_params(QUEUE_DEPTH, &ring, &params);
if (ret < 0) {
    fprintf(stderr, "Failed to setup io_uring with SQPOLL\n");
    return -1;
}
```

### Poll Mode Operation

```mermaid
sequenceDiagram
    participant App as Application
    participant SQ as SQ Ring (shared)
    participant KT as Kernel Thread
    participant Bio as Block I/O

    App->>SQ: Write SQE (no syscall!)
    Note over KT: Polling SQ for new entries
    KT->>SQ: Detect new SQE
    KT->>Bio: Submit block I/O
    Bio-->>KT: I/O complete
    KT->>SQ: Write CQE
    App->>SQ: Read CQE (no syscall!)
```

### When Kernel Thread Sleeps

If the SQ is empty for `sq_thread_idle` milliseconds, the kernel thread goes to sleep.
The next submission must use `io_uring_enter()` to wake it:

```c
/* Check if kernel thread is running */
if (IO_URING_READ_ONCE(*ring->sq.kflags) & IORING_SQ_NEED_WAKEUP) {
    /* Must wake the kernel thread */
    io_uring_enter(ring->ring_fd, 0, 0, IORING_ENTER_SQ_WAIT);
}
```

## Fixed Ring Buffers (IORING_SETUP_NO_MMAP)

Linux 6.7+ allows the kernel to allocate the ring buffers, avoiding an mmap call:

```c
struct io_uring_params params = {};
params.flags = IORING_SETUP_NO_MMAP;

io_uring_queue_init_params(depth, &ring, &params);
/* Ring buffers are kernel-allocated */
```

## Direct Descriptors (IORING_FILE_INDEX_ALLOC)

Instead of using file descriptors directly, io_uring can manage its own descriptor table:

```c
/* Open a file directly into io_uring's table */
struct io_uring_sqe *sqe = io_uring_get_sqe(ring);
io_uring_prep_openat(sqe, AT_FDCWD, "/dev/sda", O_RDWR | O_DIRECT, 0);
sqe->file_index = IORING_FILE_INDEX_ALLOC;
io_uring_submit(ring);
/* Result is the io_uring descriptor index */
```

## Batch Operations

For maximum throughput, submit multiple operations in a single call:

```c
void submit_batch(struct io_uring *ring, int fd, struct batch_io *ios, int count)
{
    for (int i = 0; i < count; i++) {
        struct io_uring_sqe *sqe = io_uring_get_sqe(ring);

        if (ios[i].is_read)
            io_uring_prep_read(sqe, fd, ios[i].buf, ios[i].len, ios[i].offset);
        else
            io_uring_prep_write(sqe, fd, ios[i].buf, ios[i].len, ios[i].offset);

        sqe->user_data = i;
    }

    /* Submit all at once - single syscall */
    io_uring_submit(ring);
}
```

## Chain Operations (IOSQE_IO_LINK)

Chain dependent operations so they execute in sequence:

```c
void chain_read_write(struct io_uring *ring, int src_fd, int dst_fd,
                      void *buf, size_t len, off_t offset)
{
    struct io_uring_sqe *sqe;

    /* First: read from source */
    sqe = io_uring_get_sqe(ring);
    io_uring_prep_read(sqe, src_fd, buf, len, offset);
    sqe->flags |= IOSQE_IO_LINK;  /* Link to next */
    sqe->user_data = 1;

    /* Second: write to destination (runs after read completes) */
    sqe = io_uring_get_sqe(ring);
    io_uring_prep_write(sqe, dst_fd, buf, len, offset);
    sqe->user_data = 2;

    io_uring_submit(ring);
}
```

## Performance Comparison

### Throughput (4K Random Read, NVMe SSD)

| Method | IOPS | Syscalls per I/O |
|--------|------|------------------|
| `pread()` | ~200K | 1 |
| Linux AIO | ~500K | 0.5 |
| io_uring (basic) | ~700K | 0.5 |
| io_uring (SQPOLL) | ~900K | 0 |
| io_uring (registered bufs + SQPOLL) | ~1M+ | 0 |

### Latency (4K Random Read)

| Method | p50 Latency | p99 Latency |
|--------|-------------|-------------|
| `pread()` | 4 µs | 15 µs |
| io_uring | 2 µs | 8 µs |
| io_uring (SQPOLL) | 1.5 µs | 5 µs |

## liburing API Summary

```c
/* Initialization */
int io_uring_queue_init(unsigned entries, struct io_uring *ring, unsigned flags);
int io_uring_queue_init_params(unsigned entries, struct io_uring *ring,
                                struct io_uring_params *p);
void io_uring_queue_exit(struct io_uring *ring);

/* Registration */
int io_uring_register_buffers(struct io_uring *ring, const struct iovec *iovecs,
                               unsigned nr_iovecs);
int io_uring_register_files(struct io_uring *ring, const int *files,
                             unsigned nr_files);
int io_uring_unregister_buffers(struct io_uring *ring);
int io_uring_unregister_files(struct io_uring *ring);

/* Submission */
struct io_uring_sqe *io_uring_get_sqe(struct io_uring *ring);
int io_uring_submit(struct io_uring *ring);
int io_uring_submit_and_wait(struct io_uring *ring, unsigned wait_nr);

/* Completion */
int io_uring_peek_cqe(struct io_uring *ring, struct io_uring_cqe **cqe_ptr);
int io_uring_wait_cqe(struct io_uring *ring, struct io_uring_cqe **cqe_ptr);
void io_uring_cqe_seen(struct io_uring *ring, struct io_uring_cqe *cqe);
```

## Kernel Configuration

```
CONFIG_IO_URING=y
```

## Cross-References

- [io_uring Overview](../../sysprog/io-uring.md) - General io_uring programming
- [Block I/O Overview](overview.md) - Block subsystem architecture
- [BIO Structure](bio.md) - Block I/O request representation
- [I/O Schedulers](io-schedulers.md) - Request scheduling
- [Device Mapper](device-mapper.md) - Block device mapping
- [AIO (Async I/O)](../../sysprog/aio.md) - Legacy async I/O
- [epoll](../../sysprog/epoll.md) - Event notification (for comparison)

## Further Reading

- [io_uring official documentation](https://kernel.dk/io_uring.pdf)
- [io_uring and networking in 5.6 (LWN.net)](https://lwn.net/Articles/810414/)
- [Efficient IO with io_uring (kernel.dk)](https://kernel.dk/io_uring-whatsnew.pdf)
- [liburing repository](https://github.com/axboe/liburing)
- [io_uring block I/O support (LWN.net)](https://lwn.net/Articles/776703/)
- [ Jens Axboe's io_uring slides](https://kernel.dk/axboe-uring.pdf)
- [io_uring io_poll support](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/fs/io_uring.c)
