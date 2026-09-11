import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { claimToken } from "../lib/claim.ts";
import { mailPostal, unsubPageUrl } from "../lib/unsub.ts";

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
export function scale(): { listings: number; metros: number; claimed: number; local: Map<string, number> } {
  const listings = (db.prepare("SELECT COUNT(*) AS n FROM operators WHERE origin != 'demo' AND website IS NOT NULL").get() as { n: number }).n;
  const metros = (db.prepare("SELECT COUNT(DISTINCT metro_id) AS n FROM operators WHERE metro_id IS NOT NULL").get() as { n: number }).n;
  const claimed = (db.prepare("SELECT COUNT(*) AS n FROM operators WHERE origin != 'demo' AND claim_status != 'unclaimed'").get() as { n: number }).n;
  const local = new Map<string, number>();
  for (const r of db.prepare("SELECT metro_id, COUNT(*) AS n FROM operators WHERE metro_id IS NOT NULL AND origin != 'demo' GROUP BY metro_id").all() as { metro_id: string; n: number }[]) local.set(r.metro_id, r.n);
  return { listings, metros, claimed, local };
}

/**
 * The claim email. Plain English. One listing link and one owner-only claim link.
 * Anyone with the claim token can open the dashboard, so the copy says not to forward it.
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function link(href: string, label: string): string {
  return "<a href=\"" + esc(href) + "\">" + esc(label) + "</a>";
}

export function draftCopy(op: Op, sc: ReturnType<typeof scale>, offerings: string[], hasPhotos: boolean, hasRules: boolean, email?: string): { subject: string; body: string; html: string } {
  void sc;
  void offerings;
  void hasPhotos;
  void hasRules;
  const to = (email || "").trim().toLowerCase();
  const SITE = "https://onoutset.com/";
  const id = catalogId(op.domain);
  const listing = SITE + "#o=" + id;
  const claim = SITE + "#claim=" + id + "&k=" + claimToken(id);
  const remove = SITE + "#remove=" + id;
  const vendor = op.calendar_vendor ? VENDOR_NAME[op.calendar_vendor] || null : null;
  const subject = "A page for " + op.name;
  const city = (op.city || "").trim();
  const where = city ? " so people in " + city + " can book you there" : "";
  const who =
    "I'm Harshil. I built Outset, think of it like OpenTable, but for tours and activities instead of dinner. People pick a time and book instead of calling and hoping someone picks up.";
  const intro =
    "I already made a page for " +
    op.name +
    " from your website" +
    where +
    ". It's only what you already have online, I didn't invent prices or hours.";
  const money = "It's free for you. We take a small fee from the guest when they pay.";
  const lines = [
    "Hi,",
    "",
    who,
    "",
    intro,
    "See the page: " + listing,
    "",
    money,
    "",
  ];
  const paras = [
    "<p>Hi,</p>",
    "<p>" + esc(who) + "</p>",
    "<p>" + esc(intro) + " " + link(listing, "See the page") + ".</p>",
    "<p>" + esc(money) + "</p>",
  ];
  if (vendor) {
    const keep = "If you already use " + vendor + ", keep it, this doesn't replace that.";
    lines.push(keep, "");
    paras.push("<p>" + esc(keep) + "</p>");
  }
  lines.push(
    "If this is actually your shop, you can open the page from this link. Please don't forward it, it's meant for the owner:",
    claim,
    "",
    "If I have the wrong business, you can take the page down here:",
    remove,
    "",
    "Harshil",
  );
  paras.push(
    "<p>If this is actually your shop, you can " +
      link(claim, "open the page") +
      " from this link. Please don't forward it, it's meant for the owner.</p>",
    "<p>If I have the wrong business, you can " + link(remove, "take the page down") + ".</p>",
    "<p>Harshil</p>",
  );
  if (to) {
    const stop = unsubPageUrl(to);
    lines.push("", "If you'd rather not get emails like this: " + stop);
    paras.push("<p>If you'd rather not get emails like this, " + link(stop, "you can unsubscribe") + ".</p>");
    const postal = mailPostal();
    if (postal) {
      lines.push("", postal);
      paras.push("<p>" + esc(postal) + "</p>");
    }
  }
  return {
    subject,
    body: lines.join("\n"),
    html: '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#222">' + paras.join("") + "</div>",
  };
}

/** Fresh copy at send time so a stale SQLite draft never goes out. */
export function composeOutreach(op: Op, email: string): { subject: string; body: string; html: string } {
  return draftCopy(op, scale(), [], false, false, email);
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
  // Only operators we could actually email. Keeps the write transaction to seconds while crawls share the database.
  const ops = (db.prepare("SELECT * FROM operators WHERE origin != 'demo' AND claim_status = 'unclaimed' AND email LIKE '%@%'").all() as Op[]).filter((op) => plausibleEmail(op));
  const sc = scale();
  let n = 0;
  db.exec("PRAGMA busy_timeout = 120000");
  db.prepare("DELETE FROM outreach_drafts WHERE status = 'draft'").run();
  const offQ = db.prepare("SELECT name, price_cents FROM offerings WHERE operator_id = ? ORDER BY price_cents IS NULL, price_cents LIMIT 6");
  const factQ = db.prepare("SELECT fact_key FROM facts WHERE operator_id = ? AND fact_key IN ('cover','requirement','policy','cancellation') GROUP BY fact_key");
  const ins = db.prepare("INSERT INTO outreach_drafts (id, operator_id, to_email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?)");
  // One transaction: the write lock is held for seconds, not minutes, while crawls share the database.
  db.exec("BEGIN IMMEDIATE");
  for (const op of ops) {
    const offerings = (offQ.all(op.id) as { name: string; price_cents: number | null }[]).map((o) => o.name + (o.price_cents != null ? " · $" + (o.price_cents / 100).toFixed(0) : ""));
    const keys = new Set((factQ.all(op.id) as { fact_key: string }[]).map((f) => f.fact_key));
    const to = plausibleEmail(op);
    if (!to) continue;
    const { subject, body } = draftCopy(op, sc, offerings, keys.has("cover"), keys.has("requirement") || keys.has("policy") || keys.has("cancellation"), to);
    ins.run(randomUUID(), op.id, to, subject, body, nowIso());
    n += 1;
  }
  db.exec("COMMIT");
  return n;
}
