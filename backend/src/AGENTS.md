# backend/src

Read `/AGENTS.md` and `/backend/AGENTS.md` first.

`index.ts` is the CLI and server entry. Commands: ingest, scrape, outreach, status, serve. Keep side effects in those verbs. Do not scrape on every API boot beyond taxonomy + Tampa seed (seed is local, not a network crawl).
