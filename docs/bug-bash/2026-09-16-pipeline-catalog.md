# Bug bash, 16 September 2026: the pipeline and the catalog it produces

The seventeenth run, and the first to take the generated catalog itself as its subject: `public/catalog.json`,
`public/catalog-lite.json` and the 59,162 files under `public/o/`, read by rule rather than by eye, and then the
code in `backend/src/sync`, `backend/src/enrich` and `backend/src/discover` that produced each problem. Fixes are
to rules and generators only. Nothing under `public/` was edited by hand, so every count below is what the next
`npm run sync` on Render will change, not what is live this minute.

**Checked.** In progress. See the end of this file for the final counts.

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

**Found, not fixed.** In progress.

**Needs Harshil.** In progress.
