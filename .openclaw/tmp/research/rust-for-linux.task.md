# Research Task: Rust for Linux

Fetch each URL below and save extracted content to `.openclaw/tmp/research/rust-for-linux/<slug>.md`.

Write `.openclaw/tmp/research/rust-for-linux/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://www.kernel.org/doc/html/latest/rust/ — Kernel Rust docs
   → save as: `kernel-rust-docs.md`

2. https://rust-for-linux.com/ — Rust for Linux website
   → save as: `rust-for-linux-site.md`

3. https://lore.kernel.org/rust-for-linux/ — Mailing list
   → save as: `mailing-list.md`

4. https://github.com/Rust-for-Linux/linux — GitHub repo README
   → save as: `github-readme.md`

5. https://lwn.net/Articles/829858/ — LWN: Rust in the Linux kernel
   → save as: `lwn-rust-kernel.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize
