# src/components/layout

Read `/AGENTS.md` first.

Chrome around the app: desktop pitch, status bar, tab bar, toast, brand mark, and `useModal`, which is what
`aria-modal="true"` has to mean on a dialog: focus in and back, Tab kept inside, the page behind held still.
Lock the page through it, never by hand: `app.css` clips `html`, so `body { overflow: hidden }` locks nothing. The phone tab bar is Airbnb's five items (Explore, Wishlists, Trips, Inbox, Profile); Wishlists is a page of the Explore tab switched through `explore/prefs.ts`, not a fifth app tab. Tab bar hides on chat and the operator dashboard. Do not add extra nav.
