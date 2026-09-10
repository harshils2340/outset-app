import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { refreshGaps } from "../lib/completeness.ts";
import { claimToken } from "../lib/claim.ts";

type Op = {
  id: string;
  domain: string;
  name: string;
  email: string | null;
  city: string | null;
  region: string | null;
  metro_id: string | null;
  website: string | null;
  completeness: number;
  origin: string;
  calendar_vendor: string | null;
};

/** The guest app keys catalog operators by domain: "o-" + slug(domain). Deep links use that id, not the DB uuid. */
function catalogId(domain: string): string {
  return "o-" + domain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

const VENDOR_NAME: Record<string, string> = { fareharbor: "FareHarbor", peek: "Peek", xola: "Xola", bookeo: "Bookeo", rezdy: "Rezdy", checkfront: "Checkfront", resova: "Resova", booksy: "Booksy", square: "Square", simplybook: "SimplyBook", rezgo: "Rezgo" };

/** Real numbers for the credibility line, read once per draft run. */
export function scale(): { listings: number; metros: number; local: Map<string, number> } {
  const listings = (db.prepare("SELECT COUNT(*) AS n FROM operators WHERE origin != 'demo' AND website IS NOT NULL").get() as { n: number }).n;
  const metros = (db.prepare("SELECT COUNT(DISTINCT metro_id) AS n FROM operators WHERE metro_id IS NOT NULL").get() as { n: number }).n;
  const local = new Map<string, number>();
  for (const r of db.prepare("SELECT metro_id, COUNT(*) AS n FROM operators WHERE metro_id IS NOT NULL AND origin != 'demo' GROUP BY metro_id").all() as { metro_id: string; n: number }[]) local.set(r.metro_id, r.n);
  return { listings, metros, local };
}

/**
 * The claim email. Short, specific, one listing link and one owner-only claim link.
 * The claim token lives only in this mail. Anyone with it can open the dashboard, so the copy says not to forward it.
 */
export function draftCopy(op: Op, sc: ReturnType<typeof scale>, offerings: string[], hasPhotos: boolean, hasRules: boolean): { subject: string; body: string } {
  void offerings;
  void hasPhotos;
  void hasRules;
  const SITE = "https://harshils2340.github.io/outset-app/";
  const id = catalogId(op.domain);
  const city = op.city || "your area";
  const vendor = op.calendar_vendor ? VENDOR_NAME[op.calendar_vendor] || null : null;
  const subject = "Your " + op.name + " booking page is live";
  const body = [
    "Hi,",
    "",
    "We built a booking page for " + op.name + " from your website. Guests in " + city + " can book you on it now:",
    SITE + "#o=" + id,
    "",
    "Claim it in one click, nothing to set up:",
    SITE + "#claim=" + id + "&k=" + claimToken(id),
    "",
    "Free to list. You pay a small flat fee only when a booking comes in." + (vendor ? " Keep " + vendor + ", bookings can land there too." : ""),
    "",
    "Harshil",
    "Outset, " + round(sc.listings) + " operators in " + sc.metros + " cities",
    "",
    "Not your business? Remove it: " + SITE + "#remove=" + id,
  ].join("\n");
  return { subject, body };
}

/**
 * An address scraped from a partner's page (a river walk listing a Legoland inbox) must not get the claim link.
 * Keep the operator's own domain, a personal mailbox, or nothing.
 */
function plausibleEmail(op: Op): string | null {
  const e = (op.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) return null;
  const host = e.split("@")[1];
  const own = op.domain.toLowerCase().replace(/^www\./, "");
  if (host === own || host.endsWith("." + own) || own.endsWith("." + host)) return e;
  if (/^(gmail|yahoo|hotmail|outlook|icloud|aol|me|live|msn|comcast|att|verizon|bellsouth|shaw|rogers|telus|sympatico|bell)\./.test(host)) return e;
  if (/^(info|hello|contact|book|bookings|reservations|sales|tours|office|admin|support)@/.test(e)) return null;
  return null;
}

export function generateOutreachDrafts(): number {
  const ops = db.prepare("SELECT * FROM operators WHERE origin != 'demo' AND claim_status = 'unclaimed'").all() as Op[];
  const sc = scale();
  let n = 0;
  db.exec("PRAGMA busy_timeout = 120000");
  db.prepare("DELETE FROM outreach_drafts WHERE status = 'draft'").run();
  const offQ = db.prepare("SELECT name, price_cents FROM offerings WHERE operator_id = ? ORDER BY price_cents IS NULL, price_cents LIMIT 6");
  const factQ = db.prepare("SELECT fact_key FROM facts WHERE operator_id = ? AND fact_key IN ('cover','requirement','policy','cancellation') GROUP BY fact_key");
  const ins = db.prepare("INSERT INTO outreach_drafts (id, operator_id, to_email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?)");
  // One transaction: the write lock is held for seconds, not minutes, while crawls share the database.
  db.exec("BEGIN");
  for (const op of ops) {
    if (!db.prepare("SELECT 1 FROM gaps WHERE operator_id = ? LIMIT 1").get(op.id)) refreshGaps(op.id);
    const offerings = (offQ.all(op.id) as { name: string; price_cents: number | null }[]).map((o) => o.name + (o.price_cents != null ? " · $" + (o.price_cents / 100).toFixed(0) : ""));
    const keys = new Set((factQ.all(op.id) as { fact_key: string }[]).map((f) => f.fact_key));
    const { subject, body } = draftCopy(op, sc, offerings, keys.has("cover"), keys.has("requirement") || keys.has("policy") || keys.has("cancellation"));
    ins.run(randomUUID(), op.id, plausibleEmail(op), subject, body, nowIso());
    n += 1;
  }
  db.exec("COMMIT");
  return n;
}
