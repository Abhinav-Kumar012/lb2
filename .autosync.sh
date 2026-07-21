#!/bin/bash
# Auto-commit and push script for Linux Encyclopedia
# Commits changes every 2 minutes, pushes every 15 minutes

REPO_DIR="/home/work/.openclaw/workspace/lb2"
COMMIT_INTERVAL=120    # 2 minutes
PUSH_INTERVAL=900      # 15 minutes
LAST_PUSH=$(date +%s)
COMMIT_COUNT=0

cd "$REPO_DIR" || exit 1

echo "[$(date)] Auto-sync started (commit every ${COMMIT_INTERVAL}s, push every ${PUSH_INTERVAL}s)"

while true; do
    sleep "$COMMIT_INTERVAL"
    
    cd "$REPO_DIR"
    
    # Check for changes
    if git diff --quiet HEAD 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
        continue
    fi
    
    # Count changed files
    CHANGED=$(git diff --name-only HEAD | wc -l)
    
    if [ "$CHANGED" -gt 0 ]; then
        # Stage all changes
        git add -A
        
        # Create commit with timestamp
        TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
        PAGES=$(find src -name '*.md' -not -name 'SUMMARY.md' -size +1k | wc -l)
        TOTAL_LINES=$(find src -name '*.md' -not -name 'SUMMARY.md' -size +1k -exec cat {} + | wc -l)
        
        git commit -m "Auto-commit: ${PAGES} pages, ${TOTAL_LINES} lines (${CHANGED} files changed)

Timestamp: ${TIMESTAMP}" --quiet
        
        COMMIT_COUNT=$((COMMIT_COUNT + 1))
        echo "[$(date)] Committed #${COMMIT_COUNT}: ${CHANGED} files, ${PAGES} pages total"
    fi
    
    # Push if interval elapsed
    NOW=$(date +%s)
    ELAPSED=$((NOW - LAST_PUSH))
    
    if [ "$ELAPSED" -ge "$PUSH_INTERVAL" ]; then
        echo "[$(date)] Pushing to remote (every ${PUSH_INTERVAL}s)..."
        if git push origin dev --quiet 2>&1; then
            echo "[$(date)] Push successful"
            LAST_PUSH=$(date +%s)
        else
            echo "[$(date)] Push failed, will retry next cycle"
        fi
    fi
done
