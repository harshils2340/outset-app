# Crawl and fetch trust security review, 16 September 2026

Scope: what the crawl and the API fetch and trust, end to end, from the moment a URL comes
from an operator's own (possibly hacked) website or a vendor's JSON up to what the nightly
sync is willing to publish. Two other sessions covered the site's rendering and the API's
keys and workflows.

Why this review exists: a crawl published Indonesian gambling SEO spam from hacked operator
websites as listing text and cover photos on 97 listings (`docs/bug-bash/2026-09-16-pipeline-catalog.md`,
the `SPAM_LINE` rule it added in `backend/src/sync/contacts.ts`). The operators' own sites had
been hacked and the crawl trusted them completely. This review treats every website the
crawler visits and every URL stored in the data as hostile.

## Checked

- Every place in `backend/src/` that calls `fetch()` directly or through `fetchHtml`, sorted
  into "fixed developer-chosen endpoint" (Overpass, Nominatim, Google Places, Brave Search,
  Stripe, Resend, GitHub, vendor SaaS hosts reached only through a suffix-anchored regex on a
  crawled booking URL) versus "the host itself comes from crawled or stored data." See
  `backend/src/lib/safeFetch.ts` and the commit below for the full list and what changed.
- `backend/src/scrape/fetch.ts`'s `fetchHtml`, the crawler's one shared entry point (used by
  `enrich/crawl.ts`, `enrich/locations.ts`, `enrich/reviews.ts`, `enrich/sitescrape.ts`, and
  `discover/polite.ts`'s `getPage`/`getJson`, and everything built on those, including
  `discover/chains.ts`): had a robots.txt check and a timeout, and nothing else. No DNS
  resolution check on the host it was about to connect to, `redirect: "follow"` with no
  re-check of where a redirect actually landed, and an unbounded `res.text()` read. Only
  `enrich/sitescrape.ts` had its own one-off DNS lookup, and it only covered the crawl's start
  URL, never a redirect or a later page in the same crawl.
- `backend/src/enrich/imagesize.ts`'s photo-header probe: same gap, a direct `fetch()` on a
  stored photo URL with a `Range` header but no host check and no cap beyond the reader loop's
  own early stop.
- `backend/src/lib/store.ts`'s GitHub content-API fallback: fixed host (`api.github.com`), so
  not an SSRF target itself; its `relPath` argument reaches a local `fs.join` too, though every
  caller already validates the id with `ID = /^[a-z0-9-]{3,80}$/` (`backend/src/api/auth.ts`)
  before it gets there, so a traversal path never actually reaches it today.
- Vendor readers (`backend/src/enrich/vendors/*.ts`, `widgets.ts`, `availability.ts`,
  `api/availability.ts`): every one builds its request URL from a fixed literal host
  (`fareharbor.com`, `book.peek.com`, `xola.com`, `*.rezdy.com`, `*.resova.(us|com|eu)`,
  `*.checkfront.com`, `*.square.site`, `*.acuityscheduling.com`, and similarly for the rest),
  with only a path segment read out of the operator's own booking URL through a regex anchored
  to that vendor's own id format. None of these let a crawled page choose an arbitrary host.

## Found and fixed

- `7cb833db7` Nothing in the crawl or enrich pipeline checked where a fetch actually
  connected. A hacked operator page, or a vendor's JSON response, naming
  `http://169.254.169.254/latest/meta-data/`, `http://localhost:6379/`, or an address on the
  service's own private network in an `<img src>`, a `<meta refresh>`, a redirect `Location`,
  or a JSON field the crawler follows, would have made this server issue that request with no
  check at all; and a slow or enormous response had nothing capping how much of it got read
  into memory before being handed to cheerio or an extractor. Added
  `backend/src/lib/safeFetch.ts`: only `http`/`https`; every hop (the initial request and each
  redirect it follows, checked manually rather than via `redirect: "follow"`) has its host
  resolved and checked against loopback, the RFC 1918 private ranges, link-local (which
  carries the cloud metadata address `169.254.169.254`), carrier-grade NAT (`100.64.0.0/10`),
  the IPv6 equivalents, and `.local`/`.internal`/`.localhost`/bare-hostname names, before a
  connection is made; and a hard byte cap on the body regardless of what `Content-Length`
  claims. `fetchHtml` now goes through it, which is every crawler's shared choke point, so
  `crawl.ts`, `locations.ts`, `reviews.ts`, `sitescrape.ts`, and `discover/polite.ts`'s
  `getPage`/`getJson` (and `chains.ts`, which is built entirely on those two) are covered by
  one change. `enrich/imagesize.ts`'s photo-header probe and `store.ts`'s local-path fallback
  got the same treatment (the latter as defense in depth, tightening `SAFE` to also refuse
  `..` path segments, since it is not reachable with a bad path today).
  `backend/src/lib/__tests__/safeFetch.test.ts` covers every blocked range and name suffix,
  that a redirect's own target gets re-checked (not just the URL a fetch started with), that a
  body over `maxBytes` is refused, and that an ordinary same-host response still comes back
  with its body and final URL intact, all against a local test server or a fake resolver, no
  real network access.

(updated as the review continues)

## Found, not fixed

(updated as the review continues)

## Needs Harshil

(updated as the review continues)
