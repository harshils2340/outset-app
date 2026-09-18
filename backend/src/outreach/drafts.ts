import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { VENDORS } from "../enrich/vendors.ts";
import { db, nowIso } from "../db/client.ts";
import { claimTokenV2 } from "../lib/claim.ts";
import { mailPostal, unsubPageUrl } from "../lib/unsub.ts";
import { tidyHours } from "../sync/contacts.ts";
import { outreachAddress } from "./address.ts";

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

export function draftCopy(op: Op, sc: ReturnType<typeof scale>, f: PageFacts, email?: string): { subject: string; body: string; html: string } {
  void sc;
  const to = (email || "").trim().toLowerCase();
  const SITE = "https://onoutset.com/";
  const TERMS = SITE + "terms.html";
  const PRIVACY = SITE + "privacy.html";
  const id = catalogId(op.domain);
  const listing = SITE + "#o=" + id;
  /**
   * The claim link carries the address we are writing to, the way the self-serve link carries what the owner
   * typed. Without it the claimed profile has no owner email, so "email me a sign-in code" answers politely
   * and sends nothing, and the operator never gets told about a booking. It is the same address already in
   * the To line, so it reveals nothing the recipient does not have.
   */
  const owner = to ? "&o=" + Buffer.from(JSON.stringify({ n: "", e: to, p: "" })).toString("base64url") : "";
  const claim = SITE + "#claim=" + id + "&k=" + claimTokenV2(id) + owner;
  const remove = SITE + "#remove=" + id;
  const vendor = vendorLine(op.calendar_vendor, f.menuFromWidget);
  const subject = "A page for " + op.name;
  // The catalog size guests browse today: read from the published catalog when this process has it, else the last known count.
  const listed = publishedCount();
  const menu = f.priced.length
    ? "your " + f.priced.length + (f.priced.length === 1 ? " service" : " services") + " with prices"
    : f.services
      ? "your " + f.services + (f.services === 1 ? " service" : " services")
      : null;
  const built = [menu, f.photos ? "your photos" : null, f.hours ? "your hours" : null, f.rules ? "your cancellation policy" : null].filter(Boolean) as string[];
  const who = "I'm Harshil. I run Outset, a site where people book local activities the way they book a table on OpenTable: pick a time, pay, done. No calling around.";
  // A page with nothing on it is still worth showing, but it cannot be sold as one that has their things on it.
  const intro = built.length
    ? "I built a page for " + op.name + " from your website. It has " + andList(built) + ". I didn't make anything up. Have a look:"
    : "I built a page for " + op.name + " from your website, but your site gave me very little to put on it, so the page is thin. Nothing on it is invented, and the link below lets you fill in the rest. Have a look:";
  const scale = "There are about " + listed + " activity businesses on Outset across the US and Canada, from Florida to British Columbia, and guests find them by city and activity.";
  const money = "What it costs: nothing to be listed. When a booking comes through Outset, we keep 5% of it. No booking, no fee." + (vendor ? " " + vendor : "");
  /**
   * The two questions an owner asks before they will take an online booking: what happens when the weather kills
   * the day, and who these people are legally. Both are answered here rather than left for them to go looking for.
   * The weather sentence describes what the code already does: an operator decline refunds the card in full
   * (`refundBooking` in src/api/bookings.ts), or releases the hold when nothing was captured.
   */
  const weather = "Weather: if you call a day off, you decline the booking in your dashboard and the guest is refunded in full, automatically, to the card they paid with. Nothing for you to process, no fee to them, and we take no commission on a day that did not run.";
  const legal = "Our terms and privacy policy, so you know who you are dealing with: " + TERMS + " and " + PRIVACY + ".";
  const lines = ["Hi,", "", who, "", intro, listing, "", scale, "", money, "", weather, "", legal, ""];
  const paras = [
    "<p>Hi,</p>",
    "<p>" + esc(who) + "</p>",
    "<p>" + esc(intro) + "<br>" + link(listing, listing) + "</p>",
    "<p>" + esc(scale) + "</p>",
    "<p>" + esc(money) + "</p>",
    "<p>" + esc(weather) + "</p>",
    "<p>Our " + link(TERMS, "terms") + " and " + link(PRIVACY, "privacy policy") + ", so you know who you are dealing with.</p>",
  ];
  lines.push(
    "If this is your business, this link opens your page so you can fix anything and switch bookings on. It's meant for the owner, so please don't forward it:",
    claim,
    "",
    "If I've got the wrong business, this takes the page down:",
    remove,
    "",
    "Harshil",
    "Outset",
  );
  paras.push(
    "<p>If this is your business, " + link(claim, "this link opens your page") + " so you can fix anything and switch bookings on. It's meant for the owner, so please don't forward it.</p>",
    "<p>If I've got the wrong business, " + link(remove, "this takes the page down") + ".</p>",
    "<p>Harshil<br>Outset</p>",
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

/**
 * How many listings the site publishes: the browse catalog's count, rounded down to the nearest thousand,
 * with "59,000" as the floor if the file is missing. Read once per process: catalog.json is 23 MB, and this
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
  return "59,000";
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
  db.prepare("DELETE FROM outreach_drafts WHERE status = 'draft'").run();
  const ins = db.prepare("INSERT INTO outreach_drafts (id, operator_id, to_email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?)");
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
