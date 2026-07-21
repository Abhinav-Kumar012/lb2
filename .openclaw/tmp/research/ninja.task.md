# Research Task: Ninja Build System

Fetch each URL below and save extracted content to `.openclaw/tmp/research/ninja/<slug>.md`.

Write `.openclaw/tmp/research/ninja/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://ninja-build.org/manual.html — Ninja manual
   → save as: `ninja-manual.md`

2. https://github.com/ninja-build/ninja — GitHub README
   → save as: `github-readme.md`

3. https://cmake.org/cmake/help/latest/generator/Ninja.html — CMake Ninja generator
   → save as: `cmake-ninja.md`

4. https://mesonbuild.com/Manual.html — Meson manual (uses Ninja backend)
   → save as: `meson-manual.md`

5. https://man7.org/linux/man-pages/man1/ninja.1.html — ninja man page
   → save as: `ninja-manpage.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize
