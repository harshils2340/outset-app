import { Hono } from "hono";
import { db, migrate } from "../db/client.ts";
import { ingestTampaUnclaimed, addTarget } from "../ingest/load.ts";
import { generateOutreachDrafts } from "../outreach/drafts.ts";
import { scrapeOperator, scrapePending } from "../scrape/run.ts";
import { refreshAllScores } from "../lib/completeness.ts";
import { CATEGORIES, METROS } from "../taxonomy/catalog.ts";
import { allContacts, contactFor, syncCatalogToApp, syncContactsToApp } from "../sync/contacts.ts";

migrate();

import { cors } from "hono/cors";
import { profiles } from "./profiles.ts";
import { auth } from "./auth.ts";
import { claims } from "./claims.ts";
import { unsub } from "./unsub.ts";
import { bookings } from "./bookings.ts";
import { uploads } from "./uploads.ts";
import { payouts } from "./payouts.ts";
import { stripeEnabled } from "../lib/stripe.ts";

export const app = new Hono();

// Browser calls come only from the site (and a dev server). Everything else is same-origin tooling.
const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://onoutset.com,https://www.onoutset.com,https://harshils2340.github.io,http://localhost:5173,http://localhost:5199").split(",").map((s) => s.trim());
app.use("*", cors({ origin: (o) => (ORIGINS.includes(o) ? o : ""), allowHeaders: ["content-type", "x-claim-token", "x-session"], allowMethods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"], maxAge: 600 }));
app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("cache-control", "no-store");
});
app.get("/config", (c) => c.json({ payments: stripeEnabled(), mail: !!process.env.RESEND_API_KEY }));
app.route("/", auth);
app.route("/", profiles);
app.route("/", claims);
app.route("/", unsub);
app.route("/", bookings);
app.route("/", uploads);
app.route("/", payouts);

app.get("/health", (c) => c.json({ ok: true, service: "outset-backend" }));

// Everything below is internal tooling (raw operator rows, emails, outreach drafts with claim tokens).
// It answers only with the admin key; on a public host with no key set it is closed.
app.use("*", async (c, next) => {
  const key = process.env.ADMIN_KEY;
  const local = !process.env.RENDER && !process.env.PORT_PUBLIC && (c.req.header("host") || "").startsWith("localhost");
  if (local && !key) return next();
  if (key && c.req.header("x-admin-key") === key) return next();
  return c.json({ error: "not found" }, 404);
});

app.get("/taxonomy/categories", (c) => c.json({ categories: CATEGORIES }));
app.get("/taxonomy/metros", (c) => c.json({ metros: METROS, cells: METROS.length * CATEGORIES.length }));

app.get("/operators", (c) => {
  const metro = c.req.query("metro");
  const category = c.req.query("category");
  let sql = "SELECT * FROM operators WHERE 1=1";
  const args: string[] = [];
  if (metro) {
    sql += " AND metro_id = ?";
    args.push(metro);
  }
  if (category) {
    sql += " AND category_id = ?";
    args.push(category);
  }
  sql += " ORDER BY completeness DESC, name ASC";
  const rows = db.prepare(sql).all(...args);
  return c.json({ operators: rows });
});

app.get("/operators/:id", (c) => {
  const id = c.req.param("id");
  const op = db.prepare("SELECT * FROM operators WHERE id = ?").get(id);
  if (!op) return c.json({ error: "not found" }, 404);
  const offerings = db.prepare("SELECT * FROM offerings WHERE operator_id = ?").all(id);
  const facts = db.prepare("SELECT * FROM facts WHERE operator_id = ?").all(id);
  const gaps = db.prepare("SELECT * FROM gaps WHERE operator_id = ?").all(id);
  const sources = db.prepare("SELECT * FROM sources WHERE operator_id = ?").all(id);
  return c.json({ operator: op, offerings, facts, gaps, sources });
});

app.get("/operators/:id/card", (c) => {
  const id = c.req.param("id");
  const op = db.prepare("SELECT * FROM operators WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!op) return c.json({ error: "not found" }, 404);
  const offerings = db.prepare("SELECT name, detail, duration, price_cents, confidence FROM offerings WHERE operator_id = ?").all(id);
  const gaps = db.prepare("SELECT field, note FROM gaps WHERE operator_id = ?").all(id);
  const cat = db.prepare("SELECT * FROM categories WHERE id = ?").get(op.category_id as string);
  return c.json({
    card: {
      id: op.id,
      name: op.name,
      iconKey: op.icon_key,
      category: cat,
      location: { city: op.city, region: op.region, country: op.country, metroId: op.metro_id },
      bookingMode: op.booking_mode,
      claimStatus: op.claim_status,
      completeness: op.completeness,
      calendarVendor: op.calendar_vendor,
      cta: op.booking_mode === "instant" ? "Book" : "Request info",
      services: offerings,
      gaps,
    },
  });
});

/** Contact facts for every real operator, keyed by domain. Same payload the app embeds at build time. */
app.get("/contacts", (c) => c.json({ contacts: allContacts() }));

app.get("/contacts/:domain", (c) => {
  const contact = contactFor(c.req.param("domain"));
  if (!contact) return c.json({ error: "not found" }, 404);
  return c.json({ contact });
});

app.post("/contacts/sync", (c) => c.json({ contacts: syncContactsToApp(), catalog: syncCatalogToApp() }));

app.post("/targets", async (c) => {
  const body = await c.req.json<{ website: string; metroId: string; name?: string; categoryId?: string }>();
  const id = addTarget(body);
  return c.json({ operatorId: id });
});

app.post("/ingest/tampa", (c) => {
  const n = ingestTampaUnclaimed();
  return c.json({ ingested: n });
});

app.post("/scrape", async (c) => {
  const limit = Number(c.req.query("limit") || 12);
  const results = await scrapePending(Math.min(50, Math.max(1, limit)));
  refreshAllScores();
  return c.json({ scraped: results.length, results });
});

app.post("/scrape/one", async (c) => {
  const body = await c.req.json<{ operatorId: string; website: string; name?: string }>();
  const result = await scrapeOperator({
    operatorId: body.operatorId,
    website: body.website,
    fallbackName: body.name || body.website,
  });
  refreshAllScores();
  return c.json(result);
});

app.post("/outreach/generate", (c) => {
  const n = generateOutreachDrafts();
  return c.json({ drafts: n });
});

app.get("/outreach/drafts", (c) => {
  const rows = db.prepare(
    `SELECT d.*, o.name, o.domain, o.completeness
     FROM outreach_drafts d JOIN operators o ON o.id = d.operator_id
     ORDER BY d.created_at DESC`,
  ).all();
  return c.json({ drafts: rows });
});

app.get("/coverage", (c) => {
  const filled = db.prepare("SELECT metro_id, category_id, COUNT(*) as n FROM operators GROUP BY metro_id, category_id").all();
  return c.json({
    metros: METROS.length,
    categories: CATEGORIES.length,
    cells: METROS.length * CATEGORIES.length,
    filledCells: filled.length,
    operators: (db.prepare("SELECT COUNT(*) as n FROM operators").get() as { n: number }).n,
  });
});
