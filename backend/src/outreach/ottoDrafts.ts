import { randomUUID } from "node:crypto";
import { vendorLabel } from "./drafts.ts";
import { mailPostal, unsubPageUrl } from "../lib/unsub.ts";
import { outreachAddress } from "./address.ts";
import { db, nowIso } from "../db/client.ts";

/**
 * The pitch for Otto, the AI phone front desk (public/otto.html), not the "claim your free listing" email in
 * drafts.ts. Different product, different offer, so it stays a separate draft function rather than a branch
 * inside draftCopy: the two must never be sent to the same address inside the same week, and keeping them
 * apart makes that easy to enforce at send time instead of by reading a diff.
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
 * subject) and by booking vendor (vendorLine, generic when none is on file). The footer (unsubscribe, terms,
 * postal address) is not part of what he approved or edited; it stays because backend/src/outreach/AGENTS.md
 * requires it on every send regardless of what the persuasive copy says.
 */
export function draftOttoCopy(op: OttoOp, email?: string): { subject: string; body: string; html: string } {
  const to = (email || "").trim().toLowerCase();
  const SITE = "https://onoutset.com/";
  const OTTO = SITE + "otto";
  const CAL = "https://cal.com/harshil-shah-7tkvs7/outset";
  const TERMS = SITE + "terms.html";
  const PRIVACY = SITE + "privacy.html";
  const subject = "Who answers " + op.name + "'s phone after you close?";
  const who = "I'm Harshil. I built Otto, an AI phone assistant for local activity operators like " + op.name + " that answers calls when you're busy or closed, takes bookings, and emails you a summary.";
  const hear = "Before anything else, give this 43-second recording a listen to hear how it handles a real caller:";
  const staff = "Most operators use it so staff can stay focused on guests in person, while catching calls after hours that used to go to voicemail.";
  const vendor = vendorLine(op.calendar_vendor);
  const guarantee = "I can set it up with you in a day, free until it proves its value on your real line.";
  const cta = "Give the demo a quick listen, and if it's not a fit, even a one-line reply on why helps a lot.";
  const lines = [
    "Hi,", "", who, "",
    hear, "", OTTO, "",
    staff, "", vendor, "",
    guarantee, "",
    cta, "",
    "Best,", "", "Harshil",
  ].filter((l) => l !== null) as string[];
  const paras = [
    "<p>Hi,</p>",
    "<p>" + esc(who) + "</p>",
    "<p>" + esc(hear) + "<br>" + link(OTTO, "Hear the 43-second recording") + "</p>",
    "<p>" + esc(staff) + "</p>",
    "<p>" + esc(vendor) + "</p>",
    "<p>" + esc(guarantee) + "</p>",
    "<p>" + esc(cta) + "</p>",
    "<p>Best,<br>Harshil</p>",
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
