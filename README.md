# Outset

Instant-booking marketplace for local experiences. The guest app shows real US and Canada operators as Instant Book, with public facts from their own sites.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

```bash
npm run build
npm run preview
```

## What you get

- Explore with category chips and real operators (Instant Book)
- Facts from each company's own site
- Instant confirmation on this device
- Trips fills when you book

Desktop shows a product pitch beside a phone frame. Narrow screens run as a full-height mobile app.

## Status

Guest catalog is real operators shown as Instant Book. No invented shops. Payments, operator onboarding, and phone are not live yet.

## Backend (supply)

```bash
cd backend
npm install
npm run ingest
npm run scrape
npm run outreach
npm run dev
```

API: http://localhost:8787

Unclaimed operator facts are stored with sources. Instant book stays off until a business claims. Outreach writes drafts only.
