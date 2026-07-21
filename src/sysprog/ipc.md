# IPC Overview

## Introduction

**Inter-Process Communication (IPC)** refers to mechanisms that allow separate processes to exchange data and synchronize their actions. Since processes have independent address spaces by design, they cannot directly access each other's memory—IPC provides the bridge.

Linux offers a rich set of IPC mechanisms inherited from multiple Unix traditions (System V, POSIX, BSD) and modern Linux-specific innovations. Choosing the right IPC mechanism depends on your requirements: throughput, latency, complexity, portability, and whether the processes are on the same machine.

## IPC Mechanism Taxonomy

```mermaid
flowchart TD
    IPC["Linux IPC Mechanisms"]
    IPC --> SAME["Same Machine"]
    IPC --> NET["Network (Different Machines)"]

    SAME --> DATA["Data Transfer"]
    SAME --> SHARED["Shared State"]
    SAME --> SYNC["Synchronization"]

    DATA --> PIPES["Pipes / FIFOs"]
    DATA --> MQ["Message Queues"]
    DATA --> UNIX["Unix Domain Sockets"]

    SHARED --> SHM["Shared Memory"]
    SHARED --> MMAP["mmap()"]

    SYNC --> SEM["Semaphores"]
    SYNC --> FLOCK["File Locks"]
    SYNC --> MUTEX["Robust Mutexes"]

    NET --> SOCKETS["TCP/UDP Sockets"]
```
## System V IPC vs POSIX IPC

Linux supports two major IPC families, each providing semaphores, message queues, and shared memory.

### System V IPC

Introduced in AT&T Unix System III (1980s). Available on virtually all Unix systems.

```c
#include <sys/ipc.h>
#include <sys/shm.h>    /* Shared memory */
#include <sys/sem.h>    /* Semaphores */
#include <sys/msg.h>    /* Message queues */

/* Key generation */
key_t ftok(const char *pathname, int proj_id);

/* Shared memory */
int shmget(key_t key, size_t size, int shmflg);
void *shmat(int shmid, const void *shmaddr, int shmflg);
int shmdt(const void *shmaddr);
int shmctl(int shmid, int cmd, struct shmid_ds *buf);

/* Message queues */
int msgget(key_t key, int msgflg);
int msgsnd(int msqid, const void *msgp, size_t msgsz, int msgflg);
ssize_t msgrcv(int msqid, void *msgp, size_t msgsz, long msgtyp, int msgflg);
int msgctl(int msqid, int cmd, struct msqid_ds *buf);

/* Semaphores */
int semget(key_t key, int nsems, int semflg);
int semop(int semid, struct sembuf *sops, size_t nsops);
int semctl(int semid, int semnum, int cmd, ...);
```

### POSIX IPC

Introduced in POSIX.1b (1993). Cleaner API, integrated with filesystem namespace.

```c
#include <mqueue.h>     /* Message queues */
#include <semaphore.h>  /* Semaphores */
#include <sys/mman.h>   /* Shared memory */

/* Message queues */
mqd_t mq_open(const char *name, int oflag, ...);
ssize_t mq_receive(mqd_t mqdes, char *msg_ptr, size_t msg_len, unsigned *msg_prio);
int mq_send(mqd_t mqdes, const char *msg_ptr, size_t msg_len, unsigned msg_prio);
int mq_close(mqd_t mqdes);
int mq_unlink(const char *name);

/* Named semaphores */
sem_t *sem_open(const char *name, int oflag, ...);
int sem_wait(sem_t *sem);
int sem_post(sem_t *sem);
int sem_close(sem_t *sem);
int sem_unlink(const char *name);

/* Shared memory */
int shm_open(const char *name, int oflag, mode_t mode);
int shm_unlink(const char *name);
/* Then use ftruncate() and mmap() */
```

### Comparison Table

| Feature | System V | POSIX |
|---------|----------|-------|
| **API style** | `get`/`ctl` operations | `open`/`close`/`unlink` |
| **Naming** | `key_t` (ftok or IPC_PRIVATE) | `/name` (filesystem namespace) |
| **Message queues** | `msgget`/`msgsnd`/`msgrcv` | `mq_open`/`mq_send`/`mq_receive` |
| **Shared memory** | `shmget`/`shmat` | `shm_open` + `mmap()` |
| **Semaphores** | `semget`/`semop` | `sem_open` or `sem_init` |
| **Portability** | All Unix | POSIX-compliant systems |
| **Limits** | `/proc/sys/kernel/shm*` | Filesystem limits |
| **Removal** | `ipcrm` command | `shm_unlink()`/`mq_unlink()` |
| **Priority msgs** | No (type-based selection) | Yes (0-31 priority levels) |
| **Notification** | No | `mq_notify()` with signals |

## IPC Mechanisms in Detail

### 1. Pipes

Anonymous unidirectional byte streams, typically between parent and child.

```c
int pipefd[2];  /* [0]=read, [1]=write */
pipe(pipefd);
```

**Best for**: Simple parent-child communication, shell pipelines.

See [Pipes](./ipc/pipes.md) for details.

### 2. Named Pipes (FIFOs)

Like pipes but with a filesystem name, allowing unrelated processes to communicate.

```c
mkfifo("/tmp/myfifo", 0666);
```

### 3. Message Queues

Send and receive discrete messages with optional priority:

```c
/* System V message queue */
struct msgbuf {
    long mtype;      /* Message type (must be > 0) */
    char mtext[256]; /* Message data */
};

/* Send */
struct msgbuf msg = { .mtype = 1, .mtext = "Hello" };
msgsnd(msqid, &msg, strlen(msg.mtext), 0);

/* Receive (type 0 = any type) */
msgrcv(msqid, &buf, sizeof(buf.mtext), 0, 0);
```

```c
/* POSIX message queue */
mqd_t mq = mq_open("/myqueue", O_CREAT | O_RDWR, 0644, NULL);

mq_send(mq, "Hello", 5, 1);  /* priority 1 */

char buf[256];
unsigned prio;
ssize_t n = mq_receive(mq, buf, sizeof(buf), &prio);
printf("Received: %.*s (priority: %u)\n", (int)n, buf, prio);

mq_close(mq);
mq_unlink("/myqueue");
```

### 4. Shared Memory

The fastest IPC mechanism—processes share a region of memory:

```c
/* POSIX shared memory */
int fd = shm_open("/myshm", O_CREAT | O_RDWR, 0644);
ftruncate(fd, 4096);
void *ptr = mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);

/* Now both processes can read/write through ptr */
sprintf(ptr, "Hello from process %d", getpid());

/* Cleanup */
munmap(ptr, 4096);
close(fd);
shm_unlink("/myshm");
```

See [Shared Memory](./ipc/shared-memory.md) for details.

### 5. Semaphores

Synchronization primitives for controlling access to shared resources:

```c
/* POSIX named semaphore */
sem_t *sem = sem_open("/mysem", O_CREAT, 0644, 1);  /* Binary semaphore */

sem_wait(sem);     /* Decrement (block if 0) */
/* Critical section */
sem_post(sem);     /* Increment */

sem_close(sem);
sem_unlink("/mysem");
```

### 6. Unix Domain Sockets

Full-featured socket API for local communication:

```c
#include <sys/socket.h>
#include <sys/un.h>

int sockfd = socket(AF_UNIX, SOCK_STREAM, 0);

struct sockaddr_un addr = { .sun_family = AF_UNIX };
strcpy(addr.sun_path, "/tmp/mysocket");

bind(sockfd, (struct sockaddr *)&addr, sizeof(addr));
listen(sockfd, 5);

/* Client connects with: */
connect(sockfd, (struct sockaddr *)&addr, sizeof(addr));
```

**Advantages over pipes:**
- Bidirectional
- Supports `SOCK_DGRAM` (datagram) mode
- Can pass file descriptors and credentials via `sendmsg()`/`recvmsg()`
- Supports `SCM_RIGHTS` for fd passing

### 7. D-Bus

A high-level IPC framework built on Unix domain sockets:

```mermaid
flowchart LR
    subgraph "D-Bus"
        DAEMON["dbus-daemon"]
        A["App A"] -->|method call| DAEMON
        DAEMON -->|signal| B["App B"]
        DAEMON -->|method return| A
        C["App C"] -->|subscribe| DAEMON
    end
```

## Choosing the Right IPC Mechanism

```mermaid
flowchart TD
    START["Need IPC?"] --> Q1{"Same machine?"}
    Q1 -->|No| SOCKETS["TCP/UDP Sockets"]
    Q1 -->|Yes| Q2{"Need high throughput?"}
    Q2 -->|Yes| SHM["Shared Memory<br>+ synchronization"]
    Q2 -->|No| Q3{"Discrete messages<br>or byte stream?"}
    Q3 -->|Messages| Q4{"Need priorities?"}
    Q4 -->|Yes| MQ["POSIX Message Queue"]
    Q4 -->|No| Q5{"Simple or complex?"}
    Q3 -->|Byte stream| Q6{"Related processes?"}
    Q6 -->|Parent-child| PIPE["Pipes"]
    Q6 -->|Unrelated| UNIX_SOCK["Unix Domain Sockets"]
    Q5 -->|Simple| FIFO["Named Pipes (FIFO)"]
    Q5 -->|Complex| UNIX_SOCK2["Unix Domain Sockets"]
```
### Decision Matrix

| Mechanism | Throughput | Latency | Complexity | Bidirectional | Data Boundary |
|-----------|-----------|---------|-----------|---------------|---------------|
| Pipes | Medium | Low | Very Low | No | Stream |
| FIFO | Medium | Low | Low | No | Stream |
| Message Queue | Medium | Low | Medium | N/A | Message |
| Shared Memory | **Highest** | **Lowest** | High | Yes | N/A |
| Unix Socket | Medium | Low | Medium | Yes | Both |
| TCP Socket | Medium | Higher | Medium | Yes | Both |
| Signal | N/A | N/A | Low | No | No data |

## System V IPC Administration

### ipcs — View IPC Resources

```bash
# Show all IPC resources
$ ipcs

------ Shared Memory Segments --------
key        shmid      owner      perms      bytes      nattch     status
0x00000000 0          root       644        80         2
0x00000000 32769      root       644        16384      0

------ Semaphore Arrays --------
key        semid      owner      perms      nsems
0x0000a4d2 0          root       600        1

------ Message Queues --------
key        msqid      owner      perms      used-bytes   messages
0x00000000 0          root       644        0            0

# Show limits
$ ipcs -l

# Show specific resource details
$ ipcs -m -i 0
```

### ipcrm — Remove IPC Resources

```bash
# Remove by ID
$ ipcrm -m 32769    # Shared memory
$ ipcrm -s 0        # Semaphore
$ ipcrm -q 0        # Message queue

# Remove by key
$ ipcrm -M 0x1234   # Shared memory
$ ipcrm -S 0x1234   # Semaphore
$ ipcrm -Q 0x1234   # Message queue
```

### System V IPC Limits

```bash
# View kernel IPC limits
$ cat /proc/sys/kernel/shmmax     # Max shared memory segment size
$ cat /proc/sys/kernel/shmall     # Total shared memory pages
$ cat /proc/sys/kernel/shmmni     # Max number of segments
$ cat /proc/sys/kernel/msgmni     # Max message queues
$ cat /proc/sys/kernel/msgmax     # Max message size
$ cat /proc/sys/kernel/sem        # Semaphore limits (4 values)

# Increase limits temporarily
$ echo 67108864 > /proc/sys/kernel/shmmax

# Persistently in /etc/sysctl.conf
kernel.shmmax = 67108864
```

## POSIX IPC Naming

POSIX IPC objects use names starting with `/`:

```bash
# List POSIX shared memory objects (on tmpfs)
$ ls -la /dev/shm/
total 0
drwxrwxrwt  2 root root   40 Jul 21 12:00 .
drwxr-xr-x 19 root root 3820 Jul 21 12:00 ..
-rw-r--r--  1 user user 4096 Jul 21 12:00 myshm

# List POSIX message queues
$ ls -la /dev/mqueue/
total 0
drwxrwxrwt  2 root root  40 Jul 21 12:00 .
-rw-r--r--  1 user user  80 Jul 21 12:00 myqueue

# Read message queue attributes
$ cat /dev/mqueue/myqueue
QSIZE:5    NOTIFY:0    SIGNO:0    NOTIFY_PID:0    CURMSGS:1
```

## Security and Permissions

Both System V and POSIX IPC support permission checking:

```c
/* System V: set permissions at creation */
int shmid = shmget(key, size, IPC_CREAT | 0660);

/* POSIX: set mode at creation */
int fd = shm_open("/myshm", O_CREAT | O_RDWR, 0660);
```

**IPC ownership and permissions follow the same rules as files:**
- Owner UID/GID set from creating process
- Permission bits checked on access
- Creator can modify permissions via `shmctl()`/`msgctl()`/`semctl()`

## Performance Comparison

Typical benchmarks on modern hardware (Intel i7, DDR4):

| Mechanism | Latency (μs) | Throughput (MB/s) |
|-----------|---------------|-------------------|
| Shared memory + futex | ~0.1 | 10,000+ |
| Unix domain socket | ~5 | 5,000 |
| Pipe | ~5 | 4,000 |
| TCP loopback | ~20 | 3,000 |
| POSIX message queue | ~10 | 2,000 |
| System V message queue | ~15 | 1,500 |

*Note: These are approximate and vary significantly by workload, message size, and hardware.*

## References

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [LWN.net - Linux and free software news](https://lwn.net/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- [Introduction to IPC — Beej's Guide](https://beej.us/guide/bgipc/)
- [System V IPC — Linux man pages](https://man7.org/linux/man-pages/man7/svipc.7.html)
- [POSIX IPC — Linux man pages](https://man7.org/linux/man-pages/man7/posixipc.7.html)
- [Unix Domain Sockets — man 7 unix](https://man7.org/linux/man-pages/man7/unix.7.html)
- [The Linux Programming Interface, Chapters 43-55](https://man7.org/tlpi/)

## Related Topics

- [Pipes](./ipc/pipes.md) — Anonymous and named pipes
- [Shared Memory](./ipc/shared-memory.md) — POSIX and System V shared memory
- [Threads](./threads.md) — IPC between threads (shared memory by default)
- [epoll](./epoll.md) — Monitoring IPC file descriptors
- [io_uring](./io-uring.md) — Async I/O for IPC
