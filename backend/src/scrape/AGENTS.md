# backend/src/scrape

Read `/AGENTS.md` and `/backend/AGENTS.md` first.

Public HTML only. Check robots.txt. The crawler sends a plain Chrome user agent: a bot token in the UA got most sites blocked outright, and Harshil chose coverage. Cap extra pages per domain at 3 for the light scrape; the deep crawl in enrich/ goes further. If JSON-LD has no price, leave `price_cents` null and let completeness/gaps say so. Never write a slot table from a scrape. Detect FareHarbor, Peek, Checkfront, Rezdy, Xola, Booksy as `calendar_vendor` only.
