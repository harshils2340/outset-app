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
