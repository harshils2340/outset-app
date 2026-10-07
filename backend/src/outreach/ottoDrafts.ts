import { randomUUID } from "node:crypto";
import { LIVE_CALENDAR, vendorLabel } from "./drafts.ts";
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
  // Harshil, 2 October 2026: say it answers only from the business's own info and terms, so an owner knows it
  // never makes things up. "What's actually open" is said only where Otto really reads the calendar.
  if (live(id))
    return "It picks up those calls, connects directly with " + yourSystem(id) + ", and answers only from your own company info and terms, so it never makes anything up. It tells the caller what's actually open and sends them the link to book that exact slot.";
  return "It picks up those calls, connects directly with " + yourSystem(id) + ", and answers only from your own company info, prices and terms, so it never makes anything up, then takes the booking down for you.";
}

const live = (id: string | null | undefined): boolean => !!id && LIVE_CALENDAR.has(id) && !!vendorLabel(id);

/**
 * "We connect directly with your booking / reservation system" (Harshil, 7 October 2026). Named only where the
 * catalog knows the vendor and Otto reads its calendar live (FareHarbor, Peek, Xola); everywhere else it is the
 * owner's system in general words, which setup connects by hand.
 */
function yourSystem(id: string | null | undefined): string {
  return live(id) ? "your " + vendorLabel(id) + " booking system" : "your booking or reservation system";
}

/**
 * The business's name as an owner would say it in a sentence: no ", LLC" or " Inc." on the end, which reads as
 * pulled from a registry rather than written by a person.
 *
 * "Co" is not one of them, and was. It is the shop's own word rather than its entity type: 435 of the shipped
 * names end in " Co" or " Co." and they are "Barrio Brewing Co", "Hanalei Surf Co.", "Trinity River Kayak
 * Co." and "The Salty Dog Sailing Co.", which is what is on the sign. Cutting it wrote "Missed calls at
 * Hanalei Surf" and "Can I set it up for Trinity River Kayak?", and on the seven names written "& Co." or
 * "and Co." it left the connector hanging: "who picks up the phone at Sikkema Jenkins &?". The 1,013 names
 * ending in " Company" were kept whole all along, so the cut disagreed with itself on the same word.
 */
export function plainName(name: string): string {
  const n = name.trim().replace(/,?\s+(llc|l\.l\.c\.|inc|incorporated|ltd|limited|corp)\.?$/i, "").trim();
  return n || name.trim();
}

/**
 * Which copy a send carried, stored on outreach_sends.variant (touches.ts) so replies can be read against the
 * version that earned them. Bump it whenever the body changes.
 */
// 2026-10-03: the product is named Outset in the body ("I built Outset"); Otto stays the assistant's name on calls.
// 2026-10-05: first line by kind of business, "Can I set it up for X? ... It's free", recording merged into the
// pitch paragraph. Gmail filed it under Promotions (3 of 3 on the 5 October canary, batch held).
// 2026-10-07: every rung says it "connects directly with" the owner's booking or reservation system (Harshil), by
// name where Otto reads that vendor's calendar live. Placement-tested beside 2026-10-06 before it shipped.
// 2026-10-06: back to the 10-02 body, which a side-by-side test on 5 October still put in Primary 3 of 3 while the
// 10-05 body went to Promotions in every variant tried (the old offer, no "Founder" line, the old pitch
// paragraph, the old sign-off: each still Promotions on at least two of three). The trigger was the opening
// and the pitch wording, not HTML (plain text did the same), the links or the sign-off. The take-down line is
// gone from every email (Harshil, 5 October 2026: "remove this from emails"); the unsubscribe link, the
// reply-"no" opt-out and the postal address stay.
export const COPY_VERSION = "2026-10-07";

/**
 * The pitch in decreasing length, all of it approved wording. The daily run (scripts/otto-cloud.mts) tests every
 * rung between the sending inboxes and sends with the first one Gmail puts in Primary, so a copy that drifts into
 * Promotions falls back on its own instead of holding the batch. Never generated text: only these.
 *
 *   ask     no link at all: the question, one line on what it is, and "can I send you the recording?", modeled on a
 *           cold note Harshil found worked on him (5 October 2026). Its stop is a reply, not a link.
 *   full    the 10-02 note: question, pain, what it does, the 40-second recording, the free offer
 *   nolink  the same without the recording paragraph (one link fewer)
 *   min     three sentences and the sign-off
 */
export type CopyStyle = "ask" | "full" | "nolink" | "min" | "forgot";
export const COPY_LADDER: { style: CopyStyle; version: string }[] = [
  { style: "ask", version: COPY_VERSION + "-ask" },
  { style: "full", version: COPY_VERSION },
  { style: "nolink", version: COPY_VERSION + "-nolink" },
  { style: "min", version: COPY_VERSION + "-min" },
];

/**
 * The A/B/C test, first emails from 7 October 2026 (Harshil: "A/B/C test this for a week"). Each arm is a first
 * email and the follow-up that goes with it:
 *
 *   A  full    the full pitch with the recording link, then the "free test line" follow-up three days later
 *   B  ask     no link, "Can I send you a 40-second recording?", then a follow-up that sends it three days later
 *   C  forgot  the full pitch without the recording paragraph, then the next day "Shoot, forgot to put this in
 *              my last email" with the link: the Ramp sequence from George Jefferson's LinkedIn post (6 October
 *              2026), a slip-up on purpose so the sequence reads as a person. Claude advised against faking a
 *              mistake to small owners; Harshil chose to measure it.
 *
 * "forgot" is an arm, not a fallback rung: its first email is the nolink body, so its placement is nolink's.
 */
export const FORGOT_VERSION = COPY_VERSION + "-forgot";
export const ARMS: CopyStyle[] = ["full", "ask", "forgot"];

/**
 * The 2 October 2026 pitch. 596 sends of the 1 October copy earned one human reply, and a placement test
 * between the three sending inboxes showed why: Gmail filed it under Promotions every time, with or without
 * the logo, the footer, the links or the HTML. The long, salesy wording was the trigger. A short note that
 * opens on a question landed in Primary in every inbox, and this is that note.
 *
 * Keep it short and personal. Every paragraph added, every extra link and every marketing phrase is a step
 * back toward the Promotions tab, and the 5 October canary proved a reworded opening alone can do it. Change
 * the wording only with a placement test of the new copy beside this one (placementMatrix in placement.ts).
 */
export function draftOttoCopy(op: OttoOp, email?: string, opts?: { greet?: string | null; style?: CopyStyle }): { subject: string; body: string; html: string; variant: string } {
  const to = (email || "").trim().toLowerCase();
  const style: CopyStyle = opts?.style || "full";
  const variant = style === "forgot" ? FORGOT_VERSION : COPY_LADDER.find((r) => r.style === style)!.version;
  // "Hi Ron," only when the shop's own site names Ron as the owner and the mailbox is his by that same word
  // (owner.ts, from the owners crawl's facts): never a guessed first name, which is the one mistake an owner
  // cannot miss. A caller with no catalog at hand (the cloud sender, from the published pool) passes the name
  // that was found for it, or null for "Hi,".
  const hi = opts && "greet" in opts ? (opts.greet ? "Hi " + opts.greet + "," : "Hi,") : to ? greeting(op, to) : "Hi,";
  const OTTO = "https://onoutset.com/otto";
  const name = plainName(op.name);
  const subject = "Missed calls at " + name;
  const question = "When everyone at " + name + " is busy with guests or you've closed for the day, where do the calls go?";
  const pain = "For most operators it's voicemail, and the caller hangs up and books with the next place that picks up.";
  const what = "I built Outset, a 24/7 customer service line for your phone. " + whatOttoDoes(op.calendar_vendor) + " You get a summary of every call.";
  const hearText = "Here's a 40-second recording of it on a real call: " + OTTO;
  const hearHtml = "Here's a 40-second recording of it on a real call: " + link(OTTO, "give it a listen");
  const offer = "I'll set it up on your line for free, and you only keep it if it books you a guest. Worth a quick reply?";
  const minWhat = "I built Outset, a 24/7 customer service line that picks up when your team can't, connects directly with " + yourSystem(op.calendar_vendor) + ", and answers only from your own info.";
  const minOffer = "I'll set it up for " + name + " for free. Worth a quick reply?";
  if (style === "ask") {
    const pitch = "I built Outset, a 24/7 customer service line that picks up those calls, connects directly with " + yourSystem(op.calendar_vendor) + ", and answers only from your own info.";
    const ask = "Can I send you a 40-second recording of it on a real call?";
    const sig = askSignOff();
    const body = [hi, "", question, "", pitch + " " + ask, "", ...sig.lines].join("\n");
    const html = '<div dir="ltr"><p>' + esc(hi) + "</p><p>" + esc(question) + "</p><p>" + esc(pitch + " " + ask) + "</p>" + sig.html + "</div>";
    return { subject, body, html, variant };
  }
  const paras: { text: string; html: string }[] =
    style === "min" ? [{ text: question, html: esc(question) }, { text: minWhat, html: esc(minWhat) }, { text: minOffer, html: esc(minOffer) }]
    : [
      { text: question, html: esc(question) },
      { text: pain, html: esc(pain) },
      { text: what, html: esc(what) },
      ...(style === "full" ? [{ text: hearText, html: hearHtml }] : []),
      { text: offer, html: esc(offer) },
    ];
  const off = signOff(to);
  const body = [hi, "", ...paras.flatMap((p) => [p.text, ""]), ...off.lines].join("\n");
  const html = '<div dir="ltr"><p>' + esc(hi) + "</p>" + paras.map((p) => "<p>" + p.html + "</p>").join("") + off.html + "</div>";
  return { subject, body, html, variant };
}

/** The "ask" arm's sign-off: no link at all, the stop is a reply. Its follow-up ends the same way. */
function askSignOff(): { lines: string[]; html: string } {
  const postal = mailPostal();
  const sig = ["Harshil", "Founder, Outset" + (postal ? ", " + postal.replace(/^Outset,\s*/i, "") : "")];
  const ps = "PS. If you're not interested, just reply \"stop\" and I won't email you again.";
  return { lines: ["--", ...sig, "", ps], html: "<p>--<br>" + sig.map(esc).join("<br>") + "</p><p>" + esc(ps) + "</p>" };
}

/**
 * The sign-off every Otto mail ends with: who wrote it, the postal address CAN-SPAM and CASL require, and a way
 * to stop. No take-down line for the business's Outset listing (Harshil, 5 October 2026); a listing is still
 * removable from its own page.
 */
function signOff(to: string): { lines: string[]; html: string } {
  const SITE = "https://onoutset.com/";
  const stop = to ? unsubPageUrl(to) : SITE + "unsubscribe.html";
  const postal = mailPostal();
  const where = postal ? postal.replace(/^Outset,\s*/i, "") : "";
  return {
    lines: [
      "Harshil",
      "Founder, Outset",
      ...(where ? [where] : []),
      'Not a fit? Reply "no" and I won\'t email again, or unsubscribe: ' + stop,
    ],
    html: '<p style="color:#777">Harshil<br>Founder, Outset' + (where ? "<br>" + esc(where) : "") +
      "<br>Not a fit? Reply \"no\" and I won't email again, or " + link(stop, "unsubscribe") + ".</p>",
  };
}

/** The follow-ups' copy versions, stored on outreach_sends.variant like COPY_VERSION: one per arm. */
export const BUMP_VERSION = "bump-2026-10-05";
export const BUMP_ASK_VERSION = "bump-2026-10-07-ask";
export const BUMP_FORGOT_VERSION = "bump-2026-10-07-forgot";

/** Which arm a first email was, by the variant it was sent with. Anything before the test counts as A. */
export function armOf(firstVariant: string | null | undefined): "full" | "ask" | "forgot" {
  if (firstVariant?.endsWith("-forgot")) return "forgot";
  if (firstVariant?.endsWith("-ask")) return "ask";
  return "full";
}

/**
 * The one follow-up to a first email that drew no answer: a short note in the same thread ("Re:" the first
 * subject, sent as a reply to it from the same mailbox). Most cold-email replies come from the follow-up, not
 * the first note. What it says depends on the arm the first email was (ARMS above).
 */
export function draftOttoBump(op: OttoOp, email: string, opts: { greet?: string | null; subject: string; firstVariant?: string | null }): { subject: string; body: string; html: string; variant: string } {
  const to = (email || "").trim().toLowerCase();
  const hi = opts.greet ? "Hi " + opts.greet + "," : "Hi,";
  const subject = /^re:/i.test(opts.subject) ? opts.subject : "Re: " + opts.subject;
  const OTTO = "https://onoutset.com/otto";
  const name = plainName(op.name);
  const arm = armOf(opts.firstVariant);
  if (arm === "ask") {
    const hearText = "Here's the recording in case it's quicker than replying: " + OTTO + ". It's a real call, about 40 seconds.";
    const hearHtml = "Here's the recording in case it's quicker than replying: " + link(OTTO, "give it a listen") + ". It's a real call, about 40 seconds.";
    const offer = "If it'd help, I can set one up for " + name + " for free so you can call it yourself.";
    const sig = askSignOff();
    const body = [hi, "", hearText, "", offer, "", ...sig.lines].join("\n");
    const html = '<div dir="ltr"><p>' + esc(hi) + "</p><p>" + hearHtml + "</p><p>" + esc(offer) + "</p>" + sig.html + "</div>";
    return { subject, body, html, variant: BUMP_ASK_VERSION };
  }
  const off = signOff(to);
  if (arm === "forgot") {
    const lead = "Shoot, forgot to put this in my last email. Here's a 40-second recording of it on a real call: ";
    const body = [hi, "", lead + OTTO, "", ...off.lines].join("\n");
    const html = '<div dir="ltr"><p>' + esc(hi) + "</p><p>" + esc(lead) + link(OTTO, "give it a listen") + "</p>" + off.html + "</div>";
    return { subject, body, html, variant: BUMP_FORGOT_VERSION };
  }
  const ask = "Following up in case this got buried. Would it help if I set up a free test line for " + name +
    ", built from your own info, so you can call it and hear how it handles your callers?";
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
