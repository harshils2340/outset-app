# Outset platform

Read this file at the start of every task in this repo. Nested `AGENTS.md` files add folder rules. They do not replace this one.

## What this product is

Outset is an instant-booking marketplace for local experiences (skydives, jet skis, karting, escape rooms, charters, and similar). The first market we verified by hand was Tampa Bay, Florida. The guest catalog and supply grid now cover the United States and Canada. The guest app presents those real operators as Instant Book.

The product promise:

1. Live inventory, not a phone number. Guests Instant Book from the catalog.
2. Instant confirmation.
3. A per-operator booking agent that answers only from published facts, policy, and current slots.
4. Supply seeding for real local businesses that are not on Outset yet. Show their public facts. Never invent availability, price, hours, age rules, or inclusions.

This is "DoorDash for experiences" in the sense that guests pick a slot and pay. It is not a lead-gen directory.

## Hard product rules

- Instant-book listings (`src/data/listings.ts`) stay empty until a real operator claims. Do not refill with invented shops.
- Unclaimed businesses (`src/data/unclaimed.ts`) were pulled from each company's own site. If a fact is missing, keep the honest gap. Do not guess.
- The operator agent (`src/lib/agent.ts`) must not invent a price, policy, or open slot. If it does not know, it says it will have the owner confirm.
- The company assistant (`src/lib/companyAgent.ts`) answers only from that operator's published facts and synced contact record. It refuses weather, directions, comparisons, reviews, and anything about other businesses, and hands off to a person at the shop. Keep the refusal list when adding intents.
- Supply must be at real-world scale. Hand-typed operator lists are seeds, not the catalog. Grow the catalog with discovery (`backend/src/discover/`), never by inventing entries.
- Bookings persist on-device (`src/lib/storage.ts`). Operator truth also lives in `backend/` SQLite. Do not invent live slots in the backend.
- Guest catalog is real operators across US and Canada metros, shown as Instant Book. Tampa is the densest verified batch. The backend metro grid is the same 47-city list.
- Never start catalog crawls, Playwright, or the overnight pipeline on the founder's Mac. `photos`, `structure`, `enrich`, `owners`, `hours-crawl`, `promo-crawl`, `screen-covers`, all-state `discover`, and `pipeline` run on Render. Do not set `OUTSET_ALLOW_CRAWL`. Keep at least 10% CPU idle so Cursor stays usable (`cd backend && npm run cpu`). If headless Chrome is already on the CPU, `cd backend && npm run chrome:reap`.

## Backend (supply)

`backend/` discovers real operators from OpenStreetMap (`npm run backend:discover`, one Overpass query per state or province, cached in `backend/data/osm/`), stores unclaimed operator profiles, scrapes public websites, scores completeness, and drafts claim emails. `npm run backend:sync` writes each operator's public contact facts (website, phone, email, street address, hours) into `src/data/contacts.ts`, keyed by domain, so every listing page embeds them. Instant book stays off until an operator claims. See `backend/AGENTS.md`.

## App shape

Vite + React + TypeScript. No router. Screen state lives in `src/state/AppProvider.tsx`.

Tabs: Explore, Trips, Inbox, Account.
Stacked screens: listing detail, checkout confirm, operator chat.
Sheets: review-and-pay, Instant Book for catalog operators, metro picker.

Desktop: the guest site copies airbnb.com (`src/components/web/`). The phone frame (`.stage`, `.device`, `.screen`) is reachable through "Open the app".
Mobile: the frame goes away and the app is full viewport.

## Operator side

`src/components/operator/` is the operator dashboard: the Uber Eats merchant app plus Booksy. Claiming: the owner finds the business by name (`searchByName`, name and domain only, so it stays fast over 40,000 operators), types their name, work email and mobile, and the API emails the signed claim link, but only to the address on the business's own website or one at its domain (`POST /claims/:id/request`, checked against `backend/data/claim-index.json`). The link `#claim=<id>&k=<token>&o=<owner>` opens the dashboard with no code. Outreach emails carry the same link. With no API the demo code is shown on screen. Pages: Home, Bookings (Accept / Decline, Instant Book switch, detail drawer), Calendar (week view, block slots and days off), Services (menu editor), Availability (hours, notice, window, days off), Listing (publish switch, photos, contact, policies), Assistant (what Otto knows, test chat), Payouts, Settings. On desktop it is a full page with a sidebar. In the phone frame the same screens render with a bottom tab bar (`compact`).

Everything the operator edits is one `OperatorProfile` in `src/lib/operator.ts`, saved on-device and layered over the catalog record through `setOperatorOverride` in `src/lib/catalog.ts`, so price and photo edits show on the guest listing and the publish switch pulls the listing from rails and search. Guest bookings made in the same browser appear in the operator feed. Sample bookings are tagged Sample and removable. Payments, SMS, email and calendar sync are deferred on purpose: the dashboard says so where it matters.

## Where to change things

| Need | Place |
| --- | --- |
| Copy, prices, policies, add-ons for live listings | `src/data/listings.ts` |
| Unclaimed operators | `src/data/unclaimed.ts` plus `src/data/unclaimedNational.ts` |
| Operator contact facts (phone, email, address, hours, site) | Generated `src/data/contacts.ts`. Run `npm run backend:sync` after a scrape. Never hand-edit. |
| Full operator catalog (thousands, from OpenStreetMap plus scrapes) | Generated `public/catalog.json`, fetched at startup and merged in `src/lib/catalog.ts`. `npm run backend:discover` then `npm run backend:sync`. |
| 24/7 company assistant (chat for catalog operators) | `src/lib/companyAgent.ts`. Published facts only. No outside knowledge. |
| Metros | `src/data/metros.ts` (keep in sync with `backend/src/taxonomy/catalog.ts`) |
| Categories and explore headers | `src/data/categories.ts` |
| Slot times | `src/data/slots.ts` |
| Scene illustrations | `src/data/art.ts` |
| Agent answers | `src/lib/agent.ts` |
| Availability math | `src/lib/inventory.ts` |
| Fees and totals | `src/lib/pricing.ts` |
| Visual system | `src/styles/app.css` (guest), `src/styles/operator.css` (operator dashboard) |
| Operator dashboard data, defaults, persistence | `src/lib/operator.ts` |
| Operator dashboard screens | `src/components/operator/` |
| Screen flow | `src/state/AppProvider.tsx` |
| Operator profiles, scrape, outreach | `backend/` |

## Writing rules

Never use an em dash. Use a comma, a period, a colon, or a hyphen.

Keep guest copy specific and local. Avoid generic marketplace filler.

Match the visual language: Inter for the product UI, Newsreader for the desktop pitch headline, accent `#E54D2C`. Airbnb owns the feed card (photo, title, from-price, Instant). Uber Eats owns the category row. Booksy owns the service picker. Outset is the activity: scene art, jet ski / skydive labels on the photo, orange Instant, fun-local copy. Do not invent prices. Do not tell guests an operator is unclaimed.

## How to run

`npm install` then `npm run dev` for the guest app. `cd backend && npm install && npm run ingest && npm run dev` for the supply API.
