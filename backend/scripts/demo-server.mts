import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { networkInterfaces } from "node:os";
import { concierge } from "../src/api/concierge.ts";

/**
 * The concierge on its own, for showing to people.
 *
 * The real API refuses to boot without Postgres, Stripe and a mail key, because it takes bookings and money.
 * The concierge takes neither: it reads the catalog out of SQLite and asks shops' booking systems what is free.
 * Running it alone means the demo has three moving parts instead of thirty, boots in a second, and cannot be
 * broken by a credential that expired overnight.
 *
 *   npx tsx scripts/demo-server.mts            http://localhost:8788/go
 *   PORT=9000 npx tsx scripts/demo-server.mts
 *
 * It prints the address on the local network too, because the point of the demo is that somebody opens it on
 * their own phone.
 */

const app = new Hono();
app.use("*", async (c, next) => {
  // Anyone on the venue wifi, which is the whole idea.
  c.header("access-control-allow-origin", "*");
  c.header("access-control-allow-headers", "content-type");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});
app.get("/health", (c) => c.json({ ok: true }));
app.route("/", concierge);
app.get("/", (c) => c.redirect("/go"));

const port = Number(process.env.PORT || 8788);

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) if (ni.family === "IPv4" && !ni.internal) return ni.address;
  }
  return null;
}

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
  console.log("    warming the booking feeds\u2026 (the first read of a shop is slow; the rest are not)");
  void warm();
});
