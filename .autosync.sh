#!/bin/bash
# Auto-commit and push to DEV only
# CI builds on dev push (cheap check)
# Deploy happens only when you manually push to main

REPO_DIR="/home/work/.openclaw/workspace/lb2"
COMMIT_INTERVAL=180    # 3 minutes
PUSH_INTERVAL=600      # 10 minutes
LAST_PUSH=$(date +%s)

cd "$REPO_DIR" || exit 1

echo "[$(date)] Auto-sync started (commit every ${COMMIT_INTERVAL}s, push to dev every ${PUSH_INTERVAL}s)"

while true; do
    sleep "$COMMIT_INTERVAL"
    cd "$REPO_DIR"
    
    # Stay on dev
    git checkout dev 2>/dev/null
    
    # Check for changes
    if git diff --quiet HEAD 2>/dev/null && git diff --cached --quiet 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard)" ]; then
        continue
    fi
    
    # Stage and commit
    git add -A
    PAGES=$(find src -name '*.md' -not -name 'SUMMARY.md' -size +1k | wc -l)
    LINES=$(find src -name '*.md' -not -name 'SUMMARY.md' -size +1k -exec cat {} + | wc -l)
    CHANGED=$(git diff --cached --name-only | wc -l)
    
    if [ "$CHANGED" -gt 0 ]; then
        git commit -m "Auto: ${PAGES} pages, ${LINES} lines" --quiet
        echo "[$(date)] Committed: ${PAGES} pages, ${CHANGED} files"
    fi
    
    # Push to dev only
    NOW=$(date +%s)
    if [ $((NOW - LAST_PUSH)) -ge "$PUSH_INTERVAL" ]; then
        git push origin dev --quiet 2>&1 && echo "[$(date)] Pushed to dev" || echo "[$(date)] Push failed"
        LAST_PUSH=$(date +%s)
    fi
done
