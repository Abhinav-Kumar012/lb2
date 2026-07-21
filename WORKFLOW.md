# lb2 Agent Workflow

## Pipeline

```
Phase 1: RESEARCH (crawl & store)
   Research agents fetch URLs, extract content, save to .openclaw/tmp/research/

Phase 2: WRITE (reference & produce)
   Writer agents read from .openclaw/tmp/research/, produce src/*.md pages
```

## Research Agent Instructions

1. Read your assigned task from `.openclaw/tmp/research/<topic>.task.md`
2. For each URL listed, use `web_fetch` to retrieve content
3. Save each fetched page to `.openclaw/tmp/research/<topic>/<slug>.md`
4. Write a manifest `.openclaw/tmp/research/<topic>/MANIFEST.md` listing all stored files with summaries
5. When done, mark the task file as complete

## Writer Agent Instructions

1. Read `.openclaw/tmp/research/<topic>/MANIFEST.md` to see available references
2. Read relevant files from `.openclaw/tmp/research/<topic>/`
3. Produce the final page in `src/<category>/<page>.md`
4. Use cross-references to other pages in `src/`

## File Layout

```
lb2/
├── WORKFLOW.md                  ← this file
├── .openclaw/tmp/research/      ← research artifacts (temp)
│   ├── assembler/               ← per-topic folder
│   │   ├── MANIFEST.md          ← index of stored files
│   │   ├── gas-manual.md        ← crawled content
│   │   └── nasm-vs-gas.md       ← crawled content
│   ├── ninja/
│   ├── containerd/
│   └── ...
└── src/                         ← final output
    ├── compilers/
    ├── containers/
    └── debugging/
```
