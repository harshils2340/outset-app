# Bug bash, 16 September 2026: the pipeline and the catalog it produces

The seventeenth run, and the first to take the generated catalog itself as its subject: `public/catalog.json`,
`public/catalog-lite.json` and the 59,162 files under `public/o/`, read by rule rather than by eye, and then the
code in `backend/src/sync`, `backend/src/enrich` and `backend/src/discover` that produced each problem. Fixes are
to rules and generators only. Nothing under `public/` was edited by hand, so every count below is what the next
`npm run sync` on Render will change, not what is live this minute.

**Checked.** All 59,162 files under `public/o/` and `public/catalog.json`, scanned by script for each rule below
rather than sampled, because a keyword or a regex check runs over the whole catalog in seconds: gambling-spam
phrases in every text field and in `cover`/`photos` (109 files matched, 97 in `blurb`, 12 only in a photo address);
an em or en dash inside `specs` and `highlights` (159 and 18 raw hits; 2,551 files the earlier run's count, not
reproduced exactly here since some of those may have already cleared on other fields); `options` names against
`NOT_A_SERVICE` (1,484 listings); a card's `deal` label against a trailing-connector check (2 of 33 published
deals); an image address against a bounded "logo" check across the whole address rather than only its last
segment (41 of 208,791 photos). Two specific leads were checked and found already correct, not a bug: `art:
"museum"` on 345artgallery.com is right, since the taxonomy's own label for that category is "Museums and
galleries" (`src/taxonomy/catalog.ts`); and a rating and review count are never shown without written reviews
behind them already (`WebListing.tsx`: "The public rating and its count appear only beside written reviews we can
actually show"), so a review count with no text is never surfaced as a promise of reviews. Prices, hours and
category assignments across a broader eyeball sample (roughly 150 listings across metros and categories) turned
up nothing past what is listed below.

**Checked**, no further count-scanning done for lack of time: chain-location naming, near-duplicate OSM nodes
sharing one phone number (spot-checked; too many false positives from multi-site parks and campgrounds sharing an
office line to build a safe rule from phone alone, see Needs Harshil), and the pipeline schedule
(`backend/scripts/pipeline.mts`) for overlap risk: the file already documents a single queue where "a job can
never overlap itself," each job is a hard-timeout child process, and `screen` (03:30, pixel-based cover and gallery
screening) is the AI counterpart to this run's rule-based `isPhotoName` fix, a useful backstop since a cover only
gets screened once (`cover_screened`) and never rechecked.

**Found and fixed.**

- **Amazon.com was a hot air balloon ride in Fort Myers** (`731eee84f`, `o-amazon-com`). Thirty-four published
  listings were not a local business at all. A guest browsing Fort Myers balloon rides was offered "Amazon.com";
  San Antonio's water rail carried "Red white and blue guide services" whose website is youtube.com; a Palm Coast
  fishing charter was `apps.apple.com`; `affordabletours.com`, which sells 9,250 tours worldwide, was a Sugar Land
  cruise; and the Florida corporate registry, ZoomInfo, Indeed, Apartments.com and bbb.org were all bookable.
  Eighteen more were a booking vendor's own hosted pages rather than the shop's site: `app.squareup.com`,
  `book.squareup.com`, a Rezdy widget, `mysite.vagaro.com` (published as "primary:Elements Massage and Wellness of
  Tiffin"), `fresha.com`, `mindbodyonline.com`, `bookeo.com`. Discovery already refuses every one of these hosts
  (`DROP` in `src/discover/websearch.ts`), but rows reach the operators table from OpenStreetMap website tags and
  chain locators too, and `buildCatalogItems` only knew the boat and tour marketplaces. `NOT_OPERATOR_HOST` in
  `src/sync/contacts.ts` refuses them at sync. Site builders are deliberately off the list: `squarespace.com` is
  Squarespace, but `hide-away-cove.squarespace.com` is a campground's own website, and about 250 operators on
  wordpress.com, weebly.com, business.site and the rest have no other site. `sync/__tests__/catalogFilter.test.ts`
  names all thirty four refused hosts and fifteen kept ones.
- **Fifteen solidcore studios led with a photo from a developer's laptop** (`450a89328`,
  `o-chain-solidcore-aventura-c5ad56`). solidcore.com's own markup links
  `http://localhost:3000/solidcore-studios.webp`; the crawl stored it and it won the cover slot on all fifteen
  studios from Aventura to Winter Park, so a guest's browser asked their own machine for the file and got nothing.
  Eighty covers in all were addresses no guest can load. The other sixty five are what a registrar shows once a
  business lets its domain lapse or never builds the site: 43 listings led with HugeDomains' own "this domain is
  for sale" banner (Land-O-Fun, Bucksport Golf Club, a children's theatre), seven with Squarespace's parking
  wallpaper, and Bayou Barriere Golf Course's gallery was six headshots of domain brokers. Bristol Motor
  Speedway's photo was a Bing tracking pixel. `publishableImage` in `src/sync/imageUrl.ts` refuses a loopback or
  private host and a parking banner; `imagescrape.ts` refuses them as it reads a page and `fullSize` refuses them
  again at sync, because facts already stored only clear when the catalog is written. 119 of the 208,791 photos in
  the shipped catalog go. `sync/__tests__/imageUrl.test.ts` covers both.

- **A fish's season read "May–October"** (`d1cb81279`, `o-1000islandsfishingtrips-com`). `specs` and `highlights` are
  built straight from an operator's own site text, and 2,551 published listings carried its em or en dash through
  unchanged, against the AGENTS.md rule that the app's own copy never carries an em dash. `cleanLine`'s own
  separator rule made it worse: a scraped "SUNDAY----10am-9PM" was rewritten into an en dash `cleanLine` invented
  itself, not one the operator wrote. `tidyDashes` in `src/sync/contacts.ts` now rewrites a number or month on
  each side as "to" ("Walleye (May–October)" reads "Walleye (May to October)"), and anything left over as a comma
  or a period, the substitutes AGENTS.md names; `cleanLine` uses a plain hyphen for its own separator instead of
  manufacturing an en dash. `sync/__tests__/tidyDashes.test.ts` covers both.
- **A hacked site's gambling spam was published as a museum's own words** (`f38f999da`, `o-345artgallery-com`).
  97 published listings, an art gallery, golf courses, RV parks and museums among them, carried Indonesian
  gambling SEO spam as their blurb ("MAXSLOT88 adalah situs SLOT777 dan platform slot gacor..." under a Chicago
  art gallery's name), and a dozen more led with a "slot gacor" banner from a throwaway image host as their cover
  photo (Route 66 Museum, the Connecticut Eastern Railroad Museum). The operators' own sites had been hacked with
  the SEO-spam pattern common to compromised WordPress installs, and the crawl read the injected page straight
  through; nothing screened for it, because photo and cover facts bypass the trust filter that already exists for
  junk, stale and retail text in `src/sync/contacts.ts`. `SPAM_LINE` recognizes the betting-term phrases, careful
  to leave "book your slot online" alone since that is a real sentence a booking page writes; once one of an
  operator's own text facts is spam, none of its photo or cover facts are trusted either, on the reasoning that a
  hacked page is hacked all the way through. `sync/__tests__/spamLine.test.ts` covers both the catch and the near
  miss.
- **A boat charter's card quoted a $10 membership tier as its price** (`29012643d`, `o-acadiachartercompany-com`).
  1,484 published listings showed a card's "from" price off a membership, season pass or gift card: Acadia
  Charter Company's card read "From $6,500" priced by a "Blue Water Club Membership" tier, while its two real
  charters both carry "Price on request", nothing a guest could book at that price at all. `services`, the row
  the listing page books from, already dropped these lines with `NOT_A_SERVICE`; `options`, the row a card's
  price is read from, kept every menu line unfiltered. Both use the same filter now.
  `sync/__tests__/notAService.test.ts` covers the regex both sides share.
- **An escape room's cover was its own logo, not a photo of the room** (`bfcbfc1f5`, `o-escaperoomadventures-com`).
  41 shipped photos were a business's own logo rather than a picture of the place: `isPhotoName` only ever looked
  at the last slash-separated segment of an image's address, and a logo often sits in a directory of its own
  ("company/logo/id.png", Little Lady Boat Co and Carolina Boat Rentals both booked through the same platform),
  behind a CDN's transform suffix ("logo biz.JPG/:/cr=t:0%,...", Coastal Chaos Fishing Charters), or inside a
  Next.js image proxy's own query string ("_next/image?url=%2Flogo.png", Marsh Beast Airboat Tours). `isPhotoName`
  now decodes the full address and refuses one wherever "logo" sits in it, not only in the file's own name.
  `sync/__tests__/isPhotoName.test.ts` covers the catch and a domain that merely spells the letters
  ("prologodesign.com") staying a photo. One listing, Wallingford Rod and Gun Club, has every one of its seven
  photos filed under a folder literally named `WA_sport_logo`; the filenames (`L1001504.JPG`) read as ordinary
  camera photos, not logo art, but this sandbox has no network access to fetch and look, so it is left in
  **Found, not fixed** below for the next run to confirm by eye.
- **A card's deal badge read "Monday to", cut off mid-connector** (`906e60d52`, `o-viplaketravis-com`). Two
  published cards read "4th hour free on boat rentals, Monday to" and "30% off cabin and boat rentals, Sunday
  to": the 48-character cut already stopped on a whole word, so it never showed a stub like "Sund", but nothing
  stopped it landing on a connector word with nothing after it, which reads as unfinished rather than short.
  `compactDeal`, pulled out of `syncCatalogToApp` so it can be tested on its own, now drops a trailing connector
  and its comma after the cut. `sync/__tests__/compactDeal.test.ts` covers both known cases plus a title that
  already fits.

**Found, not fixed.**

- `o-wallingfordrodandgunclub-org`: all seven published photos live in a directory named `WA_sport_logo`, so the
  logo fix above now refuses all of them and the listing ships with no photo at all. The filenames look like an
  ordinary camera roll, not artwork, so this may be a false positive from a club's odd folder name rather than an
  actual logo; confirm by opening one of the URLs (the sandbox this run had no route to
  `wallingfordrodandgunclub.org` to check itself) and, if they are real event photos, loosen `LOGO_PATH` in
  `src/sync/contacts.ts` to require the "logo" segment sit within one or two directories of the file itself,
  which still catches every other case found this run.
- Near-duplicate OSM nodes sharing one phone number: 123 groups of two or more listings, different titles, same
  area, same phone. A few read as the same place published twice (`o-osm-way-721208607` "Cherokee Bear Zoo" and
  `o-osm-way-721208594` "Cherokee Bear Zoo and Exotic Animals", Cherokee, NC), but most are not duplicates at
  all: a city's parks department sharing one office line across several real, distinct golf courses and museums,
  and a campground's four different numbered camp sites sharing the front-desk number
  (`o-osm-node-5678618221`..`o-osm-node-5678599529`, San Francisco, CA). A phone-number match alone is not a safe
  signal to dedupe on; it would need the same lat/lon within a few metres and a close title match together
  before merging two rows, and building and proving that rule safely did not fit in this run.
- 148 published option or service prices over $10,000 (`o-acadiachartercompany-com`'s two charters aside, since
  the membership tiers that triggered them are gone as of this run's price fix): a private pilot's license at
  $15,000 to $19,570, a wedding venue rental at $12,500 to $18,500, a luxury safari at $10,560. Read by eye,
  fifteen of fifteen sampled are real prices for a real, expensive experience (flight training, an African
  safari, a private event space), not an extraction error; no rule change proposed.

**Needs Harshil.**

- 96 real operators (a Chicago art gallery, golf courses, museums, RV parks) have a hacked website right now,
  serving Indonesian gambling SEO spam to anyone who visits, Outset's crawler included. The fix in this run stops
  the catalog from republishing it, but the operator's own site is still compromised. Worth a one-line email to
  each ("your website may have been compromised") as a goodwill gesture, separate from anything this pipeline
  can do; the list is reproducible from `SPAM_LINE` in `src/sync/contacts.ts` against `rawFacts`.
- Whether to build a phone-plus-location dedup rule for the 123 near-duplicate OSM groups noted above. It would
  catch real duplicates like the Cherokee Bear Zoo pair, but the false-positive rate for shared park-department
  and campground office numbers means it needs a product call on how much risk of wrongly merging two distinct,
  real listings is acceptable, not just a code fix.
