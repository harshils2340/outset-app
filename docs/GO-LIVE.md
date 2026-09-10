# Go live: the five keys

Everything below is built, tested end to end locally, and switches on the moment the key is set. No code changes needed.

## 1. API host (Render, free tier)
1. render.com → New → Blueprint → pick `harshils2340/outset-app`. It creates `outset-api` from `render.yaml`.
2. Set these environment variables on the service:
   - `CLAIM_SECRET`: the contents of `backend/data/claim-secret.txt` on the Mac (same secret the emailed claim links were signed with; if you rotate it, regenerate drafts).
   - `GITHUB_TOKEN`: a fine-grained GitHub token, repository `outset-app`, permission Contents: read and write. Profiles and bookings are stored as JSON in the repo and the site rebuilds on each write.
   - `RESEND_API_KEY`: from resend.com (free tier covers 3,000 emails a month). Until the sending domain is verified, keep `MAIL_FROM` as `Outset <onboarding@resend.dev>`; after verifying outset.app (or any domain you own) set `MAIL_FROM` to `Outset <bookings@yourdomain>`.
3. Copy the service URL (for example `https://outset-api.onrender.com`).

## 2. Point the site at the API
GitHub repo → Settings → Secrets and variables → Actions → Variables → new variable `VITE_API_URL` = the Render URL. Push anything (or rerun the "Deploy site" workflow). The site then signs in, saves and books through the API.

## 3. Outreach
On the Mac, with `RESEND_API_KEY` in `backend/.env`:
```
cd backend
npx tsx src/index.ts outreach-send --to=harshils2340@gmail.com   # one sample to yourself
npx tsx src/index.ts outreach-send --dry --limit=50               # preview
npx tsx src/index.ts outreach-send --limit=200                    # send, marks rows sent, never twice to one address
```
Each email carries a signed link that opens the operator's dashboard with no code. 6,263 drafts have an email address today.

## What is verified
- Claim link → dashboard, edits saved to the API, same link resumes on another device (tested).
- Guest books → booking stored, operator email, guest email, row in dashboard under Upcoming or New, accept/decline emails the guest (tested with mail dry run).
- Returning operator → "Email me a sign-in code" → 6-digit code → dashboard; wrong code rejected; session survives reload (tested).
- Security: HMAC-signed sessions, timing-safe token checks, rate limits per IP and route, CORS limited to the site origin, input validation on every route, no secrets in the repo.
