# Go live: the five keys

Everything below is built, tested end to end locally, and switches on the moment the key is set. No code changes needed.

## 1. API host (Render, free tier)
1. render.com → New → Blueprint → pick `harshils2340/outset-app`. It creates `outset-api` from `render.yaml`.
2. Set these environment variables on the service:
   - `CLAIM_SECRET`: the contents of `backend/data/claim-secret.txt` on the Mac (same secret the emailed claim links were signed with; if you rotate it, regenerate drafts).
   - `GITHUB_TOKEN`: a fine-grained GitHub token, repository `outset-app`, permission Contents: read and write. Profiles and bookings are stored as JSON in the repo and the site rebuilds on each write.
   - `RESEND_API_KEY`: from resend.com (free tier covers 3,000 emails a month). Until `onoutset.com` is verified in Resend, keep `MAIL_FROM` as `Outset <onboarding@resend.dev>` (samples to yourself only). After verifying, set `MAIL_FROM` to `Outset <hello@onoutset.com>`.
   - `MAIL_POSTAL`: a real street address printed at the bottom of claim emails. Required before any send to businesses.
3. Copy the service URL (for example `https://outset-api.onrender.com`).

## 1b. Card payments (Stripe)
1. dashboard.stripe.com → Developers → API keys → copy the Secret key (`sk_test_...` to demo, `sk_live_...` for real money). Set it on the Render service as `STRIPE_SECRET_KEY`.
2. Developers → Webhooks → Add endpoint → URL `https://<your render url>/stripe/webhook`, events `checkout.session.completed` and `checkout.session.expired`. Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
3. That is all. From then on "Book" becomes "Book and pay": the guest lands on Stripe's hosted page, the card is held, the operator gets the request, the money is captured when they accept and released when they decline. Instant-book listings capture at once. With no key, bookings fall back to pay on site.
4. Payouts to operators: the platform account receives the money today; pay operators from the Stripe dashboard until Stripe Connect is switched on (next step once the first operators are live).

## 1c. Admin key
Set `ADMIN_KEY` on Render to any long random string. The internal routes (raw operator rows, outreach drafts) then only answer to requests carrying `x-admin-key`; without it they are closed on the public host.

## 2. Point the site at the API
GitHub repo → Settings → Secrets and variables → Actions → Variables → new variable `VITE_API_URL` = the Render URL. Push anything (or rerun the "Deploy site" workflow). The site then signs in, saves and books through the API.

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
| 23:00 | structure | `structure 5000 8` |
| 00:00 | photos | `photos 5000 8` |
| 01:00 | hours | `scripts/hours-crawl.mts 5000 10` |
| 02:00 | promo | `scripts/promo-crawl.mts --limit=5000` |
| 03:30 | screen | `scripts/screen-covers.mts` |
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
