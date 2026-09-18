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

## Coverage

**Verified so far.** Booking validation and odd input on every route that takes it. The money split,
pay-on-site pricing, the service fee tiers. Double booking past capacity, and party size against a time's
capacity. Payout scheduling, cycles and the payouts tiles. The Stripe Connect button. The booking and decision
emails. The rehearsal itself, which runs both sides' unit tests and now refuses to run against a server it did
not start. Start times from a claimed shop's hours: odd hours, days off, blocked slots, the notice, the window,
a shop open past midnight. The week a shop starts on, read from its own published hours, and the hours a
claimed shop shows a guest. The booking box price lines, including a service with no price. Phone width at
400px on the guest listing, the booking flow, every dashboard page, and the Trips, Inbox, chat and Profile
tabs. Accessibility on the booking flow and on the assistant chat: focus order, input labels, disabled buttons.
Colour contrast on the accent. The API unreachable and the API slow. The Availability page and the setup
checklist counting itself. Search and browse: a query matching nothing, a metro with one listing, a category
with none, paging, an unpublished or paused listing staying out of the lists, and every way out of an empty
search. Claim and sign-in: an address that does not match the business, an expired link, an edited expiry, one
listing's link used on another, a link claimed twice, a sign-in code typed wrong six times, and a session for
one listing used on another.

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

**Not yet checked.** Which town the 64 listings whose street names one town and whose city names another are
actually in, as a supply question. The email address on a claimed shop's own listing, and the hours the
contact block carries, neither of which any run has read. Whether the 108 archive rows that carried a real admission tier should keep that price
under a name a re-crawl reads properly, and whether "Buy Tickets" (338 rows) and "Schedule a tour" (123)
should be renamed. The 2 listings still showing Windows-1252 mojibake (an earlier run counted 17; 2 is what
actually ships). Anything that needs a real Stripe key: the embedded card form itself mounted by
Stripe.js, the hosted page, 3D Secure, the Payouts page against a connected account, and the pending row a
closed card form leaves holding the guest's own time for thirty minutes (see this run's Needs Harshil). The
operator chat for a hand-built listing (`src/data/listings.ts` is empty, so `agent.ts` and the `ChatView`
operator path still have no live case). Photo upload against a real GitHub token, and the gap between the URL
it returns and the deploy that makes the file exist. The mouse drag path of reordering: the keyboard and touch
paths are driven in a browser, the HTML5 drag events are not. A rehearsal check that reads a claimed listing's
rendered page and not only the API's JSON. A CI job that runs `npm test` on either side. Whether a claimed shop
with an empty menu should pause its own listing. Whether a shop that genuinely trades around the clock can say
so at all. Whether the Where box should index the towns our own catalog already names. Whether Arizona's
Navajo Nation should keep daylight saving. The 4,736 listings whose area carries no town, as a supply gap. The "More options"
folding and `variantNote`, which an earlier run read but did not drive in a browser. Deals and promos on a listing driven in a browser, and the promo crawl's
output; only the rules behind them are read so far. Which clause on a policy owns the number the Free
cancellation badge prints, on the 28 listings where the first number in the text is not the one beside the
refund promise (see this run's Needs Harshil). Whether the listing page should print a rating with no
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
the API already takes. Whether an unclaimed shop open past midnight should sell its small hours on the next
date, the way a claimed one does, on the 481 that state one. Whether a shop whose week states only closed days, 18 of them, should be
bookable at all on the days it says nothing about. Whether a mixed policy column should read "Policies" or split
into a fourth column, which needs `src/styles`. Whether the rehearsal should open a listing that carries
policies, so the "Things to know" headings are checked in a browser and not only by their source. Whether
`explain` should be read at load time like `menuRow`, so a glossary fix reaches the shipped detail files
without waiting for a sync. Whether the 51 kinds of waves two and three should have a scene of their own, on
the 18,056 listings with no cover that draw the generic one instead. Whether `inferCategory` should read a
bare "charter" as fishing, and whether its last resort should still be jet ski. What a card, a rail and a
search result look like for a kind with no scene and no photo, driven in a browser rather than counted.
