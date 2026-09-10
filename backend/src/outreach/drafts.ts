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
function scale(): { listings: number; metros: number; local: Map<string, number> } {
  const listings = (db.prepare("SELECT COUNT(*) AS n FROM operators WHERE origin != 'demo' AND website IS NOT NULL").get() as { n: number }).n;
  const metros = (db.prepare("SELECT COUNT(DISTINCT metro_id) AS n FROM operators WHERE metro_id IS NOT NULL").get() as { n: number }).n;
  const local = new Map<string, number>();
  for (const r of db.prepare("SELECT metro_id, COUNT(*) AS n FROM operators WHERE metro_id IS NOT NULL AND origin != 'demo' GROUP BY metro_id").all() as { metro_id: string; n: number }[]) local.set(r.metro_id, r.n);
  return { listings, metros, local };
}

function round(n: number): string {
  if (n >= 10000) return Math.floor(n / 1000) + ",000+";
  if (n >= 1000) return Math.floor(n / 100) * 100 + "+";
  return String(n);
}

/**
 * The claim email. The pitch, in the operator's order of concern: it is already done, it costs nothing until it earns,
 * it works with the calendar they already use, and thousands of others are on it. Every claim in here is true today
 * except the calendar hookup, which is offered as something we do for them on request.
 */
function draftCopy(op: Op, sc: ReturnType<typeof scale>, offerings: string[], hasPhotos: boolean, hasRules: boolean): { subject: string; body: string } {
  const SITE = "https://harshils2340.github.io/outset-app/";
  const id = catalogId(op.domain);
  const city = op.city || "your area";
  const vendor = op.calendar_vendor ? VENDOR_NAME[op.calendar_vendor] || null : null;
  const localN = op.metro_id ? sc.local.get(op.metro_id) || 0 : 0;
  const menu = offerings.length ? offerings.slice(0, 4).map((o) => "  " + o).join("\n") : "  (we could not read a menu from your site, so guests see Request to book until you add one)";
  const subject = op.name + " is already listed on Outset. Claim it in one click, nothing to set up.";
  const body = [
    "Hi " + op.name + ",",
    "",
    "Your listing on Outset is already built and live. We copied it from your own website: " +
      [offerings.length ? "your menu and prices" : null, hasPhotos ? "your photos" : null, "your hours", hasRules ? "your age and cancellation rules" : null].filter(Boolean).join(", ") +
      ". Guests in " + city + " can find you, compare, and book a time without calling around.",
    "",
    "What they see today:",
    menu,
    "",
    "Your listing:      " + SITE + "#o=" + id,
    "Your dashboard:    " + SITE + "#claim=" + id + "&k=" + claimToken(id),
    "",
    "The second link is yours alone. No password, no form. It opens your dashboard with everything filled in; change a price or a photo if you like, or leave it.",
    "",
    "Why operators keep it on:",
    "  Nothing to do. Bookings arrive by email and in a feed you accept or decline from your phone.",
    vendor
      ? "  Keep " + vendor + ". You do not switch anything. Tell us and we will wire Outset bookings into your " + vendor + " calendar so they land where your bookings already land."
      : "  Keep the calendar you use now. Tell us which one and we will wire Outset bookings into it, so they land where your bookings already land.",
    "  Extra bookings, not extra work. Free to list. A flat fee only when a booking happens, and nothing is added to your guest's price.",
    "  Waivers handled. Your waiver link sits on the listing and guests sign before they arrive. If you do not have one, we set one up.",
    "  An assistant on your page that answers guest questions only from what your site says, day and night, so fewer calls for you.",
    "",
    "Who else is on it: " + round(sc.listings) + " operators across " + sc.metros + " cities in the US and Canada" + (localN >= 20 ? ", " + round(localN) + " of them around " + city : "") + ". Guests come to one place to pick an activity instead of ten websites, which is where the extra bookings come from.",
    "",
    "Not your business, or want it gone? One click: " + SITE + "#remove=" + id,
    "",
    "Harshil",
    "Founder, Outset",
    "Reply to this email and a person answers.",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { subject, body };
}

export function generateOutreachDrafts(): number {
  const ops = db.prepare("SELECT * FROM operators WHERE origin != 'demo' AND claim_status = 'unclaimed'").all() as Op[];
  const sc = scale();
  let n = 0;
  db.prepare("DELETE FROM outreach_drafts WHERE status = 'draft'").run();
  const offQ = db.prepare("SELECT name, price_cents FROM offerings WHERE operator_id = ? ORDER BY price_cents IS NULL, price_cents LIMIT 6");
  const factQ = db.prepare("SELECT fact_key FROM facts WHERE operator_id = ? AND fact_key IN ('cover','requirement','policy','cancellation') GROUP BY fact_key");
  const ins = db.prepare("INSERT INTO outreach_drafts (id, operator_id, to_email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?)");
  for (const op of ops) {
    if (!db.prepare("SELECT 1 FROM gaps WHERE operator_id = ? LIMIT 1").get(op.id)) refreshGaps(op.id);
    const offerings = (offQ.all(op.id) as { name: string; price_cents: number | null }[]).map((o) => o.name + (o.price_cents != null ? " · $" + (o.price_cents / 100).toFixed(0) : ""));
    const keys = new Set((factQ.all(op.id) as { fact_key: string }[]).map((f) => f.fact_key));
    const { subject, body } = draftCopy(op, sc, offerings, keys.has("cover"), keys.has("requirement") || keys.has("policy") || keys.has("cancellation"));
    ins.run(randomUUID(), op.id, op.email, subject, body, nowIso());
    n += 1;
  }
  return n;
}
