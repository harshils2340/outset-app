# backend/src/api

Read `/AGENTS.md` and `/backend/AGENTS.md` first.

HTTP is read-mostly. Guest cards come from `GET /operators/:id/card`. That payload is the Uber Eats merchant chip plus Airbnb request-to-book plus Booksy service list. Never add an `openSlots` field here.
