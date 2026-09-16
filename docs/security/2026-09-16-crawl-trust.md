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
- `backend/src/api/uploads.ts`: magic-byte check for JPEG/PNG (so SVG and any non-raster upload was already
  refused, confirmed, no change needed there), a byte-size cap, and (new, see below) a pixel-dimension cap
  and EXIF/text metadata stripping.
- `backend/src/lib/mail.ts` and every `sendMail` caller (`api/auth.ts`, `api/bookingMail.ts`, `api/claims.ts`,
  `outreach/drafts.ts`, `outreach/send.ts`): which fields carry crawled operator names versus guest-typed
  input versus developer-configured constants, and whether any of them are ever composed into a
  `"Name <email>"` display-name string before reaching a header (they are not, anywhere in this codebase;
  `to`/`replyTo` are always bare addresses).
- `backend/scripts/pipeline.mts`'s commit-and-push step, and `backend/src/sync/contacts.ts`'s
  `syncContactsToApp` (the generator for the one committed `.ts` source file, `src/data/contacts.ts`); see
  **Needs Harshil** for what this confirmed.

## Found and fixed

- `6cc841195` Nothing in the crawl or enrich pipeline checked where a fetch actually
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

- `63ff9b3f9` `SPAM_LINE` (in `backend/src/sync/contacts.ts`) only recognized Indonesian gambling phrases,
  only checked blurb-like text facts, and dropped only the offending fact, so everything else a hacked page
  produced (its other text, its offerings, a photo whose own address carried no spam word) still published.
  A hacked WordPress page can inject pharmacy, essay-mill, crypto/forex, adult, replica-goods or loan spam
  just as easily as gambling, in whatever language the injected page used, and once one fact off that page is
  proven spam the rest of it is no more trustworthy. Added `isCompromisedText`: the broadened `SPAM_LINE`
  covers those categories in English, Indonesian, French, Spanish and Vietnamese (`\b`-delimited scripts);
  `HACKED_SCRIPT_SPAM` covers the same categories in Russian, Japanese and Chinese, matched as a plain
  substring since `\b` does not delimit those scripts correctly; `isKeywordStuffed` catches a long phrase
  repeated so densely it dominates the field (a spam generator's signature); `hasRepeatedSuspectWord` catches
  a handful of single spam words (casino, jackpot, judi, togel...) packed tightly together, for spam no
  phrase list would name. A run of a script a fact has no business carrying (`FOREIGN_SCRIPT_RUN`) counts
  only when it is isolated to one fact or offering; found by the scan below, three real bilingual operators
  (two Hawaii tour desks, a dojo with a bilingual instructor bio) would otherwise have been wrongly
  quarantined for carrying the same language across more than one of their own facts, which is a deliberate
  feature of the listing, not an anomaly. Once any fact or offering trips the screen, the whole operator is
  quarantined for that sync: no crawled text, offering or photo publishes, but the operator's row (so its
  claim link) is untouched, and the id and reason are logged (`console.warn` plus `CleanupLog.quarantined`).
  `backend/src/sync/__tests__/compromisedText.test.ts` covers every category, both repetition signals, and
  the near-misses that must stay: a booking page's "book your slot", a brewery's "Casino Night", a pharmacy
  walking tour, French and Spanish operators, a business literally named "Casino Parties LLC", and an RV park
  whose own copy describes a real on-site casino.

  Scanned the currently published `public/o/*.json` (59,162 files) and `public/catalog.json` with the new
  screen under `/tmp`, read-only, nothing under `public/` edited by hand: **101** listings in `public/o/` and
  **13** in `catalog.json` would now be caught by the next sync, up from the 97 the original gambling-only
  `SPAM_LINE` found (some of the added catches carry spam only in a photo address or an offering name that
  `SPAM_LINE` alone never read). The ids `public/o/` would quarantine:

  ```
  o-345artgallery-com o-aberrantart-com o-alewifequeens-com o-amanayogaboulder-com o-amherstfarmwinery-com
  o-apopkamuseum-org o-artwestchicago-com o-backboneboulder-com o-barefootmovement-com o-barrecentric-com
  o-beauregardmuseum-org o-bethelislandgolf-com o-birthplaceofthefrog-com o-caldwellcountyhistoricalcommission-org
  o-cannonbeachdistillery-com o-canoe-kayak-com o-captnjoeslakeadventures-com o-carrefouratlantic-com
  o-cdariverwalkrvpark-com o-cherokeemuseum-org o-cherokeesmokies-com o-cliffhousetexas-com o-columbusclocktower-com
  o-cordovagc-com o-countylinegolfcourse-com o-crsgym-com o-crystalbeachjetski-com o-cteastrrmuseum-org
  o-dadecityheritagemuseum-org o-danceashburn-com o-dancestudioofmainesouth-com o-desertoasisrvparknm-com
  o-dogmasterdistillery-com o-eecenterforevents-com o-escapemysterymanor-com o-extremeairgymnastics-com
  o-fairlawngolfcourse-com o-fausettfarmshorsetrails-com o-firemensmuseum-com o-floodedriveranch-com
  o-gobodysquad-com o-grandoldgolf-net o-greenvilleshrineeventcenter-com o-hackersgolfandgames-net
  o-haddamshadmuseum-com o-hastingscampground-com o-hattricktrainingcenter-com o-henrycountymomuseum-org
  o-heritageavonlake-org o-heroesbrewco-com o-hookandflaskstillworks-com o-hunterspointgolf-com
  o-infinityroomsalem-com o-isccherryhill-com o-islandchillyachtcharters-com o-jetedancecompany-com
  o-kayakpenderisland-com o-kettlerockbrewing-com o-kofqbanquethall-net o-lazylakesrvresort-com
  o-littlewhiteschoolhouse-com o-loltimessquare-com o-mainstreetarmory-com o-markethousemuseum-com
  o-msamuseum-ca o-ncbarnwedding-com o-northclarkhistoricalmuseum-org o-nycbarbershopmuseum-com
  o-ocracokepreservation-org o-oranjfitness-com o-oungrepark-com o-pechevm-com o-pictonharbourboattours-com
  o-prairielandheritage-com o-rialtohistoricalsociety-org o-ritzwinterhaven-com o-riveredgervpark-com
  o-robbinshistorymusuem-org o-rockysfitnesscenter-com o-rosshillpark-com o-route66museum-org
  o-royalpalacebanquet-net o-salidagolfclub-com o-sanduskycountyhistory-org o-shediacpaddleshack-com
  o-stjamesmuseum-com o-sunpilates-co o-suskyriver-com o-tenfiftyeightevents-com o-theaxelodge-com
  o-thejoyofdancingsanjose-com o-thelibbymuseum-org o-themeadowsbanquet-com o-themoorage-com
  o-timberviewgolfclub-com o-topgunparasail-com o-tri-citycurlingclub-com o-uslightshiprelief-org
  o-wchandymemphis-org o-westohiocamps-com o-windsorgymnastics-org
  ```

- `6cc841195` See **SSRF and hostile URLs** above; the same commit covers item 2's fixes.

- `3783bf316` `publishableImage` (`backend/src/sync/imageUrl.ts`), the last gate before a stored photo fact
  becomes a listing's cover or gallery image, never checked the URL scheme at all: for a `data:` URL,
  `new URL(u).hostname` is `""`, which the private-host regex never matches, so a `data:`/`blob:`/`javascript:`
  URL would have published unchanged. The private-host list was also IPv4-only plus a bare `::1`, missing the
  `100.64.0.0/10` carrier-NAT range and IPv6 link-local/unique-local. Separately, a stored photo can already
  be a `wsrv.nl` (`images.weserv.nl`) address when the operator's own site uses that free image proxy as its
  own CDN; wsrv's own `errorredirect` parameter sends a guest's browser to any URL the page names if the
  image fails to load, an open redirect riding what looks like an ordinary photo address, and nothing
  stripped a query parameter this codebase's own wrapping never sets. Fixed: scheme restricted to
  `http`/`https`, the private-host list extended, and a `wsrv.nl`-hosted address now refuses any query
  parameter outside a small allowlist. `backend/src/sync/__tests__/imageUrl.test.ts` covers all three.

- `e46cb5185` `backend/src/api/uploads.ts` already checked magic bytes and a byte-size cap, but not a claimed
  pixel size (the browser resizes to 1600px before sending; the server should never legitimately see much
  more, and a header can claim a size the file's own compressed bytes have nothing to do with, a
  decompression-style resource hog once anything tries to decode it) or metadata (a phone photo's EXIF often
  carries GPS coordinates the uploader never chose to publish, and this storage path commits straight to the
  public repository, permanent). Added `backend/src/api/imageSanitize.ts`: `dimensionsTooLarge` (reuses
  `enrich/imagesize.ts`'s own header parser, refuses over 4000px on a side or 16 megapixels) and
  `stripJpegMetadata`/`stripPngMetadata`, which walk the file's own marker/chunk structure and drop JPEG
  APP1 (EXIF/XMP) and APP13 (Photoshop IRB/IPTC) segments, or PNG `tEXt`/`zTXt`/`iTXt`/`eXIf`/`tIME` chunks,
  leaving everything that affects decoding untouched; either bails out and returns the original bytes
  unchanged the moment anything does not parse as a well-formed marker, so a real photo can never come back
  truncated. `uploads.ts` now checks dimensions and strips metadata before hashing and storing.
  `backend/src/api/__tests__/imageSanitize.test.ts` covers the strip on a GPS-shaped payload, an unchanged
  file with no metadata, malformed input never throwing, and the dimension cap against an ordinary and an
  oversized claim. SVG and non-raster uploads were already refused by the existing magic-byte check;
  confirmed, no change needed.

- `f77df3e7f` Every vendor reader (`enrich/availability.ts`'s FareHarbor/Peek/Xola price lookups and the nine
  files under `enrich/vendors/`) called the global `fetch()` with a timeout but no byte cap, so a
  compromised or just-buggy vendor server sending an enormous or slow-trickling response would have been
  read in full into memory. Swapped every one of those `fetch()` calls (sixteen call sites across ten files)
  for the guarded `safeFetch` added for item 2, with a 5 MB cap; `enrich/vendors/bookeo.ts` is the one
  deliberate exception (its own manual redirect-following loop carries cookies across hops, and `safeFetch`
  already follows redirects internally, so routing it through there would double up). Deep JSON nesting and
  huge parsed arrays are bounded by the same byte cap, and every `JSON.parse`/`res.json()` call in these
  files was already inside a `try`/`catch` that returns `null` on any parse failure, so a pathological-input
  exception degrades the same way a timeout or a 500 already does. None of these vendor readers parse HTML
  with cheerio (they extract with plain string matching), so there is no unbounded-cheerio-parse risk here
  to cap separately.

- `dc8f05205` A crawled (and sometimes hacked) operator's own name reaches a mail subject line unescaped
  (`` `Your Outset claim link for ${title}` ``, `claims.ts`; `` `Booking ... for ${ctx.title}` ``,
  `bookingMail.ts`), and a guest's own booking-form input reaches `replyTo` the same way, with `mail.ts`
  itself doing no sanitizing of its own at the one chokepoint every send goes through, whatever protection
  Resend's JSON body or nodemailer's own header composer happen to already have (a pre-existing regression
  test, `mailHeaderInjection.test.ts`, already showed nodemailer folds a raw CRLF into the header rather than
  starting a new one; that test predates this review). `sendMail` now folds any CRLF in the subject to a
  space, drops a malformed `replyTo` silently rather than aborting the whole send over optional metadata, and
  validates `to` with an explicit bare-address check (no whitespace, no `<>`) in place of the old regex.
  Extended `mailHeaderInjection.test.ts` with three more cases.

## Found, not fixed

- **One known false positive in the broadened compromised-site screen**: `o-islandchillyachtcharters-com`'s
  `extraNote` field concatenates eight separate real policy lines with " · " ("Booking/Reschedule/Cancellation/Refund
  Policy available on site · Safety Policy available on site · ..."), and the repeated three-word phrase
  "policy available on site" is dense enough to trip `isKeywordStuffed` even after the rate-card false
  positives it originally caught (a Quebec pontoon operator's per-tier rate card, a scout camp's weekly class
  schedule, several others, all confirmed fixed by scoring stuffing on offerings with the narrower
  `isCompromisedPhrase` instead) were tuned out. The underlying issue: `extraNote` is built by joining several
  independent facts with a separator, so a phrase repeated once per fact reads as "stuffed" the same way a
  spam generator's repeat does. A real fix wants stuffing checked per source fact before the join, not on the
  joined string; that is a larger change to where `extraNote` is assembled than fit in this pass. Cost of
  leaving it: this one real yacht-charter listing loses its crawled facts until someone loosens the rule or
  hand-clears it; the operator's row and claim link are unaffected.
- Two long-tail junk-not-spam cases the compromised-site screen also now catches, where quarantining is a
  defensible but not clearly correct call: `o-scene75-com` and `o-easttnscouts-org`, where a scrape glitch
  repeated a nav label or menu heading dozens of times in one offering description ("LASER TAG LASER TAG..."),
  and `o-rfcity-org`, which has what looks like binary or corrupted-encoding bytes in one service description.
  Neither is a hacked page; both are already-unusable content either way, so the quarantine's cost here is
  low, but it is worth a human glance rather than assuming every catch is a hack.
- The compromised-site screen is regex- and heuristic-based, not a language model reading the page, so it
  will miss a hacked page whose injected spam uses none of the phrases, scripts or repetition shapes covered
  here (a hand-written new category, a language not covered, a single non-repeated sentence of prose spam).
  It is a large improvement over the single gambling-phrase rule it replaces, not a guarantee.
- `safeFetch`'s private-address check only covers a literal IP in a URL or one a DNS lookup resolves to at
  fetch time; `publishableImage` (item 3) is synchronous and checks only a literal IP in the stored URL
  string, with no DNS resolution at all (converting it to an async, DNS-backed check would touch every one
  of its many call sites in the sync/enrich pipeline, a much larger change than fit in this pass). A domain
  name that resolves to a private address is caught by `safeFetch` wherever the crawler actually fetches it,
  but not by `publishableImage`'s own name-based check on a URL that is merely stored and never re-fetched.
- Upload storage (item 4): an operator's photo, once accepted, commits straight to the public GitHub
  repository (`backend/src/api/uploads.ts`'s `storeBinary`), permanent and with no redaction path short of a
  history rewrite. That is a product/infra decision, not a code-level gap this pass could fix; see **Needs
  Harshil**.

## Needs Harshil

- 96 real operators (a Chicago art gallery, golf courses, museums, RV parks) already have a hacked website
  right now, serving spam to anyone who visits, this crawler included (noted in the 16 September 2026 bug
  bash report too, before this pass broadened the screen past gambling). This pass stops the catalog from
  republishing any of it, in any of the categories above, but the operators' own sites are still compromised.
  Same suggestion as that report: a one-line "your website may have been compromised" email to each, separate
  from anything this pipeline can do.
- The `o-islandchillyachtcharters-com` false positive above, and whether the two junk-not-spam cases are worth
  a narrower rule (skip `isKeywordStuffed` on a field that is a "·"-joined concatenation of several distinct
  facts, and check stuffing per source fact instead) or are fine left as occasional manual review.
- Whether operator photo uploads should keep committing straight to the public repository forever, or want a
  moderation/redaction path (a private object store with a public read URL, say) now that uploads are
  magic-byte-checked, dimension-capped and stripped of EXIF/text metadata but still permanent once merged.
- `backend/scripts/pipeline.mts`'s commit step: checked, not changed. `git add -A` is scoped to a fixed
  `PUSH_PATHS` allowlist (`public/catalog.json`, `public/claim-index.json`, `public/catalog-lite.json`,
  `public/o`, `public/p`, `public/sitemap.xml`, `src/data/contacts.ts`), so a hacked page cannot make the
  job stage or commit anything outside those catalog outputs; the commit message is a fixed string, never
  interpolated with crawled data; and `src/data/contacts.ts`'s generator (`syncContactsToApp`,
  `backend/src/sync/contacts.ts`) writes every value through `JSON.stringify`, never raw string
  interpolation, so crawled text cannot break out of a string literal into executable code in that generated
  file. `buildCatalogItems()` maps every operator through `toCatalogItem` with no per-row `try`/`catch`, so
  an exception anywhere in the screen (this review's new code included) throws out of the whole `sync`
  command, which exits non-zero, which `runSyncAndPush` checks before any `git add`/`commit`/`push` runs: a
  screen failure already fails the job rather than publishing partial or unscreened output. Confirmed by
  running `npm run ingest && npm run sync` locally (38 seed operators, no crash, no false-positive
  quarantine, output discarded with `git checkout -- public src/data` after, per instructions) rather than
  by reading the code alone.
