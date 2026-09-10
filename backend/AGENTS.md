# backend

Read `/AGENTS.md` first, then this file.

This is the supply engine. The Vite app shows unclaimed operators across US and Canada metros. Do not mix invented listings into outreach.

## What this service does

1. Store operator profiles with source citations. Every fact has a URL or `seed:tampa-unclaimed`.
2. Scrape public operator websites across a US + Canada metro grid. Honor robots.txt. Never log in. Never invent availability, hours, prices, or eligibility.
3. Score profile completeness the way Uber Eats scores a merchant photo/menu gap, then draft a claim email: we already set you up, finish the missing fields.
4. Keep unclaimed profiles request-only. Instant book is off until the operator claims.

## Product references

- Uber Eats: category chips with `iconKey`, merchant card, completeness gaps, "is this business open/claimable."
- Airbnb: host vs listing, house rules, Instant Book vs request-to-book, location grain.
- Booksy: service menu with duration and nullable price, appointment-style operators (axe, escape, kart, spa-like indoor).

## Hard rules

- Demo rows (`origin = demo`) never get outreach.
- Real rows (`origin = public_site` or `seed`) stay unclaimed until claimed.
- If a scrape cannot find a field, write a gap. Do not guess.
- Do not copy operator photos or marketing copy into the guest catalog. Store facts and our `iconKey` illustration.
- Outreach commands write drafts. They do not send mail.

## Commands

```
cd backend
npm install
npm run ingest
npm run discover          # all US states and CA provinces from OpenStreetMap, cached per area
npm run discover CA FL    # only some areas, by region code
npm run enrich 50 3      # crawl 50 operator sites, 3 at a time, extract facts with Claude (needs ANTHROPIC_API_KEY in backend/.env)
npm run scrape
npm run outreach
npm run sync
npm run dev
```

Headless Chrome from enrich/photos is killed when the command exits or you hit Ctrl+C. If Activity Monitor still shows `chromium_headless_shell`, run `npm run chrome:reap`. Do not leave `submit-batches.sh` running overnight on a laptop.

`npm run discover` pulls named businesses tagged as escape rooms, axe throwing, karting, paintball, skydiving, horse riding, ballooning, parasailing, boat and kayak rental, fishing charters, and boat tours. Rows get `origin = osm`, an `osm_ref`, lat/lon, and the nearest metro within 160 km (else no metro). Domain is the website host, or `osm-<type>-<id>` when the site is missing or is a social page. OSM data is ODbL.

`npm run enrich` is the deep pass. `src/enrich/crawl.ts` fetches up to 8 of the operator's own pages (about, pricing, tours, FAQ, contact, policies), collects public social handles from their links (Instagram, Facebook, TikTok, YouTube, Yelp, TripAdvisor, Google) and detects the booking vendor. `src/enrich/extract.ts` sends the page text to Claude with a fixed nullable schema and a no-guessing prompt. Results land as offerings and facts with `confidence = 'ai'` and a source URL per fact, and are replaced on re-run. Seed rows are never touched. Social networks themselves are not scraped: they are login-walled and their terms forbid it.

`npm run sync` also writes `../public/catalog.json` (every real operator in the app's Unclaimed shape plus contacts) and regenerates `../src/data/contacts.ts` from the operators table. Contact fields (phone, email, street, postal, hours) come only from the operator's own site. Phones are normalized to E.164. `GET /contacts` and `GET /contacts/:domain` serve the same payload live.

API listens on `http://localhost:8787`.
