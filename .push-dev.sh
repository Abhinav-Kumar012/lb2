#!/bin/bash
cd /home/work/.openclaw/workspace/lb2
while true; do
    sleep 900  # 15 minutes
    git checkout dev 2>/dev/null
    if ! git diff --quiet HEAD 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        git add -A
        PAGES=$(find src -name '*.md' -not -name 'SUMMARY.md' -size +1k | wc -l)
        LINES=$(find src -name '*.md' -not -name 'SUMMARY.md' -size +1k -exec cat {} + | wc -l)
        git commit -m "Auto: ${PAGES} pages, ${LINES} lines" --quiet
        git push origin dev --quiet 2>&1
        echo "[$(date)] Pushed: ${PAGES} pages, ${LINES} lines"
    fi
done
