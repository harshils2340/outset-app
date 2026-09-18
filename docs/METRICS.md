# The internal metrics page

One private page for the founder: how much outreach went out and what came back, how many listings are claimed,
every booking, the money, and each of those as a line over time. Nobody else sees it, and nothing it reports is
exposed on any guest or operator route.

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
