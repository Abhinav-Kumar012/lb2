# Research Task: Sanitizers

Fetch each URL below and save extracted content to `.openclaw/tmp/research/sanitizers/<slug>.md`.

Write `.openclaw/tmp/research/sanitizers/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://github.com/google/sanitizers/wiki/AddressSanitizer — ASan wiki
   → save as: `asan-wiki.md`

2. https://github.com/google/sanitizers/wiki/ThreadSanitizerCppManual — TSan wiki
   → save as: `tsan-wiki.md`

3. https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html — UBSan docs
   → save as: `ubsan-docs.md`

4. https://www.kernel.org/doc/html/latest/dev-tools/kasan.html — KASAN docs
   → save as: `kasan-docs.md`

5. https://www.kernel.org/doc/html/latest/dev-tools/kfence.html — KFENCE docs
   → save as: `kfence-docs.md`

6. https://lwn.net/Articles/836411/ — LWN: KFENCE
   → save as: `lwn-kfence.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize
