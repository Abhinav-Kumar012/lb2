# Research Task: Podman

Fetch each URL below and save extracted content to `.openclaw/tmp/research/podman/<slug>.md`.

Write `.openclaw/tmp/research/podman/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://podman.io/docs/ — Podman docs
   → save as: `podman-docs.md`

2. https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html — Quadlet unit docs
   → save as: `quadlet-units.md`

3. https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md — Rootless tutorial
   → save as: `rootless-tutorial.md`

4. https://www.redhat.com/sysadmin/podman-docker-comparison — Podman vs Docker
   → save as: `vs-docker.md`

5. https://man7.org/linux/man-pages/man1/podman.1.html — podman man page
   → save as: `podman-manpage.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize
