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
  const missing = gaps.filter((g) => !g.includes("Live calendar")).slice(0, 4);
  const city = op.city || "your city";
  const site = op.website || "your site";
  const menu = offerings.length
    ? offerings.map((o) => "- " + o).join("\n")
    : "- (no public menu yet. We left that blank on purpose.)";
  const subject = op.name + ": your Outset profile is set up. Finish the last " + Math.max(1, missing.length) + " fields.";
  const body = [
    "Hi " + op.name + ",",
    "",
    "We created an unclaimed Outset profile for you in " + city + " using only what is already public on " + site + ".",
    "Guests can request a time. They cannot instant-book you. We did not invent availability.",
    "",
    "What is already on the profile:",
    menu,
    "",
    "What still needs you (this is the Airbnb / Booksy completeness list):",
    missing.map((m) => "- " + m).join("\n") || "- Confirm the facts and turn on Instant Book when you are ready.",
    "",
    "Complete the profile: https://outset.local/#claim=" + catalogId(op.domain),
    "If this is not your business, remove it in one click: https://outset.local/#remove=" + catalogId(op.domain),
    "",
    "Profile completeness: " + op.completeness + "/100. Uber Eats-style: we will not show you as Instant Book until the gaps that can burn a guest are gone.",
    "",
    "Outset",
    "Tampa first. US and Canada next.",
  ].join("\n");
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
