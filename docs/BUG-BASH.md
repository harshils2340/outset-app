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

## Coverage

**Verified so far.** Booking validation and odd input on every route that takes it. The money split,
pay-on-site pricing, the service fee tiers. Double booking past capacity, and party size against a time's
capacity. Payout scheduling, cycles and the payouts tiles. The Stripe Connect button. The booking and decision
emails. The rehearsal itself, which now runs both sides' unit tests. Start times from a claimed shop's hours:
odd hours, days off, blocked slots, the notice, the window, a shop open past midnight. The week a shop starts
on, read from its own published hours. The booking box price lines, including a service with no price. Phone
width at 400px on the guest listing, the booking flow and every dashboard page. Accessibility on the booking
flow: focus order, input labels, disabled buttons. Colour contrast on the accent. The API unreachable and the
API slow. The Availability page and the setup checklist counting itself. Search and browse: a query matching
nothing, a metro with one listing, a category with none, paging, an unpublished or paused listing staying out
of the lists, and every way out of an empty search. Claim and sign-in: an address that does not match the
business, an expired link, an edited expiry, one listing's link used on another, a link claimed twice, a
sign-in code typed wrong six times, and a session for one listing used on another.

**Not yet checked.** Dashboard Calendar end to end (blocking a slot and a day, and whether a blocked slot in
the week view reaches the guest picker; the key format matches, nothing has driven it). Services end to end
(adding, hiding, deleting, and a negative price typed into an add-on, which `min={0}` does not stop and
`priceBooking` sums without a guard). Settings and Assistant. The remaining empty states: a brand new claimed
shop with nothing filled in, seen from the guest side. Add-ons end to end on a real listing (no catalog record
was found carrying both an unpriced service and a paid add-on to drive by hand). A shop whose published hours
are not on the half hour, through a real claim. The Trips and Inbox tabs, which no run has opened.
