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
