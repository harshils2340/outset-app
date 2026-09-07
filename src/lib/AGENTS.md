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
- `search.ts`: typeahead ranking for Explore. Synonyms and light fuzzy match. No invented listings.

Do not call `localStorage` outside `storage.ts`.
