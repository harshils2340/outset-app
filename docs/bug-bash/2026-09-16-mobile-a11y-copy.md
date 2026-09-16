# Bug bash, 16 September 2026: the phone layout, accessibility and the words

The phone app (`src/App.tsx` under 1024px, `src/components/explore/`, `src/components/listing/DetailView.tsx`,
`src/components/booking/Sheets.tsx` and `SlotCalendar.tsx`, inbox, trips, account, the compact operator
dashboard, `src/styles/app.css` and `air-phone.css`), accessibility on both the desktop and the phone site, and
every user-facing string in `src/` plus the claim emails in `backend/`. One of six areas running at the same
time. Format follows `docs/BUG-BASH.md`.

**Checked.** `npm ci` at the root and in `backend/`. The whole baseline before any change and again after every
commit: `npx tsc -b` and `npm test` at the root, `npx tsc -p tsconfig.json --allowImportingTsExtensions` and
`npm test` in `backend/`, and `npx vite build`. The built site was served with `npx vite preview` and driven
with Playwright at 390x844 (scale 3), 360x640 and 1280x800.

**Found and fixed.**

- **Two round buttons on the phone feed were too small to hit reliably** (`047754a73`). The Filters button
  beside the search pill was 40x40 and the heart on every feed card was 36x36, under the 44px square the rest
  of the app keeps. Both are 44x44 now, the heart inset so it sits exactly where it did.

**Found, not fixed.** Nothing yet.

**Needs Harshil.** Nothing yet.

## 16 September 2026, continued (new session, picked up after a usage-limit cutoff)

Restarted from `origin/main` (`git fetch origin main && git checkout -B main origin/main`) per the run's
own instructions, since the checkout arrives as a detached HEAD. Confirmed the touch-target fix above
(`047754a73`) was already landed and did not redo it.

**Checked.** `npm ci` at the root and in `backend/`. `npx tsc -b` and `npm test` at the root (161 tests),
`npx tsc -p tsconfig.json --allowImportingTsExtensions` and `npm test` in `backend/` (132 tests), and
`npx vite build`, all green before and after the em dash fix below. Grepped every `.ts`/`.tsx` file under
`src/` and `backend/src/` for the U+2014 em dash character (86 raw hits) and read each one in context.

**Found and fixed.**

- **Four backend files still used an em dash in prose comments and a vendor note, against the house
  writing rule** (`10df5225c`). Not user-facing, but our own writing, so it follows AGENTS.md's "never an
  em dash" rule same as guest copy. `backend/src/api/availability.ts`'s route doc comment, one inline
  comment in `backend/src/enrich/availability.ts`, several doc comments in `backend/src/enrich/sitescrape.ts`
  describing the service-vocabulary tiers, and two capability notes in `backend/src/enrich/vendors.ts`.
  Replaced each with a comma, colon or period. Left every regex character class (`[-–—]` and similar, used
  to strip em dashes out of scraped external text) and the HTML entity map in `rezdy.ts` alone, since those
  are data, not our prose. Also left the em dash in two test fixtures
  (`backend/src/enrich/__tests__/sitescrape.test.ts`, `crawl.test.ts`) that simulate a scraped external
  page's HTML title, since that is fake foreign content, not copy we write to a user.

- **A listing's back button and its guest-count stepper said nothing to a screen reader**
  (`1c7ebad9b`). VoiceOver and TalkBack announced bare "button" three times on
  `src/components/listing/DetailView.tsx`: the chevron over the hero photo, and the +/− either side of
  the rider or guest count, all icon glyphs with no accessible name. The back button now has
  `aria-label="Back"`, each stepper button says "Fewer" or "More" plus the listing's own count label
  (`listing.qtyLabel`), and the live number is `aria-live="polite"` so a change is announced without
  moving focus. Checked every other icon-only button across `src/components` for the same gap (searched
  for a `<button>` whose only content is an icon, no visible text, no `aria-label`) and found none; the
  rest of the app, including the operator booking drawer and the search sheet, already labels its
  icon-only controls.

- **Two contradictory promises about unbuilt features, both against AGENTS.md's ban on "soon"-style
  words** (`6caf6857e`, `212a3dee9`). A guest's Profile tab said card payments, waivers and saved areas
  "are on the way", one row above an `aria-label` on the same four rows that correctly says "not built
  yet" (`src/components/account/AccountView.tsx`). An operator's Payouts page said the same kind of gap
  two different ways four lines apart: "Card payments are not switched on yet" in one paragraph, "Card
  payments and payouts switch on shortly" in the next (`src/components/operator/OpMore.tsx`). Reworded
  both to the plain, already-used "not built yet" / "not switched on yet" phrasing, which promises
  nothing about timing. Grepped `src/` for `on the way`, `coming soon`, `shortly`, `in the future` and
  `eventually` in string literals; the only other hits were a hot-air-balloon description and a jet-ski
  add-on note, both literal "on the way down" through the air, not a roadmap promise.

- **Three bottom-anchored bars were missing `env(safe-area-inset-bottom)`, so their buttons crowded the
  home indicator on a phone with a safe area** (`11b9603d9`, `c03b2c3d7`). The guest tab bar and the
  search/pay sheet footers already carried this padding; three siblings did not: the sticky price bar on
  a listing page (`.dock` in `src/styles/app.css`, used by `DetailView.tsx`), the compact operator
  dashboard's bottom tab bar (`.odtabs` in `src/styles/operator.css`), and its booking detail's
  bottom-sheet drawer (`.od.compact .oddrawer`). All three now add `env(safe-area-inset-bottom)` to
  their existing bottom padding, the same fix already applied to `.tabbar`. Grepped both stylesheets
  for every `position:fixed` / `position:sticky` rule anchored to `bottom:0` to check the rest; nothing
  else was missing it, and the operator's compact toast already sits at `bottom:96px`, well clear.

**Checked, this round.** Playwright screenshots at 390x844 (dark and light), 360x640 and 1280x800 of the
explore feed, the search sheet, a listing detail (unclaimed Request flow), the Wishlists, Trips, Inbox
and Profile tabs, and the compact operator dashboard's Home and Bookings screens. Read
`src/components/booking/Sheets.tsx`, `SearchSheet.tsx`, `src/components/operator/OpBookings.tsx`'s
booking drawer and `src/state/AppProvider.tsx` for focus management: all three already move focus into
a sheet or drawer on open and back to the opener on close, mark the background `inert` while a sheet is
open, and close on Escape. No changes needed there.

**Found, not fixed.**

- On the compact operator dashboard, a booking row's middle column (date, time, guest count) truncates
  with an ellipsis before the guest count when the amount and the "NEEDS ANSWER" badge on the right run
  long, e.g. "Today · 4:00 PM…" hides the guest count entirely at 390px
  (`src/components/operator/OpBookings.tsx`'s `BookingRow`, `.odbkmain .meta small` in
  `src/styles/operator.css`). This is the same single-line ellipsis pattern used everywhere else in the
  app (search sheet rows, cards), so it is a width trade-off rather than a stray bug, and re-flowing the
  row risks the rest of the compact dashboard. Left it; worth a proper pass if Harshil wants the guest
  count to never hide.

**Needs Harshil.**

- The guest catalog's price display (`money()` in `src/lib/format.ts`, used by every card, listing page
  and the booking sheets) always prints a bare "$", never "CA$" or "USD", even though the operator
  dashboard's own payout screen already knows how to show a Canadian amount as "CA$95"
  (`OpMore.tsx`'s `cents()`). AGENTS.md asks for money with its unit, and the catalog covers the US and
  Canada. Fixing the display alone would be misleading, though: `Listing`/`Unclaimed` carry no currency
  field, so the scraped and OSM-sourced prices going into `money()` are not tagged USD or CAD anywhere
  in `src/data/` or the backend catalog pipeline that feeds it. Showing "CA$" would mean guessing from
  the metro instead of the operator's own listed currency, which is exactly the kind of invented fact
  AGENTS.md rules out. This needs a currency field threaded through the catalog pipeline (the
  pipeline-and-catalog area's territory, not a wording fix), so flagging it rather than guessing at one.
