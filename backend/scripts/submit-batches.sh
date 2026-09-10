#!/bin/zsh
# Crawl and submit the extraction queue in chunks of 500 sites, each its own OpenAI batch, until the queue or the budget runs out.
cd /Users/harsh/Documents/outset-app/backend
cleanup() {
  pkill -f 'src/index.ts enrich' 2>/dev/null || true
  pkill -f 'outset-render-' 2>/dev/null || true
}
trap cleanup EXIT INT TERM
for i in {1..24}; do
  out=$(npx tsx src/index.ts enrich 500 12 --batch 2>&1 | grep -v Warning | tail -1)
  echo "$(date +%H:%M) chunk $i: $out"
  case "$out" in *"Nothing to submit"*) break;; esac
  if grep -qE "Billing hard limit|no credits" <<<"$(tail -40 logs/submit-batches.log)"; then echo "BILLING STOP $(date): OpenAI refused the batch, credits exhausted"; exit 3; fi
done
echo "ALL SUBMITTED $(date)"
