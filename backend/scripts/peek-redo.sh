#!/bin/zsh
cd /Users/harsh/Documents/outset-app/backend
for d in $(sqlite3 -cmd ".timeout 60000" data/outset.db "select distinct o.domain from operators o join facts f on f.operator_id=o.id where f.fact_key='booking_url' and f.fact_value like '%book.peek.com/s/%'"); do
  npx tsx src/index.ts widgets 1 1 "$d" 2>/dev/null | head -1 | sed "s/^/$d /"
done
echo "PEEK REDO DONE $(date)"
