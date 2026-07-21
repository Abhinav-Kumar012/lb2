# Research Task: GNU Assembler (GAS)

Fetch each URL below and save extracted content to `.openclaw/tmp/research/assembler/<slug>.md`.

Write `.openclaw/tmp/research/assembler/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://sourceware.org/binutils/docs/as/ — GAS official manual
   → save as: `gas-manual.md`

2. https://man7.org/linux/man-pages/man1/as.1.html — as man page
   → save as: `as-manpage.md`

3. https://en.wikipedia.org/wiki/GNU_Assembler — Wikipedia overview
   → save as: `wikipedia.md`

4. https://cs.lmu.edu/~ray/notes/nasmtutorial/ — NASM tutorial (for comparison)
   → save as: `nasm-tutorial.md`

5. https://www.felixcloutier.com/x86/ — x86 instruction reference
   → save as: `x86-instructions.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize — writer agents will do that
