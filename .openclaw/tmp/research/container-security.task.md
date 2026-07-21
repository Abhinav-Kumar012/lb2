# Research Task: Container Security

Fetch each URL below and save extracted content to `.openclaw/tmp/research/container-security/<slug>.md`.

Write `.openclaw/tmp/research/container-security/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://docs.docker.com/engine/security/ — Docker security docs
   → save as: `docker-security.md`

2. https://man7.org/linux/man-pages/man2/seccomp.2.html — seccomp man page
   → save as: `seccomp-manpage.md`

3. https://man7.org/linux/man-pages/man7/capabilities.7.html — capabilities man page
   → save as: `capabilities-manpage.md`

4. https://aquasecurity.github.io/trivy/ — Trivy scanner docs
   → save as: `trivy-docs.md`

5. https://kubernetes.io/docs/concepts/security/ — K8s security overview
   → save as: `k8s-security.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize
