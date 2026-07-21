# Quadlet — Systemd Integration for Containers

Quadlet is a systemd generator that translates declarative container
definitions into native systemd units.  Introduced in Podman 4.4 (January
2023), Quadlet lets you define containers, pods, volumes, and networks in
simple `.container`, `.volume`, `.network`, and `.pod` files that systemd
treats as first-class services.

---

## 1. Motivation

Before Quadlet, running containers as systemd services required:

1. Writing a `.service` file with `ExecStart=podman run ...`
2. Managing container lifecycle manually (`podman stop`, `podman rm`)
3. Handling restart policies, logging, and dependencies by hand
4. Dealing with `Type=forking` vs `Type=notify` quirks

Quadlet eliminates this by generating correct systemd units from a
declarative, container-native syntax.

---

## 2. How Quadlet Works

```
~/.config/containers/systemd/   (user units)
/etc/containers/systemd/        (system units)
         │
         ▼
   quadlet-generator              (systemd generator)
         │
         ▼
   /run/systemd/generator/        (generated .service files)
         │
         ▼
   systemd starts the container   (via podman run)
```

The `quadlet-generator` binary runs early in the boot process (like other
systemd generators) and translates `.container` files into `.service` files.

---

## 3. File Types

| Extension | Purpose | Example |
|---|---|---|
| `.container` | Define a container | `web.container` |
| `.volume` | Define a volume | `data.volume` |
| `.network` | Define a network | `mynet.network` |
| `.pod` | Define a pod | `mypod.pod` |
| `.kube` | Deploy from a Kubernetes YAML | `app.kube` |
| `.image` | Pull/manage an image | `redis.image` |
| `.build` | Build from a Containerfile | `app.build` |

---

## 4. `.container` Files

### 4.1 Basic Example

```ini
# /etc/containers/systemd/web.container
[Container]
Image=docker.io/library/nginx:latest
PublishPort=8080:80
Volume=html.volume:/usr/share/nginx/html:ro
Network=mynet.network

[Service]
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 4.2 Common Options

#### `[Container]` Section

| Option | Equivalent CLI | Example |
|---|---|---|
| `Image=` | `podman run IMAGE` | `docker.io/library/nginx:latest` |
| `Pod=` | `--pod` | `mypod.pod` |
| `Network=` | `--network` | `mynet.network` |
| `PublishPort=` | `-p` | `8080:80` |
| `Volume=` | `-v` | `data.volume:/data` |
| `Environment=` | `-e` | `FOO=bar` |
| `Exec=` | command after image | `/usr/bin/nginx -g "daemon off;"` |
` |
| `AutoUpdate=` | `--label io.containers.autoupdate` | `registry` |
| `HealthCmd=` | `--health-cmd` | `curl -f http://localhost/` |
| `PodmanArgs=` | extra flags | `--cap-add NET_ADMIN` |
| `User=` | `--user` | `1000:1000` |
| `HostName=` | `--hostname` | `web01` |
| `AddCapability=` | `--cap-add` | `NET_BIND_SERVICE` |
| `DropCapability=` | `--cap-drop` | `ALL` |
| `ReadOnly=` | `--read-only` | `true` |
| `Tmpfs=` | `--tmpfs` | `/tmp:size=100m` |
| `Label=` | `--label` | `app=web` |
| `LogDriver=` | `--log-driver` | `journald` |
| `SeccompProfile=` | `--seccomp-profile` | `/etc/seccomp.json` |
| `SecurityLabelType=` | `--security-opt label=type:` | `spc_t` |
| `SecurityLabelDisable=` | `--security-opt label=disable` | `true` |

#### `[Service]` Section

Standard systemd `[Service]` options:

| Option | Meaning |
|---|---|
| `Restart=` | `always`, `on-failure`, `no` |
| `RestartSec=` | Seconds between restarts |
| `TimeoutStartSec=` | Startup timeout |
| `EnvironmentFile=` | Read env vars from file |
| `SyslogIdentifier=` | Journal log prefix |

#### `[Unit]` Section

| Option | Meaning |
|---|---|
| `Description=` | Human-readable description |
| `After=` | Start after these units |
| `Requires=` | Hard dependency |
| `Wants=` | Soft dependency |

#### `[Install]` Section

| Option | Meaning |
|---|---|
| `WantedBy=` | Which target pulls this in |
| `DefaultInstance=` | For template units |

---

## 5. `.volume` Files

```ini
# /etc/containers/systemd/data.volume
[Volume]
Label=app=data
User=1000
Group=1000
Device=tmpfs
Type=tmpfs
Options=nodev,nosuid

[Install]
WantedBy=multi-user.target
```

| Option | Equivalent | Example |
|---|---|---|
| `Label=` | `--label` | `app=data` |
| `Device=` | volume driver | `tmpfs`, local |
| `Type=` | filesystem type | `ext4`, `tmpfs` |
| `Options=` | mount options | `nodev,nosuid` |
| `User=` | UID owner | `1000` |
| `Group=` | GID owner | `1000` |
| `Copy=` | copy-on-create | `true` |

---

## 6. `.network` Files

```ini
# /etc/containers/systemd/mynet.network
[Network]
Subnet=10.89.0.0/24
Gateway=10.89.0.1
IPRange=10.89.0.128/25
IPv6=true
Label=app=mynet

[Install]
WantedBy=multi-user.target
```

| Option | Equivalent | Example |
|---|---|---|
| `Subnet=` | `--subnet` | `10.89.0.0/24` |
| `Gateway=` | `--gateway` | `10.89.0.1` |
| `IPRange=` | `--ip-range` | `10.89.0.128/25` |
| `IPv6=` | `--ipv6` | `true` |
| `Driver=` | `--driver` | `bridge`, `macvlan` |
| `Options=` | `--opt` | `mtu=9000` |
| `Internal=` | `--internal` | `true` |
| `DNS=` | `--dns` | `8.8.8.8` |

---

## 7. `.pod` Files

```ini
# /etc/containers/systemd/mypod.pod
[Pod]
PodName=mypod
Network=mynet.network
PublishPort=8080:80
PublishPort=8443:443

[Install]
WantedBy=multi-user.target
```

Then reference the pod from container files:

```ini
# web.container
[Container]
Pod=mypod.pod
Image=nginx:latest
```

---

## 8. `.kube` Files

Deploy from a Kubernetes YAML:

```ini
# /etc/containers/systemd/app.kube
[Kube]
Yaml=/etc/containers/kubernetes/app.yaml
Network=mynet.network
AutoUpdate=registry

[Install]
WantedBy=multi-user.target
```

This uses `podman kube play` under the hood.  The YAML can define multiple
pods, services, and volumes.

---

## 9. `.image` Files

Pre-pull images and manage them as systemd units:

```ini
# /etc/containers/systemd/redis.image
[Image]
Image=docker.io/library/redis:7-alpine
AllTags=false
AuthFile=/etc/containers/auth.json

[Install]
WantedBy=multi-user.target
```

The image is pulled when the unit is started, and can be referenced by
other `.container` files.

---

## 10. `.build` Files

Build container images from a Containerfile:

```ini
# /etc/containers/systemd/app.build
[Build]
File=Containerfile
Tag=myapp:latest
SetWorkingDirectory=/opt/myapp
Volume=build-cache.volume:/root/.cache:rw

[Install]
WantedBy=multi-user.target
```

---

## 11. Template Units

Quadlet supports systemd templates:

```ini
# /etc/containers/systemd/web@.container
[Container]
Image=nginx:latest
PublishPort=%i80:80
Environment=INSTANCE=%i

[Service]
Restart=always

[Install]
DefaultInstance=8080
WantedBy=multi-user.target
```

Then:

```bash
systemctl start web@8080.container
systemctl start web@9090.container
```

---

## 12. Auto-Update

Quadlet integrates with Podman's auto-update feature:

```ini
[Container]
Image=docker.io/library/nginx:latest
AutoUpdate=registry
```

This sets the `io.containers.autoupdate=registry` label.  The
`podman-auto-update.service` (a systemd timer) periodically checks for
new images and restarts containers if updates are found.

---

## 13. Practical Examples

### 13.1 Web Application Stack

```ini
# db.container
[Container]
Image=postgres:16
Volume=db-data.volume:/var/lib/postgresql/data
Environment=POSTGRES_PASSWORD_FILE=/run/secrets/db-pass
Secret=db-pass,type=mount,target=/run/secrets/db-pass
Network=app.network
HealthCmd=pg_isready -U postgres
HealthInterval=30s

[Service]
Restart=always

# web.container
[Container]
Image=registry.example.com/myapp:latest
PublishPort=443:8443
Volume=certs.volume:/etc/certs:ro
Network=app.network
Requires=db.container
After=db.container
Environment=DATABASE_URL=postgres://postgres@db:5432/app

[Service]
Restart=always
```

### 13.2 Rootless Container

```ini
# ~/.config/containers/systemd/myapp.container
[Container]
Image=myapp:latest
PublishPort=8080:8000
UserNS=auto
ReadOnly=true
Tmpfs=/tmp:size=256m

[Service]
Restart=on-failure

[Install]
WantedBy=default.target
```

---

## 14. Managing Quadlet Units

```bash
# Reload after editing .container files
systemctl daemon-reload

# Enable and start
systemctl enable --now web.container

# Check status
systemctl status web.container

# View logs
journalctl -u web.container

# List all container units
systemctl list-units --type=service | grep container

# Restart
systemctl restart web.container

# Stop and remove
systemctl stop web.container
```

---

## 15. Comparison with Other Approaches

| Approach | Pros | Cons |
|---|---|---|
| **Quadlet** | Native systemd, declarative, auto-update | Podman only |
| **podman generate systemd** | Works for existing containers | Imperative, deprecated in favor of Quadlet |
| **Docker systemd** | Familiar | No native generator, manual service files |
| **Kubernetes** | Portable, scalable | Heavy for single-node |
| **docker-compose** | Multi-container | Not systemd-native |

---

## 16. Further Reading

* **Quadlet documentation: `man quadlet`**
* **Podman Quadlet guide: https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html**
* **LWN: [Quadlet](https://lwn.net/Articles/919게시/)**
* **Red Hat blog: "Podman Quadlet: Running Containers as Systemd Services"**
* **Source: https://github.com/containers/quadlet**
* **systemd generators: `man systemd.generator`**

---

## Cross-References

* [Podman](./podman.md) — container runtime
* [Systemd](../systemd/index.md) — init system and service manager
* [cgroups](../kernel/cgroups.md) — resource isolation
* [Namespaces](./namespaces.md) — kernel namespace isolation
* [Rootless Containers](./rootless.md) — running without root
* [OCI Images](./oci-images.md) — image format
