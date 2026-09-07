# Outset platform

Read this file at the start of every task in this repo. Nested `AGENTS.md` files add folder rules. They do not replace this one.

## What this product is

Outset is an instant-booking marketplace for local experiences (skydives, jet skis, karting, escape rooms, charters, and similar). The first market is Tampa Bay, Florida.

The product promise:

1. Live inventory, not a phone number.
2. Instant confirmation for listings that are on Outset.
3. A per-operator booking agent that answers only from published facts, policy, and current slots.
4. Supply seeding for real local businesses that are not on Outset yet. Show their public facts. Never invent availability, price, hours, age rules, or inclusions.

This is "DoorDash for experiences" in the sense that guests pick a slot and pay. It is not a lead-gen directory.

## Hard product rules

- Instant-book listings (`src/data/listings.ts`) have real slot math. Guests can complete checkout in the app.
- Unclaimed businesses (`src/data/unclaimed.ts`) were pulled from each company's own site. If a fact is missing, keep the honest gap. Do not guess.
- The operator agent (`src/lib/agent.ts`) must not invent a price, policy, or open slot. If it does not know, it says it will have the owner confirm.
- Bookings persist on-device (`src/lib/storage.ts`). There is no payment processor and no backend yet. Do not pretend otherwise in UI copy.
- Demo inventory is Tampa Bay. Do not silently relocate the market.

## App shape

Vite + React + TypeScript. No router. Screen state lives in `src/state/AppProvider.tsx`.

Tabs: Explore, Trips, Inbox, Account.
Stacked screens: listing detail, checkout confirm, operator chat.
Sheets: review-and-pay, request-info for unclaimed operators.

Desktop: marketing pitch + phone frame (`.stage`, `.device`, `.screen`).
Mobile: the frame goes away and the app is full viewport.

## Where to change things

| Need | Place |
| --- | --- |
| Copy, prices, policies, add-ons for live listings | `src/data/listings.ts` |
| Unclaimed Tampa operators | `src/data/unclaimed.ts` |
| Categories and explore headers | `src/data/categories.ts` |
| Slot times | `src/data/slots.ts` |
| Scene illustrations | `src/data/art.ts` |
| Agent answers | `src/lib/agent.ts` |
| Availability math | `src/lib/inventory.ts` |
| Fees and totals | `src/lib/pricing.ts` |
| Visual system | `src/styles/app.css` |
| Screen flow | `src/state/AppProvider.tsx` |

## Writing rules

Never use an em dash. Use a comma, a period, a colon, or a hyphen.

Keep guest copy specific and local. Avoid generic marketplace filler.

Match the existing visual language: Archivo for display, Public Sans for body, IBM Plex Mono for stamps and prices, accent `#EE4E1B`.

## How to run

`npm install` then `npm run dev`. `npm run build` must stay green after changes.
