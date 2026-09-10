# Go live: the five keys

Everything below is built, tested end to end locally, and switches on the moment the key is set. No code changes needed.

## 1. API host (Render, free tier)
1. render.com → New → Blueprint → pick `harshils2340/outset-app`. It creates `outset-api` from `render.yaml`.
2. Set these environment variables on the service:
   - `CLAIM_SECRET`: the contents of `backend/data/claim-secret.txt` on the Mac (same secret the emailed claim links were signed with; if you rotate it, regenerate drafts).
   - `GITHUB_TOKEN`: a fine-grained GitHub token, repository `outset-app`, permission Contents: read and write. Profiles and bookings are stored as JSON in the repo and the site rebuilds on each write.
   - `RESEND_API_KEY`: from resend.com (free tier covers 3,000 emails a month). Until `onoutset.com` is verified in Resend, keep `MAIL_FROM` as `Outset <onboarding@resend.dev>`; after verifying, set `MAIL_FROM` to `Outset <hello@onoutset.com>`.
3. Copy the service URL (for example `https://outset-api.onrender.com`).

## 1b. Card payments (Stripe)
1. dashboard.stripe.com → Developers → API keys → copy the Secret key (`sk_test_...` to demo, `sk_live_...` for real money). Set it on the Render service as `STRIPE_SECRET_KEY`.
2. Developers → Webhooks → Add endpoint → URL `https://<your render url>/stripe/webhook`, events `checkout.session.completed` and `checkout.session.expired`. Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
3. That is all. From then on "Book" becomes "Book and pay": the guest lands on Stripe's hosted page, the card is held, the operator gets the request, the money is captured when they accept and released when they decline. Instant-book listings capture at once. With no key, bookings fall back to pay on site.
4. Payouts to operators: the platform account receives the money today; pay operators from the Stripe dashboard until Stripe Connect is switched on (next step once the first operators are live).

## 1c. Admin key
Set `ADMIN_KEY` on Render to any long random string. The internal routes (raw operator rows, outreach drafts) then only answer to requests carrying `x-admin-key`; without it they are closed on the public host.

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
