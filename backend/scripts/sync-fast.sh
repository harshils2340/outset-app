#!/bin/zsh
# Sync from a consistent snapshot of the database. The live file stays free for the crawlers, and the sync
# never waits on their write locks. Snapshot takes a few seconds; the sync itself is then CPU-bound.
cd /Users/harsh/Documents/outset-app/backend
rm -f data/snapshot.db
sqlite3 -cmd ".timeout 120000" data/outset.db "VACUUM INTO 'data/snapshot.db'"
OUTSET_DB=/Users/harsh/Documents/outset-app/backend/data/snapshot.db npx tsx src/index.ts sync
