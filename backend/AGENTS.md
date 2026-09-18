# backend

Read `/AGENTS.md` first, then this file.

This is the supply engine. The Vite app shows unclaimed operators across US and Canada metros. Do not mix invented listings into outreach.

## What this service does

1. Store operator profiles with source citations. Every fact has a URL or `seed:tampa-unclaimed`.
2. Scrape public operator websites across a US + Canada metro grid. Honor robots.txt. Never log in. Never invent availability, hours, prices, or eligibility.
3. Score profile completeness the way Uber Eats scores a merchant photo/menu gap, then draft a claim email: we already set you up, finish the missing fields.
4. Keep unclaimed profiles request-only. Instant book is off until the operator claims.

## Product references

- Uber Eats: category chips with `iconKey`, merchant card, completeness gaps, "is this business open/claimable."
- Airbnb: host vs listing, house rules, Instant Book vs request-to-book, location grain.
- Booksy: service menu with duration and nullable price, appointment-style operators (axe, escape, kart, spa-like indoor).

## Hard rules

- Demo rows (`origin = demo`) never get outreach.
- Real rows (`origin = public_site` or `seed`) stay unclaimed until claimed.
- If a scrape cannot find a field, write a gap. Do not guess.
- Do not copy operator photos or marketing copy into the guest catalog. Store facts and our `iconKey` illustration.
- Outreach commands write drafts. They do not send mail.

## Store

Profiles, the email-to-listing index, bookings, payouts and the mail suppression list live in Neon Postgres: `src/db/pg.ts` (pool, schema created on boot) and `src/lib/repo.ts` (every read and write the routes need, row-locked updates, an advisory lock per listing for inserts so two guests cannot take the last spot). `DATABASE_URL` is required to serve. Documents keep their JSON shape in a `doc` jsonb column beside real columns for lookups. The catalog (`public/o/*.json`, `catalog.json`) stays static. A claimed listing's edits reach guests through `GET /profiles/:id` when the listing opens and reach the rails through the nightly sync, which loads them with `loadProfileOverlays` (Postgres, else `GET /listing-edits`). The API never writes to a repository: no edit, claim, booking or unsubscribe makes a commit. `src/lib/store.ts` is read-only.

## Commands

```
cd backend
npm install
npm run ingest
npm run discover          # all US states and CA provinces from OpenStreetMap, cached per area
npm run discover CA FL    # only some areas, by region code
npm run enrich 50 3      # crawl 50 operator sites, 3 at a time, extract facts with Claude (needs ANTHROPIC_API_KEY in backend/.env)
npm run scrape
npm run outreach
npm run sync
npm run dev
```

On macOS, one crawl at a time. `src/scrape/cpu.ts` keeps at least 10% CPU idle: workers pause when the laptop is busy, scale up to 6 fetches when there is headroom, and kill headless Chrome if idle drops under 5%. `npm run cpu` prints the current idle %. All-state discover and the overnight `pipeline` still refuse to start here. Override is `OUTSET_ALLOW_CRAWL=1` and only a human may set it. `npm run chrome:reap` kills Playwright `chrome-headless-shell` plus `/tmp/outset-render-` profiles. Never Google Chrome.app or Cursor.

`npm run discover` pulls named businesses tagged as escape rooms, axe throwing, karting, paintball, skydiving, horse riding, ballooning, parasailing, boat and kayak rental, fishing charters, and boat tours. Rows get `origin = osm`, an `osm_ref`, lat/lon, and the nearest metro within 160 km (else no metro). Domain is the website host, or `osm-<type>-<id>` when the site is missing or is a social page. OSM data is ODbL.

Florida discovery runs on the Render pipeline worker (`npx tsx scripts/discover-florida-ci.mts` from that clone), never on the Mac and never on GitHub Actions: GitHub disabled Actions for the account on 16 September 2026 over the crawl workflows, and only the e2e CI run may live under `.github/workflows`. `scripts/discover-florida-ci.mts` opens no database and writes `data/discovered/florida-{chains,osm,web}.json`: every Florida location of the brands in `src/discover/chains.ts` (franchise location pages, store-locator JSON, sitemaps), OpenStreetMap businesses named for what they do (`src/discover/osmnames.ts`, one Overpass request), and the Brave Search API (`src/discover/braveapi.ts`, only when the `BRAVE_SEARCH_API_KEY` secret is set). Outside CI the script refuses anything bigger than three chains. `npx tsx scripts/import-discovered.mts --dry` shows what is new, by kind and city; it is a dry run by default and inserts with `--write` only candidates that are not already an operator (domain, website, OSM element, phone, name and city, same name or same brand nearby).

`npm run search` is Google Maps discovery (`src/discover/searchapi.ts`): one query per city and Google phrasing,
every result a real listed business with its name, address, phone, website, rating and review count. It is the only
source that reaches businesses OpenStreetMap has never heard of, which is most of them: Silverdale Gun Club in West
Lincoln, Ontario, 829 Google reviews, is in no OSM extract at all. Until 18 September 2026 it had only ever been run
for the first eight water and air phrasings, so ranges, clubs, bowling, escape rooms, spas and classes were missing
from the catalog everywhere. `npm run search --dry-run` prices a run and sends nothing. It costs money, so it runs on
the Render worker on demand and never on a schedule: `npx tsx scripts/pipeline.mts --once=search` in a shell on
`outset-pipeline`, with `SEARCHAPI_KEYS` set there. Answers are cached on disk per term, city and page, so a second
run of the same grid is free. Every billed request is a line in `data/searchapi-ledger.txt`, which `paidSpendUsd()`
adds to the model spend, so `PAID_CAP_USD` sees this money too.

`npm run enrich` is the deep pass. `src/enrich/crawl.ts` fetches up to 8 of the operator's own pages (about, pricing, tours, FAQ, contact, policies), collects public social handles from their links (Instagram, Facebook, TikTok, YouTube, Yelp, TripAdvisor, Google) and detects the booking vendor. `src/enrich/extract.ts` sends the page text to Claude with a fixed nullable schema and a no-guessing prompt. Results land as offerings and facts with `confidence = 'ai'` and a source URL per fact, and are replaced on re-run. Seed rows are never touched. Social networks themselves are not scraped: they are login-walled and their terms forbid it.

Covers are chosen by `src/enrich/photorelevance.ts`, not by whichever photo scored highest. `photoquality.ts` says an image is a photograph; this says whether it is a photograph of this business, reading the file name, the alt text, the page it sat on and the booking item it illustrates against the operator's activity words, and demoting a lone wild animal, a close-up, a staff portrait, merch and a file that turns up on other operators' domains. It runs at photo-crawl time and again in `npm run sync`, so a better cover comes out of a sync with no new crawl. It only reorders: every photo stays in the gallery.

## Claim links expire

A link carries `k=<token>`. New links are `v2.<expiry base36>.<signature>`, signed over the listing id AND the expiry, so the expiry cannot be pushed out by editing the link: changing it invalidates the signature. `CLAIM_LINK_DAYS` sets the life, default 30.

The old token was `HMAC(CLAIM_SECRET, id)` and nothing else: it never changed, never expired, and was identical for everyone who asked for that listing. One forwarded email or screenshot could claim that business forever. That was tolerable for links sent by hand and is not tolerable for a mailing.

Because a v2 token varies with its expiry, the static `claimKey` in `public/o/<id>.json` cannot check it. The app posts the token to `POST /claims/:id/exchange`, which verifies it with the secret and returns an ordinary signed session scoped to that one listing, so every existing auth path keeps working unchanged. Expired answers `410` so the claim screen can say "this link has expired, here is a fresh one" instead of calling a genuine link a bad one; a bad signature answers `401`.

Old static tokens are still accepted by `verifyClaimToken`, so links already sent keep working. They still never expire, which is the reason new ones do. Drop the legacy branch once nothing old is in circulation.

`npm run sync` also writes `data/claim-index.json`: per catalog id, a short hash of the email found on the operator's site (never the address), the domains the operator owns, and a masked hint. The API host has no SQLite, so this file is how `POST /claims/:id/request` decides whether the address an owner typed may receive the claim link (exact match with the on-file email, or any address at the operator's own domain; site builders and free mail never count). Ids missing from the file fall back to the domain in `public/o/<id>.json`. `npm run claim-index` writes only this file. Commit it after a sync.

`npm run sync` also writes `../public/catalog.json` (every real operator in the app's Unclaimed shape plus contacts) and regenerates `../src/data/contacts.ts` from the operators table. Contact fields (phone, email, street, postal, hours) come only from the operator's own site. Phones are normalized to E.164. `GET /contacts` and `GET /contacts/:domain` serve the same payload live.

API listens on `http://localhost:8787`.

## Test claim bypass (testing only, off by default)

The claim rule above is a product rule and stays. `OUTSET_TEST_CLAIM_EMAILS` is the one way around it, and it exists so the operator side can be walked end to end without owning a business's inbox.

```
OUTSET_TEST_CLAIM_EMAILS=malharshah200428@gmail.com,harshils2340@gmail.com
```

Unset or empty (the default, and what `render.yaml` ships) the bypass does not exist: `POST /claims/:id/request` takes exactly the branch it took before, and the two test routes answer 404. It cannot go live by accident, only by someone setting this variable on that host.

What it changes, for the listed addresses only:

- `POST /claims/:id/request` still runs the real check first. If the real check says no and the address is on the list, a second, separate branch approves it, prints `TEST CLAIM BYPASS: <email> claiming <id> from <ip>`, and emails the same signed link. Any other address is rejected exactly as before, with the same reason, hint and domains. Nothing is loosened.
- `GET /claims/test-status?email=` answers `{ active: true }` for a listed address, `{ active: false }` for every other. The operator claim screen calls it before it shows any test UI, so a normal visitor never sees one. It never lists the allowlist.
- `POST /claims/:id/test-unclaim` with `{ email }` releases a listing: deletes its `profiles` row and its `profile_emails` links in Postgres, which is what "claimed" means on this side. 404 for anyone not on the list, logged the same loud way. The app clears the matching on-device profile, claim token and session at the same time, so the business is genuinely unclaimed again.
- `POST /claims/:id/test-enter` with `{ email }` opens the dashboard with no claim link at all. It answers with an ordinary signed session scoped to that one listing, the same shape `/auth/verify` returns. 404 for anyone not on the list, logged the same loud way.
- On a host with no mail transport at all (no `RESEND_API_KEY`, no `MAIL_SMTP_USER`) a bypassed request also returns the link in the reply, so a laptop with no mail can finish the flow. On any host that can send, the link only goes to the inbox.

Set `SITE_URL=http://localhost:5173/` while testing locally, or the link points at production.

### Why test-enter exists

A claim link carries `k=<token>`, and the app checks it against the `claimKey` baked into `public/o/<id>.json`. That key is `sha256(HMAC(CLAIM_SECRET, id))`, written when the production sync ran on Render. `CLAIM_SECRET` is `sync: false`, so a laptop that does not have it generates its own into `data/claim-secret.txt`, and every link it mints hashes to something the catalog has never seen. The claim screen then says "that claim link didn't check out" for every business, no matter how the link was requested. Getting a link and using a link are two different gates, and the bypass only ever covered the first.

`test-enter` skips the token instead of trying to forge one. Sessions are signed with `claimSecret()` by the same process that verifies them, so they work on any host without matching production. Copying the production `CLAIM_SECRET` to a laptop also works and makes links validate, but it puts a production secret on a dev machine, which is why this route is the better default.

The code lives in `src/lib/testClaim.ts` and one marked branch plus three marked routes in `src/api/claims.ts`.

## Prices on a listing

If a guest can see a price on the operator's own website, the listing must show it, and a menu must be consistent: one line per service and tier, never the same tier once priced and once "Price on request". Three places enforce this, and every one has a story behind it (14 September 2026, 416 Jet Skis and Seakart Adventure):

- `src/enrich/crawl.ts` `visibleText` keeps inline text (`<strong>$130</strong>`) on the line that names it. `npm test` runs the regression test; keep it green when touching the extractor.
- `src/enrich/sitescrape.ts` `harvestPrices` attaches tier-only rate cards ("Weekdays · Hourly $130") to the activity the page sells instead of a service called "Hourly".
- `src/enrich/structure.ts` lets a site read with prices into the database even when an earlier extraction left unpriced rows, and `src/sync/contacts.ts` shows one line per service and tier, drops an unpriced source when another source read prices, gives a rate card one unit, and retires a "prices not stated" gap line once any line is priced.

Before calling a listing done, open the operator's pricing page and compare.
