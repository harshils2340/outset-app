# Outset

Instant-booking marketplace for local experiences (jet ski, skydiving, karting, escape rooms, parasailing, kayaking, charters, paintball, etc.) — "DoorDash for experiences." Every listing is instant-book with live availability, and an AI agent per business answers questions by text (and eventually phone) instead of making people call.

## What's here

`index.html` — a self-contained, single-file working prototype (no build step, no dependencies). Open it directly in a browser, or serve it with any static host.

The app includes:
- A mobile-app-style booking flow (browse → pick a time slot → add-ons → confirm) across 13 demo listings spanning air, water, motorsport, indoor and outdoor categories.
- A "Not on Outset yet" section seeded with **12 real Tampa Bay businesses**, with facts (pricing, capacity, specs) pulled directly from each business's own website — never invented. Anything a business doesn't publish is shown as an honest gap instead of a guess.
- A per-listing AI agent chat (via Claude), so guests can ask questions and get answered from that business's real data instead of calling.

## Running it locally

Just open `index.html` in a browser. For a nicer local dev loop:

```
npx serve .
```

## Status

This is an early prototype, not production infrastructure. No real payments, no real operator onboarding flow, no phone integration yet — see the product notes in conversation history for the roadmap.
