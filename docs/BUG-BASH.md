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

## Coverage

**Verified so far.** The name a guest reads: the business name on all 59,125 shipped listings, against the
card, the page and the lite record alike, and the row name on all 141,717 shipped options, services and
add-ons. The concierge's vendor table against the catalog's own, over all 1,664 shipped booking links.
Booking validation and odd input on every route that takes it. The money split,
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
one listing used on another. The desktop home's search pill as controls rather than dialogs: what Who,
When and Where each actually change, and whether the party a guest picks reaches the box they book in. Every
"Show N places" button on the home, against the list the page then draws. Every service name and price tier
label the crawl holds, through the module that rewrites them for a guest (`plainServices.ts`). That no screen
in the app prints an em dash, now a test of its own. What a guest actually gets back for what they type,
ranked, over the whole shipped catalog: every kind against every metro and against the 90 busiest towns that
are not one, a glued spelling both ways round, a place name whose halves are two words, a town that is not a
metro, and every activity, elsewhere and city row pressed against the page it opens.

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

**Not yet checked.** Whether the concierge's watch window should have a browser door of its own: with
`ADMIN_KEY` set it now answers a browser 404 and only curl gets in, and the metrics page's emailed-code
sign-in is the pattern it lacks. Whether a concierge session id should be eight characters of `Math.random`
rather than `randomBytes`, since `getSession` adopts any id a caller sends. The concierge overlay against a
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
`https://fareharbor.com/` should be in `live-index.json` at all. Whether a vendor that answers with nothing
open across the whole window should leave the page showing our guessed nine, eleven and one, which it does.
Whether the vendor's own `bookUrl` for a departure should ever be offered to a guest: every reader carries
one and no surface draws it. Whether the landing pages should say they are showing 24 of the 35 they counted, which
is what a page with more than 24 listings does today, and whether a kind's all-metros page needs paging at
all. Whether the 50 kinds with no guide should have one written (see this run's Needs Harshil), and whether
the JSON-LD `numberOfItems` should say 35 when only 24 `itemListElement` entries follow it. Whether a page should carry an `og:` card at all,
since a shared link currently previews as nothing. Whether the 160 pages the next sync deletes should be
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
with an empty menu should pause its own listing. Whether a shop that genuinely trades around the clock can say
so at all. Whether the Where box should index the towns our own catalog already names. Whether Arizona's
Navajo Nation should keep daylight saving. The 4,736 listings whose area carries no town, as a supply gap. The "More options"
folding and `variantNote`, which an earlier run read but did not drive in a browser. Deals and promos on a listing driven in a browser, and the promo crawl's
output; only the rules behind them are read so far. Whether a GIF should stand in for a video at
all: 215 still lead a hero, and the rule that would clear them takes real photographs with them (see the
thirtieth run's Needs Harshil). Whether a fold should keep the largest spelling of a photograph rather than the first: it is the first on
181 of the 1,251 folds, and the first is what the card already loaded. Which clause on a policy owns the number the Free
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
search result look like for a kind with no scene and no photo, driven in a browser rather than counted. Whether the 6 listings publishing an nth-weekday or month rule ("Su[2] 13:00-15:30; Jan off; Feb off",
"May Mo[-1] - Oct Mo[2]") should have those rules read out to a guest, or the line dropped: they print as
written today. Whether the 12 operators whose published address is at free mail and stored wrong need a way
in before the next sync rewrites `claim-index.json`. Whether the sync should drop an hours line that is only
a heading ("Schedule Mon: 9:00 AM - 3:00 PM"). Whether a claimed shop's own email and website should ever
appear on the guest page, which they deliberately do not. Whether an unsubscribe token should outlive a
`CLAIM_SECRET` rotation, and whether `GET /mail/unsubscribed` should stay public (see this run's Needs
Harshil). The outreach send driven against a live API rather than read: a real draft run, a real `--dry`,
and what the drafts table looks like after a send that was refused. Whether "this takes the page down" in
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
feed worth reading. Any live vendor against its real server rather than a stub. Whether a sentence naming two
regions ("ontario california") should take the first one it recognises, which it does. Whether a budget read
out of "under 18s" should filter prices, which it does. The outreach list
script, `scripts/outreach-list.mts`, and the `GET /outreach/drafts` route it reads. Whether Gmail's one-click
`List-Unsubscribe` headers should be sent after all: the code deliberately leaves them off to stay out of
Promotions, which is a deliverability bet against a bulk-sender expectation. Whether `concierge.css`'s 330 lines for a
panel nothing renders should be deleted or a component written for them (see the fortieth run's Needs
Harshil), and whether the four `--cg-` custom properties they reach for should exist. The five new readers
against a real vendor server rather than read: Acuity, Rezdy, Square, TripWorks and Xola have never answered
anything here, so a vendor whose JSON has quietly changed reads as a shop with nothing open. Their pure
helpers, which have no tests: `priceOfSlot`, `isAgeGatedFare` (a hyphenated party size such as "2-4 players"
reads as a child fare to it), `rateLabel` and the price sheets behind them. Bookeo's 46 shops, which are a
documented negative from this address and want one `bookeoProbe` run from the Render worker. Whether a Xola
waiver or gift shell with no button id should be routed as a feed at all: four shipped links are, and the
reader correctly answers nothing for them. The concierge overlay's booking form, its error states and its
"copy the conversation" panel, none of which this run reached.
