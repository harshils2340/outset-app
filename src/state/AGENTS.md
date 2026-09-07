# src/state

Read `/AGENTS.md` first.

`AppProvider.tsx` is the only app-wide store. Screens dispatch actions. Do not add a second global store.

Booking confirm must go through `confirm` so inventory, trips, and persistence stay in sync.

Chat replies must go through `sendChat` so the agent sees current slots.
