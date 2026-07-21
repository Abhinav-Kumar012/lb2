# Research Task: Crash Dumps

Fetch each URL below and save extracted content to `.openclaw/tmp/research/crash-dump/<slug>.md`.

Write `.openclaw/tmp/research/crash-dump/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://www.kernel.org/doc/html/latest/admin-guide/kdump/kdump.html — kdump docs
   → save as: `kdump-docs.md`

2. https://github.com/crash-utility/crash — crash utility README
   → save as: `crash-readme.md`

3. https://man7.org/linux/man-pages/man8/kexec.8.html — kexec man page
   → save as: `kexec-manpage.md`

4. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/9/html/managing_monitoring_and_updating_the_kernel/configuring-kdump_managing-monitoring-and-updating-the-kernel — RHEL kdump guide
   → save as: `rhel-kdump-guide.md`

5. https://github.com/makedumpfile/makedumpfile — makedumpfile README
   → save as: `makedumpfile-readme.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize
