# src/lib

Read `/AGENTS.md` first.

Pure functions only. No React.

- `inventory.ts`: hashed baseline capacity minus local bookings.
- `pricing.ts`: unit rules plus 8% service fee. `priceUnclaimed` for catalog operators.
- `catalog.ts`: site URLs, catalog lookups, maps directions, and listing fact splits (experience / who / waiver). Never invent age, weight, or waiver rules.
- `geo.ts`: haversine miles and guest-facing distance stamps.
- `agent.ts`: operator voice. Short answers. No invented inventory.
- `storage.ts`: localStorage keys `outset.bookings` and `outset.chats`.
- `dates.ts` / `format.ts`: calendar keys and guest-facing stamps.
- `search.ts`: guest search for Explore and the desktop home. One inverted word index built once per catalog (`warmSearch` folds it in during idle time), then ranking by name, activity synonyms, words and city. Stems, typos and the operator name picker (`searchByName`) all read that index. Scope by city or category through `SearchScope`, never by passing a freshly filtered array, or the index rebuilds every keystroke. `searchSuggest` returns the grouped typeahead and the feed in one pass. No invented listings.

Do not call `localStorage` outside `storage.ts`.
