#!/bin/zsh
# Both outreach ramps, once a day, from the Mac's launchd (backend/ops/com.outset.outreach-daily.plist).
#
# The listing-claim campaign (outreach-ramp.mts, 15/20/25/30) and the Otto campaign (otto-ramp.mts,
# 10/15/20/20) send through one personal Gmail identity and share a 50/day ceiling, the rate a personal
# account can send cold mail at without Gmail reading it as bulk; each ramp reads what the other
# already sent today, so the order here does not matter. Both refuse to run twice on one day and skip
# weekends, so a missed launch that fires late in the day is safe. Everything they need (mail identity,
# claim secret, suppression list) comes from backend/.env; a missing value makes them print why and send
# nothing. The draft queue and the sent log are the local SQLite at backend/data/outset.db, which is why
# this runs here and not on the Render worker: the worker's own database has no record of what was sent
# from here and would mail the same operators again.
set -u
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export OUTSET_DB_PATH="$PWD/data/outset.db"
export PIPELINE_TZ="${PIPELINE_TZ:-America/Toronto}"
mkdir -p data/logs
log="data/logs/outreach-$(date +%Y-%m-%d).log"
{
  echo "== $(date) listing ramp"
  npx tsx scripts/outreach-ramp.mts
  echo "== $(date) otto ramp"
  npx tsx scripts/otto-ramp.mts
  echo "== $(date) done"
} >> "$log" 2>&1
