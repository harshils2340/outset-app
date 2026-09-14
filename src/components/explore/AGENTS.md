# src/components/explore

Read `/AGENTS.md` first.

Phone home feed in the Airbnb app's shape (styles in `src/styles/air-phone.css`): a full-width search pill ("Where to?" over "Anywhere · Any week · Add guests") with a round filters button, the icon-over-label category bar with a dark underline, then one full-width card per row. Cards (`UnclaimedCard`) are a swipeable photo with dots, a heart, one white badge, then title and rating, place, a grey detail line and the price. Browse requires a real cover; search by name does not. Tapping the pill or filters opens the `metro` sheet in `booking/Sheets.tsx` (full-screen Where / When / Who, or Filters), so back and Escape close it through AppProvider. `prefs.ts` holds the wishlist, the Wishlists page flag, the When / Who picks and the feed filters; `feed.ts` is the browse and filter logic shared with the filters sheet. "Instant" only when `claimed && instant`. Do not invent ratings.
