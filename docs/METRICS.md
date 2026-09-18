# The internal metrics page

One private page for the founder: how much outreach went out and what came back, how many listings are claimed,
every booking, the money earned, the money spent to earn it, and each of those as a line over time. Nobody else
sees it, and nothing it reports is exposed on any guest or operator route.

## Who can read it

`GET /admin/metrics` answers two kinds of caller, and **404** to everyone else. Not 403: a 403 would confirm the
route exists to whoever is guessing at it.

1. **A session whose email is in `ADMIN_EMAILS`.** The browser signs in the way an operator does, with a code
   emailed to the address (`POST /auth/request-code`, then `POST /auth/verify`, which returns a session token the
   page sends as `x-session`). No secret is ever typed into a page or put in a URL. An admin address normally has
   claimed no listing, so `/auth/request-code` sends a code to an address on the list even when it owns nothing.
2. **`x-admin-key`**, the same key the rest of the internal tooling uses, for curl.

`ADMIN_EMAILS` is comma separated, trimmed and lowercased. **Unset means nobody**: with no value the session door
is closed, which is the right default for a public host. Set it on the **outset-api** service in Render
(Environment → Add environment variable); it is in `render.yaml` with `sync: false`, so Render does not carry it
between environments and it is never in the repo.

```
ADMIN_EMAILS=harshils2340@gmail.com
```

The route is mounted in `backend/src/api/routes.ts` **above** the blanket `x-admin-key` middleware, on purpose:
that middleware answers 404 to anything without the key, which would close the session door this route exists to
open. It does its own check instead (`isAdminRequest` in `backend/src/api/metrics.ts`).

## Curl it

```
curl -s -H "x-admin-key: $ADMIN_KEY" 'https://outset-api.onrender.com/admin/metrics?days=30' | jq .
```

`days` defaults to 90 and is clamped to 1..365. Every `byDay` array has one entry per day in the window,
ascending, including the days nothing happened on, so a chart can plot it straight.

## What the numbers mean

- **money.gross** counts only bookings whose payment state is `captured`, money actually taken. `authorized` is
  held on a card and not taken, and is never counted as revenue. `fee` is Outset's cut, `operatorNet` is the
  rest, and the two add back up to gross exactly (the net is derived from the two published figures, not from
  the unrounded sums, so the page cannot show arithmetic that does not work). Every money figure is dollars
  rounded to cents, never cents-as-integer.
- **money.refunded** is money that was taken and given back. A hold released before capture was never taken, so
  it is not a refund; the two are told apart by the payout, which only exists once a card has been captured.
- **money.\*** totals are lifetime; **money.byDay** covers the window. Same for `bookings.total` (lifetime)
  versus `bookings.inRange`.
- **claims.claimed** is the number of rows in `profiles`, one per claimed listing. `catalog.unclaimed` is the
  catalog total minus that.
- **catalog.total** is the published catalog (`public/catalog.json`, ~59,000 listings). It is read off a stream
  once an hour, never parsed: the file is 23 MB and the API is on a free instance. `catalog-lite.json` is *not*
  a smaller copy of it, it is the top 2,200 listings the home rails load first, so it is never counted.
- **catalog.reachable** is the listings in that catalog we hold an email for (`public/claim-index.json` entries
  with a `k`), narrowed to ids that are actually published: the claim index also covers operator rows that are
  not in the catalog, and counting those would put more businesses at the top of the funnel than exist to claim.
- **Anything unknown is `null`, never 0.** If a catalog file is not in the checkout, the count is null and
  `catalog.note` says which file and why. Zero and "could not read it" mean opposite things.

## What it costs

`costs` is money **out**. It is never added to `money`, which is money in: one is what guests paid, the other is
what Outset paid to find the businesses they booked. The page draws them in different colours, in different
sections, and never in one chart.

```
"costs": { "currency": "usd",
           "discovery": 34.89, "extraction": 5.92, "compute": null, "total": 40.81,
           "asOf": "2026-09-18T06:00:12.000Z",
           "note": "Compute: Running now: outset-api (web_service, free), ... Render's public API has no cost, billing or invoice endpoint.",
           "byDay": [{ "day": "2026-09-18", "discovery": 0.5, "extraction": 0.1 }],
           "perClaim": 0.1, "perBooking": 0.34,
           "capUsd": 60, "capUsedPct": 68,
           "computeRunRateMonthly": null }
```

- **discovery** is paid search: the Google Maps SERP ledger (`backend/data/searchapi-ledger.txt`, priced per
  provider by `PRICE_PER_1K_USD` in `backend/src/discover/searchapi.ts`) plus the model web-search ledger
  (`backend/data/aisearch-ledger.txt`, about 2.5 cents a call plus $2 per million tokens).
- **extraction** is `SUM(usd)` over the `extract_spend` table in the worker's SQLite database.
- **compute** is **always null**, and the note says why. Render's public API has no cost, billing or invoice
  endpoint of any kind: checked on 18 September 2026 against its full published API index, where the only
  metrics endpoints are CPU, memory, bandwidth and disk, with a physical unit and no currency anywhere. The
  note instead names, from `GET /v1/services`, which services are actually running and on which plan, because
  that is a fact the API will answer for. Multiplying plan list prices would produce a confident number that is
  not a bill (no disk, no bandwidth, no credits or proration), and a wrong figure on a unit-economics page is
  worse than an empty one. `backend/src/lib/renderCost.ts`, cached an hour, five minutes on a failure. The key
  is read server-side only and never goes near the browser.
- **total** is the sources that reported, and is null when none did. The note names what is missing from it.
- **perClaim** is total ÷ `claims.claimed`, **perBooking** is total ÷ `bookings.total`, both lifetime so they
  match the lifetime spend. **A zero denominator is null**, never Infinity and never a zero: the first business
  to claim did not cost nothing, we just cannot divide yet.
- **capUsedPct** is discovery + extraction against `capUsd` (the worker's `PAID_CAP_USD`). Hosting is not under
  that cap, so it is deliberately not in the numerator. Over 100% is shown as over, not clamped.
- **byDay** covers the window, filled, ascending. It is empty (not a row of zeros) when no snapshot exists. The
  days need not add to `total`: a ledger line written before the timestamp column existed counts in the total
  and belongs to no day.
- `asOf` is when the **worker** read its ledgers, not when the page was generated.

### How the spend gets to Postgres

The same wall as outreach: discovery and extraction are counted in files and SQLite on the pipeline worker's
disk, which the deployed API cannot read. So the worker posts them.

`POST /admin/spend` takes `{discovery, extraction, total, capUsd, at, byDay:[{day, discovery, extraction}]}` and
replaces the single row in the Postgres table `spend_snapshot` (`backend/src/lib/spendLog.ts`). It is behind the
**same gate** as `GET /admin/metrics`: the admin key or an `ADMIN_EMAILS` session, and 404 for everyone else. The
posted `total` is not believed — it is recomputed from the two parts, so the three figures can never disagree —
and a body with a NaN, a negative, or more than 400 days is 400 and changes nothing.

```
curl -s -X POST -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"discovery":34.89,"extraction":5.92,"capUsd":60}' \
  https://outset-api.onrender.com/admin/spend
```

The nightly pipeline does it at **06:00**, after the 05:00 sync, as the `spend` job
(`backend/scripts/report-spend.mts`, run from the repo clone like every other job). It reads `paidSpendUsd()` and
`paidSpendByDayUsd()` from `backend/src/discover/aisearch.ts` — never a ledger on its own, which would miss the
Google Maps requests entirely — and it **cannot fail the pipeline**: no key, no `API_URL`, no network or a
non-200 is one line on stdout and exit 0. Run it by hand with
`npx tsx scripts/pipeline.mts --once=spend`.

### Two environment variables on the worker

Both go on the **outset-pipeline** service (they are in `render.yaml` under it):

| Variable | Value | Why |
| --- | --- | --- |
| `ADMIN_KEY` | the same value as on outset-api and outset-payouts | opens `POST /admin/spend` |
| `API_URL` | `https://outset-api.onrender.com` | where to post it (already in `render.yaml` as a plain value) |

Without them the job is a no-op and the page shows "not tracked yet" with the reason, never a false zero.

Spend figures are **not** published anywhere in the repo or under `public/`: harshils2340/outset-app is a public
repository, and what the business spends is not world-readable. It lives in Postgres and on this page only.

## Where the numbers come from

Postgres only. SQLite (operators, outreach drafts) lives on the pipeline worker's disk and on the laptop; the API
host has neither, so a figure read from there would be zero on the deployed service.

That is why a send now writes to both: `backend/src/lib/outreachLog.ts` records a row in the Postgres table
`outreach_log` (a **hash** of the address, never the address, the same hash the suppression list uses, because
this is a marketing list), beside the SQLite row `sendOutreach` already writes. Bounces and complaints from the
Resend webhook are recorded the same way, next to the suppression they already write, so `outreach.bounced` and
`outreach.complained` are real numbers. None of it can throw into a send: an email that has gone out has gone
out, whatever the database says. A send made before this shipped is not in Postgres and is not counted.

Counting is done by the database (grouped rows per day, status and payment state) and Node only adds those small
rows up, because the service runs behind a ten-second statement timeout.
