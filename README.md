# Outset

Instant-booking marketplace for local experiences across the US and Canada. Air, water, racing, indoor, and outdoor: jet skis, skydives, charters, escape rooms, karting, paintball, and the rest of the catalog. Guests pick a slot and pay. It is not a lead-gen directory.

**Live guest app:** [harshils2340.github.io/outset-app](https://harshils2340.github.io/outset-app/)

Repo: [github.com/harshils2340/outset-app](https://github.com/harshils2340/outset-app)

## Status

The guest catalog is real operators across the **United States and Canada** (47 metros). Tampa Bay is the densest hand-verified batch. Supply is discovered from OpenStreetMap and public sites, then merged into `public/catalog.json` at startup. The app currently holds **12,000+** named operators. Facts come from each company's own site. Missing prices, hours, age, or waiver rules stay blank. We do not invent shops or live seats.

Guest UI presents Instant Book. Real calendar Instant Book stays off until an operator claims. Payments, operator onboarding, and voice phone are not live yet. Bookings in the demo persist on this device.

## What you get

- Explore: Uber Eats-style category rails (Air, Water, Race, Indoor, Outdoor), metro picker, search
- Listing: public photos when we have them, from-price, hours, phone, Get directions, who can go, waiver gaps
- 24/7 company assistant: answers only from that operator's published facts. Hands off if it does not know
- Instant confirmation on this device. Trips fills when you book
- Desktop: product pitch beside a phone frame. Narrow screens run full viewport

## Run the guest app

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

```bash
npm run build
npm run preview
```

## Backend (supply)

```bash
cd backend
npm install
npm run ingest
npm run discover          # OSM, all US states and CA provinces, cached
npm run structure -- 800 8
npm run scrape
npm run sync              # writes public/catalog.json and src/data/contacts.ts
npm run dev               # API at http://localhost:8787
```

Also: `npm run backend:search`, `npm run backend:enrich`, `npm run backend:photos` from the repo root (need keys in `backend/.env`). Outreach writes drafts only. It does not send mail.
