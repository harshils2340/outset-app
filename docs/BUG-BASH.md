# Bug bash log

One dated entry per overnight run: what was checked, what was found, what was fixed, what needs Harshil.

## 15 September 2026

**Checked.** `npm ci` and a clean type-check at the root and in `backend/`. The money path
(`scripts/payout-e2e.mts`) and the full rehearsal (`scripts/e2e-local.mts`, headless Chromium). Then by hand
against a local API on a throwaway store and a scratch Postgres: the guest (find a listing, pick a time, book as
a request and with Instant Book on, pay on site) and the operator (claim through the test bypass, edit, the
Published, Accepting and Instant Book switches, accept, decline, cancel, payouts). Double booking past capacity,
every email (guest and operator copies, founder alert, sign-in code, claim link), the money split, payout
scheduling, and odd input on every route that takes it.

**Found and fixed** (commit `5f07bf8`):

- **A pay-on-site booking charged whatever the browser sent.** The server only read the listing's own menu when
  Stripe was switched on, so with payments off a guest could book two $25 places and send a total of $1. The
  operator's email then read "Your price $1.00, you receive $0.95" and the guest's said the same. The price now
  comes from the listing on both paths. The card path already did this and is unchanged.
- **A booking was accepted for a listing that does not exist.** Any invented id stored a booking row and sent
  the founder a "CALL THE SHOP" alert for a shop that was never there. A clean read that finds neither the
  listing file nor a claimed profile answers 404; a store error still lets the booking through, so an outage
  cannot hide a real shop.
- **An impossible calendar day was bookable.** "2027-02-30" rolls forward to March 2, so the record kept one day
  and every email said another. Refused now, and the open-slots route refuses it as a `from` too.
- **24:00, 12:99 and 99:99 answered 409 "that time is not open"**, which reads to a guest like someone else took
  it. Bad input answers 400.
- **The payouts page named a pay day that had gone by.** A cycle pays on its Monday and a run on any later day of
  that cycle still pays, so from Tuesday on the dashboard said "Next payout, Monday, September 14" and filed
  money the very next run would send under "Scheduled for later pay days".
- **Emails never printed a year.** Bookings run up to a year ahead, so "Sunday, January 3" in a December email
  did not say which January. A trip in another year carries it now.
- **The harness left its servers running**, so a second run died with EADDRINUSE. It signalled only the npx
  wrapper, never the server behind it. Both start in their own process group now.

**Found and fixed** (commit `45a4446`): the rehearsal itself was broken by the move of the private store to
Postgres. The harness and its browser flow still read profiles and bookings as JSON files under the temp store,
so every check of what was actually saved failed and the run died with ENOENT before the emails were read. On a
clean checkout of `main` it reported Accepting, Instant Book, the guest's booking, accept, decline, the instant
confirmation and the cancel all broken when the API was answering correctly the whole time. It now reads the
same truth the dashboard does, through the API and the repo layer. Also, `payout-e2e.mts` exits 0 when it skips
for want of a database and the harness counted that as a pass, so a money path that never ran looked green; a
pass now requires checks to have actually run.

**Green after the fixes.** 31 rehearsal steps, 0 failed, with 43 money-path checks inside them. Both projects
type-check clean.

**Needs Harshil.**

- The rehearsal and the money-path test now need a scratch Postgres (`E2E_DATABASE_URL`). This run used a local
  cluster; on your Mac it wants `neon branches create --name scratch` and the pooled connection string. Without
  it both skip, and CI would report green having run nothing until the guard above.
- Nothing was checked against Stripe: no key was set, so the card path ran against the recorder only. The live
  capture, refund and Connect transfer settings still want a look in the Stripe dashboard.
- Render environment variables are untouched and unverified from here. `DATABASE_URL` is now what the API needs
  to serve at all, so confirm it is set on the API service before the next deploy.

## 15 September 2026, second run

**Checked.** `npm ci` and a clean type-check at the root and in `backend/`. The money path
(`scripts/payout-e2e.mts`, 43 checks) and the full rehearsal (`scripts/e2e-local.mts`, headless Chromium), both
green before any change. Then by hand against a local API on a throwaway store and a scratch Postgres: the guest
(find a listing, pick a time, book as a request and with Instant Book on, pay on site) and the operator (claim
through the test bypass, edit, the Published, Accepting and Instant Book switches, accept, decline, cancel,
payouts). Eight guests racing for four seats at one time (four get in, the time then disappears), the same code
sent twice at once, every email read line by line for wording, human dates, currency and the split, and about
200 odd requests across every route that takes input.

**Found and fixed** (commit `77cdfdac`):

- **A time with room for one guest was still offered to four.** Capacity is per time, so a family picked a time
  the picker showed, were told "that time was just booked", reloaded, saw it offered again, and were told the
  same thing. The picker now sends the party size (`GET /bookings/open/:listing?guests=N`), so a time the party
  does not fit in is not there; a guest who still races into one is told what is left ("Only 1 spot left at that
  time") instead of that it is gone.
- **A service the listing does not price kept the browser's number.** An invented "Helicopter transfer" at
  $5,000 reached the operator as "You receive $4,726.25" for something they do not sell. The listing's own menu
  is now the only source of a price once the listing has been read; a booking it cannot price has no price. Only
  a store the API could not read at all still trusts the browser, so an outage cannot lose a real price.
- **The operator's Payouts page took 5% off the guest total**, which counts the guest's service fee as their
  money. A $213 trip read "$202 earned" against the "You receive $194.75" in the booking email for the same
  trip. This is the panel every claimed shop sees today, because no Stripe account is connected yet.
- **A request body of `null` answered 500** on eight routes: it is valid JSON, so `c.req.json()` resolved to it
  and each route read a field off nothing.
- **A booking code with a NUL byte in it answered 500**, because the code was never checked in the path and
  Postgres rejected the bytes. 404 now, like any other unknown code.
- **One bad profile write took a shop's booking path down for good.** The dashboard record is stored as the
  device sends it, and a `services` field that was not an array made the public open-slots route and every
  booking for that listing throw `.filter is not a function`.

**Tests.** `scripts/store-e2e.mts` covers all six at the route level (37 checks) and now runs as its own step of
the rehearsal; the browser flow checks the payouts tile against the operator's price. 33 rehearsal steps pass, 0
failed, with 43 money-path checks and 37 route checks inside them. Both projects type-check clean.

**Needs Harshil.**

- `src/db/pg.ts` always demands TLS (`ssl: { rejectUnauthorized: true }`), so the rehearsal cannot point at a
  plain local Postgres: it dies with "The server does not support SSL connections". This run used a local
  cluster with a self-signed certificate and `NODE_EXTRA_CA_CERTS`. On your Mac use the Neon scratch branch
  (`neon branches create --name scratch`); in CI it is the `E2E_DATABASE_URL` secret. Worth a line in the doc, or
  an `sslmode=disable` escape hatch for local runs.
- Still nothing checked against real Stripe: no key was set, so the card path ran against the recorder only.
  Live capture, refund and Connect transfer settings still want a look in the dashboard.
- Render environment variables remain untouched and unverified from here.

## 15 September 2026, third run (07:00 to 08:40 UTC)

**Chosen, and why.** The first two runs covered the money and the booking rules, so this one took the guest
listing and booking box, the dashboard pages beyond Bookings, phone width and the accessibility and empty
states, none of which anything had looked at. Type checks at the root and in `backend/`, and the unit tests,
were run at the start and at the end. The full rehearsal was run because two commits since the last entry
(`cf53c87`, `bb89e2d`) touched `backend/src` and `backend/scripts`: green before any change and green after,
33 passed, 0 failed, with the 43 money checks and 37 route checks inside it.

**Found and fixed.**

- **A shop that closes after midnight could never be booked** (`56255e4`). Hours come off the operator's own
  website, and "10am to 12am" or "6pm to 1am" reads back as a closing time at or before the opening one. Every
  such day produced no start time at all: the listing's own hours row said "Open until 12:00 AM" while the
  booking box said "No more start times today", on every day of the year. The operator's calendar hid it by
  falling back to a 9 to 5 grid whenever no day produced a slot, so nobody would ever have noticed from the
  dashboard. A day's run now ends at midnight and the rest belongs to the next date, which is the date the
  guest turns up on, so notice, days off, blocked slots and capacity are unchanged. Only a close in the small
  hours wraps, because an opening time dragged past the closing one is a mistake, not a night shift; the
  Availability page says so on the row, and offers the after midnight closes it could not reach before.
- **A trip priced "on request" showed a total made only of its extras** (`18aa465`). Picking an unpriced
  service and a $30 wetsuit put "Total $32" in the box and "Confirm and pay $32" on the button, while the
  server priced from the listing, found no price, and stored the booking with none. Nobody was ever charged
  that $32.
- **The Explore feed behind an open listing kept its whole tab order** (`18b64f2`). On a phone the listing is a
  sheet over the feed: Tab from the top of an open listing went Search, Filters, nine category chips, then card
  after card, about seventy stops before the booking box, and a screen reader read all of it first. Three
  presses now.
- **"Failed to fetch." was shown to guests** (`0789019`). Every screen prints the API's own `error`, which is
  written for a guest; what `fetch` throws is not. With the API down, "Request to book" produced a toast
  reading "Failed to fetch." and a slow one "signal timed out."; the claim screen said "Could not send the
  link: Failed to fetch". Verified both ways against a dead port.
- **The phone booking button never said it was working** (`daf1aa2`). It stayed untouched for as long as the
  call took, up to 25 seconds, so an impatient guest pressed it again and a shop with room got two rows under
  two codes. Confirmed against a server that accepts and never answers.
- **The setup checklist and the Services banner miscounted** (`179178e`). Both counted options on services
  switched off, which no guest can book, and both counted a price of zero as set while the money code on each
  side reads a zero as no price. So the dashboard could say the menu was finished for an option the guest is
  told to pay on site for.
- **Smaller.** `npm test` did not exist though AGENTS.md tells you to keep it green (`34ec4b7`); the hours
  selects, the day off date, the policy line, the photo address and the Otto test box had no accessible name,
  and at 400px each day's closing time wrapped to its own line so the week took two and a half screens
  (`b20b470`).

**Checked and clean.** No sideways scroll or overlap at 400px on the guest listing, the whole booking flow or
any dashboard page. Every visible input on the booking flow is named and every disabled button says why. Start
times against odd hours, a closed day, a day off, a blocked slot, a 72 hour notice, a 7 day window, a slot
length of zero and a malformed profile all behave. Eight new tests in `backend/src/api/__tests__/openSlots.ts`
and `payments/__tests__/priceBooking.ts`; 18 pass.

**Needs Harshil.**

- The overnight fix changes what a claimed shop offers. Any live shop whose close is at or before its open
  starts offering evening times tonight that it did not yesterday. Worth looking at the claimed shops once.
- The routine's rehearsal command says `scripts/e2e-local.mts` from the root; it lives in `backend/scripts/`.
  And `NODE_EXTRA_CA_CERTS` has to carry the proxy CA bundle as well as the Postgres certificate, or the
  harness cannot reach the npm registry.
- `npm test` now exists but no workflow runs it. `.github/workflows/` has eight jobs and none is the tests.
- Still nothing checked against real Stripe, and Render environment variables remain untouched from here.

## 15 September 2026, fourth run (08:00 to 09:40 UTC)

**Chosen, and why.** The first three runs took the money, the booking rules and the guest listing, so this one
took the two areas Coverage still listed first: search and browse, and the claim and sign-in flows. Then the
week of hours a shop starts on, because that is the first thing a new operator sees. Type checks at the root
and in `backend/` and `npm test` ran at the start and at the end. The full rehearsal was run, because one
commit since the last entry (`3e6ca56`) touched `backend/src` and `src/`: green before any change and green
after, now 35 steps, 0 failed, with 43 money checks, 42 route checks, 24 backend tests and 16 guest tests
inside it.

**Found and fixed.**

- **A search that found nothing sent the guest to another empty page** (`b6c7607`). "skydiving florida" in
  the Water tab offered "Skydive · 7", "Key West · 425", "Miami · 1,587" and "Orlando · 1,511". Every one of
  those opened an empty page: the activity count came from results outside the tab the guest was in, and the
  city counts were the whole city's catalog, nothing to do with what was typed. "axe throwing honolulu" in
  Honolulu offered the guest Honolulu. Each row now carries the size of the page its own press opens, and a
  row whose page would be empty is not shown; an empty search in Banff points at "Miami · 2" and "Key West ·
  1", which are real.
- **Opening a claim link for a second shop signed the operator out of the first** (`0f2072f`).
  `POST /claims/:id/exchange` minted a session scoped to the listing in the link alone and threw away the one
  the caller arrived with. The first shop stayed in their dashboard and in the sidebar, and every save of it
  answered 403 with nothing on screen to say why. It keeps the listings the caller already held now, the way
  `POST /claims/:id` always has. A session for one shop still cannot edit another; an expired one widens
  nothing.
- **A shop that says it opens two days a week was given the other five** (`d93d53b`). The starting week is
  read from the operator's own published hour lines, and every day those lines did not name kept an invented
  9 to 5. "open Saturday & Sunday only from 11:00am to 7:00pm" came out open Monday to Friday, and a dropzone
  whose site says "Friday through Sunday" was handed Monday to Thursday: two of the ten synced operators who
  publish hours at all, and a guest could book a day the shop is shut. Three reading bugs went with it. Only
  four day ranges were known, so "Friday through Sunday" read as Sunday alone; "Mon, Wed & Fri" read as
  Monday; and a line written "9:00 a.m. - 6:00 p.m." was dropped whole, which is how a balloon company
  publishing Monday to Saturday 9 to 6 got a 9 to 5 week. All ten now read exactly what their own site says.
- **Nothing ran the unit tests** (`49f2f2e`). `backend/` had `npm test` and the guest side had no runner at
  all, so a break in either passed the nightly rehearsal untouched. Both are a rehearsal step now, and a step
  that produces no test counts as a failure rather than a pass.
- **Smaller.** The option name, add-on name, detail and price on the menu editor had a placeholder and no
  accessible name, so a screen reader read "edit text, blank" four times per add-on (`5e92a8c`).

**Checked and clean.** A query matching nothing, a metro with one listing, a category with none in a city,
paging, and an unpublished or paused listing staying out of every list and rail. An address that does not
match the business, a claim link that has expired (410), one whose expiry was edited (401), one listing's link
used on another, a sign-in code typed wrong six times, and a session for one listing used on another, by
session and by claim token. Colour contrast on the accent: forest is 7.5:1 and sage is never used as text;
every low-contrast pair in the CSS is white on a dark ground or an inactive control that also carries a
line-through.

**Needs Harshil.**

- The hours fix changes the week a shop starts on. It only touches new claims, not shops already claimed, but
  it is worth looking at the next one that comes in.
- `--gone` (`#B0B0B0`) on `--gone-bg` (`#F2F2F2`) is 1.9:1. It is only ever a sold-out slot, which WCAG
  exempts as an inactive control, and the time is struck through as well, so nothing depends on the colour.
  Still hard to read. Darkening it is a palette decision, so it was left alone.
- `.badge-avail` in `app.css` is dead: no component renders it. Safe to delete.
- Still nothing checked against real Stripe, no workflow runs `npm test` on its own, and Render environment
  variables remain untouched from here.

## 15 September 2026, fifth run (09:00 to 10:20 UTC)

**Chosen, and why.** Coverage listed the dashboard Calendar and Services first, and the Trips tab as a page no
run had opened, so this run took those. Type checks on both sides and both sets of unit tests ran at the start
and at the end. The full rehearsal was **skipped at the start**: the last entry said green and the only commit
since it was that entry itself. It ran twice later, because the fixes touch `backend/src` and `src/`: 39 steps,
0 failed, with the 43 money checks, 46 route checks, 27 backend tests and 27 guest tests inside it.

**Found and fixed.**

- **A price typed with a stray minus took money off the guest's bill** (`d906cdc`). The menu editor saved
  whatever its price box was given, and `min={0}` marks a typed "-20" invalid without anyone reading it. An
  extra at -20 came off the total and one at -500 drove a booking past zero: subtotal -400, fee -0, and an
  operator email reading "you receive -$380". The experience's own price was already held to "positive or no
  price"; its extras were not. The box clamps now and both money paths count only a positive price.
- **Taking a day off hid the bookings already on it** (`09c6158`). The Calendar drew every cell of a day off as
  closed and empty, so an owner who took Saturday off watched two confirmed bookings vanish from the page they
  read to see who is turning up; narrowing the week's hours did the same. Both were still live everywhere else.
  A booked time keeps its row now, and the header reads "Off · 2". Two smaller ones came with it: a day shut
  only because its hours leave no room offered "Reopen this day" and then took the day off instead, and the
  grid read this date's hours alone, so a shop open Friday 6pm to 1am with Friday off was still offered
  midnight on Saturday, a time the API has never sold.
- **A shop that took its menu down was still priced from the scraped file** (`4f5b4ed`). The fallback to the
  crawled listing turned on the menu's length, so a menu the operator had emptied counted as no menu: hiding
  or deleting every service left the guest page with nothing to pick while the price still came off the file,
  and an add-on the operator removed was still added to the bill.
- **A guest was told a text message had been sent** (`5744099`). "A confirmation was sent to your phone." sat
  under every booking. Text messages are not built, and email is optional while the mobile is required, so a
  guest who skipped the email box was told a confirmation had been sent when nothing had been sent anywhere,
  and the decline, when it came, went nowhere either. Both booking forms now say what an empty email box
  costs, and both confirmations name the address they wrote to or say there is none.
- **The Trips tab showed a declined request as a trip** (`bd14b40`). A booking on the device only knew it had
  been sent, so a request the operator declined kept its place with a title, a time, a party and a code, for a
  day the shop was not expecting anyone. Each upcoming trip reads its answer back now. Its empty state also
  told a guest whose trips had all happened that they had never booked.

**Tests.** `slotsForDay` has its own file mirroring the API's `openSlots` tests, `priceUnclaimed` and
`priceBooking` both cover a negative extra, and four store-e2e checks cover the menu, two of which fail without
the fix. The rehearsal drives the Calendar end to end for the first time (`2cb720a`): a time the picker is
offering is blocked with a click and has to leave the picker, then come back; a day is taken off and offers
nothing. Each step reads the before state, so none can pass on a time that was never on offer.

**Needs Harshil.**

- **"Release this listing" only releases it on that device.** `deleteProfile` clears the local profile, the
  override and the session, but nothing tells the API, so the `profiles` row stays and every guest still gets
  the ex-owner's edits through `catalogLoad`, bookings still reach them, and their email is still on the
  listing. The copy says "puts the listing back the way we built it". It wants a real unclaim route; the one
  that exists (`test-unclaim`) is behind the test allowlist on purpose.
- **A guest can book with no email at all.** The API requires a name and a mobile, nothing else, and email is
  the only channel that exists. The copy is honest about it now, but the fix is either requiring the address
  or building the text messages.
- The new Trips status was type-checked and read, not driven in a browser: the rehearsal's guest flow is the
  desktop site, which has no Trips tab. Worth a step from the phone frame next.
- Still nothing checked against real Stripe, no workflow runs `npm test` on its own, and Render environment
  variables remain untouched from here.

## 15 September 2026, sixth run (10:00 to 11:20 UTC)

**Chosen, and why.** Coverage listed the Inbox tab and the operator chat as pages no run had opened, add-ons
end to end as undriven, and the Account tab as unchecked, so this run took those, plus what the menu editor
publishes when a row is half typed. Type checks on both sides and both sets of unit tests ran at the start and
at the end. The full rehearsal was **skipped at the start**: the last entry said green and the only commit
since it was that entry itself. It ran at the end, because every fix here touches `src/`: 39 steps, 0 failed,
with 43 money checks, 46 route checks, 27 backend tests and 36 guest tests inside it.

**Found and fixed.**

- **Claiming a shop turned its opening hours into a 24 hour clock** (`179746a`). The dashboard stores
  "09:00" because that is what a time input speaks, and the listing printed it straight out: a shop whose own
  site says "9:00 AM - 5:00 PM" had its Hours block rewritten to "Sun: 09:00 to 17:00" the moment it claimed,
  and Otto read the same back to any guest who asked what time they open. Every other time on the guest side
  is fmtTime, and the rehearsal already forbids a 24 hour clock in an email. The week is still parsed back out
  of these lines by open now, the calendar and the assistant, a close after midnight included, so that round
  trip has its own test.
- **A menu row the operator had not named yet was already on the guest listing** (`8c27a63`). One click on
  "Add" under Add-ons put an empty row on the live page: an Add-ons section holding a nameless tick box
  reading "Free", which a guest could tick and have turn up at the shop as an extra with no name. Typing the
  price before the name made it a nameless box that charges $30. A service whose name is cleared did the same
  to the picker. A row is on the menu once it has a name, and the setup checklist counts that same menu.
- **The phone confirmation never named the add-ons the guest had just paid for** (`290fdf0`). A booking's
  `addons` list holds two different things, the service as an index into the menu and every extra by name, and
  this screen read the whole list as indexes, so every extra came out as nothing: a $30 dry bag was in the
  total and nowhere on the screen, under a row labelled "Service". The desktop confirmation has named them all
  along. That list has one reading now, in `storage.ts`, for all three screens that read it.
- **Every guest's Profile tab was headed "Harshil"** (`1dc6be7`), the founder's own name, on the tab a guest
  opens to find their trips. It uses the name the booking form already remembers on that device, and reads
  "Profile" when nobody has booked there yet.
- **Four rows on that tab did nothing at all** (`849e3d0`). Payments, Riders and waivers, Saved areas and Help
  looked like the rest of the app, and a guest who pressed Help watched the screen not move. None is built, so
  each says so where its chevron was. The "Run an experience" card had a tab stop and no key handler, so focus
  landed on it and neither Enter nor Space opened the dashboard.
- **The assistant chat named none of its three controls** (`305c245`), on a screen reached from the booking
  box: a screen reader read the back button and the send button as "button" and the message box as "edit text,
  blank" once the placeholder went, and Send sits disabled until something is typed without saying so.
- **Otto greeted every guest with an em dash** (`56e95a2`), along with six of its answers, against the one
  writing rule AGENTS.md states outright. A test reads the greeting and nine answers back.
- **The rehearsal could pass while testing a server it did not start** (`a74885c`). `vite preview` exits when
  :5199 is taken and the check after it only asked whether the URL answered, so a dev server left on that port
  passed "the site is being served from the temp dist" and the run then drove that other build: this run's
  first attempt reported the sidebar missing a Listing page and the published flag not reaching the API, on
  code where neither is true. Both ports are checked before anything starts.

**Checked and clean.** Hiding and deleting a service through the dashboard, including deleting every one of
them, which sticks across a reload and does not come back. The Inbox thread list and its empty state. A guest
listing at 400px on the listing, the chat, Trips, Inbox and Profile: nothing scrolls sideways or overlaps, and
every control on those tabs has a name. A booking with a priced add-on end to end on a phone, from the picker
through the total to the confirmation.

**Needs Harshil.**

- **Two services can share a name.** The demo shop carries "Dolphin Island excursion" twice, at $185 and $220,
  because the scraped record lists them as two options. Pricing tells them apart by option label and the
  capacity lookup takes the first match, so nothing is wrong today, but a shop that gives two same-named
  services different capacities would get the first one's. Worth deciding whether the menu editor should merge
  them.
- **A guest can still book a service the operator hid a moment earlier**, and it is stored with no price and
  reaches them as pay on site. That is the deliberate rule from the second run (never trust the browser's
  number), but refusing the booking may read better than confirming one for something the shop took down.
- Still nothing checked against real Stripe, no workflow runs `npm test` on its own, Render environment
  variables remain untouched from here, and "Release this listing" still only releases on that device.

## 15 September 2026, seventh run (11:00 to 12:00 UTC)

**Chosen, and why.** Everything in the routine's own list was already covered, so this run took the Coverage
section's "not yet checked" list from the top: the Wishlists tab, photo upload on the Listing page, reordering
services, a shop whose published hours are not on the half hour, and the one the last run stopped at, a brand
new claimed shop seen from the guest side, which it could not read because `hydrateProfile` kept refilling the
menu from the crawl. That refill turned out to be the bug. Type checks on both sides and both sets of unit
tests ran at the start and at the end, and the type check turned out to be checking nothing, which is the
last item below. The full rehearsal was **skipped at the start**: the last entry said green and the only
commit since it was that entry itself. It ran three times at the end, because every fix here touches `src/`
or `backend/src`: 39 steps, 0 failed, with 43 money checks, 46 route checks, 29 backend tests and 47 guest
tests inside it, then 41 steps once the type checks became a step of their own.

**Found and fixed.**

- **A menu the operator took down came back every time they opened the dashboard** (`4d1a389`). A profile
  claimed off the slim browse record has no services, photos or blurb, so the dashboard reads the operator's
  detail file and fills what is still empty. It ran on every load, and "still empty" only means "not filled in
  yet" until the operator starts working: after that an empty menu is a menu they took down and an empty
  gallery is photos they deleted. An owner who cleared either found the crawled version back on the next
  visit, on the guest listing with it, and no way to keep it off. The fill is a one-time bootstrap now. This
  is also what hid the last run's question, so the answer is there in the test: deleting every service now
  sticks on the dashboard as well as on the guest page.
- **The Wishlists tab told a guest holding twelve saves that they had none** (`1afe55e`). Saves live in
  localStorage and survive a reload; the catalog is fetched after the first paint, and most operators are only
  in the full file, not the lite shard the rails paint from. The tab looked each saved id up and dropped what
  did not resolve, so opening it on a cold start showed "Create your first wishlist" and a button to go and
  find the saves they already had. It counts what has not arrived and says the list is loading now. A saved
  listing the operator has since switched off also sat there reading "Instant Book" with a price, and opening
  it said the page had been taken down; it reads "Not bookable".
- **A photo the browser itself made too big was refused with advice nobody could follow** (`939fc0d`). The
  Listing page resizes to 1600px at one fixed quality and sends whatever comes out; the API refuses over
  1.8 MB, and a detailed photograph, which is most of what these operators take, comes out over it. The
  operator read "image too large; keep it under 1.8 MB" about a file they never had. The browser measures the
  bytes now and steps quality, then size, until a pass fits. Three more on that path: a failed store answered
  with its own internals (`GitHub write failed 401 {"message":"Bad credentials"...}` reaching an operator's
  toast), a canvas with no 2d context threw inside an onload handler so the button sat on "Uploading 1..."
  for the session, and picking more than twelve photos uploaded twelve and dropped the rest without a word.
- **A service drag the operator gave up on kept the new order** (`2a9c609`). Dragging reorders the list as it
  passes over each row, so by the time they change their mind it is already applied. Letting go over the page
  header, or Escape mid-drag, cleared the drag and left that order with nothing to undo it, while the keyboard
  path on the same handle promises Escape restores.
- **A boot that threw left every screen waiting on a catalog that had already landed** (`0c21dcc`), and
  **neither catalog fetch had a deadline** (`ad228fe`), so a connection that accepted the request and went
  quiet never settled and nothing ever said the catalog was done.
- **Nothing was type-checking the guest app, and `tsc -b` had been failing for days** (`7c8c4da`). Three
  things had to be true at once and were. `tsc --noEmit -p .` at the root reads a solution file: `files` is
  empty and the two real projects are references, so without `-b` it has no inputs and exits 0 having checked
  nothing. That is the command this routine runs, and the one every entry above calls a clean type check.
  Render builds the site with bare `vite build`, which strips types instead of checking them. And
  `npm run build`, the one command that does run `tsc -b`, had been failing since the guest unit tests landed
  in the fourth run: they live under `src/`, so the app project compiles them, and they import `node:test`
  with no node types here. So every line under `src/` has gone unchecked for several days, and this run added
  an unused import that nothing caught. The tests are out of the app project now, which makes `tsc -b` clean
  and loses nothing, there is an `npm run typecheck`, and the rehearsal runs the real check on both sides as
  its own step so it cannot go quiet again.
- **Smaller.** The dashboard wrote the operator's whole record back to the API on every visit, because saving
  ran on whatever the setter returned including the object it was handed (`12df4d4`).

**Checked and clean.** Hours that are not on the half hour, end to end: the two Availability selects carry the
shop's own time as an extra entry, both slot engines count in minutes, and the calendar's rows are the union
of every day's start times, so an odd one gets its own row. Two cases on each engine are pinned now
(`0e99b8e`), including an odd close after midnight. The keyboard reordering model itself (grab, arrows, drop,
Escape) and its live region. The category rail at 400px: a contained horizontal scroller, every chip named.
The metro picker's counts, which are the length of the feed each press opens.

**Needs Harshil.**

- **A claimed shop with an empty menu still takes bookings.** The booking box only requires a service when the
  listing has options, which is right for an unclaimed shop and wrong for a claimed one that emptied its menu:
  a guest can press "Request to book" with nothing picked. The fix above is what makes that state persist, so
  it is reachable now where before the crawl quietly refilled it. The dashboard does say "Nothing to book yet"
  in two places. Deciding whether the listing should pause itself is yours.
- **Photo upload returns a URL for a file that does not exist yet.** With a token set, the bytes are committed
  to `public/uploads/` and the reply points at the live site, so the operator sees the photo only after the
  next deploy. Untested from here: no token was set, by the routine's own rule.
- **The routine's own type-check command needs changing.** It says `npx tsc --noEmit -p .` at the root, which
  checks nothing. `npx tsc -b`, or `npm run typecheck`, is the one that reads the projects. The backend's
  command is right as it stands. Fixing this also meant editing two files outside the folders the routine
  keeps runs inside, `tsconfig.app.json` and `package.json`, four lines between them. Nothing else this run
  left `backend/src`, `backend/scripts`, `src/` or `docs/`.
- Still nothing checked against real Stripe, no workflow runs `npm test` on its own, Render environment
  variables remain untouched from here, and "Release this listing" still only releases on that device.

## 16 September 2026, eighth run (04:55 to 05:40 UTC)

**Chosen, and why.** Many commits had landed since the last entry, `src/` and `backend/src` among them, so the
rule said run the full rehearsal, and it turned out to be the whole story: the rehearsal had been red since the
dashboard rework (`b20aef20c`) and nobody could tell, because a control the harness cannot find is a step that
quietly does nothing. First run here: **5 failed of 49**. Type checks on both sides and both sets of unit tests
ran at the start and at the end. Then the two things Coverage still listed as unchecked that a browser can
answer: the phone search sheet at 400px, and drag reordering driven for real.

**Found and fixed.**

- **The rehearsal drove a dashboard that is no longer there** (`f3f8bf15d`). Four reaches were stale, and every
  one failed in silence, because the helpers answer `"MISSING ..."` and all but one caller threw the answer
  away. The price box is a text input that parses what is typed, not a browser number box, so the harness never
  typed a price and then reported the service and the guest page as broken. Cancelling a booking is two clicks
  now, and it only made the first. The payouts tile keeps cents, so $18 less 5% reads $17.10, which is what the
  booking email says, while the harness rounded to $17. The worst was the guest picker: the month grid lives
  inside the date popover, which a fresh load starts closed, so the check that a booked-out time has left the
  picker read an empty list of chips and **passed on it**. It opens the picker first now and reports how many
  times it read, so an empty picker can no longer stand in for a time that is gone. Every miss is collected and
  reported as its own check, and a failing unit-test step names the tests instead of counting the ones that
  passed. With that, the rehearsal is green again: **50 passed, 0 failed**, and the three product checks it had
  been reporting as broken were the harness all along.
- **A landing page could have been published pointing at a laptop** (`92d7d4402`). `SITE_URL` is where a claim
  email's link goes, and `backend/AGENTS.md` tells anyone testing that mail locally to set it to
  `http://localhost:5173/`. `src/sync/pages.ts` read the same variable, so one `npm run sync` on that machine
  would have written `<link rel="canonical" href="http://localhost:5173/...">` into every page under `public/p`,
  a sitemap of localhost URLs and a robots.txt to match, all committed files. The pages resolve their own base
  now: `PUBLIC_SITE_URL`, else `SITE_URL` when it is not a local address, else onoutset.com. The pages in the
  repo today are clean, so this was a trap and not damage. It also unsticks `npm test`, which failed two of
  these tests on any host with `SITE_URL` set, this rehearsal included, while passing on a bare shell.
- **Two switches in the dashboard said nothing at all** (`e54bf1618`). An `.optoggle` is a knob and no text.
  Availability has seven of them in a column, one per day, all reading "button, pressed", while the two selects
  beside each one say "Monday opening time": an operator on a screen reader had no way to tell which day they
  were closing. Settings has one for Instant Book whose only name sat in the row next to it. Both named, and a
  test reads the source and fails when either loses its name again.

**Checked and clean.** The phone search sheet at 400px, every card (Where, What, When, Who), typed and
untyped: nothing scrolls sideways, nothing overlaps, every control has a name, and the counts beside each
suggestion are the feed it opens. Service reordering driven in a real browser at last: the keyboard model
(grab, arrow, drop, Escape restores) and the touch drag, including a drag given up part way, and the new order
survives a reload. The compact dashboard at 400px, all nine pages. Six real listings at 400px, with and
without a priced menu. Search suggestion counts against the whole 59,091 row catalog, 25 queries in three
places, pressing every activity, place, elsewhere and family row: no row promises a count and opens an empty
page.

**Needs Harshil.**

- **`npm test` was passing for the wrong reason.** Two of the landing page tests only passed because the shell
  had no `SITE_URL`. There is still no workflow that runs `npm test`, so nothing would have caught it; the
  rehearsal caught it only because it sets that variable. Worth a CI job that runs both test suites.
- **The rehearsal is the only thing driving the dashboard, and it drifts silently.** One commit renamed four
  controls and the run stayed quiet about all four. The new check closes that, but a rework that adds a page
  still gets no coverage until someone writes the steps.
- Still nothing checked against real Stripe, Render environment variables remain untouched from here, and
  "Release this listing" still only releases on that device.

## 16 September 2026, ninth run (06:00 to 07:00 UTC)

**Chosen, and why.** Coverage's "not yet checked" list, from the top of what a customer or an operator can
actually reach today: the Inbox and Trips tabs since the dashboard rework, the live guest preview beside the
editor, and what a guest can do on a claimed listing whose menu is empty. The operator chat for a hand-built
listing was skipped on purpose: `src/data/listings.ts` is still empty, so no guest can reach `agent.ts` at all.
Type checks on both sides (`tsc -b` at the root, not `--noEmit -p .`, per the seventh run's note) and both sets
of unit tests ran at the start and at the end. The full rehearsal was **skipped at the start**: the last entry
said green and there were no commits since it at all. It ran at the end, because every fix here touches `src/`.

**Found and fixed.**

- **Trips and Inbox were a heading over a blank page** (`692d910bb`). Both tabs are a list of ids kept in
  localStorage and looked up in a catalog fetched after the first paint: 23 MB of it, and most operators are in
  that file alone, not the 1.3 MB lite shard the rails paint from. Every id that had not landed yet rendered as
  null, and both tabs then branched on the count of ids rather than the count of rows they could draw, so the
  list container was opened, filled with nothing, and the empty state skipped as well. Driven in a browser with
  the catalog held back: a guest with a confirmed trip for tomorrow opened Trips and got the word "Trips" over
  a blank page, while the tab bar badge beside it read 1. Both say they are loading now, the way Wishlists
  already did, and that condition is one function all three read. A trip whose listing the catalog no longer
  carries keeps its card instead of vanishing, because the shop is still expecting them and the code is still in
  their email. The Inbox badge counted raw ids, so it sat on 1 over "No threads yet"; it reads the same answer
  as the list now (`f7564a337`).
- **An operator with a valid session was shown the sales pitch** (`1c90793a6`). The dashboard needs the catalog
  record behind the claim, so until the catalog landed that lookup was null and the screen fell through to the
  claim screen: an owner opening their dashboard read "Your bookings, the way they come in", the four selling
  points, and a "Claim your business" search box for the business they already own. Same root cause as the two
  tabs, on the side that matters more, and the one most likely to make an owner think they had been signed out.
  It says "Opening <their shop>, you are signed in" and waits; once the catalog is complete and the record
  really is missing, the claim screen is right again. The claim screen's own "Signed in on this device" list had
  the milder version and now says it is looking them up.
- **A shop that took its menu down kept advertising the crawled price** (`2451495fa`). `fromPrice` falls back to
  the `from` the crawler read off the operator's site whenever no option is priced, which is honest while nobody
  owns the listing and wrong the moment an operator publishes a menu. A claimed shop that hid or deleted every
  service kept "From $199" on every card, rail, search row, compare table and wishlist tile, counted as priced
  in the price filter and sorted by that price, while its own page offered nothing to book. Worse, Otto answered
  "From $199. They haven't published the rest of the price list." to "how much is it", which is the assistant
  quoting a price the operator had taken down, against the rule in AGENTS.md. The menu is the whole truth about
  a shop's prices from the moment the patch owns `options`, the same rule `priceBooking` has applied on the API
  since the second run and the nightly sync has always applied when it writes `catalog.json`. An edit that does
  not touch the menu leaves the crawled price alone, so an unclaimed shop reads exactly as before.

**Checked and clean.** The live guest preview beside the editor, opened for the first time by any run: it
loads, an edit to the business name reaches the frame within a moment without a reload, the read-only ribbon is
up and the booking controls are off, six regions are tagged for click-to-edit and clicking the services block
jumped the editor to Services, and both Desktop and Phone render. A claimed listing whose menu is empty, seen
from the guest side at 1440px and 400px: no price line, no "What you can book", no service picker, nothing
promised. The new Trips card at 400px: no sideways scroll, no overlap.

**Tests.** `src/lib/__tests__/coldStart.test.ts` (6) pins the shared loading condition and the id resolution;
`claimedPrice.test.ts` (6) pins the from-price on a claimed, emptied, unpriced and repriced menu, that an edit
which does not touch the menu changes nothing, and that Otto stops quoting the removed price. 84 guest tests
and 98 backend tests pass, both projects type-check clean, and the rehearsal is green.

**Needs Harshil.**

- **A claimed shop with an empty menu still takes bookings, and now it is visible.** Confirmed in a browser:
  the box reads "Request to book", "Pick a time" is live and Total says "Pay on site", for a shop with nothing
  on its menu. The seventh run raised this and it is still your call whether the listing should pause itself.
  The prices it advertises are honest now, which was the part that was a bug rather than a decision.
- **A claimed shop's card still shows the crawled duration.** `toCatalog` does not publish `dur`, so a card can
  say "2 hours" for a menu whose services are all four. Deciding which service's duration stands for the listing
  is a product call, and the same rule would be needed in the backend sync, so it was left alone.
- Still nothing checked against real Stripe, no workflow runs `npm test` on its own, Render environment
  variables remain untouched from here, and "Release this listing" still only releases on that device.

## 16 September 2026, tenth run (07:05 to 07:45 UTC)

**Chosen, and why.** Coverage's "not yet checked" list, the two items a person actually touches: the dashboard's
**Settings and Assistant pages, driven rather than read**. The rest of that list is out of reach tonight (photo
upload needs a real GitHub token, the operator chat needs `src/data/listings.ts` to be non-empty) or is a
product call. The full rehearsal was **skipped at the start**: the ninth run's entry said green and there were
no commits since it. It ran twice at the end instead, because everything here touches `src/` and `backend/src`.
Type checks on both sides and both unit suites ran at the start and the end.

**Found and fixed.**

- **The Assistant page's On/Off switch controlled nothing** (`7a3439ce`). `OperatorProfile.assistant` has been
  saved and normalized since the dashboard was built, and nothing ever read it: `toCatalog` did not publish the
  key, so no guest listing could see it. Driven in a browser against the rehearsal's test listing: the switch
  moved to "Off", the device saved `assistant: false`, the published patch carried no `assistant` key at all,
  and a guest in a clean browser still got the Otto panel and an answer quoting the shop's prices, on the
  desktop listing and on a phone. The key is published now and one predicate, `assistantOn`, gates every place a
  guest reaches Otto. A thread opened while it was on still opens, so nobody is cut off mid-question, but Otto
  hands off to the shop. Only an explicit `false` switches it off, so older patches and every unclaimed listing
  read as on.
- **"Release this listing" released nothing that outlived the tab** (`0026f4f5`). It only cleared localStorage.
  The profile row and the email links stayed, so `GET /profiles/:id` kept serving the operator's patch to every
  guest, the nightly sync kept baking it into the rails, and signing back in handed the whole profile back.
  `DELETE /profiles/:id` now deletes the row and unlinks every email, behind the same gate as every other write.
  Bookings are left alone: guests hold codes for them. The app calls it before clearing the device, drops any
  save still in the 1.2s debounce so a keystroke cannot write the profile straight back, and says so instead of
  reporting a clean release when the server refuses.
- **That fix was itself broken in a browser, and only driving it found out** (`83758d1e`). `DELETE` was missing
  from the API's CORS `allowMethods`. A method missing there fails only on the preflight, so the route passed
  every one of store-e2e's in-process checks and then did nothing at all when a real browser pressed the button.
  A test now reads the methods `src/lib/api.ts` sends and fails when the allow list lacks one.
- **No operator edit reached a guest's rendered listing page** (`1b9b7b66`), which is the big one and was found
  underneath the others. `loadListing` fetches the detail file, resolves on it, and then fetches the operator's
  profile in a detached promise that patched the in-memory catalog and told nobody. Nothing in React re-read the
  catalog, so a guest opening a claimed listing by its link, which is every shared link, every email link and
  every search result, read the crawled record for the whole visit: old title, blurb, prices, hours, policies.
  Seen in a browser: the server's patch said the title was "Shah and Shah Services (edited by the harness)" and
  the page's `h1` said "Shah and Shah Services", after a reload and twelve seconds. Awaiting the profile would
  put an API round trip in front of every listing page, so it stays detached and announces itself through
  `onListingEdits`; `AppProvider` subscribes once and bumps `catalogVersion`.

**Checked and clean.** The Settings page driven: owner name, email and mobile with their validation and their
error lines, the booking-alerts card against a valid, an invalid and a missing address, the Instant Book switch,
removing sample bookings, and the release confirm-then-act pair. The Assistant page driven: the switch, the
"What it knows" panel against what Otto actually quotes, the test chat, and the refusal list. The phone listing
at 400px with the assistant off: nothing scrolls sideways, nothing overlaps.

**Tests.** `src/lib/__tests__/assistantSwitch.test.ts` (7) pins the switch from profile to published patch to
guest listing, that an older patch reads as on, the handoff line, and that every guest-side entry point calls
`assistantOn`. `listingEdits.test.ts` (4) pins the announcement and its subscription.
`backend/src/api/__tests__/cors.test.ts` (3) pins the allow list against what the app sends. store-e2e gained a
section 12 for the release route (a stranger refused and nothing changed, the owner's session releases, row and
links gone, guest gets the crawled record, sync drops the edits, bookings survive). Each one was checked against
the old behaviour and fails on it. 95 guest tests, 101 backend tests, both projects type-check clean.

**Needs Harshil.**

- **The rehearsal cannot see what a guest's browser sees.** It passed 50 of 50 while an operator's edits were
  not reaching any rendered listing page, because every check reads the API's JSON or calls the catalog code
  directly. Its one guest-page check, step (d), happens to re-render for other reasons. Worth a check that
  loads a claimed listing cold and compares the `h1` against the patch.
- **The lite browse record does not carry `assistant`.** Deliberate: the shard is 1.3 MB and only the listing
  page offers Otto, which always has the full record by then. If a rail or card ever offers Otto, it needs
  adding to the sync.
- The ninth run's two open calls stand: a claimed shop with an empty menu still takes bookings, and a claimed
  shop's card still shows the crawled `dur`. Still nothing checked against real Stripe, no workflow runs
  `npm test` on its own, and Render environment variables remain untouched from here.

## 16 September 2026, eleventh run (08:05 to 09:00 UTC)

**Chosen, and why.** Almost everything left on Coverage's "not yet checked" list is out of reach tonight (the
operator chat needs a non-empty `src/data/listings.ts`, photo upload needs a real GitHub token, the Payouts
page needs a connected Stripe account) or is a product call for you. So this run went looking for territory
that was never on the list at all, and found one: **"Open now"**. `src/lib/openNow.ts` has no tests, appears
nowhere in Coverage, and decides what a guest reads on every card, on the listing page, in the booking sheet,
in the "Open right now near you" rail and in Otto's answers. Rather than read it, the whole shipped catalog was
run through it: 59,091 operators, 14,509 of them with published hour lines, every hour of every day. The
**rehearsal was skipped at the start**: the tenth run's entry said green and the only commit since it was that
entry. Both type checks and both unit suites ran at the start and at the end, and the rehearsal ran at the end
because both fixes touch `src/lib`; it is green, 50 passed and 0 failed.

**Found and fixed.**

- **A shop's phone number was being read as its opening hours** (`3ca26abcc`). A crawled hours line is one run
  of text and the crawler often glues the shop's own phone number to the front of it: "(512) 436-3505Office
  Hours: 9am-6pm". Read left to right, "436-3505" is a perfectly good time range, so the hours behind it were
  never reached. Seventeen shops shipped a week no clock could show, opening at 26, 36 and 52 o'clock, and
  their listings said "Closed, opens 12 PM" at every hour of every day. An Albuquerque balloon ride read
  "05-293" off its own number and told guests at three in the morning it was open until 5 AM. Glued on, the
  number hides the day too, so a Pennsylvania theatre published Friday alone out of Tuesday through Friday.
  The number now goes before anything is read off the line, a candidate range whose hour no clock could show
  is stepped over rather than taken, and three ways a real shop writes a time are read rather than lost: a dot
  for the colon, seconds, and no separator at all. Across all 14,509, twenty-six weeks change and every one is
  a correction; the other 14,483 are untouched. The same bad weeks are already baked into `catalog.json` and
  live there until the next sync, so `itemWeek` treats a compact day no clock could show as a day that was
  never published and falls back to the shop's own line.
- **An hours line that marks the afternoon once was only marking half of it** (`648e8b9c4`). "Mon-Thurs: 3:00 -
  10:00 pm" is a brewery that opens in the afternoon. An opening hour with no am or pm on it was read as AM
  whatever followed it, so that brewery opened at three in the morning, and so did 141 other shops: tap rooms,
  a distillery, theatres, a kart track running "Wednesday - Friday: 7-9:00PM", a winery open "1-6 PM". They
  said "Open, closes 10 PM" in the middle of the night, they qualified for the "Open right now near you" rail,
  and Otto answered "Yes, open now until 10 PM" at 3 AM. A marker written once at the end of a range now
  covers both ends of it, unless the opening hour is the later of the two on a twelve hour clock, so "9-5" and
  "8:30-5" stay mornings. Shops reading as open at 3 AM on a Wednesday fall from 596 to 534.

**Checked and clean.** Every one of the 26 plus 142 changed weeks was read against its source line by hand:
all are corrections, none loses hours a shop legitimately had. The two parsers are twins by design
(`parseWeek` in `src/lib/openNow.ts`, `encodeWeek` in `backend/src/sync/hours.ts`) and a sweep confirms they
agree on all 14,509 operators after the fix, as they must or a card and the page it opens would disagree.
Late closers, stated days off, OSM `opening_hours` lines and 24-hour notation all still read as they did.

**Tests.** `src/lib/__tests__/openNow.test.ts` (10) and `backend/src/sync/__tests__/hours.test.ts` (7), each
pinned to a named operator in the catalog, and each checked against the old code and failing on it. They cover
the phone number in front of the time and in front of the day, hours recovered from behind one, a date that
must not become an opening time, the three unusual time formats, the shared afternoon marker, and the morning
shapes that must not move. 106 guest tests and 108 backend tests pass, both projects type-check clean.

**Needs Harshil.**

- **The 17 bad weeks are still in `public/catalog.json` until a sync runs on Render.** The guest side now
  refuses to believe them, so nobody sees "Closed, opens 12 PM" any more, but the compact weeks themselves are
  only rewritten by `npm run sync`. Worth running one.
- **Roughly 500 shops still read as open at 3 AM, and it is not the parser.** Most publish "Mon-Sun 12:00 AM -
  11:59 PM", which is schema.org boilerplate for "call us" rather than a claim to be open all night, and a
  handful have a campground's quiet hours ("No generators 10pm-7am") crawled as opening hours. Deciding
  whether a 24-hour span means "always open" or "no hours stated" is a product call, and it belongs in the
  extractor rather than here.
- **The rehearsal command in the nightly prompt has the wrong path.** It says `scripts/e2e-local.mts`; the
  file is at `backend/scripts/e2e-local.mts`. From the repo root the given command exits 0 with
  ERR_MODULE_NOT_FOUND, so a run that trusted the exit code would record a green rehearsal that never ran.
- The earlier runs' open calls stand: a claimed shop with an empty menu still takes bookings, a claimed shop's
  card still shows the crawled `dur`, the rehearsal still cannot see a guest's rendered page, nothing is
  checked against real Stripe, and no workflow runs `npm test` on its own.

## 16 September 2026, twelfth run (09:05 to 10:25 UTC)

**Chosen, and why.** Coverage's "not yet checked" list ends with the two things no run has opened:
`zoneFor`, the map that decides which clock a shop's hours are read on, and `geo.ts` / `places.ts`, the
distance stamps and "near me". Everything above them on that list is out of reach tonight (the operator chat
needs a non-empty `src/data/listings.ts`, photo upload a real GitHub token, Payouts a connected Stripe
account) or is a product call for you. Rather than read the map, the whole shipped catalog went through it:
59,091 operators, every state and province, both parsers compared row by row. The **rehearsal was skipped at
the start**: the eleventh run's entry said green and the only commit since it was that entry. Both type checks
and both unit suites ran at the start and at the end, and the rehearsal ran twice at the end, because every
fix here touches `src/` or `backend/src`: **50 passed, 0 failed** each time.

**Found and fixed.**

- **Every shop in Oregon was an hour ahead of itself** (`716246929`). Mountain time in Oregon is Malheur
  County, in the south east corner, but the nudge asked for `lon < -117.1`, which is everything WEST of the
  Idaho border, so 1,028 of the 1,029 Oregon listings were on Mountain time and the one that really is
  Mountain was on Pacific. Portland, Salem, Eugene and the whole coast. A card read "Closed, opens 9 AM
  tomorrow" while the shop still had an hour to run, the "Open right now near you" rail dropped them an hour
  early, Otto answered on the wrong clock, and on the API side an hour came off every remaining start time
  and the day rolled over to tomorrow at 11 PM. Both parsers are twins by design, so both moved.
- **A shop whose town was never scraped had no state at all** (`42e1aa515`). The sync writes the area as
  "town, code", and when the crawl never found a town it writes the code alone: 4,736 of the 59,091 rows, and
  that is the honest gap the rules ask for, not a missing region. Both clocks wanted a comma in front of the
  code, threw all of them away and fell back to a band of longitude. **1,669 operators were on a clock an hour
  out**: a Tucson stable on Denver time, so it moved every spring while Arizona did not; a Kalispell outfitter
  on Pacific; Saskatchewan keeping a daylight saving it does not observe; St John's losing its half hour.
  Across a week that is 7,663 wrong "open now" readings on 377 shops.
- **1,030 Canadian shops were priced in US dollars** (`8ee869924`). `currencyForArea` read the province with
  the same comma-first regex, so every one of those areas took the fallback, which is usd. A Toronto booking
  raised its payment intent in usd, both emails read "$185.00 USD" where they should have read "CA$185.00",
  and the Connect account the payouts page offered was a US one. It reads the province the way the clock does
  now, so the two cannot drift apart again.
- **Picking a province showed a fraction of it** (`cbebda511`). The same gap in `regionOfArea` left those
  4,736 listings in no state or province, so a guest who searched Saskatchewan was offered 63 businesses and
  shown 63, when there are 224. Manitoba read 73 of 225, Newfoundland 34 of 94, the Northwest Territories one
  of twelve. They were missing from the "more like this" rail on every listing page in their own state too.
- **Smaller** (`78914ab42`). A feed card appended the metro to that same townless area, so fourteen Florida
  rows read "FL, Orlando" instead of "Orlando, FL", and a landing page's FAQ listed a state code among the
  towns its listings are in: "including places in FL, Tampa and Clearwater", on a published page.

**Checked and clean.** The other eight split-state nudges, in both directions, against named operators:
Florida's panhandle, El Paso, western Kentucky, eastern Tennessee, the Dakotas and Nebraska, north Idaho,
Michigan's upper peninsula and the BC Kootenays. That the guest parser and the API parser agree on all 59,091
rows after the change, as they must or a card and the times it opens would disagree. That no area the old
regex read is now read differently: exactly one row, "Mt, NJ", would have moved to Montana under a naive
left-to-right read, and the town is never read at all. 125 rows still have no region, down from 4,872.

**Tests.** `src/lib/__tests__/zoneFor.test.ts` (5) and `regionOfArea.test.ts` (3),
`backend/src/lib/__tests__/zone.test.ts` (+3), `backend/src/payments/__tests__/currency.test.ts` (4) and one
more in `pages.test.ts`, each pinned to a named operator in the shipped catalog and each checked against the
old code and failing on it. 114 guest tests and 116 backend tests pass, both projects type-check clean.

**Needs Harshil.**

- **The two distance stamps disagree on units.** `formatDistance` in `src/lib/geo.ts` gives a US listing miles
  and a Canadian one kilometres; `fmtDistance` in `src/lib/places.ts` says "Metric everywhere" and gives
  kilometres to everyone. A guest on a phone reads "5 km away" on the Explore card and "3.2 mi away" in the
  sheet that card opens, for the same shop. Both look deliberate where they are written, so which one wins is
  yours. The country is now cheap to know, from `regionOfArea` and `CA_REGIONS`.
- **Arizona still moves on the Navajo Nation.** `AZ` is America/Phoenix for the whole state, and the Navajo
  Nation in the north east does observe daylight saving. The same shape as the Oregon fix would handle it, but
  the boundary is a reservation and not a longitude, so it wants a real decision.
- **The 4,736 townless areas are a supply gap as well as a parsing one.** They now read correctly everywhere,
  but a card that can only say "SK" is still a card with no town on it. Worth a pass in the enricher.
- The fix to `regionOfArea` is one line in `src/data/regions.ts`, which is outside the folders this run
  usually keeps to. Nothing else this run left `src/lib`, `src/components`, `backend/src` or `docs`.
- The earlier runs' open calls stand: a claimed shop with an empty menu still takes bookings, a claimed shop's
  card still shows the crawled `dur`, the rehearsal still cannot see a guest's rendered page, nothing is
  checked against real Stripe, no workflow runs `npm test` on its own, and the bad weeks in `catalog.json`
  still want a sync on Render.


## 16 September 2026, thirteenth run (10:00 to 11:40 UTC)

**Chosen, and why.** Coverage's "not yet checked" list has `geo.ts` and `places.ts` as read but never driven:
the Photon geocoder behind the Where box against a slow or dead endpoint, and `currentLocation` with the
browser's permission refused. Everything above them is still out of reach (the operator chat wants a non-empty
`src/data/listings.ts`, photo upload a real GitHub token, Payouts a connected Stripe account) or is a product
call for you. So the Where box, the phone search sheet and the Explore feed were driven in Chromium with the
geocoder killed, slowed, and answering late, and with location refused and with the prompt left unanswered.
The **rehearsal was skipped at the start**: the twelfth run's entry says green and the only commit since it was
that entry. Both type checks and both unit suites ran first, then the rehearsal ran at the end, because every
fix here touches `src/` or `backend/src`: **50 passed, 0 failed**.

**Found and fixed.**

- **Pressing "Nearby" could kill it for the rest of the visit** (`52ec7b090`). The Where box and the phone
  sheet both disable that row while they await `currentLocation()`, showing "Finding you…". The promise could
  never settle. `getCurrentPosition` is given `timeout: 8000`, but the Geolocation spec stops that clock while
  the browser asks for permission, so a guest who leaves the permission bar unanswered gets neither callback,
  ever. Driven in Chromium with permission withheld, neither had fired 62 seconds later and the row was still
  "Finding you…", still disabled, on the desktop and at 400px alike, with a reload the only way back. It
  settles on a clock of its own now. A refusal also said nothing at all: the row just reset, so a guest pressed
  it again and again. Both surfaces say why, and point at the box that does work.
- **"Nearby" was the commonest town in the catalog** (`94c0b8840`). `npm run sync` wrote
  `city: l.city || "Nearby"` for a chain's other venues, so every venue whose own town the crawl never read
  shipped as a place called Nearby: **64 of them on 24 listings**, against 11 for Orlando, the next most
  common. The app read it as a place name. Trapped of Vancouver offered a venue reading "Nearby · 3,337 km
  away", the listing page headed seven of Exit's eight Calgary-area venues "Nearby", and every one of those
  map links went off to Google Maps searching for a town called Nearby. The sync keeps the honest gap now, and
  the guest side names a venue by its street, or says "Another location" and links to the coordinates, for the
  bare pins already in `catalog.json`.
- **A picked province was an hour's drive from the middle of it** (`793e0951b`). The desktop home and the phone
  Explore feed each had their own answer to "is this listing at the place the guest picked", and `state.near`
  is shared, so the same guest saw two catalogs one click apart. The Where box offers "Saskatchewan · 224
  places"; picking it and pressing "Open the phone app" gave **8 cards**, the ones with photos within 80 km of
  a point in a field near Davidson, each reading "SK · 16 km away", which is a distance from nothing a guest
  has heard of. It gives 18 now, the province's photographed listings, named by their towns. The phone also
  measured a chain from whichever pin the catalog leads with rather than its nearest venue, which places 182
  listings wrongly and 60 of them by over 50 km. There is one definition now, `atPlace` in `explore/feed.ts`,
  and the desktop imports it.
- **Smaller** (`90ede5e91`). `fmtDistance` picked its band from the raw number and rounded afterwards, so
  anything from 995 m to a kilometre read "1000 m away" and 9.96 km read "10.0 km".

**Checked and clean.** The geocoder killed outright: the Where box degrades to the metros and the state rows,
nothing hangs and nothing throws. The geocoder answering four seconds late while the guest keeps typing: the
stale answer is discarded and the fresh one wins, as the effect's `live` flag intends. The ordinary near-me
path with permission granted, on both surfaces, nearest first. No sideways scroll at 400px on any screen
touched. That the 64 placeholder venues are the only non-place town in all 277 distinct venue towns shipped.

**Tests.** `src/lib/__tests__/currentLocation.test.ts` (5), `venueLabel.test.ts` (6), `atPlace.test.ts` (6) and
`fmtDistance.test.ts` (4), each pinned to a real catalog row where it names one. 134 guest tests and 116
backend tests pass, both projects type-check clean, rehearsal 50 of 50.

**Needs Harshil.**

- **The Where box can only find a town through a third party.** Saskatoon has listings in our own catalog, but
  it is not one of the 47 metros, so the only way to pick it is Photon. With Photon down or rate-limited (it is
  free and unkeyed) the Where box loses every town in the US and Canada that is not a metro, and tells the
  guest to "try a bigger town nearby". Indexing the towns our own `area` lines already carry would end the
  dependency, but it is a product call.
- **Trapped's own street address is in the wrong province.** The primary contact line reads "2273 Dundas
  Street West, Vancouver, BC L5K 2L8": a Mississauga street and a Mississauga postcode under a Vancouver town
  and pin. Street, postcode and area are read from different sources and glued together, so this shape can
  repeat. Worth a sweep of postcode against region in the enricher.
- The twelfth run's calls stand: the two distance helpers still disagree on miles against kilometres
  (`formatDistance` in `geo.ts` gives a US listing miles, `fmtDistance` gives everyone kilometres), Arizona
  still moves on the Navajo Nation, and the 4,736 townless areas are still a supply gap.
- The earlier runs' open calls stand: a claimed shop with an empty menu still takes bookings, a claimed shop's
  card still shows the crawled `dur`, the rehearsal still cannot see a guest's rendered page, nothing is
  checked against real Stripe, no workflow runs `npm test` on its own, and the bad weeks and the 64 "Nearby"
  venues in `catalog.json` both want a sync on Render.

## 16 September 2026, fourteenth run

**What I checked and why.** Everything the thirteenth run left green was left alone: no commit had touched
`backend/src`, `src/` or the scripts since its log entry, so the rehearsal was skipped at the start and the
time went on the "Not yet checked" list instead. Type checks and `npm test` on both sides first (clean, 134
and 116), then the two hours questions that list has been carrying since the eleventh run, read against all
31,950 hour lines and all 59,091 operators in the shipped catalog rather than by eye. That ran into a third
bug in the same week of code, and that into a fourth in the publish path beside it. The rehearsal was run at
the end, twice, because by then the changes reached code it drives.

**Found and fixed.**

- **37 campgrounds published their quiet hours as their opening hours** (`983654db5`). "Quiet hours are from
  11:00pm - 8:00am" is the only hours line each of them has, so the week was the truth turned inside out:
  "Closed, opens 11 PM" at lunchtime, "Open now, closes 8 AM" at two in the morning, and Otto answering
  "their hours say: quiet hours are from 11:00pm - 8:00am" to a guest asking whether they were open. Seven
  bars lost hours the same way: a trailing "Happy Hour Wednesday-Friday 12-6 PM" comes after the site's own
  "Wed 12:00 PM - 10:00 PM" and the later line wins, so the brewery shut four hours early three days a week,
  and one shop's only line opened it at 2 AM. 44 operators, 43 weeks changed, 38 of them to an honest gap.
- **166 operators claimed to be open at four in the morning, 132 of them every day** (`e52499519`): 25
  helicopter tours, 17 fishing charters, 7 jet ski rentals and the rest, standing in "Open right now near
  you" all night under "Open, closes 11:59 PM", a closing time none of them stated. Two readings put them
  there. A day named in the markup with no time at all was read as open around the clock, which is a guess
  and the wrong one, since the Jordan Schnitzer Museum of Art lists "Mo" and "Tu" bare because it is shut on
  both. And "00:00-23:59", which is what a site builder writes when the owner never set any hours.
- **An operator's own opening hours never reached a guest who was not the operator** (`ec5bea47d`). The patch
  cleared the crawled compact week with `hrs: undefined`, and the same patch goes to every other device as
  JSON, which drops an undefined key. A shop that published Monday to Saturday, 7 AM to 11 AM, and shut on
  Sunday was advertised as open nine to five all week, Sunday included, to everyone except the operator,
  whose own screen was right the whole time. The crawled `dur` outlived the menu the same way: a shop whose
  every service now said 90 min was still "4 hours" on the card, the hero, the booking sheet and in Otto.
- **A photo an operator removed stayed on their listing** (`936f35a2b`), for the same JSON reason: emptying
  the gallery published `photos: []` and left the crawled cover, which the card, the hero and the guest's
  gallery all read first.

**Checked and clean.** The other subjects that carry a time range and are not quiet hours: office, kitchen,
gate and pool hours are trading hours and stay; "last admission at 3:30pm" sits behind the real range and was
already stepped over. Every remaining `undefined` in the published patch (`guide`, `contact`, `cover` before
this run, a service's `maxGuests`) against the same round trip: only `hrs` and `cover` meant "clear this".
A stated closing time in the small hours ("6pm-2am") and a stated closed day survive all four fixes.

**Tests.** `publishedPatch.test.ts` (5) and `hoursMarkup.test.ts` (3) are new, `openNow.test.ts` and
`sync/__tests__/hours.test.ts` gain 4 between them, each pinned to the operator it names. 143 guest tests and
121 backend tests pass, both projects type-check clean, rehearsal 50 of 50 twice.

**Needs Harshil.**

- **210 operators still carry the wrong week in `catalog.json`**, because this morning's sync (`44b7237bd`,
  07:12) ran on the old code. The app refuses the 166 whole-day weeks from the compact form alone, and the 44
  quiet-hour ones on the listing page and in Otto, but not on a card or in the "Open right now near you"
  rail, where a lite record carries no hour lines to fall back on. A sync on Render clears all 210.
- **A judgment call worth your eye**: 158 of those 166 now publish no hours at all rather than a whole day.
  If any of them genuinely trade around the clock, that is now an honest gap and only a re-crawl that reads a
  real statement ("Open 24 hours") puts it back. In these categories I could not find a credible one.
- The thirteenth run's calls stand: the Where box still depends on Photon for every town that is not one of
  the 47 metros, and Trapped's street address is still in the wrong province. The twelfth's stand too: the two
  distance helpers still disagree on miles against kilometres, Arizona still moves on the Navajo Nation, and
  the 4,736 townless areas are still a supply gap. The earlier runs' open calls stand: a claimed shop with an
  empty menu still takes bookings, the rehearsal still cannot see a guest's rendered page, nothing is checked
  against real Stripe, no workflow runs `npm test` on its own, and the 64 "Nearby" venues still want a sync.

## 17 September 2026, fifteenth run (05:00 to 06:40 UTC)

**Chosen, and why.** 115 commits had landed since the fourteenth run's entry, `src/` and `backend/src` among
them, so the rule said run the full rehearsal, and that was the whole story again: **23 of 52 steps failed**,
and the cause was not any of them. The time then went on the newest thing in the product and the one no run has
looked at, the guest's card step: Stripe's embedded checkout (`7d49ebab1`, sixteen hours old) and the `/config`
read it depends on. Type checks on both sides and both unit suites ran at the start and at the end.

**Found and fixed.**

- **The page's own policy blocked every call to its API unless that API was the production one** (`a386941d5f`).
  The site is static, so its Content-Security-Policy is a meta tag in `index.html`, and its `connect-src` named
  `https://outset-api.onrender.com` and nothing else. Any build pointed elsewhere could not reach its own API at
  all: Chromium refuses the fetch before it leaves the page, and every call in `src/lib/api.ts` then degrades
  exactly the way it does with no API, which is silent by design. Proved in Chromium against the rehearsal's own
  site: `Refused to connect to http://localhost:8787/claims/.../rule`, and zero requests in the API log. So the
  rehearsal has been red since the policy landed and reading as a broken product, no test bypass on the claim
  screen, no operator edit reaching the API, no booking ever sent, and `npm run dev` against a local API is the
  same. The origin a build was pointed at now goes into `connect-src` at build time; a build with no
  `VITE_API_URL` is untouched. `hooks.stripe.com` joined `frame-src` with it, which is where Stripe puts a card's
  3D Secure challenge, so leaving it out fails the payment and not the frame.
- **A slow `/config` once told the guest they would not be charged, then took their card** (`bf008195cd`).
  `apiConfig` remembered a failed read for the rest of the session, and the API host sleeps when idle while that
  read gives it five seconds. So the first guest of the morning could read "Request to book, $213" with "You
  won't be charged yet" under it, on a shop that takes cards. Pressing it created a Stripe session all the same:
  the API decides that from the listing's own price and has never asked the browser. It also cost the embedded
  form, which needs the publishable key from this same read and fell back to the hosted page for the visit.
- **A card form that failed to load once could not be tried again** (`3178eb2819`). The Stripe.js promise was
  kept whatever became of it, so one blocked or dropped request left every later attempt awaiting that same
  rejection and failing with no request at all, under a message reading "You can try again from the booking box".
- **Five email checks in the rehearsal went quiet the day the log stopped printing addresses** (`5eb87c5728`).
  Masking the recipient in the `[mail:dry]` line was right; the five checks grepped that line for the raw
  address, so from that commit on all five reported a product that had stopped emailing anyone, while the step at
  the end of the same run read 14 messages and passed. They read the messages themselves now, out of
  `MAIL_DUMP_DIR`, which is also stricter: two of the harness's guests share a first letter and a domain.
- **The phone told a guest nothing would be charged, then asked for their card** (`09a6507adc`). The desktop
  listing has read `/config` and said "Secure card payment, your card is held" since cards were switched on. The
  phone's review-and-pay screen never read it, so on the same listing it said "This is a request. <shop> confirms
  by email, and nothing is charged until they do" over a button reading "Request to book". That is the screen
  most guests see: on a phone the frame goes away and this is the whole app.
- **The card form said `aria-modal` and let the keyboard walk straight out of it** (`0a69c71d53`). Nothing moved
  focus into it, Escape did nothing, and Tab went from the dialog into the listing underneath, on the one screen
  in the flow whose only way out is a single button.

**Green after the fixes.** Rehearsal **52 passed, 0 failed**, from 29 of 52. 224 guest tests and 189 backend
tests pass, both projects type-check clean. 22 new tests across `csp`, `apiConfig`, `stripeJs`, `cardNotice` and
`checkoutDialog`, each checked against the old code and failing on it.

**Needs Harshil.**

- **Closing the card form holds the guest's own time for thirty minutes.** The booking row is written as
  `pending` before Stripe is reached, and `holdsSlot` counts a pending row for `PENDING_HOLD_MS`. Every unclaimed
  listing has no capacity set, so one held row fills the time. A guest who closes the form, or whose form fails
  to load, is told "You can try again from the booking box", presses again, and is answered **409 "That time was
  just booked"** about their own abandoned attempt, and the picker then drops that time. The fix is a route that
  expires the Stripe session and releases the row when the guest closes, and it touches the money path, so it was
  not written blind: with no Stripe key nothing here can create a pending row at all, so the happy path cannot be
  driven tonight. It wants a run with `STRIPE_TEST_SECRET_KEY`, which this routine may not set.
- **Nothing tonight could touch real Stripe, and the whole embedded checkout is in that gap.** The form is
  mounted by Stripe.js with a live publishable key; with no key it is never reached. What was checked is the
  code around it and the policy it needs. The 3D Secure host added to `frame-src` is Stripe's documented policy,
  not something observed failing here. Worth one pass with a test key: `STRIPE_TEST_SECRET_KEY=sk_test_... npx
  tsx scripts/e2e-local.mts` drives the hosted page, and the embedded one still wants a person.
- **The CSP fix needed `index.html` and `vite.config.ts`**, both outside the folders this routine keeps to, plus
  a new `src/lib/csp.ts` that only the Vite config imports. Nothing else this run left `src/lib`,
  `src/components`, `backend/scripts` or `docs`.
- The earlier runs' calls stand: a claimed shop with an empty menu still takes bookings, the two distance helpers
  still disagree on miles against kilometres, Arizona still moves on the Navajo Nation, 210 operators still carry
  the wrong week and 64 venues are still called Nearby in `catalog.json` until a sync runs, the Where box still
  depends on Photon, and no workflow runs `npm test` on its own.

## 17 September 2026, sixteenth run (06:00 to 06:40 UTC)

**Chosen, and why.** No commit had landed since the fifteenth run's entry, which says green, so the
**rehearsal was skipped at the start**: both type checks and both unit suites ran instead, and the time went on
the one thing high on the list that Coverage does not claim, the booking box's grouped service picker and the
option rows behind it. That turned into the money path within the hour. The rehearsal ran twice at the end,
because every fix here reaches code it drives.

**Found and fixed.**

- **A room's capacity was read as its price per head** (`220ae94e8`). `perPerson` searched the option's name and
  detail for a person word *before* it looked at the unit the operator's own site printed, so a capacity ("Event
  space for up to 200 guests"), a ratio ("2:1 guest to guide") and a seat count ("Jets seating 12-19
  passengers") all said "per person". "$18,500 / group" was then multiplied by the party: the booking box quoted
  a party of four **$74,000**, and `money.ts` charged the card the same, because the two are twins by design.
  **1,726 priced options on 808 operators** were multiplied that way, among them 643 trips, 624 group rates, 179
  hourly rates and 82 campsite nights. A stated unit settles it now and is read first, which is the rule the
  claimed side has always used (`perUnitLooksPerGuest` reads the unit and nothing else). Nothing moves the other
  way: no guest starts being charged more than before.
- **The phone never said the party was what turned $29 into $116** (`231f20fd8`). The Price details line is the
  only place that says a per-person price was multiplied, and both desktop surfaces have shown "$29 × 4 guests"
  since cards were switched on. The phone's review-and-pay screen showed "Sunset sail · 2 hours  $116" under a
  tier row reading "$29", leaving the guest to work out where the other three came from. On a phone the frame
  goes away and that screen is the whole app.
- **Nine listings told guests "Up to 0 guests"** (`ce6b1b563`). The listing page took the first "<number>
  <people>" on a group line and called it the maximum. A thousands separator left the tail behind, so "Group
  events for 10 to 3,000 guests" matched "000 guests". On **47** more the number was a floor the line had just
  stated: "Helicopter tours require minimum 2 passengers" read "Up to 2 guests, Group size", which sends a
  family of four away from a flight that would have taken them, and a line naming both ("minimum 6 guests,
  maximum 10") showed the smaller. Otto has never made either mistake. There is one reader now, `groupCap` in
  `listingDerive.ts`, shared by both surfaces: 27 listings corrected, 47 floor-only lines now show no row rather
  than a wrong one, 3,966 unchanged and none gained. The lines themselves are still listed in full under Groups.

**Checked and clean.** Service tier labels that collide, over all 62,054 services shipped: exactly one, on the
test shop, and the server already resolves it from the guest's own total. Add-ons with no price: none in the
catalog, and a blank price in the dashboard is documented to mean a free extra, so "Free" is right. The
Availability page against hours that end before they start: three earlier fixes already hold, including a
select that sat blank on an inverted day. Per-service `maxGuests` against a party already chosen: the picker
brings the party down with it. Whether the perPerson change ever charges more: it does not, on any of the
44,317 priced options in the catalog.

**Tests.** `perPerson.test.ts` on each side (8 and 7, including one that holds the two implementations to the
same answer), `partyLine.test.ts` (4) and `groupCap.test.ts` (7), each pinned to the real rows it names and each
checked against the old code and failing on it. One existing assertion in `priceBooking.test.ts` pinned the old
reading of a scraped "/cabin" as per person, which its own comment calls the hazard; it is updated, and an
unknown unit still falls back to the words. 243 guest tests and 196 backend tests pass, both projects
type-check clean, rehearsal **52 of 52** twice.

**Needs Harshil.**

- **The listing page and Otto still name different group sizes on 799 listings.** They read different fields on
  purpose: Otto also reads specs, requirements and policies, the page reads only `groupInfo`. Both are honest
  now, but a guest who asks Otto "how many of us can come" can get one number and read another on the page.
  Which of the two is the listing's answer is a product call.
- **A guest can still ask for a party larger than the shop says it takes.** 1,255 listings state a group size
  under 20, mostly six-passenger boats, and the picker offers up to 20 on any scraped listing, because
  `maxGuestsFor` only reads a `maxGuests` a claimed operator set. Wiring `groupCap` into the picker is a
  behaviour change on thousands of listings and wants your call, not a night's.
- **`Sunset sail` is listed twice on the test shop**, both "2 hours", at $29 and $19, so the booking box shows
  two rows a guest cannot tell apart. The dashboard warns an operator who does this ("Another service has this
  name"), and the server picks the right tier from the guest's total, so nothing is mischarged. It is your own
  test data, easy to fix from Services.
- The earlier runs' calls stand: everything needing a real Stripe key is still untouched, a claimed shop with an
  empty menu still takes bookings, the two distance helpers still disagree on miles against kilometres, Arizona
  still moves on the Navajo Nation, 210 operators still carry the wrong week and 64 venues are still called
  Nearby in `catalog.json` until a sync runs, the Where box still depends on Photon, and no workflow runs
  `npm test` on its own.


## 17 September 2026, seventeenth run (07:00 to 08:40 UTC)

**Chosen, and why.** No commit had landed since the sixteenth run's entry, which says green, so the
**rehearsal was skipped at the start**: both type checks and both unit suites ran instead. The time went on
the one thing Coverage names that no run has ever opened, the **operator dashboard's Home feed**. It is the
screen an owner opens every morning, and inside an hour it turned into the money path again. The rehearsal
ran at the end, because every fix here reaches code it drives, and it now opens that page itself.

**Found and fixed.**

- **The front page counted the guest's service fee as the operator's money** (`53f076ba5`). Home's two tiles
  summed each booking's `total`, which is what the guest paid: the operator's price plus the guest's stepped
  service fee. What an operator receives is that price less Outset's 5%, which is what their booking email
  prints as "You receive" and what the Payouts page has shown since that page was corrected. A $29 a head
  sail for four read **"$121 on the books"** beside an email promising **$110.20**, and the Payouts page the
  second tile opens named that $110.20 for the same trips. Two smaller readings went with it: a trip
  completed today was money on the books *and* money earned in the last 30 days, in both tiles at once, and
  sample rows, which Payouts has never counted, were money here. There is one payout rule now,
  `bookingPayout`, which the Payouts page reads as well.
- **A price the API had already recorded was guessed back out of the total** (`4d5fbc0cb`). The guest fee
  steps down at $100 and at $500, so a total does not name one price: **600** of the operator prices between
  $1 and $2,000 in cent steps share a total with a higher one, and the inverse hands back the higher. A
  $495.01 trip was promised **$475.01** against the **$470.26** Stripe sends. The same commit fixes the
  booking drawer, which printed "Guest pays $121 · you receive $116": that $116 is the "Your price" line of
  the email, a whole fee above the "You receive" line under it.
- **The calendar's week total was the guest's money too** (`9071e3467`), on the very page Home's first tile
  opens, so the week Home now calls $110.20 read $121 there. A week with nothing in it prints no figure at
  all now, rather than "$0 this week" beside a grid of sample rows.
- **"Your calendar is open" was told to a shop with five requests waiting in that week** (`dfab7f227`). The
  Next 7 days tab lists confirmed bookings only, so a week of unanswered requests read as an empty week, two
  lines under a Needs action badge reading 5. A shop whose next booking is eight days out was told the same,
  with no mention of the bookings behind it.
- **The rehearsal opens Home** (`844e38774`), which no check had ever done, and that is how these tiles went
  unread. It accepts a request, reads the "On the books" tile and holds it to the API's own record of the
  booking. An empty page warns rather than passes.

**Checked and clean**, read rather than driven except where the rehearsal now goes. The Home feed's buckets
against the Bookings page's: the same rows, the same statuses, nothing lost between them. The setup
checklist's twelve jump targets, every one present on its page. The tab the page opens on, and what
answering a request does to it. `DAY_SHORT` against `getDay()` on the day headings. The samples banner and
its Remove. The hidden and paused banners on a freshly claimed shop, which starts published. Accept and
Decline from Home, which is the same `decide` the Bookings page uses, rollback and all.

**Tests.** `homeMoney.test.ts` (14) and `homeEmpty.test.ts` (5). Each is pinned to the figures the old code
gave as well as the right ones ($121 against $110.20, $475.01 against $470.26), and each carries a source
check that fails on the old page outright; one walks every price whose guest total is shared and holds the
dashboard to `splitBooking` in `backend/src/payments/money.ts` cent for cent. 262 guest tests and 196
backend tests pass, both projects type-check clean, and the rehearsal ran three times: **52 of 52** before
the new Home check existed, then **53 of 53** twice with it, its screenshot showing the tile reading
"$17.10 · 1 booking · after fees" where it would have read $19.

**Needs Harshil.**

- **Home's three tabs are `role="tab"` with nothing to control.** No `aria-controls`, no `role="tabpanel"`,
  no arrow-key movement, and the "All requests" link sits inside the `role="tablist"` itself. Doing it
  properly moves that link, which `.ohtabs` positions, and the night's rules keep me out of `src/styles`.
- **The "Next 7 days" tab still shows confirmed bookings only.** The line is honest now, but whether that tab
  should list the week's unanswered requests beside its confirmed ones is a product call, not a night's.
- The earlier runs' calls stand: everything needing a real Stripe key is still untouched, `Sunset sail` is
  still listed twice on the test shop, the party picker still offers 20 on listings that state less, the page
  and Otto still name different group sizes on 799 listings, the two distance helpers still disagree on miles
  against kilometres, Arizona still moves on the Navajo Nation, and no workflow runs `npm test` on its own.
- **This clone opened on a detached HEAD**, and its local `main` pointed at a 15 September commit that
  `origin/main` does not contain (the Render payout blueprint one, which upstream has since replaced by
  another route). I moved `main` onto `origin/main` and pushed there. Nothing was lost, but a session
  starting here does not begin on a branch.

## 17 September 2026, eighteenth run (09:00 to 10:40 UTC)

**Chosen, and why.** No commit had landed since the seventeenth run's entry, which says the rehearsal was green
at **53 of 53**, so it was **skipped at the start**: both type checks and both unit suites ran instead, all
clean. The time went on the highest thing Coverage still listed as never looked at, **reviews and quotes as a
guest reads them**, over all 1,023 shipped listings that publish a quote and all 7,517 that publish a rating.
The rehearsal ran at the end because the fixes are in the listing page and the booking sheet it drives.

**Found and fixed.**

- **The comment form under a shop's reviews was being shown to guests as a review** (`e4490b0a0`). The crawl
  keeps what sat around the quotes on the operator's own page, and brought the page's furniture with it. Two
  listings drew a review card reading **"Your email address will not be published. Required fields are marked
  *"**, signed **"Name *"**. Three more drew the shop's own banner as a guest's words: "JOIN OUR TOP-RATED SAN
  DIEGO CRUISES", "BOOK ONLINE NOW", "Follow our IG page", that last one signed with a link to the shop's
  Instagram, which the card printed as the reviewer's name with "H" in the avatar circle. Nine more reviewers
  carried the site's label glued to the end of the name: "Laura G.Rating: 5", "MarkExecutive", "SophieDesigner",
  "AvaSoftware Engineer", "Jake M.Manager", "SCB Designs INC". Six of those are no longer reviews and the nine
  names read without the label. Over all **4,753** reviews the app can draw, nothing else moves: 4,747 remain,
  none added. A rule that dropped loud text would have been tidier and cost seven real reviews, so shouting is
  still a review.
- **A card promising Top rated opened a page that had never heard of it, on 758 listings** (`357ad77cd`). Four
  surfaces decide this and the desktop feed card alone asked for **50** public reviews at 4.8 where the phone
  card, the listing page and the phone sheet all asked for **100**. So 758 shipped listings had a desktop card
  shouting "Top rated" over a page with no laurel and no such line, and a phone card for the same business with
  no badge at all, which is exactly what the phone card's own comment says must never happen ("the same bar the
  desktop card uses, so a business is a guest favourite on both surfaces or neither"). One bar now, `topRated`
  in `src/lib/catalog.ts`, and the stricter of the two is the one kept.
- **A shop with one public review told every guest it had "1 reviews"** (`253a3f5c4`). Ten places print the
  count and the word together and every one wrote "reviews" whatever the number. **207** shipped listings
  publish exactly one.

**Checked and clean**, read or scanned rather than driven. Every author name on every shipped review (2,479 of
4,753 carry one) against being a person's name; every review text against site chrome, cookie lines, nav and
price fragments; every stored date against the "March 2025" it has to read as, every star count against the
words beside it, and every source label against the eight platforms named. The "More options" fold on the
booking box: a service can never fold every tier away, because the first one ordered is never folded. `promoOn`
and `todaysDeals` against the 48 deals on the 37 listings that publish one, including the five that run every
day and the five with a start or end time.

**Tests.** `reviews.test.ts` (13), `topRated.test.ts` (5) and `reviewCount.test.ts` (3). Each review case is
pinned to the real listing it came from and asserts the listing still carries the raw text, so the test says so
rather than passing quietly if a later sync fixes the data. Eight of the thirteen fail outright on the old
reading; the five that pass are the guards on what must not change. The reading itself moved to
`src/lib/reviews.ts` so a test can load it: `WebListing.tsx` imports CSS, which is why none of this had ever
been tested. 283 guest tests and 196 backend tests pass, both projects type-check clean, and the rehearsal
ran at the end, because these fixes are in the two pages it drives: **53 of 53**, 0 failed.

**Needs Harshil.**

- **6,513 listings show a star rating on their card and none on the page they open.** The listing page and the
  booking sheet print a rating only where there are written reviews under it, on purpose (the comment says so).
  The feed card, the phone card, the confirmation page, the compare table and the rating sort all print it
  unconditionally, because a lite record has no quotes to check. So a guest clicks "4.2 (2,797)" and lands on a
  page that never mentions a rating, has no Reviews link and no reviews section, then books and sees "4.2
  (2,797)" again on the confirmation. 1,699 of those clear the Top rated bar and show no laurel either. Both
  branches the page keeps for "a rating with no reviews" are currently unreachable. Which way this should go is
  a product call: print the rating on the page with an honest empty section, or drop it from the cards.
- **Two listings put the review's headline in the author slot**, so a card is signed "Birthday sailing trip" or
  "Excellent trip" with a "B" in the avatar. There is no rule that tells a headline from a name without also
  throwing away real ones, and it is six cards on two listings.
- **The phone sheet calls the same badge two names on one screen**: "Guest favourite" on the photo and "Top
  rated" in the highlight row under it. The desktop says "Top rated" in both places. Copy, so yours.
- The earlier runs' calls stand: everything needing a real Stripe key is still untouched, Home's three tabs are
  still `role="tab"` with nothing to control, `Sunset sail` is still listed twice on the test shop, the party
  picker still offers 20 on listings that state less, the page and Otto still name different group sizes on 799
  listings, the two distance helpers still disagree on miles against kilometres, Arizona still moves on the
  Navajo Nation, and no workflow runs `npm test` on its own.

## 17 September 2026, nineteenth run (09:00 to 10:30 UTC)

**Chosen, and why.** No commit had landed since the eighteenth run's entry, which says the rehearsal was green
at **53 of 53**, so it was **skipped at the start**: both type checks and both unit suites ran instead. The
time went on two of the open calls Coverage had been carrying for several runs, both of them cases of one fact
being read by two different readers that disagree, which is the shape of bug the last four runs kept turning
up. The rehearsal ran twice at the end, because every fix is in code it drives: **53 of 53** both times.

Worth recording for the next run: `npx tsc --noEmit -p .` at the root checks **nothing**. The root
`tsconfig.json` is solution style, `"files": []` with two references, so that command exits 0 having read no
source at all. `npx tsc -b` is the one that checks the app, and it is what ran here. The root `node_modules`
was also absent on this container, which made two unrelated suites fail until `npm install` ran.

**Found and fixed.**

- **Every American listing told guests how far away it was in kilometres** (`891a1720b`). `fmtDistance` in
  `places.ts` printed metric to everyone, and it is what the desktop feed card, the phone card, the listing
  page's key facts, the compare table and a chain's venue rows all call. **51,940** of the catalog's 59,163
  listings are in the United States, so a guest in Tampa read "19 km away" on the card, opened the booking
  sheet that card links to, and read "12 mi away" for the same shop: the sheet asked the other copy of the
  rule, `formatDistance` in `geo.ts`, which has been country aware all along. One rule now, in `geo.ts`,
  because `places.ts` reaches for `navigator` and the backend's own tests typecheck their way into `geo.ts`
  through `pricing.ts`. The country is a required argument, so a sixth call site cannot assume one. Canada is
  unchanged.
- **Otto told a guest a different group size than the page they were reading it on** (`55ad76814`). On **267**
  of the 1,722 shipped listings where both had a number they named different ones. The page reads the group
  lines with `groupCap`, which knows a range's floor from its ceiling and knows "10,000" is not "10"; Otto had
  its own reader that took the first ceiling word and the first count after it, so "Baskets hold 2 to 6
  passengers" gave 2 under a page saying 6. `capacityRule` asks the page's reader first. Otto keeps its wider
  scan of specs, requirements and policies for listings whose group lines say nothing, and that scan no longer
  reads a number that is not a count of people: it was answering 20 because a shop advertises "Views up to 20
  miles on a clear day", 48 from a pony ride's rider height and 5 from a "max 5 km/h" sign. Thirteen listings
  lose a number that way and quote the line instead.
- **Otto read a height in inches as a minimum age and turned an eight year old away** (`ec73a3d86`).
  "Children must be at least 48 inches tall to paddle in any of our kayak tours" had the assistant answering a
  parent with **"Not for Kayak Tour (48+)"**. Two of Otto's readers bridged "must be at least" to the first
  number a few characters later and never asked what it counted, so an age came out of a height, a "30 minutes
  prior" check-in, a "14 days in advance" refund window and the age on a senior ticket. **198** shipped
  listings quoted an age outside 2 to 21, and the page and Otto disagreed on **83** of the 1,210 where both had
  a number. The page's `minAge`, which wants an age word beside the number and keeps the answer between 2 and
  21, answers first; Otto's own scan carries the same two guards. 182 listings lose a number that was never an
  age. The listing page's own answers are untouched by either of the last two fixes.

**Tests.** `fmtDistance.test.ts` rewritten (11 cases, 5 fail on the old reading), `groupSize.test.ts` (5, four
fail) and `minAgeAnswer.test.ts` (4, all four fail). Each case is pinned to the real listing it came from and
first asserts that listing still carries the line, so a later sync that fixes the data makes the test say so
rather than pass quietly. Three of them sweep all 59,162 shipped detail files and assert no listing anywhere
reads two ways: on the old code those three report 267, 72 and 198. 299 guest tests and 196 backend tests
pass, both projects type-check clean.

**Needs Harshil.**

- **351 listings could print a group size they currently do not, and 32 would change the one they print.**
  `groupCap` counts "guests, people, passengers, riders" but not **players, persons, participants or anglers**,
  and does not read number words, so "Maximum six passengers per sail" and "Up to 4 players per game" print
  nothing. Widening it makes the page and Otto agree on all 2,073 listings that answer (measured), gains 351
  and loses none, but moves 32: about 23 of those are plainly better (an escape room's "Rooms hold 2-10
  players; can host up to 70 people per hour" stops printing 70), and **9 get smaller** because the shop lists
  its smallest craft first, so o-nextwavewatersports-com would say "Up to 2 guests" on a jet ski line while it
  also runs a 49-guest catamaran. That last group is a judgement call about which of several craft the line is
  for, so it is yours. The others: o-chicagoboatrentals-com, o-cocoabeachparasail-com, o-confusioncharters-com,
  o-heliny-com, o-jordanlakerental-com, o-mintjuleptours-com, o-sjwatersports-com, o-skypirateparasail-com.
- **A minimum age over 21 can never be printed.** `minAge` caps at 21, so "The registered renter and driver of
  the boat must be at least 25 years of age" shows nothing on the page and is now quoted rather than counted by
  Otto. The cap is what keeps senior fares and ticket rows out; raising it to 25 would admit boat and car
  rental floors, which are real rules guests get turned away by.
- The earlier runs' calls stand: everything needing a real Stripe key is still untouched, Home's three tabs are
  still `role="tab"` with nothing to control, `Sunset sail` is still listed twice on the test shop, the party
  picker still offers 20 on listings that state less, 6,513 rated listings still show a star rating on their
  card and none on the page it opens, Arizona still moves on the Navajo Nation, and no workflow runs
  `npm test` on its own.


## 17 September 2026, twentieth run (10:00 to 11:30 UTC)

**Chosen, and why.** The nineteenth run's entry says the rehearsal was green at **53 of 53** and nothing had
landed since, so it was skipped at the start: both type checks and both unit suites ran instead (`npx tsc -b`
at the root, since `tsc --noEmit -p .` there still checks nothing, and `tsc --noEmit -p .` in `backend/`). It
ran at the end, because both fixes are in code it drives, and one of its own checks (k7) reads the Free
cancellation badge: **53 of 53**. The hunt went after the shape of bug the last five runs kept finding, one
fact with two readers that disagree, in the two places on a listing page nobody had swept: **how long it
runs** and **what happens if you cancel**. Both turned out to have a reader that knew the rules and a reader
that did not, and on both the careless one is what a guest reads.

**Found and fixed.**

- **A campground told guests its trip ran 72 hours, which was its cancellation window** (`2c6d9cbe5`). The
  page, the booking sheet, a claimed shop's published patch and Otto all read a length off the same menu
  lines. Only the sync's reader knew those lines also state how much notice a cancellation needs and how far
  ahead a tee time opens, so the page printed what the sync had refused on **135 of the 178** shipped listings
  that fall back to it: "72 hours" from "Cancellations prior to 72 hours", "200 hours" from a yoga teacher
  training, "716 days". Otto read them out loud too, and a golf course's twilight round came back as "2 hours"
  because the rate starts two hours before close. Worse on a claimed shop, where the menu reader wins over the
  crawled fact: **130 listings** would have swapped a good duration for one of these the day they claimed,
  o-a1abeachrentals-com going from "2 hours" to "24 hours". One rule now in `src/lib/duration.ts`, which drops
  only the span a notice rule governs, so a "4-hour experience with priority scheduling" keeps its four hours,
  which the sync's line-wide test threw away because "priority" carries "prior".
- **A shop whose policy opens "NON-REFUNDABLE, non-cancellable" advertised Free cancellation** (`0e9f28eea`).
  The badge asked only whether "full refund" appeared anywhere in the policy, so it also caught the other
  promise operators publish, the one about a trip they call off themselves for weather. **72 of the 1,314**
  shipped listings carrying the badge had nothing behind it: "All sales are final. Full refund in case of
  operator cancellation due to weather", "Tickets purchased are non-refundable", "Deposits fully refundable
  only if weather causes trip cancellation", and one whose 12 hour window is sold separately as Trip
  Protection. The feed card, the listing page, the venue rows, the booking box and the Free cancellation
  filter all drew it, and the filter offered those shops to a guest who asked for exactly this. The rule now
  reads the policy a claim at a time over the cancellation text and the policy lines together, because the two
  promises usually sit in different lines, and keeps the badge only where a guest who cancels is promised
  something. o-seaspiritfishing-com keeps its badge on a policy line, o-hornbyislandsailing-com on
  "Cancellations up to 48 hours before trip without fee".

**Tests.** `duration.test.ts` (10 cases, 7 fail on the old reader) and `freeCancel.test.ts` (9). Each case is
pinned to the real listing it came from and first asserts that listing still carries the line. Three sweep all
59,162 shipped detail files: no listing derives a length nobody could book, none lets a claim replace a good
duration with a window, and none keeps a badge its policy never promises. 318 guest tests and 196 backend
tests pass, both projects type-check clean, rehearsal 53 of 53.

**Needs Harshil.**

- **The Free cancellation badge is now judged from the policy text, not only from the published `fc`.** That
  is what makes the 72 disappear without a sync, and it means a listing whose text says nothing either way
  keeps whatever the sync wrote. The rule errs towards not promising: about five of the 72 state a guest
  window in words that stop short of a refund ("48 hour cancellation policy", "Customer Cancellation are
  accepted 48 hours in advance"), and those lose the badge. If you would rather under-promise less, the line
  to move is `onlyOperatorCancels` in `src/lib/cancellation.ts`.
- **The window on the badge is still the first number in the policy, not the number beside the promise.** On
  **28 listings** those differ, and o-destinhelicopters-com reads "up to 6 hours before" over a policy whose
  full refund needs 24 hours notice. Fixing it means deciding which clause owns the badge when a shop states
  three windows, which is a product call.
- **This container checked out a detached HEAD and a stale local `main`**, 50 ahead and 50 behind the remote,
  so `git push -u origin main` pushes the wrong thing and is refused. The run's commits went up with
  `git push origin HEAD:main`, a fast-forward; nothing was forced and the stale branch was left alone. Worth
  knowing before a later run reaches for `--force`.
- The earlier runs' calls stand: everything needing a real Stripe key is untouched, Home's three tabs are
  still `role="tab"` with nothing to control, the party picker still offers 20 on listings that state less,
  6,513 rated listings still show a star rating on their card and none on the page it opens, Arizona still
  moves on the Navajo Nation, `groupCap` still counts no players or anglers, and no workflow runs `npm test`.

## 17 September 2026, twenty-first run (11:00 to 12:00 UTC)

**Checked, and why.** The Coverage list had the menu's prices, units, durations, tier labels and collisions
all verified, but not what the rows are *called*, so that is where this run went: every one of the 79,406
options and 62,054 services in the shipped catalog, read as a guest reads them. Not the rehearsal: the last
entry says 53 of 53 green and nothing since it touched code, so that time went on the hunt instead. The
rehearsal was run at the end, because this run did change code it covers.

**Found and fixed.**

- **A museum's closed exhibitions were a menu row a guest could book** (`a6bc2de56`). The crawl reads a shop's
  menu off their own pages and brings those pages' headings with it. "Past Exhibitions" is a bookable row on
  **333 listings** and carries a price on **118**, so the booking box took a date, a party and a card for an
  exhibition that closed: $5 at the Anchorage Museum, $22 at the Audain, **$3,000 per group** at o-aahmsnj-org.
  An FAQ heading does the same on 17 more, and a sentence the crawl cut in half put "Tickets are" and
  "Admission is" on the menu of 93 shops. One rule in `src/lib/menuRow.ts`, read by the catalog on every record
  the app loads (so the 59,162 shipped detail files are right tonight, with no sync) and by the booking API,
  which prices from the same menu. 405 rows go, off 350 listings; 110 shops are left with no menu, which is
  the honest state and what two thirds of the catalog already ships as. A name that only sounds like one of
  these stays: o-clearholistictherapies-com keeps its $150 Past Life Regression, o-escapology-com its room
  called "Who Stole Mona?", and o-intheflowflyfishing-com the $150 and $300 under "Ready to go fishing?".
- **Every service tier after a gift card pointed at the wrong trip** (`0dda90e3f`). `options` and `services`
  are two views of one menu joined by an `optionIdx`. An earlier run taught `options` to drop a membership, a
  season pass and a gift card, the way `services` already did, but the services loop went on numbering its
  tiers against the whole menu. From the first dropped row on, every tier was one place too far: picking
  "2.5 hours, $220" would have selected the row under it, and the last tier pointed past the end at nothing.
  Nothing shipped with it, because `public/o` predates the options filter; the next sync is what would have
  carried it. One map now decides which rows become options and where each lands, and both views read it.
- **A shop's description was the theme's Lorem ipsum** (`4f88c0eb7`). 26 listings publish a page theme's
  placeholder as their own words, on the blurb under the title or on a service a guest picks: "Lorem ipsum
  dolor sit amet, consectetur adipiscing elit." is 56 characters of well-formed prose ending on a full stop,
  so every check `cleanBlurb` makes waved it through. Ten more publish binary, because the crawl read a PDF as
  text at o-elgintexas-gov and o-hallcounty-org. Both now read as no description. Fifteen more lost a byte of
  an apostrophe or a dash and printed a black diamond mid-sentence; that is real copy with one character
  missing, so it is repaired rather than dropped (`src/lib/ownWords.ts`, read by the catalog and by the sync).

**Green after the fixes.** 339 guest tests (21 new) and 201 backend tests (5 new), both projects type-check
clean, rehearsal 53 of 53.

**Needs Harshil.**

- **108 of the archive rows carried a real admission tier** ("Adults $17", "Museum admission $5", "Seniors",
  "Student with ID"). The price is almost certainly the shop's real admission, attached by the crawl to the
  wrong heading. Dropping the row loses a bookable admission at about 60 museums until a re-crawl reads it
  under a proper name. The alternative was to keep a row that says a guest is booking the past, which is
  worse. If you would rather keep them, the line to move is `ARCHIVE_ROW` in `src/lib/menuRow.ts`.
- **338 rows are called "Buy Tickets" and 123 "Schedule a tour".** Those are buttons, not services, but each
  one does lead to the thing the shop sells, so nothing was dropped or renamed. "Tickets" and "Tour" would
  read better and it is a supply call, not a bug.
- **Four listings price a real menu under an FAQ heading**: o-escapegameknoxville-net sells every room under
  "What is an escape room?" ($40 for two, $545 for a pizza party) and o-totallytikitours-com its adult and
  child fares under "How Do I Book A Cruise?". Those are kept, because dropping them takes the shop's whole
  menu, so they still read oddly to a guest.
- **17 listings still show mojibake** ("speciesâ€"Chinook" at o-lastcastguiding-com): a Windows-1252 byte read
  as UTF-8, a different fault from the lost byte fixed here, and one worth a pass over the crawler.
- Setting up the local Postgres for the rehearsal needs SSL: `pg.ts` connects with `ssl: { rejectUnauthorized:
  true }`, so a plain cluster answers "The server does not support SSL connections". A self-signed cert in the
  data directory plus `NODE_EXTRA_CA_CERTS` is what worked here.
- The earlier runs' calls stand: everything needing a real Stripe key is untouched, Home's three tabs are
  still `role="tab"` with nothing to control, the party picker still offers 20 on listings that state less,
  6,513 rated listings still show a star rating on their card and none on the page it opens, Arizona still
  moves on the Navajo Nation, `groupCap` still counts no players or anglers, and no workflow runs `npm test`.


## 18 September 2026, twenty-second run (05:00 to 06:10 UTC)

**Checked, and why.** Coverage had the menu, the money and a claimed shop's calendar verified, and the guest
booking box itself only through those. So this run read the booking box against the facts printed a few rows
above it on the same page, over the whole shipped catalog: the group size, and the opening hours. Not the
rehearsal to start with, because the last entry says 53 of 53 green and nothing since it touched code; it was
run at the end instead, four times, because this run did change code it covers.

**Found and fixed.** Four things, three of them on every unclaimed listing in the catalog.

- **A six seat helicopter let a guest pick twenty, and quoted them $9,074.80** (`4cc478903`). The listing page
  prints the group size the shop's own site states, "Up to 6 guests" off "Boat accommodates up to 6
  passengers", and the party stepper under it ignored that line and offered twenty. **1,217 shipped listings**
  state a ceiling under twenty; **471** are priced per person, so the same screen quoted a party the shop had
  just said it cannot take: o-airmaui-com at $453.74 a seat, o-allinonecharters-com whose own menu row reads
  "up to maximum party size of 6". Nothing catches it downstream either, because an unclaimed listing has no
  capacity for the server to check, so the picker is the only guard there is. `maxGuestsFor` reads that line
  now unless the operator set a capacity of their own, which still wins; only a stated ceiling under the
  fallback binds, and both steppers name the limit beside themselves.
- **A brewery that opens at four was taking seven in the morning requests, on 13,386 listings** (`43aaa6629`).
  An unclaimed listing has no dashboard, so its picker offered the same six fixed times every day of the year,
  whatever the shop's own website said, one screen reading "Closed today" over a row of 7 AM to 5 PM. That is
  **13,386 listings offering a time on a day they publish hours for that falls outside them** (67,083
  day-slots) and **1,014 offering all six on 1,737 days they state as closed**: o-10thstreetmotocross-com is
  shut six days a week and took requests on every one. The fixed times are now filtered by the week the shop
  publishes, in one rule (`src/lib/startTimes.ts`) read by the slot route, the booking route, the phone sheet
  and the desktop page. A day the site says nothing about keeps all six, because the page prints no hours row
  for it either. A day with hours none of the six land in falls back to the shop's own opening time on the
  same two hour grid, so 626 listings keep start times rather than losing every one.
- **The API and the listing page read a shop's hours two different ways** (`5b6f0e42c`). Found by writing the
  twin test rather than by reading: the slot route's new reader threw away a day stated as a full 24 hours
  from an opening time other than midnight, and did not know that hundreds of listings publish no hours of
  their own and carry them on their synced contact record, which the page reads through `contactFor`. So the
  API offered all six times where the page offered 4 PM to 9 PM (o-5rightsbrewing-com). A test now walks all
  59,162 shipped listings and asserts the two return the same week for every one.
- **An empty picker called next Saturday today** (`03fe90f25`). "No more start times today" is right when the
  notice has eaten the rest of today and wrong under a date five days out, which after the fix above is 1,737
  days across 1,014 listings. A stated closed day now reads "They are closed on Saturdays."

**Green after the fixes.** 355 guest tests (16 new) and 207 backend tests (6 new), both projects type-check
clean, rehearsal 53 of 53 four times, the last on the tree that is pushed.

**Needs Harshil.**

- **The other direction is yours to call.** 505 listings state a group size of twenty or more, up to "10,000
  people" on a picnic ground, and the picker still stops at twenty for them. Widening it to the 60 the API
  already accepts is a product decision, not a bug, so nothing was changed. `GUESTS_UNKNOWN` in
  `src/lib/catalog.ts` is the line.
- **An unclaimed shop open past midnight loses its tail.** A claimed shop's 10 PM to 8 AM run sells its small
  hours on the next date; an unclaimed one is read up to midnight only, because there is no dashboard to say
  which service runs then. 481 listings state a day that runs past midnight.
- **The mojibake count was wrong, and smaller.** The last entry's 17 listings are 2 in what actually ships:
  o-lastcastguiding-com ("speciesâ€”Chinook") in a service description and one more in a quote. Still worth a
  pass over the crawler, but it is not 17 pages of it.
- The earlier runs' calls stand: everything needing a real Stripe key is untouched, Home's three tabs are
  still `role="tab"` with nothing to control, 6,513 rated listings still show a star rating on their card and
  none on the page it opens, Arizona still moves on the Navajo Nation, `groupCap` still counts no players or
  anglers, and no workflow runs `npm test`.


## 18 September 2026, twenty-third run (06:00 to 07:00 UTC)

**Checked, and why.** Coverage had the menu, the money, the hours and the booking box verified, and the prose
under them almost not at all, so this run read the "Things to know" block of the guest listing on every shipped
listing: the 34,205 spec bullets, 16,781 included lines, 14,382 highlights, 13,710 requirements, 6,581
what-to-bring lines, 19,364 policy lines and 3,194 meeting points, each against the heading it is printed
under. Then the menu glossary, the one part of a tier label a guest reads that no run had opened. Not the
rehearsal to start with, because the last entry says 53 of 53 green and nothing since it touched code; it was
run at the end, once, because this run changed code it covers.

**Found and fixed.** Three, one of them on nearly five thousand listings.

- **A shop's house rules were its cancellation policy, and its cancellation policy was nowhere** (`cdf993a8a`).
  Both listing surfaces put every policy line that is not a waiver under the heading "Cancellation policy".
  **2,129 listings publish no cancellation term at all and other policies besides**, so that column read "No
  outside food, beverages or ice chests permitted" (o-22ndstreet-com) and "$20 fuel surcharge may apply" under
  a heading saying those are the terms for cancelling; **2,658 more** mixed the two. The same filter dropped
  the terms themselves: 74 listings state them only as a policy line rather than in `cancellation`, so
  o-ancloterivertours-com's "Full refund if canceled 5 days or more before sail date" never reached the page,
  which told the guest to contact the business, on the page where Otto quotes that line back at them. **1,118
  more listings** lose a second term the same way ("No show: $15 fee", "Reservations are non-refundable"), and
  a line naming both a waiver and a check-in was printed twice, once in each column. One splitter in
  `src/lib/listingDerive.ts` now sorts a shop's policy lines the way the columns read them, and the column is
  named after what is in it.
- **The desktop listing told 140 shops' guests to bring an iD** (`9c2a33f85`). The "Who can go" column prints
  the what-to-bring list as a sentence each, lowercasing the first letter to follow the word "Bring". On 170
  lines that first word is an acronym or a name: "Bring iD for age verification" (o-averybrewing-com), "Bring
  bYOB allowed with reservation" (o-agawambowl-com), "Bring uS Coast Guard approved life vest"
  (o-adventureisland-com). Otto answers the same question off the same list and has always held the first
  letter of anything that is not ordinary prose; the page reads that rule now.
- **A boxing gym's four class pack was explained as powerful whitewater rapids** (`219472ecf`). The glossary
  under a tier label matched "Class II/III/IV" with the river optional, so a bare "Class 4" counted anywhere:
  o-htdnyc-com's "Boxing Class 4-Pack" is the only shipped case, on both its tiers. A roman numeral still
  explains itself alone; a digit now needs the river beside it. The other 3,659 explanations the next sync
  would ship were read by kind and are in place.

**Clean, and worth knowing.** The fact bullets themselves are honest: over 105,000 of them, no HTML, no
entities, no lorem ipsum, no "click here", 15 lines carrying the shop's own email and 2 a URL, all of them in
context. Meeting points are honest too, including the 70 that say the place varies and when you will be told.

**Green after the fixes.** 364 guest tests (9 new) and 210 backend tests (3 new), both projects type-check
clean, rehearsal 53 of 53 on the tree that is pushed.

**Needs Harshil.**

- **The two glossary lines already shipped stay wrong until a sync.** `public/o/o-htdnyc-com.json` carries the
  rapids sentence in its `explain`, because explanations are baked in by `npm run sync`, not read at load time.
- **"Policies" is the heading a mixed column now gets.** It is the honest name for a list that holds a
  cancellation term and a house rule together, but it is a product word, not a bug fix: if you would rather it
  read "Good to know" or split into a fourth column, the line is `knowCols.push({ key: "cancel" ...`, and a
  fourth column needs `src/styles/air-listing.css`, which these runs do not touch.
- The earlier runs' calls stand: everything needing a real Stripe key is untouched, Home's three tabs are still
  `role="tab"` with nothing to control, 6,513 rated listings still show a star rating on their card and none on
  the page it opens, Arizona still moves on the Navajo Nation, `groupCap` still counts no players or anglers,
  and no workflow runs `npm test`.


## 18 September 2026, twenty-fourth run (07:10 to 08:00 UTC)

**Checked, and why.** Coverage had the listing page, the money, the hours, the booking box, the menu, the
prose and the counts a search promises all verified, and never once what kind of thing a listing is: the chip
a guest browses it by and the tab that chip sits in. So this run read the kind of every one of the 59,163
shipped listings against the business's own name. The rehearsal was run, once, at the end, because the fixes
are in `toCatalogItem`, which step 3 of it builds a listing through.

**Found and fixed.** Two, both on the browse surface rather than one listing.

- **A golf club, six breweries and four wineries were filed under Horseback riding** (`e52fdbfae`). The rules
  that read a kind out of a business name matched inside longer words. "gator" sits in purgatory, propagator
  and instigator, so a ski resort, a brewery and a sportfishing charter were swamp tours; "horse" sits in
  Horseshoe, Horseheads, Horsefly and Horseless, so a golf club, a BMX track, a car museum and four RV parks
  were horseback rides; "cruise" sits in Cruiser, so the Land Cruiser Heritage Museum and two snowmobile clubs
  sold sunset sails; "angl" sits in Anglebrook and Anglican, so a golf club, two art galleries and a church
  camp were fishing charters; "axe" sits in Axemann and Axelrod, so a brewery and a performing arts academy
  had throwing lanes. A bare "escape" is leisure branding, not a room with a lock in it, and it put a wellness
  spa, two massage studios, a craft brewery, a bowling centre, a dance studio, an electric bike hire, a
  pottery studio, three RV parks, Six Flags Great Escape and a balloon company called Grape Escape in Escape
  rooms. **171 shipped listings change kind, 160 of them filed as confirmed today**, so they rank ahead of the
  real ones in their rail. The same words judge the text a listing is confirmed by, and its own name is part
  of that text, so they are tightened there too: replayed over all 428 escape, 628 horse, 172 axe, 2,485
  fishing and 141 kart listings with their shipped detail files, that costs no listing its confirmation, and
  "Seakart Adventure", which rents small boats, stops confirming itself as a go-kart track.
- **119 parasail operators were under the Water tab and none of them under Air** (`3db5be239`). The app cuts
  its browse tabs by family and draws the chips inside them by kind, so the two have to agree, and the sync
  only moved the family when `reconcileArt` moved the kind. A listing's own name settles its kind as well, and
  that path never moved the family: **529 shipped listings are in a tab their own chip is not in**, 198
  airboat and swamp tours under Water rather than Outdoor beside the parasailing, a brewery under Food with an
  axe chip, a museum under Play with a helicopter chip.

**Clean, and worth knowing.** Every one of the 63 kinds the catalog ships has a label and an alias list in the
app, and no listing ships a kind the app's own `ArtKind` does not know. Only `snowmobile` is defined and never
used.

**Green after the fixes.** 364 guest tests and 219 backend tests (9 new), both projects type-check clean,
rehearsal 53 of 53 on the tree that is pushed.

**Needs Harshil.**

- **Both fixes are baked in at sync time.** The 171 kinds and the 529 tabs stay wrong in `public/catalog.json`
  and `public/o/*.json` until `npm run sync` runs on Render.
- **167 of the 171 land on a kind this container cannot read.** A name that names nothing now keeps the kind
  discovery filed the listing under, which is the category whose map search found the business, and that is
  why it is the right thing to fall back to. But `backend/data/outset.db` is empty here, so which kind each
  one actually lands on is unseen. Worth a look at the sync's diff on Render before it publishes.
- **18,056 listings, 31% of the catalog, draw the same generic peach gradient.** They have no cover photo and a
  kind with no scene: `src/data/art.ts` draws 13, the wave-one kinds, and nothing for the 51 kinds of waves two
  and three. Museums are 2,601 of them, golf 2,182, spas 1,861, camping 1,843, breweries 1,009. Browse hides
  them because it asks for a cover; search does not. `src/data` is outside what these runs touch.
- **Three private jet charter companies are in Fishing charters.** `inferCategory` in
  `backend/src/taxonomy/catalog.ts` reads a bare "charter" as fishing. Left alone: it only files listings
  discovery finds from now on, and all three are already marked unconfirmed.
- The earlier runs' calls stand: everything needing a real Stripe key is untouched, Home's three tabs are still
  `role="tab"` with nothing to control, 6,513 rated listings still show a star rating on their card and none on
  the page it opens, Arizona still moves on the Navajo Nation, `groupCap` still counts no players or anglers,
  and no workflow runs `npm test`.


## 18 September 2026, twenty-fifth run (08:15 to 09:20 UTC)

**Checked, and why.** Coverage had the listing page, the booking box, the menu, the money, the hours, the
prose, the reviews and the kind a listing is filed under all verified, and never once the contact block: the
number a guest taps to call the shop and the address under "Where you'll be". Both are printed on every
listing page, both are what a guest falls back on when they want a person, and neither has a single test. So
this run read the phone and the address of all 59,162 shipped listings. The type checks and both unit suites
ran at the start; the full rehearsal was skipped as a look-see, because the last entry was green and nothing
had landed since, and then run twice at the end, because these fixes are in code it covers.

**Found and fixed.** Four, all of them a guest reading a real fact of a real shop and getting a wrong one.

- **A winery told guests to call 1-800-GAMBLER, and 240 listings dialled two numbers at once** (`aab1b42ae`).
  The scrape's normaliser kept anything it could not read verbatim, and the app dialled it by stripping
  everything but digits and a plus: 170 listings publishing two or three numbers in one field opened
  `tel:+13047256399+17033092130`, 46 with an extension dialled the extension onto the end of the number, 36
  whose `tel:` link was never decoded turned `%20` into the digits 2 and 0, and 18 asked a guest to ring
  something that is not a number: an unrendered template placeholder, half a number, and o-clautiere-com, a
  winery whose published phone is the gambling helpline. **258 of the 36,698 listings with a phone.** One
  reader now, `src/lib/phone.ts`, used by the page, by Otto, by the profile a claim prefills, by the scrape
  that stores the fact and by the sync that publishes it. No number to ring means no call offered at all. A
  vanity number stays unread on purpose: a keypad would spell out "(603) 257-BOAT" and "1-800-GAMBLER" alike.
- **A glass studio in Sarasota told guests to come to Sarasota, Sarasota, FL** (`41c1eb572`). Of the 46,516
  listings that publish a street, **730 do not publish a street**: 533 repeat the town the next line already
  names, 114 are a bare house number or suite ("3615, Wharton, TX", and one museum's whole address is "420,
  OH"), 64 hold a town and a state, on most of them a different town from the city beside it ("Agawam, MA,
  Boston, MA"), and 19 carry the shop's own phone number in front of the road name or a doubled comma. Every
  one is also the text behind "Get directions". `src/lib/address.ts` is the one reader; the line falls back to
  the town and state the rest of the page already says, and the guest's confirmation email reads the same rule.
- **Forty-seven listings said "West Union, Ohio", and every reader of a state wants OH** (`dd6b0f1e0`). The
  sync builds the area line from the operator's own region, and 47 publish the state spelled out.
  `regionOfArea` answers nothing for a name, so those listings lose the clock their hours are read on, the
  currency a booking is charged in, the state row a search offers and the page it opens. Oregon, Utah, Nevada
  and Arizona are among them. A name the app knows becomes its code; anything else stays as published.
- **A Baja tour's address ended in "xico"** (`a33fb92c6`). Thirty postal fields hold something no letter could
  be addressed with: two codes joined by a semicolon, a whole street address, half a code ("Canada N0G"), and
  four where the crawl kept the tail of a word. One postcode prints now, or none.

**Green after the fixes.** 379 guest tests and 225 backend tests (22 new), both projects type-check clean,
rehearsal 53 of 53 on the tree that is pushed, run on a local Postgres with TLS and the Chromium on disk.

**Needs Harshil.**

- **The phone and address fixes reach guests without a sync; the region and postcode ones do not.** The app
  reads the shipped catalog through the new readers, so tonight's listing pages are already right. The stored
  facts stay as they are in `public/catalog.json` and `public/o/*.json` until `npm run sync` runs on Render,
  which is also when the 47 area lines and the 30 postcodes change.
- **64 listings name one town in their street and another as their city**, so we place them in the second:
  o-agawambowl-com is filed under Boston with "Agawam, MA" in its address, o-chaosrooms-com under Asheville
  with "Charlotte, NC". Dropping the street is right either way, but which town the shop is actually in is a
  supply question, not a display one.
- **8 listings publish a phone outside North America** (a London brewery, a Spanish tour operator). The ones
  with a country code still work; "02073971010" with none cannot be placed and now offers no call.
- The earlier runs' calls stand: everything needing a real Stripe key is untouched, Home's three tabs are
  still `role="tab"` with nothing to control, 6,513 rated listings show a star rating on their card and none
  on the page it opens, Arizona still moves on the Navajo Nation, `groupCap` still counts no players or
  anglers, 18,056 listings still draw the generic cover, and no workflow runs `npm test`.

## 18 September 2026, twenty-sixth run (08:20 to 09:45 UTC)

**Checked, and why.** Coverage named two things no run had read, both of them left over from the run before
it, which read the phone and the address on a shop's contact block and stopped there: the email address on
file for a claimed shop, and the hours that block carries. Both are the shop's own facts, both are printed or
acted on without a single test, and the hours turned out to be read twice over by two different parsers. The
type checks and both unit suites ran first; the full rehearsal was skipped as a look-see, because the last
entry was green and nothing had landed since, and then run at the end, because all four fixes are in code it
covers.

**Found and fixed.** Four, in the order a shop meets them.

- **A karting track that runs 7pm to 9pm was handed a dashboard opening at 7 in the morning** (`a6b7f3ac2`).
  The week a claimed shop starts on had an hour parser of its own, and on **230 of the 4,482** shops whose
  crawled hours we hold it disagreed with the reader the listing page, the "Open now" line, the booking sheet
  and Otto all share. The pm at the end of a range was never shared with its start, so "Wednesday - Friday:
  7-9:00PM" opened at 07:00 and "Monday to Friday 1-5 PM" at 01:00, on 46 shops; 163 got a day whose close
  landed at or before its open, one of them opening at 30 o'clock; the 88 publishing OpenStreetMap syntax read
  as nothing at all; and a brewery's happy hour was taken for its trading hours. The prefill also read only
  the synced contact record, so **10,508** shops whose published hours a guest could already read on their
  listing were handed an invented 9 to 5 the day they claimed. One reader now, and the claim starts on the
  week `itemWeek` gives the page.
- **A pilates studio published five days of hours and the app read one** (`869614f79`). Both readers of
  OpenStreetMap's syntax, the app's and the sync's twin, split a week on the semicolon alone. A rule is also
  separated by "||" and by a comma once the rule before it has stated its hours. Five of the 112 listings that
  publish this way lost days: one day out of five at the pilates studio, no Sunday at a gallery, no weekend at
  a barre studio, on the cards, the pages, the booking sheet and in Otto alike.
- **A gallery told guests its hours were `Fr,Sa 12:00-19:00; Su off; PH off`** (`681574abe`). The Hours block
  printed whatever the crawl stored. Of the **14,812** listings that show one, 126 printed that syntax, 226
  the quote marks around "by appointment", 361 the punctuation swept up in front of the hours (") (6am-4pm",
  "& Location 8am-8pm", a calendar emoji), 29 a zero-width space, one of them inside "Monday to Friday", and
  21 ran a day onto the end of the time before it: "Sun - Thur: 11am - 11pmFri - Sat: 11am - 1am". The "Plan
  your visit" box on a walk-in listing printed the contact record with no tidying at all and never the
  listing's own hours. `src/lib/hoursText.ts` is the one reader for all three surfaces. Shouted hours stay
  shouted: a shop that shouts is still stating its hours.
- **A charter captain's own claim link was addressed to i...@********ng.com** (`036007020`). The address on
  file is how an owner proves a listing is theirs. Of the **14,746** listings that carry one, 96 carry
  something nobody could write to: 32 still percent-encoded because the site hid them from scrapers, 42 a site
  template's own inbox ("info@mysite.com"), the rest markup, an IP address, a masked name, a zero-width space
  or a trailing dot. For **12** of them the address we hold is at free mail, so the domain rule cannot vouch
  for the owner either and they cannot claim at all. `src/lib/email.ts` decodes the hidden ones and refuses
  the rest, and the crawl, the sync, the claim index and the dashboard prefill read it the same way.

**Green after the fixes.** 400 guest tests and 226 backend tests (22 new), both projects type-check clean,
rehearsal 53 of 53 on the tree that is pushed, run on a local Postgres with TLS and the Chromium on disk.

**Needs Harshil.**

- **The hours fixes reach guests without a sync; the email one mostly does not.** The app reads the shipped
  catalog through the new readers, so tonight's listing pages and any claim made tonight are already right.
  The stored facts change when `npm run sync` next runs on Render, and that is also when the 96 broken
  addresses leave `claim-index.json` and the 42 template inboxes stop being hashed. Until then those owners
  still meet the old hint on the claim screen.
- **6 listings publish hours in a dialect no reader speaks**: nth-weekday and month rules, "Su[2] 13:00-15:30;
  Jan off; Feb off" and "May Mo[-1] - Oct Mo[2]". They print as written, which is honest and ugly. Whether a
  seasonal or nth-weekday rule is worth reading out is a product call.
- **12 operators cannot claim their own listing until the next sync** (o-majesticmountainmarina-com,
  o-lostcoastsportfishing-com, o-fishinnaples-com and nine more): the address on file is at gmail, msn or aol
  and is stored wrong, so neither the hash nor the domain rule can let them in. If one of them writes in
  before the sync, the test bypass is the way through.
- The earlier runs' calls stand: everything needing a real Stripe key is untouched, Home's three tabs are
  still `role="tab"` with nothing to control, 6,513 rated listings show a rating on their card and none on the
  page it opens, Arizona still moves on the Navajo Nation, `groupCap` still counts no players or anglers,
  18,056 listings still draw the generic cover, and no workflow runs `npm test`.

## 18 September 2026, twenty-seventh run (10:00 to 11:10 UTC)

**Checked, and why.** Coverage's two lists between them name every guest and dashboard surface this run was
pointed at, so the hunt went somewhere no run has been: the word "unsubscribe" does not appear once in the
previous 1,898 lines of this log, and nor does "outreach". That is the one path in this product that writes
to a real business owner who never asked to hear from us, which makes it the only place where a bug is a
legal problem as well as an embarrassing one. Type checks and both unit suites first; the rehearsal was
skipped as a look-see (last entry green, nothing landed since) and run at the end, because all three fixes
are in `backend/src`.

**Found and fixed.** Three, in the order an operator meets them.

- **Outreach would mail everyone who had unsubscribed, whenever the list could not be read** (`b2f7155a3`).
  The suppression list is the only thing between an operator who asked us to stop and another email. It
  lives in Postgres, written by the unsubscribe route and by the Resend webhook that records hard bounces and
  spam complaints. `loadUnsubHashes` fetched it from the API and, on any failure, carried on with "the local
  file" - which is only what that machine itself recorded, and the machine that sends is not the machine that
  serves the unsubscribe route, so on the Mac it holds nothing. An API asleep, a timeout, a 503, and the send
  read an empty list and mailed every opt-out, every dead address and everyone who had reported us as spam.
  The list now says where it came from and a send that could read neither Postgres nor the API refuses.
  `GET /mail/unsubscribed` answers 503 rather than 200 with a partial list. Two more dead-link checks joined
  the same gate: without `CLAIM_SECRET` this machine signs with one of its own, so every claim link and every
  unsubscribe link in the mailing is unverifiable by the API, and `unsubPageUrl` reads `SITE_URL` while the
  rest of the mail hardcodes onoutset.com, so a laptop left set for local testing puts
  `http://localhost:5173/unsubscribe.html` in a commercial email.
- **A claim email was addressed to `%73ere%6eew%61%74%65rsp%6frts@gmail.com`** (`7be39e57e`). Last night's run
  gave the crawled address one reader, `src/lib/email.ts`, and wired it into the claim index, the dashboard
  prefill and the sync. It missed the one place that puts an address in a To line. The draft generator kept
  its own regex, which cannot tell an address from the way a site hid it from scrapers, so the 32
  percent-encoded ones were mailed as written, a guaranteed hard bounce against our own sending domain, while
  the decoded address sat there deliverable. An address the crawl kept a full stop on was dropped instead, so
  that operator hears from us never.
- **44,312 shops with no opening hours were emailed "It has your hours"** (`0cdf6ab2d`). The claim email lists
  what we built on the operator's page and puts the link to that page on the next line, under the sentence "I
  didn't make anything up". Photos and the cancellation policy were read from the operator's facts; "your
  hours" was pasted in for everyone, and **44,312 of the 59,162** listings we ship publish none. **18,096**
  have no hours, no photo and no price, and were told "It has what you sell and your hours", two claims and
  both false. The facts are read before they are claimed now, hours through the sync's own `tidyHours` so the
  mail and the Hours block agree; a genuinely thin page is described as thin, which is the pitch anyway. Three
  more in the same file: the draft and the copy written at send time counted services and policies differently
  (the draft called every service one "with prices" and a house rule a cancellation policy), and
  `publishedCount` parsed the 23 MB `catalog.json` once per draft inside a loop over every unclaimed operator.

**Green after the fixes.** 249 backend tests (23 new), both projects type-check clean, rehearsal 53 of 53 on
the tree that is pushed, on a local Postgres with TLS and the Chromium on disk.

**Needs Harshil.**

- **`npm run outreach-send` will now refuse on your Mac until `CLAIM_SECRET` is set there** to the value on
  outset-api, and `MAIL_POSTAL`, `MAIL_FROM` and `SITE_URL` with it. `--dry` prints the same list and runs. If
  any outreach has already gone out from a machine without that secret, the claim links and the unsubscribe
  links in those emails are dead, and the owners who clicked either were told the link was not valid.
- **An unsubscribe token is signed with `CLAIM_SECRET`, so rotating it kills every unsubscribe link already in
  an inbox.** Claim links dying on a rotation is the point of them; opt-out links dying is a compliance
  problem. A separate `MAIL_SECRET`, or accepting the previous secret for a while, is the fix, and it is your
  call because it is a new variable on Render.
- **`GET /mail/unsubscribed` is public**: anyone can download the opt-out list as hashes and test whether a
  known address is on it. Gating it behind `ADMIN_KEY` means the sending machine needs that key, and with the
  new guard a missing key stops the send rather than quietly widening it, which is safe but is a workflow
  change. Left open deliberately.
- The outreach email's "If I've got the wrong business, this takes the page down" opens a `mailto:` to you,
  not a takedown; the panel it lands on says one business day. Honest on the page, oversold in the mail.
- The earlier runs' calls stand: everything needing a real Stripe key is untouched, Home's three tabs are
  still `role="tab"` with nothing to control, 6,513 rated listings show a rating on their card and none on the
  page it opens, Arizona still moves on the Navajo Nation, `groupCap` still counts no players or anglers,
  18,056 listings still draw the generic cover, and no workflow runs `npm test`.

## 18 September 2026, twenty-eighth run (11:20 to 12:45 UTC)

**Checked.** The 1,481 static landing pages under `public/p` and the generator behind them,
`backend/src/sync/pages.ts`, which no earlier run has opened: they are not in the Coverage list at all and
they are the first thing a guest meets when Google sends them here, before the app has loaded. Read the
generator, then swept all 1,481 shipped pages and regenerated the whole set from the shipped catalog to check
the fixes, plus the six worst pages at 400px in the Chromium on disk.

**Skipped the rehearsal on purpose.** The twenty-seventh entry records it green at 53 of 53, and the only
commit since is that entry itself, so nothing it covers has moved. Type checks and `npm test` instead, and
the hour went on the pages. Worth repeating from an earlier run: `npx tsc --noEmit -p .` at the root checks
nothing at all, because the root `tsconfig.json` is `"files": []` plus two references. `-p tsconfig.app.json`
is the one that checks the app, and it is clean.

**Found and fixed.**

- **2,787 cards on those pages were a grey square, a name and "Price on request"** (`1d9abcf74`). The catalog
  marks a listing `thin` when there is nothing on it a guest can act on, and 17,155 of the 59,163 shipped
  listings are thin. Browse and the rails leave them out on purpose. The pages took every listing, so thin
  ones filled 866 of the 1,481 pages, and on six of them (surf in Key West, spas in Lake Tahoe, four more)
  every single card was empty. Every number on every page counted them too: the lede, "Outset lists 35 escape
  rooms around Tampa Bay", the city pills, the index and the JSON-LD `numberOfItems`. 144 metro pages existed
  only because empty listings pushed them over the three-listing bar.
- **"Escape rooms in Tampa Bay, Florida" opened on Anna Maria Beach Resort™, Anna Maria Island Inn ™ and AMI
  Locals** (`e29b0ad60`). 1,624 listings carry `kindUnconfirmed`, meaning nothing in the listing's own text
  confirms its kind and it was guessed off the business name. The rails already put every one of them last.
  The pages published the guess as a fact, to a search engine, in an h1, a meta description, a count and a
  schema.org ItemList, under the business's own trademark. 239 pages held one; 17 existed only because of
  them, paintball in Tampa Bay among them with five listings and one paintball field.
- **387 photos were a grey square because the shop serves them over http** (`8bfca4d99`). The pages hotlinked
  the operator's own image. 1,087 of the 39,044 covers we hold are `http://` addresses, because that is what
  the operator's site serves, and these pages are https: the browser refuses the image, `onerror` takes the
  tag out, and the card loses its photo. 306 of the 1,481 pages had at least one, and the listings it hit are
  the ones that have a photo, so it cost the pages their best cards. They go through the same wsrv.nl proxy
  the app's cards use now, with a 1x and a 2x candidate, which also stops a page pulling 24 multi-megabyte
  originals to fill 250 px tiles.
- **A skydive centre's only photo was the bot check its own site served our crawler** (`0d9f8969e`). Ten
  listings have a CAPTCHA as their cover and eleven more carry one in the gallery: a site running BotDetect
  answers a crawler with a challenge image, whose address ends in no file name for any name filter to catch
  while `get=image` in its query satisfied the gate that asks whether an address looks like a picture. The
  address is bound to the crawler's IP and a timestamp, so it answers nothing for a guest either.
- **"Outset lists 1 cooking classe"** (`d87ca70a5`), found by the test written for the one above. The FAQ made
  its singular by stripping a trailing s, and the title tag and lede did not try at all ("1 cooking classes").
  Latent today, since the smallest kind in the catalog has 9 listings, and the FAQ text is what a search
  engine quotes as an answer.

**Green after the fixes.** 254 backend tests (5 new), both projects type-check clean. The regenerated page set
is 1,320 pages: 0 images over http (15,042 of 15,044 proxied, the two gifs left alone by design), 0 thin
cards, 0 guessed-kind cards, 0 dangling links, all 60,237 pill counts agreeing with the page they link to,
every page carrying at least one photo, and no sideways scroll at 400px.

**Needs Harshil.**

- **The pages shipped in `public/p` still have all of this until a sync runs.** They are generated output, and
  regenerating 1,481 committed files overnight without you is not a call I wanted to make, so the fixes are in
  the generator and the shipped HTML is unchanged. `npm run sync` publishes them, and also clears the ten
  CAPTCHA covers, which only go at sync time.
- **That sync will delete 160 pages**, 1,480 to 1,320: 144 built on listings browse already refuses to show
  and 17 built on guessed kinds, verified with `npx tsx scripts/landing-pages-dry.mts`. Every kind keeps its
  all-metros page. If you would rather keep the indexed surface and fix the counts instead, the filter is one
  line in `writeLandingPages` and this is the run to say so.
- The earlier runs' calls stand: everything needing a real Stripe key is untouched, Home's three tabs are
  still `role="tab"` with nothing to control, 6,513 rated listings show a rating on their card and none on the
  page it opens, Arizona still moves on the Navajo Nation, `groupCap` still counts no players or anglers,
  18,056 listings still draw the generic cover, and no workflow runs `npm test`.

## 19 September 2026, twenty-ninth run (04:30 to 06:00 UTC)

**Checked, and why.** Thirty-five commits landed after the twenty-eighth entry was written, touching
`backend/src`, `src/` and the scripts, so nothing in Coverage could be taken on trust and the rehearsal was
owed a run rather than a skip. That code is also the least examined in the repo: written in the last twelve
hours, by other runs, and never bug-bashed. So this run went at the guest and operator paths that changed
last night, rather than at a fresh line on Coverage's list: the first-load location guess
(`src/lib/here.ts`, `GET /where`), the publish gate and the duplicate rules in `backend/src/sync/contacts.ts`,
the new `/admin` metrics gate, and search-by-name in the phone sheet. Also finished the one Coverage item
that was cheap to close properly: the guide copy in `src/data/guides.ts` against the kind it is printed on.

**Ran the rehearsal, twice.** Type checks and `npm test` first, then the full `e2e-local.mts` against a local
Postgres with the Chromium on disk, once to establish the baseline and once on the finished tree. Both green
at 53 of 53. Two notes for whoever sets this up next: the container has no cluster, so one has to be
initdb'd as the `postgres` user and given a self-signed cert, because `src/db/pg.ts` requires TLS
unconditionally; and `npx tsc --noEmit -p .` at the root still checks nothing, `-p tsconfig.app.json` is the
one that checks the app.

**Found and fixed.**

- **The supply project had stopped type-checking** (`861963d99`). `assert.equal` in `@types/node` 22 carries an
  `asserts actual is T` signature, so comparing `perClaim` against `null` narrowed it to `null` and the
  `as number` cast on the next line became a cast from `null`. Red on `main` since the `/admin` page landed
  at 18:30, which is after the last entry was written and reported both projects clean.
- **A guest in Manitoba opened an empty home page headed "winnipeg"** (`e6f6559c6`). The new first-paint guess
  maps the browser's time zone to a metro, and `America/Winnipeg` was mapped to `"winnipeg"`, which is not one
  of the 47. Nothing downstream checks: the home filters every rail on `u.metroId === state.metroId`, so not
  one listing matched, and `metroLabel` and `metroShort` print an unknown id exactly as typed, so the Where
  pill and the heading read in lower case. Manitoba has no metro and the nearest that does is 700 km away,
  past the 240 km a guess may reach, so the zone answers nothing now and the home opens on Anywhere. The
  lookup validates its own answer, so the next typo cannot ship the same way.
- **`GET /where` was publicly cacheable** (`65c25349e`). It answers with the city Cloudflare resolved the
  request from, and it is the one route that overrides the API's blanket `no-store`. It did so with
  `public, max-age=600` and no `Vary`: a body read off the caller's IP, offered to Cloudflare and every proxy
  between it and the guest as a document they may hand to somebody else. `private` now.
- **A shop that claimed its listing could lose its page** (`53e01043d`, `0d9df3c5d`, `00862406c`). Three
  separate routes to the same outcome, all of them the same mistake: a rule reading only the crawl, deciding
  the fate of the one kind of listing with a person behind it, before that person's edits are merged in.
  (1) Last night's publish gate asks whether a crawler has ever read a photo, a service or an hours line off
  the business's own site, and drops 12,332 listings on its first run. Correct for a lead; wrong for an
  operator who claimed their listing and typed all of that in by hand, who would have watched their page
  disappear on the next sync. The same went for a shop whose scraped name was its page title, or whose pin was
  wrong. (2) When the sync decides two rows are one business it kept the one with the canonical host, then
  more reviews, then the shorter domain, so a claimed shop could lose to an unclaimed copy of itself; and a
  claimed map pin was dropped outright whenever a scraped row carried the same name in the same metro. In
  every case the claim, the session, the dashboard and the claim email all point at the id that was dropped,
  so the operator's dashboard kept working while the page it edits was off the site. (3) `POST /contacts/sync`
  ran the whole catalog sync without calling `loadProfileOverlays` first, so the catalog it published reverted
  every claimed shop to whatever a crawler last saw. All three fixed, with the two decisions pulled out as
  named functions a test can drive with no database.
- **The guide copy checked out, and a rename would have broken it silently** (`d6bcba369`). All 14 guides
  match the kind they are printed on and none is orphaned; nothing but an art string joins the two. Two tests
  hold it, plus the is/are in the heading across all 64 kinds.

**Green after the fixes.** 303 backend tests (13 new) and 406 app tests (4 new), both projects type-check
clean, rehearsal 53 of 53.

**Needs Harshil.**

- **50 of the 64 kinds have no guide at all**, so most landing pages and most listing pages print no "what it
  is actually like" section. The 14 that exist are the original water and air activities; everything crawled
  since (museums, golf, bowling, spas, climbing, breweries, classes) has none. That is a content job, not a
  bug fix, and writing 50 blocks of activity prose overnight without you is not a call I wanted to make.
- **The publish gate still drops 12,332 listings on its first run.** That was a deliberate decision last
  night and this run only carved out the claimed ones. Worth confirming you still want it before the next
  sync, since it is the largest single change to what the site shows.
- The earlier runs' calls stand, unchanged: the `public/p` pages still ship last night's content until a sync
  runs and that sync deletes 160 of them; anything needing a real Stripe key is untouched; Home's three tabs
  are still `role="tab"` with nothing to control; 6,513 rated listings show a rating on their card and none on
  the page it opens; `groupCap` still counts no players or anglers; 18,056 listings still draw the generic
  cover; and no workflow runs `npm test`.

## 19 September 2026, thirtieth run (06:00 to 07:20 UTC)

**Checked, and why.** No commits landed after the twenty-ninth entry, which reported both projects clean and
the rehearsal green, so the rehearsal was skipped at the start and the hour went on new ground instead. Type
checks and `npm test` were run first and were green. The area picked was the one surface Coverage names on
every line except its own: a listing's photographs. Every rule about what a guest reads has been swept over
the whole catalog, and nothing had ever been swept over what a guest looks at. So: `src/lib/media.ts`, the
hero and the lightbox on both surfaces, and the screens behind a published image, over all 59,125 shipped
listings and their 244,058 photos.

**Found and fixed.** Three, all of them in front of every guest who opens a listing.

- **A guest saw the same photograph three times** (`029b8922a`). `listingMedia` dropped a repeat only when two
  entries were the same string, and the crawl keeps every spelling it saw: one photograph linked under both
  schemes, with and without `www.`, and at whatever widths its resizing CDN was asked for. 832 listings showed
  one picture between two and eight times, 657 of them inside the five tiles of the hero, so a museum opened on
  the same doorway twice and "Show all photos" promised nine and gave four. It folds on the file a URL reaches
  now, with the query set aside only once the path already names the image: `/_next/image?url=` and
  `/ImageRepository/Path?filePath=` carry the picture in the query, and folding it away there would collapse a
  whole gallery into one tile.
- **A golf club led its listing with a tracking pixel** (`762e3f94f`). The clip goes in front of every photo,
  in the biggest tile, under a "Video" badge, and it was the one image on a listing no screen ever looked at:
  photos pass `cleanImageUrl`, `isPhotoName`, the photo screen's verdicts and `fullSize`, the video fact passed
  none of them. 1,062 listings led with whatever the crawl found, among them a WordPress.com beacon whose own
  query reads `c=site-not-found`, four CleanTalk spam-filter receipts, a PayPal Buy Now button, a Facebook
  login button, a TripAdvisor badge, a Google Maps close icon, a scorecard, a course map and eleven spacer
  GIFs. Two holes: the sync published the fact unscreened, and the crawl took any GIF whose markup declared no
  size, because `dims()` answers 0 for an absent attribute and a test written against a declared size passes
  everything that declares none, which is every beacon ever written. `publishableImage` now knows what a beacon
  looks like as one rule rather than the `bat.bing.com` it had collected by hand. Over the shipped catalog this
  drops 70 videos, no real video file, and 5 photos, all 5 of them gambling spam.
- **Half the photos in the desktop lightbox were never checked** (`e177c3017`), though the comment beside the
  probe said they were. The hero probes its photos at thumbnail size so a dead URL or a 40 px logo never claims
  a tile; the desktop probed the first five, which is all the hero renders, and the effect for the rest was
  never written. The lightbox shows every photo, so on 20,987 listings the 52,016 slides past the fifth reached
  a guest unexamined. The phone sheet has always probed all twelve, so the two surfaces disagreed about how
  many photos the same listing has.

**Ran the rehearsal after the fixes**, because all three touch code it covers: 53 of 53, against a local
Postgres and the Chromium on disk. 418 app tests (12 new) and 311 backend tests (8 new), both projects
type-check clean.

**Needs Harshil.**

- **215 GIFs still lead a hero.** The screens cleared the beacons and the spacers; what is left is site
  furniture with a plausible name: a language flag, `icon-search.gif` on nine Joomla golf sites, a CMS
  thumbnail endpoint (`getImage.gif?ID=101601`). The obvious rule, treating an `icon` or `badge` in the path as
  furniture, was measured and rejected: it takes six genuine Nova Scotia park photographs served through a
  Drupal image style called `feature_icon`. Worth deciding whether a GIF should stand in for a video at all,
  which is a product call, not a fix.
- **The photo fixes reach guests tonight; the video fix waits for a sync.** `media.ts` is read at load time, so
  the 832 galleries are right on the next deploy. The 70 videos are stored facts and only clear when
  `npm run sync` next writes the catalog.
- The earlier runs' calls stand, unchanged: 50 of 64 kinds still have no guide; the publish gate still drops
  12,332 listings on its first run; anything needing a real Stripe key is untouched; Home's three tabs are
  still `role="tab"` with nothing to control; 6,513 rated listings show a rating on their card and none on the
  page it opens; `groupCap` still counts no players or anglers; 18,056 listings still draw the generic cover;
  and no workflow runs `npm test`.

## 19 September 2026, thirty-first run (07:00 to 08:20 UTC)

**Checked, and why.** No commits landed after the thirtieth entry, which reported both projects clean and the
rehearsal green, so the rehearsal was skipped at the start and the hour went on new ground. Type checks and
both test suites were run first and were green (418 app, 311 backend). Coverage named one thing under
accessibility it had never driven: the photo lightbox's keyboard, a `role="dialog"` with no focus trap. Pulling
on it showed the gap was not one dialog but every dialog the desktop site has, so that is the area: all five of
them driven in a real Chromium, by Tab, by Escape and by the wheel, and then the one other thing in the app
that claims `aria-modal` without the page behind it being inert.

**Found and fixed.** One fault, in six places, in front of every guest who opens a photo.

- **Every dialog says `aria-modal="true"` and none of them behaved like one** (`510cf17a5`). `aria-modal` is a
  promise that the page behind is not there. Tab walked out of all five into the page under the scrim. On the
  listing's "Show more" the *first* Tab did, because its Close button is the last thing in the document, so one
  press landed on "Back to results" at the top of a page the guest could not see; Compare gave 8 of 12 stops to
  the feed behind it. A wheel over the full-screen lightbox rolled the listing 1,600 px underneath, so closing
  the photos left the guest somewhere else entirely: the lightbox and the modal locked `document.body`, and
  `app.css` clips `html`'s overflow-x, which makes `html` the scroller and `body { overflow: hidden }` worth
  nothing. That was written down for the card form in an earlier run and never told to anything else; Compare,
  Filters and Where, when and who never tried to lock anything at all. The lightbox also never moved focus into
  itself, so a guest who pressed "Show all photos" was still standing on the button behind the scrim, and it
  did not even say `aria-modal`. One hook (`useModal`) now carries focus in and back, the Tab ring and the page
  lock, and the five call sites use it. Focus only moves when it is not already inside, so the Where box keeps
  its own field; stops are measured by their rects, because `offsetParent` is null for everything inside a
  fixed scrim.
- **The operator's booking drawer had the same hole** (`be72c76bc`). Tab out of a booking's detail and the
  operator was somewhere in the list behind it, and closing the drawer dropped focus at the top of the document
  rather than on the card it was opened from. Same hook, one line.

**Ran the rehearsal after the fixes**, because both touch code it covers: 53 of 53, against a local Postgres
and the Chromium on disk. 432 app tests (14 new) and 311 backend tests, both projects type-check clean.

**Needs Harshil.**

- **The phone sheets are the one dialog family left, and they are fine for a different reason.** `App.tsx` and
  the tab bar go `inert` while a sheet is up, which takes the page behind out of the tab order outright. That is
  the better answer and it cannot be used on the desktop, where the dialogs live inside the tree they would have
  to inert. Worth knowing the two surfaces solve this differently on purpose.
- The earlier runs' calls stand, unchanged: 215 GIFs still lead a hero and the 70 cleared videos wait for a
  sync; 50 of 64 kinds have no guide; anything needing a real Stripe key is untouched; Home's three tabs are
  still `role="tab"` with nothing to control; 6,513 rated listings show a rating on their card and none on the
  page it opens; and no workflow runs `npm test`.

## 19 September 2026, thirty-second run (08:00 to 08:40 UTC)

**Checked, and why.** Nothing landed after the thirty-first entry, so the rehearsal was skipped at the start.
Type checks and both suites were run first and were green (432 app, 311 backend). Coverage names Otto's answers
on a dozen particular facts, but never the gate that decides whether Otto should answer at all, and
`AGENTS.md` makes that a hard product rule: the company assistant answers only from published facts, refuses
weather, directions, comparisons, reviews and other businesses, and never confirms a booking. 1,294 lines, two
gates, no test on either. That is the area: both gates driven with a battery of real guest questions over 400
shipped listings, in scope and out, then every answer diffed against the old ones so nothing else moved.

**Found and fixed.** The gate was wrong in both directions.

- **Otto refused the commonest booking question there is** (`4cc5d8321`). The out-of-scope reader looks for
  words that belong to somebody else's business, and several of them are also how a guest asks this shop an
  ordinary question. "How far in advance do I need to book" is a notice period, not a distance. "The nearest
  opening" is the next departure. "Rated" and "news" carried no word boundaries, so they matched inside
  "operated" and "newsletter". Every one came back as "I only know what they publish, so I can't help with
  that", on all 400 listings. The gate also ran twice over two different exemption lists, so a pet question
  carrying a place word was let through by the first and refused by the second. Both read one list now.
- **A guest asking Otto to cancel was told "Yes"** (`7498a2c5c`). Any question carrying the word "booking"
  matched the `book` intent, and `book` was read before `cancel`, so "how do I cancel my booking", "I need to
  cancel my reservation" and "can I get a refund on my booking" were all answered "Yes. Pick a service and time
  on this page and they confirm it". The shop's own published refund policy was sitting right there, and Otto
  gave it happily to anyone who asked without saying "booking". The same "Yes." answered **"is my booking
  confirmed?"** and "did my reservation go through?", which is the one answer rule 4 says it must never give:
  Otto cannot see a booking, these listings are request to book, and the shop confirms.
- **A shop's FAQ answer was printed with the page's "A." still on the front** (`5908db044`). Pulling on the
  FAQ fallback inside the refusal branch turned this up: 65 listings ship an FAQ, 73 entries between them, and
  two kept the label the Q&A page set the answer under. Four surfaces print them and all four printed it, the
  dashboard an operator edits after claiming included. One reader now, and the mark after the letter is what
  makes it a label, so "A life jacket is provided" is left be. The other 71 entries were swept for markup,
  entities and empty sides and are clean; the sweep is a test.

**Ran the rehearsal after the fixes**, because one of them touches the listing page and the `knowFrom` prefill
it covers: 53 of 53, against a local Postgres and the Chromium on disk. 445 app tests (13 new) and 311 backend
tests, both projects type-check clean.

**Needs Harshil.**

- **Only 65 of 59,125 listings ship an FAQ at all.** Otto's best answers come from one, and the operator's
  dashboard starts from one. That is a supply question, not a bug, but it is a big gap in what Otto can say.
- **Two small scope calls were left alone on purpose.** "Is there a hotel nearby?" is refused, but "where's the
  nearest hotel?" is answered with this shop's own meeting point, because the meeting-point reader matches
  "where"; the answer is about this shop and invents nothing, so it was left. "Can I sign up for your
  newsletter?" still reads as a booking question, because `book` matches "sign up".
- The earlier runs' calls stand, unchanged: 215 GIFs still lead a hero and the 70 cleared videos wait for a
  sync; 50 of 64 kinds have no guide; anything needing a real Stripe key is untouched; Home's three tabs are
  still `role="tab"` with nothing to control; 6,513 rated listings show a rating on their card and none on the
  page it opens; and no workflow runs `npm test`.

## 19 September 2026, thirty-third run (09:00 to 10:00 UTC)

**Checked, and why.** Nothing landed after the thirty-second entry, so the rehearsal was skipped at the start.
Type checks and both suites were run first and were green (445 app, 311 backend). Then the one feature on the
guest listing page that no run has ever opened: **live departures read from the operator's own booking system**
(`backend/src/enrich/availability.ts`, `GET /availability/:id`, and the three surfaces that draw it). Coverage
names every other part of the booking box, and the word FareHarbor does not appear in this log once, though
1,664 shipped listings carry a booking link we can read. It had no test of its own. So: every vendor path
driven with hand written payloads shaped the way each vendor answers, and every booking link in
`public/live-index.json` put through the resolvers.

**Found and fixed.**

- **Two boats leaving at nine were drawn as two chips with one key, and picking either lit both** (`824b62246`).
  A FareHarbor company calendar is every trip that company sells, so a shop running two boats at nine answers
  with two departures on the same start time. Both pickers drew a chip each, keyed on the time they share:
  React saw one key twice, the phone drew "9:00 AM" twice in a row, and a pick is a time and nothing else, so
  clicking one showed both as chosen. The phone read the seats and the price off whichever chip it found
  first, which is how a 40 seat boat came to read "2 left". One chip per start time now, built once in
  `src/lib/liveTimes.ts` instead of a copy of the same twelve lines in each picker: the clock alone when two
  trips leave then, the lowest of their prices, and a seat count only when every departure at that time states
  one. The same change ends three other small disagreements between the two pickers: four seats was "few" on
  the phone and not on the desktop, the phone's day dot counted departures that had already gone, and the wall
  clock was read by parsing a zoneless time into a Date and asking the browser for the hours back.
- **Otto read out a Peek date it had no times for as a departure called "Sunset Cruise"** (`07bac87a8`). Peek
  costs one call for which dates are open and one more per date for that date's times, and the budget stops
  after three, so most open dates in a ten day window come back with no times at all. A marker row stood in
  for them carrying a midnight that means nothing, and nothing downstream knew that: the phone printed
  "12:00 AM", and a guest could book it. The marker says `timeUnknown` now, Otto skips it, and no picker
  offers it. A shop that genuinely leaves at midnight keeps its midnight, which is the only thing that now
  looks like one.
- **45 of the 54 Xola shops showed our guessed times, because a button embed is not a seller** (`502f65b42`).
  `xolaSeller` hands a button embed back as `button:<id>` to say so, and the availability reader sent that
  string to the experience feed as a seller id. Every one of those 45 answered "experience feed unavailable"
  and fell back to a generic nine, eleven and one for a shop whose own calendar we could have read. It now
  resolves the button to its seller, which `readXola` has always done, kept for an hour so the call budget is
  where it was.

**Swept and clean.** All 1,664 booking links in `live-index.json` through `fareharborShortname`, `peekRef` and
`xolaSeller`: 1,354 distinct FareHarbor shortnames, 237 Peek programs, 54 Xola sellers, none malformed. Six
rows publish a bare `https://fareharbor.com/` that names no company; they answer dead, which is right.

**Ran the rehearsal after the fixes**, because they touch the listing page and the phone booking sheet it
drives: 53 of 53, against a local Postgres and the Chromium on disk. 454 app tests (9 new) and 316 backend
tests (5 new), both projects type-check clean.

**Needs Harshil.**

- **A Peek shop now offers two bookable dates where it used to offer eight, six of them fake.** Not lying is
  the right trade, but the honest fix is to ask for the picked date's times: a single date request spends the
  whole budget on that date, which the reader was built for and nothing ever wired up. Three ways to do it,
  and picking one is your call, because it is a politeness budget and not a bug: widen `MAX_CALLS` for Peek
  alone; have the picker ask for a date it has no times for, which needs the day to stay pickable and so
  needs plumbing through both calendars; or accept fewer bookable dates. 239 listings sit on Peek.
- Nothing was checked against a live vendor. These are someone else's servers and the tests answer from
  payloads shaped by hand, so a vendor that has quietly changed its JSON would still read as a shop with
  nothing open, and we would not know.
- The earlier runs' calls stand, unchanged: 65 of 59,125 listings ship an FAQ; 215 GIFs still lead a hero and
  the 70 cleared videos wait for a sync; 50 of 64 kinds have no guide; anything needing a real Stripe key is
  untouched; Home's three tabs are still `role="tab"` with nothing to control; and no workflow runs `npm test`.

## 19 September 2026, thirty-fourth run (10:00 to 11:30 UTC)

**Checked, and why.** Nothing landed after the thirty-third entry, whose rehearsal it records as green, so
the rehearsal was skipped at the start. Type checks and both suites were run first and were green (454 app,
316 backend). The area picked was the one guest-facing module with no test of its own and no mention anywhere
in this log: `backend/src/sync/plainServices.ts`, 481 lines that rewrite every service name and price tier
label a guest reads. Then, because that came back clean, the surface those labels sit on: the desktop home's
search pill, which Coverage names only as a set of dialogs whose focus was checked.

**Found and fixed.**

- **A guest who said six guests on the home page was quoted for two on every listing they opened**
  (`5af40ef2f`). The desktop home's Who stepper was a label and nothing else: `guests` was read once, to
  write the words on its own chip, and never again. The date beside it carried into the booking box all
  along through app state, and the phone sheet has carried both since it was built, so the gap was invisible
  from either side. The pick now goes where the phone already keeps it, so both booking boxes read one rule
  for it and the shop's own ceiling still wins: a party of six on a jet ski that holds two opens on two.
  Driven in a real Chromium: pick six, open a listing, the box now opens on six where it read two.
- **Two buttons on one page promised different numbers of places, and the bigger one was wrong**
  (`baec16b56`). The Where, when and who modal's foot counted `base`, the pool the filters count from, which
  is the list before the price range is applied. Driven in a browser with a maximum set: Filters said "Show
  90 places", Where, when and who said "Show 828", and the grid behind both drew 90. It now counts the list
  the page will actually draw. With no range set the number is what it always was.
- **The metrics page joined a sentence with an em dash** (`69580572d`), which `AGENTS.md` forbids. Otto's
  answers have been held to that rule since the assistant tests were written; nothing held the screens to it.
  A sweep over every source file the app ships now does, with regular expressions exempt.
- **Three new tests read their sources from the shell's directory** (`02d25e26e`), so `npm test` at the root
  passed and the rehearsal failed on the same files: it runs the guest tests from `backend/`. Mine now read
  from `import.meta.url`, the way the rest of the suite always has.

**Swept and clean.** Every raw service name and detail line the crawl holds (51,452 names and 14,716 detail
lines in `backend/data/structure`) through `plainName` and `plainLabel`, checked for a number the operator
never wrote, a word the module invented, a doubled space, "1 hours" and unbalanced brackets: nothing but six
labels whose brackets were already unbalanced in the shop's own text. Both booking boxes' start-time pickers
were read against each other after last night's `liveTimes.ts` refactor, and they agree.

**Ran the rehearsal after the fixes**, because they touch the guest listing page, the booking flow and the
home: 53 of 53, against a local Postgres with SSL on and the Chromium on disk. 462 app tests (8 new) and 316
backend tests, both projects type-check clean.

**Needs Harshil.**

- **The desktop Who now offers up to 22 people (12 adults, 10 children) and the phone's picker stops at 8.**
  A party of 15 picked on the desktop shows as 15 on the phone sheet with its "+" disabled, which is honest
  but odd. One number for the largest party either surface offers is your call, and the API already takes 60.
- Nothing about the Who picker filters the feed: a party of twelve is still shown listings that state a
  ceiling of four, and only finds out in the booking box. Making the party a filter is a feature, not a fix,
  so it was left alone.
- The earlier runs' calls stand, unchanged: the Peek call budget, 65 of 59,125 listings ship an FAQ, 215 GIFs
  lead a hero, 50 of 64 kinds have no guide, anything needing a real Stripe key is untouched, Home's three
  tabs are still `role="tab"` with nothing to control, and no workflow runs `npm test`.

## 19 September 2026, thirty-fifth run (11:00 to 12:40 UTC)

**Checked, and why.** Nothing landed after the thirty-fourth entry, whose rehearsal it records as green, so
the rehearsal was skipped at the start and run twice at the end instead, once the fixes touched `src/lib`.
Type checks and both suites were run first and were green (467 app, 316 backend). Coverage claims search and
browse as verified, but on inspection what was verified is the shell of it: a query matching nothing, paging,
an unpublished listing staying out, the ways out of an empty page, and the suggestion counts. What a guest
types against what they are actually shown, ranked, had never been swept. So: `src/lib/search.ts`, 1,272
lines and the largest guest-facing module with no ranking test of its own, driven over all 59,126 shipped
listings.

**Found and fixed.**

- **A guest looking for golf in Fort Myers opened on a course at Fort Benning, Georgia** (`2eb443457`). The
  search glues an adjacent pair of typed words into one spelling so "jet ski" still finds a shop called
  Jetski. Matching that glued spelling accepted a word that was only its front, and the front of "fortmyers"
  is "fort", so the "myers" half of the query was answered by any Fort in North America. "brewery fort
  lauderdale" opened on Fort Hill Brewery in Massachusetts, "theatre fort myers" on Fort Smith Little Theatre
  in Arkansas, "scuba virginia beach" on Dive Utah, and it was the only answer there was. Of 2,496 activity
  and city queries 2,365 are unchanged, none gained a result, and every first card that moved landed in the
  place the guest named.
- **A guest asking for a spa in Mesa opened on one in Brooklyn** (`2510a853f`). Being in the place the guest
  named was worth 20 points, and only the 47 metros could earn them. A town that is not one earned nothing,
  so a one-letter typo in a business name, which scores in the highest field there is, beat the town spelled
  right: Mysa Wellness Spa in Brooklyn for "spa mesa", Milwaukie Bowl in Oregon for "bowling milwaukee", The
  Bell in Scona in Edmonton for "brewery bellingham", The Dark Horse Mercantile in Saratoga Springs for "horse
  sarasota". A town spelled exactly as typed now counts too, for less than a metro. Of 1,093 town searches the
  first card was in another town 144 times and is now 95; 87 were in another state and are now 69. It only
  reorders, so no page gained or lost a listing.
- **A guest searching tennis in Tampa was offered "Nashville · 313", and opened nothing** (`dbcda36fe`).
  Nashville answers "tennis" because Tennessee does, and it has 313 listings and no tennis. The empty state
  was taught to count what its own button opens on 15 September (the fourth run); the found state, which is what a guest
  sees the moment a filter clears the grid under a search that did land, still counted the whole city. Both
  count one ranking now and a city whose page would be empty is not offered. Pressed all 1,383 activity,
  elsewhere and city rows the catalog offers across 64 kinds and 8 cities: none promises more than it opens,
  where 7 did.

**Swept and clean.** Every kind against every metro that has three or more of it, 1,417 queries: not one
comes back empty. The same over the 90 busiest towns that are not one of the 47 metros, 1,093 queries. A
shop searched for by its own name, which still comes back first. Both ways a guest splits a word the operator
joins, and the split the catalog spells as one word. The
two search surfaces both move a typed metro into Where before they search, which is why none of this showed
on a metro: it only ever bit a guest who named a town, which is most towns.

**Ran the rehearsal after the fixes**: 53 of 53, against a local Postgres with TLS and the Chromium on disk.
476 app tests (14 new, across three files) and 316 backend tests, both projects type-check clean.

**Needs Harshil.**

- **Two towns of the same name are still a coin toss.** "golf springfield" cannot know which Springfield, and
  the catalog has several; so do Columbia, Madison, Henderson, Richmond and Portland. 69 town searches still
  open on another state for this reason. Asking for the state, or leaning on where the guest is, is a product
  call, not a fix.
- **A city row still cannot see the guest's filters.** It counts the query in that city, which is what the
  phone sheet already promises, but a price range set on the desktop can still empty the page it opens. The
  filters live outside `search.ts` and putting them inside it is a bigger change than tonight's.
- The earlier runs' calls stand: the Peek call budget, 65 of 59,125 listings ship an FAQ, 215 GIFs lead a
  hero, 50 of 64 kinds have no guide, anything needing a real Stripe key, Home's three tabs, the desktop Who
  offering 22 where the phone stops at 8, and no workflow runs `npm test`.

## 20 September 2026, thirty-sixth run (05:00 to 06:00 UTC)

**Checked, and why.** The concierge: `backend/src/concierge/` (the sentence reader, the shortlist, the live
FareHarbor read, the vendor table), its two routes and the `/go` page. It is the newest surface, it landed
after the thirty-fifth entry, it is the one a guest types into, and it had no test of any kind. Everything
tonight's list names (the listing page and booking box, search and browse, claim and sign-in, the dashboard
pages, empty states, 400px, the booking flow's accessibility) is already down as verified and nothing since
has touched it, so re-reading it would have bought nothing. The rehearsal was run, because commits since the
thirty-fifth entry touched `backend/src`, `src/` and the scripts: green at 53 of 53 before any of tonight's
work, so what follows is the concierge's own, not a regression.

**Found and fixed.**

- **A guest asking what is free tonight was offered this morning, and tomorrow** (`81f310baa`). Two date bugs
  under a line that reads "here's what's actually free". The window ran a day long, so a one day question
  accepted tomorrow's departures with nothing saying the date had moved; and nothing dropped a departure that
  had already left, so at nine in the evening the answer was this morning's ten o'clock. `start_at` carries the
  shop's own UTC offset, which is what makes that comparison safe from a server in another time zone.
- **Asking for an escape room in Kitchener, Ontario searched the whole province** (`3fd0b32d1`). A guard
  written for "skydiving in ontario" (which was finding Ontario, California) skipped the town lookup whenever a
  region was named, and people write a place the way they write an address. Kitchener was thrown away, the
  search fell back to all of Ontario by review count, and the answer was Toronto. The town is read either way
  now and the region says which of the towns of that name was meant, so "vancouver washington" is Vancouver,
  Washington. Also: on a Sunday, "this weekend" meant next Saturday, six days out.
- **A business named after a script tag could run it in a guest's browser on `/go`** (`9a2e89574`). The same
  hole the static pages were carrying this week. The option cards and the agent log are built with innerHTML
  out of the business name, the town, the trip name and the ticket label, all of which came off somebody else's
  site. One escaper now, everything through it, and a test that fails on any value from elsewhere left raw.
- **The concierge printed em dashes at a guest** (`7b6b29b21`), on the one screen `emDash.test.ts` cannot see,
  because it is served from the backend. Now swept there too.
- **A powered-by badge was read as the shop's booking account** (`6619974e8`), so the hosted page we built for
  a Checkfront shop was `https://www.checkfront.com/reserve/`, Checkfront's own site. Same shape for Rezdy,
  Resova, Setmore, Tripworks and `calendly.com/app`. The account is now the first id on the page that is not
  one of the vendor's own.
- **A kayak outfitter's waiver link read as a shop called "waivers"** (`e75538da7`). One of the 1,364 FareHarbor
  links in `live-index.json` is `fareharbor.com/waivers?shortname=enrgkayaking&...`, and one is
  `fareharbor.com/legal/privacy/`. We asked FareHarbor about a company called "waivers", got nothing, and a
  shop with a live calendar read as one with nothing bookable online.
- **The one public route that calls other people's servers was the one nobody counted** (`c8fd0655c`, typing
  fixed in `908a771cf`). Every other public route here carries a `rateLimit`; `POST /concierge/ask` fans out
  into a handful of requests to a shop's booking provider and had none. Sixty an hour now, a hundred and twenty
  on `/concierge/live/:domain`, and the `ask` count is clamped, because it is handed to `Array.slice` and a
  negative one reads from the end.

**Swept and clean.** The menu filter that keeps a school rate or a private hire out of a per-head quote. The
headline price skipping the child fare, a $0 total not quoted as free, and FareHarbor's tax exclusion carried
through. The shared price sheet, which `widgets.ts` had already established is one per company. A sold out day
answering "nothing bookable" rather than failing, and a sentence with nothing to search on getting a question
back. The two widening rules were read, not driven: they need a catalog this machine does not have.

**Green after the fixes.** 53 of 53 rehearsal steps against a local Postgres with TLS and the Chromium on
disk, 353 backend tests (23 new, in four files, the concierge's first) and 476 app tests, both projects
type-check clean.

**Needs Harshil.**

- **The party size is read and never used.** The agent log prints "4 people", and nothing filters or prices by
  it. FareHarbor gives us each rate's minimum and maximum party size and no surface reads them, so a couple can
  be quoted a rate that needs six of them. Deciding what a party of twelve should do to the shortlist is the
  same product call the guest app still has open.
- **The comparison line can mix currencies.** "Across 3 places: $19.99 to $25 a head" is drawn from menu prices
  that may be CAD and USD side by side, which is a real risk on the Ontario and New York searches that started
  all this.
- **None of this can be driven here.** The catalog SQLite is not in a checkout, so tonight's tests run against
  fixtures: a scratch catalog of a dozen shops and a stubbed vendor. A vendor that has quietly changed its JSON
  still reads as a shop with nothing open, and nobody finds out.
- The earlier runs' calls stand: the Peek call budget, the 6 rows publishing a bare `https://fareharbor.com/`,
  anything needing a real Stripe key, and no workflow runs `npm test`.

## 20 September 2026, thirty-seventh run (06:05 to 07:15 UTC)

**Checked, and why.** The name a guest reads: the business name on all 59,125 shipped listings and the row
name on all 141,717 shipped options, services and add-ons. It is the biggest text on a card, the hero, the
page title, the landing pages, the confirmation and Otto's answers, it is what a guest picks in the booking
box, and neither `cleanTitle` nor the sweep behind it had a test of any kind. Everything tonight's list names
was already down as verified with nothing since touching it. Also finished the concierge's hosted-page route,
the one fulfilment route the thirty-sixth run left unread. The rehearsal was run, because these changes reach
the guest listing and its menu: 53 of 53, green.

**Found and fixed.**

- **Fifty published business names were wrong** (`bf2392d78`). `cleanTitle` was not idempotent: fed its own
  published answers it changed 50 of them, which is the sync saying it had not finished. 15 ended on a
  preposition ("Balloon Decor by", "Rock Climb, And", "Learn to"), because the rule that drops a dangling word
  ran before the 70 character trim and trimming at a word boundary makes a dangling word of its own. 12
  carried the shop's phone number ("Beverly Hills Day Spa (850) 714-4459"), one of them a licence number and
  "By appointment only" too. 7 quoted a price we do not otherwise stand behind and which goes stale by itself.
  15 ended in a listing site's own ellipsis and 4 began with a character that prints as nothing.
- **262 menu rows offered something the page had and the service did not** (`0e43f7c76`). 67 lead or trail a
  nav arrow ("< Exhibitions", "Program Punch Card Flyer>>"), which had to be told from the arrow that means
  less than ("(<17)", "(> 6 Hours)"). 8 carry the shop's phone number. 19 add-ons end in a price list's dot
  leaders. 18 begin with a zero width space and 9 with a Font Awesome codepoint out of the private use area,
  which draws as an empty box on anyone else's machine. Add-ons went through none of this: `bookableMenu` read
  options and services only, and an add-on is picked in the same booking box. This one is read at load time,
  so it reaches guests without waiting for a sync.
- **The concierge had never heard of `xola.app`** (`60f66a0ee`). Two vendor tables ship, and swept over all
  1,664 booking links in `public/live-index.json` they disagreed on 28. 27 Xola links live on `xola.app`, which
  the concierge read as no vendor at all, and its seller pattern matched none of the real forms either. A
  FareHarbor waiver link still read as a shop called "waivers" here, the bug the other reader was fixed for
  yesterday. `checkfront.site` was unknown and a shop on `.resova.us` was sent to a `.resova.com` page that is
  not theirs. The first rule whose name appeared anywhere won outright, so a footer link to FareHarbor's
  privacy page left a Peek shop with no feed and no hosted page. The two readers agree on all 1,664 now.

**Swept and clean.** Every shipped title against `catalog.json`, `catalog-lite.json` and the detail file that
opens from the card: all 59,125 agree, so no card says one thing and its page another. Titles carry no
private-use glyph, no markup and no HTML entity. The 62 names holding a domain and the 20 holding an "@" are
the shops' own branding and are left alone.

**Green after the fixes.** 53 of 53 rehearsal steps against a local Postgres with TLS and the Chromium on
disk, 361 backend tests (8 new) and 481 app tests (5 new), both projects type-check clean.

**Needs Harshil.**

- **The name fix reaches guests only at the next sync.** `cleanTitle` runs in the sync, so the 50 names stay
  wrong in `public/o` and `catalog.json` until one runs. The menu row fix is read at load time and is already
  live. `backend/scripts/purge-bad-names.mts` exists and was not run from here.
- **12 names are still not names**, and no rule can safely say so: "You are being redirected...", "SITE1212",
  "Home of Key West's famous sandbar trip", "bocaratonobserver.com". They need a legal name on file or a hand.
- **12 listings carry an emoji in the name** ("🏨 Zip Line Adventure over Tampa Bay" is a marketplace tile's
  icon; "Topwater Charters 🐟" is plausibly the shop's own). Left alone, because telling those apart is a call.
- The earlier runs' calls stand: Peek's 257 links and no feed, the 6 rows publishing a bare
  `https://fareharbor.com/`, anything needing a real Stripe key, and no workflow runs `npm test`.

## 20 September 2026, thirty-eighth run (07:15 to 08:30 UTC)

**Checked, and why.** The concierge inside the guest app, which landed in five commits after the
thirty-seventh run's log and is in no Coverage list: `src/lib/concierge.ts`, `conciergeHistory.ts`, the
806-line `WebConcierge` overlay, the guest wallet, and the availability corpus. It is the newest thing a guest
can touch and the strongest claim the product makes, so a wrong number or a leak here is the most expensive
kind. Everything on tonight's suggested list was already down as verified with nothing since touching it. The
rehearsal was run four times, because those commits touched `src/` and `backend/src`, because the first run
came back red, and because `origin/main` moved under the run and took it red a second time.

**Found and fixed.**

- **Anyone could read the last forty guests' questions** (`ba63c4583`). `GET /concierge/sessions` and the
  `/sessions` page it feeds were public, unauthenticated and uncounted. They sit above the blanket
  x-admin-key gate in `routes.ts`, which is right for the ask and stream routes beside them and wrong for
  these: they hand out every conversation this process has served, and on the site `withPlace` has already
  appended the guest's own town to the sentence before it is sent. They also printed every live session id,
  and `getSession` adopts any id a caller sends, so a stranger could carry on somebody else's conversation.
  Both now use the same two doors as the rest of the internal tooling, plus the laptop door the blanket gate
  itself carries, and both are counted.
- **An hour read as a town** (`6e4456f7e`). `withPlace` adds the guest's city when their sentence names
  nowhere, and decided a sentence named a place by finding a preposition followed by any letter. "in the
  evening", "at seven", "at sunset", "by myself", "on monday at eight": eleven of twelve ordinary place-less
  sentences tripped it, so the city was never attached and the agent came back asking where they were, over
  no results. The same failure "near me" caused, from the other end.
- **The overlay said `aria-modal` and behaved like nothing of the kind** (`7e2c3d146`). Driven in Chromium at
  1280px and 400px: 23 of 24 Tab stops walked out into the home page under a full-screen scrim, a wheel over
  the thread rolled that home 900 px, and Escape left focus on the body. Every other dialog on the site has
  used `useModal` since the run that wrote `modalChrome.test.ts`; this one shipped after it and without it.
- **A copied conversation quoted the child fare** (`9293f7aad`). The history exists so a wrong answer can be
  pasted at whoever can fix it, which only works if it says what was on the screen. It took the first priced
  row off the shop's menu, in the shop's own page order, so "Child (under 12) $15" above "Adult $30" copied
  out as $15 while the card read $30: the defect `headlineService` was written to fix, back in the one place
  whose whole job is fidelity. It also listed no priced shop at all once anything had a live time, while the
  screen shows up to three under "Also nearby".
- **The rehearsal was failing 69 of the availability corpus** (`0a5e78d8f`). `availability.ts` builds the
  live-index URL from `SITE_URL` at import, which is right on a real host and wrong inside a recording. The
  rehearsal sets `SITE_URL` to its own localhost, as `backend/AGENTS.md` tells anyone testing to, so every
  case asked for a key none of them holds: the index 404ed, every shop lost its booking link, and the corpus
  read as the reader having regressed on a machine where nothing was broken.
- **The backend type-check was red, twice** (`d4a282b15`, then `88fab909c`). First in three places: a settled
  promise read from the variable a callback assigns, a Stripe error's `code` missing from the shape the
  response is cast to, and `document` inside a `page.evaluate` in a project whose lib is ES2022. Then, when
  `origin/main` was fetched at the end of the run, `src/concierge/agent.ts` had arrived a few hours earlier
  with thirteen more of the same last kind. A function handed to `page.evaluate` runs inside the page, where
  those globals exist, so DOM joins the lib, which is what a project driving Playwright needs. What that costs
  is that `document` in ordinary server code is a production crash rather than a build error, so a test now
  names the files allowed to say these words: three that drive a browser, two that write a page for one, and
  the per-vendor drivers directory, which is what every file in it does. All of it type-only, so `npm test`
  stayed green through every one, the fourth and fifth time this gap has bitten (183a54975, 908a771cf). The
  new guard earned itself within the hour: `origin/main` moved twice more during the run, and the second
  move's new Checkfront driver tripped it.
- **Pressing New could re-ask the shared question** (`107b7dd28`). `startOver` cleared the ref that marks the
  opening question as asked, re-arming an effect that re-runs whenever the guest's place changes, which
  `AppProvider` refines from the network after first render. Reasoned from the code, not observed: the
  refinement needs a network this box does not have.

**Swept and clean.** The guest wallet end to end, the one new money path: the cap and its clamp, `x-wallet`
in the CORS allow list, the 48-character id, the setup-mode webhook branch, and that the browser's
`ottoCanPay` and the server's `agentMayCharge` agree. The saved-card booking path against the Checkout one:
the slot race, the duplicate, the release on both, and that an instant booking still schedules its payout.

**Green after the fixes.** 53 of 53 rehearsal steps against a local Postgres with TLS and the Chromium on
disk, 498 backend tests (5 new) and 577 app tests (6 new), both projects type-check clean.

**Needs Harshil.**

- **Nothing runs a project type-check on a push**, and `origin/main` was red when this run fetched it. That
  is five red-on-main incidents now, two of them tonight, and the rehearsal is the only thing that reads
  either type-check. A CI job that runs `npm test` and both type-checks on every push is the single
  highest-value thing missing from this repository.
- **`origin/main` was force-updated while this run was working**, which is worth knowing about rather than
  acting on. This clone is shallow (52 commits), it starts on a detached head, and its local `main` ref is
  left over from before the rewrite, 50 ahead and 52 behind. This run's eight commits were rebased onto the
  new `origin/main` and pushed as a fast-forward from that detached head, so nothing was lost and nothing was
  forced. The stale local ref was left alone: a shallow clone cannot tell what is really only there.
- **26 em dashes have arrived in the concierge's comments** in the last few hours, 7 in `agent.ts` and 19 in
  `plan.ts`, which AGENTS.md forbids anywhere. Left alone rather than rewritten, because it is somebody
  else's prose from a few hours ago and no test reads a backend comment. The em dash test only reads what the
  app prints at a guest, and could be widened to the source if the rule is meant to hold there too.
- **`/sessions` has no browser door on Render.** The metrics page signs in with an emailed code; this window
  has no sign-in of its own, so with `ADMIN_KEY` set it now answers a browser 404 and only curl gets in. That
  is the safe end of the trade and it does make the watch window harder to open from a laptop that is not the
  Mac. Worth a sign-in like `/admin`'s if the window is going to be used.
- **A concierge session id is eight characters of `Math.random`.** The listing is closed now, so they are no
  longer published, but they are neither unguessable nor issued from a CSPRNG, and `getSession` adopts any id
  a caller sends. Low value to an attacker today; worth `randomBytes` the moment a session holds anything.
- The earlier runs' calls stand: Peek's 257 links and no feed, the 6 rows publishing a bare
  `https://fareharbor.com/`, and anything needing a real Stripe key.

## 20 September 2026, thirty-ninth run (08:00 to 09:00 UTC)

**Checked, and why.** Every area tonight's list suggests is already down as verified, and nothing had landed
since the thirty-eighth run's log when this one started, so the rehearsal was not re-run at the top: the type
checks and both suites were run instead and were green (577 app, 498 backend). The time went on the two
entries Coverage has been carrying under Otto for several runs, both of them a question read as the wrong
thing, and then on the rest of `companyAgent.ts` read the same way. Otto is the product's third promise and
the only surface that answers a guest in sentences, so a wrong answer there is a wrong answer with our name
on it, on all 59,125 shipped listings at once.

**Found and fixed.**

- **Asked where the nearest hotel was, Otto gave the shop's own dock** (`f139bcbd2`). `meet` outranks the
  out-of-scope gate so "where do we meet" survives a place word, and the exemption was every question the
  `meet` reader matches, which is every question carrying "where". So "where's the nearest hotel?", "where can
  I get an uber?" and "where are the best reviews?" were each answered with this shop's meeting point, its
  street address or the town it sits in, on every listing in the catalog. An address a guest did not ask for
  is worse than a refusal, because it reads as an answer. Words that can only be somebody else's now break
  the exemption, unless the operator publishes the word themselves: 234 listings meet at a hotel lobby or an
  airport terminal and keep their answer. Both gates read the new list, because they held different lists once
  before and the second quietly took the `pets` exemption back.
- **Otto said Yes to a newsletter, and Yes to a booking it cannot see** (`70c295d90`). Two ways into the reply
  that opens "Yes. Pick a service and time on this page". "Sign up" was read as booking, so "can I sign up for
  your newsletter?" was a yes to something the page cannot do. And `asksAboutOwnBooking`, which exists to stop
  the one answer rule 4 forbids, needed the word "my" or "our": "is the booking confirmed?" and "did the
  reservation go through?" both fell through to that same "Yes.", for a booking Otto cannot look up and a shop
  that has not confirmed it. Both on every shipped listing. "Are bookings confirmed instantly?" is still a
  question about how booking here works, and still answers.
- **Asked whether they open on Christmas, Otto read out today's hours** (`f7749d124`). A shop publishes a week,
  never a calendar. "Christmas" names no weekday, so the hours chain found no day and fell through to its
  "open right now" branch: on all 14,499 listings that publish hours, a guest asking about Christmas,
  Thanksgiving, New Year's Eve or December 25 was told "Not yet. They open today at 9 AM". A holiday or a date
  now answers that they publish a normal week and not holiday hours, with that week beside it. "Good Friday"
  and "Easter Monday" are holidays rather than this week's Friday and Monday.
- **"How old do you have to be" was answered with the shop's first entry rule** (`237104d35`). That sentence
  says neither "age" nor a number, which is all the age reader looked for, so it read as a generic rules
  question, matched no rule topic, and fell to the first requirement line plus a count of the rest. On Ali'i
  Ocean Tours that was a briefing about how to swim with mantas. It now gives the published minimum age, or
  says none is published. "How old is the boat" is still not a question about the guest.
- **A restaurant reachable by boat was read as this boat's accessibility note** (`baa628b5a`). `rulesAnswer`
  picks the published lines carrying a topic's words and never checked which sense it had found, so "accessib"
  matched "dinner at one of the area restaurants that are accessible by boat" and that is what a guest asking
  whether the trip is wheelchair accessible was read. 23 shipped listings hold only that sense of the word.
  Each rule topic can now name the sense it is not.

**Swept and clean.** The rest of `companyAgent.ts` read line by line: the offer matcher and its family folding,
the price, duration, group, deals, waiver, bring, included and cancellation answers, the chips, the compound
two-questions-in-one path, and the FAQ that beats an assembled answer. Twenty-five ordinary guest questions
asked of five listings of different shapes turned up nothing else wrong: what is left is Otto saying it does not
know (cash, cards, tipping, photos, arriving late, changing a time), which is rule 3 working.

**How the five were checked.** 19,710 answers to 30 legitimate questions over a 657-listing sample spanning
the whole catalog, diffed before and against after: not one byte changed. The same sample for the questions
that were wrong: 5,256 of 5,913 answers changed, which is every listing sampled for every one of them.

**Green after the fixes.** 53 of 53 rehearsal steps against a local Postgres with TLS and the Chromium on disk,
586 app tests (9 new) and 498 backend tests, both projects type-check clean, and clean again after rebasing
onto `5da532e0e`, which landed during the run.

**Needs Harshil.**

- **Nothing runs a type-check or `npm test` on a push.** This is the third night's log to say it and the
  thirty-eighth run counted five red-on-main incidents. `5da532e0e` landed mid-run and was clean, which is
  luck rather than a process.
- **A shop that trades on a holiday cannot say so.** The fix above is honest, not complete: `OperatorProfile`
  has nowhere to hold "open Boxing Day, closed Christmas Day", so a claimed shop that does trade is told by
  its own assistant that it might not be. A holiday exception list on the Availability page is the real answer.
- **Otto has no answer for the six commonest questions it hears after price and hours**, going by what a guest
  would plausibly type: cash, cards, gift cards, tipping, photographs, and what happens if they are late. Each
  is a fact the shop knows and almost none publish, so widening Otto is the wrong end: the dashboard's "What it
  knows" panel could ask for these six by name.
- The earlier runs' calls stand: Peek's 257 links and no feed, the six rows publishing a bare
  `https://fareharbor.com/`, and anything needing a real Stripe key.

## 20 September 2026, fortieth run (09:00 to 10:15 UTC)

**Checked, and why.** Two commits landed after the thirty-ninth run's log was written, `c022a45f5` and
`b2b3549b8`, and between them they are 3,500 new lines: five booking-system readers (Acuity, Rezdy, Square,
TripWorks, Xola, plus a documented negative for Bookeo), a rewritten concierge overlay and a rewritten
`concierge.css`. Nothing had read any of it. Coverage lists every area tonight's brief suggests as already
verified, so the whole run went on the newest code instead, which is also the code most likely to embarrass
Harshil: the concierge overlay is the surface a guest types a sentence into. The rehearsal was run, because
those two commits touch `backend/src` and `src/` and the rule says so; it was run twice, because the first
re-run tripped the harness's own guard against a site port it did not open (a Chromium session of this run's
was on 5199), which is that guard working.

**Found and fixed.**

- **`main` was red, and had been since 04:42** (`9f5d4b4a8`). `npx tsc --noEmit` in `backend/` failed on
  `acuity.ts`: `AcuityType.type` is declared `string | undefined` and is filled from `str()`, which returns
  `string | null`. One line. This is the fourth night's log to record a red `main` and the third to ask for a
  type-check on push.
- **The concierge overlay's rewrite dropped its focus trap** (`1d8425f41`). `c022a45f5` rebuilt
  `WebConcierge.tsx` and lost the `ref={box}` and the `useModal(box)` that the thirty-sixth run put there. It
  still said `aria-modal="true"`. Driven in a real Chromium at 400px and 1280px: Tab walked back out into the
  home under the scrim, a wheel rolled that home, and closing left focus on the body. Both `modalChrome`
  tests had been failing on `main` and nobody ran them. Restored, and driven again: 0 of 12 Tab presses now
  land outside the dialog.
- **Half the Xola shops we can read were being sent to the browser agent** (`5a459247a`). `vendors.ts` records
  in its own comment that "half of Xola lives on `xola.app`, not `xola.com`" and widened its detection to
  match. Four other copies of that same list were not widened: two in `plan.ts` deciding the route, one
  choosing which reader to call, and `READABLE` in `resolve.ts`. All four said `xola.com`. So all 27
  `x2-checkout.xola.app` and `checkout.xola.app` links in the shipped `live-index.json`, every one of which
  `xolaRef` parses perfectly, were routed away from the reader written for them and the guest was told there
  was no feed. Square had the same gap: `squareRef` reads `square.site/book/<LOC>/<slug>`, the Appointments
  profile page, and no copy sent one to it. The list now lives once, in `readable.ts`, with a SQL twin for the
  three `ORDER BY`s that also named a subset, including the sub-select that picks which booking link to use
  when a shop has two.
- **Every shop header in the concierge answer ran together as one word** (`fdf88cddb`). `b2b3549b8` rewrote
  `concierge.css` and deleted the rules for eight classes the shipped component still draws: `.cg-opt`,
  `.cg-shop`, `.cg-via`, `.cg-row`, `.cg-typing`, `.cg-status`, `.cg-got`, `.cg-compare`. A name, a day and a
  source line are three inline children of one button, so with nothing between them a guest read
  "Escapology WaterlooSun, Sep 20 · WaterlooRead live from their Resova calendar" on every answer the overlay
  gave, on a card with no border, no padding and no shadow. Found by driving the overlay against a stubbed
  shortlist rather than by reading it. The eight are back, in the new stylesheet's own idiom.

**Swept and clean.** The five new readers read line by line against the trap list in
`concierge/AGENTS.md`: every one of them takes local dates rather than `toISOString()`, every one marks
`taxIncluded: false` and says why, every one keeps a child, youth or senior fare out of the headline unless
nothing else is sold, and every one drops a slot that has already started today against the shop's own clock,
read from the shop's own timezone through `Intl`. The overlay itself driven at 400px and 1280px, answered and
with the history panel open: no sideways scroll, nothing past the edge that is not inside a scroller a thumb
can reach, no unnamed control, no page error.

**Green after the fixes.** Both projects type-check clean, 592 app tests (3 new) and 508 backend tests (6
new), and 53 of 53 rehearsal steps against a local Postgres with TLS and the Chromium on disk.

**Needs Harshil.**

- **`concierge.css` carries about 330 lines for a panel that does not exist.** `b2b3549b8` added rules for 35
  classes twice over, in two blocks with different values, for a component built around `.cg-card`,
  `.cg-open`, `.cg-starter`, `.cg-work`, `.cg-receipt` and `.cg-trace`. Nothing in `src/` renders any of them.
  Its second block also overrides `.cg-slot` and `.cg-slot-when`, which are live, and it reaches for four
  custom properties (`--cg-accent`, `--cg-line`, `--cg-raise`, `--cg-raise-hi`) that are defined nowhere, so
  all 13 uses fall back to a dark panel's white alphas and a lime `#8fc46a` that is not the brand forest. It
  looks as though a further overlay rewrite was expected and did not land. I left it rather than delete a
  third of your stylesheet on a guess; the new test warns on the dead half rather than failing on it.
- **Nothing runs a type-check or `npm test` on a push**, and tonight that cost a red `main` for four and a
  half hours plus two failing tests nobody saw. Everything else on this list has been asked for three nights
  running; this one is now the cause of its own entries.
- **The readers have no tests of their own.** 2,600 lines of Acuity, Rezdy, Square, TripWorks and Xola landed
  with none, and `readable.test.ts` is the first file to touch any of them. The helpers worth pinning are pure
  and easy: `priceOfSlot`, `isAgeGatedFare`, `rateLabel`, and each reader's `*Ref`.
- The earlier runs' calls stand: Peek's 257 links and no feed, the six rows publishing a bare
  `https://fareharbor.com/`, and anything needing a real Stripe key.

## 20 September 2026, forty-first run (10:00 to 11:30 UTC)

**Checked, and why.** One commit landed after the fortieth run's log was written: Harshil's own
`55c696943`, "Open Near me on the GPS pin", 443 lines across the home, the listing page, search and the app
provider. Nothing had read it, it is the newest thing a guest touches, and the brief's first two unchecked
areas (the guest listing page and its booking box, then search and browse) are exactly what it rewrote. So
the whole run went there. The rehearsal was run, twice, because that commit touches `src/` and so did four of
tonight's five fixes.

**Found and fixed.**

- **The app's type-check was red on main** (`16f52f37f`). `rememberCoords` always answers a point and
  `openingFeed` always answers one of three shapes, and both were declared as the nullable `Guess`. A
  possibly-null `feed.kind` stops TypeScript narrowing a union, so every field read after it in `withPlace`
  failed too: eight errors from two words. Worth saying plainly, because this run's own brief says to type
  check with `npx tsc --noEmit -p .` at the root, and that project checks nothing at all. `npm run typecheck`
  (`tsc -b`) catches it, and so does the rehearsal's own step. Verified both ways on the old commit.
- **"Ask Outset about this shop" did nothing at all** (`b0b2742e9`). The desktop listing traded Otto's panel
  for a button that dispatches `openAsk`, and the provider's `asking` is a string nothing renders: `App.tsx`
  kept a second copy in its own `useState` and drew the overlay from that one. Driven in a real Chromium:
  before, clicking it left `role=dialog` at 0; after, the concierge opens. The provider's own comment already
  said it holds this state "so any screen can open the same overlay", so `App.tsx` now reads it.
- **A guest who arrived on a shared listing link got a home that never stopped loading** (`e6c142fd5`). The
  feed opens in `locating` and waits for GPS rather than painting the clock's city, and the one effect that
  ends that wait only ran when the visit *began* on the home. A listing link is not the home, so "Back to
  results" drew two skeleton rails and left them there: 0 cards, no empty state, no explanation, still there
  at 70 seconds. This is the outreach email's link and every shared link. Asking is now a question about the
  screen the guest is looking at (`shouldLocate`), so a listing link still prompts nobody and the home behind
  it settles a place when it is reached. 14 rails and 118 cards, driven.
- **An operator who switched the assistant off still had it offered** (`74b15869b`). The Assistant page says
  "Guests can't reach it while it's off". The phone listing has honoured that switch all along; the desktop
  listing did too until its Otto panel became the Ask button above, which was drawn for every shop. The test
  that guards this had been failing on main since 09:34 and nobody ran it.
- **A heading counted 22 and the grid drew 18** (`8b8fc433f`). A dead cover takes its listing out of any grid
  that promises photographs, and that happened inside `Grid` and `Rail`, after every count on the page had
  been taken from a list that still held them. "Escape rooms in Toronto · 22" over 18 cards, the Filters
  modal's "Show N places" promising 22 at the same instant, no Show more and no other way to the missing
  four. The filter now runs once, on the pool both the counts and the cards come from.

**Swept and clean.** The guest listing at 400px over eight shapes (12 options, no prices at all, mixed priced
and unpriced, add-ons, four venues, a 60-character name): nothing scrolls sideways, nothing sits past the
edge outside a scroller. The service picker on a shop whose eleven options read as nine "6 hours · $120"
rows: each one carries its own boat's name as a heading, so they are told apart. A search that matches
nothing: a named count, real suggestions and a way out, never a bare no-match.

**Green after the fixes.** Both projects type-check clean (`tsc -b` and the backend's own), 604 app tests (5
new) and 508 backend tests, and 53 of 53 rehearsal steps against a local Postgres with TLS and the Chromium
on disk, run once mid-way and once on the finished tree.

**Needs Harshil.**

- **Nothing runs a type-check or `npm test` on a push**, and tonight it cost a red `main` for four hours and
  two failing tests nobody saw, for the fourth night running. One more detail for whoever wires it: run
  `npm run typecheck`, not `tsc --noEmit -p .`, because the root project is empty.
- **If every cover on the page dies, the home goes silently blank.** The kind list is non-empty, so "Nothing
  in X here yet" never appears, and every rail returns null: header, category chips, footer and nothing in
  between. Rare in the wild and total when it happens. I left it, because what the page should say instead is
  a product decision.
- **`55c696943` carries a lot of reformatting.** Roughly half its listing-page diff is whitespace that moved
  closing tags off their own indentation, which is what buried the assistant switch going missing.
- The earlier runs' calls stand: `concierge.css`'s dead panel, the readers with no tests of their own, Peek's
  257 links, and anything needing a real Stripe key.

## 20 September 2026, forty-second run (11:00 to 12:15 UTC)

**Checked, and why.** Three commits landed after the forty-first run's log: `23a413637`, `938e37e80` (a
1,482 line Sonnet 5 commit) and Harshil's own `6d33774042`. The first thing a type-check found was that
`main` was not red, it was dead: so the run went to that commit, and then to the one area the last run's own
Coverage still called untested, the readers' price helpers. The rehearsal was run, twice, because those
commits and four of tonight's five fixes touch `src/` and `backend/src`.

**Found and fixed.**

- **The API could not boot and the guest app could not build** (`3177a856ca`). `938e37e80` imports three
  modules it never committed: `readers/foreup.ts`, `api/nearby.ts` and `lib/mapsNearby.ts`. None of the three
  is in any commit, on any branch, in any tree. `api/routes.ts` is the router every route hangs off, so the
  API threw on import: not one booking, claim, profile or payout, and no deploy from `main` could succeed.
  `plan.ts` is the concierge, so both routes and both test files died with it, which is the two failing tests
  that had been on `main` since 11:09 UTC. `vite build` could not resolve `lib/mapsNearby` at all, and
  `tsc -b` reported 23 errors from it. Each import and its call sites come out, which is what a golf course, a
  search and a feed did before that commit; nothing is written in their place, because a reader
  reverse-engineered against a live vendor is not something to invent. The new test walks every relative
  specifier in every backend file against the disk, which is the check that would have caught all three.
- **A booking link the crawl found was deleted by the live resolve that failed to find it again**
  (`65945eaf04`). The same commit added a `DELETE` of all four keys `remember` writes, then wrote
  `booking_url` back only when a link was in hand. It guarded that for a shop with a prior resolve on file,
  and that is not the common case: `plan.ts` re-resolves every shop whose route is `agent`, which is exactly a
  shop whose link came from the crawl, and those have no `booking_resolved` row for the guard to find. One
  slow site inside a seven second budget and a link a full crawl had found was gone from `plan.ts`'s query
  (the shop becomes a phone number), from the listing page's slot times and from `live-index.json` at the next
  sync. `booking_vendor` went with it.
- **An escape room's own group tiers read as children's tickets** (`4ad51cfd68`). `xola.ts` and `rezdy.ts`
  each kept a private copy of the age rule, and the copies never had the one guard the shared rule has: a
  range of people is not a range of ages. Every escape room on both vendors prices by how many are playing, so
  "2-4 Players" and "5-8 Players" read as child fares, every real tier was excluded, and the headline fell
  back to the cheapest row on the sheet: a room selling to adults at $30 came back at $20, a child's ticket.
  Both copies are gone, and the readers have their first tests: the sheet, the towel, the agent-only rate, the
  whole-boat charter and a start with no seats.
- **A duration, a clock and an angler count read as a child fare** (`118630bb5a`). The numeric half of
  `isConcessionFare` had no test and believed every small number was an age. Excluding a fare can only push a
  headline up, so each misread over-quoted a guest with the shop's second-cheapest row. Over all 212,052
  shipped menu rows, 206 were misread and 18 listings quoted the wrong price: Anglers Obsession's $550 trip
  says "1-2 anglers" so it was offered at $600, Chester River Packet's $25 public cruise says "River Tour:
  1-2:30 pm" so a guest got the $1,600 private charter, Greenwood Lake's $40 "2-hour cruise (6-8 PM)" became a
  $100 paddle board. Measured both ways over the whole catalog: 276 rows stop being concessions, every one a
  date, a clock, a duration, a grade or a count, and 2 start, both a dance studio's "for ages 3-12".

**Green after the fixes.** Both projects type-check clean, `vite build` bundles, 609 app tests and 523
backend tests (14 new), and 53 of 53 rehearsal steps against a local Postgres with TLS and the Chromium on
disk, run once mid-way and once on the finished tree.

**Needs Harshil.**

- **The three missing files are real work that only their author has.** The ForeUp reader was
  reverse-engineered against a live vendor and `scripts/concierge-bench.mts` is missing too. Whoever ran that
  session still has them on disk; they want committing rather than rewriting. Until then golf has no reader.
- **`fetch-seed.mts` is not wired into anything.** That commit's own headline fix, the empty catalog on
  `outset-api`, is still live: the script exists, nothing calls it, and `outset-api`'s `buildCommand` is still
  `npm ci --include=dev`. It needs `&& npx tsx scripts/fetch-seed.mts` on the end, which is one line in
  `render.yaml` and outside this run's allowed scope. `GITHUB_TOKEN` is already set on that service.
- **`nearbyTextSearch` bills Google per call and caps nothing.** It is dead code tonight, because the only
  thing that called it was the missing route, so this is a note for when that route comes back: every
  uncached query is a $0.035 Text Search request, it writes the ledger but never reads it, and the cache key
  is the guest's own words plus a two-decimal pin, so a caller who varies the text is billed every time. It
  wants the free-tier check `requestsThisMonth` already provides, a per-caller limit like every other public
  route here, and a key check, all of which belong with the route rather than guessed at from here.
- **Nothing runs a type-check, `npm test` or `vite build` on a push**, for the fifth night running, and
  tonight it is no longer a tidiness point: it cost four and a half hours of a `main` that could not boot,
  build or answer a single question, from a commit whose own message describes testing none of it.
- The earlier runs' calls stand: Peek's 257 links, `concierge.css`'s dead panel, and anything needing a real
  Stripe key.

## 21 September 2026, forty-third run (05:00 to 06:15 UTC)

**Checked, and why.** Four commits landed after the forty-second run's log, and two of them are the newest
guest-facing code in the repo: `21c52d1fa`, which rewrote Agent Mode into a text thread (the overlay, its
stylesheet, the needs questions and the sentence reader), and `2331c11de`, the Outset to GoDo rename. Both
touch `src/` and `backend/src`, so the rehearsal was run, twice, rather than skipped. The rename was swept
first and is clean: nothing user-facing still says Outset, and the `outset.` storage keys are deliberately
left alone, since renaming them signs every guest and operator out. Then the run went where Coverage says
nothing has been: the agent's own booking form, its error and empty states and its copy panel, driven in a
real Chromium at 400px and at 1280px against a stubbed shortlist, plus the sentence reader's new rule that a
bare number is a headcount.

**Found and fixed.**

- **A guest who answered "what time do you want to go?" with "2" was booked as a party of two**
  (`3d84a4da5`). A rental leads with the clock question, and the one shape a person answers it with is the
  hour and nothing else. That bare digit is also the one shape `readIntent` reads as a headcount, so the
  hour was thrown away, `partyStated` went true, and the question was never put again because it had already
  been asked once: live times came back ranked around nothing, and the screen read "2 people" back as what
  it had understood. A bare number is now the hour while the hour is the question on the table, and a
  headcount everywhere else, including the moment the party question goes out. "230" is half past two.
- **The agent asked for a name and a mobile, then said "GoDo: no such listing"** (`0d5fd7232`). A shop the
  catalog has never held gets a minted `cg-` id from `listingForOption`, the API has no listing file for one,
  and `POST /bookings` answers 404 "no such listing". That string was printed in the thread in the agent's
  own voice, after the guest had typed their details. The refusal is right, so it is now made first and in
  words, and the form closes rather than sitting there waiting to fail again. Every other refusal goes
  through `guestWords`, because those routes answer in two registers and "bad email." was reaching a guest
  as a sentence the agent said.
- **Book was a press that did nothing** (same commit). The form returned silently on a name of one letter or
  a number of three digits, which is exactly what a half-finished form holds and exactly what the browser's
  own `required` does not catch, because both fields have something in them. `missingFrom` says which of the
  two is short, in the API's own numbers, so a form this accepts is never refused on the other side. The
  three fields also had no label but their placeholder and no `inputMode`, so a phone offered a QWERTY
  keyboard for a phone number: they are the only guest fields in the app that were.

**Checked and sound.** At 400px and 1280px the thread, the working card, the shortlist, the booking form and
the history panel draw nothing past the edge and scroll nothing sideways, and every control is named. The
API unreachable says "I could not reach the shops just now"; a slow API has a Stop that stops it and puts
the send button back; nothing found says so in a sentence; a shortlist with no live times draws the
published prices and a real `tel:` link for the one shop that books by phone; copy takes the whole
conversation. The listing a live shop opens renders from a stub with no overflow at either width.

**Green after the fixes.** 53 rehearsal steps, 0 failed. 534 backend tests, 619 app tests, both type checks
clean (backend TS5097 only).

**Needs Harshil.**

- **Five of the ten new category accents are under the AA floor for text.** `CAT_COLOR` (`src/data/categories.ts`,
  `21c52d1fa`) colours the selected category's own label, 12px semibold on white, on both the desktop strip
  and the phone's: air `#2F80ED` is 3.87:1, water `#0891B2` 3.68, outdoor `#16A34A` 3.30, food `#EA580C` 3.56,
  wellness `#8B7FD8` 3.43, against the 4.5:1 floor `AGENTS.md` sets out (it is the same 3.3:1 that kept sage
  off buttons). One step darker clears it in the same hue: `#2563EB`, `#0E7490`, `#15803D`, `#C2410C`,
  `#6D5FC7`. Left alone because `src/data` and `src/styles` are outside what this run may change.
- **An option the concierge finds but the catalog has never held cannot be booked at all.** Tonight's fix
  makes that honest rather than cryptic, but the two intentions still collide: `listingForOption` mints a
  stub "so a live shop we have never ingested still finishes on GoDo", and the API refuses a booking for a
  listing with no file, which is the fix from the first of these runs. One of the two has to give.
- **The API's own error codes reach a guest on the other surfaces too.** `confirmUnclaimed` dispatches
  `r.error + "."` as a toast, so the phone sheet and the desktop listing can still show "bad email." That is
  one line in `AppProvider`, and it was left alone tonight rather than changed under every booking surface at
  once.
- **A shortlist with no live times says "I found 8 places" over four cards.** `counts.total` is what the
  search found, the payload keeps six and the thread draws four, with no way to reach the rest. A test
  asserts the current wording, so this is a copy decision rather than a bug to quietly reverse.

## 21 September 2026, forty-fourth run (06:00 to 06:40 UTC)

**Checked, and why.** No commit landed after the forty-third run's log and that entry says the rehearsal was
green, so it was skipped at the start and the time went into the hunt instead. The type checks and both unit
suites were run first and were green (619 app, 534 backend). Coverage names the operator dashboard beyond
Bookings as read and unit tested but never clicked, so that is where this run went: every page driven in a
real Chromium at 1280px, 400px and 360px, then Calendar, Services and Availability actually clicked, then the
whole dashboard again as a brand new claimed shop with nothing in it. Then the claim link itself, which is
the gate that hands out a session for an operator's shop and had no test of any kind.

**Found and fixed.**

- **On a phone the Bookings page was drawn wider than the screen, and the right of it was cut off**
  (`36a9cc53d`). `.odbklist` is a grid with one `auto` column and each day's rows sit in a wrapper that is a
  grid item. A grid item's `min-width` is `auto`, so that wrapper refused to be narrower than the widest
  booking row, 392px, and the column grew to fit it. The dashboard is 332px wide on a 360px phone and 372px
  on a 400px one, and `.screen` clips what runs past it: the guest's price, the Needs answer badge and the
  right side of the Accept button were simply gone, with a gutter down the left and none down the right, on
  the one page an operator lives in. Nothing scrolled and nothing warned. The row already ellipsises its own
  lines once it is allowed to shrink, so the wrapper is given the floor of 0 it was missing. Measured at 360,
  375, 390 and 400px, clipped at all four before and at none after.
- **A claim link with anything tacked on the end was still read as the token it starts with** (`b42f5fd7d`).
  `verifyClaimToken` split the token and destructured the first three fields, so
  `v2.<expiry>.<signature>.anything` verified and the trailing data went without a word. Nothing could be
  forged that way, because the signature still had to be one we wrote over that listing id and that expiry,
  but the credential that opens an operator's dashboard, their prices and every booking a guest has made
  should not be parsed loosely. The whole gate now has a test: one listing's link used on another, an expired
  link reading as expired, a forgery reading as a forgery, an edited expiry buying nothing, the legacy static
  links still landing, and `CLAIM_LINK_DAYS` falling back to 30.

**Checked and sound.** All nine dashboard pages at 1280, 400 and 360px draw nothing past the edge and name
every control, Bookings included once the fix was in, and the phone reaches the five pages behind More.
Calendar: an empty slot blocks and reopens, a day name takes the day off and gives it back, and the past is
refused. Availability: opening at 11:30 PM moves the closing time rather than leaving a day that never
closes, a late close is offered as "next day", and a day switched off reads as closed. Services: Add puts a
row on the menu, an option with no price is marked unpriced, and a price of zero is counted as no price by
the row, the header, the menu counter and both checklists. A brand new claimed shop with nothing filled in
opens all nine pages with no error, every empty state reads properly, and both setup checklists count
themselves right (Home 3 of 8, Listing 3 of 6, each matching the items actually listed under it).

**Green after the fixes.** 53 rehearsal steps, 0 failed. 543 backend tests, 622 app tests, both type checks
clean (backend TS5097 only). The rehearsal was run because these commits touch `backend/src` and `src/`.

**Needs Harshil.**

- **The Home tab strip on a phone hides a control where nobody will find it.** `.ohtabs` is
  `overflow-x: auto` in compact, and the "All requests" / "Calendar" link sits at `margin-left: auto`, which
  in a scrolling strip parks it 137px past the end: at 400px it is off screen, at 360px so is half of the
  "Next 7 days" tab, with no scroll hint either time. The bottom tab bar already has Bookings and Calendar,
  so the link is duplication on a phone and could simply not render there, which is one line in `OpHome.tsx`.
  Left alone because it removes something from a screen rather than fixing something broken, and that is
  your call.
- **Tonight's Bookings fix is an inline style, not a stylesheet rule.** `src/styles` is outside what these
  runs may change, so the floor went on the element as `style={{ minWidth: 0 }}`. The tidier home for it is
  `.odbklist{grid-template-columns:minmax(0,1fr)}` in `operator.css`, which fixes it just as completely;
  either is enough, and `bookingsWidth.test.ts` accepts both and fails if both go.
- **Five of the ten category accents are still under the AA floor**, unchanged from last night: `src/data`
  and `src/styles` are both outside these runs. One step darker in the same hue clears it.

## 21 September 2026, forty-fifth run (07:00 to 07:40 UTC)

**Checked, and why.** Nothing landed after the forty-fourth run's log and that entry says the rehearsal was
green, so it was skipped at the start and the time went into the hunt instead. Type checks and both unit
suites first, clean at 543 backend and 622 app. (A fresh container has no root `node_modules`: without
`npm install` at the top level, eight app test files cannot find React and it reads like a regression rather
than a missing install.) Coverage names the newest code as the least read, and the nine booking-system readers
are the newest of all, so this run put to them the question their own AGENTS.md puts at the top of its trap
list: what day do they think it is?

**Found and fixed.**

- **Every evening, "escape room tonight" asked every shop about tomorrow** (`93cb6caf4`). Each reader turns
  the guest's window into calendar dates with `d.getFullYear()` and friends, under a comment saying local
  dates are used rather than `toISOString()` because UTC rolls the evening into tomorrow. That comment is
  true on a laptop in Toronto and false on the host this runs on: `render.yaml` sets no TZ for `outset-api`,
  so the container's clock is UTC and "local" is UTC to the letter, which this container confirms. From eight
  in the evening Eastern, five in the afternoon Pacific, the first day of every window was already the shop's
  tomorrow: the 9pm slot a room still had free was never asked for, and "tomorrow" fetched the day after.
  `src/lib/zone.ts` carries this same story for the claimed side, where it cost every North American shop the
  back half of its day; the shops we read never got the same treatment. They have it now. `shopday.ts` reads
  the window's instant on the shop's own calendar and walks it with `addDays`, which also fixes a fortnight
  stepping over a date the night a zone springs forward. The zone is the vendor's own where it publishes one
  and the catalog's through `zoneForArea` otherwise, so FareHarbor (1,371 of the 1,664 shipped links), Resova
  and Checkfront have one for the first time; a shop we know no zone for keeps exactly its old behaviour.
  Resova's and Checkfront's "has this slot already started" checks were comparing a shop's wall clock against
  the host's, and now read the shop's. FareHarbor's month set is walked from the window rather than a day at
  a time, which also fixes a 40 day horizon fetching the first and last month and not the middle one.
- **A concierge session id was eight characters of `Math.random`** (`225b5ae14`). `getSession` hands back the
  session an id names and the next answer is shaped by that session's accumulated intent, so the id is a
  bearer token for somebody's conversation: where they are, how many of them, what they are after. V8's
  generator is a seeded PRNG whose state can be recovered from its own output, and this route hands the
  caller one output per question asked. It is also not reliably eight characters, and an id too short for
  `getSession`'s own shape check is a guest's thread silently starting over. Sixteen hex characters from
  `randomBytes` now, still lowercase alphanumeric, so an id already in a browser's history keeps working.
  Adopting an unknown id stays, deliberately: reopening a thread from the history panel sends an id the agent
  forgot two hours ago and expects to carry on under it.
- **A golfer was told their tee times came from "their foreup calendar"** (`f7ddc900a`). The line under a
  shop's live times is the one whose whole job is to say the times are the shop's own. It was a chain naming
  eight vendors and ending in `"their " + live.vendor`, so the ninth reader printed its own lowercase id at a
  guest. A table now, with a test over every vendor a reader exists for.

**Checked and sound.** The guest listing page does drop a departure that has already left, on the shop's own
clock, through `bookableStart` in `openNow.ts`, on the live path and the published one alike and on both the
desktop card and the phone sheet, so the availability route not filtering costs nothing; that route's window
comes from the browser's own calendar, not the host's. `api/nearby.ts` and `lib/mapsNearby.ts`, committed
yesterday and never read since: a Maps stub listing's bare-host `src` is the convention all 59,126 shipped
operators already use, its overlay is in memory only, and the route refuses a bad pin, a short query and a
missing Places key. `agentLive` and `replayLive` have the same host-clock assumption and no caller anywhere,
so nothing was changed there.

**Green after the fixes.** 53 rehearsal steps, 0 failed, run because these commits touch `backend/src`. 556
backend tests, 622 app tests, both type checks clean (`-p tsconfig.app.json` for the app, since the root
config still checks nothing).

**Needs Harshil.**

- **`outset-api` has no TZ and should probably keep it that way.** Every reader now carries the shop's own
  zone, so setting `TZ=America/Toronto` on that service would only move which shops are wrong. The two places
  that still read the host clock, `concierge/agent.ts` and `concierge/replay.ts`, are called by nothing.
- **`GET /concierge/live/:domain` reads two vendors while the concierge reads nine.** `liveFor` still tries
  only FareHarbor and Resova, so a Peek or Xola shop answers "no feed to read" there while the same shop is
  quoted live in the agent. No guest surface calls it today, which is why it is a question rather than a fix.
- **Last night's three are unchanged:** the "All requests" link parked off screen on a phone, the Bookings
  `minWidth` living on the element rather than in `operator.css`, and five category accents under the AA floor.

## 21 September 2026, forty-sixth run (08:00 to 08:35 UTC)

**Checked, and why.** Nothing landed after the forty-fifth run's log and that entry says the rehearsal was
green, so it was skipped at the start and the time went into the hunt. Type checks and both unit suites
first, clean at 556 backend and 622 app. (A fresh container has no `node_modules` on either side; without
both installs, eight app test files cannot find React and it reads like a regression.) Coverage named the
readers' own price helpers as the last untested thing in the newest code: Rezdy's `priceOfSlot` and
`rateLabel`, Peek's, Resova's and TripWorks', with only Xola's tested. That is the one number and the one
word printed under a shop's name, so this run read all of them, and then read what happens to that number
after the reader hands it over.

**Found and fixed.**

- **A whale watch quoted the child's fare with the word Adult beside it** (`f87eab63f`). TripWorks publishes
  one price per slot, `min_price`, which is the cheapest ticket on sale at that time, plus the customer types
  the shop sells. `priceOfSlot` named the price when exactly one non-concession type was left standing after
  the child and senior fares were filtered out, which on an ordinary Adult and Child sheet is one type: the
  slot was quoted at the child's $48 under the name "Adult", against a real adult fare of $58. Its own
  comment says the name is only safe when the shop sells exactly one visible kind of ticket, so it counts
  every visible type now. A concession fare under an adult's name is worse than an unlabelled one, because
  nothing on the card tells the guest to look again. The reader had no test of any kind and has eight now.
- **A bus tour's $790 whole-booking total was quoted to two people as the price of a seat** (`94caf382c`).
  Rezdy publishes group rates in the same list as per-head fares with nothing to tell them apart, so
  `priceOfSlot` keeps every `priceOptionType: "GROUP"` option out of the headline. It kept that decision in a
  local, and `plan.ts` picks a headline again out of `rates` once it knows the party, which is the only place
  that knows it. Black Hills Tour Company's "Group from 1 to 2 ($790.00 total)" has a minimum of one and a
  maximum of two, so it admits a party of two on every party test there is, and the $790 went back on the
  card and into the comparison line above it. A rule one module enforces and the next one undoes is not a
  rule: the mark rides on the rate now, the rate stays on the sheet where a guest can read it, and `forParty`
  became `headlineForParty` at module scope so it can be tested at all.
- **A dolphin cruise was quoted at $15 for a ticket Peek never named** (`65ccf7ce4`). Nine places in the
  concierge independently called a nameless fare "Ticket", and two rules ride on that word: it is not worth
  printing on a card, and a row nobody named cannot be shown not to be a child fare, so it must never
  outrank a named one. `tripworks.ts` calls the second one the rule everywhere else in this codebase and
  `peek.ts` applies it, heading a cruise with its named "Adult" at $26 rather than an unnamed $15 row.
  `headlineForParty` picked purely on price, so it put the $15 back with our own placeholder printed as its
  name. The word is a constant in `live.ts` now with both rules beside it, and every reader spells it there.
- **A whole-boat Xola charter was quoted to four people as $599 each** (`5c1bc2cb1`). Same defect as Rezdy's,
  one vendor over: `ticketsOf` refuses to head a card with `priceType: "outing"`, and a charter carries no
  party limits to fail, so every party fit it and the re-pick put the boat back as a seat. Two more things
  reached a card the same way, both found while fixing it. A reader's own `priceLabel` says where a number
  came from rather than what the ticket is called, so checkfront's "on their booking page" and the browser
  agent's "from their booking page" matched no rate label and were thrown away to relabel a price that had
  not moved; the re-pick leaves a departure alone now when it lands on the reader's own number. And Resova,
  Peek, Xola and FareHarbor could all put the placeholder itself in `priceLabel`, so a card read
  "$41 · Ticket".

**Checked and sound.** Rezdy's `rateLabel` against every label shape Rezdy publishes, including the
single-rate product whose whole name is its price and the "2-8 Players" its old looser age rule misread.
Every reader's `num`: a zero is not a price on any of them, and Rezdy alone reads a quantity of zero as no
limit rather than a rate nobody fits. Resova's slot price beating the item's teaser, and Peek's per-ticket
rows beating the slot's sum of every ticket type: both still right, both now the reason their readers can be
trusted where the surfaces disagreed with them.

**Green after the fixes.** 53 rehearsal steps, 0 failed, run twice because these commits touch `backend/src`
and `src/lib`. 575 backend tests, 622 app tests, both type checks clean (`-p tsconfig.app.json` for the app).

**Needs Harshil.**

- **Peek's and Resova's price sheets still have no test of their own.** Both were read closely this run and
  the bug the reading found is fixed, but Peek's JSON:API payload (program, configuration, activity, ticket,
  availability-dates, availability-times) is a large stub to build and it was not built tonight. Peek is 257
  links, the biggest vendor after FareHarbor, so it is the next thing worth a night.
- **Rezdy's helpers are tested directly rather than through `rezdyLive`.** Cloudflare blocks `fetch` on every
  `*.rezdy.com` subdomain, so that reader speaks HTTP/2 by hand and there is no `globalThis.fetch` to stand
  in front of. A hand-rolled HTTP/2 session would be a hundred lines of fake to reach two pure functions.
- **Last night's three are unchanged:** the "All requests" link parked off screen on a phone, the Bookings
  `minWidth` living on the element rather than in `operator.css`, and five category accents under the AA
  floor.

## 21 September 2026, forty-seventh run (09:00 to 10:05 UTC)

**Checked, and why.** Nothing landed after the forty-sixth run's log and that entry says the rehearsal was
green, so it was skipped at the start and the time went into the hunt; it was run twice at the end instead,
because these commits touch `backend/src`. Type checks and both suites first, clean at 575 backend and 622
app. Coverage named Peek's and Resova's readers as the last two with no test of any kind, and the
forty-sixth run called Peek, at 257 links, "the next thing worth a night". Reading them for the price sheet
turned up something one floor up instead: the window.

**Found and fixed.**

- **A guest asking about tonight was offered tomorrow morning, by every reader but FareHarbor** (`9d57bac1b`).
  `windowFor` answers "tonight", "today" and "tomorrow" with one day, and a window of one day is that day.
  `fareharborLive` counts its last day that way and its own comment says why; the eight readers written
  after it never got the fix. Peek, Xola, Rezdy and Acuity asked for `addDays(start, days)`, Resova looped
  `i <= horizon`, TripWorks fetched `getInDateRange/<start>/<start + days>`. It is worse in the readers than
  it was in FareHarbor, because each stops at the first day with something free: a shop sold out tonight did
  not come back empty, it came back with tomorrow, so `plan.ts` never widened, never set `widened`, and the
  answer never said the date had moved. Where one activity had tonight and another had tomorrow the card
  drew no date at all, because `WebConcierge` prints its day line only when every time on the card shares
  one: the guest saw "7:00 PM" and "9:00 AM" side by side and could tap either. The rule is `lastDayOf` in
  `shopday.ts` now. A vendor asked for a range is still asked a day wide, because nothing here can prove
  whether Peek, Xola or TripWorks read their end date as inclusive and asking short would cost a guest the
  last evening of their own window; the days used are filtered to the window, where being exact is free.
- **Square was asked about tomorrow from the hour the guest asked** (`062bc0c4d`). Square is the one vendor
  asked in instants, and an instant window is wrong at both ends. It ran `horizon * 86400_000` forward from
  the question, which is the day-too-far above, and it began at `start`, which `windowFor` builds as "now,
  plus a day": a guest asking at eight in the evening about tomorrow had Square asked about tomorrow from
  eight in the evening, so a spa with a free ten o'clock came back with an empty diary. That reads exactly
  like a shop that is fully booked. The window is a pair of calendar days on the shop's own clock now, asked
  a day wider at each end and kept to the window by date, because a zone is up to fourteen hours off this
  machine's. `windowStart` still never opens in the past, which Square rejects outright.
- **A shop shut tonight was offered on a day up to a fortnight away** (`19d907fb4`). The Checkfront driver
  took no window at all: it walks forward to whatever day an item next runs, which answers "when could we
  come" and not "escape room tonight". `plan.ts` already had the window and passed only its first day, so it
  passes `days` now. Both fourteen-day questions inside the driver stay fourteen days, because neither is
  what a guest is offered: the range query is how the next open day is found, and the control date a
  fortnight out is what proves the account answers per date rather than publishing an opening-hours grid.

**Checked and sound.** ForeUp alone among the readers already counted its days right. Resova's slot price
beating the item's teaser, which is half of it; the concession rule on Resova, Peek and Checkfront; a hidden
pricing category, a blocked slot and a sold-out one; `peekRef`, `resovaAccount` and `squareRef` against every
link shape in the catalog. FareHarbor is unchanged and was the reference throughout.

**Green after the fixes.** 53 rehearsal steps, 0 failed, run twice. 599 backend tests (up from 575), 622 app
tests, both type checks clean (`-p tsconfig.app.json` for the app).

**Needs Harshil.**

- **Peek's and Resova's price sheets have tests now, but no live vendor does.** This address cannot reach
  `book.peek.com` or `fareharbor.com` at all: the egress proxy refuses the CONNECT outright. Every reader is
  still tested against a payload shaped by hand, so a vendor that has quietly changed its JSON reads here as
  a shop with nothing open and nothing would say so.
- **`GET /concierge/live/:domain` is a public route that lies about seven vendors.** `liveFor` still tries
  only FareHarbor and Resova while `plan.ts` reads nine, so a Peek shop is told "no feed to read" there and
  quoted live in the agent; `bookingUrlFor` beside it carries a fifth copy of the vendor list naming three
  vendors, which is the exact duplication `readable.ts` exists to prevent and already has `unreadableSql`
  for. No surface calls the route today, which is why it was left rather than fixed blind.
- **Rezdy's window fix is the one here with no end-to-end test.** Cloudflare blocks `fetch` on every
  `*.rezdy.com` subdomain, so that reader speaks HTTP/2 by hand; `lastDayOf` is tested directly instead.
- **Last night's three are still unchanged:** the "All requests" link parked off screen on a phone, the
  Bookings `minWidth` living on the element rather than in `operator.css`, and five category accents under
  the AA floor.

## 21 September 2026, forty-eighth run (10:00 to 11:05 UTC)

**Checked, and why.** Every area the brief lists as priority territory is already down as verified, so the
hunt went to the Coverage list's own open items. Four of them name one thing: the programmatic pages, the
3,004 under `/p/` and the 11,545 under `/l/`, which are the only part of the product a customer meets before
the app loads and which no run has ever driven. Nothing had landed since the forty-seventh run's log and that
entry says the rehearsal was green, so it was skipped at the start; both type checks and both suites first,
clean at 599 backend and 622 app. It was run twice at the end instead, because every commit here touches
`backend/src`.

**Found and fixed.**

- **A page declaring 6,902 listings handed a crawler 24 of them** (`325f38d1b`). The grid stops at MAX_CARDS
  and `itemListElement` stops with it; `numberOfItems` was still the whole count. "Museums in the US and
  Canada" published an ItemList saying it held 6,902 entries and then listed 24, and 313 of the 3,004 pages
  carried that contradiction. The human version had no answer at all: the lede said 6,902, the page drew 24
  cards, and nothing said why or where the rest were. The list counts what the list holds now, the h1 and the
  FAQ keep the real total because that is a fact about the place, and a line under the grid names the gap and
  the two ways on. Counts in the prose are grouped too, so "1638 of the 6902 operators" and "from $5 to
  $5,000" stop being two conventions in one sentence.
- **All 14,549 pages built for sharing previewed as a bare URL** (`250a827c0`). Not one `og:` or `twitter:`
  tag between them, so a listing pasted into iMessage, WhatsApp, Slack or a Discord channel previewed as
  onoutset.com and nothing else: no business name, no photo, no line about it. The app's own `index.html` has
  carried the tags since it was written, so the generated pages were the only ones without. One `socialCard`
  serves all three page shapes, with the page's own lead photo through the wsrv.nl proxy at the 1200x630 every
  scraper crops to, the app icon and the small card where there is no photo to stand behind, and always the
  canonical url rather than the hash route.
- **389 pages had no link into them from anywhere on the site** (`cce9905ca`). A town page is reached from its
  metro page's pills, a sibling town that ranks it in its nearest twelve, or another kind in the same town. A
  town whose metro never qualified for that kind, with no sibling near enough and nothing else to do in it,
  was reached by none of them: a crawler met `bike-in-springdale-ut.html` in the sitemap and nowhere else.
  Museums lost 127 pages that way, fishing 38. The all-metros page's heading always said "by city" and the
  list under it held only the 47 metros; it holds the towns too now, which puts every page two hops from
  `p/index.html`. The generator's header claims every internal link points at a page written in the same run,
  and the new test reads that back the other way.
- **3,049 listing descriptions were cut in the middle of a word** (`4614a3eef`). `slice(0, 300)` on the
  operator's blurb: "The guide shares favorite fishing spot", "Inferno Hot Pilates, Vi". Already what a search
  result printed, and the fix above makes it what a friend sees in a link preview. `clip` takes a sentence end
  in the last third of the allowance and otherwise the last whole word with an ellipsis.

**Checked and sound.** Every internal link on all 3,004 pages points at a page the same run wrote, and all
3,004 are in `sitemap-pages.xml`. No duplicate titles, no description over 183 characters, no unparseable
JSON-LD on any of the 11,545 listing pages, no rating published without a review count behind it, no page
without an h1. The canonical tags and the localhost guard behind `publicSite`.

**Green after the fixes.** 53 rehearsal steps, 0 failed, run twice. 607 backend tests (up from 599), 622 app
tests, both type checks clean (`-p tsconfig.app.json` for the app).

**Needs Harshil.**

- **263 listing page titles run past 70 characters**, which is where Google starts truncating, because the
  title is the business's own name plus its town. Cutting a name is worse than a long title, so nothing was
  changed, but it may be worth dropping the town from the longest ones.
- **The pages still have no `og:image` of their own design.** A page with no usable cover falls back to
  `apple-touch-icon.png`, which is a 180px square icon and will render as a small card. One 1200x630 brand
  image in `public/` would fix every such page at once.
- **The all-metros page for museums is now 66 KB** (from 39 KB) because it carries 308 town pills, and the
  whole set is 52.1 MB (from 47.9 MB). That is the price of the orphan fix. If it matters, the alternative is
  paging those pills rather than dropping them.
- **Last night's four are still unchanged:** the "All requests" link parked off screen on a phone, the
  Bookings `minWidth` living on the element rather than in `operator.css`, five category accents under the AA
  floor, and no live vendor has ever answered anything from this address.

## 21 September 2026, forty-ninth run (11:00 to 11:40 UTC)

**Checked, and why.** Every area the brief names is already down as verified, so the hunt went to the Coverage
list's own open items and picked the one that is a defect rather than a question: `GET /concierge/live/:domain`
reading two vendors where the concierge reads ten. That opened into a theme worth following, which is which
booking link we read for a shop and which reader we are then willing to point at it. Nothing had landed since
the forty-eighth run's log and that entry says the rehearsal was green, so both type checks and both suites
came first (clean at 607 backend and 622 app) and the rehearsal was run once at the end, because every commit
here touches `backend/src`.

**Found and fixed.**

- **Seven of our nine readers could not be reached from the route that reads one shop** (`74d56dc7b`).
  `liveFor` tried FareHarbor, then Resova, then gave up, so a Peek, Xola, Rezdy, Acuity, Square, TripWorks,
  Checkfront or ForeUp shop was told "no feed to read: this one needs the browser agent" while `plan.ts`
  quoted its real departures from the same link. The dispatch that knows all ten lived in a closure inside
  `plan.ts`; it is `readFeed.ts` now and both callers share it. `bookingUrlFor` beside it was the other half:
  it ordered a shop's links by a hand-written list of three vendors, the fourth copy of exactly the list
  `readable.ts` exists to abolish, so a shop holding a Xola link and its own hand-built page got the page. It
  asks `readerFor` now, in JavaScript rather than SQL, because `%checkfront%` also matches a shop whose own
  domain carries the word and a link that only looks readable would beat a FareHarbor one.
- **A shop that published its own booking page before we found its calendar showed a guest guessed times**
  (`42afb8dce`). Both queries behind `GET /availability/:operatorId`, which is where the listing page gets
  real departures, took `LIMIT 1` with no ORDER BY. SQLite answers that in rowid order, so the older
  hand-built page won, `vendorFor` returned null, and the page fell back to our generic nine, eleven and one
  for a shop whose calendar was one call away. `live.ts` counted thirty-eight operators in that state and
  fixed its own copy of the query; this copy, the one a guest meets, kept the bug.
- **Every reader named its own vendor through a cast** (`e30dd9232`). `const VENDOR = "foreup" as
  LiveRead["vendor"]` is an assertion, not a check, and "foreup" was never a member of that union. A reader
  that misspelled itself would have compiled and reached a guest as "their forup calendar". The union carries
  it now, the eight casts are gone, and a test walks `READER_VENDORS`: every vendor the router can return has
  a branch in `readFeed` to call and a written name.

**Checked and sound.** The reader list, the SQL twin of it and `vendors.ts`'s detection are otherwise in
step. `live-index.json` ships 1,664 links and every one is FareHarbor (1,371), Peek (239) or Xola (54), which
is the set `availability.ts` can read, so the published index and the route agree.

**Green after the fixes.** 616 backend tests (up from 607), 622 app tests, both type checks clean, 53
rehearsal steps, 0 failed.

**Needs Harshil.**

- **The listing page can only ever show live times for three vendors, while the agent reads ten.** Both
  `live-index.json` and `enrich/availability.ts` stop at FareHarbor, Peek and Xola, and that file has its own
  readers rather than the concierge's. So a Resova, Rezdy, Acuity, Square, TripWorks, Checkfront or ForeUp
  shop is quoted live in Agent Mode and shows guessed nine, eleven and one on its own page. Wiring the
  concierge's readers into that route is a piece of work, not a bug fix, so nothing was changed.
- **A vendor that answers with nothing open still leaves the guessed times up**, which was already on the
  list. Worth sharpening: the data can tell the two cases apart. A day the vendor covered with no slots at
  all is a day the shop is closed; a day carrying only a `timeUnknown` marker is Peek's call budget, not a
  closure. Treating the first as closed is safe and would need the three surfaces to take a three-state
  answer from `liveChipsByDate`.
- **`feedIsWarm` knows only FareHarbor and Resova company names**, so the other eight vendors are always read
  as cold and get the 12 second deadline rather than 5. That costs latency, never correctness.
- **`outset-api` still builds with no catalog**, confirmed in `render.yaml`: no `fetch-seed.mts`, so the
  deployed concierge answers every town with "could not find". `render.yaml` is outside the files these runs
  may change.
- **Last night's four are still unchanged:** the "All requests" link parked off screen on a phone, the
  Bookings `minWidth` on the element rather than in `operator.css`, five category accents under the AA floor,
  and no live vendor has ever answered anything from this address.

## 22 September 2026, fiftieth run (04:40 to 06:00 UTC)

**Chosen, and why.** The brief's own areas are all down as verified, so the hunt took the highest thing on
Coverage's open list that is a defect and not a question: a vendor that answers with nothing open leaving the
listing page showing our guessed nine, eleven and one. That is the worst thing on the page, because a guest
can book one of those times at a shop that is not open. Nothing but a docs commit had landed since the
forty-ninth run's log, and that entry says the rehearsal was green, so the rehearsal was skipped at the start
and run at the end instead, once after each commit that changed something it drives. Type checks and both
suites came first, and the backend suite was already red.

**Found and fixed.**

- **The backend suite was red on a clean checkout, and nothing was wrong** (`fa4f9f20d`). The window test in
  `concierge/__tests__/live.test.ts` named 21:00 on 2026-09-21 in Toronto and a departure at 22:30 that
  night. `departed()` reads the real clock, so from 22 September that departure had left, the reader correctly
  dropped it, and the suite reported a bug that was not there: 615 of 616. The dates come off a UTC midnight
  three days out now, which keeps what the test is for without naming a day.
- **A shop with nothing open for a fortnight was painted over with our own nine, eleven and one**
  (`63714168e`). `GET /availability` answers for every date in the window and has always said which of three
  things a date is: times we read, a date the vendor covered and named nothing bookable on, or an open date
  whose clock times the call budget never reached. The pickers read only the first, so "no times on any date"
  reached them as "no live feed" and both drew the published times over a calendar they had successfully
  read. A guest could book a nine o'clock at a shop whose own system says it runs nothing that fortnight.
  `live` now means the vendor answered, and an empty picker says which of the three cases it is. Two answers
  that looked complete and were not now say they are partial, since an empty window has become a statement
  about the shop: a Peek read that reached two of a shop's five activities, and a FareHarbor fortnight
  straddling two months with one of them answering.
- **Otto read out published hours beside a calendar it had read and found empty** (`c08eb9b2f`). Beside a
  picker correctly offering nothing it said "Open Monday 9 AM to 5 PM, pick a time on this page", and to
  "when's the next opening" it said "I can't see their live times, but they open today at 9 AM" about a
  calendar it had just read. All three answers say what the calendar says now, and a partial read still says
  nothing.
- **Otto answered its own chip with the wrong question, and another with none** (`271f55c4b`). "When's the
  next opening?" is one of the chips it offers, and the hours rule claimed it, reading "when ... opening":
  tapping it came back "They haven't published opening hours" at a shop with two o'clock free that
  afternoon. "Any other rules?", also its own chip, said none of the words the entry-rules rule looks for, so
  it came back "I'm not sure what you mean". And a bare "what are your hours?" had nowhere to land at all,
  because every hours rule wants a day, a time or the word open: the plainest hours question there is got the
  same "I'm not sure what you mean. I can answer prices, hours, what's included ...", which names the thing it
  just failed. It reads out the published week now, days that share a span said once. The test walks the chips
  themselves and the chips each answer hands back, on a full shop and a bare one, which is how the second was
  found.
- **A shop with nothing open had all fourteen dates read out to a screen reader as sold** (`46d84c79d`).
  The phone calendar labelled a date with no start time "booked out", which was fair when only a sold-out day
  could be empty. It says nothing is open, which is true of a shut day and a sold one alike.
- **And the fix above, left alone, would have closed a claimed shop** (`0b0f9d374`). Both halves of this were
  found by reading the change back rather than by a test, and the second is worth writing down. An empty
  answer standing meant it stood over a claimed shop's own slots too, and the catalog may still hold a
  booking link from before that shop claimed: an empty fortnight on that stale calendar would have emptied
  the picker of a shop taking bookings here, and the operator would have watched their own listing offer
  nothing. The first guard written for that read "has the API given us slots?", which is wrong, because
  `GET /bookings/open` answers for an unclaimed listing too, with the same fixed times the page would
  otherwise guess: it would have handed every unclaimed shop its nine, eleven and one straight back and
  quietly undone the whole night. Both pickers read `claimed` first now, and the test reads that out of their
  source, because this rule is only as good as where its flag comes from.

**Checked and sound.** `feedIsWarm` knowing only two vendors, which Coverage has carried for two runs as a
latency cost, is not one: only FareHarbor's reads go through the cache in `live.ts`, so the other nine readers
are genuinely cold on every call and the 12 second deadline is the right one for them. Its Resova branch is
dead, though, for the opposite reason (see Needs Harshil). A vendor that cannot be reached at all still
answers `live: false` on every path in `enrich/availability.ts`, which is what makes the fix above safe: an
outage keeps the published times, and only a calendar we actually read can empty a picker.

**Green after the fixes.** 618 backend tests (up from 616, one of which was failing), 637 app tests (up from
622), both type checks clean, and 53 rehearsal steps with 0 failed on each of the four runs.

**Needs Harshil.**

- **A shop whose calendar we read and find empty now shows a guest nothing, on every date.** That is right,
  and it is a change in how the 1,664 listings whose calendar we can read look on a quiet week. The line reads
  "Nothing open in the next 14 days on their booking system." If you would rather it offered their own
  booking link at that point, that is a design call, not a bug.
- **`feedIsWarm`'s Resova branch never fires.** It reads the account name out of a Resova link and then looks
  for it in the cache in `live.ts`, which only FareHarbor writes to. Resova does keep its session, so a second
  read of the same account really is warm and gets the cold deadline anyway. One line, and it wants the
  session map to say so rather than the response cache.
- **Last night's five still stand:** the listing page reading only three of the ten vendors, `outset-api`
  building with no catalog, the "All requests" link parked off screen on a phone, five category accents under
  the AA floor, and no live vendor having answered anything from this address.

## 22 September 2026, fifty-first run (06:15 to 06:50 UTC)

**Chosen, and why.** Every area the brief names is down as verified, so the hunt went to the top of Coverage's
open list: the listing page reading three of the ten vendors the agent reads. That turned out not to be a fix
(see Needs Harshil), so the run went at the least-read code in the repo instead, which is last night's own five
commits, four hours old. Nothing but a docs commit had landed since the fiftieth run's log, and that entry says
the rehearsal was green, so the type checks and both suites came first (clean, 618 and 637) and the rehearsal was
run twice at the end rather than once at the start. It found that the work the fiftieth run did on Otto could
never run at all.

**Found and fixed.**

- **Otto never saw the booking calendar the page beside it had already read** (`3ebaca9a`).
  `CompanyContext.live` is the whole of what the assistant knows about live availability: `liveSlots` reads it,
  the "When's the next opening?" chip is only offered when it holds a departure, and a window the vendor covered
  and named nothing in is the one thing that stops Otto reading opening hours out over a shut calendar. Nothing
  ever filled it in. All three places that build a context passed the item and the contact record and stopped,
  so every one of those rules was dead code in the product, the two the fiftieth run landed included. A guest
  asking "anything Saturday?" at a shop whose booking system the box on the same page had already read was
  answered out of the published week. The comment above `fetchAvailability` has said for weeks that "the booking
  box, the phone sheet and the assistant" all ask for the same dates; two of them did. Otto answers
  synchronously out of the reducer, so `availabilityNow` is the answer that has already arrived, keyed by
  listing and expiring on the same five minutes. The operator's own test chat gets it too, since that page
  promises in its own comment to run the same code guests get.
- **And it would then have closed a claimed shop that is taking bookings here** (`140de0d6`). The exception
  `liveWins` makes for both pickers: a claimed shop sells its own hours on GoDo minus what is booked, and the
  catalog may still hold a booking link of theirs from before they claimed. Asked "can I book?" at such a shop
  Otto would have said "not in the next 14 days: their booking calendar has nothing open in it" while the picker
  two inches away offered that shop's own two o'clock.
- **Otto told a guest to book on a page whose owner had switched bookings off** (`6c263518`).
  `bookingPaused` is the rule both pickers read, and it is why a paused listing shows "Not taking bookings right
  now" where its Reserve button was. Otto read neither flag it is made of, so beside that panel it answered
  "Yes. Pick a service and time on this page and they confirm it", and a listing the owner had taken down said
  the same. Three answers were telling a guest to pick a time here. The times are still true and the shop may
  still be selling them itself, so what the answer corrects is "on this page", in the words the page uses, with
  the shop's phone number.
- **Every Resova shop was read as cold, however recently it had been read** (`16dcafa4`). Last night's open
  item. `feedIsWarm` read the account out of the link and then looked for it in the response cache in `live.ts`,
  which `getJson` there writes and therefore FareHarbor alone: the branch could never fire, and `plan.ts` gave
  every Resova read the twelve second deadline. What actually makes the second read quick is the shop's own
  Angular shell, kept for the life of the process in `resova.ts`, so that is what is asked.

**Checked and sound.** Otto's day names and day-of-week filters are built from noon local, so a live date cannot
slide a day. `slotLine` prints a seat count only when it is real. The remaining "Outset" strings in `src/` are
all comments: every name a guest or an operator reads says GoDo.

**Green after the fixes.** 647 app tests (up from 637), 619 backend (up from 618), both type checks clean, and
53 rehearsal steps with 0 failed on both runs.

**Needs Harshil.**

- **The listing page reading ten vendors is not a dispatch change, and wiring the concierge's readers in as they
  stand would be worse than the guessed times.** Worth writing down properly, because it has been on the list
  three nights as "a piece of work". Every one of those readers is shaped for a shortlist, not a calendar: they
  stop at the first day with something free (`xolaLive`, `resovaLive`, `squareLive`, `foreupLive` say so in their
  own comments), take at most six starts on it, and ask at most four to six of the shop's items. Answers like
  that dropped into `GET /availability`, where an empty date now means the shop is shut, would show a guest one
  open day and thirteen "nothing open in the next 14 days" at a shop open every day. The work is a whole-window
  mode in each reader. The second half is small and separate: `live-index.json` publishes only FareHarbor, Peek
  and Xola links, so on the API host, which has no facts table, the other seven shops have no booking link to
  read at all, and that filter should be `readable.ts`'s own list rather than a fourth hand-written copy.
- **`liveSlots` has no seats guard where the pickers have one.** `liveTimes.ts` drops a departure with no seats
  left and calls it "the belt on the braces"; Otto now reads the same payload and has no such line. All three
  readers in `enrich/availability.ts` already refuse to emit a zero, so nothing is wrong today, and two surfaces
  reading one payload by different rules is the kind of thing that stops being true quietly.
- **Last night's five still stand:** the listing page reading three of the ten vendors (above), `outset-api`
  building with no catalog, the "All requests" link parked off screen on a phone, five category accents under
  the AA floor, and no live vendor having answered anything from this address.

## 22 September 2026, fifty-second run (07:10 to 08:30 UTC)

**Chosen, and why.** Every area the brief names is down as verified, so the hunt went to the top of
Coverage's open list, which was the one item there shaped like a defect rather than a question: `liveSlots`
having no seats guard where both pickers have one. That turned out to be the smallest of four rules Otto was
missing, and pulling the thread found the one a guest actually feels. Nothing but the fifty-first run's own
log had landed since that entry, and it reports a green rehearsal, so the type checks and both suites came
first and the rehearsal was run at the end instead, twice, once after each batch of commits that touches code
it drives.

**Found and fixed.**

- **Otto offered a guest this morning's departure at eight in the evening** (`e5b351da`). `liveSlots` read the
  same `GET /availability` answer the booking box beside it reads, by its own twelve lines rather than through
  `liveTimes.ts`, which is the one reader both pickers use. Four of that reader's rules were missing. The clock
  is the one that shows: the window opens on today and today's departures come back whether or not they have
  left, which is why both pickers put `bookableStart` over the top and cut off everything under an hour out on
  the shop's own clock. Otto had no clock at all, so it answered "Next open time is Sunday 9:00 AM" for a boat
  that sailed eleven hours ago, printed beside a picker correctly showing the day as done. It also offered a
  departure the vendor says is sold out, read out a row whose clock we could not parse as though it were a
  start time, and quoted a price of nothing as "$0". `liveWindowEmpty` and the "When's the next opening?" chip
  both key off the same list, so a shop whose last departure of the window had already left read to Otto as
  open for business. That one asks the calendar now rather than the filtered list, because a day that is over
  is not a shut fortnight, and it stays quiet on a window of dates the vendor calls open and whose times the
  call budget never reached, which is the rule `liveEmptyNote` already keeps for the picker.
- **The operator's test chat asked their booking system for a different window than their guests did**
  (`0263fbed`). The Assistant page's whole promise, in its own comment, is that the test chat "runs the same
  code guests get". It took `fetchAvailability`'s wider 14 day default while every guest surface asks for the
  ten days the booking window covers, so a shop with nothing in the next ten days and a departure on the
  twelfth had Otto naming that opening to the operator testing it and telling their guest the calendar was
  empty. Two windows also miss the shared request cache, which is keyed by window, so the same answer was
  fetched twice. One exported `BOOKING_WINDOW_DAYS` now, read by both, and the wiring test asks for it.
- **Otto answered "Tuesday" both for tonight and for a departure a week away** (`aef4da4e`). `slotLine` named a
  departure by its weekday and nothing else, and the window is ten days, so on a Tuesday the same six words
  were the answer for an eleven o'clock tonight and for one on Tuesday week. Today and tomorrow have their own
  names now, the next five days keep the bare weekday, which says which day on its own, and anything from a
  week out carries its date.

**Checked and sound.** The phone sheet's and the desktop card's own live branches both apply `bookableStart`
per date, so neither picker had the fault Otto had. `enrich/availability.ts` refuses to emit a zero seat count
or a zero price on all three readers, so two of the four rules above were belt on braces rather than live
today; the clock and the day name were not. Peek marks any answer partial when the budget leaves a date
untimed, which is what had been masking the unread case.

**Green after the fixes.** 655 app tests (up from 647), 619 backend, both type checks clean, and 53 rehearsal
steps with 0 failed on both runs.

**Needs Harshil.**

- **A fresh checkout of this repo has no root `node_modules`, and the app suite is red without it.** Eight test
  files fail with "Cannot find package 'react'" until `npm install` is run at the root as well as in `backend/`.
  Nothing is wrong with the code, but a run that takes the first red as a finding loses its night to it, and
  the rehearsal installs nothing itself. Worth a line in the brief or a check in the rehearsal.
- **Otto and the pickers now agree, and nothing makes them stay that way.** Three of tonight's four rules were
  invisible because `liveTimes.ts` was the only reader that knew them. The test added tonight compares Otto's
  answer against the picker's own first chip, which catches a drift in one direction; the other direction, a
  new rule landing in `liveTimes.ts`, is still on whoever writes it.
- **Last night's five still stand:** the listing page reading three of the ten vendors, `outset-api` building
  with no catalog, the "All requests" link parked off screen on a phone, five category accents under the AA
  floor, and no live vendor having answered anything from this address.

## 22 September 2026, fifty-third run (08:15 to 09:35 UTC)

**Chosen, and why.** Every area the brief names is down as verified, so the hunt went to Coverage's open
list and took the item there shaped like a defect a customer feels rather than a question: which clause on a
policy owns the number the Free cancellation badge prints. Five commits had landed since the fifty-second
run's entry and all of them touch `src/`, so the brief's rule (b) applies and the rehearsal was run too. It
turned out to be red on `main` already, which is the first thing below. A sixth, the claim-outreach email
rewrite, arrived mid-run and this work is rebased on it, with both suites and the rehearsal run again after. The fifty-second run's note about
`node_modules` is confirmed: a fresh checkout has none at either level, and `npm install` at the root as well
as in `backend/` is the first thing a run has to do.

**Found and fixed.**

- **The rehearsal read a hidden listing's phone booking box off the desktop page** (`2fd042b1`, `03a9e39e`).
  `main` has been red since `4d9cd321` removed "Open the phone app" from the desktop user menu last night.
  Step (c2b) reached the phone frame by clicking that button, and with the button gone the click found
  nothing and the flow stayed on the wide site. The step went on passing anyway: the desktop page also says
  "This listing is hidden right now" and has no `.airreserve` button on it at all, so both halves of the
  check were satisfied by the wrong page. Only (z), which collects every control a helper reached for and did
  not find, noticed. A narrow window is how a phone reaches the frame now, and because `web` is decided once
  at mount the size is set before the page loads, from the home rather than the listing's own hash: the step
  before it is already on `#o=<id>`, and navigating to the same URL is a same-document navigation that never
  remounts the app. The frame itself is asserted now, so a step that never leaves the wide site says so.
- **A listing's Free cancellation badge printed the window the shop charges in full at** (`13e206ec`). The
  badge is a promise about money, and its number was the first "N hours" or "N days" anywhere in the policy,
  whichever clause it sat in and whichever side of that clause's line it was on. 141 of the 1,303 shipped
  badges took it from a clause that was not the promise, and the damaging direction is the common one:
  o-archangelcharters-com advertised 24 hours off "Charters cancelled within 24 hours will result in a
  forfeited deposit" while its refund needs 48, o-bigtexboatrentals-com advertised 9 days off a $100 fee line
  while its full refund needs 15, and o-blazenh-com read its window off a $15 late-cancellation penalty. The
  promise owns the number now, and inside its sentence the one before it wins, because that is how a shop
  writes a rate card. Where no promise names one, the first window a guest could actually cancel in does, one
  claim at a time, so o-boatnaples-com's "you will be notified 2 hours prior to departure, with a full
  refund" is read as the captain telling the guest rather than a window to cancel in. A window sold with a
  protection plan is not the free one. Weeks and months are read now, as are "15+ Days" and "3 or more days".
  `freeCancelBadge` also re-reads the text rather than trusting the stored `fc`, which its own comment
  already claimed it did: it only ever reached the fresh reading for the 22 listings carrying no `fc`, so
  every later fix to this rule stopped at the catalog and waited on a sync to reach a guest. Over the whole
  shipped catalog no badge appears or disappears, 58 gain a window they did not have, 79 change the number,
  and 50 fall back to a bare "Free cancellation" rather than state one the policy does not support. Twenty
  eight changed listings were read by hand against their own policy text before this was committed.
- **A listing's own page promised a cancellation window its app page does not** (`d314c3cb`). The 11,545
  static pages under `/l/` print their cancellation line straight off the stored `fc` and never went through
  the badge rule at all, so one of them advertises free cancellation the app strips outright, and after the
  fix above they would have disagreed with the app on 171 of the 1,237 pages that take their line from `fc`.
  The page reads the same rule now and falls back to the shop's own policy text where there is no promise.

**Checked and sound.** Every other reader of `fc`: the feed card, the listing page, the booking sheet, the
venue row and the "Free cancellation" filter all go through `freeCancelBadge`, and a claimed shop's own typed
policy goes through the same `freeCancel`, so one rule now decides the badge everywhere. Otto answers a
cancellation question from the shop's own policy line first and only falls back to `fc` when there is no text
to read, which is right. An unclaimed shop open past midnight: `statedDay` refuses a day whose close is not
after its open, so a wrapped night reads as a day the site says nothing about rather than a closed one, and
`startTimesOn` caps the tail at midnight on purpose.

**Green after the fixes.** 662 app tests (up from 655), 621 backend (up from 619, one of them the outreach rewrite's own), both type checks clean
(`-p .` at the root still checks nothing, `-p tsconfig.app.json` is the one that checks the app), and
53 rehearsal steps with 0 failed.

**Needs Harshil.**

- **The badge's existence is a separate rule from its window, and it is looser.** o-hottubboats-com publishes
  "Cancelations within 48 hours forfeit deposit and full charge applies Operator may cancel within 2 hours of
  rental for bad weather with full refund" and carries the badge: the only refund named is the operator's own
  weather call, but `onlyOperatorCancels` needs an "if" or a "due to" in front of it and this shop states it
  flat. Teaching it to read "Operator may cancel" was tried and reverted here: it drops three badges that are
  real (o-broadmoor-com's "48-hour cancellation policy for full refund", o-sailsurfadventure-com's "We offer
  free cancellation within 48 hours of booking", o-windroseoutdoor-com's "we require at least 24 hours
  notice") for the one it fixes. Worth a night of its own rather than a guess.
- **"We have a 24 hour cancellation policy" reads as the shop's own call.** `THEIRS` matches `we` within 20
  characters of `cancel`, which o-charlestonsupsafaris-com's own sentence satisfies, so its window is dropped
  rather than printed. That regex is load-bearing for `onlyOperatorCancels` and was left alone.
- **Last night's five still stand:** the listing page reading three of the ten vendors, `outset-api` building
  with no catalog, the "All requests" link parked off screen on a phone, five category accents under the AA
  floor, and no live vendor having answered anything from this address.

## 22 September 2026, fifty-fourth run (09:15 to 11:05 UTC)

**Chosen, and why.** Two commits landed after the fifty-third run's entry, `feda5a21` and `c3ac54f9`, and both
touch `src/`, so the brief's rule (b) applies and the rehearsal was run, on `main` first (53 passed, 0 failed,
so `main` was green before this run touched anything) and again at the end. `feda5a21` rewrote the first load
of a claim link a few hours ago, which makes claiming the one area Coverage calls verified that a commit has
since changed, and it is the least covered path in the repo by construction: the rehearsal enters the
dashboard through the test bypass, so a real `#claim=<id>&k=<token>` link has never been opened in a browser
here. So this run went there, and then at the question that commit raises for every other link we mail: what
else changes when a link is merely opened. A v2 link minted with the rehearsal's own `CLAIM_SECRET` was driven
in Chromium against the rehearsal's API and site, 18 checks over three scenarios, kept in the scratchpad
rather than the repo.

**Found and fixed.**

- **A claim link's token left the address bar before the owner had claimed anything** (`cd995fa2`). The confirm
  screen that now stands between a claim link and a recorded claim went up with the token already stripped
  out of the URL: `tick()` cleaned the hash the moment the token checked out, which is one screen too early
  now that nothing is recorded until a person clicks. Driven in a browser: an owner who reloads that screen,
  or comes back to a tab the phone discarded, lands on the "Your bookings, the way they come in" pitch for a
  listing nobody has claimed, with the one-click way in gone from their own address bar and only the email to
  go back to. `AppProvider` already says the claim hash "should survive a refresh until the claim is done",
  which is now what happens: one `cleanClaimHash()` runs after the claim is recorded, on the click and on a
  return visit through the link alike. The same screen drew its card from `picked`, which waits on a catalog
  version bump rather than on the record the confirm is about, so it could ask an owner to hand over a
  business it did not name; it draws `pendingClaim.u` now.
- **Opening the unsubscribe link took the shop off the list, before anybody asked** (`170fdc84`). The same
  mistake as the claim link, one link away in the same email: `GET /unsubscribe` recorded the unsubscribe and
  then said "You are unsubscribed", so anything that opens that URL takes the address off the list, a
  link-safety scanner and a recipient clicking to see what the link says alike. The cost is quieter than a
  claimed listing and worse: the shop lands on the suppression list, no outreach reaches it again, and
  neither side ever learns why. The GET asks now, names the address, and carries one button; `POST` is
  untouched, so Gmail one-click and the site's own page keep working, and one click still takes an address
  off, which is what CAN-SPAM and CASL ask for. The address is escaped into the page, because the token
  carries it as base64 and a crafted link decodes to whatever it likes.

**Checked and sound.** Every other link our mail puts in front of a scanner: the booking and decision emails
carry only listing URLs, the claim email's other link is the dashboard, `#remove=` in the outreach email only
opens a screen (`removeId`, nothing written), and `#paid=` is Stripe's own return and never emailed. Sign-in
is a typed code, not a magic link. The confirm screen itself, driven: a load claims nothing and does not open
the dashboard, the click records the claim with the owner off the link and links that address for sign-in,
"Not my business" leaves with the hash cleared and nothing claimed, and a forwarded link opened on a second
device with a different address still asks, still lets that person in, records them in `alsoClaimedBy`, and
warns them in the dashboard that somebody claimed it first. `POST /claims/:id/exchange` records no claim, so
the scanner that walked in tonight got a session and nothing else.

**Green after the fixes.** 666 app tests (up from 662), 625 backend (up from 621), all three type checks clean
(`-p .` at the root still checks nothing, `-p tsconfig.app.json` is the one that checks the app), and the
rehearsal at 53 of 53 both times.

**Needs Harshil.**

- **`public/unsubscribe.html` is still the half of this that a shop actually meets.** `unsubPageUrl` puts
  `https://onoutset.com/unsubscribe.html?t=...` in every outreach email, and that page POSTs the API on load
  with no click at all, so a gateway that renders JavaScript, or a recipient who opens the link to read it,
  is opted out silently and permanently. The fix is the shape the API now has: draw a button, POST on click,
  three lines in that file. It was left alone because `public/` is outside the paths this run may change.
- **Last night's five still stand:** the listing page reading three of the ten vendors, `outset-api` building
  with no catalog, the "All requests" link parked off screen on a phone, five category accents under the AA
  floor, and no live vendor having answered anything from this address. The fifty-third run's two cancellation
  questions stand too.

## 22 September 2026, fifty-fifth run (10:15 to 11:50 UTC)

**Chosen, and why.** No commit landed after the fifty-fourth run's entry, and that entry reports the
rehearsal green at 53 of 53, so neither of the brief's two reasons to re-run it applied and it was skipped at
the start; the type checks and both unit suites were run instead, clean at 666 app and 625 backend. Every area
the brief lists is already under Coverage, so rather than re-read one, this run went looking for a guest-facing
fact no sweep had ever touched. Counting what the 59,125 shipped detail files actually carry found four:
`ytVideos`, `videoEmbed`, `waiverUrl` and `season`. The first two turned out sound. The season did not, and
pulling on it led to two larger faults in how a shop's own prose reaches a guest at all.

**Found and fixed.**

- **A seasonal shop's season vanished from its desktop page and became a heading on a phone** (`1b2b12a6`).
  The desktop put it in the grey run of facts under the subtitle and dropped anything over 32 characters, so
  491 of the 1,144 shops that publish a season said nothing about it there: a guest can pick a January date on
  a charter whose own site reads "May 16 - October 31" and never be told. The phone sheet had the opposite
  fault and printed whatever it was given as the bold title of a key-fact row, so the same shops turned a
  228-character paragraph into a heading with "Season" in small grey type under it. Both now read one rule
  (`seasonFact`): a short phrase is a fact and sits where a fact goes, which is 161 more shops than the old cap
  allowed, and a sentence is printed as the sentence it is, under a label.

- **Markdown a shop wrote reached the guest as markdown** (`2f487403`), on the listing page, the phone sheet
  and the booking confirmation alike. Nothing between the crawl and the page took the syntax back out, so 54
  lines across the catalog shipped with it in: Big M Marina offered "FAQs [Read our full list of FAQs
  here.](https://www.rental.bigmmarina.com/faqs)", Disney's Boat Rentals gave its check-in address as "Check in
  Location## [2200 Lakeshore Blvd, Lakeport CA, 95453](https://share.google/...)", and Holoholo Charters' whole
  arrival note read "Connect with Holoholo Charters [![TikTok](https://". `stripMarkdown` is the rule and both
  funnels crawled prose passes through call it. A link keeps its words, an image none, a heading marker goes,
  and so does a bracket the 400-character cut left open. A closed bracket is untouched: 20 lines use one for a
  conversion ("-15F [-26C]"), and a hash that numbers a slip is not a heading. 54 lines before, 0 after.

- **A shop's own prose was cut mid-word on every budget but the landing pages'** (`b1d15869`). 762 listings
  ship an extraNote cut at 700 characters inside a word ("...another trip of equal or greater valu"), 65 a
  cancellation policy cut at 400, 4 an FAQ answer, 3 an arrival note. That line is the last bullet of "Who can
  go" or "Safety and waiver", and the arrival note is on the confirmation. `listingPages.ts` already owned the
  right rule, written when `slice(0, 300)` cut 3,049 landing pages the same way; it moves to `lib/clip.ts` and
  now serves every budget. Its missing guard was a third bug: three places hand-rolled the cut as
  `slice(0, n).replace(/\s+\S*$/, "")` and ran the replace unconditionally, so every vendor description
  shorter than its budget lost its last word. Dogpatch Paddle publishes "Beginner, Youth, Performance, and Dog
  Friendly Rentals" and we shipped it without "Rentals". The Peek test had frozen that output as the
  expectation, so it is corrected with the reason beside it.

**Checked and sound.** Videos a guest is shown: no shipped listing carries a `ytVideos` entry at all, and all
1,148 `videoEmbed` URLs are proper `youtube.com/embed/` or `player.vimeo.com/video/` addresses, so nothing
renders as a refused frame today. Every one of the 1,844 waiver links is an absolute public http URL that
`safeHttpUrl` accepts.

**Green after the fixes.** 680 app tests (up from 666), 631 backend (up from 625), all three type checks
clean, and the rehearsal run at the end at 53 of 53, against a local Postgres and the Chromium on disk.

**Needs Harshil.**

- **766 of the truncations are waiting on a sync, not a crawl.** The extraNote and FAQ cuts are assembled at
  sync time, so `npm run sync` puts those listings right with no crawling at all. The 65 cancellation and 3
  arrival cuts are baked into stored facts and only a re-enrich of those shops clears them.
- **35 waiver links open a homepage, not a waiver.** A guest is told "Opens the operator's waiver form" and 7
  of them land on a waiver vendor's own marketing site (`smartwaiver.com`, `gymwaiver.com`, `waiversign.com`),
  1 on a different business altogether (Buffalo Waterfront's points at `longboardsbeach.com`), and the rest on
  the shop's own front page with no anchor. `contacts.ts` already refuses a bare SmartWaiver `/w/`, so the
  precedent is there, but telling a shop's own waiver portal from its homepage is a supply judgement, not a
  rule I could write honestly. Worth a look at the list.
- **Two latent inconsistencies, 0 listings today.** Otto says "the link on this page lets you sign before you
  arrive" and the phone's key facts say "Sign the waiver online" on `waiverUrl` being set, while the link
  itself is gated on `safeHttpUrl`, so a shop with an unusable one would be promised a link the page does not
  draw. And `isSafeEmbedUrl` checks an embed's host but not its path, so a `youtube.com/watch?v=` URL would go
  into an iframe YouTube refuses to render.
- **Last night's stand:** `public/unsubscribe.html` still POSTs on load, the listing page still reads three of
  the ten vendors, `outset-api` still builds with no catalog, the "All requests" link is still parked off
  screen on a phone, five category accents are still under the AA floor, and no live vendor has answered
  anything from this address.

## 22 September 2026, fifty-sixth run (11:10 to 11:50 UTC)

**Chosen, and why.** No commit landed after the fifty-fifth run's entry and that entry reports the rehearsal
green at 53 of 53, so neither of the brief's two reasons to re-run it up front applied and it was skipped at
the start. The container was a fresh checkout with no `node_modules` on either side, which is the fifty-second
run's standing Needs Harshil: both installs first, then the type checks and both suites, clean at 680 app and
631 backend. Every area the brief lists is under Coverage already, so this run counted the shipped catalog for
a guest-facing field no sweep had driven and found one: `addons`, which is the tickbox column of the booking
box and the one menu list read out of a shop's prose rather than off its menu. Pulling on it led into the
money path twice.

**Found and fixed.**

- **The add-ons box offered a guest half a sentence with a price beside it** (`02cdfc65`). Add-ons are not read
  off a menu the way services are: the crawl keeps any line on the shop's own page that ends in money and
  splits it at the dollar sign, so every sentence about a charge became a row a guest could tick and be billed
  for. 365 of the 3,825 shipped add-ons, one in eight, across 431 listings: "Lost or damaged bikes will incur a
  cost of" at $1,000, "This internship includes a stipend of" at $3,000, "Get Delivery with orders of" at $50
  where the $50 is an order minimum and not a price, "5 Holbrook, Tips were reported at an average of" at $100.
  There is nothing honest to rename those to, because the half in front of the money is a penalty, a minimum or
  a job advert as often as an extra, so `bookableAddon` drops them the way the archive rows beside it are
  dropped. Only add-ons are read out of whole sentences, so only add-ons are dropped for it: a service row's own
  trailing word is still trimmed and the row kept, which is what the 93 shops with "Tickets are" on their menu
  need, and the rule takes 3 rows out of 76,279 options. 120 more rows were a real name wearing the bracket its
  price came out of ("Digital photo package (", "S'mores kit (additional"); those keep their name.

- **A booking was priced from the file behind the menu, not the menu** (`0827fda4`). The app runs `bookableMenu`
  over every record it loads and that rule renames a row as well as dropping one, while the booking route read
  the crawled file raw. `priceBooking` matches the name the guest sent, so a renamed row matched nothing, and
  with more than one priced row on the listing there is no single price to fall back on: the booking was stored
  with no price and no card was charged. A $5,700 private charter at o-napaliriders-com, a $780 pontoon at
  o-boatelmers-com and a $275 boat tour at o-customboattoursandrentals-com, each filed under the shop's own
  phone number in the file and without it on the page, and the 38 extras the bracket fix above would have
  joined to them. Both sides call the one function now.

- **Two extras sharing a name were charged at the first one's price** (`484ea4a3`). Names are matched on letters
  and digits alone, so "Digital photo scan < 200 DPI" at $5 and "> 200 DPI" at $15 are one name to the server,
  and a pool's extra lifeguard is $35 on one row and $70 on another. 18 shipped listings carry such a pair, and
  a guest shown $35 was charged $70. This is the fault two service tiers sharing a label already had, fixed the
  same way: the guest's own total says which they meant, so the sums the listing's published prices allow are
  tried against it and the tier and the extras are resolved together. With no total, or one that matches no
  combination, the first row is charged exactly as before.

**Checked and sound.** Markup left in the words a guest reads, swept again over every prose field now that the
fifty-fifth run's `stripMarkdown` ships: 96 lines carry a bold marker, 254 a blockquote and 145 a rule, all of
them inside a service description, and 10 rows carry an HTML entity in their name. Every one reaches the page
through `plainWords` or `tidyLine`, which decode and strip, so none of it is drawn. The 24 review authors
stored as `<strong>Gerald E.` are already refused by `shownReviews`. Running add-on names through `plainWords`
as well was measured and dropped: it would change 14 of 3,460 and make several worse ("Jet Ski" to "Jet ski").

**Green after the fixes.** 686 app tests (up from 680), 640 backend (up from 631), all three type checks clean,
and the rehearsal run at the end at 53 of 53 against a local Postgres 16 cluster and the Chromium on disk.

**Needs Harshil.**

- **A shop's "from" price can be its cheapest anything.** `from` is the minimum over every priced option, so
  the Detroit Zoo's card reads "From $2" for a stingray touch, Country Club Lanes reads "From $3" for shoe
  rental, and Bell Harbor Marina reads "From $2.15", which is a moorage rate per foot of boat. Big Choice
  Brewery's whole menu is food, so it advertises a $2.99 side salad. Whether a card's headline should be the
  cheapest bookable experience rather than the cheapest row is a product call, not a rule I could write.
- **8 or 9 shipped prices are a discount read as a price.** HopFusion Ale Works offers "Monday-Thursday Happy
  Hour" at $2 off a pour and we sell it at $2; Cow Key Marina and Key West Boat Rentals sell a six hour
  do-it-all package at $20 because the page said "$20 OFF When You Book Direct"; Heliflights sells a private
  helicopter tour at $65 off. Telling a discount from a price needs the page the number came off, which only a
  re-crawl has.
- **Last night's stand:** `public/unsubscribe.html` still POSTs on load, the listing page still reads three of
  the ten vendors, `outset-api` still builds with no catalog, the "All requests" link is still parked off
  screen on a phone, five category accents are still under the AA floor, and no live vendor has answered
  anything from this address.

## 23 September 2026, fifty-seventh run (05:15 to 06:40 UTC)

**Chosen, and why.** Every area the brief names is down as verified, but nine commits landed after the
fifty-sixth run's entry and they carry a whole new kind of listing a guest can see: affiliate products, the
partner rows from Viator and Tiqets that are shown under licence and booked on the partner's site. Nothing
had swept them, and they arrive in the catalog wearing an ordinary listing's clothes, so this run read every
guest and operator surface that meets one. The container was a fresh checkout: both installs first, then the
type checks and both suites, clean at 689 app and 674 backend. The rehearsal was run at the end rather than
the start, because those commits touch `backend/src` and `src/`, which is the brief's second reason to run it.

**Found and fixed.**

- **A partner's product was offered as a request, and as a business to claim** (`c0f65001`). The card and
  reserve card added with the feature know about partners; five other surfaces did not. The phone card badged
  a Viator product "Guest favourite" or nothing, and with no from-price said "Request to book", a request
  nobody ever receives; the desktop card, the compare table's From row and the listing page's nearby cards
  said the same, and the compare table told a guest to "Contact the business" that never took the booking.
  The listing page offered "Work here? Manage this listing" on a partner's product, and the claim screen's own
  business search found partner products, so an owner could pick one and walk into "we have no email on file
  for this business". Otto is now off from the one field that always travels: the sync writes
  `assistant: false` into the detail file only, so a card, a rail and a page's first paint held a record with
  no such key and read the assistant as on.

- **The API took a booking for a partner's product** (`c7dd2fc3`). Affiliate listings are published into
  `public/o` with every other listing, so `POST /bookings` read one as an ordinary shop: an id in a link, or
  any client that is not our page, stored a booking row for a Viator product and sent the founder a "call the
  shop" alert for a business that never sold it, with nobody to email, no slot to hold and no price on the
  record. It answers 409 and says where the experience is booked. The listing file is read before the profile
  now, so the refusal lands without touching Postgres, which is what lets the new test drive the real route
  with no database.

- **A guest was told how far away a partner's product is** (`6ed5c90b`). Viator files every product at the
  centre of the destination it named and Tiqets at the metro's, so the coordinate on a partner row is one
  point shared by every product in that city. The two cards and the phone sheet printed "2 miles away" off it
  for a dock that could be twenty, and the generated `/l/` page published it as the listing's own
  GeoCoordinates. The distance lines fall back to the city the product is filed under; the page publishes no
  geo; the rails still rank by it, where city grain is all a rank needs.

**Checked and sound.** The partner rows themselves: `assistant: false`, empty options, no claim key, an id
that starts `a-` so no operator path matches it, and outreach reading the operators table, which they are not
in. The link on every surface carries `rel="sponsored noopener noreferrer"` and the commission is said beside
it. The booking box draws no start times for one, and the picker, the pay step and the Otto panel are all
behind a time nothing can set.

**Green after the fixes.** 693 app tests (up from 689), 677 backend (up from 674), both type checks clean, and
the rehearsal at 53 of 53 against a local Postgres 16 cluster and the Chromium on disk.

**Needs Harshil.**

- **A partner's price is quoted in the partner's currency and printed as dollars.** Both pulls ask for CAD in
  Canadian metros and store the currency, and `toAffiliateItem` drops it, so a Toronto product priced at
  CAD 120 reads "From $120" on a card that sits beside US prices. The same blending the comparison line
  already does, but here it is a number we quote against a partner page that will show something else.
- **A partner's rating shows with no written reviews under it**, which is the standing question for rated
  listings generally, and every partner row is rated.
- **Last night's stand:** `public/unsubscribe.html` still POSTs on load, the listing page still reads three of
  the ten vendors, `outset-api` still builds with no catalog, the "All requests" link is still parked off
  screen on a phone, five category accents are still under the AA floor, and no live vendor or partner API has
  answered anything from this address: every affiliate check here ran against rows shaped by hand.

## 23 September 2026, fifty-eighth run (06:20 to 07:50 UTC)

**Chosen, and why.** Every area the brief names is verified and nothing has landed since the last entry except
that entry, so this run went to the open list, where several separate items sat on one surface: the Hours block a
guest reads on an unclaimed listing. That is the brief's first area and it is what almost the whole catalog is,
since 14,810 shipped listings publish hours and 59,061 of them are unclaimed. The container was a fresh
checkout, so both installs first: 693 app and 677 backend green, both type checks clean, which matches the last
entry, so the rehearsal was not run to start with. It was run at the end instead, because this run changed code
it covers, and re-run after each fix that landed behind it.

**Found and fixed.**

- **166 listings advertised a site builder's placeholder as round-the-clock hours** (`65ba7de2`).
  `coversWholeDay` in `openNow.ts` already refuses to read "12:00 AM - 11:59 PM" and "12:00 AM - 12:00 AM" as
  opening hours, because that is what a page's markup carries when the owner never set any, so the open-or-closed
  line says nothing at all for all 166 operators that publish one. The Hours block on the same screen said the
  opposite: 182 lines, helicopter tours and jet ski rentals reading "Mon-Sun 12:00 AM - 11:59 PM", a closing time
  none of them ever stated. Same rule now, so the day keeps its honest gap. A shop that says "24 Hours" in words
  keeps its line, and a real span that only touches midnight at one end is still a real span.

- **The static `/l/` page printed the hour lines exactly as the crawl stored them** (`13ae08be`). 893 of the
  12,901 pages with an Hours block named something different from the app page they link to, 41 of them in
  OpenStreetMap's own syntax (`Su off; Mo "by appointment"; Tu-Fr 09:00-16:30`), the rest with the quote marks,
  the zero-width spaces, the "Hours of Operation" headings and the days the crawl ran onto the end of the time
  before them. It is the page a search engine indexes and a shared link opens first. It reads `displayHours` now,
  the way it already reads `freeCancelBadge`; `isTradingHoursLine` moved into `hoursText.ts`, which imports
  nothing, so the sync can reach it, and `openNow` re-exports it so no caller changed.

- **Three shapes of OpenStreetMap rule were never read into words at all** (`4865c97d`). A rule was only read
  when its rest was exactly a 24 hour span, so 36 listings got the syntax as written: a span the syntax names one
  end of rather than clocks ("Mo-Su 07:00-sunset", the golf courses and driving ranges), a span the shop said
  more after ("Su 13:30-16:00 or by appointment", the galleries and libraries), and a rule opening with the
  months or the date it applies to ("May-Oct Mo-Sa 09:00-16:00", "Jan off", "Dec 25 off"). Syntax leaking to a
  guest goes from 44 lines across 36 listings to 6 across 6. A season is now the shop's own fact rather than
  dropped: o-casteelsculptures-com publishes "Apr-Dec Mo-Sa 09:00-17:00" and its whole week was being thrown
  away, and o-osm-way-686716941's winter closure now reads "Nov 01-Feb 28 Sun-Mon Closed". Every one of the
  14,810 listings with published hours was diffed before and after: no line and no block was lost.

- **38 lines still wore the heading the crawl swept up with them** (`0276728d`). "Schedule Mon: 9:00 AM - 3:00
  PM", "Open Hours Mon-Thu 8am-5pm", "Store Hours Mon Closed", "Time: 5:00pm - 7:30pm". The strip already there
  wanted the word "Hours" and a space after it, so it missed every one of them, "Hours:Monday - Friday" included.
  50 listings read better, and three stop printing the same week twice, because the heading was the only thing
  telling the duplicate apart. The punctuation strip runs on both sides of the headings now: a calendar emoji in
  front of "Schedule Mon" is what kept o-3palmszoo-org's heading on the line, and o-alhambragolf-com's is stored
  as "of operation? The course is open 6:00 AM - 11:00 PM", where the question mark is only reachable once the
  heading in front of it is gone. Whose hours they are is a fact, so "Office hours" and "Park Hours" stay: the
  office and the park are not the same door as the boats.

- **A landing page promised a search engine hours that 157 listings do not show** (`e0e51277`). The FAQ answers
  "Do the listings show opening hours?" with a count, and the count asked only whether a listing carried an
  hoursText line at all, not whether anything is printed from it. It asks the same rule the page that prints
  them asks now. A compact week on its own still counts, since a lite record carries one when the lines
  themselves were left behind.

**Checked and sound.** The em dash 10 shops write into their own hours, o-angryinchbrewing-com between each day
and the time beside it, is their punctuation and is left alone. The 121 listings writing a bare 24 hour range in
their own words ("FRI 12:00 - 6:00") are their own sentences, not the syntax. The 33 lines that look like an address or a link under Hours are all a
shop's own dated event ("Open October 3 @ 9:00 am - 2:00 pm"). The whole-catalog test that already holds the
printed lines against the week parser stays green, so what a guest reads and what the page books from still come
from one set of rules.

**Green after the fixes.** 696 app tests (up from 693), 679 backend (up from 677), the app type check clean and
the backend clean but for TS5097, and the rehearsal at 53 of 53 against a local Postgres 16 cluster on 5433 and
the Chromium on disk, re-run after every fix that landed behind it.

**Needs Harshil.**

- **An nth-weekday rule is read as every such weekday, which invents availability.** `Mo[1] 18:30-21:30` means
  the first Monday of the month, and both week parsers drop the `[1]` silently. 10 listings publish such a rule
  and 8 of them get a week wider than the shop: o-darkwhitegallery-com is shown open every Monday,
  o-ephist-org every Sunday and all year although it publishes "Jan off; Feb off", o-osm-way-1065345294 every
  Saturday rather than the second and fourth, o-woodburn-delaware-gov every Saturday rather than the first, and
  o-clarksvilleboats-com every weekend rather than late May to early September. They are small museums, a
  historical society, a gallery and a boat rental, so it is 8 shops rather than a wave, but the guest is shown
  "Open now" and offered start times on a day the door is locked, and the operator can only decline. Honouring
  the rule needs a date-indexed week, which `Week` and `StatedDay` cannot express, and dropping it instead is
  worse: the picker then falls back to six fixed times every day of the year. 6 of the 10 also still print the
  raw `[1]` to a guest, which is the only syntax left leaking anywhere. This is the one thing on the open list
  that is a bug rather than a question, and it needs your call on which way.
- **A season the page now states is wider than the times the picker offers.** The Hours block reads
  "Apr-Dec Mon-Sat 9:00 AM - 5:00 PM" for o-casteelsculptures-com, and the week parsers still drop the month
  prefix, so the picker offers the generous default it offers any shop with unknown hours, 7 AM included. 2
  listings. Teaching the week parsers the prefix is the mirror of this run's fix and is strictly less invention
  than the default in both seasons, but it is the same seasonal question as above.
- **Last night's stand:** a partner's price is still quoted in the partner's currency and printed as dollars,
  `public/unsubscribe.html` still POSTs on load, the listing page still reads three of the ten vendors,
  `outset-api` still builds with no catalog, the "All requests" link is still parked off screen on a phone, five
  category accents are still under the AA floor, and no live vendor or partner API has answered anything from
  this address.

## 23 September 2026, fifty-ninth run (07:15 to 08:35 UTC)

**Chosen, and why.** Four commits landed after the last entry, one of them the first catalog sync since the
18 September publish gate, so the catalog a guest reads is a different one: 48,198 listings where there were
59,125, with 1,873 Viator partner rows inside that. Both installs first, then the type checks and both
suites, which is how the red test below turned up. For new ground the open list had nothing on the words a
shop writes for the day itself, so this run took the fields nobody had counted: the arrival note, the meeting
point and the sentences the page glues together around them. The rehearsal was run because the new commits
touch `backend/src` and `src/`, and again at the end after every fix.

**Found and fixed.**

- **106 shops said where to meet and how early to be there, and the guest was shown nothing** (`f0bea80c8`).
  A shop's check-in note is the only arrival line Outset ever shows, on the listing page, the phone booking
  sheet, the confirmation and in Otto's answer to "what time is check-in". The rule that kept a sign-off out
  of it tested the front of the whole note, so a note opening with a greeting was dropped entire: "Meeting
  location: Pier 39, Gate I", "please arrive at the dock 45 minutes prior to sailing time", "We meet under the
  white tent behind the GoldBelt Tram building" and 103 more went unread. The same rule printed 19 notes that
  were only courtesy, because its list was short and "thank\b" never matched "Thanks": "When you arrive" read
  "We're looking forward to seeing you!", "YOU'RE ALL SET!", "Like us on Facebook!" and "Check out our
  website!". The courtesy now goes sentence by sentence and only when that sentence says nothing else, so
  anything naming a time, a place, a waiver or a person to call keeps it. 546 notes are shown where 459 were,
  108 of them shorter. `8dac445ed` adds the other end of it: what was left of one note was "Capt.", the front
  of a name the crawl cut, and one word is not an arrival note.

- **Six lines lost their first word and read as a different sentence** (`b7c500fcf`). `tidyLine` takes a page
  heading off the sentence the crawl glued it to, which is what makes "Cancellations Cancellation requests
  received at least 48 hours before" readable. It compared the two words with a trailing s off both, and "As"
  with its s off is "a", so every line opening "As a" was cut: "A reminder, it is customary to tip your crew",
  "A boat rental business, cancellations can be very costly", "A reminder, your booking includes one hour on
  the boat at dock in Port Dalhousie". They print on the policy, cancellation and included columns of both
  guest surfaces. The plural allowance now needs a word of at least four letters behind it. The rule moved to
  `listingDerive.ts` as `unglueHeading`, where a sweep over the catalog can hold it.

- **The only red test on main, and it failed the rehearsal with it** (`c284dee69`). The sweep holding every
  priced row against the price the server charges guarded itself with "listings > 50000", the catalog's size
  the day it was written. The publish gate took the catalog to 48,198 and the sweep went red although its own
  finding was still green. It now asserts what it means: every .json in `public/o` was read, and the catalog
  is at real scale.

**Checked and sound.** All 3,189 shipped meeting points, through `tidyLine` on both surfaces: no markdown, no
URL, no email, no cut bracket, and the 37 that say the place varies say so in the shop's own words. The
1,873 partner rows against the `Unclaimed` shape: every field they leave out is optional, so no surface reads
a missing key. Every guest-visible line the heading rule fires on, before and after, over the whole catalog.

**Green after the fixes.** 705 app tests (up from 696) and 681 backend, which is 681 of 681 where it was 680
of 681. Three more commits landed upstream while this run was working, so the tree that was pushed reads 694
backend tests; both suites, both type checks and the rehearsal were re-run on it. The app type check is clean,
the backend clean but for TS5097, and the rehearsal is at 53 of 53 against a local Postgres 16 cluster on 5433
with SSL and the Chromium on disk.

**Needs Harshil.**

- **The sync published 10,927 fewer listings than the last one and nothing says which.** 59,125 went to
  48,198 under the publish gate ("listings nothing was ever read from are off"). That is your own call and the
  covers went up with it, but it is a tenth of the catalog leaving in one commit, and the only thing that
  noticed was a test floor. A line in the sync's own output naming the count it dropped, and why, would make
  the next one legible.
- **66 arrival notes still say nothing a guest would act on.** Most are real things a shop says at booking
  time (what payment is taken, what is included, what to wear) and are worth keeping. A handful are not:
  o-egmontadventurecentre-com's whole note is "Tax ID 135320711", o-adventuresbythesea-com's is "Your
  Adventure Starts Here!", o-bricktownwatertaxi-com's is "Looking for a dinner recommendation?". Telling a
  slogan from a fact is a supply judgement rather than a rule, and each of these is one shop.
- **Last night's stand:** the nth-weekday rule is still read as every such weekday on 8 shops, a season in
  front of a rule still widens the picker on 2, a partner's price is still quoted in the partner's currency
  and printed as dollars, `public/unsubscribe.html` still POSTs on load, the listing page still reads three of
  the ten vendors, `outset-api` still builds with no catalog, the "All requests" link is still parked off
  screen on a phone, five category accents are still under the AA floor, and no live vendor or partner API has
  answered anything from this address.

## 23 September 2026, sixtieth run (08:15 to 09:15 UTC)

**Chosen, and why.** One commit landed after the last entry, `449ee4536`, and it touches
`backend/src/discover` and nothing a guest reads. Both installs, both type checks and both suites first; the
rehearsal with them, because that commit is inside `backend/src` and the rule for running it says so. It came
back 53 of 53, so nothing was re-verified on its account and the rest of the run went hunting. Every area this
run's brief lists is already on the Verified list below, so the new ground was picked a different way: the
seam between the lite record the phone paints from and rules written for a full one. A lite row carries no
menu, no policies, no hours and no contact, and the sweep asked which rules answer anyway rather than staying
quiet.

**Found and fixed.**

- **A $1,000 event space priced per group read "From $1,000 / person" on the card a guest taps**
  (`9cb6e8139`). The phone feed card and the phone booking sheet printed "/ person" beside a from price
  whenever they had no option to read the unit off, and every lite record ships `options: []`, which is every
  card in that feed. So 2,509 of the 10,217 priced listings in the shipped catalog advertised a unit their own
  menu contradicts: o-2flyus-com's $450 balloon ride priced per hour, o-2lagooncharters-com's $450 trip priced
  per trip, o-1000islandswatertours-com's $175 private boat tour priced per hour, o-2226studio-com's $1,000
  event space priced per group. `perPerson` defaults to per person when an option's own words say nothing,
  which is the right default for an option in hand and no default at all for having none. Both phone surfaces
  now print a unit only when the option that set the price is there to say so, which is what both desktop
  surfaces already did.

- **A Viator tour was told to ring itself about its own cancellation terms** (`3fc792b55`). The phone booking
  sheet knows a partner's product is booked elsewhere where it matters, in the dates section, the reserve bar
  and Otto's gate. Three other places still drew one as a shop of ours, on all 1,873 partner rows, none of
  which states a requirement, a policy or a cancellation line: "Hosted by Fraser Valley Social Wine Tasting
  Private Tour", which names a tour as its own host; "Who can go" and "Waiver and check-in" both reading
  "Contact the business to check", on a sheet that draws no contact block for a partner row; and, under the
  "Free cancellation" badge the same screen carries from the partner's own flag, "Contact Fraser Valley Social
  Wine Tasting Private Tour for their cancellation terms before you book". The host line is a shop's alone
  now, a Things to know row with nothing of ours to say is not drawn, the section stays out when none of them
  has anything, and the cancellation row points at the partner. The desktop listing page builds no Things to
  know columns at all for one of these, so this is the phone agreeing with it.

**Checked and sound.** The card's other reads off a lite row: the Free cancellation badge, which finds no
policy text and falls to the `fc` the sync wrote, as designed; the compact week behind "open now"; the compact
deal; the rating, the distance and the thin flag. All 1,873 partner rows for a cover, an area carrying its
region, a from price and a duration that starts with a number: none missing, none malformed, and the 33 titles
past 70 characters are the partner's own product names. Every partner row ships exactly one photo, which is
the shape 13,315 ordinary listings ship too. The claimed and instant flags, which no shipped row carries at
all. `money` against the fractional partner prices (`$467.50`, never `$467.5`). The concierge's own "per
person" default, which is deliberate and set by each vendor reader rather than assumed.

**Green after the fixes.** 713 app tests (up from 706) and 697 backend. The app type check is clean, the
backend clean but for TS5097. The rehearsal is 53 of 53 against a local Postgres 16 cluster on 5433 with SSL
and the Chromium on disk, run before the hunt and again after both fixes.

**Needs Harshil.**

- **The phone card now prints no unit where it used to print one, on the 7,708 priced listings whose cheapest
  option really is per person.** Being silent is honest and is what both desktop surfaces do, but the card
  could say it again if the lite shard carried the unit: `buildLiteShard`'s row already works out the cheapest
  price, so one boolean beside it would do. The rule that decides it, `perPerson`, lives in
  `src/lib/catalog.ts` and the sync has no copy, and writing a second one is the twin-rule mistake this repo
  has been bitten by before. Moving it to a module both sides import is your call, and it only reaches a guest
  after a sync.
- **Last night's stand:** the nth-weekday rule is still read as every such weekday on 8 shops, a season in
  front of a rule still widens the picker on 2, a partner's price is still quoted in the partner's currency
  and printed as dollars, `public/unsubscribe.html` still POSTs on load, the listing page still reads three of
  the ten vendors, `outset-api` still builds with no catalog, the "All requests" link is still parked off
  screen on a phone, five category accents are still under the AA floor, the sync still does not say which
  10,927 listings it dropped, and no live vendor or partner API has answered anything from this address.

## 23 September 2026, sixty-first run (09:20 to 11:05 UTC)

**Chosen, and why.** Two commits landed after the last entry. `38d4067c8` is discovery output only. `932782d90`
is the night's real change: the Viator detail pass finished and the pull went from 40 to 160 products per metro,
so the catalog went from 1,873 partner rows to 6,492 and every one of them now ships the partner's own
requirements, inclusions and cancellation text. That is the one line on the Not yet checked list that stopped
being hypothetical while we slept, so it is where this run went: the words those 6,492 rows put in front of a
guest, and the rules that were written when a partner row carried none of them. Installs, both type checks
and both suites first; the rehearsal because `src/` moved, run once as a baseline and once on the finished
tree.

**Found and fixed.**

- **A phone's iOS version was printed as "Ages 15+" on 22 self-guided tours** (`822bd2fad`). `minAge` reads an
  age word beside a number first and falls back to a bare "N+", because that is how a shop most often writes
  the rule ("Adults only 18+"). The fallback took the first "N+" anywhere in the line, whatever it counted, and
  three surfaces print what it returns. So 55 shipped listings advertised an age nobody published: "Supported
  devices: iPhone with iOS 15+" on 22 tours, "Additional Cost For Groups Of 7+ Passengers" on 19 charters,
  "Groups of 4+ may be split into multiple helicopters" on 5 flights, "cannot walk 3+ miles" on a walking tour,
  a reschedule window of "15+ days" on a boat rental, "USTA rating 3.5+" on a tennis club. The number has to be
  counting years now. Four more listings move onto an age their shop really published.

- **A guest read "you will receive a full refund.\<br\>If you cancel" on 60 partner listings** (`e6e967dcd`).
  `plainWords` is the one funnel every crawled and partner line goes through, and it took markdown out but not
  markup. Viator writes a refund policy as one paragraph with breaks between its tiers, so the tag arrived as
  its own characters on the desktop page, in the phone sheet and out of Otto's mouth. Six operators' service
  descriptions carried their own editor's leftovers with it: a Word paste, a WordPress date template, and two
  TinyMCE bookmark spans that were the whole of one camp's "In Program" description. 99 strings read
  differently and none loses a word.

- **A street art tour opened its description "\*\*SPRING-SUMMER-FALL\*\*"** (`fd6fc509e`). The same funnel left
  the bold marker in. 253 lines across 149 listings carry a run of asterisks, markdown's or the shop's own
  decoration, and neither is words. A single asterisk stays: it is a bullet as often as an emphasis.

- **Twenty-five review cards went unsigned because the site bolded the name** (`21d3657d5`). The author slot
  ends at the first angle bracket, which is right for an Instagram link and a comment form's label and wrong
  for `<strong>Gerald E.`. The markup comes out first now, through the same rule, and the bracket test still
  runs on what is left.

- **A Viator tour with no stated terms would have been told to ring itself, on the desktop page**
  (`f8b6101ca`). Last night's fix taught the phone sheet that a partner has no business to ring; the desktop
  page needed none, because a partner row stated nothing at all. Now it states requirements, so the page builds
  its Things to know columns, and it was one field short of the same bug: with requirements and no cancellation
  its column reads "Contact the business for cancellation terms before you book". No shipped row reaches it
  today and Tiqets, Klook and GetYourGuide are the feeds that will. The column names the partner instead. The
  sweep in `partnerSheet.test.ts` asserted the old data fact and has been red on `main` since the detail pass
  landed; it asserts the standing rule now.

**Checked and sound.** The shape of all 6,492 partner rows: cover, area and its region, from price, metro, pin,
rating, review count, the partner id on every link, and that none is claimed, instant or assistant-on. Their
photo sets, which went from one photo each to eight for 4,402 of them: no duplicate, no size-variant twin, the
cover first every time, every URL HTTPS and on one host the CSP already allows. The `includes` split, which
already strikes a partner's "not included" line. Their cancellation, which every one of them states, so neither
surface reaches a fallback. 34 rows state no duration and print none.

**Green after the fixes.** 731 app tests (up from 713, and one that was red on `main` is green) and 697 backend.
`tsc -b` clean, the backend clean but for TS5097. The rehearsal 53 of 53 against a local Postgres 16 cluster on
5433 with SSL and the Chromium on disk.

**Needs Harshil.**

- **Viator files everything under "Who can go".** `additionalInfo` is the partner's mixed bag, so the column
  headed "Who can go" carries "Operates in all weather conditions", "Wheelchair accessible" and, on 73 rows,
  instructions for booking on TripAdvisor. It is the partner's own honest text under a heading of ours that
  does not fit it. A second column, or a different heading for a partner row, is your call.
- **A partner's "what is not included" is read and then dropped.** `detailFields` in
  `backend/src/affiliates/viator.ts` publishes `inclusions` and stores `exclusions` in the raw detail without
  ever putting them on a listing, so a guest sees what a tour includes and never what it leaves out, which on
  these products is usually gratuities, parking and hotel pickup. `splitIncluded` already draws a "not
  included" line struck through, so it is one field and a sync, but how much of a partner's text we reproduce
  under the licence is yours rather than mine.
- **A shop's minimum age is still read off whichever line names one first.** This run took out the numbers that
  were never ages. The ones that are an age but somebody else's remain: "Children must be accompanied by an
  adult (18+)" on a family fun centre, "Fishing license required for anglers 16+", "16+ can sign own waiver" on
  a shop whose floor is 14. Roughly 30 listings, and telling them apart is a judgement rather than a rule.
- **Last night's stand:** the nth-weekday rule is still read as every such weekday on 8 shops, a season in
  front of a rule still widens the picker on 2, a partner's price is still quoted in the partner's currency and
  printed as dollars, the lite shard still carries no unit, `public/unsubscribe.html` still POSTs on load, the
  listing page still reads three of the ten vendors, `outset-api` still builds with no catalog, the "All
  requests" link is still parked off screen on a phone, five category accents are still under the AA floor, the
  sync still does not say which listings it dropped, and no live vendor or partner API has answered anything
  from this address.

## 23 September 2026, sixty-second run (10:15 to 11:40 UTC)

**Chosen, and why.** Nothing has landed since the last entry but the entry itself, so the rehearsal's 53 of 53
still stood and re-running it to watch it pass would have bought nothing. Installs, both type checks and both
suites as the baseline instead, and the hour went to the one line on the Not yet checked list that is money in
front of a guest: the from price on a card, and what the cheapest row on a menu actually is. Every area this
run's brief lists as needing a first look is already on the Verified list, so the frontier is here.

**Found and fixed.**

- **A $950 deep sea charter read "$200" because that is what its deposit was** (`980c5496c`). 27 shipped rows
  publish a deposit as the price of the experience, and since a deposit is a fraction of the price, each one is
  also the cheapest row on its menu and so the from price on the card, the rail and the search result. Fin &
  Fly's five charters read $150 and $200 under names stating $300 to $1300, with "Deposit (up to 6 passengers)"
  beneath them. Skydive Chelan's tandem read $70 against a detail that shouts "NOT A TOTAL PAYMENT. A Tandem
  Skydive is $289 per person". Phoenix Skydive's read $9.95, its booking fee. All nine of Jersey Nutz's trips
  say "Deposit" in their own names. `implausiblePrice` already drops a number the site cannot have meant, but
  only the implausible ones: $200 on a $950 charter is perfectly plausible and simply is not the price, so the
  rule now reads the row's own words. The word alone proves nothing (a keg comes "with a refundable deposit", a
  jet ski advertises "no deposit required"), so it has to head the detail or name the row; a hold against
  damage and a row calling itself a fee keep their price. 28 rows that mention one keep theirs.

- **"4-Hour Sailfishing: $700" was published at $850, both numbers on one line** (`7c6aba2a4`). 15 rows name
  their own price and are sold at another, so the line answers itself twice: "Two Races (Adult Kart) $56" at
  $399, "Fort Myers- Whole Day Pass - $199" at $3, which was also that card's from price. `withoutEchoedPrice`
  strips a trailing figure that agrees, which is why only the disagreeing ones are still on a name: 59 of the 99
  rows carrying a figure agree. The name is the truthful half almost every time and is still not taken, because
  "$20,000 Maui JIM Grand Prix" is prize money and believing it would advertise a show jumping class at twenty
  thousand dollars. The number goes and the page says "Price on request". A figure that is the face value of
  something included keeps its row: "$10 Arcade Card" inside a $25.99 pass, "Value Card $200 Credit" at $160.

- **A fishing guide's own description read "salmon speciesâ€"Chinook"** (`91944306b`). Open since the
  twenty-first run. Four listings print a Windows-1252 byte read as UTF-8: Last Cast Guiding in a service
  description, Reel Deal on two review cards ("weÃ¢â‚¬â„¢ll be back in October", the same fault twice over), and
  two where the byte is already gone and a U+FFFD sits in its place, so a tag reads "O?Brien Pontoon Slide" and
  an option label "7 ? 12". `plainWords` decoded entities and never this. It repairs a run at a time, so a line
  that also carries an emoji or a Chinese name keeps it, and only replaces a run whose bytes are valid UTF-8,
  which is what tells mojibake from a word that is simply French. A lost byte between two letters was an
  apostrophe and between two numbers a dash; anywhere else it goes.

**Checked and sound.** The cheapest priced row of all 10,217 listings that have one, read against the row that
sets it. Every menu row in the shipped catalog that says "deposit", "retainer" or "booking fee" anywhere in its
name or detail, 55 of them, each one read to decide which half the number belongs to. All 99 rows whose name
states a dollar figure, against the price the row holds. Every string in every shipped detail file for a
decoding fault, through the funnel that carries it to a guest.

**Green after the fixes.** 736 app tests (up from 731) and 709 backend (up from 697). Both type checks clean but
for TS5097. The rehearsal 53 of 53 against a local Postgres 16 cluster on 5433 with SSL and the Chromium on
disk, run once on the finished tree because `src/lib/catalog.ts` is on every listing page's render path.

**Needs Harshil.**

- **114 rows name one length and show another.** "Private 2-Hour Sail" is shown as 30 minutes, "1-Hour Lea
  Island Excursion" as 5, "8-Hour Charter - Bimini Girl" as 2 hours, "30-Minute Sunset Ride" as 24. Every one of
  Elevated Wake Co.'s nine charters, named 1 to 6 hours, shows 1.5. This one is not fixable the way the price
  was, because the trap runs both ways: the label is junk at Milwaukee Kayak ("2-Hour Rental" shown as "5 to 10
  minutes", which is a walk from the car park), and the name is junk at Wet-n-Wild ("Pontoon Rentals - Departing
  3 Minutes from Crab Island", genuinely an 8 hour rental). Believing either half is wrong somewhere, and
  dropping the length off 114 rows to be safe is a bigger call than an overnight run should make. A list of all
  114 is one scan away whenever you want it.
- **The from price is still the cheapest row of any kind, and some of those rows are fees.** The deposits are
  gone, so what is left is a golf club advertising from $2 because that is its pull cart fee, a kart track from
  $2 for tire disposal, a marina from $2.15 which is a rate per foot of boat, and a bowling alley from $3 for
  shoe rental. This is the item already on your list (the Detroit Zoo's $2 stingray touch); the fee rows are the
  part of it that is clearly not a judgement, if you want a first cut.
- **Fin & Fly's sixth row still reads $200.** Its five charters all said "Deposit" and have given up their
  number. "Sea Burial/Ash Scattering $600" says nothing about a deposit, so it keeps the $200 its siblings
  proved was one, and it is now that shop's from price. One shop, and only a re-crawl settles it.
- **Last night's stand:** the nth-weekday rule is still read as every such weekday on 8 shops, a partner's price
  is still quoted in its own currency and printed as dollars, the lite shard still carries no unit,
  `public/unsubscribe.html` still POSTs on load, the listing page still reads three of the ten vendors,
  `outset-api` still builds with no catalog, the "All requests" link is still parked off screen on a phone, five
  category accents are still under the AA floor, Viator's `additionalInfo` is still filed under "Who can go",
  its `exclusions` are still dropped, and no live vendor or partner API has answered anything from this address.

## 23 September 2026, sixty-third run (11:20 to 12:30 UTC)

**Chosen, and why.** Nothing has landed since the last entry but the entry itself, so the rehearsal's 53 of 53
still stood and the baseline was installs, both type checks and both suites instead. Every area this run's
brief lists is already on the Verified list, so the hour went to the Not yet checked list, and to the two
lines on it that are a partner's own words reaching a guest wrong rather than a question: the `exclusions` the
detail pass fetches and the catalog drops, and the `additionalInfo` bag filed whole under "Who can go". 6,492
listings, 13% of the catalog, and the one surface where the text a guest reads is somebody else's.

**Found and fixed.**

- **A tour that does not feed you said so to Viator and not to a guest** (`a83c213a5`). `detailViator` has
  fetched each product's `exclusions` since the first pass and stored them under `raw.detail`, and
  `toAffiliateItem` read the inclusions sitting beside them and dropped the rest. So all 6,492 partner listings
  tell a guest what the price buys and none of them what it does not: the gratuity, the lunch, the park entrance
  fee and the hotel pickup that are theirs to pay are on the page they book on and nowhere on ours. Both
  surfaces already split a "not included" line out of `includes` and strike it through, the way Airbnb draws an
  amenity a place does not have, and 230 shipped lines are drawn that way today off a partner's own wording, so
  an exclusion needs no field and no component: it publishes as "Gratuities (not included)". `toAffiliateItem`
  now reads the product's own sections rather than `raw.detail.fields`, the copy the pass left beside them, so
  a rule put right there reaches a guest on the next sync instead of waiting for a fresh pass over an API this
  address has no key for.

- **"Who can go: download the Tour Guide app over Wi-Fi", on 2,302 partner listings** (`0f6d1a428`). Viator
  heads one bag "Additional info" and puts everything in it: the accessibility, fitness and health facts it
  generates from a fixed list of types, and whatever else the operator typed. All of it was published as
  `requirements`, which the page prints under "Who can go", so a guest asking who may come was answered with the
  app to download, the dress code, the devices supported, what to bring, that the tour runs in all weather (208
  listings) and, on 6, the marketing: "More ways to save: choose a single tour, a nearby bundle, or access to
  200+ tours". 6,221 lines. They go to Policies, where the page already files the rest of what a shop publishes.
  The rule reads the line rather than its `type`, because the free-text half of the bag carries real rules about
  the guest ("Minimum drinking age is 21 years") and one of the enumerated types carries none. Behind it,
  `splitPolicies` passed over every waiver line on the assumption the "Safety and waiver" column had it, and
  that column takes a line only while it reads as a bullet: no shipped operator writes one longer, so nothing
  was lost until 29 of the lines moved here turned out to be a partner's full waiver and terms paragraph, which
  would have been shown in no column at all.

**Checked and sound.** All 33,502 `additionalInfo` lines on the 6,492 shipped partner listings, read against
the heading they are printed under. Every string in every partner detail file for markup, entities, a decoding
fault, a bare URL and an email address (27 URL lines and 12 email lines, all now under Policies rather than
"Who can go"). That the crawled `requirements` of an operator listing are not this bag and must not be sorted
by this rule: 7,343 of them would move, and "Must be 18 years or older", "No experience needed" and "All skill
levels welcome" are among them.

**Green after the fixes.** 739 app tests (up from 736) and 715 backend (up from 709). Both type checks clean
but for TS5097. The rehearsal 53 of 53 against a local Postgres 16 cluster on 5433 with SSL and the Chromium on
disk, run on the finished tree because `src/lib/listingDerive.ts` is on every listing page's render path.

**Needs Harshil.**

- **88 businesses are in the catalog twice, once as ours and once as a partner's product.** 171 Viator products
  name an operator listing in their own metro: Busch Gardens Tampa, the Florida Aquarium, Space Center Houston,
  World of Coca-Cola, Chicago Architecture Center, Monterey Bay Whale Watch, Key West Food Tours. A guest
  searching for one sees two cards, with two covers and two prices, one of which books here and one on Viator.
  The duplicate rules we already run (shared photo, map pin, name) all stop at the operator table. Which side
  should win is your call and it is not obvious: ours is claimable and earns nothing, theirs is bookable today
  and pays commission.
- **5,157 en and em dashes are printed to guests on 2,179 listings**, outside the hours lines where a dash is a
  range and belongs. `tidyDashes` states the rule ("a menu's own em or en dash never survives to a guest") and
  is called on two fields of a crawled listing, `specs` and `highlights`; the blurb (2,009), the service
  descriptions (748), the option names and details (444), the review quotes (255), the inclusions (237) and 62
  titles keep theirs, and no partner line goes through the rule at all. Applying it everywhere is a bigger call
  than it looks: it turns "Pacific Northwest Bundle - 4 Self-Guided Tours" into a comma, and an hours line into
  nonsense, so the fields have to be named one at a time.
- **Last night's stand:** the nth-weekday rule is still read as every such weekday on 8 shops, a partner's price
  is still quoted in its own currency and printed as dollars (1,618 Canadian partner rows, all asked for in CAD
  and all printed "$"), the lite shard still carries no unit, `public/unsubscribe.html` still POSTs on load, the
  listing page still reads three of the ten vendors, `outset-api` still builds with no catalog, the "All
  requests" link is still parked off screen on a phone, five category accents are still under the AA floor,
  Viator's `additionalInfo` bag is still one bag we split by reading it rather than by its own types, and no
  live vendor or partner API has answered anything from this address.

## 24 September 2026, sixty-fourth run (05:15 to 06:45 UTC)

**Chosen, and why.** Every area this run's brief names as needing a first look is already on the Verified
list, so the frontier was the newest code in the repo: the two `/voice` endpoints Harshil added on the 23rd
(`30404c95`, `2d41887e`), which are Otto on the phone and which no run has ever read. The rehearsal was run,
and run again at the end, because commits since the last entry touched `backend/src` and `src/`, which is the
brief's own condition; the first run turned out to be the thing that found two of the six bugs below.

**Found and fixed.**

- **The phone agent offered departures the page refuses to print** (`b2198094`). `src/lib/liveTimes.ts` drops
  four kinds of row before a guest sees a chip; `/voice/:id/availability` handed a voice platform all four. A
  `timeUnknown` marker row exists only to say a date is open and carries a midnight that means nothing, so a
  caller was offered a trip at 00:00. A departure the vendor says is full was offered. A `priceCents` of 0 was
  read out as "$0". And the clock was nobody's: `from` defaulted to the host's UTC date, so from early evening
  Eastern the route skipped the rest of tonight and every morning it offered boats that had already sailed.
  The zone now comes off the shop's own area and pin, as `src/lib/zone.ts` did for the claimed side.
- **A claimed shop's own edits never reached its phone agent** (`22b7806e`). The route read `o/<id>.json`, which
  the nightly sync writes. A claimed shop's live facts are its dashboard patch, which is what `GET /profiles/:id`
  gives the listing page so a price change reaches a guest at once. Otto is sold to claimed operators, so the
  one kind of shop this got wrong was the only kind that has it: prices put up in the morning were quoted at
  yesterday's all day, along with the menu, hours, policies, cancellation line and business name. The two
  switches came with it, so a hidden or paused listing no longer hands a caller a link the booking API refuses.
- **"What do you charge?" was answered with nothing, on all 46,324 operator listings** (`00c10cf2`). `fromPrice`
  read the record's own `from`, and `from` is written on partner rows only: not one operator listing in the
  shipped catalog carries it, 10,209 of which publish a priced menu. It is now the cheapest priced line, the
  way `fromPrice` in `src/lib/catalog.ts` works one out for a card, with the same rule that a zero is a price
  nobody read rather than a free trip.
- **A partner's product had a phone agent** (`1947ec59`). `backend/AGENTS.md` says an affiliate row gets no
  Otto, and 6,492 shipped listings are partner rows. Both routes served one: Viator's licensed names, prices
  and descriptions read out on a call, off the page that carries the licence and says the commission, for a
  product with no operator of ours behind it. Both now refuse with 409 in the words the booking route already
  uses for one.
- **Two guest tests have been red in the rehearsal since yesterday afternoon** (`bce70c1f`, `3f4dc521`).
  `cardNotice` pins the exact `payNow` line, and that line grew its `!!profile` claim gate in `97835360`
  without the test moving with it. `policyLines` counted a waiver line by its words while both surfaces also
  require it to be short enough for a bullet, so the 29 long partner waiver lines were counted twice. The
  shipped pages are right in both cases; the checks were not.

**Verification.** Both type checks clean. Backend `npm test` 744 pass, 0 fail. The guest suite 742 pass, 0
fail. The rehearsal green end to end, 53 of 53, against a local Postgres on 5433 and the Chromium on disk.

**Needs Harshil.**

- The partner refusal above is a rule call, not a defect: `voice.ts` had a deliberate `bookedElsewhere` branch,
  so if the intent was that a Viator row may have a phone agent after all, revert `1947ec59` and the rule in
  `backend/AGENTS.md` wants the exception written into it.
- `/voice/:id/availability` still answers for a paused or hidden listing, on purpose: those times come from the
  shop's own FareHarbor or Peek and carry the vendor's own book link, so pausing an Outset listing does not
  mean the shop stopped selling. Say if Otto should go quiet there too.
- Nothing here has ever spoken to a voice platform. Both endpoints have been read and unit tested; no Vapi or
  Retell agent has called either, so the shape the platform actually wants is still unproven.

## 24 September 2026, sixty-fifth run (06:20 to 07:40 UTC)

**Chosen, and why.** The last entry says the rehearsal was green and no commit since it touched `backend/src`,
`src/` or the scripts, so the brief's own condition said skip it and hunt; it was run once at the end instead,
because the change below alters what a listing page prints. Every area the brief names is on the Verified list,
so the frontier was found by counting what the 52,816 shipped detail files actually carry and looking for a
guest-facing field no sweep had touched. `includes` was the biggest: 12,396 listings publish one, and the
Coverage list had only ever checked the split on the 6,492 Viator rows, never the 5,905 operator ones.

**Found and fixed.** One rule, `splitIncluded`, wrong in four ways, on four surfaces that each read the field
their own way. What a guest is told the price covers is money, so all of it is money.

- **The static `/l/` page printed every exclusion under the heading "What's included"** (`613f8b1a`), on 5,263
  shipped pages: "Gratuities", "Lunch", "Hotel pickup and drop-off", "Alcoholic drinks (not included)" all
  offered as things the ticket buys, on the page a shared link opens. The hours block and the cancellation badge
  on that page already go through the app's own rules, with a count each of how many pages disagreed before;
  this was the last section still printed raw.
- **Otto read them out too** (`598a70cc`). `includedAnswer` read the field straight: "Included: bottled water,
  gratuities (not included) and 2 more". Same 5,263 listings, and this is the surface an operator pays for.
- **The phone agent was handed them** (`97df9cc4`). `GET /voice/:id` passed `shop.includes` raw, so a voice
  platform read a shop's exclusions out as inclusions, and on a call there is no second column to read instead.
  The exclusions now go over under their own key, so an agent can say what a guest pays for separately.
- **The rule itself ticked four kinds of line as included** (`cebbba95`). It stripped the "Not included:" label
  off the front and then looked for it, so 2 listings ticked a gratuity and a captain's tip. It read a thing the
  shop sells beside the trip as a thing the trip comes with: 86 lines on 81 listings ticked "Golf clubs rental
  (extra fee)", "Snacks and drinks available for purchase", "Fish cleaning service available for additional
  fee". It let the section's own heading ride the first bullet on 42 lines across 27 listings, so a page read
  "What's included" and then "What's Included: Guests will enjoy a grand buffet dinner". And 14 listings publish
  the same thing in both halves of their own list ("Admission fees" and "Admission fees (not included)"), so a
  page promised and denied it in one breath; the exclusion wins now. A line that states an inclusion as well as
  a thing for sale ("Your first drink is included, with additional drinks available for purchase") stays an
  inclusion, and "at no extra charge" is still an inclusion. The demoted lines keep the shop's own words
  unstruck: striking "Full bar with light snacks" would say the bar is missing, which is not the claim.

`tidyLine` and `splitIncluded` moved to `src/lib/listingDerive.ts`, which is where the text rules both listing
surfaces share already live and, being outside the component, is what let the static page and the phone agent
read the same rule and a test load it. Both are re-exported from `WebListing`, so every call site is untouched.
`partnerSheet.test.ts` was scraping the regex out of the component's source; it reads the function now.

One deliberate non-change: `knowFrom` still prefills the dashboard's "What's included" editor with the raw
lines. An operator should see everything their own site published and edit it, and what they save is split
again on the way to a guest.

**Verification.** Both type checks clean. Backend `npm test` 746 pass, 0 fail, 2 skipped. The guest suite 753
pass, 0 fail, up 11 on the new checks. The rehearsal green end to end, 53 of 53, against a local Postgres on 5433 (with SSL on, which
it requires) and the Chromium on disk. A first run of it reported the backend type check red; that was this
run editing the tree while it ran, and a clean re-run is the 53 above.

**Needs Harshil.**

- 67 lines on 62 operator listings moved out of "What's included" because the shop wrote "available for
  purchase" or "(extra fee)". A handful are half-and-half in a way no rule settles: "Yoga mat available for
  purchase or loan" (the loan may be free), "Includes Cocktail, beer, and wine options are available for
  purchase onboard" (a glued heading in front of an exclusion). They read honestly under "Not included" but a
  re-crawl would read them better.
- A bare "Gratuities" or "Lunch" with no marker at all still reads as included, because nothing on the line
  says otherwise. On Viator rows the sync writes "<thing> (not included)" for the partner's `exclusions` array,
  so those are safe; a shop that writes a bare word under its own "Not included" heading on a page we flattened
  is not, and only a re-crawl that keeps the heading can tell.
- The `notIncluded` key the `/voice` route now returns is new in that payload's shape, and nothing here has
  ever spoken to Vapi or Retell, so the shape a platform actually wants is still unproven.

## 24 September 2026, sixty-sixth run (07:17 to 09:05 UTC)

**Chosen, and why.** Every area the brief names is on the Verified list, and the last entry says the rehearsal
was green, so the frontier had to be found rather than picked. Two places were worth looking: the newest code
in the tree, which is the least swept code by definition, and the money path from the guest's own page to the
server that charges it, which the Coverage list had checked a unit and a row name at a time but never end to
end as one number. The rehearsal was run, because both commits below touch `src/lib` and `backend/src`.

**Found and fixed.**

- **A plural "do not include" was ticked as included** (`c5ac096c`). `splitIncluded` read `does not include`
  and missed `do not include`, which is how a shop writes it whenever the subject is plural, and the subject of
  that sentence is usually a price or a pass: "Listed rental rates do not include gas, tax, and delivery",
  "Prices do not include customary 18-20% gratuity for the mate", "Our Fireworks Cruises do not include
  dolphin-watching", "All Boat Rental totals and Jets Ski Rental totals do not include Fuel". 16 lines across
  13 shipped listings, printed under the green tick on the listing page, read out by Otto and handed to the
  phone agent as things the price covers.
- **The exclusions heading rode the bullet** (same commit). The heading rule had the whole positive half of a
  shop's own page and only the bare words "Not included:" of the negative half, so a shop that writes the
  heading out in full had it printed as part of the fact: "What is not included: Gratuities are not included in
  the ticket price" and "Excluded: Lunch (Free time provided at Niagara Falls...)", 3 lines on 2 listings.
- **An exclusion could be swallowed whole** (same commit). Stripping a heading can leave a bullet reading word
  for word like another one, once as a promise and once as an exclusion, and the dedupe took the first it saw:
  the exclusion reached neither column and the promise stood. Latent, 0 shipped listings write their list that
  way today, but the heading fix above makes more lines collapse onto one key, so the rule that an exclusion
  wins had to stop depending on which half the shop labelled. Diffed over all 12,396 shipped listings that
  publish an includes list: 15 change, 14 of them a line moving from the tick to the cross with the shop's own
  words intact. The `/l/` pages are written by the sync, so those reach a guest on the next one.
- **The live-departures window opened on the host's UTC day** (`415cb28c`). `GET /availability/:operatorId`
  defaulted `from` to `new Date().toISOString()`, and `render.yaml` sets no TZ for `outset-api`, so from eight
  in the evening Eastern a caller that named no date was answered about tomorrow and the rest of tonight was
  never asked of the vendor. This is the last of the three routes that turn a window into calendar dates to
  carry the fix: `/voice/:id/availability` took it in the sixty-fourth run and `openSlots` has read the shop's
  zone all along. Latent rather than live: every surface in the app passes `from` off the guest's own clock.

**Swept and clean.** Three sweeps found nothing, which is worth as much as a fix here. What the guest's page
quotes against what the server charges, over all 19,117 operator listings with a bookable menu: every priced
row, at a party of one and of three, sent the way `AppProvider` sends it and priced the way `POST /bookings`
prices it, 83,574 quotes, every one identical and every one priceable. The same with extras, over the 1,652
listings that carry both a priced menu and add-ons: each extra on its own and all of them together, 7,732
checks, no disagreement. And the other way round, over all 34,492 unpriced rows a guest can pick: not one is
priced by the server after the page said "price on request", so nobody is charged for a row they were told had
no price.

**Verification.** Both type checks clean. Backend `npm test` 750 pass, 0 fail, 2 skipped. The guest suite 756
pass, 0 fail, up 3 on the new checks, which include two whole-catalog assertions: that no shipped listing ticks
a line its own words deny, and that no heading is printed as a fact in either column. The rehearsal green end to end, 53 of 53, against a local Postgres on 5433 with SSL on
and the Chromium on disk.

**Needs Harshil.**

- One of the 16 plural lines is a shop talking about somebody else's boats: o-soundboundcharters-com's
  "Everything needed for fishing is supplied on all trips, including Sand Worms, something other local charter
  boats don't include" now reads under "Not included", with its own words unstruck, so a guest still reads it
  correctly. That is the same trade-off the singular form has always made, and the listing says the same thing
  in another line anyway, but a rule that could tell whose boats they are would keep it where it was.
- 13 of the 7,104 shipped Free cancellation badges promise a shorter notice than a line in the same shop's own
  policy denies. Three are the check being wrong (o-kingfisherfleet-com's 48 hours is about when you *book*,
  o-sunsweptsailing-com's 14 days about a charter already rescheduled). Four are the shop contradicting itself,
  where a previous run deliberately chose the promise over the denial (o-baysidejetskirentals-com is the
  listing that fix was written for, and o-keywestschooners-com says 48 hours in `cancellation` and 7 days in
  `policies`). The rest are per-service windows flattened into one badge: o-bluekingdomtours-com is 48 hours on
  a half day, a week on a full day and a fortnight on a private tour, and the badge names the shortest, so a
  guest booking the private tour reads a promise the shop will not keep. Whether the badge should take the
  strictest window, or say which service it belongs to, is a rule call, not a defect.
- Five more lines on five listings state a cost the price does not cover in words `COSTS_EXTRA` does not name:
  "Guided staff optional extra charge for private events", "Entry to petting zoo and feeding activities (feed
  extra cost)", "Cost of your meal is extra". Each is half an inclusion and half not, so none reads as a clean
  fix; they are the smallest remaining edge of that rule.
- A fresh checkout still has no root `node_modules`, which the fifty-second run raised: eight guest test files
  are red for want of react until `npm install` is run at the root as well as in `backend`. Still true this run.

## 24 September 2026, sixty-seventh run (08:14 to 08:50 UTC)

**Chosen, and why.** Every area the brief names is on the Verified list and the last entry says the rehearsal
was green, so the frontier had to be found. `listingFacts` in `src/lib/catalog.ts` turned out to be one: it
writes the "Who can go" and "Safety and waiver" columns on the listing page, the phone booking sheet, the
compare table and the dashboard's "What Otto knows" panel, and no sweep had ever run it over the catalog.
Pulling that thread led to the other field nobody had read end to end, `gap`, which is the one thing a claim
prefills straight onto an operator's own published page.

**Found and fixed.**

- **A child fare was printed as a rule about who can go** (`19dd9335`). The gate that pulls a menu row into
  the column asked only for a word, "child", "junior" or "kids", which every price tier on a family menu
  carries. So 1,501 rows across 908 shipped listings were printed as the shop's own eligibility rule: "Kids
  Karate.", "Admission: Children.", "Tickets: Child.", "Rental Fleet: Child Seat.", "Junior Explorers: 35
  hours.". The compare table's "Who can go" row and the dashboard panel read this column whatever else a shop
  publishes, and the compare table led with a tier's name on 513 listings; the listing page and the phone sheet
  fall back to it when the crawl found no requirements list, 516 of them, and led with a tier's name on 449. A
  row now has to state an age, a height or an adult's company, and a number counting holes, hours, classes, a
  school grade, a year, a head count or dollars is not an age. Nothing new is printed: the 496 listings left
  with nothing fall back to the honest gap line the column already says.
- **Our own note about a missing fact was published as the shop's policy** (`39763726`). `gap` carries two
  different things: usually a shop's cancellation prose the crawl had nowhere else to put, sometimes the
  crawl's note about what the site never carried, and sometimes one of our fallback lines. The claim prefill's
  guard knew five wordings while the notes use a dozen, so the day an owner claimed, 1,052 of them landed in
  their published policy list for a guest to read: "No pricing information for food or drinks", "Duration of
  charters", "Age minimum not explicitly stated", "Prices for services", "Ask the operator about
  cancellations". One shape reads both ways and only one, "X are not given", and the auxiliary plus the shop
  addressing a guest tells the note from the policy, because a note never speaks to anybody. Diffed over all
  46,324 operator listings: 1,052 stop being prefilled, not one that was already dropped comes back.

**Swept and clean.** The two columns over all 46,324 shipped operator listings, 14,754 posted lines: after the
first fix only 19 are two words or fewer and every one is a real fact ("Ages 6+", "Kids welcome", "Waiver
required"); 17 name nothing about age or size and 10 of those are passenger capacity, which belongs there.
Two genuine questions are printed as facts ("Is a deposit required to hold a reservation?"), and 321 lines
are printed under both headings at once, which the code does on purpose for a line that is both.

**Verification.** Both type checks clean. Backend `npm test` 750 pass, 0 fail, 2 skipped. The guest suite 765
pass, 0 fail, up 9 on the two new files, which include three whole-catalog assertions. The rehearsal was run,
because both commits touch `src/lib` and step (k2) drives the prefill this run changed: green end to end, 53
of 53, against a local Postgres on 5433 with SSL on and the Chromium on disk.

**Needs Harshil.**

- Seven shipped lines reach "Who can go" because `WHO_RE` reads "$50+tax", "$40+tax", "$300+taxes", "$65+GST"
  and "35+mph" as an age of 50, 40, 300, 65 and 35. All seven shops publish a requirements list, so only the
  compare table and the Otto panel show them. `minAge` already has the rule that tells those apart
  (`barePlusAge`); the reason this run left them is that moving a cancellation fee out of "Who can go" moves it
  into `about`, which is the highlights fallback, and two of the seven have no highlights of their own, so the
  fee would become a bullet selling the trip instead. Which of the two wrong places it belongs in is a call.
- 321 listings print the same sentence under "Who can go" and under "Safety and waiver", because `classify`
  returns "both" for a line naming an age and a licence at once ("Must be at least 18yrs of age to rent
  w/Boaters license"). The two headings sit next to each other, so a guest reads it twice. Deliberate in the
  code, sloppy on the page.
- `o-oselkamarina-com` and `o-rjswatercraftrentals-com` print an FAQ question as a safety rule: "Is there a
  security deposit that I'm required to pay?" and "Is a deposit required to hold a reservation?". `faqText`
  already strips a Q label, but nothing refuses a line that is a question rather than an answer.
- A fresh checkout still has no `node_modules` at the root or in `backend`, which the fifty-second run raised:
  this run had to run `npm install` twice before anything could type-check. Still true.

## 24 September 2026, sixty-eighth run (09:05 to 09:45 UTC)

**Chosen, and why.** Every area the brief names is on the Verified list, so the frontier had to be found
again. `listingFacts().about` was one: it has exactly one reader, the highlights a listing leads with when the
shop publishes none of its own, and no sweep had ever counted what lands there. Pulling that thread ran
straight into `WHO_RE`, the other half of the same function, and from there into `minAge`, which reads the
floor those lines state.

**Found and fixed.**

- **A booking system's party floor was sold as the thing a guest would do** (`6785ff43`). Our own vendor
  readers write one "<item>: minimum N guests per booking." for every row on a shop's menu, and 739 of them on
  261 listings were printed as the trip's selling bullets, under "Highlights" on the desktop page and a ticked
  "What you'll do" on the phone booking sheet. Fun St. Pete led with seven at once, each naming a different
  hotel and the same floor of two. All 261 already state that floor in their requirements, so 195 listings now
  show no highlights section rather than one made entirely of booking minimums, and nothing is lost. A line
  that says anything else as well stays: "Up to 4 passengers per flight, minimum 2 people per booking" is a
  group size worth reading.
- **"Who can go" read a fee as an age and never read an age at all** (`6a4ff47a`). The column asked for
  `\d+\+` inside a `\b(...)\b`, and the group's own trailing boundary made that alternative read the wrong
  lines and only the wrong ones: "21+" and "18+" end at a space or a full stop, where there is no word
  boundary after the "+", so no bare age rule ever reached the column, while a number glued to a word did, and
  glued to a word it is a fee or a speed. Those were all seven lines it carried, the ones the sixty-seventh
  run left open: "$50+tax", "$40+tax", "$300+taxes", "$65+GST", "35+mph". `statesAPlusAge` now reads the
  number the way `minAge` already does and asks the line to say whose age it is, so a group, a purchase or a
  count of the shop's own stock is not one. 276 real age rules on 230 listings reach the column for the first
  time ("18+ with valid photo ID required to drive", "Guests must be 21+ to consume alcohol"), the eight wrong
  lines leave it, and none of the eight lands in the highlights, which is what that run worried about.
- **A shop writing "Minimum age 8" got no age on its page** (`53a73523`). One regex asked every cue for the
  same trailing "+", "years" or "or older", including the one cue that needs none. So 86 listings that state
  the rule in plain English printed nothing on the listing page, the phone sheet or in Otto: "Minimum age 8",
  "Minimum age 16 to enter without adult supervision", "Level 3 minimum age is 19". A hyphen hid one too, so a
  Viator product reading "minimum age is 8-years old" printed nothing either. The cue runs as a second pass,
  after the looser ones have read the whole list, so it adds an age where there was none and changes none.

**Swept and clean.** The 14,341 highlight lines the 6,456 listings that publish their own carry: not one holds
a per-booking minimum, a price, a cancellation term, a URL, an email address, a phone number or a question, so
the defect was the fallback's alone. The `about` column over all 46,324 operator listings before and after:
739 lines dropped, every one a booking minimum, none kept that matched. The "Who can go" column over the same
catalog, diffed line by line: 276 gained, 8 lost. `minAge` over every shipped listing: 86 gained, 0 lost, and
one listing whose number is unchanged.

**Verification.** Both type checks clean (TS5097 aside). Backend `npm test` 750 pass, 0 fail, 2 skipped,
unchanged. The guest suite 777 pass, 0 fail, up 9 on three new files, which include four whole-catalog
assertions. The rehearsal was run, because all three commits touch `src/lib` and steps (d), (k2) and (k5)
drive the listing facts this run changed: green end to end, 53 of 53, against a local Postgres on 5433 with
SSL on and the Chromium on disk.

**Needs Harshil.**

- `minAge` returns the first line that yields an age rather than the lowest, and on a shop that sells more than
  one thing the two are not the same. Reading the new cue in the same pass moved 16 listings to a different
  number, 9 of them better and 4 worse: Peak Experiences would have gone from the 5 its birthday climbers must
  be to the 13 its belayers must be, Karting Orford from the 2 that may ride a double kart to the 7 that may
  drive one. The second pass sidesteps it, but a listing page's "Ages N+" is a floor and taking the lowest
  stated age would settle all four. That is a sweep of its own, over the 1,399 listings that print one.
- 12 listings still keep an age rule out of "Who can go" because no person sits in front of the number:
  "Adults only, 18+", "Valid 21+ ID required for alcohol shipment delivery", "After 8PM, 21+ only", "Jet Ski
  Rentals: 18+ with a Valid Driver's License". Widening the rule to read a colon or a comma as a clause
  opening pulls in "Discounts for groups: 8+ tickets $1 off each" with them, so it wants the counted-noun list
  finished rather than the opener loosened.
- The 183 lines still in the highlights fallback, on 140 listings, are almost all group size and capacity
  ("Boat holds 11 passengers", "Maximum capacity 125 players", "Groups of 500 or more require special
  approval"). They are true and they are the shop's own words, but they are not what the trip is, and
  "What you'll do" is where the phone prints them.
- A fresh checkout still has no `node_modules` at the root or in `backend`. Raised by the fifty-second run and
  every run since; this one ran `npm install` twice before anything could type-check.

## 24 September 2026, sixty-ninth run (10:14 to 10:50 UTC)

**Chosen, and why.** The sixty-eighth run left one sentence on the Not yet checked list naming the guest-facing
lists nobody had ever counted: `specs`, `bring` and `highlights`. It swept the highlights. This run took the
other two, and `bring` first, because it is the one list an app surface reformats before printing rather than
passing through.

**Found and fixed.**

- **A shop's "No outside food" was printed as a thing to bring** (`12ac61b4`). "Bring " is a label for a thing,
  and a third of what shops publish under what-to-bring is not one: it is the shop telling a guest what to do,
  what it will let them carry in, or what they may not. 1,469 lines on 1,179 shipped listings carried the label
  in front of a line with its own verb, on the listing page's "Who can go" column and in Otto's own bring
  answer alike: "Bring bring your own fishing poles", "Bring guests may bring their own alcohol", "Bring dress
  in layers", "Bring arrive 15 minutes early", "Bring sunglasses recommended". 104 of them said the flat
  opposite of the shop's rule: "Bring no outside food or alcohol", "Bring no special equipment needed", "Bring
  do not wear perfume". One rule now, read by both surfaces: a line carrying its own verb keeps the shop's own
  words, and the column already prints full sentences beside these, so nothing there needs the label to read.
- **A shop's own selling lines were headed "Requirements" on its /l/ page** (`7e95fcf1`). The static page
  filled that section with `specs` whenever a shop stated no requirements, and `specs` is where the crawl puts
  what a shop says about itself. So 2,369 shipped pages headed "Beautiful gardens with bicycles hidden
  throughout the property", "Award-winning beers such as Treachery and Soleil" and "Located in downtown Anoka,
  MN" as things a guest must do. The app has never done that: `listingFacts` sorts a spec line by what it says.
  Reading the same split moves 5,439 lines out of the section and keeps the 807 that are real rules, and the
  page gains a Highlights section it never had at all, so the 6,456 listings publishing their own show them
  here too: 6,511 pages, 14,397 lines.
- **"Must be 21 or older" never reached "Who can go"** (`8b9221b4`). The column asks a line for an age word or
  a bare "N+", and a shop's most ordinary way of stating a floor has neither. 282 lines on 245 shipped listings
  were filed as a thing the trip is and sold as a highlight: "Must be 21 or older to consume alcohol", "Go Kart
  driver must be 18 or older", "Participants must be 12 years or older for Intro Lesson". On 63 of those it is
  the only rule the shop posted, so the column said "Age, weight and kid rules are not posted on their site" on
  the same page that led with the rule as a reason to come. `minAge` has read this cue all along, so it sits in
  `ages.ts` beside the bare "N+" rule now, where both readers share it. A length, a lead time and a party size
  written the same way still state no age, because what follows the number has to say it counts years.
- **A shop's "Lunch (bring your own) (not included)" was shown in neither column** (`c90e6835`). "Bring your
  own" is no inclusion, and the rule dropped the whole line for saying it, taking 36 shipped lines that say in
  the same breath that the shop does not supply the thing: lunch, bottled water, sunscreen, a child seat. A
  line that marks itself keeps its place under "Not included". An unmarked one is still a thing to bring rather
  than a term of the price, so it stays out. 37 lines on 37 listings return, none on the included side.

**Swept and clean.** All 6,575 `bring` lines on the 3,203 listings that publish one, classified by hand and
then diffed line by line through the new rule: 1,469 change, 5,106 keep the label, and none of the ones kept
opens with a verb, a prohibition or a second "bring". The 267 distinct spec lines the new age cue moves, every
one held against the cue whole: not one states anything but an age. The 5,439 lines leaving the /l/ page's
Requirements section, and the 807 that stay. All 88 `includes` lines in the catalog that say "bring your own",
split by whether they mark themselves.

**Verification.** Both type checks clean (TS5097 aside). Backend `npm test` 751 pass, 0 fail, 2 skipped, up 1
on a new whole-page assertion. The guest suite 792 pass, 0 fail, up 15 on two new files and three extended
ones, which include four whole-catalog assertions. The rehearsal was run, because all four fixes touch `src/lib` or
`backend/src` and steps (d), (k2), (k5) and (k8) drive the listing facts they change. It failed the first time,
on a test this run wrote: the catalog sweep behind the age rule resolved `public/o` off `process.cwd()`, which
is the repo root when `npm test` runs it and the rehearsal's own temp directory when the rehearsal does
(`f36ae410`). Green end to end after that, 53 of 53, against a local Postgres on 5433 with SSL on and the
Chromium on disk.

**Needs Harshil.**

- The other 52 `includes` lines that say "bring your own" without marking themselves are two different things
  wearing one phrase, and neither is safe to read by rule. Some name something the price does cover before the
  clause ("Cooler so that you can bring your own drinks", "Water refills (BRING YOUR OWN water bottle)", and
  one whole sentence listing all the tackle a charter supplies), so dropping them loses a real inclusion. Some
  are the shop saying it supplies nothing ("NO live guide or rental equipment provided, please bring your own
  smartphone and headphones"), which no rule here reads as an exclusion because it never writes "not included".
  Both stay dropped for now.
- 68 bring lines still take the label although they mention bringing, and nearly all of them read correctly for
  it: the word sits in a subordinate clause ("Bring US Coast Guard approved life vest if bringing own", "Bring
  clean blanket if bringing a dog in trailer"). Six do not, and they open with an adverbial before the verb
  ("For wedding lessons, bring wedding shoes closer to the event"). Widening the rule to reach those pulls the
  other 62 with it.
- A line stating an age over 21 now reaches "Who can go" and is printed there in the shop's own words, but
  `minAge` still caps at 21, so a boat rental's floor of 25 and a senior league's 50 are read by the column and
  not by the "Ages N+" line above it. That is the same open question the sixty-eighth run raised about the cap,
  now with the column on the other side of it.
- A fresh checkout still has no `node_modules` at the root or in `backend`. Raised by the fifty-second run and
  every run since; this one ran `npm install` twice before anything could type-check.

## 24 September 2026, seventieth run (11:19 to 12:45 UTC)

**Chosen, and why.** The Coverage list has "the claim screen's own bad and expired states as a browser draws
them" as the one thing in the claim and sign-in flow never checked: every other part of it is covered at the
token level, and the rehearsal cannot reach the screen at all because it enters through the test bypass. That is
the first screen a real operator ever meets, so it went first. Reading the states before driving them found the
actual defect, which is not how the two known states look but a third one nobody had separated from them.

**Found and fixed.**

- **A claim link the API never answered for was called a bad link** (`70131cfa`). `exchangeClaimToken` told the
  screen only "not ok" and "expired", so a request that timed out, a dead connection, the per-IP rate limiter
  (30 an hour on that route, with its own 429 body the screen threw away) and a 502 from in front of the API all
  came back as the same thing as a forged token. The owner read "That claim link didn't check out. Ask for a
  fresh one below, or sign in with your email." about a link that was perfectly good, and the fresh one it
  offered needs the same API that had just gone quiet. One helper now says whether the API ever judged what was
  sent (`apiDidNotAnswer`: status 0, 408, 429 and 5xx), and the screen has a third line that says the link is
  fine and a reload will do, which is true, because the token is still in the address bar until a claim is
  recorded. The same helper fixes the worse version of it on `/auth/verify`: an operator who typed the right
  code while the API was unreachable was told "That code does not match.", and the API burns a code after six
  tries, so being sent back to retype a correct one costs the code. Both sign-in screens, the operator's and the
  private metrics page's, now say the code is still good.
- **A failed claim link threw away everything it knew about the owner** (`b138dd1d`). All three failure lines
  end in "ask for a fresh one below", and the form below was empty: name, work email and mobile typed again from
  memory, with the address being the field the API will refuse if it is not the one on the business's own site.
  The link in the address bar already carries all three (`&o=`), bounded and validated by `ownerFromHash`, and
  the good path has always read them. The failed paths read them too now, so "ask for a fresh one" is one press.
- **The operator side never woke the API it cannot work without** (`ca803b22`). The API host sleeps when idle,
  which is why `warmApi` exists and why the guest booking sheet has called it since 16 September. Nothing on the
  operator side did, so an owner following a claim link from their inbox made the exchange the wake-up request,
  against a 15 second timeout, and "Email me a sign-in code" was a 12 second one on a route that sends mail: a
  timeout there leaves the screen saying the code could not be sent while the code lands in the inbox anyway,
  with no code step in front of them to type it on. One effect on the operator screen warms it whichever way
  they arrived, and `requestSignInCode` now waits as long as the claim-link request beside it.

**Swept and clean.** The claim screen's three link failures driven in a real Chromium against the local API and
a real minted v2 token, at 1280px and 400px: a forged signature, a correctly signed token a day out of date, the
exchange aborted the way a dead connection aborts it, a 502, and a 429 carrying the limiter's own body. Each
state says its own line and none of them says another's; the token stays in the address bar on the two that a
reload would fix; the prefilled form carries the name, address and mobile off the link; nothing scrolls sideways
and nothing sits past the edge at 400px. Every caller in the app that prints a verdict on a failed call was read
for the same fault; the other seven already had a sentence for an API they could not reach.

**Verification.** Both type checks clean (TS5097 aside). Backend `npm test` 751 pass, 0 fail, 2 skipped,
unchanged. The guest suite 799 pass, 0 fail, up 7 on two new files and one extended. The rehearsal was run rather
than skipped: the sixty-ninth entry had it green and nothing since had touched what it drives, but every fix
here lands in `src/lib`, `src/state` or `src/components`, which it does drive. 55 of 55 against a local Postgres
on 5433 with SSL on and the Chromium on disk. It also carries a new step (n) that mints the two claim-link
states an owner actually meets and checks each is told apart from the other, so the coverage this run's browser
drive bought does not leave with the scratch directory. The first version of that step failed honestly and was
worth having: a browser that has claimed the listing before opens the dashboard from its own storage and never
draws the claim screen at all, which is exactly the case the step must not be.

**Needs Harshil.**

- `proceedClaim` throws away what `claimRemote` answers. If the API fails on that one call, the click still
  cleans the token out of the address bar, still saves a local profile and still opens the dashboard, so the
  server never heard about the claim and the link is gone from the URL. The window is small (the exchange
  succeeded seconds earlier) and the device keeps a way back in, but it is the one place left where a silent API
  costs something rather than only saying the wrong thing.
- A claim link that fails now prefills the form from its own `&o=` payload. That payload is not signed. It is
  bounded and the API still checks the address against the business's own website, and it is a URL the person
  already holds, so nothing is revealed and nothing can be claimed with it. Flagged because it is the first time
  anything on that screen is filled in from the hash rather than from the catalog.
- A fresh checkout still has no `node_modules` at the root or in `backend`. Raised by the fifty-second run and
  every run since; this one ran `npm install` twice before anything could type-check.

## 25 September 2026, seventy-first run (04:50 to 05:50 UTC)

**Chosen, and why.** Everything on this run's brief was already on the Verified list except one line: the
`role="tablist"` groups as a screen reader meets them, which is the accessibility item the brief asks for and
the only entry on the Not yet checked list that is a defect rather than a question. Reading the app's other
ARIA widgets first found a bigger one beside it, on the guest side and on the control that decides what a
guest is buying, so both went in one sweep.

**Found and fixed.**

- **The booking box's service picker promised a keyboard it did not have** (`5446a897`). It said
  `role="listbox"`, which a screen reader answers by leaving browse mode and passing every arrow press to the
  page, so Up and Down did nothing at all inside it. It cost every keyboard guest, not only those on a screen
  reader: picking a row unmounted the popup and the focused row with it, so focus fell to the body and a guest
  who had tabbed into the picker had to tab from the top of the page again to reach the date. The element
  carrying the role was the whole popup, so its sticky filter chips were being offered as list options. Now the
  list itself carries the role and owns options and nothing else; it answers Up, Down, Home and End; it has one
  tab stop, the row already picked, or the first row still on screen when a chip filter has hidden that row;
  opening it lands on the picked row, and Escape or a pick hands focus back to the button that opened it.
- **The dashboard Home's tab strip named nothing and controlled nothing** (`5446a897`). `role="tablist"` with
  no label, no arrow keys, and no `role="tabpanel"` under it, so nothing tied "Today" to the list it draws. It
  has the label, roving tab stops and the same arrow keys the guest home's category bar already had, and one
  panel that whichever tab is open names, taking a tab stop of its own only when what it holds has none. The
  Browse and Agent pair behind `AGENT_MODE_LIVE` got the same keys.

**Swept and clean.** Every `role="tablist"`, `role="tab"`, `role="listbox"` and `role="option"` in
`src/components`, read and then held to the keys its role promises, now a test of its own that fails on all six
counts against the old code. The desktop home's What and Where boxes were already a proper combobox, with
`aria-activedescendant`, their own key handler and a named popup, and the phone sheet's tier buttons are
ordinary pressed buttons rather than a list. Both widgets driven in a real Chromium at 1280px and 400px:
opened from the keyboard, walked, filtered to a chip that hides the picked row, picked, escaped, and the focus
followed each time. The popup's and the feed card's geometry measured before and after at both widths, and the
popup screenshotted at both: identical to the pixel, which is what a semantics change should be.

**Verification.** Both type checks clean (TS5097 aside). Backend `npm test` 760 pass, 0 fail, 2 skipped. The
guest suite 811 pass, 0 fail, up 6 on the new file. The rehearsal was run rather than skipped, because this
run's change lands in `src/components`, which it drives: 55 of 55 against a local Postgres on 5433 with SSL on
and the Chromium on disk.

**Needs Harshil.**

- The "All requests" link is still a fourth child of the Home tab strip's `role="tablist"`, where only tabs
  belong. The arrow keys skip it and it keeps its own tab stop, so nothing is unreachable, but a screen reader
  counts it inside a list of three tabs. Taking it out of that element means moving it in the layout, which is
  `src/styles`, outside what an overnight run may change.
- The picker now moves focus into the list when it opens, which is what a button carrying
  `aria-haspopup="listbox"` is expected to do. A mouse user sees nothing, because the row's ring is
  `:focus-visible`, but it is the first time that popup takes focus off the button at all.
- A fresh checkout still has no `node_modules` at the root or in `backend`. Raised by the fifty-second run and
  every run since; this one ran `npm install` twice before anything could type-check.

## 25 September 2026, seventy-second run (06:22 to 07:30 UTC)

**Chosen, and why.** Everything in this run's brief is on the Verified list except the claim and sign-in flow's
one open defect, which the seventieth run raised and left for Harshil: `proceedClaim` throws away what
`claimRemote` answers. Reading it before changing it found a second fault underneath, on the same two lines,
which is worse than the one that was flagged, so the hour went there rather than to a new area.

**Found and fixed.**

- **A quiet API was read as a shop with nothing in it, and a blank dashboard was saved over the real one**
  (`1f3ddb5f`). `fetchRemoteProfile` answered `null` both for a listing that has no profile and for a call
  nobody answered, and the two screens that build a dashboard from scratch read that `null` the first way. A six
  second timeout against a sleeping API, a 502 in front of it, or the per-IP limiter was therefore enough to
  hand a working operator a dashboard built from the crawled record, `saveProfile` it over this device's copy,
  and push it to the API on the next app load, because `applyStoredProfiles()` sends every claimed listing it
  finds there. That is the menu, prices, photos, hours, policies, blocked slots, days off, notice and window the
  owner had already published, gone, and the only sign of it is a dashboard that looks like the day they
  claimed. Two doors reach it: an owner following their claim link on a new phone, and an owner signing in by
  code on one. `fetchRemoteProfileResult` now says whether the API ever answered (only its own 404 settles the
  question; a missing static guest copy does not, because that file is absent for every listing on a host that
  serves the catalog alone), and both doors stop and say so rather than guessing.
- **A claim the server never heard still opened the dashboard and dropped the link** (`1f3ddb5f`). The
  seventieth run's item. The click cleaned the token out of the address bar, saved a profile and entered
  whatever the API answered, so the listing stayed unclaimed on the server, the owner's address was never linked
  to it, "email me a sign-in code" had nothing to send to, and the one-click way back in was gone from their own
  URL. `claimRemote` now separates a refusal from silence, the click reads it, and the confirm screen says which
  of the two happened and leaves the link where it is.
- **A sign-in retry sent a spent code back** (`1f3ddb5f`). The API deletes a code the moment it accepts one, and
  the session it hands back is already saved, so pressing the button again after a listing failed to load
  answered "code expired, request a new one" to an owner who was in fact signed in. The listings that code
  bought are held, and the retry repeats the load.
- **The test bypass's way in never asked what was stored** (`73d22181`). TEST BYPASS: `test-enter` is the same
  click minus the link, and it is the door Harshil's own address walks the operator side through. It built a
  dashboard from the crawled record without reading the API at all, so entering a shop set up on another device
  hit the same overwrite. It now reads first and stops when the API does not answer. A listing with nothing
  stored still starts from its published things-to-know lines, which the rehearsal's own step (k2) checks.

**Swept and clean.** Every place in the app that builds an `OperatorProfile` from scratch, read for the same
fault: five call sites, three of them behind an API read and now all three guarded, one the demo sandbox and one
the no-API demo code path, neither of which can reach a real listing. `catalogLoad`'s late profile fetch stays
on the old plain name, because a patch that did not arrive is a page that draws the crawled record, which is
correct.

**Verification.** Both type checks clean (TS5097 aside). Backend `npm test` 760 pass, 0 fail, 2 skipped,
unchanged. The guest suite 820 pass, 0 fail, up 9 on one new file. The rehearsal was run rather than skipped,
three times: the fixes land in `src/lib` and `src/components`, which it drives. 57 of 57 against a local
Postgres on 5433 with SSL on and the Chromium on disk, up two on a new step (n2) that mints a valid v2 link,
reaches the confirm screen, replaces `window.fetch` in the page so only the click's own two calls fail, and
checks the owner is left on the link with the token still in the address bar and nothing written to the device,
then restores it and checks that pressing again records the claim and opens the profile the flow published
earlier. Run once against the code before the fix, where that step fails on every count it makes (in the
dashboard, token gone, a profile saved) and takes step (z) with it.

**Needs Harshil.**

- The confirm screen now prints a failure line. It reuses `.oderr` inside an `.odsplash`, which already wraps a
  sentence of its own, but the rehearsal drives the browser at 1440px and the width is hard-coded there, so the
  new line has not been seen at 400px. Nothing in `src/styles` was touched.
- `test-enter` still hands out a session for any listing an allowlisted address names, and now reads that
  listing's stored profile onto the device. That is what makes it useful and what makes it the one route that
  must never be switched on anywhere real.
- A fresh checkout still has no `node_modules` at the root or in `backend`. Raised by the fifty-second run and
  every run since; this one ran `npm install` twice before anything could type-check.

## 25 September 2026, seventy-third run (07:18 to 07:50 UTC)

**Chosen, and why.** Every area in this run's brief is on the Verified list, and what is left on Not yet checked
is mostly a judgement for Harshil rather than a defect. One item on it names live code: what `specs` carries
into the two readers that still take it raw, the blob Otto matches a question against and the word index search
builds. Following it found something worse than the item described, so the hour went there and then to the
newest code in the repo, last night's IP-to-metro placement, which no run has touched.

**Found and fixed.**

- **The kids filter read a rule the browse catalog does not carry** (`b0f4928a`). Typing "with kids", "family
  friendly", "toddler" or "teens" puts a hard filter on the home under a panel that promises "Only places whose
  published rules allow younger kids": a listing it rejects is not shown at all. `kidFriendly` read `specs`,
  `gap` and `extraNote`, and search runs on the browse catalog, where the sync empties all three so the file
  stays small. So the only line of the rule that could ever fire was its last one, the shop's kind. 3,098 of
  the 46,723 browsable listings publish words that settle the question and none of them reached the filter:
  **524 were offered to a guest filtering for children although their own site says 18+, 21+ or adults only**
  (breweries, 21-and-over bar nights, jet ski rentals that will not hand a ski to a minor; 297 of them in the
  very kinds that query prefers), and 28 that welcome children were dropped for being a skydive or an axe shop.
  The rule moved to `src/lib/kidRule.ts` with a third answer, null for "their site does not say"; the sync runs
  it over the full record and carries the verdict as `kid`; the reader takes the record's own words first, so a
  claimed operator's edit is read the moment they save it. `c3ce39f1` pins the coupling from the backend side.
- **The home could be left saying "Finding you" with nothing able to stop it** (`ae1ee421`). `state.locating`
  blanks the whole home, two skeleton rails on the phone and the same on the desktop, and one effect ever turns
  it off: `placed` is set the moment the browser answers about location and `shouldLocate` refuses every run
  after that. `apply` rightly declines to move the ground under a guest who has a sheet open, and returned
  without a word. So a first-time guest who tapped the search pill on the skeleton while the location prompt was
  still up, then closed the sheet without picking a city, had the answer land against an open sheet and got no
  home at all until they reloaded. Every decline settles now. The clock-city fallback beside it dispatched a
  bare `metro`, which the reducer answers by clearing `sheet`, so it was closing that sheet under them; it goes
  through `apply` like every other answer.

**Swept and clean.**

- Otto's raw `specs` was a false alarm, and worth recording as one: `clip()` in `companyAgent.ts` already runs
  `plainWords`, so every line Otto quotes is markdown-stripped, tag-stripped, glossary-expanded and
  mojibake-repaired. 2,635 of the 190,286 lines in its corpus read differently raw (2,490 of them jargon the
  page expands, 117 a heading marker), and no answer reaches a guest without `clip`: every call site was read.
  What is left raw is the matching, which is relevance rather than output. The word index beside it is the same
  story from the other end: `for (const s of u.specs) put(s, F_TEXT)` indexes nothing at all on a shipped
  record, and the option and service loops next to it are covered by `tags`.
- The IP-to-metro table driven for the first time. `build-ip-metros.mts` against a hand-built DB-IP CSV: two
  metros, three adjacent ranges that must merge into one, a row out of address order, a place 120 km from any
  metro, a non-US/CA row, a city name with a comma inside its quotes, and an IPv6 block. 6 of 9 rows kept,
  merged to 3 v4 and 1 v6, and the table read back through `decode` and `lookup` answers every boundary, both
  refusals and the `::ffff:` unwrapping correctly. `zoneFor` over all 50 metros, because `ipGuessFitsClock`
  refuses an IP metro whose zone it cannot read: all 50 answer one. The built table lives under
  `backend/data/geo`, which is gitignored; it was deleted again.
- Every other reader that meets a lite record: `fromPrice`, `startingPrice`, `publicRating`, `dealToday` and
  `freeCancelBadge` all already fall back to a field the lite record carries. `listingFacts` and `maxGuestsFor`
  only ever see hydrated records, the compare table included, which loads every detail file before it draws.

**Verification.** The rehearsal was run rather than skipped: the fix lands in `src/state/AppProvider.tsx`, which
it drives. 57 of 57 against a local Postgres on 5433 with SSL on and the Chromium on disk. Both type checks
clean (TS5097 aside). Backend `npm test` 763 pass, 0 fail, 2 skipped, up 3. The guest suite 830 pass, 0 fail, up
10 on two new files. The new locate guard was run against the code before the fix, where three of its four
checks fail.

**Needs Harshil.**

- The `kid` flag reaches a guest only after the next `npm run sync`. Until that runs the 524 stay in the kids
  filter, because there is nothing in today's `catalog.json` to read.
- `groupOk` in `src/lib/search.ts` is blind the same way: it reads `specs`, which is empty, plus `tags`, and
  `groupInfo`, where a shop's party rules actually live, is not on a lite record at all. It is a +4 ranking
  nudge rather than a filter, so nothing on screen is wrong, and a second compact flag is a product call.
- A guest whose address does not fit their clock (a VPN, a carrier gateway) re-asks `/where` on every visit:
  `opening()` forces `recheck: true` and `guessPlace` refreshes the stored timestamp, so the guess never ages
  out. One extra request a visit, never a wrong answer.
- Still open from the seventy-second run: the confirm screen's failure line has not been seen at 400px.
- A fresh checkout still has no `node_modules` at the root or in `backend`. Raised by the fifty-second run and
  every run since; this one ran `npm install` in both before anything could type-check.

## 25 September 2026, seventy-fourth run (08:00 to 09:05 UTC)

**Chosen, and why.** Every area in this run's brief is on the Verified list except three lines about the guest
listing page, so the hour went there and was driven in a real Chromium rather than read: the "More options"
fold and `variantNote`, the Deals section, and what a listing page does when a second listing link arrives.
The last of those found two bugs, both on the page a guest spends all their time on.

**Found and fixed.**

- **A second listing link dumped the guest on the home with an empty address bar** (`398c91b7e`). Chrome
  queues `popstate` BEFORE `hashchange` for a fragment navigation, so a shared `#o=` link opened in a tab that
  already had a listing or a chat open reached the back-button handler first. That handler closed the sheet,
  closing the sheet made the address-bar effect strip the hash, and the `hashchange` a millisecond later read
  an empty hash and did nothing at all. Every listing carries a Share button and every outreach email carries
  that link. Pressing back between two listings did the same: it did not go back to the previous listing, it
  went to the home. Which listing the hash names is the whole difference, since back lands either on no hash
  or on the app's own second entry for the same listing, so `onPop` asks `hashOpensAnotherListing` before it
  closes anything and `hashchange` now reads the event's own `newURL`. Driven both ways in Chromium: a link
  between three listings, back between two, and backing out of a listing opened from the home, which still
  closes the sheet and keeps the guest on the site.
- **"More like this" offered the same business as two of its cards** (`a044edebc`). The rail picks from the
  same metro and the same state or province, and a shop in this metro is nearly always in this region too.
  When neither pool had four in it the rail merged both without deduping. **483 shipped listings drew a repeat
  and on 253 of them at least half the rail was repeats**: Blitz Paintball in Dacono, Colorado, offered
  Loveland Laser Tag as both of its two suggestions. React warned about the repeated key on every one, which
  is how it was found. The rule moved to `src/lib/similar.ts` with the merge deduped.

**Swept and clean.**

- The tier picker's labels over all 61,620 shipped services: two shown rows reading the same words (1, on a
  test listing), a shown row printing nothing (0), and two tiers in one service sharing an `optionIdx`, which
  is the React key that row is drawn with (0).
- The "More options" fold driven at 1440px and 400px: the tail opens and closes, the picked tier stays
  visible while folded, `aria-expanded` follows, and "Fewer options" appears only once the fold is open.
- The Deals section driven on four shops that publish one, including a code, a start hour and a date-specific
  deal. The day strip, the "Today" badge and the `Deal today` row all read the shop's own clock, and a deal
  whose hours have not started today is correctly not badged. `dealShown` does not print a title and its
  identical detail twice.
- 142 listing pages opened in Chromium, 42 chosen for their shape (affiliate, no cover, no services, no
  price, one option, many services, promos, FAQ, long title, video, policies, add-ons, a folded menu) at both
  1440px and 400px, and 100 at random: no sideways scroll, nothing past the right edge, no console error and
  no exception on any of them once the duplicate key was fixed.

**Verification.** The rehearsal was run rather than skipped: both fixes land in `src/`, which it drives. 57 of
57 against a local Postgres 16 on 5433 with TLS on and the Chromium on disk. Both type checks clean (TS5097
aside). Backend `npm test` 763 pass, 0 fail, 2 skipped, unchanged, and nothing under `backend/src` was
touched. The guest suite 842 pass, 0 fail, up 12 on two new files, and both new files were run against the
code before their fix, where 2 of 6 and 2 of 6 checks fail.

**Needs Harshil.**

- On 7 listings the cheapest tier is folded behind "More options", so the card promises a price the page does
  not show until the guest clicks: Alcatraz Tours' card says from $119 and its page opens at $249. All seven
  are per-person rates that fall as the group grows, so the card is honest and the fold is hiding the bottom
  of the ladder. Whether the fold should keep the cheapest row is a product call.
- Both fixes are in app code, so they reach a guest on the next deploy. Neither needs a sync.
- A fresh checkout still has no `node_modules` at the root or in `backend`. Raised by the fifty-second run and
  every run since; this one ran `npm install` in both before anything could type-check.
- Still open from the seventy-second run: the confirm screen's failure line has not been seen at 400px.

## 25 September 2026, seventy-fifth run (09:15 to 09:50 UTC)

**Chosen, and why.** Every area in this run's brief is on the Verified list. What is not on it is the newest
code in the repo: the Otto (AI phone line) outreach campaign, landed on 24 September between 19:20 and 20:18,
after the run that read outreach end to end. It is a commercial email that goes out unattended at 9:30 every
weekday from the Mac's launchd, from Harshil's own personal Gmail, to about 4,700 businesses that never asked
for it, and no run had read a line of it. That account's reputation is the whole channel, so the hour went
there rather than to the rehearsal, which does not touch outreach at all.

**Found and fixed.** Four, all in `backend/src/outreach`.

- **The two pitches could mail the same owner in the same week from the same mailbox** (`5f346759`). Each send
  query refused an address its own campaign had mailed and could not see the other's sends at all.
  `ottoDrafts.ts` says in its own header that "the two must never be sent to the same address inside the same
  week"; nothing enforced it. **2,038 operators in the shipped catalog clear both campaigns' filters, 68% of
  everything the listing pitch can send to**, and both queues order by how well established a shop is, so the
  overlap sits at the top of both. `spacing.ts` now owns the rule and both queries build their clause from it:
  a campaign's own send bars an address for good, any other campaign's bars it for a week, counted over any
  kind so a third pitch needs no change here.
- **The Otto pitch carried no take-it-down link** (`bce9efdb`). `backend/src/outreach/AGENTS.md` asks for a
  one-click remove line and a working unsubscribe link on every send. The listing pitch has carried both since
  it started; Otto carried only the unsubscribe. Every operator it targets already has an unclaimed page in
  the catalog and the mail names Outset without naming that page, so an owner who read "I built Otto ... for
  operators like yours", went looking and found a page about their business had no way off it that did not
  start with a reply. Same line, same link, after the sign-off. The persuasive copy is untouched.
- **A dry run retired the addresses it was only meant to preview** (`45bfb19d`). `outreach-send --dry` marked
  a suppressed address 'unsubscribed' and a domain whose DNS did not answer 'failed', from a run that mailed
  nobody. Two previews in a row gave different answers, which is how it was found: the second saw an empty
  queue. It matters because `outreach-ramp.mts` never regenerates the draft queue, so a row a preview retired
  is out of the campaign until somebody runs `npm run outreach` by hand, and DNS not answering is the one
  thing `deliverable.ts` is careful not to hold against an address. The rule is `skipMark` in `guards.ts` now,
  called by both sends, and the regex for addresses nobody reads moved there too so the two cannot drift.
- **"Who answers Capt Andy's's phone after you close?"** (`6499e216`). One shop of the 4,728 targets, and the
  only one: a name that is already possessive no longer grows a second apostrophe.

**Swept and clean.**

- `dayStartIso` and the shared daily ceiling: the campaign's day really does start at local midnight in
  `PIPELINE_TZ`, both ramps read `sentToday()` across both campaigns before adding volume, and the order
  `outreach-daily.sh` runs them in does not matter. 15/20/25/30 plus 10/15/20/20 stays under the combined 50.
- Both send paths stamp `created_at` at the moment the mail went out, which is what `sentToday()` counts, so
  the ceiling is read off send times and not draft times.
- The Otto batch never sends twice inside a run, never to a suppressed address, and regenerates its copy at
  send time so a stale draft body cannot go out. A failed send is retried on the next generation.
- Every one of the 4,728 targets' names through the subject line: no control character anywhere, so no header
  injection; 4 emoji, 4 that are a domain rather than a name, 1 all-caps initialism.
- The cool-off starves neither campaign: 4,692 operators are eligible for Otto against 2,993 for the listing
  pitch, and the bar lifts after a week.

**Verification.** The rehearsal was run rather than skipped, because the commits touch `backend/src`: 57 of 57
against a local Postgres 16 on 5433 with TLS on and the Chromium on disk. Both type checks clean (TS5097
aside). Backend `npm test` 776 pass, 0 fail, 2 skipped, up 13 on two new files and four new cases in
`guards.test.ts`. Every new test was run against the code before its fix: the old per-kind clause offers an
address the other campaign mailed three days ago, and three dry runs in a row against a local SQLite used to
give three different answers and now give one. The guest suite is unchanged; nothing under `src/` was touched.

**Needs Harshil.**

- **The Otto email tells a business something the product does not do yet.** "Since you use FareHarbor, Otto
  plugs right into it. Bookings drop straight into your calendar as if you took the call yourself." Both
  `/voice` endpoints are read-only by design ("It never books or charges", `api/voice.ts`), and `/AGENTS.md`
  says syncing with an operator's own booking software is deferred on purpose. `vendorLine`'s own docstring
  says it "never claims to read or write their calendar ... it says the honest, more limited thing". The Otto
  page makes the same claim and hedges it in its FAQ, so this reads as a deliberate pre-launch position rather
  than a slip, and approved copy is not an overnight run's to rewrite. It is the easiest sentence in the email
  for an owner to test, and it only goes to shops that use the vendor it names.
- The subject is over 78 characters on 201 of the 4,728 targets, and what gets cut is the hook: "Who answers "
  is 12 characters before the name starts, so on a phone almost every one of them loses "phone after you
  close?". Fronting the question is a copy call.
- "Gulf Jet Skis'" is the correct possessive and "Gulf Jet Skis's" is what goes out, on 2,261 of the targets.
  A typo on one shop was worth fixing on its own; this is a style call on half the list.
- `outreach-ramp.mts` never regenerates the draft queue, while `otto-ramp.mts` does, so the daily listing job
  only ever mails what was queued the last time someone ran `npm run outreach`: a newly enriched operator
  never enters it. Generating drafts for every unclaimed operator holds a write lock for longer than the Otto
  set does, which is presumably why, but the queue then needs refreshing on some schedule.
- `pipeline.mts`'s outreach step still describes the old 20/40/70/100 ramp and declares
  `needsKey: "RESEND_API_KEY"`, while outreach sends over Gmail SMTP.
- Both ramps record a day as run even when the combined ceiling left no headroom, so a rung can advance on a
  day nothing went out. Latent today: the listing ramp tops out at 30 of the 50.
- `deliverable.ts` treats `ESERVFAIL` as "this domain does not exist", which is fail-closed (an address is
  dropped, never wrongly mailed) but is the opposite of what the module says it does with a resolver that
  cannot answer.
- A fresh checkout still has no `node_modules` at the root or in `backend`. Raised by the fifty-second run and
  every run since; this one ran `npm install` in both before anything could type-check.
- Still open from the seventy-second run: the confirm screen's failure line has not been seen at 400px.

## 25 September 2026, seventy-sixth run (10:14 to 10:45 UTC)

**Chosen, and why.** Every area in this run's brief is on the Verified list and nothing has landed since the
last entry, so the rehearsal was skipped: the seventy-fifth run left it green at 57 of 57, and no commit since
has touched `backend/src`, `src/` or the scripts. The hour went to the one line on Not yet checked that names a
guest-facing surface rather than a question: deals and promos on a listing, where only the rules had been read
and nothing had been swept or driven. 36 listings publish 47 deals; a deal is the second thing on the page
after the price, and a wrong one is a discount a guest turns up expecting and does not get.

**Found and fixed.** Four.

- **An offer that dates itself was published all year** (`3dbf6be1`). `consolidateDeals` already drops a
  holiday whose date has passed and reads nothing else about when an offer runs, so a shop's own window went
  straight through. On 25 September the catalog was advertising "$5 off regular priced tickets every Monday
  Morning ... during the months of July and August" and "50% off bay cruises every Monday this summer".
  `src/lib/deals.ts` is the one rule now: a month range wrapping past December, a list a sentence names as its
  window, and a season an offer claims for itself ("this summer", "all winter"). A season used as a name
  ("Summer Splash"), the ordinary word "may" and a deadline to book by are left alone. The sync reads it when
  it publishes and the three app surfaces read it again when they draw, so a listing already shipped stops
  advertising a closed window without waiting for a sync. Over the 47 shipped deals it drops 2 and keeps 45,
  the "this fall" offer among them.
- **A deal whose hours run past midnight could never be on** (`ae305c7a`). `promoOn` read the window as two
  clock times inside one day, so a Friday happy hour from 9 PM to 1 AM was off at ten in the evening and off at
  half past midnight. Read now the way a shop open past midnight already is. Latent: no shipped deal runs such
  a window, but the crawl reads "happy hour" and a time range.
- **A card shortened a deal badge the sync had published whole** (`48279e29`). The sync cuts the compact badge
  on a whole word at 48 characters; `liteDealTitle` cut again at 40, a cap the sync does not use, and added an
  ellipsis for it. 3 of the 12 shipped badges sit in that band and none had been cut: "$25 off your rental on
  Mondays and Tuesdays" was drawn as "$25 off your rental on Mondays...", losing a day the shop offers. The
  side that knows now says so: `compactDeal` marks what it cut, the card draws what it is given. The function
  moved to `src/lib/deals.ts`, where the app suite can reach it; it was a pure string function living in a
  component and had never had a test.
- **The Deals section was the one place an em dash reached a guest** (`a7186b2d`). `tidyDashes` has run over
  specs and highlights since the sweep that wrote it; deals never went through it, so 9 of the 47 deals on 7
  listings print the shop's own long dash. Wiring it in turned up the second half: a day of the week and a
  clock time were not read as ranges, so "Rentals Sunday - Wednesday" would have been published as two
  sentences, and the Seattle Aquarium already ships "Open daily 9:30am, 6pm, 365 days a year", which was a
  range. Both halves land together.

**Swept and clean.** All 47 shipped deals, title against day list: every one agrees, including the six written
as a range and the two written as weekdays or weekends. The promo crawl's day reader is looser than the sync's
(`daysIn` takes a bare "sun"), but the crawl's day list is never read: `readPiece` re-derives days from the
sentence, which is why "watch the sun sink off O'ahu" is an every-day deal and not a Sunday one. Every promo
code against the deal it is printed on: one orphan, below. The Deals section driven in a real Chromium at
1440px and 400px over six listings, including the three-deal and the now-empty cases: no sideways scroll,
nothing past the edge, no console error of the app's own, and the two dated offers gone from the page.

**Verification.** Both type checks clean (TS5097 aside). Backend `npm test` 789 pass, 0 fail, 2 skipped, up 3
on one new file and three new cases in `tidyDashes.test.ts`. App `npm test` 855 pass, 0 fail, up 5 on two new
files. Every new test was run against the code before its fix. A fresh checkout still has no `node_modules` on
either side; this run installed both before anything could type-check.

**Needs Harshil.**

- **Two listings contradict themselves in their own deals.** Uinta Recreation publishes "15% off tours, Monday
  to Thursday" and "20% off tours, Monday to Thursday" side by side, from two of its own pages; Paddle Tap
  publishes "40% off on Sundays" beside "40% off" every day. Both are the shop's own words on the shop's own
  site, so this is a supply call, not a rule: pick the better-evidenced one, or show both.
- **A promo code sits on an offer whose sentence never names one.** VIP Lake Travis's "4th hour free on boat
  rentals" carries "Code: SUMMER26", picked up from another fragment on the same days. Plausible and possibly
  right, so it was left alone.
- **A deal a guest cannot actually have.** Duffy Boats' "50% off your rental on Tuesdays" needs "a valid work
  ID, badge, or proof of employment". The detail says so and the title does not.
- **Whether a cash discount is a deal at all.** Skydive Tecumseh's "3% cash discount on weekends" is the shop
  saying its card price is higher, and its days come from a clause about which slots are bookable.
- **A second tier is read and dropped.** "30% off Monday-Thursday rentals, 15% Friday, Saturday" publishes the
  30% and never the 15%, on both of Uinta's deals.
- **What the shipped files still carry.** The dash fix and the badge's cut mark are written by the sync, so
  the 9 dashes and the 12 badges clear on the next one. A badge already shipped that really was cut keeps its
  words and loses only its ellipsis until then.
- Still open from the seventy-second run: the confirm screen's failure line has not been seen at 400px.

## 25 September 2026, seventy-seventh run (11:21 to 12:05 UTC)

**Chosen, and why.** Every area in this run's brief is on the Verified list, so the hour went to the one
guest-facing line on Not yet checked that nobody had swept: where a listing says the guest has to go. The
"Where you'll be" card, the "Get directions" row and the chain venue grid are the last thing a guest reads
before they set off, and a wrong one costs them the afternoon. The rehearsal was run rather than skipped,
because the commits touch `src/`, and running it is what turned up the third fix.

**Found and fixed.** Three.

- **"Open in Maps" sent 5,018 listings' guests to the middle of a town** (`ebf50643`). `mapsHref` searched for
  whatever `addressLine` returned, and on 5,018 shipped listings that line is only the town again, or a bare
  state code, because `streetOf` refuses what the crawl stored (a house number with no road, the town repeated,
  a phone number). 1,210 of them searched two letters: "Open in Maps" on 1515 Lincoln Gallery's page opened
  Oklahoma, with the gallery named nowhere in the query. The phone sheet's own query has kept the business name
  in that case since it was written, so the desktop listing page and the desktop confirmation now build the
  same string, which is also the one both pages already used when there was no contact record at all. The
  chain venue grid takes the same rule one row down, in `venueMapsQuery`: a street is searched by itself, a
  town with no street keeps the chain's name in front of it, a bare pin is still searched by its coordinates,
  and a row with neither no longer searches for "null,null".
- **The listing page measured a distance from a state's middle and from a partner's shared pin**
  (`b8d574d0`). The cards have refused both since they learned to print a distance: a picked state or province
  is one pin in the middle of it, and a partner's product carries the coordinate its API gave for the whole
  destination. The desktop listing page measured from `state.near` whatever it was, so the page a card opened
  read "143 miles from Florida" under a card that printed no distance at all, and "2 miles away" on any of the
  6,492 Viator listings, which between them hold 49 distinct pins, 160 products to a pin. The rule is
  `measurableFrom` in `components/explore/feed.ts` now and both surfaces read it, so they cannot drift again.
- **The guest app had not built from main since 10:37 UTC** (`44b43484`). `npm run build` starts with
  `tsc -b`, and two errors landed behind the one command that does not see them: an import of `liteDealTitle`
  left behind when `compactDeal` moved to `src/lib/deals.ts`, and `zoneFor`'s null reaching `monthIn`, whose
  parameter took `string | undefined`. Neither shows in `tsc --noEmit -p .`: the root `tsconfig.json` is
  `"files": []` plus two references, so that command compiles nothing at all and answers clean whatever is
  broken. The rehearsal's own type check is what caught it, three hours after the seventy-sixth run reported
  both type checks clean. The unit suite now runs `tsc -b` itself, so the next one costs a second, not a deploy.

**Swept and clean.** Every one of the 52,816 shipped detail files through `streetOf` and `addressOf`: 46,324
carry a contact record, 41,306 of those a street the page can print, and none of the 5,018 without one is left
with an empty query. The 3,189 listings that publish a meeting point, against what the two surfaces print and
link: both name the meeting point in bold and the address under it, and both link the address, so they agree.
The 464 venue rows on the 180 chain listings: 1 has a town and no street, 19 are a bare pin, none is empty. The
6,492 partner rows, all of which carry a coordinate and share 49 of them. `awayLine`, `nearestLocation`,
`mapsDirHref` and the phone sheet's directions row are unchanged and were already right.

**Verification.** The rehearsal was run, twice: 56 of 57 before the type fix and 57 of 57 after, against a
local Postgres 16 on 5433 with TLS on and the Chromium on disk. `tsc -b` clean on the guest app and the backend
type check clean. Backend `npm test` 789 pass, 0 fail, 2 skipped, unchanged: nothing under `backend/` was
touched. App `npm test` 868 pass, 0 fail, up 12 on three new files. Every new test was run against the code
before its fix: the old `mapsHref` answers "OK" and "St. Petersburg, FL" where the new one names the shop, the
old venue query answers "Arlington" and "undefined,undefined", the pre-fix `WebListing.tsx` fails the coupling
guard on both lines it used to measure from, and the type guard fails when either error is put back.

**Needs Harshil.**

- **`npx tsc --noEmit -p .` on the guest app checks nothing.** It is in this run's own brief and in every
  previous run's verification line, and it has always been vacuous: the root `tsconfig.json` has no files of
  its own. `npm run typecheck` and `tsc -b` are the real ones. The brief should say so, or the root config
  should carry the app's files.
- **Wheel Fun Rentals says "40 locations" and draws 24.** The grid is capped at 24 and the heading counts the
  whole list. One listing today, so it was left alone rather than changed on a guess about which number is
  the honest one to print.
- **A meeting point that names a different street from the address is not what the Maps link opens.** 3,189
  listings publish a meeting point and a handful of them name several ("Fishing and dive charters depart from
  Bayview Harbor or Light House Marina ... depending on the trip"). The address is printed under it either
  way, so nothing is hidden, but which one a guest should be driven to is a product call.
- Still open from the seventy-second run: the confirm screen's failure line has not been seen at 400px.

## 26 September 2026, seventy-eighth run (05:14 to 06:05 UTC)

**Chosen, and why.** Every area this run's brief names is on the Verified list, but five commits have landed
since the seventy-seventh entry and two of them are new code no run has read: the Cohere grounded fallback
behind Otto (`c7aec11e`, 03:44 UTC) and the Otto outreach ramp (`c132d2d1`). The fallback is the first thing
in this product that writes a sentence to a guest rather than quoting one, and the ramp is the thing that
mails real shop owners, so the hour went to those two. The rehearsal was run rather than skipped, because
those commits touch `backend/src`, `src/` and the scripts.

**Found and fixed.** Four.

- **A grounded answer lost every word in front of a decimal price or a domain** (`9520f9b7`). `sentencesOf`
  splits the model's text so `keepCited` can check each sentence for a citation, and `keepCited` joins the
  sentences it keeps into the answer a guest reads. Its regex could not match a run containing a full stop,
  so on "Adults are $34.50 per person." it matched nothing until it had walked past the stop, and the answer
  that reached the guest was "50 per person." A waiver answer came out as "com/waiver.", and "9 a.m." as
  "m." Prices with cents and the shop's own domain are both everywhere in the facts, and rule 2 of the prompt
  tells the model to quote them exactly, so this was the ordinary case. The splitter now walks the text and
  ends a sentence only where a stop is followed by a space or the end, stepping over the stop that closes an
  abbreviation.
- **The app suite was red on a Saturday** (`5f498f55`). `ottoChips.test.ts` pinned "what time do you open?"
  to 9 AM, and that question is answered with today's own span; the fixture opens at 10 on Saturday and not
  at all on Sunday. 870 of 871 at 05:20 this morning, and nothing to do with the product. The dayless
  question is asserted as a shape now, and three questions naming a day pin the hours themselves.
- **The outreach day began an hour out on the two days the clocks move** (`a0599fc0`). `dayStartIso` took
  the offset as the gap between Toronto's wall clock and the instant, which is not what it is on a changeover
  day. Against every day of 2026 at five times each it was wrong on 8 March and 1 November. November is the
  one that costs: any mail sent in Toronto's first hour fell outside the window `sentToday` counts, so the
  ramp read low and could put that many over the 50 a day the one Gmail identity is held to. It goes through
  `todayIn` and `instantOf` in `lib/zone.ts` now, which the shop clocks already use.
- **A cached Otto answer could belong to somebody else's conversation** (`4b899c21`). `POST /otto/ask` keyed
  its cache on the listing, the question and the facts. The last six turns also go to the model, so a guest
  asking "and for kids?" after the sunset sail and a guest asking the same three words after the snorkel trip
  hashed to one key, and the second was handed the first one's answer.

**Swept and clean.** `companyFacts` over all 52,815 shipped detail files, against the four caps
`POST /otto/ask` rejects a body for: none exceeds 40 facts, 1,500 characters in a fact or 24,000 in total
(worst is 5,759, `o-orcaspirit-com`, and the client clips each fact at 1,400 of its own), and it threw on
none of them, so no shop silently loses the fallback to a 400. The refusal gate, which AGENTS.md makes a hard
rule: a refusal returns from `companyAnswer` before `gap` is set and `GAP_LINE` cannot match its wording, so a
forecast, another business, a drive or a review never reaches Cohere, and `assistantOn` being false (a partner
product, a shop that switched Otto off) leaves no pending bubble for the fallback to settle. `dayStartIso`
over 1,825 instants after the fix, all right.

**Verification.** The rehearsal was run twice, 57 of 57 both times, against a local Postgres 16 on 5433 with
TLS on and the Chromium on disk, with no Stripe, mail or GitHub key. `tsc -b` clean on the guest app, the
backend type check clean. Backend `npm test` 813 pass, 0 fail, 2 skipped, up 5. App `npm test` 871 pass,
0 fail, where the same suite was 870 and 1 this morning. Every new test was run against the code before its
fix: the old splitter answers "50 per person." and "com/waiver.", the old `dayStartIso` puts 1 November at
05:00 UTC, and the old cache key hands the second conversation the first one's answer.

**Needs Harshil.**

- **`chipsFor` reads `item.includes.length` with no `?.`**, where all eight of its siblings use one. All
  52,815 shipped detail files carry the field, so nothing reaches it today and it was left alone rather than
  changed on spec; a hand-built listing or a record assembled without it would throw inside Otto's chat.
- **A price the model reformats is dropped in silence.** The number check requires every digit run of a
  sentence to be in the facts, so a shop publishing "$85" and a model writing "$85.00" loses the sentence.
  It fails the safe way, to the rules' own line, but it fails on the exact question the fallback exists for.
- **This container's `main` was stale against a force-updated remote.** Local `main` sat on `c3a9bfd0`, five
  "Otto page" commits that are not an ancestor of `origin/main`; the fetch reported the remote branch forced
  back to `c5fac65c`. Tonight's work was committed on the detached HEAD and pushed to `origin/main`, and the
  stale ref was left exactly as it was rather than moved. Worth a look if any of those five was wanted.
- Still open from the seventy-seventh run: `npx tsc --noEmit -p .` at the root compiles nothing, so the brief
  should ask for `npm run typecheck`. The confirm screen's failure line has still not been seen at 400px.


## 26 September 2026, seventy-ninth run (06:15 to 06:50 UTC)

**Chosen, and why.** The one line on Not yet checked that names code which mails a real business unattended:
"The Otto outreach ramp end to end: `otto-ramp.mts`, `outreach-handoff.mts` and `outreach-daily.sh` are
read, but no draft run, dry run or hand-send has been driven from here", and beside it the outreach list
script. Everything the brief names is Verified, nothing has landed since the seventy-eighth entry, and an
email that goes out wrong is the thing an operator cannot unsee. So the hour went to driving the outreach
path rather than reading it: a local SQLite seeded with nine operators, `generateOttoDrafts`, both queues,
a dry run, the handoff export and `outreach-list.mts`, all with every key empty.

**Found and fixed.** Five defects across four commits.

- **Every listing email the ramp sends lost the sentence that personalises it** (`0c8ea149`). A queue row
  joins two tables and so holds two ids. `ottoQueue` names the operator's `o.id AS opid` and uses it;
  `listingQueue` selected only `d.id`, and `sendOutreach` handed the whole row to `composeOutreach`, which
  reads a page's facts by `op.id`. So every send looked up an operator that does not exist. An owner with a
  cover, four photos, two FareHarbor-priced trips and a cancellation policy on file was offered "a complete
  page, all set up and ready to go" instead of "a complete page using services, your photos and your
  cancellation policy", and the line saying the prices came from their own FareHarbor listings was dropped.
  Nothing showed it: the draft stored in SQLite is written from the operator and still carried the good copy,
  `--dry` prints only the subject, and the `--to=` sample branch fetches `SELECT o.*`, so a sample to
  yourself read correctly while the batch did not.
- **The handoff export ran with none of the pre-send checks** (`e757df1e`). It writes a CSV of composed
  emails for a person to send by hand and marks each row so the ramps skip it. Driven here with no
  `DATABASE_URL` and no `CLAIM_SECRET` it exported three targets, marked all three and would have mailed the
  file, while the suppression list could not be read at all, every unsubscribe link was signed with a secret
  this machine had just invented, and the footer carried no postal address. It printed none of it. Both send
  paths refuse in exactly that state.
- **The outreach list's suppression clause was backwards** (`1e777e91`). `lower(trim(o.email)) not in
  (select email from mail_unsub)`: that table stores a hash and has no `email` column, and SQLite resolves
  the name against the outer query instead of failing, so the subquery became `select o.email`. Empty it
  suppressed nobody; with one row in it, it kept an operator only when its stored address was not already
  lower-cased and trimmed, so the list emptied of nearly everyone. It reads the hashes now.
- **Every `listing_url` in that list was dead** (`1e777e91`). It pointed at
  `https://onoutset.com/listing/<slug>`, a path this site has never served, built by a second hand-rolled
  slug that differed from `catalogId` besides. It is `/#o=<catalog id>` now.
- **A day the ramp sent nothing climbed a rung** (`c5beca30`). Both ramps recorded the day at the end and
  counted those days as the rung, so a day with no headroom left under the combined 50, or an empty queue,
  stepped the ramp up for mail that never went out: a first ever run that came to nothing put the next
  weekday on 25 having sent not one email. The two scripts were line-for-line copies of the same state
  handling, so it moved to `src/outreach/ramp.ts` to be tested. `ranDays` still answers "has this already
  run today"; `sentDays` answers the rung, and an existing state file keeps its place.

**Swept and clean.** `generateOttoDrafts` over nine seeded operators against the four exclusions it claims: a
government-run marina by name, a shop with no phone, a business filed outside `family = 'water'`, and a role
inbox scraped off somebody else's domain (a river walk listing a Legoland address), all four correctly out,
and two operators sharing one inbox correctly one draft. The dry run leaves every row as it found it.
`dayStartIso` on a Toronto midnight, `GET /outreach/drafts` against the admin gate above it (closed, and the
Host-header hole already fixed), and the weekend exit on both ramps.

**Verification.** Backend `npm test` 829 pass, 0 fail, 2 skipped, up 16. App `npm test` 871 pass, 0 fail.
`tsc -b` and `tsc --noEmit -p .` clean on the guest app, the backend type check clean but for TS5097. The
full rehearsal was run, because the four commits touch `backend/src` and `backend/scripts`: 57 of 57 against
a local Postgres 16 on 5433 with TLS on and the Chromium on disk, no Stripe, mail or GitHub key. Every fix
was driven against the code before it: the old send path writes the generic sentence where the stored draft
writes the specific one, the old handoff exports and marks three rows in silence, and one row in
`mail_unsub` drops an operator whose address is stored tidily.

**Needs Harshil.**

- **The listing campaign has been sending the weaker email all along.** It is paused since 25 September, so
  nothing has gone out wrong since the fix, but every listing mail before that said "a complete page"
  where it meant to name the shop's own photos and prices. Worth knowing before judging that campaign's
  reply rate.
- **Anyone already handed off may have had a dead unsubscribe link.** If a handoff CSV was ever exported
  from a machine without `CLAIM_SECRET`, the unsubscribe link in those bodies cannot be verified by the API
  and the footer had no postal address. `backend/data/exports/` on that machine says whether one was.
- Still open from the seventy-eighth run: local `main` sits on `c3a9bfd0`, five "Otto page" commits that
  `origin/main` was force-updated away from. Tonight's work is on `origin/main`; that stale ref was left
  alone again. The confirm screen's failure line has still not been seen at 400px.


## 26 September 2026, eightieth run (07:14 to 08:35 UTC)

**Chosen, and why.** Nothing has landed since the seventy-ninth entry, so every area the brief names is still
Verified and the hunt went to Coverage's open list. The line it started from was the browser's own controls on
the guest app, which nothing in 6,000 lines of this file has ever driven: the tab, the bookmark, the history
entry, Back and Forward, and the four hashes our own links carry (`#o=`, `#remove=`, `#claim=`, `#paid=`). A
link is the only thing a guest or an operator ever holds on to, and 26 September is the day a store asked to be
taken down, so the shape of a link outliving its listing was worth an hour on its own.

**Found and fixed.** Four defects, four commits, all of them a link doing the wrong thing.

- **No page in the app ever had a title** (`e01d36da`). `document.title` is set in exactly one place in the
  whole app, the admin metrics screen, so every listing a guest opened read "Book things to do near you ·
  Outset", the title `index.html` ships. Four listings open were four identical tabs, a bookmarked shop was
  filed under the home page's name, and the history entry for a listing named no business at all. A hash route
  fires no page load either, so nothing told a screen reader the page had changed. The static `/l/` page for
  the same shop has always been titled by the business, so one listing had two names depending on who fetched
  it. The title now follows the same state the address bar follows, in the static page's own format, and a test
  pins the two formats together so they cannot drift apart again.
- **A link to a listing the catalog no longer holds left the guest on a stuck, blank screen** (`6e8fa944`).
  The app opens the request sheet straight from the hash, before any catalog, so a link paints the listing
  rather than the home, and `ListingSplash` covers the gap until the catalog is in. Nothing ever closed that
  sheet again when the listing turned out not to exist: the splash stops at `catalogComplete` and leaves an
  open listing screen with no listing on it and the home showing through, the dead `#o=` still in the address
  bar for every refresh and bookmark after it, and not a word said. Every sync drops listings (the 23
  September one published 10,927 fewer) and a business can ask to be taken down, while the bookmarks, shared
  links and the listing links in our own outreach mail keep pointing at them. The sheet now closes once the
  catalog is in and the listing's own file has also failed to produce it, which clears the hash through the
  effect that already owns the address bar, and the guest is told the listing is no longer on Outset. The
  decision waits on the listing's own fetch rather than reading the catalog the moment it completes, because
  the two are fetched side by side and either can land first.
- **A claim link for a dropped listing made the owner wait a minute to be told** (`50ccdec5`). The link check
  polls for the listing 120 times at half a second, because the catalog and the detail file can be slow. It
  had no way to tell "still arriving" from "not coming", so an owner whose listing a sync had dropped since
  the mail went out watched "Opening your dashboard..." for a full minute before falling through to the form
  that has always had the right words for it. The catalog being complete without the listing in it is that
  difference: 2.8 seconds now, with "We couldn't find the business named in that link". A listing that is in
  the catalog but whose detail file has not landed keeps its full minute.
- **A listing link whose id had been shouted opened nothing** (`a5578b12`). Every regex that reads an id out
  of the hash is case-insensitive and all 52,815 shipped ids are lower case, so `#o=O-ALCATRAZTOURSF-COM`
  names a real listing and resolved to nothing. Harmless while it was silent; with the fix above in place the
  app would have told that guest their listing was gone while it sat in the catalog. Every id off the hash
  goes through one function now, and a test holds the catalog to the lower case that makes it safe.

**Swept and clean.** Markup left in the words a guest reads: every string in all 52,815 shipped detail files
against HTML tags and markdown, then every field that carries any traced to the function that prints it.
Twenty-one field-and-fault pairs turn up in the data (229 service descriptions with a bold run, 60 partner
cancellation policies with a `<br>`, 24 review authors signed `<strong>`, an hours line opening `**`) and every
one of them goes through `tidyLine`, `plainWords`, `stripTags` or `tidyHours` before a guest sees it. The
"More options" fold driven again at 1280px and 400px on both surfaces, this time for its button rather than
its rows: the count, `aria-expanded`, the flip to "Fewer options", focus staying where it was pressed, and no
sideways scroll either way. That no shipped service folds every tier away, re-measured: 61,614 services with
variants, 186 with a fold, 0 fully folded. Back, Forward and a refresh across the home and a listing. `#remove=`
on both widths, which does open the removal panel on a phone.

**Verification.** App `npm test` 888 pass, 0 fail, up 17. Backend `npm test` 829 pass, 0 fail, 2 skipped,
unchanged. `tsc -b` clean on the app, the backend type check clean but for TS5097, `tsc --noEmit -p .` clean and
still compiling nothing. The full rehearsal was run because all four commits touch `src/`: 57 of 57
against a local Postgres 16 on 5433 with TLS on and the Chromium on disk, no Stripe, mail or GitHub key. It
earned its keep on the first pass: three of the tests written for the second fix pinned the exact source text
of lines the fourth fix then rewrote, and the rehearsal is what said so. They pin the intent now, and the run
above is the clean one after that. Every fix was driven against the code before it in a real Chromium: the old
build leaves `#o=o-sandboxvr-com` in the address bar with the home showing through at both widths, and the old
claim link was still saying "Opening your dashboard..." at eight seconds.

**Needs Harshil.**

- **The desktop site has no way to say anything in passing.** `<Toast />` is rendered only inside a
  non-request sheet, and `.toast` is `position:absolute` tuned for the phone frame, so a toast dropped into the
  desktop tree would land at the bottom of the document rather than the viewport. The new "That listing is no
  longer on Outset" line therefore reaches the phone and not the desktop, where the guest gets a clean home
  and no words. Giving the desktop a notice needs `src/styles`, which an overnight run may not touch.
- **The dashboard's own tab is still titled for guests.** The title fix covers the listing a guest opens,
  because that is what gets shared and bookmarked. An operator with the dashboard open all day still reads
  "Book things to do near you · Outset", and naming their shop there means reaching the signed-in profile from
  the provider.
- Still open from the seventy-eighth run: local `main` sits on `c3a9bfd0`, five "Otto page" commits that
  `origin/main` was force-updated away from. Tonight's work is on `origin/main`; that stale ref was left alone
  again. The confirm screen's failure line has still not been seen at 400px.


## 26 September 2026, eighty-first run (07:55 to 08:55 UTC)

**Chosen, and why.** Nothing has landed since the eightieth entry, so every area the brief names is still
Verified and the hunt went to Coverage's open list. The line it started from is the one that shows before a
guest clicks anything: the "from" price on a card. Two items on that list name it (a marina quoting $2.15,
which is a rate per foot, and a zoo quoting $2 for a stingray touch), so the sweep read the cheapest priced
row of all 10,208 shipped listings that have one and asked what each of those rows actually is.

**Found and fixed.** Two defects, two commits, both of them a price quoted off a row a guest cannot book.

- **285 listings offered a year of the place as the thing to book, and 102 priced their card from it**
  (`146b65d3`). The sync already refuses a membership, a season pass and a gift card as a service, and said
  nothing about `options`, which is where the booking box gets its rows when a listing has no services to
  show. 220 shipped rows are named plainly "Memberships"; on 74 listings it is the only row there is, so the
  sheet preselects it and asks for a date and a party. Goulbourn Museum would take a Saturday booking for two
  on an individual annual membership, and its card said "From $10" while the page it opens listed no such
  service at all. The rule lives with the other menu rules now (`bookableRow`), so every record the app loads
  is right without waiting for a sync and the next sync stops writing them. A row that names a single visit as
  well keeps its place, because that price is the shop's own and real: 18 rows, among them a $5 teen swim at
  Revelstoke, a $49 weekday court at River Trails and a $35 studio session at The Glass Bar. The sync's own
  service filter reads the same rule now, so the two lists agree in both directions rather than one.
- **The static pages never ran the app's menu rule at all** (`a578b609`). `build-pages.mts` reads
  `public/catalog.json` and `public/o` straight and hands them to the page writers, so the page a search engine
  and a shared link open kept offering what the app had stopped offering. It shipped clean only because the
  last sync had already cleaned the archive rows out of the data; the fix above would have put 283 pages back
  out of step on the next deploy. `priceOf` also mixed the browse record's `from` into one minimum with the
  menu, so a `from` an earlier sync computed off rows the menu no longer carries could undercut it: 23 pages
  would have quoted a membership price the listing had stopped offering. It is the fallback now, the rule
  `fromPrice` reads in the app, and the two agree on all 52,816. 51 listings lose their page, every one a shop
  whose only priced row was a membership and which has under five reviews, so by the generator's own rule there
  was nothing left on it for a guest to act on.

**Swept and clean.** The cheapest priced row of every listing that has one, by name, for what it is: gear
rental, a fee, merch, food and drink, a moorage rate per foot and a stated discount all turn up, all of them
already on your list from earlier runs, and all left alone. That no service tier anywhere
points at a row this dropped (0 of 141,717), so the re-pointing `bookableMenu` does was never exercised by it.
That the page and the app quote the same number on all 52,816 listings, before and after. Both fixes driven in
a real Chromium at 1280px and 400px against the code before them: the old build shows Goulbourn Museum's
"$10 Memberships" row and "From $10", the new one shows the honest page it has always had underneath ("Tickets
are sold by the business. Prices and times on their side"), with no sideways scroll either way, and Revelstoke
unchanged at both widths.

**Verification.** App `npm test` 893 pass, 0 fail, up 5. Backend `npm test` 831 pass, 0 fail, 2 skipped, up 2.
`tsc -b` clean on the app, `tsc --noEmit -p .` clean at the root and still compiling nothing, the backend type
check clean but for TS5097. The full rehearsal was run because both commits touch `src/` and `backend/src`:
57 of 57 against a local Postgres 16 on 5433 with TLS on and the Chromium on disk, no Stripe, mail or GitHub
key. A fresh checkout has no `node_modules` on either side, so both were installed first, which is the
fifty-second run's Needs Harshil still standing.

**Needs Harshil.**

- **Four listings quote a price their own menu does not show, until the next sync.** Revelstoke, River Trails,
  The Glass Bar and o-wmwellnesscenter-com are the four whose "Admission & Memberships" style row this run
  chose to keep: their card and page quote it, and their service list does not carry it because the old sync
  filter dropped the group. The sync fix lands that row on the menu, so the next sync closes it. Nothing to do
  but run one.
- **The cheapest row of any kind is still what a card quotes.** The sweep re-met the four families the
  forty-fourth and fifty-seventh runs already put on your list and left every one of them alone, because each
  is a supply judgement rather than a rule: gear and fees ("Shoe Rental" $3, "Pull Cart Fee" $2, "Tire
  Disposal" $2, "Tee Time Reservation Fee" $4.95), merch ("Retail Items" $3, "Souvenirs - Home Decor" $3.99, a
  $12 keychain at LAA Art Collective), a brewery's food and drink menu ("Side Salad" $2.99, "Shots" $4.50,
  "Snacks & Things" $4.75), and a marina's rate per foot ("Guest Moorage" $2.15, "Transient Docking" $4).
  Memberships were the one family in that sweep that the sync had already ruled on, which is why this run could
  act on them without asking: it applied a decision you had already taken to the list it had never reached.
- **A charter deposit is the one the rule could not call.** 19 option rows name a deposit, and the sync drops
  every one of them from the service list while leaving it in the options: "Spring Seabass Open Boat Deposit"
  and nine more at Jersey Nutz are how that shop sells its trips, while "Damage Deposit" and "Room Clean-up
  Fee (Deposit)" are not. Deciding which is a supply call, so `bookableRow` was left saying nothing about
  deposits and the two lists still disagree on those 19.
- Still open from the seventy-eighth run: local `main` sits on `c3a9bfd0`, five "Otto page" commits that
  `origin/main` was force-updated away from. Tonight's work is on `origin/main`; that stale ref was left alone
  again. The desktop site still has no way to say anything in passing, and the confirm screen's failure line
  has still not been seen at 400px.


## Coverage

The catalog is 48,198 listings as of the 23 September sync, 1,873 of them Viator partner rows. Counts below
that name 59,125 were taken before that sync and were whole at the time.

**Verified so far.** What a card's "from" price is actually a price for, over the cheapest priced row of all
10,208 shipped listings that have one: a membership, a season pass and a gift card are refused everywhere now,
and the static pages read the same menu rule and the same price rule the app reads, checked over all 52,816.
The name a guest reads: the business name on all 59,125 shipped listings, against the
card, the page and the lite record alike, and the row name on all 141,717 shipped options, services and
add-ons. The concierge's vendor table against the catalog's own, over all 1,664 shipped booking links.
Booking validation and odd input on every route that takes it. The money split,
pay-on-site pricing, the service fee tiers. Double booking past capacity, and party size against a time's
capacity. Payout scheduling, cycles and the payouts tiles. The Stripe Connect button. The booking and decision
emails. The rehearsal itself, which runs both sides' unit tests and now refuses to run against a server it did
not start. Start times from a claimed shop's hours: odd hours, days off, blocked slots, the notice, the window,
a shop open past midnight. The week a shop starts on, read from its own published hours, and the hours a
claimed shop shows a guest. The Hours block an unclaimed shop shows a guest, over all 14,810 listings that
publish one and on all four surfaces that print it, the static `/l/` page included: every shape of
OpenStreetMap rule those lines carry, the site builder's whole-day placeholder that the open-or-closed line
already refuses, a season or a date written in front of a rule, two spans in one rule, the syntax's own
keywords and separators, and the shop's own words kept where they are theirs, every line diffed before and
after over the whole catalog. The booking box price lines, including a service with no price. Phone width at
400px on the guest listing, the booking flow, every dashboard page, and the Trips, Inbox, chat and Profile
tabs. Accessibility on the booking flow and on the assistant chat: focus order, input labels, disabled buttons.
Colour contrast on the accent. What Otto actually has in hand when it answers: that all three surfaces which
ask it a question fill in the shop's own booking calendar, that a claimed shop's empty vendor window does not
close it, and that a listing whose owner paused bookings or took it down is never told to a guest as bookable
here. The API unreachable and the API slow. The Availability page and the setup
checklist counting itself. Search and browse: a query matching nothing, a metro with one listing, a category
with none, paging, an unpublished or paused listing staying out of the lists, and every way out of an empty
search. Claim and sign-in: an address that does not match the business, an expired link, an edited expiry, one
listing's link used on another, a link claimed twice, a sign-in code typed wrong six times, and a session for
one listing used on another. The desktop home's search pill as controls rather than dialogs: what Who,
When and Where each actually change, and whether the party a guest picks reaches the box they book in. Every
"Show N places" button on the home, against the list the page then draws. Every service name and price tier
label the crawl holds, through the module that rewrites them for a guest (`plainServices.ts`). That no screen
in the app prints an em dash, now a test of its own. What a guest actually gets back for what they type,
ranked, over the whole shipped catalog: every kind against every metro and against the 90 busiest towns that
are not one, a glued spelling both ways round, a place name whose halves are two words, a town that is not a
metro, and every activity, elsewhere and city row pressed against the page it opens.

Every dashboard page driven in a real Chromium at 1280px, 400px and 360px, for sideways scroll, anything
past the edge and a control with no name, including the five a phone keeps behind More. Calendar, Services
and Availability clicked rather than read: a slot blocked and reopened, a day taken off and given back, a
service added, an option left unpriced and an option priced at zero, an opening time pushed past the closing
one, and a day switched off. A brand new claimed shop with nothing filled in, over all nine pages, with both
setup checklists counted against the items listed under them. The claim link itself, which decides who gets a
session for a shop: one listing's link on another, an expired link, an edited expiry, a forged signature, a
token with trailing data, the legacy static tokens, and CLAIM_LINK_DAYS.

Dashboard Calendar end to end: blocking a slot and a day, both reaching the guest picker and both reversible,
plus what a day off does to the bookings already on it. Services end to end: adding, hiding, deleting, deleting
every one, and a row left half typed. Prices typed into the menu editor: a negative on a service, an option and
an add-on, on both money paths. What a claimed shop with an empty menu is charged. Add-ons end to end on a
phone, from the picker to the confirmation. The Trips tab, the Inbox tab and the Account tab, with their empty
states. What a guest is told was sent to them, against what the product can actually send. Settings and
Assistant, read through.

The Wishlists tab: a cold start with saves, a saved listing switched off, the order they are shown in, and the
empty state. Photo upload on the Listing page: a file too big for the API, one the browser cannot read, a
batch over twelve, a canvas that will not open, and what a failed store tells the operator. Reordering
services, by drag and by keyboard, including giving up part way through either. Filling a fresh profile from
the crawled detail file, and what that does to a menu or a gallery the operator emptied. Hours that are not on
the half hour, through both slot engines, both Availability selects and the calendar grid. The category rail
at 400px. A catalog fetch that stalls, and a boot that throws after it lands. What actually type-checks the
two projects, and what the three commands that look like they do really run.

The phone search sheet (the metro picker) at 400px in a browser: all four cards, typed and untyped, nothing
past the edge, every control named. Service reordering driven in a browser: the keyboard model and the touch
drag, a drag given up part way, and the order surviving a reload. The compact dashboard at 400px, all nine
pages, for sideways scroll and unnamed controls. Search suggestion counts against the whole catalog: every
activity, place, elsewhere and family row pressed, none opening an empty page. Which controls the rehearsal
can still find, now a check of its own.

Every screen that is a list of ids kept in localStorage, on a cold start with the catalog held back: Wishlists,
Trips, Inbox, the Inbox badge, the operator dashboard itself and the claim screen's "Signed in on this device"
list. What a claimed shop advertises once it empties, unprices or reprices its own menu, on the cards, the
rails, the price filter, the price sort and in Otto's answers. The live guest preview beside the editor
(`OpPreview`), end to end: live edits without a reload, the read-only lock, click-to-edit jumping the editor to
the right page, and both device sizes. A claimed listing with an empty menu seen from the guest side.

The window the Free cancellation badge promises, over all 1,303 shipped badges: which clause on the policy
owns the number, which side of that clause's line it sits on, a rate card written as one sentence, a window
sold with a protection plan, the shop's own weather call and the clock it runs on, and "15+ Days", "3 or more
days", weeks and months. That the badge a guest reads is re-read from the policy rather than taken from the
`fc` the sync wrote, and that the static `/l/` page and the app now name the same window for the same shop. What a partner's own product sections say to a guest, over all 33,502 `additionalInfo` lines and every
string in the 6,492 shipped partner detail files: which of them states a rule about the guest and which about
the booking, what a product says its price leaves out, and every bare URL, email address, tag and decoding
fault in the text a partner supplies. What a card says a
listing costs, at the row that sets it: the cheapest priced row of all 10,217 listings that have one, every
row in the catalog whose words mention a deposit, a retainer or a booking fee, and all 99 rows whose own name
states a dollar figure, each held against the price the row holds. Every string in every shipped detail file
for a Windows-1252 decoding fault, through the funnel that carries it to a guest.
That every surface drawing the badge, the filter included, and a claimed shop's own typed policy all go
through one rule.

Deals and promos on a listing: all 47 deals the 36 shipped listings publish, each title against its own day
list and each code against the sentence it is printed on; whether an offer states the months or the season it
runs in, over every shipped deal and through both the sync that publishes one and the three app surfaces that
draw one; a deal's clock window, including one that ends before it starts; the compact badge a card draws
before the detail file lands, on all 12 that ship one, against the cut the sync actually makes; the long
dashes a shop's own sentence carries into the section; and the section itself driven in a real Chromium at
1440px and 400px, for sideways scroll, anything past the edge and the empty case.

Otto's scope, both gates driven rather than read, over 400 shipped listings and every answer diffed against
the old one: what a guest asks this shop in words that also name somebody else's business (a notice period
phrased "how far in advance", the nearest opening, a rating word inside an ordinary one), what must still be
refused (another operator, a forecast, reviews, a drive, who owns it), and that the gate's two copies exempt
the same topics. The `book` intent against the `cancel` one: cancelling, a refund and a reschedule read as
themselves, and a booking Otto cannot see is never called confirmed. The questions and answers a shop
publishes, over all 73 shipped FAQ entries: a Q&A page's own label, markup, entities and an empty side, on all
four surfaces that print one.

The dashboard's Settings and Assistant pages driven rather than read: the owner fields and their validation,
the booking-alerts card against a valid, invalid and missing address, the Instant Book switch, removing
samples, the Assistant switch end to end from the profile through the published patch to both guest surfaces,
the "What it knows" panel against what Otto quotes, and the test chat. "Release this listing" on the server as
well as the device, and what an operator signing in again gets afterwards. Whether an operator's edits reach a
guest's rendered listing page at all, on a cold open by link. The API's CORS allow list against every method
the app sends.

"Open now" end to end, run over the whole shipped catalog rather than read: what `parseWeek` and `encodeWeek`
make of all 14,509 published hour lines, every hour of every day, and what the cards, the listing page, the
booking sheet, the "Open right now near you" rail and Otto then say. A phone number, a date, an ISO date and a
year glued into an hours line. The three unusual ways a shop writes a time. An unmarked opening hour against a
marked closing one. That the two hour parsers, which are twins by design, agree on every operator. That a
compact week already baked into `catalog.json` that no clock could show is not believed.

Otto's grounded fallback, over the code that landed on 26 September: the sentence splitter and the number
check between the model and the guest, the route's four body caps measured against `companyFacts` on all
52,815 shipped detail files, its answer cache, and the gate that keeps a refused question away from the
model. The outreach campaign's day boundary, over every day of 2026 at five times each.

Which clock a shop's hours are read on, run over the whole shipped catalog rather than read: `zoneFor` and its
API twin `zoneForArea` against all 59,091 operators, every split-state nudge in both directions, and that the
two parsers agree on every row. How a state or province is read out of an area line, including the 4,736 rows
whose area is the code alone and the one row whose town would be mistaken for a code. What that gap was
costing: the clock, the currency a booking is charged and paid out in, the state and province rows a search
offers, the page a picked state opens, the "more like this" rail, a feed card's place line and a landing
page's list of towns.

Where the Where box gets its places, driven rather than read: the Photon geocoder killed outright, slowed
to four seconds while the guest keeps typing, and answering after the query moved on. "Nearby" on both
surfaces with the browser's permission refused and with the prompt left unanswered. The ordinary near-me path
with permission granted. What a chain's other venues are called on a card, on the listing page and in Otto's
answers, and the 64 that were called Nearby. Whether a listing is at the place a guest picked, on the desktop
home and in the phone feed, for a picked point and for a picked state or province, for a chain and for a
listing with no pin at all. The distance strings themselves, at every band boundary.

Whether a line that carries days and a time range is opening hours at all, over all 31,950 hour lines in the
shipped catalog: a campground's quiet hours and a bar's happy hour against the subjects that are trading hours
after all (office, kitchen, gate and pool hours, last admission). A span that covers the whole day and a day
named in the markup with no time at all, through the extractor, both hour parsers and the compact week already
in `catalog.json`. Every field of the published operator patch against the JSON round trip that carries it to
a guest who is not the operator: which `undefined` meant "clear this" and which meant "leave it", and what the
hours, the duration and the cover then say on a card, a hero, a booking sheet and in Otto.

The guest's card step, since Stripe's embedded checkout replaced the redirect: which page the API's own
`payNow` takes a card on (every priced booking of a dollar or more, request as much as instant book), what
each surface tells the guest about that before they press, and what the phone said that the desktop did not.
The `/config` read both surfaces and the embedded form depend on, against a first read that fails. Stripe.js
against a load that fails and a second attempt. The card dialog's keyboard: focus in, Escape out, Tab kept
inside, and the two states that replace the form announcing themselves. The Content-Security-Policy in
`index.html` against a real Chromium: which hosts an API call, Stripe.js, the embedded frame and a 3D Secure
challenge each need, and what a blocked fetch looks like to `src/lib/api.ts` (exactly like no API at all).
What the rehearsal's own mail checks are reading, and whether they can still tell two recipients apart.

Which price a guest is charged by the party and which once, run over all 44,317 priced options in the shipped
catalog rather than read: a capacity, a guide ratio and a seat count in an option's own words against the unit
its site printed, on both sides of the money path, and that the guest page and the server still answer
identically. What each surface tells a guest about that multiplication before they pay. The group size a
listing states, over all 4,040 listings that state one: a thousands separator, a floor stated as a ceiling, a
line naming both, and a line that names no ceiling at all, against the reader Otto uses for the same question.
Service tier labels that collide, over all 62,054 services shipped. Add-ons with no price, and what a blank
price in the dashboard means. Availability hours that end before they start. How long a booking runs, over all 59,162 shipped detail files:
the sync's reader, the page's, the dashboard's and Otto's against the notice periods, refund windows and
teacher trainings that sit in the same menu lines, and what a claim then does to a good crawled duration. The
"Free cancellation" badge, over all 1,314 listings that carry one: whether the shop promises a guest who
cancels anything at all, on the card, the listing page, the venue rows, the booking box and the filter.

The operator dashboard's Home feed, which the rehearsal now opens and reads the money tiles of, and which
this run read through besides: the three tabs and which one it opens on, the feed's buckets against the
Bookings page's, the setup checklist's twelve jump targets, Accept and Decline from Home, the samples
banner, the hidden and paused banners, and the empty states of all three tabs. What every page of the
dashboard tells an operator they will be paid, against the "You receive" line of their own booking email:
Home's two tiles, the calendar's week total, the booking drawer and the Payouts tiles, over all 600 prices
between $1 and $2,000 whose guest total names more than one operator price.

The reviews and quotes a guest reads, over all 1,023 shipped listings that publish one and all 4,753 review
cards they draw: what is not a guest talking (the comment form under the reviews, the shop's own banner, a
call to follow their Instagram) and what is not a reviewer's name (a link, a company, the site's rating label
or a job title run onto the end of a first name), each pinned to the listing it came from; every stored date,
every star count against the words beside it, every source label; and that a shouted review is still a review.
The bar that decides Top rated, over all 7,517 listings that publish a rating, on all four surfaces that draw
it. The count printed beside the stars, on all ten lines that print it. That a service can never fold every
tier away behind "More options". `promoOn` and `todaysDeals` against the 48 deals the catalog ships.

What a menu row is called, over all 79,406 shipped options and 62,054 services: the archive of what a shop
used to show, an FAQ heading the crawl took for a service, and a sentence it cut in half, each against the
rows that only sound like one of those (a priced escape room named as a question, "Past Life Regression").
That `options` and `services` still drop the same rows and count them the same way, so no tier points at
another trip. Whether a description is the shop talking at all, over every blurb and service description in
the catalog: a page theme's Lorem ipsum, a PDF read as text, and a lost byte printing a black diamond.

How far away a shop is, on every surface that prints it, over all 59,163 shipped listings: which unit each
country reads, that the cards, the listing page's key facts, the compare table, a chain's venue rows and the
booking sheet all answer alike, and every band boundary in both units. The group size and the minimum age a
listing states, each read by the listing page and by Otto, over all 59,162 shipped detail files: that no
listing anywhere reads two ways, and that a number beside a ceiling word which counts inches, minutes, days,
miles, kilometres per hour, pounds or dollars is never quoted as a party size or an age.

The booking box against the facts the same page prints above it. The party the picker offers, over all 1,722
shipped listings that state a group size: a stated floor, a thousands separator, a per service capacity an
operator set, and the quote a party larger than the shop takes was being given. The start times an unclaimed
listing offers, over all 14,330 listings with a readable week: every fixed time against every stated day, a
day stated as closed, a day the site says nothing about, hours no fixed time lands in, hours past midnight,
and the line under a picker with nothing in it. That the slot route, the booking route, the phone sheet and
the desktop page all read one rule for it, and that the API's reader of a shop's published week and the
listing page's return the same week on every one of the 59,162 listings that ship.


What a guest reads under "Things to know", over every shipped listing: which column each of a shop's policy
lines belongs in and the heading it is printed under, that no line is printed in two columns or lost, the
cancellation terms a shop states as a policy line rather than in `cancellation`, and the what-to-bring list
turned into sentences. The prose bullets themselves, over all 34,205 specs, 16,781 included lines, 14,382
highlights, 13,710 requirements, 6,581 bring lines, 19,364 policies and 3,194 meeting points: markup,
entities, placeholder copy, a call to action, a contact detail, a duplicate and a heading taken for a fact.
The menu glossary, over every service and variant label the catalog would explain: each of the 3,661
explanations against the activity it was printed on, and the words that mean two things in two places.

What kind of thing a listing is filed as, over all 59,163 shipped listings: every rule that reads a kind out
of a business name, against the name it reads, including the activity words that sit inside ordinary ones and
the two words that are branding rather than an activity; the same words as the evidence a kind is confirmed
by; and whether the tab a listing browses under is the one its own chip sits in. That every kind the catalog
ships has a label, an alias list and a place in the app's own `ArtKind`.

The contact block a guest reads, over all 59,162 shipped listings: the phone on every one of the 36,698 that
publish one, against the link the page builds from it (two numbers in one field, an extension, a `tel:` link
never decoded, a vanity number, a template placeholder, a number with no country we can place); the street on
every one of the 46,516 that publish one, against the town and the state printed beside it and the Maps query
built from both; the postcode; and the state a listing's area line names, as a code or spelled out.

The hours a shop's contact block carries, on every surface that prints them and in both readers that parse
them, over all 14,812 listings that show an Hours block: OpenStreetMap's own syntax, the quote marks around
"by appointment", the punctuation and the invisible characters the crawl swept up with the hours, a day run
onto the end of the time before it, a happy hour taken for a trading hour, and the rules a week is split
into. The week a claim starts a dashboard on, over all 4,482 shops whose crawled hours we hold, against the
week the listing page was already showing: an evening range read as a morning one, a close before its own
open, a week published in a syntax the prefill could not read, and the 10,508 shops whose published hours the
prefill never looked at. The email address on file for a shop, over all 14,746 that carry one: what the claim
gate hashes, what the claim screen shows a masked hint of and what the dashboard prefills as the inbox
booking alerts go to.

Outreach, the mail we send to a business that never asked for it, read end to end for the first time: the
suppression list behind every send, which of its two readers actually holds it and what a send does when it
cannot be read; the unsubscribe token, the static page it lands on, the API route it posts to, and that
route's CORS and rate limit; the Resend bounce and complaint webhook into the same list; which address a
draft may be sent to, against the reader the claim index and the sync already share; and every sentence of
the claim email against what the operator's page actually holds, on a shop with everything on it, with a
menu and no prices, with one thing and with nothing at all.

The 1,481 static landing pages under `public/p` and the generator behind them, read and then swept over
every shipped page: which listings reach a page at all, against the two flags the catalog already sets for
listings browse will not show and kinds it only guessed; every count on a page against the cards under it,
across the lede, the meta description, the FAQ, the city pills, the index and the JSON-LD; every internal
link and every card link against the page and the listing it opens; all 60,237 pill counts against the page
each one links to; every image address on every page against the scheme the page itself is served over; the
JSON-LD of all 1,481 pages parsed; and the pages at 400px in a real Chromium. The photo filters behind a
cover, against a bot check the crawl was served instead of a page.

Where the home opens on a first visit, driven rather than read: every time zone in the table against the 47
metros, an unmapped zone, a browser with no `Intl`, and what an id that names no metro does to the rails, the
Where pill and the headings. `GET /where` and what a cache may do with it. Every rule that decides whether a
crawled row gets a page at all, and both rules that pick a winner when two rows are one business, each against
a listing whose operator has claimed it: the publish gate, the name, domain and pin filters, the shared-photo
duplicate resolution, the map-pin duplicate rule, and the order `loadProfileOverlays` has to run in. The guide
copy in `src/data/guides.ts` against the kind it is printed on: all 14 blocks, orphaned keys, and the is/are in
the heading across all 64 kinds. The `/admin` metrics gate read through: both doors, the 404 for everyone else,
and that it sits above the blanket admin-key middleware on purpose.

The photographs a guest looks at, over all 59,125 shipped listings and the 244,058 photos they carry: how the
hero and the lightbox decide a picture is a repeat, on both surfaces, against one photograph linked under two
schemes, under two hostnames and at four sizes, and against the hosts that carry the image in the query
instead; which slides each surface probes before a guest can reach them, against every listing that ships more
than five; and every screen behind a published image, against the video fact, which passed none of them, and
against the beacons, spacers, payment buttons and badges that had become 70 listings' hero clip.

Every dialog in the app, driven in a real Chromium by Tab, by Escape and by the wheel: the listing's photo
lightbox and its "Show more" modal, the home's Filters, Compare and Where, when and who, the operator's
booking drawer, the card form and the phone sheets. Focus in and back, the Tab ring closed, the page behind
held still, and which surface keeps the page out of the tab order with `inert` instead.

Live departures read from the operator's own booking system, over all 1,664 shipped listings that carry a
booking link: every FareHarbor shortname, Peek program and Xola seller against the resolvers; each vendor's
reader driven with payloads shaped the way it answers; two trips leaving at one time on all three surfaces
that draw them; an open date whose times the budget never read; a departure the vendor says is full; and a
Xola button embed, which is what 45 of the 54 Xola links are.

The concierge, read through and tested for the first time: the sentence reader (what, where, when, how many,
budget) against a town, a town and its province together, two towns of one name, and a province that is also a
town; the window each of "tonight", "tomorrow", "this weekend" and "any" asks for, including a Sunday; the
shortlist's ordering, its per-head menu filter, and the answer it gives when it has nothing to shortlist; the
live FareHarbor read
against a stubbed vendor (the day range, a departure that has already left, the headline price against child
and private rates, a $0 total, a sold out day); the vendor table's account ids against a page that links to the
vendor as well as embedding it; and the `/go` page's markup, escaping and copy. Both concierge routes: their
input guards and the per-caller counting every other public route here already had.

The concierge inside the guest app, read and driven for the first time: the sentence a guest types against the
place the home already opened on, over every ordinary way of saying an hour, a day and a month rather than a
town; the overlay as a dialog in a real Chromium at 1280px and 400px, for focus in, the Tab ring, the page
behind held still and focus back to its opener; the transcript a guest copies out against what the screen
actually drew, on the price it quotes and on the shops it lists; and both watch routes, for who may read other
guests' questions and whether anyone counts them. The guest wallet end to end: the cap and its clamp, the
custom header against the CORS allow list, the id, the setup-mode webhook branch, that the browser's rule and
the server's rule agree, and the saved-card booking path against the Checkout one for the slot race, the
duplicate, the release and the payout. That the availability corpus replays the same wherever it is run.

What Otto makes of a question, read end to end rather than sampled: the out-of-scope gate against the five
topics allowed to outrank it, and the words in a "where" question that can only be somebody else's place; both
ways into the "Yes" that answers a booking request, against a mailing list and against a booking the guest
already holds; a holiday and a calendar date against the week a shop actually publishes; how old the guest has
to be against how old the boat is; and which sense of an accessibility, height, weight or dress word a
published line carries. All of it measured the same way: 19,710 answers to 30 ordinary questions over a
657-listing sample spanning the catalog, unchanged to the byte, against 5,256 answers that had to change.

The five booking-system readers that landed on 20 September, read against the trap list their own AGENTS.md
keeps: local dates rather than UTC, tax quoted as excluded, a concession fare kept out of the headline, and a
slot that has already started dropped against the shop's own clock. Which booking links reach a reader at
all, over every link the shipped `live-index.json` carries, against each reader's own URL parser. The
concierge overlay driven in a real Chromium at 400px and 1280px against a stubbed shortlist: the focus trap,
the scroll lock, sideways scroll, anything past the edge, every control named, and the shop card, the slot
rows, the narrow chips and the history panel as a guest sees them. Every class the overlay renders against
the stylesheet that dresses it, now a test of its own.

Whether the backend can be imported at all, now a test of its own: every relative specifier in every
backend source file against the disk, which is how three modules imported by one commit and committed by
nobody were found. The live booking resolve's own bookkeeping: what a failed re-check does to a link the
crawl already found, what a found link replaces, what is never re-fetched and what earns one more look.
Which fare a guest is quoted, over all 212,052 shipped menu rows: the ages a shop writes as numbers against
the clocks, dates, durations, distances, grades, levels, counts and party sizes that merely look like one,
and the two vendors that kept their own looser copy of that rule. Xola's ticket sheet end to end against a
stubbed vendor: the team tiers, a numeric age sheet, an add-on, an agent-only rate, a whole-boat charter and
a start with no seats.

The newest guest code, `55c696943`, driven rather than read: what a guest who arrives on a shared listing
link sees when they press "Back to results", and where the home asks the browser for a location at all; the
listing page's business panel, its one way into the agent and the operator switch above it; the counts
printed over browse and over search against the cards actually drawn under them, with dead covers in play;
the no-match search state and its way out; and the guest listing at 400px over eight listing shapes, from
twelve options to none priced at all.

The Agent Mode rewrite of 20 September, driven rather than read: the thread, the working card and its clock,
a question asked on its own, the shortlist, the history panel and the booking form, at 400px and at 1280px,
for sideways scroll, anything past the edge and a control with no name; the API unreachable, an API too slow
and the Stop that ends it, a search that finds nothing, a shortlist with no live times and its one shop that
books by phone, and the page a live shop we have never ingested opens. The form that thread takes a booking
in: what a half-typed name or number does to the Book button, which of the API's refusals the agent may say
out loud, and what happens to a booking for a shop the catalog has never held. The Outset to GoDo rename
swept over every source file: what a guest reads, against the `outset.` storage keys and the bot user agents
that are deliberately left as they were. Which reply a bare number is an answer to, over the clock question a
rental leads with and the headcount question every other activity does.

What day it is where the shop is, read across every booking-system reader rather than sampled: the window a
guest names against the host's own clock, which on the API host is UTC, over all nine readers; the month set
a horizon straddles; a fortnight walked across the night a zone springs forward; and the two readers whose
"has this slot already started" check was comparing a shop's wall clock against the host's. Which zone each
reader has to work with: the vendor's own where it publishes one, the catalog's through `zoneForArea`
otherwise. The concierge session id, which is a bearer token for a guest's conversation: how it is drawn, the
shape it is drawn in, and which ids `getSession` will and will not adopt. What a guest is told the live times
came from, over every vendor a reader exists for. That a departure which has already left is dropped before
the guest listing page's picker draws it, on the live path and the published one, on both surfaces.

The price a guest is quoted, after the reader has picked it: `headlineForParty` in `plan.ts` over every
fare a party cannot buy, which is a rate this many people do not fit, a concession, a whole-booking total
and a row nobody named. Rezdy's price sheet, whose helpers had none: every label shape Rezdy publishes, a
party size read as an age, a rate priced at nothing, a quantity of zero, a group rate beside an adult fare,
and a shop that sells only by the group. TripWorks end to end against a stubbed vendor: the one-ticket shop
that may be named and the Adult and Child sheet that may not, a concession-only slot, a waitlist that is not
a departure, a hidden ticket type, a slot with no price, and the customer type's own price, which looks like
money and is not. That the word every reader uses for a fare with no name is spelled in one place and
reaches no card.

The window every reader turns a guest's "tonight" into, against `windowFor`'s own day counts: Peek, Resova,
Square and Checkfront driven end to end against a stubbed vendor for the day kept, the day refused and the
wider window still reaching the days inside it, Xola's and TripWorks' suites carrying the same case, ForeUp
read and already right, and `lastDayOf` tested on its own for the two readers that cannot be driven here.
Peek and Resova end to end besides: `peekRef` and `resovaAccount` over every link shape the catalog holds,
the fare that heads a card and the concession that may not, Resova's slot price beating the item's teaser,
and a hidden pricing category, a blocked slot and a sold-out one. Checkfront's day fares and `squareRef`.


The programmatic pages, driven for the first time: all 3,004 landing pages under `/p/` and all 11,545 listing
pages under `/l/`, generated from the shipped catalog and read rather than sampled. What each page claims
about how many listings it holds, in its h1, its lede, its meta description, its FAQ, its pills and its
JSON-LD, against the cards it actually draws. Every internal link against the pages the same run wrote, and
the reverse: every page written against the links into it, walked from `p/index.html`. Every page against the
sitemap. Duplicate titles, description length, and whether the JSON-LD on a listing page parses, publishes a
rating with no reviews behind it, or omits an h1. What a shared link previews as, on all three page shapes.

Which booking link we read for a shop, and which reader we then point at it, on both routes that ask:
`liveFor` behind `GET /concierge/live/:domain` against all ten readers rather than two, `bookingUrlFor` on
both sides against a shop holding its own hand-built page beside a vendor's, in either rowid order, and
against a link that only looks like a vendor's, and the same `LIMIT 1` with no ORDER BY behind
`GET /availability/:operatorId`, which is the one a guest's listing page meets. That every vendor the router
can name has a reader to call and a written name, now a test of its own, and that no reader asserts its own
vendor into the type that lists them.

What a picker and the assistant do with an answer from a shop's own booking system that names nothing: a whole
window empty, one date covered and empty, one date open with its times unread, a date the answer never
mentioned, a read that stopped short of the shop's catalog or of a month of its window, and a vendor that
could not be reached at all, which with a claimed shop's own slots is one of the two cases that may still be
replaced by what we hold ourselves. Every suggestion chip the assistant offers, and every chip its answers
hand back, walked on a full shop and a bare one against being unable to answer its own question. The published
week as one line. Whether the test suites are honest about the clock: a test that named a date and read the
real one went red on its own the morning after it was written.

Every rule the pickers read a shop's own booking calendar by, against the rules Otto read the same payload
by: a departure that has already left or falls inside the hour's notice, one the vendor says is sold out, one
whose clock cannot be parsed, a price of nothing, and two trips sharing a start. The window each surface asks
that calendar for, guest and operator alike. Which day Otto names a departure on, against the ten days the
booking window covers.

The browser's own controls on the guest app, driven for the first time: the tab title, the bookmark and the
history entry, Back, Forward and a refresh across the home and a listing, and all four hashes our own links
carry (`#o=`, `#remove=`, `#claim=`, `#paid=`) against a live listing and against one the catalog no longer
holds, at 1280px and 400px. Markup left in the words a guest reads, over every string in all 52,815 shipped
detail files: every field carrying an HTML tag or markdown syntax, against the function that prints it. The
"More options" fold as a control rather than a list: its count, `aria-expanded`, the flip to "Fewer options"
and where focus lands, on both surfaces.

A real claim link opened in a browser, which the rehearsal cannot do at all because it enters through the test
bypass: what a first load records (nothing), what the confirm screen names, what a reload of that screen leaves
the owner with, what the click records and links for sign-in, where the token in the address bar goes and when,
"Not my business", and a forwarded link opened on a second device with another address on it. Every link our own
mail puts in front of a link-safety scanner, against what each one changes when it is only opened: the claim
link, the unsubscribe link, `#remove=`, `#paid=`, and the listing and dashboard URLs.

The four guest-facing facts no sweep had touched, found by counting what the 59,125 shipped detail files
actually carry. The season a shop publishes, over all 1,144 that publish one, on both surfaces that print it:
which are a phrase and which a sentence, and what each surface did with the 491 that are neither short nor
silent. The videos: all 1,148 `videoEmbed` addresses against the hosts and the paths an iframe will render,
and `ytVideos`, which no shipped listing carries. The waiver link, over all 1,844 that carry one: the scheme,
the host, the path, and which of them open a form rather than a homepage. Markdown in the words a guest
reads, over every prose field in the catalog and through both funnels that carry it to a page: a link, an
image, a heading marker, a bracket the crawl's cut left open, and the closed brackets that are conversions
rather than links. Every character budget a shop's prose is cut to, on both sides: which cuts land mid-word,
which are assembled at sync time and which are baked into a stored fact, and the unguarded word-boundary
trim that was eating the last word of every description shorter than its budget.

The add-ons a guest can tick, over all 3,825 shipped: which of them are a thing and which are the front of a
sentence the price was cut out of, the bracket a price was printed inside, and every name held against the
menu the server prices from. That the menu the booking box offers and the menu `priceBooking` charges from are
one menu, on every priced row of all 59,125 listings and on every extra beside them, and that two extras
sharing a name are told apart by the guest's own total the way two tiers already were.

Affiliate listings, the partner products from Viator and Tiqets, on every surface that meets one: the phone
and desktop cards, the compare table, the listing page and its nearby cards, the phone booking sheet, the
generated `/l/` page and its structured data, Otto's two gates, the claim screen's business search and the
listing page's own claim line, and `POST /bookings`, which is the route that decides whether Outset can be
made to take a booking for one.

What a shop says about arriving, over all 644 shipped check-in notes and on the four surfaces that print
one, the listing page, the phone booking sheet, the booking confirmation and Otto's answer to "what time is
check-in": a greeting in front of the facts, a sign-off after them, a note that is courtesy and nothing else,
and a note the crawl cut to a single word. All 3,189 shipped meeting points through the same tidying, for
markdown, a URL, an email, a cut bracket and a place that only says it varies. The page heading the crawl
glues to the sentence under it, over every guest-visible line in the catalog, including the sentences that
only looked like one.

What the phone claims off a lite record, which is what its feed and its rails paint from: the unit beside a
from price, over all 10,217 priced listings and the 2,509 whose cheapest option is not per person; the Free
cancellation badge with no policy text to read; the compact week, the compact deal, the rating, the distance
and the thin flag. Everything the phone booking sheet says about a partner's product that is not ours to say,
over all 1,873 partner rows: the host line, the three Things to know rows, and the cancellation line under the
partner's own badge. Those rows' own shape besides: the cover, the area and its region, the from price, the
duration, the photo count and the title length.

What the 6,492 Viator partner rows put in front of a guest, now that the detail pass ships the partner's own
requirements, inclusions and cancellation text on every one: their shape (cover, area carrying its region,
from price, metro, pin, rating, review count, the partner id on every link, and that none is claimed, instant
or assistant-on), their photo sets, which went from one each to eight on 4,402 of them, for a duplicate, a
size-variant twin, the cover's place, the scheme and the host against the CSP, the `includes` split, and every
place either surface would otherwise tell a guest to ring a product. Markup in the words a guest reads, over
every prose field in the catalog and on the four surfaces that print one: a tag, a tag the crawl's cut left
open, an editor's leftovers in a service description, the bold marker, and the single asterisk that is a
bullet rather than an emphasis. The author slot on all 4,774 review cards the shipped catalog can draw. A
minimum age read off a number that counts something else, over all 11,554 listings that state a requirement:
a software version, a group size, a distance, a booking window, a course load, a tax line and a decimal's tail.

Otto on the phone, both `/voice` endpoints read end to end: which departures a voice agent may read out
against the four rules `liveTimes.ts` already keeps for the page (a marker row with no time, a sold-out
departure, a price of nothing, and one that has already left), the clock that question is asked on, where the
facts come from for a claimed shop as against the nightly file, the two dashboard switches against the link
handed to a caller, the from price against all 46,324 operator listings, a zero on every price the route
prints, a partner's product on both routes, and a network failure cached as a missing business.

What a guest is told the price covers, over all 12,396 shipped listings that publish an `includes` list and on
every surface that reads it: the desktop listing page, the phone booking sheet, the static `/l/` page, Otto and
the `/voice` phone-agent payload. A line whose own label says "Not included", a thing the shop sells beside the
trip ("(extra fee)", "available for purchase", "for an additional fee"), a line that states an inclusion and a
thing for sale at once, "at no extra charge", the section's own heading riding the first bullet, and a listing
that publishes the same thing in both halves of its own list. A negative marker
whose subject is plural ("Prices do not include gas"), the exclusions half of a shop's own section heading
("What is not included:", "Excluded:"), and the same words arriving twice, once as a promise and once as an
exclusion, whichever half carries the label.

What the guest's page quotes against what the server charges, run over the whole shipped catalog rather than
read: every priced row of all 19,117 operator listings with a bookable menu, at a party of one and of three,
sent the way `AppProvider` sends it and priced the way `POST /bookings` prices it (83,574 quotes); the same with
each extra on its own and all of them together, over the 1,652 listings carrying both a priced menu and add-ons
(7,732 checks); and all 34,492 unpriced rows a guest can pick, none of which the server prices after the page
said "price on request". Which day a live-departures window opens on when the caller names none, on all three
routes that turn a window into calendar dates.

The two columns a guest reads under "Who can go" and "Safety and waiver", over all 46,324 shipped operator
listings and the 14,754 lines they post: which menu rows reach the first of them, against the age, height and
accompaniment rules that make a row a rule rather than a price tier, and against the numbers beside a person
word that count holes, hours, classes, a school grade, a year, a head count or dollars; the two-word lines, the
lines naming nothing about who, the questions printed as facts and the lines printed under both headings. The
`gap` field on every one of those listings, read as what it is, two fields in one: which of them is the shop's
own policy prose and which is our note about a fact the site never published, against the policy list a claim
prefills and publishes on the operator's own page.

The highlights a listing leads with, over the whole shipped catalog and on both surfaces that draw them: the
14,341 lines the 6,456 listings publishing their own carry, against a per-booking minimum, a price, a
cancellation term, a URL, an email address, a phone number and a question; and the fallback the other 39,727
fall back to, which is `listingFacts().about` and had never been counted. The bare "N+" a shop writes instead
of an age word, on every line of every shipped listing and through both readers that meet one: the fee, the
tax, the speed and the tennis rating that only look like one, the group, the purchase and the count of a
shop's own stock that size something else, and the person a real rule names in front of the number. Every way
a shop states a minimum age in plain words, against the floor its page, its phone sheet and Otto then print.


Every "what to bring" line the catalog publishes, all 6,575 of them on 3,203 listings, through the one rule
the listing page's "Who can go" column and Otto's own bring answer now share: which lines are things and which
carry a verb of their own, a shop's prohibition, its instruction, its permission and the lines that rate
themselves, every line diffed before and after. What the static /l/ page heads "Requirements", over the 2,369
listings that state none of their own, against the split both app surfaces read, and the Highlights section
that page now carries. Every way a shop states an age floor as a sentence about the guest rather than as an
age word or a bare "N+", against the column that decides who can go and the floor the page prints above it.
Every `includes` line in the catalog that says "bring your own", split by whether it marks itself as not
included.

Every ARIA widget in `src/components` against the keyboard its own role promises: every `role="tablist"`,
`role="tab"`, `role="listbox"` and `role="option"` in the app, and the desktop home's What and Where
comboboxes beside them. The guest booking box's service picker and the dashboard Home's tab strip driven in a
real Chromium at 1280px and 400px, keyboard only: opened, walked by the arrow keys, Home and End, filtered to
a chip that hides the picked row, picked, escaped, and where focus lands on each of those. Which element in a
popup carries the role, against what it then owns. The geometry of both, before and after.

The claim screen's own failure states, driven in a real Chromium against the local API and a real minted v2
token rather than read at the token level: a forged signature, a correctly signed token a day out of date, the
exchange aborted the way a dead connection aborts it, a 502 from in front of the API and the rate limiter's own
429, at 1280px and 400px. The line each one prints, the line it must not print, whether the token is left in the
address bar for the reload that would fix it, the form it lands the owner on, sideways scroll and anything past
the edge. Two of those five are a rehearsal step of their own now, step (n), minted from the harness's own claim
secret. Every call in the app that prints a verdict on a failure, against the ones whose failure was only a call
that never got an answer.

Every door that builds an operator dashboard from scratch, against an API that stops answering part way: the
claim link's click-through, signing in by email code on a device that holds nothing, and the test bypass's
`test-enter`. What each one does with a claim the server never recorded, with a profile read that got no
answer, and with a code the API has already spent. The two calls the click makes, failed one at a time in a
real Chromium against the local API and a real minted v2 token, now the rehearsal's step (n2): where the owner
is left, whether the token stays in the address bar, whether anything was written to the device, and that
pressing again once the API answers opens the stored profile rather than one built from the crawled record.

What every reader that meets a lite record does when the field it reads is one the browse catalog empties, read
over the whole shipped catalog rather than sampled: `kidFriendly` behind the home's "with kids" filter, against
all 3,098 browsable listings whose own words settle whether a child may come and the 524 the filter was
offering in spite of them; and `fromPrice`, `startingPrice`, `publicRating`, `dealToday` and `freeCancelBadge`
beside it, each already falling back to a field the lite record carries. What `specs` carries into the two
readers that still take it raw: Otto's corpus, whose every quoting point already runs `plainWords` (all 190,286
lines counted, all call sites read), and the word index, which indexes nothing at all from that field on a
shipped record.

The IP-to-metro placement behind `GET /where`, driven for the first time: `build-ip-metros.mts` against a CSV
holding a merge, a row out of address order, a place out of reach of every metro, a foreign row, a quoted city
name with a comma in it and an IPv6 block, and the table it writes read back through `decode` and `lookup` at
every boundary; `zoneFor` over all 50 metros, which is what `ipGuessFitsClock` needs to refuse a VPN. That the
home's locate run always ends with the home no longer locating, whatever it decides to do with the answer, now
a guard of its own.

What the address bar does to an open listing, driven in Chromium rather than read: a shared `#o=` link
arriving while a listing or a chat is open, back between two listings, back out of a listing opened from the
home, and closing one with its own control instead. The tier picker over all 61,620 shipped services, for two
shown rows reading the same words, a row printing nothing and two tiers sharing the React key they are drawn
with. The "More options" fold and the Deals section driven at 1440px and 400px, including a deal with a code,
one with a start hour and the clock each is read on. 142 listing pages opened in a real browser, 42 by shape
and 100 at random, at both widths, for sideways scroll, anything past the edge, console errors and
exceptions. The "More like this" rail against the whole shipped catalog, for a business offered twice.

The Otto (AI phone line) outreach campaign, read end to end for the first time, which is the newest code in
the repo and the only one that mails a real business unattended: its copy against the outreach folder's own
rules (the take-it-down link, the unsubscribe link, no claim link, no em dash, a business name that cannot
reach the html as markup, a draft with no address); every one of the 4,728 targets' names through the subject
line, for a control character, an emoji, a domain standing in for a name and a doubled possessive; the shared
daily ceiling and the clock it counts on, `dayStartIso` against `PIPELINE_TZ`, both ramps reading `sentToday()`
across both campaigns, and the rungs against the combined 50; which send time the ceiling is read off; the
dedup between the two campaigns, over the 2,038 operators that clear both sets of filters; and the dry run,
driven three times in a row against a local SQLite for what it writes back.

Where a listing tells a guest to go, on all three surfaces that say it: every one of the 52,816 shipped detail
files through `streetOf` and `addressOf`, and what the Maps link searches for on each of the 46,324 that carry
a contact record, including the 5,018 with no street the page can print and the 1,210 whose whole address is a
two-letter state code; the 3,189 meeting points, against what the desktop card and the phone directions row
each print and each link; and the 464 venue rows on the 180 chain listings, for a row with a town and no
street, a bare pin, and a row with neither. Which pin a distance may be measured from, now one rule both the
cards and the listing page read: a picked state or province, and the 6,492 partner rows that share 49
coordinates between them. That `tsc -b`, and not `tsc --noEmit -p .`, is what type-checks the guest app, now a
test of its own in the unit suite.

The outreach path driven rather than read, on the code that mails a business that never asked: the Otto
draft run against every exclusion it claims, both send queues and which id each row carries, the dry run's
writes, the handoff export and the marks it leaves, both ramps' rung arithmetic and their weekend exit, the
outreach list script, and `GET /outreach/drafts` against the admin gate above it.

**Not yet checked.** Anything in the grounded fallback that needs a real Cohere key: no key exists here, so every answer checked tonight was a payload shaped by hand, and what the live model actually writes, what its citation offsets index into when it answers in more than one content part, and whether `citation_options` FAST cites densely enough for `keepCited` to keep a good answer are all unread. `npm run otto:eval` for the same reason. Whether a price the model reformats should be dropped: a shop publishing "$85" and a model writing "$85.00" loses the sentence (see this run's Needs Harshil). Whether the grounded answer should reach the static `/l/` page and the phone sheet, which do not call it. A real Otto send or a real hand-send: the draft run, the queue, the dry run and the handoff export are all driven now, but nothing has left a mailbox from here, and `outreach-daily.sh` is launchd on the Mac and cannot be. Whether `state.ranDays` and `state.sentDays` growing without bound in `outreach-otto-ramp.json`, and being written only after a send loop that can run four hours, is worth changing, given that `sentToday` is what actually holds the ceiling. Whether the Otto email may tell a shop "Bookings drop straight into your calendar" when
both `/voice` endpoints are read-only and syncing with an operator's own booking software is deferred on
purpose, which is this run's first Needs Harshil. Whether the Otto subject should be shortened or the question
fronted, since 201 of 4,728 run past 78 characters and a phone cuts the hook off almost all of them. Whether a
name ending in a plural s should take the correct "Gulf Jet Skis'", which is 2,261 of the targets. Whether
`outreach-ramp.mts` should regenerate the draft queue the way `otto-ramp.mts` does, since today the daily
listing job only ever mails what was queued the last time somebody ran `npm run outreach`. Whether a ramp
should record a day as run when the combined ceiling left it no headroom, which advances a rung on a day
nothing went out. Whether `ESERVFAIL` should read as "this domain does not exist", which is fail-closed and the
opposite of what `deliverable.ts` says it does with a resolver that cannot answer. Whether `pipeline.mts`'s
outreach step should still describe a 20/40/70/100 ramp and declare it needs `RESEND_API_KEY` when outreach
sends over Gmail SMTP. Whether a Free cancellation badge should ever promise a shorter
notice than a line in the same shop's own policy denies: 13 of the 7,104 shipped badges do, four of them a shop
contradicting itself where a previous run deliberately chose the promise, and the rest a per-service window
flattened into one badge (see the sixty-sixth run's Needs Harshil). Whether a "do not include" whose subject is
somebody else's business should stay an inclusion, which is one line of the 16 that moved. The five lines
stating a cost in words `COSTS_EXTRA` does not name ("optional extra charge", "(feed extra cost)", "is extra"),
each half an inclusion and half not. Whether a row that names its own length should
be believed over the length shown beside it, or neither should be: 114 rows disagree, and the junk half is the
label on some shops and the name on others (see the sixty-second run's Needs Harshil). Whether Fin & Fly's one
surviving priced row is a deposit like its five siblings, which only a re-crawl settles. Whether the same business should be in the catalog twice, once as ours and once as a partner's
product: 171 Viator products name an operator listing in their own metro, across 88 businesses, and the
duplicate rules we run all stop at the operator table (see the sixty-third run's Needs Harshil). Whether the
en and em dashes a shop and a partner write should survive to a guest: the rule says no and is called on two
fields of a crawled listing, leaving 5,157 on 2,179 listings, and the fields have to be named one at a time
because an hours line reads a dash as a range (see that run's Needs Harshil). Whether a partner's
`additionalInfo` should be split by its own `type` rather than by reading the line, which is what the
sixty-third run could check against the shipped catalog and the types are not. A minimum age that is
an age but somebody else's: the accompanying adult, the fishing licence, the age that may sign its own waiver,
about 30 listings and a judgement rather than a rule (see this run's Needs Harshil). Whether a bare URL or an
email address should be printed inside a "Who can go" bullet, which 25 partner lines carry. Whether a bare
"Gratuities" or "Lunch", with no marker on the line at all, is an inclusion or an exclusion a flattened page
lost the heading of, which only a re-crawl that keeps the heading settles (see the sixty-fifth run's Needs
Harshil). The 52 `includes` lines that say "bring your own" and mark themselves neither way, which are a real
inclusion on one side and a shop supplying nothing on the other (see this run's Needs Harshil). The six bring
lines that open with an adverbial before the verb ("For wedding lessons, bring wedding shoes closer to the
event"), which no rule reaches without taking 62 correct ones with it. Whether a line stating an age over 21
should reach the "Ages N+" floor now that it reaches the column (see this run's Needs Harshil). Whether a partner's price should be printed in the currency its API quoted it in: both pulls ask for CAD in Canadian metros, store it, and the catalog record drops it (see this run's Needs Harshil). Whether the phone booking sheet's "Ask Outset" panel should honour the operator's Assistant switch the way the desktop page does; it is behind `AGENT_MODE_LIVE`, so no guest meets it today. Whether a partner product should be in the "near you" rails at all, given that its pin is the city's. Any partner API against its real server: no key exists here, so every affiliate row in this sweep was shaped by hand. Rezdy's reader end to end, which needs a hand-rolled HTTP/2 session because Cloudflare
blocks `fetch` on every `*.rezdy.com` subdomain; its price helpers and its window rule are tested directly
instead. Whether the concierge's
watch window should have a browser door of its own: with
`ADMIN_KEY` set it now answers a browser 404 and only curl gets in, and the metrics page's emailed-code
sign-in is the pattern it lacks. The concierge overlay against a
live API: nothing here could give it one, so its answers, its chips, its history panel and its "Also nearby"
rows have been read and unit tested but never seen full of real shops. The wallet against a real Stripe key,
which is the same wall as everything else on that list. Whether the in-app concierge should be reachable at
all from the phone frame's own tab bar, rather than only from the home's pill and an `#ask=` link.
Which of two towns of the same name a guest means: "golf springfield" cannot tell, and
Columbia, Madison, Henderson, Richmond and Portland are the same, which is 69 town searches still opening in
another state (see this run's Needs Harshil). Whether a city row should be able to see the guest's own price
filter, which lives outside `search.ts`, so a row that counts honestly can still open a page a filter has
emptied. Whether the front of a word the guest really typed should reach a much shorter one the catalog
carries: "bellingham" reaches "bell", which is the same rule that lets "helicopter" reach a listing filed
under "heli". Whether a party of twelve should filter the feed rather than surprise the guest in the booking
box. How a Peek shop should get the times for a date the call budget never reached, which
is the one thing the thirty-third run left open behind a fix (see its Needs Harshil): 239 listings
now show the two dates we timed rather than eight, six of which were a midnight the shop never sells. Any
live vendor against its real server rather than a payload shaped by hand, so a vendor that has quietly
changed its JSON reads as a shop with nothing open and nobody knows. Whether the six rows publishing a bare
`https://fareharbor.com/` should be in `live-index.json` at all. Whether the vendor's own `bookUrl` for a
departure should ever be offered to a guest: every reader carries one and no surface draws it. Whether a
kind's all-metros page needs paging for its town pills, which now number 308 on the museums page and put it
at 66 KB. Whether the 50 kinds with no guide should have one written (see the forty-seventh run's Needs
Harshil). Whether the `og:image` fallback should be something better than the 180px app icon, and whether the
263 listing page titles past 70 characters should drop their town (see this run's Needs Harshil). Whether the 160 pages the next sync deletes should be
kept with honest counts instead (see this run's Needs Harshil). Which town the 64 listings whose street names one town and whose city names another are
actually in, as a supply question. Whether the 108 archive rows that carried a real admission tier should keep that price
under a name a re-crawl reads properly, and whether "Buy Tickets" (338 rows) and "Schedule a tour" (123)
should be renamed. The 2 listings still showing Windows-1252 mojibake (an earlier run counted 17; 2 is what
actually ships). Anything that needs a real Stripe key: the embedded card form itself mounted by
Stripe.js, the hosted page, 3D Secure, the Payouts page against a connected account, and the pending row a
closed card form leaves holding the guest's own time for thirty minutes (see this run's Needs Harshil). The
operator chat for a hand-built listing (`src/data/listings.ts` is empty, so `agent.ts` and the `ChatView`
operator path still have no live case). Whether the 59,060 listings with no FAQ should have one, as a
supply question, since it is Otto's best source and the dashboard's starting point. Photo upload against a real GitHub token, and the gap between the URL
it returns and the deploy that makes the file exist. The mouse drag path of reordering: the keyboard and touch
paths are driven in a browser, the HTML5 drag events are not. A rehearsal check that reads a claimed listing's
rendered page and not only the API's JSON. A CI job that runs `npm test` on either side. Whether a claimed shop
with an empty menu should pause its own listing. Whether the Where box should index the towns our own catalog already names. Whether Arizona's
Navajo Nation should keep daylight saving. The 4,736 listings whose area carries no town, as a supply gap. The "More options"
folding and `variantNote`, which an earlier run read but did not drive in a browser. The promo crawl's own output, `backend/src/enrich/promos.ts`, which is read but has
never been run over a real page from here: there is no local database, so every deal checked so far is one the
last sync already published. Whether a GIF should stand in for a video at
all: 215 still lead a hero, and the rule that would clear them takes real photographs with them (see the
thirtieth run's Needs Harshil). Whether a fold should keep the largest spelling of a photograph rather than the first: it is the first on
181 of the 1,251 folds, and the first is what the card already loaded. Whether a shop that states its own
cancellation flat rather than as a condition ("Operator may cancel within 2 hours of rental for bad weather
with full refund") should carry the badge at all, which is the existence rule rather than the window, and
whether "we have a 24 hour cancellation policy" should read as the shop's own call (see the fifty-third run's
Needs Harshil for both). Whether the listing page should print a rating with no
written reviews under it: 6,513 rated listings show one on their card, their confirmation and the compare
table and none on the page those open, and 1,699 of those clear the Top rated bar with no laurel to show for
it. The two listings that put the review's headline in the author slot, so a card is signed "Excellent trip".
Whether the phone sheet should call one badge "Guest favourite" on the photo and "Top rated" in the row under
it. The dashboard Home tabs as a screen reader meets them: they are `role="tab"` with no panel to control and
no arrow keys, and putting that right needs `src/styles`. Whether the Next 7
days tab should list the week's unanswered requests as well as its confirmed bookings. Whether `groupCap`
should count players, persons, participants and anglers and read number words: 351 listings would print a
group size they currently do not and 32 would change theirs, 9 of them downwards (see this run's Needs
Harshil). Whether a minimum age over 21 should be printable at all, for boat and car
rental floors. Whether the 505 listings stating a group size of 20 or more should widen the picker past 20, towards the 60
the API already takes. Whether a shop whose week states only closed days, 18 of them, should be
bookable at all on the days it says nothing about. Whether a mixed policy column should read "Policies" or split
into a fourth column, which needs `src/styles`. Whether the rehearsal should open a listing that carries
policies, so the "Things to know" headings are checked in a browser and not only by their source. Whether
`explain` should be read at load time like `menuRow`, so a glossary fix reaches the shipped detail files
without waiting for a sync. Whether the 51 kinds of waves two and three should have a scene of their own, on
the 18,056 listings with no cover that draw the generic one instead. Whether `inferCategory` should read a
bare "charter" as fishing, and whether its last resort should still be jet ski. What a card, a rail and a
search result look like for a kind with no scene and no photo, driven in a browser rather than counted. Whether the 12 operators whose published address is at free mail and stored wrong need a way
in before the next sync rewrites `claim-index.json`. Whether a claimed shop's own email and website should ever
appear on the guest page, which they deliberately do not. Whether an unsubscribe token should outlive a
`CLAIM_SECRET` rotation, and whether `GET /mail/unsubscribed` should stay public (see this run's Needs
Harshil). The outreach send against a live API rather than a local SQLite, and what the
drafts table looks like after a send that was actually refused by a mail server. Whether "this takes the page down" in
the claim email should say what it does, which is a `mailto:` and one business day. Whether the party a guest
names should reach the shortlist or the quote at all: it is read and then used for nothing, and FareHarbor's
own minimum and maximum party sizes per rate are read and drawn by no surface. Whether the comparison line
should put a CAD price and a USD one in the same range, which it does. Whether `/go` should be reachable by a
search engine, and whether a demo that charges nothing should say so before the virtual-card step rather than
after. Two of the three fulfilment routes other than the feed: the browser agent on a hand-built form, and the
phone, neither of which has been driven. The hosted page's account id is now right on every shipped link, but
the page it builds has still never been opened. Whether the 12 shipped names that are not names at all ("You
are being redirected...", "SITE1212", "bocaratonobserver.com") should fall back to something, and whether the
12 carrying an emoji are branding or a marketplace's tile icon. Peek, which is 257 links and the next
feed worth reading. What the home should say when every cover on it is dead: today it draws a header, the
category chips, a footer and nothing between them, because the kind list is not empty so the "Nothing here
yet" state never fires (see this run's Needs Harshil). Whether the `waiting` line should count a listing
whose cover died as one of the "places listed without a photo yet", which it does not. Whether the "All requests"
link on Home should render on a phone at all, where the scrolling tab strip parks it out of sight (see the
forty-fourth run's Needs Harshil). Whether the operator whose sign-in code is refused six times should be
offered a fresh code on that screen: the only way on is the Back link, and a sixth request inside the hour is
answered "ok" and sends nothing, on purpose, so the address cannot be probed. Whether an operator should be
able to price an option at zero and mean free: every surface reads a zero as no price and quotes "Pay on
site". Any live vendor against its real server rather than a stub. Whether a sentence naming two
regions ("ontario california") should take the first one it recognises, which it does. Whether a budget read
out of "under 18s" should filter prices, which it does. Whether the outreach list's
`quality = good` bar and its score are the right order to mail in, which is a supply judgement rather than a
rule. Whether Gmail's one-click
`List-Unsubscribe` headers should be sent after all: the code deliberately leaves them off to stay out of
Promotions, which is a deliverability bet against a bulk-sender expectation. Whether `concierge.css`'s 330 lines for a
panel nothing renders should be deleted or a component written for them (see the fortieth run's Needs
Harshil), and whether the four `--cg-` custom properties they reach for should exist. The five new readers
against a real vendor server rather than read: Acuity, Rezdy, Square, TripWorks and Xola have never answered
anything here, so a vendor whose JSON has quietly changed reads as a shop with nothing open, and the egress
proxy here refuses the CONNECT to every one of them outright. Bookeo's 46 shops, which are a
documented negative from this address and want one `bookeoProbe` run from the Render worker. Whether a Xola
waiver or gift shell with no button id should be routed as a feed at all: four shipped links are, and the
reader correctly answers nothing for them. Whether the accents `CAT_COLOR` gives each category should be darkened to clear the AA
floor they are printed at (see the forty-third run's Needs Harshil), and whether an option the concierge
finds but the catalog has never held should be bookable at all rather than refused in words. The ForeUp reader, `api/nearby.ts` and `lib/mapsNearby.ts` are committed and read now, but
none of the three has answered anything real: ForeUp has never been asked a live course, `/nearby` needs a
Google Places key nothing here has, and `scripts/concierge-bench.mts` has never been run from this address. Whether `outset-api`'s build should run `fetch-seed.mts` at all, which is the one line between the
deployed concierge having a catalog and answering every town with "could not find". Whether a live resolve
should be allowed to overwrite a crawled `booking_url` even when it does find something, rather than only to
add one. Whether `linksTo`'s three followed links should include a link that leaves the shop's own origin,
which they deliberately do not. Whether the browser-agent and replay drivers
(`concierge/agent.ts`, `concierge/replay.ts`) should carry the shop's clock like every reader now does, given
that nothing calls either of them. Whether the weekend a guest means should be worked out on their own clock
rather than the host's, which is the last thing in `windowFor` reading a day of the week from the server.
Whether the guest's own listing page should read the seven vendors only the agent reads: `live-index.json`
and `enrich/availability.ts` both stop at FareHarbor, Peek and Xola, and that file keeps its own readers
rather than the concierge's, so a Resova, Rezdy, Acuity, Square, TripWorks, Checkfront or ForeUp shop is
quoted live in Agent Mode and shows guessed times on its own page. The fifty-first run read those readers and
found this to be two pieces of work rather than a dispatch: every one of them stops at the first free day and
asks four to six of a shop's items, so their answers cannot fill a fortnight's calendar, and the published
index carries no link at all for those seven shops (see that run's Needs Harshil). Whether a rule landing in
`liveTimes.ts` should reach Otto on its own rather than by whoever writes it remembering to look (see the
fifty-second run's Needs Harshil). Whether a fresh checkout should install the root `node_modules` the app
suite needs, or the rehearsal check for them, since without them eight test files are red for no reason (see
that run's Needs Harshil). Whether `public/unsubscribe.html` should keep POSTing the API on load: it is the
unsubscribe link every outreach email carries and the last page load in our mail that changes something by
itself, and it sits outside the paths an overnight run may change (see the fifty-fourth run's Needs Harshil).
Whether the confirm screen's new failure line
wraps properly at 400px: it reuses `.oderr` inside an `.odsplash` that already wraps a sentence of its own, and
it was driven in a browser at 1440px only (see the seventy-second run). Whether the "All requests" link should sit inside
the dashboard Home's tab strip at all: it is a fourth child of a `role="tablist"` that is not a tab, and
taking it out of that element needs `src/styles`, which an overnight run may not touch (see the seventy-first
run's Needs Harshil). The TikTok creator embed on the guest listing page, which 0 shipped listings carry and which the
page's own Content-Security-Policy would block twice over if one ever did, on the script and on the frame. The
`instagram` handle on 4,980 shipped listings, which the sync writes, a claim borrows and no surface prints. Which of the 35 waiver links that
open a homepage rather than a form are a shop's own waiver portal and which are a vendor's marketing site,
which is a supply judgement rather than a rule (see this run's Needs Harshil). Whether the surfaces that
promise a waiver link should read the same gate the link itself reads, and whether an embed URL's path should
be checked as well as its host: both are latent, 0 shipped listings today. Whether the 766 listings whose
prose a sync would now cut properly should have that sync run before anything else on this list. Whether a
card's "from" price should be the cheapest bookable experience rather than the cheapest row of any kind: the
Detroit Zoo advertises $2 for a stingray touch, a bowling alley $3 for shoe rental and a marina $2.15, which
is a rate per foot of boat (see this run's Needs Harshil). Whether a number the page stated as a discount
should ever be a price: 8 shipped rows sell a happy hour at "$2 off" and a six hour package at "$20 OFF when
you book direct" (see this run's Needs Harshil). Whether the sync should keep an add-on whose name is a
penalty or an order minimum rather than an extra, which the drop rule now takes with the cut sentences it was
written for. Whether an nth-weekday rule should be honoured, dropped or left as the weekly rule it is read as
today, which is this run's Needs Harshil and the one item here that is a defect rather than a question, and
whether a season written in front of a rule should reach the week parsers as well as the page. Whether the "More options" fold should keep a service's cheapest tier visible, since the card's
"from" price can be a row the page opens folded: 7 listings, all of them per-person rates that fall as
the group grows (see the seventy-fourth run's Needs Harshil). Whether an
unclaimed shop open past midnight should sell its small hours on the next date, the way a claimed one does, on
the 481 that state one, and whether a shop that genuinely trades around the clock can say so at all, given
that a clock face reading midnight to midnight is now refused on every surface. Which listings the publish gate dropped and why: the 23 September
sync published 10,927 fewer than the last one and the only thing that noticed was a test floor (see this
run's Needs Harshil). Whether an arrival note that names no fact at all should be printed: 66 are still
shown, most of them worth keeping, a handful of them a slogan or a tax ID (see this run's Needs Harshil).
Whether the lite shard should carry the unit a price is sold in, so a phone card can
say "/ person" again where it is true rather than staying silent on all 10,217 priced rows (see the sixtieth
run's Needs Harshil). What else the lite record is asked for and answers by assumption rather than by
silence: the unit was the one this run swept, and the same seam runs through every rule a card, a rail or a
search result reads before the detail file lands. The shape a voice platform (Vapi, Retell) actually wants
back from the two `/voice` endpoints, since neither has ever been called by one, and whether the agent should
be handed the vendor's own per-departure `bookUrl` to read out. Whether `/voice/:id/availability` should go
quiet for a listing its owner has hidden or paused, given that its times are the shop's own vendor calendar
and not ours (see the sixty-fourth run's Needs Harshil). Whether a partner's product may have a phone agent
after all, which is the one thing that run changed on a rule rather than on a defect. Whether the `/voice`
routes should be public at all, or carry a key the voice platform could hold: today a per-IP limit is the
whole door. Whether `minAge` should take the lowest age a listing states rather than the first line that yields one: 16 listings read differently either way, 9 of them better and 4 worse (see this run's Needs Harshil). The 12 listings whose age rule still sits outside "Who can go" because no person sits in front of the number ("Adults only, 18+", "After 8PM, 21+ only"), which wants the counted-noun list finished rather than the clause opener loosened. Whether the 183 group-size and capacity lines still in the highlights fallback, on 140 listings, are what a phone should print under "What you'll do". Whether a line naming both an age and a licence should be printed under "Who can go" and "Safety and waiver" at once, which 321 listings do. Whether an FAQ question should ever be printed as a safety rule, which 2 are. Whether the "Who can go" column should cap a line's length the way the waiver column caps it at 160, given the 80 lines over 220 characters it prints today. Whether the `gap` field should be two fields rather than one, so a shop's policy prose and our own note about a missing fact stop having to be told apart by their wording. Whether the browse
catalog should carry a compact flag for the party rules a shop states, the way it now carries one for its age
rules: `groupOk` reads `specs`, which is empty there, and `groupInfo`, where those rules live, is not on a lite
record at all (see the seventy-third run's Needs Harshil). Whether the word index's `specs` line should be
deleted or the sync should carry a few of a shop's own words into the lite record for it to read. Whether a
guest whose address does not fit their clock should re-ask `/where` on every visit, which they do. Every other
field the lite record drops, against the readers that meet one: age and party rules were the two this run
swept, and the same seam runs through every rule read before a detail file lands. Whether the root
`tsconfig.json` should carry the app's files, so that `tsc --noEmit -p .` stops answering clean for a project
it compiles nothing of (see this run's Needs Harshil). Which of a chain's locations the "40 locations" heading
should count when the grid draws 24, on the one listing that has more. Which of the several places a meeting
point names the Maps link should open, on the shops that name more than one. Whether a listing whose only
stated place is a two-letter state code should print that code under the heading "Address" at all, which all
1,210 of them do. Whether the desktop site should be able to say anything in passing at all:
`<Toast />` is rendered only inside a non-request sheet and `.toast` is positioned for the phone frame, so the
line a dead listing link now shows reaches the phone and not the desktop (see the eightieth run's Needs
Harshil). Whether the operator dashboard's own browser tab should be titled for the shop rather than for
guests. Whether the address bar should be rewritten to the catalog's own spelling of an id a link shouted: the
listing opens now, and the shouted hash stays in the bar. Whether a charter deposit is the booking, which is
what decides the 19 deposit rows the sync drops from a service list and keeps in the options (see the
eighty-first run's Needs Harshil). Whether `fromPrice` should quote a row the page's own service list does not
show at all, which four listings do until the next sync runs.
