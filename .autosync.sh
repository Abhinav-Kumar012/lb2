#!/bin/bash
# Auto-commit and push to dev branch
# GitHub Actions CI will auto-merge dev -> main -> deploy

REPO_DIR="/home/work/.openclaw/workspace/lb2"
COMMIT_INTERVAL=120    # 2 minutes
PUSH_INTERVAL=300      # 5 minutes (more frequent since GH Actions handles deploy)
LAST_PUSH=$(date +%s)
COMMIT_COUNT=0

cd "$REPO_DIR" || exit 1

echo "[$(date)] Auto-sync started (commit every ${COMMIT_INTERVAL}s, push every ${PUSH_INTERVAL}s)"

while true; do
    sleep "$COMMIT_INTERVAL"
    
    cd "$REPO_DIR"
    
    # Stay on dev branch
    CURRENT=$(git branch --show-current)
    if [ "$CURRENT" != "dev" ]; then
        git checkout dev 2>/dev/null
    fi
    
    # Check for changes
    if git diff --quiet HEAD 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
        if [ -z "$(git ls-files --others --exclude-standard)" ]; then
            continue
        fi
    fi
    
    # Count changed files
    CHANGED=$(git diff --name-only HEAD 2>/dev/null | wc -l)
    UNTRACKED=$(git ls-files --others --exclude-standard | wc -l)
    TOTAL=$((CHANGED + UNTRACKED))
    
    if [ "$TOTAL" -gt 0 ]; then
        git add -A
        
        TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
        PAGES=$(find src -name '*.md' -not -name 'SUMMARY.md' -size +1k | wc -l)
        TOTAL_LINES=$(find src -name '*.md' -not -name 'SUMMARY.md' -size +1k -exec cat {} + | wc -l)
        
        git commit -m "Auto-commit: ${PAGES} pages, ${TOTAL_LINES} lines (${TOTAL} files changed)" --quiet
        
        COMMIT_COUNT=$((COMMIT_COUNT + 1))
        echo "[$(date)] Committed #${COMMIT_COUNT}: ${TOTAL} files, ${PAGES} pages"
    fi
    
    # Push to dev
    NOW=$(date +%s)
    ELAPSED=$((NOW - LAST_PUSH))
    
    if [ "$ELAPSED" -ge "$PUSH_INTERVAL" ]; then
        echo "[$(date)] Pushing to dev..."
        if git push origin dev --quiet 2>&1; then
            echo "[$(date)] Push to dev successful (GH Actions will merge to main)"
            LAST_PUSH=$(date +%s)
        else
            echo "[$(date)] Push failed, will retry"
        fi
    fi
done
