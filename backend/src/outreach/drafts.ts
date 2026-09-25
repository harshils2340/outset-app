import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VENDORS } from "../enrich/vendors.ts";
import { db, nowIso } from "../db/client.ts";
import { mailPostal, unsubPageUrl } from "../lib/unsub.ts";
import { tidyHours } from "../sync/contacts.ts";
import { outreachAddress } from "./address.ts";

/**
 * Harshil's own booking page, given by him on 25 September 2026 with the overlay parameter included: cal.com
 * then shows the visitor their own calendar alongside his open slots, so they can pick a time without
 * switching tabs. Both campaigns (this listing-claim email and ottoDrafts.ts) link it, so every "love to
 * chat" lands in the same calendar.
 */
export const CALL_LINK = "https://cal.com/harshil-shah-7tkvs7/outset?overlayCalendar=true";

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
export function catalogId(domain: string): string {
  return "o-" + domain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

/** Vendors whose live calendar Outset reads (src/enrich/availability.ts): guests only see times the operator has open. */
const LIVE_CALENDAR = new Set(["fareharbor", "peek", "xola"]);
/** Vendors whose menu Outset reads straight from the widget (src/enrich/widgets.ts): the prices on the page are theirs. */
const MENU_READ = new Set(["fareharbor", "peek", "xola", "acuity", "square", "checkfront", "burblesoft", "resova", "vallypro", "bookeo", "rezdy"]);

export function vendorLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return VENDORS.find((v) => v.id === id)?.label || null;
}

/**
 * The one sentence that stops "we already use FareHarbor" from being the reply. It says what is true for that
 * vendor: the calendar is read live, the prices came from it, or simply that nothing replaces it.
 */
export function vendorLine(id: string | null | undefined, menuFromWidget: boolean): string | null {
  const name = vendorLabel(id);
  if (!name || !id) return null;
  // Only claim the prices came from their widget when this operator's menu really did (offerings with confidence 'widget').
  const priced = menuFromWidget && MENU_READ.has(id) ? " The prices on your page came straight from your " + name + " listings, so they match." : "";
  if (LIVE_CALENDAR.has(id)) return "You already use " + name + ", so keep it. Outset reads your " + name + " calendar, so guests only see times you actually have open." + priced + " Nothing changes on your site; this is another door to the same shop.";
  if (priced) return "You already use " + name + ", so keep it." + priced + " Nothing changes on your site; this is another door to the same shop, and each booking reaches you by email.";
  return "If you already use " + name + " for bookings, keep it. Outset doesn't replace it; it's another place guests find you, and each booking reaches you by email.";
}

/** Real numbers for the credibility line, read once per draft run. */
export function scale(): { listings: number; metros: number; claimed: number; local: Map<string, number> } {
  const listings = (db.prepare("SELECT COUNT(*) AS n FROM operators WHERE origin NOT IN ('demo', 'test') AND website IS NOT NULL").get() as { n: number }).n;
  const metros = (db.prepare("SELECT COUNT(DISTINCT metro_id) AS n FROM operators WHERE metro_id IS NOT NULL").get() as { n: number }).n;
  const claimed = (db.prepare("SELECT COUNT(*) AS n FROM operators WHERE origin NOT IN ('demo', 'test') AND claim_status != 'unclaimed'").get() as { n: number }).n;
  const local = new Map<string, number>();
  for (const r of db.prepare("SELECT metro_id, COUNT(*) AS n FROM operators WHERE metro_id IS NOT NULL AND origin NOT IN ('demo', 'test') GROUP BY metro_id").all() as { metro_id: string; n: number }[]) local.set(r.metro_id, r.n);
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

/**
 * What this operator's page will actually show, so the email can name what is on it and nothing else.
 *
 * The email says "I didn't make anything up" in the same breath, and an owner checks by clicking the link
 * directly under it, so every item here is read from the same place the sync reads it from when it writes
 * the page. `hours` was not read at all: the sentence said "your hours" to every operator, and 44,312 of the
 * 59,162 listings we ship publish no hours.
 */
export type PageFacts = {
  /** Service names that carry a price. */
  priced: string[];
  /** Every service on the menu, priced or not. */
  services: number;
  photos: boolean;
  hours: boolean;
  rules: boolean;
  /** The menu was read from the operator's own booking widget, so the prices are theirs. */
  menuFromWidget: boolean;
};

/** "a", "a and b", "a, b and c". A one-item list used to read "It has  and your hours." */
function andList(parts: string[]): string {
  if (parts.length < 2) return parts[0] || "";
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

/**
 * How many listings the site publishes: the browse catalog's count, rounded down to the nearest thousand,
 * with "50,000" as the floor if the file is missing. Read once per process: catalog.json is large, and this
 * sits inside the copy, which a draft run writes once per operator.
 */
let listedOnce: string | null = null;
function publishedCount(): string {
  if (listedOnce) return listedOnce;
  return (listedOnce = readPublishedCount());
}

function readPublishedCount(): string {
  try {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../public/catalog.json"), "utf8");
    const n = (JSON.parse(raw) as { operators?: unknown[] }).operators?.length || 0;
    if (n >= 1000) return (Math.floor(n / 1000) * 1000).toLocaleString("en-US");
  } catch {
    /* no catalog on this host */
  }
  return "50,000";
}

/**
 * Ask first, build after. Changed 23 September 2026 from "I already built your page, claim it or take it
 * down": a real operator (Capt. Dave's Dolphin & Whale Watching Safari) wrote back after asking for her
 * listing removed to say the actual problem wasn't being found, it was that a page selling her specific
 * trips existed before she ever agreed to any of it. This version never says a page exists. It offers to
 * build one, on request, and links a different real listing to try editing (never the recipient's own
 * business) so they can see how it works before anything about them is public anywhere.
 */
export function draftCopy(op: Op, sc: ReturnType<typeof scale>, f: PageFacts, email?: string): { subject: string; body: string; html: string } {
  void sc;
  const to = (email || "").trim().toLowerCase();
  const SITE = "https://onoutset.com/";
  const TERMS = SITE + "terms.html";
  const PRIVACY = SITE + "privacy.html";
  const id = catalogId(op.domain);
  // Discovery still writes a record for every business it finds, same as it always did; this email just never
  // links or names it. A recipient who goes looking (or already has a page from before this changed) still
  // gets an instant, obvious way out, which backend/src/outreach/AGENTS.md requires regardless.
  const remove = SITE + "#remove=" + id;
  const vendor = vendorLine(op.calendar_vendor, f.menuFromWidget);
  const subject = "Can I build " + op.name + " a free booking page?";
  // No count and no "with prices" claim: a scrape can miscount or miss a price, and a wrong specific number
  // is the kind of thing an owner notices and stops trusting the whole email over. "Services" always holds.
  const menu = f.priced.length || f.services ? "services" : null;
  const built = [menu, f.photos ? "your photos" : null, f.hours ? "your hours" : null, f.rules ? "your cancellation policy" : null].filter(Boolean) as string[];
  const who = "I'm Harshil, the founder of Outset, an instant-booking marketplace for local activities across the US and Canada.";
  const browse = "Take a look: " + SITE;
  const offer = built.length
    ? "We can build " + op.name + " a complete page using " + andList(built) + ", all set up and ready to go, for free. We just need your OK to do it."
    : "We can build " + op.name + " a complete page, all set up and ready to go, for free. We just need your OK to do it.";
  const trySample = "Want to see how easy it is first? Here's a sample listing you can click around and edit yourself, so you can see exactly how simple it is to set up:";
  const demoUrl = SITE + "operators#demo";
  const scaleLine = "You'd be joining about " + publishedCount() + " other real local businesses already on Outset across the US and Canada, and more join every week.";
  const cta = "Just reply \"yes\" and I'll have it built and sent to you today.";
  // The owner who would rather talk it through than reply "yes" (added 25 September 2026 at Harshil's request).
  const chatLead = "Or if you'd rather see how it would be set up for your business first, ";
  const chatLink = "I'd love to chat";
  const removeLine = "Already have a page on Outset you didn't ask for, or just don't want to be found here at all? This takes it down instantly:";
  const lines = [
    "Hi,", "", who, browse, "",
    offer, vendor ? vendor : null, "",
    trySample, demoUrl, "",
    scaleLine, cta, "",
    chatLead + chatLink + ":", CALL_LINK, "",
    removeLine, remove, "",
    "Best,", "Harshil",
  ].filter((l) => l !== null) as string[];
  const paras = [
    "<p>Hi,</p>",
    "<p>" + esc(who) + "<br>" + link(SITE, "Take a look") + "</p>",
    "<p>" + esc(offer) + (vendor ? " " + esc(vendor) : "") + "</p>",
    "<p>" + esc(trySample) + "<br>" + link(demoUrl, "See a sample listing") + "</p>",
    "<p>" + esc(scaleLine) + "<br>" + esc(cta) + "</p>",
    "<p>" + esc(chatLead) + link(CALL_LINK, chatLink) + ".</p>",
    "<p>" + esc(removeLine) + " " + link(remove, "take it down") + ".</p>",
    "<p>Best,<br>Harshil</p>",
  ];
  // Everything below is the footer: quiet, small, last. What has to be there for law and trust (who is
  // sending this, how to opt out, the fine print), never the thing the eye is asked to land on first.
  // A small mark (the same one at onoutset.com/apple-touch-icon.png, 28px here) plus the wordmark and a
  // one-line tagline, then the legal line, each on its own line: the earlier version ran the wordmark and
  // "Terms" together with no break between them, which is exactly the kind of thing to catch before this
  // goes out at any volume.
  const TAGLINE = "Instant booking for local activities.";
  const footerLines: string[] = ["", "Outset. " + TAGLINE];
  const footerParas: string[] = [
    '<p style="margin-top:24px;padding-top:16px;border-top:1px solid #e3e3e3;font-size:13px;color:#666">' +
      '<img src="' + SITE + 'apple-touch-icon.png" width="28" height="28" alt="Outset" style="border-radius:8px;vertical-align:middle;margin-right:8px">' +
      '<b style="color:#222;font-size:14px">Outset.</b> <span style="color:#555">' + esc(TAGLINE) + "</span><br>",
  ];
  if (to) {
    const stop = unsubPageUrl(to);
    footerLines.push("", TERMS, PRIVACY, "If you'd rather not get emails like this: " + stop);
    footerParas.push(link(TERMS, "Terms") + " &nbsp;·&nbsp; " + link(PRIVACY, "Privacy") + " &nbsp;·&nbsp; " + link(stop, "Unsubscribe"));
    const postal = mailPostal();
    if (postal) {
      footerLines.push(postal);
      footerParas.push("<br>" + esc(postal));
    }
  } else {
    footerLines.push("", TERMS, PRIVACY);
    footerParas.push(link(TERMS, "Terms") + " &nbsp;·&nbsp; " + link(PRIVACY, "Privacy"));
  }
  footerParas[footerParas.length - 1] += "</p>";
  lines.push(...footerLines);
  paras.push(footerParas.join(""));
  return {
    subject,
    body: lines.join("\n"),
    html: '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#222">' + paras.join("") + "</div>",
  };
}

/**
 * One reader of what an operator's page holds, for the draft and for the copy written at send time, so the
 * two cannot disagree. They used to: the draft counted every service as one "with prices".
 * Statements are prepared once, because the draft run walks every unclaimed operator inside one transaction.
 */
let stmt: {
  priced: ReturnType<typeof db.prepare>;
  services: ReturnType<typeof db.prepare>;
  photos: ReturnType<typeof db.prepare>;
  rules: ReturnType<typeof db.prepare>;
  widget: ReturnType<typeof db.prepare>;
  hours: ReturnType<typeof db.prepare>;
  hoursText: ReturnType<typeof db.prepare>;
} | null = null;

function statements() {
  return (stmt ??= {
    priced: db.prepare("SELECT DISTINCT name FROM offerings WHERE operator_id = ? AND price_cents IS NOT NULL"),
    services: db.prepare("SELECT COUNT(DISTINCT name) AS n FROM offerings WHERE operator_id = ?"),
    photos: db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key IN ('cover', 'photo') LIMIT 1"),
    // Only a cancellation fact. The draft generator also counted a requirement or a house rule, and the
    // sentence it feeds says "your cancellation policy", which neither of those is.
    rules: db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = 'cancellation' LIMIT 1"),
    widget: db.prepare("SELECT 1 FROM offerings WHERE operator_id = ? AND confidence = 'widget' AND price_cents IS NOT NULL LIMIT 1"),
    hours: db.prepare("SELECT hours FROM operators WHERE id = ?"),
    hoursText: db.prepare("SELECT fact_value FROM facts WHERE operator_id = ? AND fact_key = 'hours_text' LIMIT 1"),
  });
}

export function pageFacts(operatorId: string): PageFacts {
  const q = statements();
  const hours = (q.hours.get(operatorId) as { hours: string | null } | undefined)?.hours;
  const hoursText = (q.hoursText.get(operatorId) as { fact_value: string } | undefined)?.fact_value;
  return {
    priced: (q.priced.all(operatorId) as { name: string }[]).map((r) => r.name),
    services: (q.services.get(operatorId) as { n: number }).n,
    photos: !!q.photos.get(operatorId),
    // The same two sources and the same filter the sync publishes an Hours block from.
    hours: tidyHours(hours ? hours.split(" | ") : hoursText ? [hoursText] : []).length > 0,
    rules: !!q.rules.get(operatorId),
    menuFromWidget: !!q.widget.get(operatorId),
  };
}

/** Fresh copy at send time so a stale SQLite draft never goes out. */
export function composeOutreach(op: Op, email: string): { subject: string; body: string; html: string } {
  return draftCopy(op, scale(), pageFacts(op.id), email);
}

export function generateOutreachDrafts(): number {
  // Only operators we could actually email. Keeps the write transaction to seconds while crawls share the database.
  const ops = (db.prepare("SELECT * FROM operators WHERE origin NOT IN ('demo', 'test') AND claim_status = 'unclaimed' AND email LIKE '%@%'").all() as Op[]).filter((op) => outreachAddress(op));
  const sc = scale();
  let n = 0;
  db.exec("PRAGMA busy_timeout = 120000");
  // Scoped to this campaign's own rows: the Otto pitch (kind = 'otto') shares this table and must survive a
  // listing-draft regeneration untouched, the same way a listing draft must survive an Otto regeneration.
  db.prepare("DELETE FROM outreach_drafts WHERE status = 'draft' AND kind = 'listing'").run();
  const ins = db.prepare("INSERT INTO outreach_drafts (id, operator_id, to_email, subject, body, status, created_at, kind) VALUES (?, ?, ?, ?, ?, 'draft', ?, 'listing')");
  // One transaction: the write lock is held for seconds, not minutes, while crawls share the database.
  db.exec("BEGIN IMMEDIATE");
  for (const op of ops) {
    const to = outreachAddress(op);
    if (!to) continue;
    const { subject, body } = draftCopy(op, sc, pageFacts(op.id), to);
    ins.run(randomUUID(), op.id, to, subject, body, nowIso());
    n += 1;
  }
  db.exec("COMMIT");
  return n;
}
