# src/components

Read `/AGENTS.md` first.

UI only. `Markup.tsx` injects icon SVG strings from `src/data/icons.ts`. Keep event handlers thin and call `useApp()`.

`operator/` screens call `useOp()` from `opContext.tsx` instead: it hands them the profile, a `set` that saves and pushes edits to the guest listing, and the merged bookings list. Icons for the dashboard live in `OD_ICONS` there.
