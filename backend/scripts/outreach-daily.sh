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
#
# If data/logs/launchd-outreach.log says "/bin/zsh: can't open input file", launchd's zsh has no access to
# ~/Documents (macOS privacy protection on that folder): grant /bin/zsh Full Disk Access once, see the plist.
# If the day's log instead ends in "EPERM: process.cwd failed", zsh is allowed but node is not: grant the nvm
# node binary the same access (and again after an nvm upgrade, the grant follows the binary).
set -u
cd "$(dirname "$0")/.." || exit 1
# launchd starts with a bare PATH and no shell profile, and node here is installed through nvm, so put the
# newest nvm node first; homebrew and the system paths follow for anyone whose node lives there instead.
nvm_node="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="${nvm_node:+$nvm_node:}/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export OUTSET_DB_PATH="$PWD/data/outset.db"
export PIPELINE_TZ="${PIPELINE_TZ:-America/Toronto}"
mkdir -p data/logs
# Which node launchd ran, because that binary needs its own Full Disk Access grant (see the plist).
echo "node: $(command -v node)" >> "data/logs/launchd-outreach.log"
log="data/logs/outreach-$(date +%Y-%m-%d).log"
{
  # Listing-claim ramp paused 25 September 2026 (Harshil: "just do all otto emails for now"); Otto takes the
  # whole daily ceiling. To resume both, put the two lines back and lower RAMP in otto-ramp.mts to a share.
  # echo "== $(date) listing ramp"
  # npx tsx scripts/outreach-ramp.mts
  echo "== $(date) otto ramp"
  npx tsx scripts/otto-ramp.mts
  echo "== $(date) done"
} >> "$log" 2>&1
