# src/lib

Read `/AGENTS.md` first.

Pure functions only. No React.

- `inventory.ts`: hashed baseline capacity minus local bookings.
- `pricing.ts`: unit rules plus 8% service fee.
- `agent.ts`: operator voice. Short answers. No invented inventory.
- `storage.ts`: localStorage keys `outset.bookings` and `outset.chats`.
- `dates.ts` / `format.ts`: calendar keys and guest-facing stamps.

Do not call `localStorage` outside `storage.ts`.
