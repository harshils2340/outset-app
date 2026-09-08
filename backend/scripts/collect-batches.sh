#!/bin/zsh
# Wait for submission to finish, then poll OpenAI every 30 minutes. Store completed batches as they land.
# When none are left running, sync the catalog, rebuild, commit and push.
cd /Users/harsh/Documents/outset-app
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
npm run backend:sync 2>&1 | tail -2
npm run build 2>&1 | tail -1
git add public/catalog.json src/data/contacts.ts
git commit -q -m "Catalog after the capped AI extraction pass: prices, durations, rules and policies for operators the free sources left blank

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push 2>&1 | tail -1
echo "PUSHED $(date)"
