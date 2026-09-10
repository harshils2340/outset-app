#!/bin/zsh
# Wait for submission to finish, then poll OpenAI every 30 minutes. Store completed batches as they land.
# When none are left running, report counts. Sync and deploy are run by the session that owns discovery, not here.
cd /Users/harsh/Documents/outset-app
cleanup() {
  pkill -f 'src/index.ts enrich' 2>/dev/null || true
  pkill -f 'outset-render-' 2>/dev/null || true
}
trap cleanup EXIT INT TERM
while pgrep -f submit-batches.sh >/dev/null; do sleep 120; done
echo "submission finished $(date)"
while true; do
  out=$(cd backend && npx tsx src/index.ts enrich --collect-all 2>&1 | grep -v Warning)
  code=$?
  echo "$(date +%H:%M) $out" | tail -6
  if [ "$code" -eq 0 ]; then break; fi
  sleep 1800
done
echo "all batches collected $(date)"
sqlite3 backend/data/outset.db "select 'ai ops', count(distinct operator_id) from facts where confidence='ai'; select 'spent usd', round(sum(usd),2) from extract_spend where model != 'reserved';"
echo "DONE $(date): results stored; sync and deploy are handled by the discovery session"
