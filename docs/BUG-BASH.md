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

**Not yet checked.** The operator chat for a hand-built listing (`src/data/listings.ts` is empty, so
`agent.ts` and the `ChatView` operator path still have no live case). The metro picker at 400px in a browser:
its counts and its logic were read, the layout was not. What a guest can do on a claimed listing whose menu is
empty, now that the state persists (see the seventh run's note). Photo upload against a real GitHub token, and
the gap between the URL it returns and the deploy that makes the file exist. Drag reordering in a browser: the
fix is reasoned from the drag model, and the repo has no renderer to test a hook in.
