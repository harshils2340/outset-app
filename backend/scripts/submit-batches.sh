#!/bin/zsh
# Crawl and submit the extraction queue in chunks of 500 sites, each its own OpenAI batch, until the queue or the budget runs out.
cd /Users/harsh/Documents/outset-app/backend
for i in {1..24}; do
  out=$(npx tsx src/index.ts enrich 500 12 --batch 2>&1 | grep -v Warning | tail -1)
  echo "$(date +%H:%M) chunk $i: $out"
  case "$out" in *"Nothing to submit"*) break;; esac
done
echo "ALL SUBMITTED $(date)"
