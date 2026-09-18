# Go live: the five keys

Everything below is built, tested end to end locally, and switches on the moment the key is set. No code changes needed.

## Live state (checked 11 September 2026)

Check before repeating any of this: `curl https://outset-api.onrender.com/config` (mail and payments flags), `curl -I https://onoutset.com`, `dig +short www.onoutset.com api.onoutset.com`.

- On: site https://onoutset.com, API https://outset-api.onrender.com with `{"payments":true,"mail":true}`, Resend DNS for onoutset.com (DKIM, send, DMARC). Claim links, sign-in codes, booking mail and card checkout run. Do not ask for `RESEND_API_KEY` or `STRIPE_SECRET_KEY` again.
- Not done: the `outset-pipeline` worker (section 5) does not exist on Render yet, so no crawl runs anywhere (blocked on the Mac by rule). Outreach is not sent: `MAIL_POSTAL` needs a PO box, then Harshil says go. `www.onoutset.com` and `api.onoutset.com` have no DNS records; guests use the apex and the API stays at outset-api.onrender.com until a CNAME is added.

## 1. API host (Render, free tier)
1. render.com → New → Blueprint → pick `harshils2340/outset-app`. It creates `outset-api` from `render.yaml`.
2. Set these environment variables on the service:
   - `CLAIM_SECRET`: the contents of `backend/data/claim-secret.txt` on the Mac (same secret the emailed claim links were signed with; if you rotate it, regenerate drafts).
   - `DATABASE_URL`: the pooled connection string of the Neon project `outset` (branch `production`). Profiles, bookings, payouts and the mail suppression list live there. The tables are created on boot, and the API refuses to serve without this variable, because a booking that lands nowhere is worse than an error.
   - `GITHUB_TOKEN`: optional. The API never writes to a repository (an operator's edit or a booking never makes a commit); a read-only token only lets it read a catalog file the checkout is missing. Contents: read is enough, or leave it unset.
   - `RESEND_API_KEY`: from resend.com (free tier covers 3,000 emails a month). Until `onoutset.com` is verified in Resend, keep `MAIL_FROM` as `Outset <onboarding@resend.dev>` (samples to yourself only). After verifying, set `MAIL_FROM` to `Outset <hello@onoutset.com>`.
   - `MAIL_POSTAL`: a real street address printed at the bottom of claim emails. Required before any send to businesses.
3. Copy the service URL (for example `https://outset-api.onrender.com`).

## 1b. Card payments (Stripe)
1. dashboard.stripe.com → Developers → API keys → copy the Secret key (`sk_test_...` to demo, `sk_live_...` for real money). Set it on the Render service as `STRIPE_SECRET_KEY`.
2. Developers → Webhooks → Add endpoint → URL `https://<your render url>/stripe/webhook`, events `checkout.session.completed` and `checkout.session.expired`. Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
3. That is all. From then on "Book" becomes "Book and pay": the guest lands on Stripe's hosted page, the card is held, the operator gets the request, the money is captured when they accept and released when they decline. Instant-book listings capture at once. With no key, bookings fall back to pay on site.
4. Payouts to operators: the platform account receives the money. Once Stripe Connect (Express) is switched on in the Stripe dashboard, an operator connects their bank from the Payouts page (`POST /payouts/:id/connect` opens Stripe's hosted onboarding), and `.github/workflows/pay-operators.yml` calls `POST /admin/payouts/run` every Monday to transfer what is due. That workflow needs the `OUTSET_ADMIN_KEY` repository secret, equal to `ADMIN_KEY` on the API service. Until Connect is on, pay operators from the Stripe dashboard.

## 1b2. The database (Neon Postgres)
The repo is linked to the Neon project (`.neon`, git-ignored) and `neon` is the CLI: `neon connection-string` prints the URL, `neon branches list` shows branches, and the Neon console has a SQL editor. Tables: `profiles` (one row per claimed listing, the full record as `doc`), `profile_emails` (hash of an address to the listings it may sign in to), `bookings` (one row each), `documents` (the mail suppression list). Guests read a claimed listing's edits through the API when the listing opens, and the nightly catalog sync reads them all through `GET /listing-edits` (or straight from Postgres when it has `DATABASE_URL`) to bake them into the rails. No edit, claim, booking or unsubscribe ever creates a commit; only the nightly pipeline commits, and only generated catalog files. Neon keeps a restore window on its own; `.github/workflows/db-backup.yml` also takes a nightly `pg_dump` into a workflow artifact once the repository secret `DATABASE_URL` is set.

To test against real code without touching production, make a scratch branch (`neon branches create --name scratch`, then `neon connection-string scratch --pooled`) and point `E2E_DATABASE_URL` or a local `DATABASE_URL` at it. `backend/scripts/payout-e2e.mts` and `backend/scripts/store-e2e.mts` run the money path and the claim, profile and booking routes on such a branch; the cloud rehearsal (`.github/workflows/e2e.yml`) needs the same value as the secret `E2E_DATABASE_URL`. `backend/scripts/migrate-json-to-pg.mts` is the one-off that moved the old JSON store; `--dry` counts, `--insert-only` adds what is missing.

## 1c. Admin key
Set `ADMIN_KEY` on Render to any long random string. The internal routes (raw operator rows, outreach drafts) then only answer to requests carrying `x-admin-key`; without it they are closed on the public host.

## 1d. The internal metrics page
Set `ADMIN_EMAILS` on the **outset-api** service to `harshils2340@gmail.com` (comma separated if it ever needs more). It is in `render.yaml` with `sync: false`. Unset means nobody, and then the page cannot be signed in to at all. With it set, `GET /admin/metrics?days=90` answers a session signed in with an emailed code from that address, or `x-admin-key` for curl, and 404 to everyone else:

```
curl -s -H "x-admin-key: $ADMIN_KEY" 'https://outset-api.onrender.com/admin/metrics?days=30' | jq .
```

Outreach sends, claims, bookings, money and the catalog funnel, each with a per-day series. See `docs/METRICS.md` for what every figure means and why an unknown one is `null` rather than 0.

## 2. Point the site at the API
The site is the Render static site `outset-web` (in `render.yaml`, project Outset, environment Production), built from every push to `main`. Its `VITE_API_URL` env var is the API URL; the blueprint sets it to `https://outset-api.onrender.com`. Nothing about the site goes through GitHub Actions or GitHub Pages. The only workflow under `.github/` is the end-to-end rehearsal (`e2e.yml`), plain CI. Every scheduled job (crawls, photo screen, payouts, keep-warm) runs on Render: the `outset-pipeline` worker and the cron services in `render.yaml`. GitHub disabled Actions for the account on 16 September 2026 because the crawl workflows used runners to read third-party sites; do not put a crawl, a ping or any non-CI job back under `.github/workflows`.

## 3. Mail DNS (do this before any send to a business)

Resend will 403 every address except your own until `onoutset.com` is verified.

1. resend.com → Domains → Add `onoutset.com`. Copy the DKIM CNAME they show.
2. Namecheap → Domain List → onoutset.com → Advanced DNS. Add:

   | Type | Host | Value |
   | --- | --- | --- |
   | TXT | `@` | `v=spf1 include:resend.com include:spf.efwd.registrar-servers.com ~all` |
   | CNAME | (the host Resend shows, often `resend._domainkey`) | (the value Resend shows) |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@onoutset.com` |

   Edit the existing SPF TXT. Do not add a second SPF. Keep the Namecheap forwarding include so `hello@` still reaches Gmail.
3. In Resend, wait until the domain is Verified.
4. Render → outset-api → Environment: set `MAIL_FROM` to `Outset <hello@onoutset.com>` and `MAIL_POSTAL` to your real street address. Same two keys in `backend/.env` on the Mac.
5. Each claim email has a visible unsubscribe link and a one-click header. Clicks are stored as hashes in `public/mail/unsub.json`. If someone emails `hello@` instead, run `npx tsx src/index.ts unsub --email=their@address`.

## 3b. Outreach
On the Mac, with `RESEND_API_KEY`, a verified `MAIL_FROM`, and `MAIL_POSTAL` in `backend/.env`:
```
cd backend
npx tsx src/index.ts outreach-send --to=harshils2340@gmail.com   # one sample to yourself
npx tsx src/index.ts outreach-send --dry --limit=50               # preview
npx tsx src/index.ts outreach-send --limit=200                    # send, marks rows sent, never twice to one address
npx tsx src/index.ts outreach-send --country=US --limit=50        # US only
```
Sends to businesses are blocked until `MAIL_FROM` uses `@onoutset.com` and `MAIL_POSTAL` is set. Each email carries a signed claim link and an unsubscribe link. Unsubscribed addresses are skipped. 6,263 drafts have an email address today.

## 3b. Keeping the API awake
Render's free tier puts the API to sleep after 15 idle minutes, and the next request waits out a cold start of up to a minute. `.github/workflows/keep-warm.yml` pings `/health` every 12 minutes so "Book and pay" never pays for that wake-up, and the site pings it again as a listing opens. If the API URL changes, update the workflow.

## 4. Claiming from the site
On `/operators`, an owner searches their business, enters their name, work email and mobile, and asks for the claim link. The API (`POST /claims/:id/request`) emails it only when the address matches the email found on the operator's own website, or lives at the operator's own domain. Anyone else is told which address to use. The check reads `public/claim-index.json`, written by `npm run sync` (on the Mac or by the cloud pipeline, which commits it with the catalog), so it stays current with each sync. The link opens the dashboard with no code, carries the typed name and phone, and records the claim so "Email me a sign-in code" works afterwards.

## What is verified
- Claim link → dashboard, edits saved to the API, same link resumes on another device (tested).
- Guest books → booking stored, operator email, guest email, row in dashboard under Upcoming or New, accept/decline emails the guest (tested with mail dry run).
- Returning operator → "Email me a sign-in code" → 6-digit code → dashboard; wrong code rejected; session survives reload (tested).
- Security: HMAC-signed sessions, timing-safe token checks, rate limits per IP and route, CORS limited to the site origin, input validation on every route, no secrets in the repo.

## 5. Pipeline in the cloud (Render background worker)

The crawls, cover screen, batch collection and the nightly catalog sync run on Render, not on the Mac. `render.yaml` defines a second service, `outset-pipeline` (type worker, starter plan, 5 GB disk at `/var/data`). The build installs Node deps and Chromium (`playwright` devDependency, `npx playwright install chromium`); the worker then clones the repo onto its disk (`/var/data/repo`), pulls before every job, and runs each job from that clone so the code is always current and the catalog outputs are committed from a real checkout.

1. **Approve the worker.** Render → Blueprints → `outset-app` → Sync. Approve `outset-pipeline` and its disk `outset-data`.
2. **Paste the env vars** on `outset-pipeline` (the ones with a value already are set by the blueprint):
   - `GITHUB_TOKEN`: fine-grained token on two repositories: `outset-app` with Contents: read and write (clone, pull, push the catalog) and the private `outset-data` with Contents: read (the seed download in step 3).
   - `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL`: the name on the nightly "Catalog: nightly pipeline sync" commits (for example `Outset pipeline` / `hello@onoutset.com`).
   - `OPENAI_API_KEY`: only used to **collect** extraction batches that were submitted from the Mac. The cloud never submits a batch and never runs paid discovery. Leave empty and the collect job skips itself.
   - `DB_SEED_URL`: see step 3.
   - Already set: `OUTSET_DB_PATH=/var/data/outset.db`, `PIPELINE_TZ=America/Toronto`, `GITHUB_REPO`, `OUTSET_EXTRACT_BUDGET_USD=8`, `PAID_CAP_USD=20`. Leave `OUTSET_CHROME` unset; Chromium is found in the Playwright cache.
3. **Seed the database once.** On the Mac:
   ```
   cd backend && npx tsx scripts/seed-db.mts
   ```
   It writes a compact copy to `/tmp/outset-seed.db` and prints the `gh release` commands that publish it as a release asset on the **private** repo `harshils2340/outset-data` (the database carries operator emails, so it never goes on the public app repo). The `DB_SEED_URL` is the asset's API URL, `https://api.github.com/repos/harshils2340/outset-data/releases/assets/<id>`, which the worker fetches with `GITHUB_TOKEN`. On first boot the worker streams it to `/var/data/outset.db` (refuses anything under 100 MB) and switches it to WAL. It never downloads again while the file exists. The current seed (10 September 2026, 356 MB) is already published; its URL is `https://api.github.com/repos/harshils2340/outset-data/releases/assets/556385446`.
4. **From then on the cloud database is canonical.** The Mac copy is a read replica for experiments; do not push catalog files from the Mac any more, the worker commits them at 05:00 Toronto time and the site rebuilds from that push.

Schedule (Toronto time, one job at a time, each with a hard timeout, a job never overlaps itself; a missed time is caught up within six hours of a restart):

| Time | Job | What |
| --- | --- | --- |
| every 30 min | collect | `enrich --collect-all`, stores finished OpenAI batches (already paid for). Needs `OPENAI_API_KEY`. |
| 22:00 | discover | `discover --wave=3 --concurrency=2`, OpenStreetMap, free |
| 23:00 | structure | `structure 5000 4` |
| 00:00 | photos | `photos 5000 4` |
| 01:00 | hours | `scripts/hours-crawl.mts 5000 6` |
| 02:00 | promo | `scripts/promo-crawl.mts --limit=5000` |
| 03:20 | purge-names | `scripts/purge-bad-names.mts`, deletes stored images the crawler now refuses by name; no network |
| 03:30 | screen | `scripts/screen-covers.mts`, pixel screen of covers and every gallery photo |
| 04:00 | owners | `owners 2000 8` |
| 05:00 | sync | read-only `sync` (no seed ingest), then commit and push `public/catalog.json`, `public/catalog-lite.json`, `public/o/`, `public/p/`, `public/sitemap.xml`, `src/data/contacts.ts`. `backend/data` is never pushed. |

Money guard: the worker reads the same paid spend as `src/discover/aisearch.ts` (web-search ledger plus `extract_spend`) and skips any job marked as spending once it reaches `PAID_CAP_USD`. No job in the table spends; the check and the numbers are in the status output.

**Status.** The worker serves `GET /` on its port (`PORT`, default 8790): last start, end, result, exit code and last log line per job, what is running and queued, database size, Chromium path, and paid spend against the cap. The same JSON is written to `/var/data/pipeline-status.json`. Logs in the Render dashboard carry a `[job]` prefix per line.

**Run one job by hand.** Render → outset-pipeline → Shell:
```
npx tsx scripts/pipeline.mts --once=sync      # or status, collect, discover, structure, photos, hours, promo, screen, owners
npx tsx scripts/pipeline.mts --dry            # print the schedule
```
`--once` runs the job in the foreground and exits with its code; the scheduler is untouched.

### Testing a claim link locally
Serve the build on port 5199 or 5173. Those are the only local origins the API allows, and on any other
port every call dies in the browser's cross-origin check and the screen shows the same "that claim link
didn't check out" message as a genuinely bad token. Two unrelated faults, one symptom.
