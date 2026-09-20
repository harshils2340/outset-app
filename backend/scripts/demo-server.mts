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

serve({ fetch: app.fetch, port }, () => {
  const lan = lanAddress();
  console.log(`\n  Outset concierge\n`);
  console.log(`    this machine   http://localhost:${port}/go`);
  if (lan) console.log(`    their phone    http://${lan}:${port}/go   <- the QR code points here\n`);
  else console.log(`    (no network address found; phones will not reach this)\n`);
});
