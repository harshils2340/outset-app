import { randomUUID } from "node:crypto";
import { LIVE_CALENDAR, catalogId, vendorLabel } from "./drafts.ts";
import { mailPostal, unsubPageUrl } from "../lib/unsub.ts";
import { bestAddress, greeting } from "./owner.ts";
import { db, nowIso } from "../db/client.ts";

/**
 * The pitch for Otto, the AI phone front desk (public/otto.html), not the "claim your free listing" email in
 * drafts.ts. Different product, different offer, so it stays a separate draft function rather than a branch
 * inside draftCopy: the two must never be sent to the same address inside the same week, which is enforced
 * at send time by the clause both send queries share (spacing.ts).
 */
export type OttoOp = {
  id: string;
  domain: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  calendar_vendor: string | null;
  /** outreach_pool.family: what the first line says the team is busy with. */
  family?: string | null;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A business name in the possessive, for the subject line. A name that is already possessive keeps its own
 * apostrophe rather than growing a second one: "Capt Andy's" is the whole name of a real shipped operator, and
 * "Who answers Capt Andy's's phone after you close?" is the sort of subject that tells an owner at a glance
 * that nobody wrote this. A name ending in a plural s ("Gulf Jet Skis") keeps its added apostrophe s: the
 * correct form drops the s, but that is 2,261 of the 4,728 targets and a copy call rather than a typo.
 */
export function possessive(name: string): string {
  return /['’]s$/i.test(name) ? name : name + "'s";
}

function link(href: string, label: string): string {
  return "<a href=\"" + esc(href) + "\">" + esc(label) + "</a>";
}

/**
 * What Otto can honestly say it does with this operator's calendar. FareHarbor, Peek and Xola are read live
 * (src/enrich/availability.ts), so Otto can tell a caller what is actually open and hand them the link to that
 * slot. Anywhere else it must not claim to see the calendar: it answers from what the operator has published
 * and takes the booking details down for them.
 */
function whatOttoDoes(id: string | null): string {
  const name = vendorLabel(id);
  // Harshil, 2 October 2026: say it answers only from the business's own info, booking system and terms, so
  // an owner knows it never makes things up. "Booking system" is said only where Otto really reads one.
  if (id && LIVE_CALENDAR.has(id) && name)
    return "It answers only from your own info, prices and policies, so it never makes anything up, checks what's actually open in " + name + " and sends the caller the link to book that exact slot.";
  return "It answers only from your own info, prices and policies, so it never makes anything up, and takes the booking down for you.";
}

/** An escape room, by its name or its site: the queue leads with them (touches.ts), so they get their own words. */
function isEscapeRoom(op: Pick<OttoOp, "name" | "domain">): boolean {
  return /escape|escaperoom/i.test(op.name + " " + op.domain);
}

/**
 * What the team is doing when the phone rings, in the owner's own day rather than a generic "busy with guests":
 * an escape room's game masters are running rooms, a karting crew is on the track. By outreach_pool.family.
 */
export function busyLine(op: Pick<OttoOp, "name" | "domain" | "family">): string {
  if (isEscapeRoom(op)) return "your game masters are running rooms";
  switch (op.family) {
    case "indoor": return "your team is out on the floor";
    case "motorsport": return "your crew is out on the track";
    case "water": return "your crew is out on the water";
    case "air": return "your pilots are up flying";
    case "outdoor": return "your guides are out with a group";
    case "wellness": return "you're with a client";
    default: return "your team is busy with guests";
  }
}

/**
 * Which copy a send carried, stored on outreach_sends.variant (touches.ts) so replies can be read against the
 * version that earned them. Bump it whenever the body changes.
 */
// 2026-10-03: the product is named Outset in the body ("I built Outset"); Otto stays the assistant's name on calls.
// 2026-10-05: the first line is the owner's own day by kind of business (game masters running rooms, a crew out on
// the track), the ask is "Can I set one up for {name}?", the shape of the 23 September subject ("Can I build
// Area 53 Laser Tag a free booking page?") that drew a "What is the cost for this?", and the take-down line is
// plain words instead of "Don't want your free Outset page?", which read as a page built without asking: the
// complaint both angry replies (Sandbox VR, Capt. Dave's) made. Two links in the footer, not three lines of them.
export const COPY_VERSION = "2026-10-05";

/**
 * The 2 October 2026 pitch. 596 sends of the 1 October copy earned one human reply, and a placement test
 * between the three sending inboxes showed why: Gmail filed it under Promotions every time, with or without
 * the logo, the footer, the links or the HTML. The long, salesy wording was the trigger. A short note that
 * opens on a question landed in Primary in every inbox, still did with one recording link, the postal address
 * and the opt-out, and this is that note with Harshil's asks folded in (24/7 customer service, the recording).
 * scripts/otto-cloud.mts re-runs the same placement test before every daily batch and holds the batch if
 * Gmail starts filing it as Promotions, so a later edit here cannot silently undo this.
 *
 * Keep it short and personal. Every paragraph added, every extra link and every marketing phrase is a step
 * back toward the Promotions tab. The required lines (postal address, unsubscribe, the one-click take-down of
 * the operator's Outset page from backend/src/outreach/AGENTS.md) stay as one plain small block at the end.
 */
export function draftOttoCopy(op: OttoOp, email?: string, opts?: { greet?: string | null }): { subject: string; body: string; html: string; variant: string } {
  const to = (email || "").trim().toLowerCase();
  const variant = COPY_VERSION;
  // "Hi Ron," only when the shop's own site names Ron as the owner and the mailbox is his by that same word
  // (owner.ts, from the owners crawl's facts): never a guessed first name, which is the one mistake an owner
  // cannot miss. A caller with no catalog at hand (the cloud sender, from the published pool) passes the name
  // that was found for it, or null for "Hi,".
  const hi = opts && "greet" in opts ? (opts.greet ? "Hi " + opts.greet + "," : "Hi,") : to ? greeting(op, to) : "Hi,";
  const SITE = "https://onoutset.com/";
  const OTTO = SITE + "#call";
  const escape = isEscapeRoom(op);
  const subject = "Missed calls at " + op.name;
  const question = "When " + busyLine(op) + " or after you close, who picks up " + possessive(op.name) + " phone?";
  const pain = escape
    ? "For most escape rooms it's voicemail, and the caller books the next room on their list."
    : "For most places it's voicemail, and the caller books with the next one that picks up.";
  const what = "I built Outset to pick up those calls. " + whatOttoDoes(op.calendar_vendor) + " You get a summary of every call.";
  const hearText = "Here's a 40-second recording of a real call: " + OTTO;
  const hearHtml = "Here's a 40-second recording of a real call: " + link(OTTO, "give it a listen") + ".";
  const offer = "Can I set one up for " + op.name + "? I'll build it from your own info so you can call it and test it yourself. It's free, and you only keep it if it books you guests.";
  const lines = [hi, "", question, "", pain, "", what + " " + hearText, "", offer, "", ...signOff(op, to).lines];
  const html = '<div dir="ltr">' + [
    "<p>" + esc(hi) + "</p>",
    "<p>" + esc(question) + "</p>",
    "<p>" + esc(pain) + "</p>",
    "<p>" + esc(what) + " " + hearHtml + "</p>",
    "<p>" + esc(offer) + "</p>",
    signOff(op, to).html,
  ].join("") + "</div>";
  return { subject, body: lines.join("\n"), html, variant };
}

/**
 * The sign-off every Otto mail ends with: who wrote it, the postal address CAN-SPAM and CASL require, a way to
 * stop, and the one-click way off the business's Outset listing that backend/src/outreach/AGENTS.md requires,
 * said plainly rather than as "Don't want your free Outset page?".
 */
function signOff(op: OttoOp, to: string): { lines: string[]; html: string } {
  const SITE = "https://onoutset.com/";
  const remove = SITE + "activities#remove=" + catalogId(op.domain);
  const stop = to ? unsubPageUrl(to) : SITE + "unsubscribe.html";
  const postal = mailPostal();
  const where = postal ? postal.replace(/^Outset,\s*/i, "") : "";
  return {
    lines: [
      "Harshil",
      "Founder, Outset",
      ...(where ? [where] : []),
      'Not a fit? Reply "no" and I won\'t email again, or unsubscribe: ' + stop,
      "Remove " + op.name + " from Outset's listings: " + remove,
    ],
    html: '<p style="color:#777">Harshil<br>Founder, Outset' + (where ? "<br>" + esc(where) : "") +
      "<br>Not a fit? Reply \"no\" and I won't email again, or " + link(stop, "unsubscribe") + "." +
      "<br>" + link(remove, "Remove " + op.name + " from Outset's listings") + ".</p>",
  };
}

/** The follow-up's copy version, stored on outreach_sends.variant like COPY_VERSION. */
export const BUMP_VERSION = "bump-2026-10-05";

/**
 * The one follow-up, a few days after a first email that landed in Primary and drew no answer: two lines in the
 * same thread ("Re:" the first subject, sent as a reply to it from the same mailbox), the offer made concrete.
 * Most cold-email replies come from the follow-up, not the first note.
 */
export function draftOttoBump(op: OttoOp, email: string, opts: { greet?: string | null; subject: string }): { subject: string; body: string; html: string; variant: string } {
  const to = (email || "").trim().toLowerCase();
  const hi = opts.greet ? "Hi " + opts.greet + "," : "Hi,";
  const subject = /^re:/i.test(opts.subject) ? opts.subject : "Re: " + opts.subject;
  const ask = "Following up in case this got buried. Would it help if I set up a free test line for " + op.name +
    ", built from your own info, so you can call it and hear how it handles your callers?";
  const off = signOff(op, to);
  const body = [hi, "", ask, "", ...off.lines].join("\n");
  const html = '<div dir="ltr"><p>' + esc(hi) + "</p><p>" + esc(ask) + "</p>" + off.html + "</div>";
  return { subject, body, html, variant: BUMP_VERSION };
}

/**
 * The Outset footer every outreach email carries: logo, tagline, terms, privacy, and for an addressed mail an
 * unsubscribe link and the postal address CAN-SPAM and CASL require. Shared so hand-written follow-ups and the
 * automated pitch can never drift apart.
 */
export function brandFooter(to: string): { lines: string[]; html: string } {
  const SITE = "https://onoutset.com/";
  const TERMS = SITE + "terms.html";
  const PRIVACY = SITE + "privacy.html";
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
  return { lines: footerLines, html: footerParas.join("") };
}

/**
 * Otto is a phone answering pitch, so eligibility is "does this business actually take calls," not the
 * listing pitch's photo/price completeness bar. Every family that takes bookings (3 October 2026, Harshil: "anything booking related"), widened past `water` on 30 September
 * 2026 at Harshil's direction: the pitch is "answer calls and book the guest," which holds for any
 * booking-based business, not only marinas and watersports, and he wants a real per-family reply-rate
 * comparison rather than a single vertical assumed to be the best one. `family` isn't stored on
 * `outreach_drafts`, so that comparison is a join back to `operators.family` by `operator_id`, not a new
 * column. Government-run parks and rec departments (county marinas, municipal boat launches, public pools)
 * slip into several families and are not who this is for: excluded by name pattern the same way the listing
 * pitch excludes museums and theme parks by category.
 */
export function generateOttoDrafts(): number {
  const ops = (
    db
      .prepare(
        `SELECT * FROM operators
         WHERE origin NOT IN ('demo', 'test') AND claim_status = 'unclaimed' AND email LIKE '%@%'
           AND phone IS NOT NULL AND phone != ''
           AND lower(name) NOT LIKE '%park%' AND lower(name) NOT LIKE '%county%' AND lower(name) NOT LIKE '%city of%'
           AND lower(name) NOT LIKE '%recreation%' AND lower(name) NOT LIKE '%district%' AND lower(name) NOT LIKE '%municipal%'
           AND domain NOT LIKE '%.gov' AND domain NOT LIKE '%.org' AND domain NOT LIKE '%.edu'`,
      )
      .all() as (OttoOp & { origin: string; claim_status: string })[]
  ).filter((op) => bestAddress(op));
  let n = 0;
  db.exec("PRAGMA busy_timeout = 120000");
  // Scoped to 'otto': a listing-draft regeneration must never wipe these, and this must never wipe listing rows.
  db.prepare("DELETE FROM outreach_drafts WHERE status = 'draft' AND kind = 'otto'").run();
  const ins = db.prepare("INSERT INTO outreach_drafts (id, operator_id, to_email, subject, body, status, created_at, kind) VALUES (?, ?, ?, ?, ?, 'draft', ?, 'otto')");
  db.exec("BEGIN IMMEDIATE");
  for (const op of ops) {
    const to = bestAddress(op);
    if (!to) continue;
    const { subject, body } = draftOttoCopy(op, to);
    ins.run(randomUUID(), op.id, to, subject, body, nowIso());
    n += 1;
  }
  db.exec("COMMIT");
  return n;
}
