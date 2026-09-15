# src/components/booking

Read `/AGENTS.md` first.

Review sheet, Instant Book sheet, metro picker, and the confirmation ticket. Catalog bookings use `priceUnclaimed` and create a real on-device booking. Facts and prices come from each operator's site. Do not invent missing prices. Do not show claim or request-only copy.

The Instant Book sheet always shows Who can go and Waiver & check-in. If the operator did not publish those facts, say so. Do not invent age, kid, weight, or waiver rules. The location row is one-tap Google Directions. Distance is to the metro city center, not a fake operator pin.

On the phone the catalog listing (`RequestBody`) and the search (`metro` sheet: Where / What / When / Who, which lives in `explore/SearchSheet.tsx`, or Filters here) open full screen in Airbnb's shape, with a sticky reserve bar and a separate Request to book step that collects name, mobile and email. Every close control calls `closeSheet` so the history entry AppProvider pushed is popped; never add a local close handler.
