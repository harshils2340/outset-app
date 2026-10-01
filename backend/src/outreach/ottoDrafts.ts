import { randomUUID } from "node:crypto";
import { catalogId, vendorLabel } from "./drafts.ts";
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
  const tail = "Otto can work with your existing booking flow so reservations go into the same system you already use.";
  const name = vendorLabel(id);
  return name ? "Since you use " + name + ", " + tail : tail.charAt(0).toUpperCase() + tail.slice(1);
}

/**
 * Which copy a send carried, stored on outreach_sends.variant (touches.ts) so replies can be read against the
 * version that earned them. Bump it whenever the body changes.
 */
export const COPY_VERSION = "2026-10-01";

/**
 * Body written by Harshil on 1 October 2026, templated by business name and booking vendor. The footer (the
 * take-it-down line, unsubscribe, terms, postal address) is not part of his copy; it stays because
 * backend/src/outreach/AGENTS.md requires it on every send.
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
  const OTTO = SITE + "otto";
  const subject = "Who answers " + possessive(op.name) + " phone after you close?";
  const who = "I'm Harshil. I built Otto, an AI front desk for local activity businesses like " + op.name +
    ". It answers calls when your team is busy or closed, handles customer questions, books guests, and sends you a summary afterward.";
  const hear = "Here's a 42-second sample so you can hear what a call sounds like:";
  const staff = "The idea is simple: your staff can keep focusing on guests in person, and Otto handles the calls that would otherwise go unanswered or to voicemail.";
  const vendor = vendorLine(op.calendar_vendor);
  const setup = "I can set up a version specifically for " + op.name + " in a day using your pricing, policies, and booking flow. I'll set it up for free so you can call it yourself and see if it's actually useful before paying for anything.";
  // "yes" is bold in the html only; plain text has no bold.
  const ask = "If you're interested, just reply yes and I'll put one together for you.";
  const askHtml = "If you're interested, just reply <b>yes</b> and I'll put one together for you.";
  // Every operator this pitch goes to already has an unclaimed page in the Outset catalog, and this email
  // names Outset without naming that page, so the way off it has to be in here: the outreach folder's own
  // rule is a one-click remove line on every send, and the listing pitch has carried one since it started.
  // Without it an owner who reads "I built Otto ... for operators like yours" and goes looking has no way out
  // that does not start with a reply.
  const remove = SITE + "#remove=" + catalogId(op.domain);
  const removeLine = "Already have a page on Outset you didn't ask for, or just don't want to be found here at all? This takes it down instantly:";
  const lines = [
    hi, "", who, "",
    hear, "", OTTO, "",
    staff, "", vendor, "",
    setup, "", ask, "",
    "Best,", "", "Harshil",
    "", removeLine, remove,
  ].filter((l) => l !== null) as string[];
  const paras = [
    "<p>" + esc(hi) + "</p>",
    "<p>" + esc(who) + "</p>",
    "<p>" + esc(hear) + "<br>" + link(OTTO, "Hear the 42-second recording") + "</p>",
    "<p>" + esc(staff) + "</p>",
    "<p>" + esc(vendor) + "</p>",
    "<p>" + esc(setup) + "</p>",
    "<p>" + askHtml + "</p>",
    "<p>Best,<br>Harshil</p>",
    '<p style="font-size:13px;color:#666">' + esc(removeLine) + " " + link(remove, "take it down") + ".</p>",
  ];
  const footer = brandFooter(to);
  lines.push(...footer.lines);
  paras.push(footer.html);
  return {
    subject,
    body: lines.join("\n"),
    html: '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#222">' + paras.join("") + "</div>",
    variant,
  };
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
 * listing pitch's photo/price completeness bar. Open to every family, not just `water`, as of 30 September
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
