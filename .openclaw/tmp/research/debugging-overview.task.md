# Research Task: Debugging Overview

Fetch each URL below and save extracted content to `.openclaw/tmp/research/debugging-overview/<slug>.md`.

Write `.openclaw/tmp/research/debugging-overview/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://sourceware.org/gdb/documentation/ — GDB docs
   → save as: `gdb-docs.md`

2. https://man7.org/linux/man-pages/man1/strace.1.html — strace man page
   → save as: `strace-manpage.md`

3. https://perf.wiki.kernel.org/index.php/Tutorial — perf tutorial
   → save as: `perf-tutorial.md`

4. https://www.kernel.org/doc/html/latest/trace/ftrace.html — ftrace docs
   → save as: `ftrace-docs.md`

5. https://ebpf.io/docs/ — eBPF docs
   → save as: `ebpf-docs.md`

6. https://www.brendangregg.com/linuxperf.html — Brendan Gregg's Linux perf tools
   → save as: `brendan-gregg-perf.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize
