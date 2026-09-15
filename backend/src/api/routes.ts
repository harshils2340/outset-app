import { Hono } from "hono";
import { db, migrate } from "../db/client.ts";

/**
 * The crawler, the sync, the outreach drafts and the completeness pass are reachable only through the
 * admin-gated routes below, but importing them here meant the API transpiled and evaluated all of them before
 * it could answer a health check. On an instance that spins down when idle, a guest paid that on arrival.
 * Loaded when one of those routes is actually called.
 */
const lazy = {
  ingest: () => import("../ingest/load.ts"),
  drafts: () => import("../outreach/drafts.ts"),
  scrape: () => import("../scrape/run.ts"),
  scores: () => import("../lib/completeness.ts"),
  sync: () => import("../sync/contacts.ts"),
};
import { CATEGORIES, METROS } from "../taxonomy/catalog.ts";
import { allContacts, contactFor } from "../sync/contacts.ts";

migrate();

import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { profiles } from "./profiles.ts";
import { auth } from "./auth.ts";
import { claims } from "./claims.ts";
import { unsub } from "./unsub.ts";
import { webhooks } from "./webhooks.ts";
import { bookings } from "./bookings.ts";
import { uploads } from "./uploads.ts";
import { payouts } from "./payouts.ts";
import { availability } from "./availability.ts";
import { openSlotsRoute } from "./openSlots.ts";
import { stripeEnabled } from "../lib/stripe.ts";

export const app = new Hono();

// Browser calls come only from the site (and a dev server). Everything else is same-origin tooling.
const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://onoutset.com,https://www.onoutset.com,https://harshils2340.github.io,http://localhost:5173,http://localhost:5199").split(",").map((s) => s.trim());
// An unauthenticated caller could stream an arbitrarily large body at the API, and the Stripe webhook has to
// read the whole thing before it can check the signature. 2 MB is far above any real booking or profile write;
// photo uploads have their own, larger, limit checked inside that route.
app.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: "too large" }, 413) }));
app.use("*", cors({ origin: (o) => (ORIGINS.includes(o) ? o : ""), allowHeaders: ["content-type", "x-claim-token", "x-session"], allowMethods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"], maxAge: 600 }));
app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  // Everything the API answers is per-operator or per-booking, except an uploaded photo, whose name is a hash
  // of its own bytes and which the browser should keep.
  if (!c.req.path.startsWith("/uploads/") || c.req.method !== "GET") c.header("cache-control", "no-store");
  // A booking carries a name, a phone number and an email, so never let a browser try this over plain HTTP.
  c.header("strict-transport-security", "max-age=31536000");
});
app.get("/config", (c) => c.json({ payments: stripeEnabled(), mail: !!process.env.RESEND_API_KEY }));
app.route("/", auth);
app.route("/", profiles);
app.route("/", claims);
app.route("/", unsub);
app.route("/", webhooks);
app.route("/", bookings);
app.route("/", uploads);
app.route("/", payouts);
app.route("/", availability);
app.route("/", openSlotsRoute);

app.get("/health", (c) => c.json({ ok: true, service: "outset-backend", store: "postgres", commit: (process.env.RENDER_GIT_COMMIT || "").slice(0, 10) || undefined }));

// Everything below is internal tooling (raw operator rows, emails, outreach drafts with claim tokens).
// It answers only with the admin key; on a public host with no key set it is closed.
app.use("*", async (c, next) => {
  const key = process.env.ADMIN_KEY;
  // This used to read the Host header, which the caller controls: on any host that is not Render and has no
  // ADMIN_KEY, `curl -H 'Host: localhost'` opened the internal tooling, including outreach drafts that carry
  // live claim tokens. An explicit variable cannot be set by a request.
  const local = process.env.OUTSET_LOCAL_ADMIN === "1";
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

app.post("/contacts/sync", async (c) => {
  const { syncContactsToApp, syncCatalogToApp } = await lazy.sync();
  return c.json({ contacts: syncContactsToApp(), catalog: syncCatalogToApp() });
});

app.post("/targets", async (c) => {
  const body = await c.req.json<{ website: string; metroId: string; name?: string; categoryId?: string }>();
  const { addTarget } = await lazy.ingest();
  const id = addTarget(body);
  return c.json({ operatorId: id });
});

app.post("/ingest/tampa", async (c) => {
  const { ingestTampaUnclaimed } = await lazy.ingest();
  return c.json({ ingested: ingestTampaUnclaimed() });
});

app.post("/scrape", async (c) => {
  const limit = Number(c.req.query("limit") || 12);
  const [{ scrapePending }, { refreshAllScores }] = await Promise.all([lazy.scrape(), lazy.scores()]);
  const results = await scrapePending(Math.min(50, Math.max(1, limit)));
  refreshAllScores();
  return c.json({ scraped: results.length, results });
});

app.post("/scrape/one", async (c) => {
  const body = await c.req.json<{ operatorId: string; website: string; name?: string }>();
  const [{ scrapeOperator }, { refreshAllScores }] = await Promise.all([lazy.scrape(), lazy.scores()]);
  const result = await scrapeOperator({
    operatorId: body.operatorId,
    website: body.website,
    fallbackName: body.name || body.website,
  });
  refreshAllScores();
  return c.json(result);
});

app.post("/outreach/generate", async (c) => {
  const { generateOutreachDrafts } = await lazy.drafts();
  return c.json({ drafts: generateOutreachDrafts() });
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
