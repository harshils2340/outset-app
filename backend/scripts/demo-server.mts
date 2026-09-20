import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { networkInterfaces } from "node:os";

/**
 * The concierge's API, on its own, for showing to people.
 *
 * The real API refuses to boot without Postgres, Stripe and a mail key, because it takes bookings and money.
 * The concierge takes neither: it reads the catalog out of SQLite and asks shops' booking systems what is free.
 * Running it alone means the demo has three moving parts instead of thirty, boots in a second, and cannot be
 * broken by a credential that expired overnight.
 *
 * The screen itself is the site's own agent overlay, not a page this process renders: `/go` on `concierge.ts`
 * redirects to `SITE_URL`, the same variable every mailed link in the backend already points at the deployed
 * site with. A hand-rolled second copy of that screen lived here once and drifted from the real one on every
 * axis that matters — this does not repeat that. So a phone at the venue needs somewhere on the LAN to land:
 * with nothing configured, `SITE_URL` defaults to this machine's own address on port 5173, which is where
 * `npm run dev` already serves the site. Run that alongside this, or set `SITE_URL` to wherever the site is
 * actually being served from (a LAN build, a tunnel) if it is not.
 *
 *   npx tsx scripts/demo-server.mts            http://localhost:8788/go
 *   PORT=9000 npx tsx scripts/demo-server.mts
 *   SITE_URL=http://localhost:5199/ npx tsx scripts/demo-server.mts   the built site instead of the dev server
 *
 * It prints the address on the local network too, because the point of the demo is that somebody opens it on
 * their own phone.
 */

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) if (ni.family === "IPv4" && !ni.internal) return ni.address;
  }
  return null;
}

// Set before `concierge.ts` is imported: it reads `SITE_URL` once, at module load, to build the `/go` redirect.
if (!process.env.SITE_URL) {
  const lan = lanAddress();
  process.env.SITE_URL = `http://${lan || "localhost"}:5173/`;
}

/**
 * Cards on this host are Stripe TEST only. The laptop's `.env` often has live keys for the real API; using
 * those here would put a judge's test card on a live charge. A live secret is dropped. A test secret is
 * taken from `STRIPE_TEST_SECRET_KEY` (or `STRIPE_SECRET_KEY` if it already starts with sk_test_).
 */
const liveSecret = (process.env.STRIPE_SECRET_KEY || "").trim();
if (liveSecret.startsWith("sk_live")) delete process.env.STRIPE_SECRET_KEY;
const testSecret = (process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY || "").trim();
if (testSecret.startsWith("sk_test_")) process.env.STRIPE_SECRET_KEY = testSecret;
else delete process.env.STRIPE_SECRET_KEY;
const testPk = [(process.env.STRIPE_TEST_PUBLISHABLE_KEY || "").trim(), (process.env.STRIPE_PUBLISHABLE_KEY || "").trim()].find((k) => k.startsWith("pk_test_")) || "";
const testStripe = (process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test_");
const SITE = (process.env.SITE_URL || "http://localhost:5173/").replace(/\/?$/, "/");

const { concierge } = await import("../src/api/concierge.ts");
const { nearby } = await import("../src/api/nearby.ts");

const app = new Hono();
app.use("*", async (c, next) => {
  // Anyone on the venue wifi, which is the whole idea.
  c.header("access-control-allow-origin", "*");
  c.header("access-control-allow-headers", "content-type, x-wallet");
  c.header("access-control-allow-methods", "GET, POST, OPTIONS");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});
app.get("/health", (c) => c.json({ ok: true }));
app.get("/config", (c) => c.json({ payments: testStripe, mail: false, stripePublishableKey: testStripe && testPk ? testPk : null }));
app.route("/", concierge);
app.route("/", nearby);
/**
 * Hold a trip on this process so Ask can finish without Postgres. With Stripe TEST keys it also opens Checkout
 * so the CAP demo can show a card hold on Outset. It never talks to FareHarbor, Peek or the shop's own pay page.
 */
const holds = new Map<string, { listing: string; session: string }>();
const CODE = /^[A-Z0-9-]{4,16}$/;

app.get("/bookings/paid/:listing/:code", async (c) => {
  const listing = String(c.req.param("listing") ?? "");
  const code = String(c.req.param("code") ?? "").toUpperCase();
  const hold = holds.get(code);
  if (!hold || hold.listing !== listing) return c.json({ error: "not found" }, 404);
  if (!testStripe) return c.json({ status: "new", paid: false });
  const { sessionStatus } = await import("../src/lib/stripe.ts");
  const st = await sessionStatus(hold.session).catch(() => null);
  return c.json({ status: st?.paid ? "new" : "pending", paid: !!st?.paid });
});

app.post("/bookings", async (c) => {
  const b = (await c.req.json().catch(() => null)) as {
    listing?: string; date?: string; slot?: string; qty?: number; code?: string; total?: number | null;
    service?: string; guest?: { name?: string; phone?: string; email?: string };
  } | null;
  const listing = (b?.listing || "").trim();
  const date = (b?.date || "").trim();
  const slot = (b?.slot || "").trim();
  const qty = Number(b?.qty);
  const name = (b?.guest?.name || "").trim();
  const phone = (b?.guest?.phone || "").replace(/\D/g, "");
  if (listing.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot)) {
    return c.json({ error: "bad booking" }, 400);
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > 60 || name.length < 2 || phone.length < 7) {
    return c.json({ error: "name and mobile are required" }, 400);
  }
  const total = Number(b?.total);
  const code = ((b?.code || "").trim().toUpperCase() || "DEMO").slice(0, 16);
  if (testStripe && Number.isFinite(total) && total >= 1 && CODE.test(code)) {
    try {
      const { createCheckout } = await import("../src/lib/stripe.ts");
      const co = await createCheckout({
        code,
        listing,
        title: (b?.service || listing).slice(0, 120),
        description: `${date} ${slot} · ${qty} guest${qty === 1 ? "" : "s"} (Outset test)`,
        amount: total,
        currency: "cad",
        email: (b?.guest?.email || "").trim() || undefined,
        successUrl: `${SITE}#paid=${code}&o=${encodeURIComponent(listing)}`,
        cancelUrl: `${SITE}#ask`,
      });
      if (co.url && co.url.startsWith("https://checkout.stripe.com/")) {
        holds.set(code, { listing, session: co.id });
        return c.json({ ok: true, status: "pending", checkoutUrl: co.url });
      }
    } catch (e) {
      console.warn("[demo] Stripe test checkout failed: " + (e as Error).message);
    }
  }
  return c.json({ ok: true, status: "new" });
});
app.get("/", (c) => c.redirect("/go"));

const port = Number(process.env.PORT || 8788);

/**
 * Warm the booking feeds before anybody asks.
 *
 * The first read of a company is slow — 7.4 seconds against Toronto's helicopter operators, measured, where
 * every read after it takes three — and the per-shop deadline is five. So on a cold process the first guest
 * of the morning sees no live times and the second sees two, for the same question. That is a bad thing to
 * discover in front of an audience, and it is a real cold-start problem rather than a demo trick: the fix is
 * the same either way.
 *
 * It runs in the background, one query at a time so it cannot compete with a real guest for the CPU, and its
 * failures are ignored: a cold cache is the state we were already in.
 */
async function warm(): Promise<void> {
  const { plan } = await import("../src/concierge/plan.ts");
  /**
   * The places somebody at the venue would actually type, and the shops behind them. Hack the North is in
   * Waterloo, so Waterloo and Kitchener come first; Toronto is the next thing anybody asks about. Each of
   * these pulls a different set of booking companies into the cache, which is the point — warming one query
   * warms every shop it touches.
   */
  const queries = [
    "escape room in waterloo ontario tonight for 4",
    "axe throwing near waterloo",
    "something to do in waterloo tonight",
    "escape room in kitchener tonight",
    "karting near kitchener",
    "helicopter tour in toronto at 4:30pm",
    "parasailing in toronto for 2",
    "boat tour near toronto",
    "escape room in toronto for 6",
    "something fun in toronto tonight",
  ];
  const t0 = Date.now();
  for (const q of queries) {
    await plan(q, { ask: 4, deadlineMs: 25000 }).catch(() => {});
  }
  console.log(`    feeds warmed in ${Math.round((Date.now() - t0) / 1000)}s \u2014 the first guest gets the fast path\n`);
}

serve({ fetch: app.fetch, port }, () => {
  const lan = lanAddress();
  console.log(`\n  Outset concierge\n`);
  console.log(`    this machine   http://localhost:${port}/go`);
  if (lan) console.log(`    their phone    http://${lan}:${port}/go   <- the QR code points here\n`);
  else console.log(`    (no network address found; phones will not reach this)\n`);
  console.log(`    /go sends them to   ${process.env.SITE_URL}   \u2014 make sure the site is actually running there\n`);
  console.log(testStripe
    ? "    Stripe TEST checkout is on. Book opens checkout.stripe.com; use 4242 4242 4242 4242.\n"
    : "    Stripe TEST is off. Set STRIPE_TEST_SECRET_KEY=sk_test_... to show the card step. Live keys are ignored.\n");
  console.log("    warming the booking feeds\u2026 (the first read of a shop is slow; the rest are not)");
  void warm();
});
