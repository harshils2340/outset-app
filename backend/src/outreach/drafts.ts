import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { refreshGaps } from "../lib/completeness.ts";

type Op = {
  id: string;
  domain: string;
  name: string;
  email: string | null;
  city: string | null;
  website: string | null;
  completeness: number;
  origin: string;
};

/** The guest app keys catalog operators by domain: "o-" + slug(domain). Deep links use that id, not the DB uuid. */
function catalogId(domain: string): string {
  return "o-" + domain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function draftCopy(op: Op, gaps: string[], offerings: string[]): { subject: string; body: string } {
  const SITE = "https://harshils2340.github.io/outset-app/";
  const id = catalogId(op.domain);
  const city = op.city || "your area";
  const missing = gaps.filter((g) => !g.includes("Live calendar")).slice(0, 3);
  const menu = offerings.length ? offerings.slice(0, 5).map((o) => "  " + o).join("\n") : "  (we could not read a menu from your site, so guests see Request to book)";
  const subject = "Your " + op.name + " listing is already built. One click to make it yours.";
  const body = [
    "Hi " + op.name + ",",
    "",
    "We built your Outset listing from your own website: prices, photos, hours and your weather policy, so guests in " + city + " can book you without calling around.",
    "",
    "What guests already see:",
    menu,
    "",
    "See it: " + SITE + "#o=" + id,
    "Claim it and fix anything: " + SITE + "#claim=" + id,
    "",
    "What you get, free:",
    "  Online booking with a bookings feed you accept or decline from your phone.",
    "  An assistant that answers guest questions only from what your site says. Never from guesses.",
    "  No booking fee line on your guest's receipt, no ad auction against your name, no money held for a week. One flat rate only when a booking happens.",
    missing.length ? "\nThree things we could not read from your site: " + missing.join("; ") + ". Two minutes to fill in after you claim." : "",
    "",
    "If this is not your business, or you want it removed: " + SITE + "#remove=" + id,
    "",
    "Harshil",
    "Outset · Book the jump. Skip the call.",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { subject, body };
}

export function generateOutreachDrafts(): number {
  const ops = db.prepare("SELECT * FROM operators WHERE origin != 'demo' AND claim_status = 'unclaimed'").all() as Op[];
  let n = 0;
  db.prepare("DELETE FROM outreach_drafts WHERE status = 'draft'").run();
  for (const op of ops) {
    const gaps = db.prepare("SELECT note FROM gaps WHERE operator_id = ?").all(op.id) as { note: string }[];
    if (!gaps.length) refreshGaps(op.id);
    const gapNotes = (db.prepare("SELECT note FROM gaps WHERE operator_id = ?").all(op.id) as { note: string }[]).map(
      (g) => g.note,
    );
    const offerings = db
      .prepare("SELECT name, price_cents FROM offerings WHERE operator_id = ?")
      .all(op.id) as { name: string; price_cents: number | null }[];
    const lines = offerings.map((o) => o.name + (o.price_cents != null ? " · $" + (o.price_cents / 100).toFixed(0) : " · price unpublished"));
    const { subject, body } = draftCopy(op, gapNotes, lines);
    db.prepare(
      "INSERT INTO outreach_drafts (id, operator_id, to_email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?)",
    ).run(randomUUID(), op.id, op.email, subject, body, nowIso());
    n += 1;
  }
  return n;
}
