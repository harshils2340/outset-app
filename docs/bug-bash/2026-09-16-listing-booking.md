# Bug bash, 16 September 2026: the listing page and the booking flow

One of six areas run in parallel. This one is `src/components/web/WebListing.tsx` and
`src/styles/air-listing.css`, `src/components/web/WebConfirm.tsx`, the booking box and its date and time
picker, `src/lib/pricing.ts`, `src/lib/inventory.ts`, `src/lib/openNow.ts`, `src/lib/listingDerive.ts`, the
checkout hand-off and the return from Stripe, the phone-frame version of the same flow
(`src/components/booking/Sheets.tsx`), and the emails a booking sends.

**Checked.** `npm ci` at the root and in `backend/`, then the full baseline before any change and again after
every commit: `npx tsc -b` and `npm test` at the root (145 tests green at the start, 147 after), `npx tsc -p
tsconfig.json --allowImportingTsExtensions` and `npm test` in `backend/` (121 green), and `npx vite build`.
`AGENTS.md` at the root and the nested ones under `src/`, `src/components/`, `src/components/booking/`,
`src/components/listing/`, `src/lib/`, `src/state/` and `src/styles/`, and all fourteen runs in
`docs/BUG-BASH.md` so nothing here is a redo.

**Found and fixed.**

- **A guest in another timezone lost the shop's remaining start times** (`96c6f836f`, landed by the run that
  was cut off). The date picker's today cutoff read the shop's clock instead of the browser's, in
  `bookableStart` and `dayKeyIn` in `src/lib/openNow.ts`.
- **Picking a smaller service showed every date as fully booked** (`085500b74`, same run). The party size now
  clamps to the picked service's capacity.
- **A guest was promised an answer "usually within the day"** (`46ce4e563`). Both confirmation screens
  (`WebConfirm.tsx`, `booking/ConfirmView.tsx`) and the request email (`backend/src/api/bookingMail.ts`) told
  the guest the business "confirms by email, usually within the day". No operator agreed to that, so a shop
  answering on Tuesday had broken a promise Outset made on their behalf. All three now say only what we know:
  the request is with the business, nothing is charged until they confirm, and the guest hears the moment they
  answer.
- **"Show up 15 minutes early" was a rule nobody published** (`dc78c718e`). It sat on the desktop
  confirmation's step list and in both booking emails (the instant confirmation and the accepted-booking
  email), and it is wrong for a shop that says 10 minutes, 20 minutes, or nothing. All three now print the
  operator's own arrival line and drop the step when there is none; the numbered steps close over the gap. The
  sign-off guard the listing page already had ("See you soon!" is a goodbye, not arrival information) is one
  exported `arrivalNote` helper now, shared by the listing page, the phone sheet and the confirmation, and
  mirrored on the API side against the listing's detail file and the operator's published patch.
- **A booking for next January read as though it were this January** (`9c2d2733f`). `fmtDate` in
  `src/lib/format.ts` printed no year, so the confirmation ticket, the Trips list, the booking box and the
  start-times header all showed "Sat, Jan 3" for a trip booked in late December. The year is printed whenever
  the date is outside the current year and left off otherwise, so the date strip stays short. The desktop
  confirmation's own long date, formatted separately, follows the same rule. Two cases pinned in
  `src/lib/__tests__/fmtDate.test.ts`.

- **A ticket priced "$0" instead of "Price on request"** (`99d091ee1`, resumed run). `src/lib/pricing.ts`'s
  `hasPrice` guard exists exactly for this: a scraped record can carry a `0` price where the crawler found a
  currency sign and no number, and "$0" reads as free instead of unknown. In `WebListing.tsx` the picker's
  option list (`item.options.map`, used when a listing has no service groups) and the booking box's option
  dropdown (`optGroups` rows, which carry both service-variant and flat-option prices) checked only
  `price != null`, so a `0` sentinel passed through and printed "$0" next to a ticket nobody has a real price
  for. The service-card picker a few lines above already used `hasPrice`; the option list and the dropdown now
  match it. Two other `price != null` reads in the same file (the docked total's line label, and
  `WebConfirm.tsx`'s price line) turn out to already be gated by `p.base` / `lines`, which `priceUnclaimed`
  zeroes out for the same sentinel, so those never actually reached a guest; left alone.

- **Otto could tell a guest a trip is "$0.00"** (`1c649fec9`). The same `0`-means-unknown sentinel from the
  bullet above reaches `src/lib/companyAgent.ts`, the 24/7 assistant, which builds its `Offer` list straight
  from `item.services` / `item.options`. Its `priceOf` helper, and every filter deciding whether an offer counts
  as "priced" (for "From $X", "Prices start at $X", the cheapest option, "is this one priced by the hour",
  comparing two offers by price), checked only `price != null`, so a listing with an unpriced option would have
  Otto state a price it does not know as though the shop had published it, which is exactly what
  `AGENTS.md` forbids for the assistant. All of them now go through `hasPrice`, imported from `pricing.ts`. Left
  alone: the live-vendor slot price in `liveSlots`/`slotLine` (real FareHarbor/Peek/Xola cents, not a scrape
  sentinel), and `item.from`, which the sync job (`backend/src/sync/contacts.ts`) and `mergeOverride` in
  `catalog.ts` already compute with the same `> 0` filter, so it can never be the sentinel at this layer.

- **The phone app's flat option list had the same "$0" tell** (`dd4d9015a`). `Sheets.tsx`'s own `optionPrice`
  helper, used by the picker that shows when a listing has no service groups, checked `o.price == null` instead
  of `hasPrice`, so it printed the sentinel too. Now guarded the same way.

After those three, ran the local rehearsal against a scratch Postgres (`postgresql-16`, self-signed cert combined
with the CCR CA bundle for `NODE_EXTRA_CA_CERTS`): `backend/scripts/store-e2e.mts` (60 checks), then
`backend/scripts/payout-e2e.mts` (43 checks), then the full browser rehearsal
`backend/scripts/e2e-local.mts` with `CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. All 52 of its
steps passed, including both projects' unit tests run inside it (164 root, 135 backend at that point) and all 14
emails it produces read back for an HTML version, a human date and money with a currency.

Also read `src/components/listing/DetailView.tsx` and `src/lib/inventory.ts` end to end (the booking surface for
a hand-built `Listing`, as opposed to the scraped `Unclaimed` catalog `WebListing.tsx` covers). Nothing wrong
found, but it is worth restating what an earlier run already noted: `src/data/listings.ts` ships empty by
product rule, so this whole surface, `agent.ts` and the operator `ChatView` path have no live guest case right
now. Its `Addon` type carries a plain, hand-typed price rather than a scraped one, so the `hasPrice` sentinel
bug above does not apply there.

Closed out against the latest `main` after a final fast-forward pull: `npx tsc -b` clean, 166 root tests green,
`npx vite build` clean.

**Found, not fixed.**

_(none open)_

**Needs Harshil.**

_(none)_
