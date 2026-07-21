# Event-Driven Programming

## Introduction

Event-driven programming is a paradigm where the flow of execution is determined by events — I/O readiness, timers, signals, user input — rather than sequential code. This model is fundamental to building scalable network servers, GUI applications, and any system that must handle many concurrent operations efficiently.

The two primary architectural patterns are the **Reactor** and **Proactor** patterns, each with distinct approaches to asynchronous operation.

## The Reactor Pattern

The Reactor pattern demultiplexes and dispatches events synchronously. The application registers interest in I/O events, and the event loop notifies when operations can proceed without blocking.

### Architecture

```mermaid
graph TD
    A[Event Loop] -->|epoll_wait / poll| B{I/O Ready?}
    B -->|Yes| C[Dispatch to Handler]
    C --> D[Read/Write Data]
    D --> A
    B -->|No| E{Timer Events?}
    E -->|Yes| F[Timer Callback]
    F --> A
    E -->|No| A
```

### Reactor Implementation

```c
#include <sys/epoll.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>

#define MAX_EVENTS 1024

static int set_nonblocking(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

typedef void (*handler_fn)(int fd, void *arg);

struct event_data {
    int       fd;
    handler_fn on_read;
    handler_fn on_write;
    void      *arg;
};

static struct event_data events_map[65536];

static void echo_handler(int fd, void *arg) {
    char buf[4096];
    ssize_t n = read(fd, buf, sizeof(buf));
    if (n > 0) {
        write(fd, buf, n);
    } else if (n == 0) {
        close(fd);
        printf("Client disconnected: fd=%d\n", fd);
    }
}

static void accept_handler(int fd, void *arg) {
    int epoll_fd = *(int *)arg;
    int client = accept(fd, NULL, NULL);
    if (client < 0) return;

    set_nonblocking(client);
    events_map[client].fd = client;
    events_map[client].on_read = echo_handler;

    struct epoll_event ev = {
        .events = EPOLLIN | EPOLLET,
        .data.fd = client
    };
    epoll_ctl(epoll_fd, EPOLL_CTL_ADD, client, &ev);
    printf("New client: fd=%d\n", client);
}

int main(void) {
    int epoll_fd = epoll_create1(0);
    int listen_fd = socket(AF_INET, SOCK_STREAM, 0);
    set_nonblocking(listen_fd);

    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port = htons(8080),
        .sin_addr.s_addr = INADDR_ANY
    };
    bind(listen_fd, (struct sockaddr *)&addr, sizeof(addr));
    listen(listen_fd, 128);

    events_map[listen_fd].fd = listen_fd;
    events_map[listen_fd].on_read = accept_handler;
    events_map[listen_fd].arg = &epoll_fd;

    struct epoll_event ev = { .events = EPOLLIN, .data.fd = listen_fd };
    epoll_ctl(epoll_fd, EPOLL_CTL_ADD, listen_fd, &ev);

    struct epoll_event active[MAX_EVENTS];
    printf("Reactor listening on :8080\n");

    for (;;) {
        int n = epoll_wait(epoll_fd, active, MAX_EVENTS, -1);
        for (int i = 0; i < n; i++) {
            int fd = active[i].data.fd;
            if (active[i].events & EPOLLIN) {
                events_map[fd].on_read(fd, events_map[fd].arg);
            }
        }
    }
}
```

### Characteristics

- **Synchronous dispatch**: Handlers run in the event loop thread
- **Non-blocking I/O required**: All sockets must be `O_NONBLOCK`
- **Single-threaded by default**: Scale via multiple event loops (one per thread)
- **Used by**: nginx, Redis, Node.js (libuv), memcached

## The Proactor Pattern

The Proactor pattern delegates I/O operations to the OS and is notified upon completion. The application initiates an operation and processes the result asynchronously.

### Reactor vs Proactor

```mermaid
sequenceDiagram
    participant App
    participant OS

    Note over App,OS: Reactor Pattern
    App->>OS: "Tell me when fd is readable"
    OS-->>App: "fd 5 is readable"
    App->>OS: read(fd=5, ...)
    OS-->>App: data

    Note over App,OS: Proactor Pattern
    App->>OS: "Read from fd 5, call me when done"
    OS-->>App: "Read complete, here's the data"
```

| Aspect | Reactor | Proactor |
|---|---|---|
| I/O initiation | App checks readiness | OS performs I/O |
| Completion notification | "Ready to read" | "Read complete, N bytes" |
| Typical APIs | `epoll`, `kqueue`, `select` | `io_uring`, `aio_read`, IOCP (Windows) |
| Complexity | Simpler handlers | Completion callbacks |
| Efficiency | May need extra read calls | Single round-trip |

## Event Loop Design

A well-designed event loop handles multiple event types:

```c
struct event_loop {
    int             epoll_fd;
    int             stop;
    struct timer_tree *timers;    /* Red-black tree of timers */
    int             wakeup_fd;    /* eventfd for cross-thread wakeup */
};

void event_loop_run(struct event_loop *loop) {
    struct epoll_event events[MAX_EVENTS];

    while (!loop->stop) {
        int timeout = timer_next_timeout(loop->timers);
        int n = epoll_wait(loop->epoll_fd, events, MAX_EVENTS, timeout);

        /* Process I/O events */
        for (int i = 0; i < n; i++) {
            struct event_data *ev = events[i].data.ptr;
            if (events[i].events & EPOLLIN)
                ev->on_read(ev->fd, ev->arg);
            if (events[i].events & EPOLLOUT)
                ev->on_write(ev->fd, ev->arg);
        }

        /* Process expired timers */
        timer_process_expired(loop->timers);
    }
}
```

### Timer Management

Event loops need efficient timer management. Common approaches:

- **Min-heap**: O(log n) insert/delete, O(1) find-min
- **Red-black tree**: Used by Linux kernel and libev
- **Timing wheel**: O(1) insert, good for large numbers of similar timeouts
- **Hierarchical timing wheels**: Used by libevent

```c
/* Linux timerfd integration */
#include <sys/timerfd.h>

int timer_fd = timerfd_create(CLOCK_MONOTONIC, TFD_NONBLOCK);
struct itimerspec ts = {
    .it_interval = { .tv_sec = 5 },    /* Repeat every 5s */
    .it_value    = { .tv_sec = 5 }     /* First fire at 5s */
};
timerfd_settime(timer_fd, 0, &ts, NULL);

/* Add timer_fd to epoll */
struct epoll_event ev = { .events = EPOLLIN, .data.fd = timer_fd };
epoll_ctl(epoll_fd, EPOLL_CTL_ADD, timer_fd, &ev);
```

## Major Event Libraries

### libevent

The oldest widely-used event library. Provides a portable API over `epoll`, `kqueue`, `select`, `poll`, and more.

```c
#include <event2/event.h>
#include <event2/listener.h>

static void on_read(struct bufferevent *bev, void *arg) {
    struct evbuffer *input = bufferevent_get_input(bev);
    size_t len = evbuffer_get_length(input);
    char *data = malloc(len);
    evbuffer_remove(input, data, len);
    bufferevent_write(bev, data, len);  /* echo */
    free(data);
}

static void on_accept(struct evconnlistener *listener, evutil_socket_t fd,
                       struct sockaddr *addr, int len, void *arg) {
    struct event_base *base = arg;
    struct bufferevent *bev = bufferevent_socket_new(base, fd,
        BEV_OPT_CLOSE_ON_FREE);
    bufferevent_setcb(bev, on_read, NULL, NULL, NULL);
    bufferevent_enable(bev, EV_READ);
}

int main(void) {
    struct event_base *base = event_base_new();

    struct sockaddr_in sin = {
        .sin_family = AF_INET,
        .sin_port = htons(8080)
    };
    struct evconnlistener *listener = evconnlistener_new_bind(
        base, on_accept, base, LEV_OPT_CLOSE_ON_FREE | LEV_OPT_REUSEABLE,
        128, (struct sockaddr *)&sin, sizeof(sin));

    event_base_dispatch(base);
    evconnlistener_free(listener);
    event_base_free(base);
}
```

```bash
gcc -o echo_server echo_server.c -levent
```

### libev

Smaller, faster, and more minimal than libevent. No buffering or DNS — just pure event loop.

```c
#include <ev.h>
#include <stdio.h>

static ev_io stdin_watcher;
static ev_timer timer_watcher;

static void stdin_cb(EV_P_ ev_io *w, int revents) {
    char buf[256];
    ssize_t n = read(w->fd, buf, sizeof(buf));
    if (n > 0) printf("Input: %.*s\n", (int)n, buf);
}

static void timer_cb(EV_P_ ev_timer *w, int revents) {
    printf("Timer fired!\n");
    ev_timer_again(EV_A_ w);  /* Restart */
}

int main(void) {
    EV_P = ev_default_loop(0);

    ev_io_init(&stdin_watcher, stdin_cb, STDIN_FILENO, EV_READ);
    ev_io_start(EV_A_ &stdin_watcher);

    ev_timer_init(&timer_watcher, timer_cb, 2.0, 1.0);  /* 2s initial, 1s repeat */
    ev_timer_start(EV_A_ &timer_watcher);

    ev_run(EV_A_ 0);
}
```

### libuv

The event loop powering Node.js. Provides a unified async API for I/O, DNS, processes, threads, and more.

```c
#include <uv.h>
#include <stdio.h>

uv_loop_t *loop;

void on_timer(uv_timer_t *handle) {
    static int count = 0;
    printf("Timer tick %d\n", ++count);
    if (count >= 5) {
        uv_timer_stop(handle);
        uv_stop(loop);
    }
}

int main(void) {
    loop = uv_default_loop();
    uv_timer_t timer;
    uv_timer_init(loop, &timer);
    uv_timer_start(&timer, on_timer, 0, 1000);  /* Every 1s */
    uv_run(loop, UV_RUN_DEFAULT);
    uv_loop_close(loop);
}
```

### Library Comparison

| Feature | libevent | libev | libuv |
|---|---|---|---|
| Backend | epoll/kqueue/select/poll | epoll/kqueue/select/poll | epoll/kqueue/IOCP |
| DNS | ✅ (async) | ❌ | ✅ (async) |
| Bufferevent | ✅ | ❌ | ✅ (stream handles) |
| Thread pool | ✅ | ❌ | ✅ |
| Timers | ✅ | ✅ | ✅ |
| Signals | ✅ | ✅ | ✅ |
| Windows | ✅ | Partial | ✅ (first-class) |
| License | BSD | BSD | MIT |

## Edge-Triggered vs Level-Triggered

```mermaid
graph LR
    subgraph "Level-Triggered"
        A[Data arrives] --> B[epoll reports readable]
        B --> C[Read partial data]
        C --> B
    end
    subgraph "Edge-Triggered"
        D[Data arrives] --> E[epoll reports readable ONCE]
        E --> F[Must read until EAGAIN]
    end
```

**Level-triggered** (`EPOLLIN`): epoll reports the fd as long as data is available. Simpler but may cause redundant wakeups.

**Edge-triggered** (`EPOLLIN | EPOLLET`): epoll reports only on state change. More efficient but requires reading **all** available data (until `EAGAIN`) to avoid missing events.

```c
/* Edge-triggered requires non-blocking loop */
while (1) {
    ssize_t n = read(fd, buf, sizeof(buf));
    if (n < 0) {
        if (errno == EAGAIN) break;  /* Done, all data consumed */
        perror("read");
        break;
    }
    if (n == 0) { /* EOF */ break; }
    process(buf, n);
}
```

## The Thundering Herd Problem

When multiple threads wait on the same listening socket, a new connection wakes **all** of them, but only one can accept. Solutions:

1. **`EPOLLEXCLUSIVE`** (Linux 4.5+): Only wake one thread
2. **`SO_REUSEPORT`**: Each thread has its own listening socket
3. **Single acceptor thread**: One thread accepts, distributes to workers

```c
/* EPOLLEXCLUSIVE usage */
struct epoll_event ev = {
    .events = EPOLLIN | EPOLLEXCLUSIVE,
    .data.fd = listen_fd
};
epoll_ctl(epoll_fd, EPOLL_CTL_ADD, listen_fd, &ev);
```

## References

- [The Linux Kernel Documentation](https://docs.kernel.org/)
- [LWN.net - Linux and free software news](https://lwn.net/)
- [GNU Project Documentation](https://www.gnu.org/doc/doc.html)
- [GNU Manuals](https://www.gnu.org/manual/manual.html)
- [Free Software Directory](https://directory.fsf.org/wiki/Main_Page)
- [Planet GNU](https://planet.gnu.org/)
- [Free Software Books](https://www.gnu.org/doc/other-free-books.html)

- [libevent documentation](https://libevent.org/)
- [libev documentation](http://software.schmorp.de/pkg/libev.html)
- [libuv documentation](https://docs.libuv.org/)
- [epoll man page](https://man7.org/linux/man-pages/man7/epoll.7.html)
- [C10K problem](http://www.kegel.com/c10k.html) — Dan Kegel

## Related Topics

- [poll and select](./poll-select.md) — lower-level I/O multiplexing
- [POSIX AIO](./aio.md) — proactor-style async I/O
- [Unix Domain Sockets](./ipc/unix-sockets.md) — local IPC with event loops
