# Bug bash, 16 September 2026: guest home and search

The desktop guest home and the search behind it: `WebHome.tsx`, `search.ts`, `catalog.ts`, `catalogLoad.ts`,
`places.ts`, `geo.ts`, and the boot and deep-link handling in `AppProvider.tsx`. One of six areas running at the
same time. Format follows `docs/BUG-BASH.md`.

**Checked.** `npm ci` at the root and in `backend/`. The whole baseline before any change and again after every
commit: `npx tsc -b` and `npm test` at the root (143 tests before, 145 after), `npx tsc -p tsconfig.json
--allowImportingTsExtensions` and `npm test` in `backend/` (121 tests), and `npx vite build`. The built site was
served with `npx vite preview` and driven with Playwright at 1440px.

**Found and fixed.**

- **A price an operator had just changed was not the price the search filtered or showed** (`893d0b426`). The
  word index folded the listing objects and handed those same objects back as results, while `rebuild()` in
  `catalog.ts` makes new objects on every operator edit and every time a lite record is swapped for its own
  detail file. So a guest searching after a shop dropped a ride to $40 got the record from before the edit: the
  old price on the card, the old photos, and an "under $50" search that kept the ride out. When the ids still
  match, each changed entry is now repointed at the new record, with its starting price, rating weight and age
  and group answers read again; the postings are untouched, so the 59,000 entry index is not rebuilt. Two tests
  in `src/lib/__tests__/search.test.ts` cover it.
- **Holding the down arrow in the Where box never left the first place** (`95b8cf61c`). Every press reopened the
  Where segment, which starts the highlight over, so the highlight went back to the first row and stayed there.
  Enter then ignored the highlight and took whatever the typed text matched, because it tested a segment the
  modal had already closed. The arrows now walk the rows the modal draws, which is the first eight of the
  shortlist when nothing is typed, and Enter takes the highlighted row. The Where input carries `role=combobox`
  with `aria-expanded`, `aria-controls` and `aria-activedescendant`, and the rows carry the ids it points at, as
  the What input already did.

**Found, not fixed.**

- A listing renamed in the operator dashboard is still reachable by the name it was folded under, not by its new
  one, until the catalog itself reloads. Repointing keeps the word postings, and rebuilding them for one listing
  means removing it from every posting list it appears in. The entry's own name fields do follow the edit, so
  the operator name picker (`searchByName`) finds the shop under the new name. `src/lib/search.ts`, `repoint`.

**Needs Harshil.** Nothing yet.

## Run continued 2026-09-16 (this session)

The `95b8cf61c` fix cited above never reached `origin/main`; that attempt was cut off by a usage limit and lost
every commit it had not pushed. Checking history before redoing anything: the down-arrow bug was independently
fixed and pushed as `b1ed4ed85`, and the price/repoint fix above is confirmed present at `893d0b426`. Both leads
(a) and (b) from this run's brief are therefore already on `main`. Verified rather than redone:

- `src/components/web/WebHome.tsx` gives the Where input `role="combobox"` with `aria-expanded`,
  `aria-controls="ah-where-list"` and `aria-activedescendant`; the list carries `role="listbox"` with
  `id="ah-where-list"` and rows with `id="ah-wrow-"+i`; `moveHit`/`onWhereKey` walk `whereShown` (the drawn,
  capped-at-8 rows) without reopening the segment or resetting the highlight, and Enter takes the highlighted
  row.
- `src/lib/search.ts` has `repoint()`, invoked whenever `index.pool !== pool` but the ids still match, and
  `src/lib/__tests__/search.test.ts` has both required tests.

`git fetch origin main && git checkout -B main origin/main` was run first to get off the detached, stale
checkout. Baseline re-run clean: `npx tsc -b`, `npm test` at the root (153 tests), `npx tsc -p tsconfig.json
--allowImportingTsExtensions` and `npm test` in `backend/` (132 tests), `npx vite build`. Moving on to lead (c)
(deep links into the lite shard) and general hunting across the area.

**Checked.** The built site with `npx vite build` then `npx vite preview --port 5199`, driven with Playwright
(Chromium at `/opt/pw-browsers/chromium`, `--no-sandbox`) at 1440px, against `catalog.json`, `catalog-lite.json`
and the per-listing `o/*.json` files actually in `public/`. Confirmed every one of the 59,163 operators in
`catalog.json` (and every one of the 2,200 in `catalog-lite.json`) is `lite: true` with an empty `options` array;
only a listing's own detail file under `o/` carries its real menu, so opening any generated-catalog listing (not
a hand-verified seed) always goes through a 0-to-N options hydration a beat after the sheet opens, never the rare
case the code's own comment implied. Reproduced the deep-link paths from the brief: cold `#o=`, `#paid=&o=`, and
`#claim=&k=` all opened the right screen from the first paint with no console error, and a listing opened by
`#o=` before any catalog fetch resolved (its own file merged in fresh) kept its full record, gallery included,
through the lite shard and full catalog arriving after it, per the existing guards in `mergeCatalog`.

**Found and fixed.**

- **Picking a start time the instant a listing opened could vanish a moment later** (`352093485`). Every
  generated-catalog listing (every operator in `catalog.json`, not an edge case) opens with an empty menu until
  its own detail file lands, and the effect that re-picks a default service once that menu arrives also cleared
  the picked date's time, unconditionally, on every hydration, not only when the guest had switched to a
  different listing. A guest who picked a time in the roughly half-second before the detail fetch resolved,
  which "the card is live from the first paint" invites them to do, watched their selection silently revert to
  "Add time" with no message. The time now only clears when the listing itself changes; the existing `openSlots`
  guard a few lines down still clears it if the hydrated menu's real hours make it invalid. Reproduced and
  verified with a Playwright script that delays the detail-file response and picks a time in the gap, both
  before and after the fix, and confirmed switching to a different listing still clears the time as before.
- **A browser window exactly 1024px wide loaded the phone frame instead of the desktop site** (`29ddd8697`).
  `App.tsx` decided which one to render on load with `window.innerWidth > 1024`, so 1024px itself, this run's own
  floor for "the layout from 1024px up", fell on the wrong side of it. Changed to `>= 1024`. Verified at 1023,
  1024 and 1025px with Playwright: 1024 now renders `.web` (the desktop site) rather than `.stage` (the phone
  frame), matching 1025 instead of 1023.
- **A place search cached under the typed text alone kept using the wrong bias** (`55fc188eb`). `searchPlaces` in
  `places.ts` takes the guest's current place as a bias so Photon ranks a query like "Spring" by what is actually
  nearby, but the module-level cache keyed on the typed text alone. Typing the same word again after "Nearby" set
  a bias, or after picking a different place earlier in the same session, silently returned whatever the first,
  differently biased call had cached, with no sign anything was stale. The bias now rounds into the cache key
  too. Two tests in `src/lib/__tests__/searchPlacesBias.test.ts` cover it, checked against the pre-fix code to
  confirm they fail there.

**Found, not fixed.** Nothing new this run beyond the item already listed above.

Also checked and found correct, not fixed because nothing was wrong: the Where, when and who modal's Escape key
and outside-click close (both close the dialog; an earlier check with a loose CSS selector that also matched the
always-present chip button had wrongly suggested otherwise), the Nearby button with geolocation granted (resolved
to the guest's real coordinates and re-sorted distances correctly), the What box against a `<script>` tag (escaped
in the DOM, no XSS, correct "nothing found" empty state), and the hover slideshow's arrow buttons (`stopPropagation`
keeps them from opening the listing).

**Needs Harshil.** Nothing yet.
