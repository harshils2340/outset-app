import "../src/env.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, nowIso } from "../src/db/client.ts";
import { emailHash, loadSuppression, mailPostal, unsubPageUrl } from "../src/lib/unsub.ts";
import { isDeliverable } from "../src/outreach/deliverable.ts";
import { draftOttoCopy } from "../src/outreach/ottoDrafts.ts";
import { CALL_LINK, catalogId } from "../src/outreach/drafts.ts";
import { ownerFacts } from "../src/outreach/owner.ts";
import { ownerFirstName } from "../src/outreach/address.ts";
import { ottoQueue } from "../src/outreach/sendOtto.ts";
import { outreachBlockers } from "../src/outreach/guards.ts";
import { recordTouch } from "../src/outreach/touches.ts";

/**
 * The Otto queue as a lead file for a cold-email platform (Instantly, Smartlead, lemlist: any tool that takes a
 * CSV with custom variables and rotates warmed mailboxes). One personal Gmail tops out near 50 a day; Harshil
 * wants 200 (26 September 2026: "i need to use some AI GTM to do this and get like 200 a day"), which is
 * five or six warmed mailboxes on two or three throwaway domains, sent through such a tool. See docs/GTM.md.
 *
 *   npx tsx scripts/outreach-gtm-export.mts --limit=1000
 *   npx tsx scripts/outreach-gtm-export.mts --limit=20 --dry
 *
 * Every step of the sequence is rendered here, per lead, with the same footer the daily ramp sends (Terms,
 * Privacy, our unsubscribe link, postal address), so the platform's template for each step is just one
 * variable: {{body_html}}, {{followup_1_html}}, {{followup_2_html}}. Nothing about the copy is left to the
 * tool, and no step can go out without the way off.
 *
 * Same queue, same order and same skips as the ramp (unsubscribed, junk addresses, domains with no mail).
 * Exported rows are marked 'handoff', which both send paths exclude, so the platform and the ramp never mail
 * one business twice. --dry writes the file and marks nothing. Replies and unsubscribes come back through
 * scripts/outreach-gtm-import.mts.
 */
const arg = (k: string) => process.argv.find((a) => a.startsWith("--" + k + "="))?.split("=").slice(1).join("=");
const limit = Number(arg("limit") || 1000);
const dry = process.argv.includes("--dry");

const suppression = await loadSuppression();
const blocked = suppression.hashes;
const blockers = outreachBlockers({
  claimSecret: process.env.CLAIM_SECRET || "",
  mailFrom: process.env.MAIL_FROM || "",
  postal: mailPostal(),
  unsubUrl: unsubPageUrl("owner@example.com"),
  suppression,
});
for (const b of blockers) console.error("gtm export: " + b);
if (!dry && blockers.length) {
  console.error("gtm export: nothing exported, nothing marked. Fix the above, or pass --dry to see the batch anyway.");
  process.exit(1);
}

const SITE = "https://onoutset.com/";
const OTTO = SITE + "#call";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function link(href: string, label: string): string {
  return '<a href="' + esc(href) + '">' + esc(label) + "</a>";
}

/** The footer exactly as the first email carries it, lifted from the rendered copy so the two can never drift. */
function footers(copy: { body: string; html: string }): { html: string; text: string } {
  const h = copy.html.indexOf('<p style="margin-top:24px');
  const t = copy.body.indexOf("\nOutset. ");
  if (h < 0 || t < 0) throw new Error("the rendered pitch has no footer; refusing to build follow-ups without one");
  return { html: copy.html.slice(h).replace(/<\/div>$/, ""), text: copy.body.slice(t) };
}

/**
 * Two follow-ups in the same voice as the pitch Harshil approved. Short, one ask each, the same two doors
 * (hear the call, book a call), and the last one says it is the last. Both go out only as steps of the
 * sequence in the platform, after the pitch, and stop the moment the lead replies.
 */
function followUps(hi: string, name: string, foot: { html: string; text: string }): { f1h: string; f1t: string; f2h: string; f2t: string } {
  const wrap = (paras: string[]) => '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#222">' + paras.join("") + foot.html + "</div>";
  const f1 = {
    a: "Quick one: did you get a chance to hear the sample call?",
    b: "If " + name + " misses calls while you're on the water, that is the gap Otto closes: it answers, books the guest in, and emails you a summary.",
    c: "Happy to set it up with you in a day, free until it proves its value. ",
    cl: "Grab a time that suits you",
  };
  const f2 = {
    a: "Last note from me. If the phone is already handled at " + name + ", no worries at all, and thanks for reading.",
    b: "If it isn't, the offer stands: Otto set up with you in a day, free until it proves its value on your real line. ",
    bl: "Pick any 15 minutes",
  };
  return {
    f1h: wrap(["<p>" + esc(hi) + "</p>", "<p>" + esc(f1.a) + "<br>" + link(OTTO, "Hear the sample call") + "</p>", "<p>" + esc(f1.b) + "</p>", "<p>" + esc(f1.c) + link(CALL_LINK, f1.cl) + ".</p>", "<p>Best,<br>Harshil</p>"]),
    f1t: [hi, "", f1.a, OTTO, "", f1.b, "", f1.c + f1.cl + ":", CALL_LINK, "", "Best,", "", "Harshil"].join("\n") + "\n" + foot.text,
    f2h: wrap(["<p>" + esc(hi) + "</p>", "<p>" + esc(f2.a) + "</p>", "<p>" + esc(f2.b) + link(CALL_LINK, f2.bl) + ".</p>", "<p>Best,<br>Harshil</p>"]),
    f2t: [hi, "", f2.a, "", f2.b + f2.bl + ":", CALL_LINK, "", "Best,", "", "Harshil"].join("\n") + "\n" + foot.text,
  };
}

const rows = ottoQueue(limit * 2);
type Lead = Record<string, string> & { draftId: string };
const leads: Lead[] = [];
const seen = new Set<string>();
let dead = 0;
for (const r of rows) {
  if (leads.length >= limit) break;
  const email = r.to_email.trim().toLowerCase();
  if (seen.has(email) || /noreply|no-reply|donotreply|example\.com|sentry|wixpress|godaddy/.test(email) || blocked.has(emailHash(email))) continue;
  seen.add(email);
  if (!(await isDeliverable(email))) {
    dead++;
    continue;
  }
  const copy = draftOttoCopy(r, email);
  const first = ownerFirstName(email, ownerFacts(r.id).names) || "";
  const hi = first ? "Hi " + first + "," : "Hi,";
  const fu = followUps(hi, r.name, footers(copy));
  leads.push({
    email,
    first_name: first,
    last_name: "",
    company_name: r.name,
    website: r.website || "https://" + r.domain + "/",
    phone: r.phone || "",
    city: r.city || "",
    region: r.region || "",
    booking_software: r.calendar_vendor || "",
    subject: copy.subject,
    body_html: copy.html,
    body_text: copy.body,
    followup_1_html: fu.f1h,
    followup_1_text: fu.f1t,
    followup_2_html: fu.f2h,
    followup_2_text: fu.f2t,
    otto_url: OTTO,
    cal_url: CALL_LINK,
    unsubscribe_url: unsubPageUrl(email),
    remove_url: SITE + "activities#remove=" + catalogId(r.domain),
    draftId: r.id,
  });
}

const cols = [
  "email", "first_name", "last_name", "company_name", "website", "phone", "city", "region", "booking_software",
  "subject", "body_html", "body_text", "followup_1_html", "followup_1_text", "followup_2_html", "followup_2_text",
  "otto_url", "cal_url", "unsubscribe_url", "remove_url",
];
const cell = (v: string) => '"' + (v || "").replace(/"/g, '""') + '"';
const csv = [cols.join(","), ...leads.map((l) => cols.map((c) => cell(l[c])).join(","))].join("\r\n") + "\r\n";
const day = nowIso().slice(0, 10);
const dir = join(dirname(fileURLToPath(import.meta.url)), "../data/exports");
mkdirSync(dir, { recursive: true });
const file = join(dir, "otto-gtm-" + day + (dry ? "-dry" : "") + ".csv");
writeFileSync(file, csv);
const named = leads.filter((l) => l.first_name).length;
console.log(`gtm export: ${leads.length} leads written to ${file} (${named} greeted by first name, ${dead} skipped: domain takes no mail)`);

if (dry) {
  console.log("dry run: nothing marked");
  process.exit(0);
}
const mark = db.prepare("UPDATE outreach_drafts SET status = 'handoff', subject = ?, body = ?, created_at = ? WHERE id = ?");
db.exec("BEGIN IMMEDIATE");
for (const l of leads) mark.run(l.subject, l.body_text, nowIso(), l.draftId);
// The shared record too (touches.ts), so a sender anywhere else (the cloud run) never mails these businesses.
const opOf = db.prepare("SELECT operator_id FROM outreach_drafts WHERE id = ?");
for (const l of leads) {
  const row = opOf.get(l.draftId) as { operator_id: string } | undefined;
  if (row) await recordTouch({ operatorId: row.operator_id, email: l.email, status: "handoff" }).catch((e) => console.error("shared record: " + (e as Error).message));
}
db.exec("COMMIT");
console.log(`${leads.length} rows marked handoff: the daily ramp will not mail them; the platform owns them now`);
process.exit(0);
