# backend/src/lib

Read `/AGENTS.md` and `/backend/AGENTS.md` first.

Completeness is the Uber Eats merchant score: missing photo/menu/hours become gaps. Gaps drive the claim email. Eligibility and availability are always gaps until the operator states them. Never fill those from a model guess.

`repo.ts` is the only door to Postgres for profiles, bookings, payouts and the mail list. Read a record, change it under a row lock, list a listing's bookings. Keep the JSON shapes the API types already use; add real columns only for lookups. `store.ts` only reads catalog files. Nothing in the API writes to a repository.
