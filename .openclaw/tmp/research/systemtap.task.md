# Research Task: SystemTap

Fetch each URL below and save extracted content to `.openclaw/tmp/research/systemtap/<slug>.md`.

Write `.openclaw/tmp/research/systemtap/MANIFEST.md` when done listing all files.

## URLs to Crawl

1. https://sourceware.org/systemtap/ — SystemTap home
   → save as: `systemtap-home.md`

2. https://sourceware.org/systemtap/langref/ — Language reference
   → save as: `langref.md`

3. https://sourceware.org/systemtap/tapsets/ — Tapset reference
   → save as: `tapsets.md`

4. https://sourceware.org/systemtap/SystemTap_Beginners_Guide/ — Beginner's guide
   → save as: `beginners-guide.md`

5. https://man7.org/linux/man-pages/man1/stap.1.html — stap man page
   → save as: `stap-manpage.md`

## Instructions

- Use `web_fetch` for each URL
- If a URL fails, log the error in MANIFEST.md and continue
- Keep raw content, don't summarize
