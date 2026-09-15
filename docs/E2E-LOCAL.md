# The local end-to-end test

One command rehearses the whole operator and money path — claiming, the dashboard, a guest booking, accept and
decline, and payouts — on this machine, against a fake business, with nothing reaching customers.

```
cd backend && npx tsx scripts/e2e-local.mts
```

It takes about four minutes and prints a pass or fail line per step. Add `--keep` to leave the API and the site
running afterwards so you can click through by hand; it prints the links to open.

## Why it exists

The live system cannot be used for a rehearsal:

- the production API runs Stripe in **live** mode, so a card test charges a real card;
- bookings, guest phone numbers and owner emails are written to the **public** site repository until `DATA_REPO`
  points at a private one;
- notification email goes to **real inboxes** through Resend.

So the test builds a throwaway copy of the whole system and runs the real code against it.

## What you need

Nothing, for the normal run. Node and the repo are enough.

Optionally, a **Stripe test secret key** if you want real Checkout with a test card. In the Stripe Dashboard,
switch **Test mode** on (top right), open **Developers → API keys**, copy the secret key (it starts with
`sk_test_`) and run:

```
cd backend && STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/e2e-local.mts
```

The run refuses to start if that key, or `STRIPE_SECRET_KEY` in your shell, starts with `sk_live`, and it says
why. `backend/.env` holds the live Stripe key and the Resend key; the test blanks both for every process it
starts, so neither can leak into the run.

## What it does, step by step

1. **Safety.** Refuses to start on a live Stripe key. Every process it starts gets empty `GITHUB_TOKEN`,
   `DATA_REPO`, `RESEND_API_KEY` and SMTP settings, and the API is asked to confirm mail is off before anything
   else runs.
2. **A throwaway database.** A temp SQLite file with the production schema, `OUTSET_DB_PATH` pointed at it, and
   `scripts/test-listing.mts` run against it to create the fake business ("Shah and Shah Services", origin
   `test`, unlisted). `backend/data/outset.db` is never written to. `--full-db` copies the real catalog instead
   (`VACUUM INTO`), which is faithful but makes the API take over twelve minutes to boot, because `serve` runs
   `ingestAll()` and that re-scores every operator in the catalog twice.
3. **The listing's own files**, built through the real `toCatalogItem`: the detail JSON in a temp `STORE_DIR`,
   and the slim browse record the home page reads.
4. **The site**, built by Vite with `VITE_API_URL=http://localhost:8787`, into a temp `dist` with the test
   listing injected into `dist/o/`, `dist/catalog.json` and `dist/catalog-lite.json`. Nothing is written to
   `public/` or to the repo's own `dist/`. (`public/` is skipped at build time: it is 331 MB and only the test
   listing is needed.)
5. **Both servers**: the real API on `http://localhost:8787` with the temp store, and the site on
   `http://localhost:5199`.
6. **The scenario**, in a headless browser (never a visible window), with a screenshot at every step:
   - **(a)** a guest opens the test listing by its link;
   - **(b)** the operator enters the dashboard through the test claim bypass (`OUTSET_TEST_CLAIM_EMAILS`);
   - **(c)** the operator edits the business name and the description, switches Published off and on, switches
     Accepting off and on, switches Instant Book on and off, adds a service with a price, and changes the
     opening hours — each one checked against what the API actually stored;
   - **(d)** the guest page shows the new name, story, service and price;
   - **(e)** the guest books the sunset sail as a request;
   - **(e2)** the booked time fills up (the rest of the service's capacity is booked through the API), and then
     it is gone from `GET /bookings/open/:listing`, gone from the guest page's picker, and a further guest at
     that time is refused with `409 slot_taken`;
   - **(f)** the founder alert and the guest's confirmation appear in the API log as `[mail:dry]` lines;
   - **(g)** the operator sees the request and accepts it, and the guest's confirmation email is printed;
   - **(h)** a second booking is declined and the guest is told;
   - **(h2)** Instant Book switched on: a booking confirms on its own, the guest gets "You're booked" and the
     operator "New booking";
   - **(h3)** the operator cancels a confirmed booking from the drawer and the guest gets "Cancelled";
   - **(i)** payouts: the status route, the pay schedule changed to every two weeks and back, a stranger refused,
     the dashboard's own payout tiles reading the operator's price less 5% rather than 5% off the guest total,
     the money path end to end through the Stripe recorder (`scripts/payout-e2e.mts`, 31 checks: split,
     capture on accept, release on decline, transfer on the pay day, refund and reversal), and
     `POST /admin/payouts/run` answering the admin key and nobody else;
   - **(j)** cleanup: both servers stopped, the temp store and database copy deleted (unless `--keep`).

Then `scripts/store-e2e.mts` runs the routes in process against the same scratch database and reads the rows
back. The browser covers the journey; this covers its edges: odd bodies (a body of `null` used to be a 500), a
booking code that is not one, a dashboard record whose fields are the wrong shape, a time with room for one more
guest but not two, and a service the shop's menu does not price.

With a Stripe test key it also books a card booking, pays on Stripe's hosted page with
`4242 4242 4242 4242`, posts a correctly signed `checkout.session.completed` to the local webhook (there is no
`stripe listen` here, so the session is read back with the test key and the event is signed with the test's own
webhook secret), accepts the booking so the card is captured, and runs the payout job.

After the scenario, every email the API produced is read back (**8**): each one must have an HTML version,
human dates ("Wednesday, September 16 at 9:00 AM"), money with a currency ("$19.00 USD"), and no `undefined`;
then each is rendered in the headless browser at inbox width so a person can look at them.

Screenshots, the emails (`mail/*.html` and `.txt`) and the API log are left in the temp directory, and the run
prints the paths. Set `E2E_COPY_TO=<dir>` to keep copies after the temp world is deleted.

## What it deliberately does not touch

- **Production data.** No GitHub token, so the store is a temp directory; nothing is committed to the site
  repository or to a data repository.
- **Real people.** No Resend key and no SMTP, so every email is printed to the API log instead of sent. The only
  address used is the founder's own, for the booking alert.
- **Real money.** With no key, payments are off and the payout path runs against a recorder that answers as
  Stripe would. With a test key, only Stripe **test** mode is used.
- **The real catalog.** `backend/data/outset.db`, `public/` and the repo's `dist/` are read at most, never
  written.
- **Stripe Connect onboarding.** A real operator connects their bank on Stripe's hosted pages; the test writes a
  stand-in account record into the temp store so the pay schedule and the ledger can be exercised.
- **Your browser.** Everything runs headless, so no window steals focus.

The one thing that leaves the machine on a normal run: the browser loads the test listing's photos from
Unsplash, because that is where the fake listing's images live.

## Gaps it found, now fixed

The first run of this harness found three production bugs, all fixed on 15 September 2026, and the harness now
fails if any comes back:

- **Accepting was dashboard-only.** The Accepting switch now reaches the guest page (`toCatalog` in
  `src/lib/operator.ts`), which shows "Not taking bookings right now" instead of the booking box, and the API
  refuses a booking for a paused shop with 409 (`backend/src/api/bookings.ts`).
- **An unpublished listing was still bookable by its own link.** The page still opens by its link (by design), but
  now says "This listing is hidden right now" with no booking box, and the API refuses the booking.
- **The API took over twelve minutes to answer after a restart** on the full catalog, because the seed ingest at
  boot rescored every operator row twice. It now rescores only the rows the ingest touched.

## Files

- `backend/scripts/e2e-local.mts` — the harness: safety checks, temp database, build, servers, payouts, summary.
- `backend/scripts/e2e-local-flow.mjs` — the browser scenario. It also drives itself (`node e2e-local-flow.mjs
  <outDir>`) when the screenshot driver is not around.
- `backend/scripts/test-listing.mts` — the fake business itself.
- `backend/scripts/payout-e2e.mts` — the money path against a Stripe recorder.
- `backend/scripts/connect-e2e.mts` — the Payouts button, against real Stripe in test mode.
- `backend/scripts/card-e2e.mts` — the guest's card, against real Stripe in test mode.
- `backend/scripts/store-e2e.mts` — the claim, profile, sign-in, slot and booking routes, driven in process.

## The database

The API keeps profiles and bookings in Postgres, so the rehearsal needs a scratch branch of the Neon project: `neon branches create --name scratch`, then `E2E_DATABASE_URL=$(neon connection-string scratch --pooled) npx tsx scripts/e2e-local.mts`. The harness wipes the test listing's rows on that branch before it starts and never touches production. In GitHub Actions the same value is the repository secret `E2E_DATABASE_URL`; without it the rehearsal skips itself.

## Against real Stripe, with a test key

Two scripts need only a Stripe **test** secret key: no database, no API, no browser. Both refuse to start on a
live key and clean up everything they create. Get the key from the Stripe dashboard in test mode (Developers,
then API keys, the standard secret key starting `sk_test_`), not a restricted `rk_test_` one.

```
cd backend
STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/connect-e2e.mts
STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/card-e2e.mts
```

`connect-e2e.mts` covers the one seam every other test skipped: `POST /payouts/:id/connect`, the "Set up payouts
with Stripe" button. Everything else writes a stand-in account record (`acct_e2e_local`) into the profile and
never calls Stripe, which is how the API shipped asking for the `transfers` capability alone. Stripe allows that
for a Canadian account and refuses it for a US one, so the button answered 502 for every US shop until
`card_payments` was requested alongside it. The script makes the same calls `src/api/payouts.ts` makes, so a
green run means the button works and the platform's Connect settings are right. When Stripe refuses, it prints
Stripe's own message, which is the answer to whether a restriction is a Connect setting or a country limit.

`card-e2e.mts` imports the functions in `src/lib/stripe.ts` and runs them against Stripe: the checkout session
carries the listing's amount, currency and booking code and is unpaid with no intent yet; a card authorizes and
waits; capture takes it and reports the charge; `settlementOf` reports the currency the money really landed in;
`releaseIntent` refunds a captured payment in full and cancels one never captured; a declined card never becomes
a booking; and a Canadian listing is held in Canadian dollars.

Neither can complete Stripe's hosted pages, which are a person typing into Checkout or the Express onboarding
form. `card-e2e.mts` authorizes with Stripe's own `pm_card_visa` test payment method instead, which is the
server-side equivalent. Driving the hosted Checkout page for real is what `e2e-local.mts` does when
`STRIPE_TEST_SECRET_KEY` is set, and that still needs the database.

One thing worth knowing from a green run: a USD charge on this Canadian platform settles in CAD at about 1.39,
which is why the payout run reads the settled currency and rate before it transfers the operator's share.
