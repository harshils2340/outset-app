import { randomUUID } from "node:crypto";
import { CALL_LINK, catalogId, vendorLabel } from "./drafts.ts";
import { mailPostal, unsubPageUrl } from "../lib/unsub.ts";
import { outreachAddress } from "./address.ts";
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
 * The line that answers "we already use X for bookings" before it's asked. Otto is a phone answering
 * service, not a booking-system replacement, so this never claims to read or write their calendar the way
 * the listing pitch's vendorLine does for FareHarbor/Peek/Xola live-read integrations; it says the honest,
 * more limited thing: sets up alongside whatever they already run.
 */
function vendorLine(id: string | null): string {
  const name = vendorLabel(id);
  if (!name) return "Otto plugs right into whatever you already use to take bookings. Bookings drop straight into your calendar as if you took the call yourself.";
  return "Since you use " + name + ", Otto plugs right into it. Bookings drop straight into your calendar as if you took the call yourself.";
}

/**
 * Approved by Harshil verbatim on 24 September 2026, personalized by business name (the opening line and the
 * subject) and by booking vendor (vendorLine, generic when none is on file). On 25 September 2026 he asked for
 * one more line: his Cal.com link as a hyperlink, for the owner who would rather see it set up for their own
 * business than reply, "love to chat". The footer (the take-it-down line, unsubscribe, terms, postal address)
 * is not part of what he approved or edited; it stays because backend/src/outreach/AGENTS.md requires it on
 * every send regardless of what the persuasive copy says.
 */
export function draftOttoCopy(op: OttoOp, email?: string): { subject: string; body: string; html: string } {
  const to = (email || "").trim().toLowerCase();
  const SITE = "https://onoutset.com/";
  const OTTO = SITE + "otto";
  const CAL = CALL_LINK;
  const TERMS = SITE + "terms.html";
  const PRIVACY = SITE + "privacy.html";
  const subject = "Who answers " + possessive(op.name) + " phone after you close?";
  // "AI phone assistant" read too passive to Harshil (24 September 2026): he wants it sound like it gets
  // things done, not like it just takes a message. "AI front desk" is also the exact term otto.html's own
  // hero already uses, so the email and the page it links to now say the same thing.
  const who = "I'm Harshil. I built Otto, the AI front desk for local activity operators like " + op.name + ": it answers calls when you're busy or closed, books the guest in, and emails you a summary.";
  const hear = "Before anything else, give this 43-second recording a listen to hear how it handles a real caller:";
  const staff = "Most operators use it so staff can stay focused on guests in person, while catching calls after hours that used to go to voicemail.";
  const vendor = vendorLine(op.calendar_vendor);
  const guarantee = "I can set it up with you in a day, free until it proves its value on your real line.";
  // One close, three doors (25 September 2026): listen, book a call, or say why not. "I'd love to chat" is
  // the hyperlink in the html; the text part, which no mail app shows when html is present, carries the URL
  // on its own line because plain text has no other way to hold a link.
  const listen = "Give the demo a quick listen.";
  const chatLead = "If this could be helpful, or you'd like to see how it would be set up for your business, ";
  const chatLink = "I'd love to chat";
  const fallback = "And if it's not a fit, even a one-line reply on why helps a lot.";
  // Every operator this pitch goes to already has an unclaimed page in the Outset catalog, and this email
  // names Outset without naming that page, so the way off it has to be in here: the outreach folder's own
  // rule is a one-click remove line on every send, and the listing pitch has carried one since it started.
  // Without it an owner who reads "I built Otto ... for operators like yours" and goes looking has no way out
  // that does not start with a reply.
  const remove = SITE + "#remove=" + catalogId(op.domain);
  const removeLine = "Already have a page on Outset you didn't ask for, or just don't want to be found here at all? This takes it down instantly:";
  const lines = [
    "Hi,", "", who, "",
    hear, "", OTTO, "",
    staff, "", vendor, "",
    guarantee, "",
    listen + " " + chatLead + chatLink + ":", CAL, fallback, "",
    "Best,", "", "Harshil",
    "", removeLine, remove,
  ].filter((l) => l !== null) as string[];
  const paras = [
    "<p>Hi,</p>",
    "<p>" + esc(who) + "</p>",
    "<p>" + esc(hear) + "<br>" + link(OTTO, "Hear the 43-second recording") + "</p>",
    "<p>" + esc(staff) + "</p>",
    "<p>" + esc(vendor) + "</p>",
    "<p>" + esc(guarantee) + "</p>",
    "<p>" + esc(listen + " " + chatLead) + link(CAL, chatLink) + ". " + esc(fallback) + "</p>",
    "<p>Best,<br>Harshil</p>",
    '<p style="font-size:13px;color:#666">' + esc(removeLine) + " " + link(remove, "take it down") + ".</p>",
  ];
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
 * Otto is a phone answering pitch, so eligibility is "does this business actually take calls," not the
 * listing pitch's photo/price completeness bar. `family = 'water'` matches what public/otto.html itself
 * pitches (marinas, boat and jet ski rentals, charters, watersports). Government-run parks and rec
 * departments (county marinas, municipal boat launches) slip into that family and are not who this is for:
 * excluded by name pattern the same way the listing pitch excludes museums and theme parks by category.
 */
export function generateOttoDrafts(): number {
  const ops = (
    db
      .prepare(
        `SELECT * FROM operators
         WHERE origin NOT IN ('demo', 'test') AND claim_status = 'unclaimed' AND email LIKE '%@%'
           AND family = 'water' AND phone IS NOT NULL AND phone != ''
           AND lower(name) NOT LIKE '%park%' AND lower(name) NOT LIKE '%county%' AND lower(name) NOT LIKE '%city of%'
           AND lower(name) NOT LIKE '%recreation%' AND lower(name) NOT LIKE '%district%' AND lower(name) NOT LIKE '%municipal%'
           AND domain NOT LIKE '%.gov' AND domain NOT LIKE '%.org' AND domain NOT LIKE '%.edu'`,
      )
      .all() as (OttoOp & { origin: string; claim_status: string })[]
  ).filter((op) => outreachAddress(op));
  let n = 0;
  db.exec("PRAGMA busy_timeout = 120000");
  // Scoped to 'otto': a listing-draft regeneration must never wipe these, and this must never wipe listing rows.
  db.prepare("DELETE FROM outreach_drafts WHERE status = 'draft' AND kind = 'otto'").run();
  const ins = db.prepare("INSERT INTO outreach_drafts (id, operator_id, to_email, subject, body, status, created_at, kind) VALUES (?, ?, ?, ?, ?, 'draft', ?, 'otto')");
  db.exec("BEGIN IMMEDIATE");
  for (const op of ops) {
    const to = outreachAddress(op);
    if (!to) continue;
    const { subject, body } = draftOttoCopy(op, to);
    ins.run(randomUUID(), op.id, to, subject, body, nowIso());
    n += 1;
  }
  db.exec("COMMIT");
  return n;
}
