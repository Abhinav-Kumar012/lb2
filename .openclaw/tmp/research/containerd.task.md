# Research Task: containerd

Fetch each URL below and save extracted content to `.openclaw/tmp/research/containerd/<slug>.md`.

Write `.openclaw/tmp/research/containerd/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://containerd.io/docs/ — containerd docs
   → save as: `containerd-docs.md`

2. https://github.com/containerd/containerd/blob/main/README.md — GitHub README
   → save as: `github-readme.md`

3. https://github.com/containerd/containerd/blob/main/docs/cri/config.md — CRI config
   → save as: `cri-config.md`

4. https://kubernetes.io/docs/concepts/architecture/cri/ — Kubernetes CRI
   → save as: `k8s-cri.md`

5. https://man7.org/linux/man-pages/man1/ctr.8.html — ctr man page
   → save as: `ctr-manpage.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize
