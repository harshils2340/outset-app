import "../src/env.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, nowIso } from "../src/db/client.ts";
import { sendMail } from "../src/lib/mail.ts";
import { emailHash, loadSuppression, unsubPageUrl } from "../src/lib/unsub.ts";
import { isDeliverable } from "../src/outreach/deliverable.ts";
import { draftOttoCopy } from "../src/outreach/ottoDrafts.ts";
import { composeOutreach } from "../src/outreach/drafts.ts";
import { listingQueue, operatorOf, type ListingRow } from "../src/outreach/send.ts";
import { ottoQueue } from "../src/outreach/sendOtto.ts";
import { outreachBlockers } from "../src/outreach/guards.ts";
import { mailPostal } from "../src/lib/unsub.ts";

/**
 * Hands a slice of an outreach queue to a person who will send it by hand from their own mailbox, so the
 * campaign can run in parallel to the daily ramp without one Gmail identity carrying all the volume
 * (Harshil, 25 September 2026: "a couple hundred to a friend who can do this in parallel to avoid spam").
 *
 *   npx tsx scripts/outreach-handoff.mts --kind=otto --limit=250 --to=founder@example.com
 *   npx tsx scripts/outreach-handoff.mts --kind=listing --limit=100 --dry
 *
 * What it does, in order:
 *   0. Runs the same pre-send checks the daily ramps run (guards.ts) and refuses outright if any of them
 *      stands, because a row in this file is a real email to a real business, sent by hand.
 *   1. Takes the next rows the ramp itself would send (same query, same order, same skips: unsubscribed,
 *      junk addresses, domains with no mail).
 *   2. Composes each mail fresh, so the CSV carries today's copy with the footer every send needs
 *      (unsubscribe link, terms, postal address). The sender must not edit the footer.
 *   3. Writes backend/data/exports/<kind>-handoff-<date>.csv (gitignored) and, with --to, emails it as an
 *      attachment through the outreach mailbox to the founder, never to anyone else.
 *   4. Marks every exported row status = 'handoff'. Both send paths skip a handed-off address, whichever
 *      campaign it came from, so nobody gets our mail twice or both pitches in one week. --dry skips this
 *      and the email.
 *
 * Re-running never exports the same address again: a 'handoff' row is excluded by the same queue query.
 */
const arg = (k: string) => process.argv.find((a) => a.startsWith("--" + k + "="))?.split("=").slice(1).join("=");
const kind = (arg("kind") || "otto") as "otto" | "listing";
const limit = Number(arg("limit") || 250);
const to = arg("to");
const dry = process.argv.includes("--dry");
if (kind !== "otto" && kind !== "listing") throw new Error("--kind must be otto or listing");

const suppression = await loadSuppression();
const blocked = suppression.hashes;
// The same five checks the two send paths run, for the same reason: this file is mail. A row exported here
// is copied into somebody's mailbox and sent by hand, so a suppression list nobody could read, an
// unsubscribe link signed with a secret the API has never seen, or a footer with no postal address reaches a
// real business exactly as it would through sendOutreach. A dry run prints them and carries on, because
// printing is the point of a dry run; anything that writes the file, marks the queue or mails the CSV stops.
const blockers = outreachBlockers({
  claimSecret: process.env.CLAIM_SECRET || "",
  mailFrom: process.env.MAIL_FROM || "",
  postal: mailPostal(),
  unsubUrl: unsubPageUrl("owner@example.com"),
  suppression,
});
for (const b of blockers) console.error("outreach handoff: " + b);
if (!dry && blockers.length) {
  console.error("handoff: nothing exported, nothing marked, nothing emailed. Fix the above, or pass --dry to see the batch anyway.");
  process.exit(1);
}
// Over-fetch: some rows drop out (unsubscribed since drafting, dead domains), and the file should still be full.
const rows = kind === "otto" ? ottoQueue(limit * 2) : listingQueue(limit * 2, {});

type Row = {
  business: string; website: string; email: string; phone: string; city: string; region: string; booking_software: string;
  subject: string; body_text: string; body_html: string; unsubscribe_url: string; draftId: string;
};
const out: Row[] = [];
const seen = new Set<string>();
let dead = 0;
for (const r of rows) {
  if (out.length >= limit) break;
  const email = r.to_email.trim().toLowerCase();
  if (seen.has(email) || /noreply|no-reply|donotreply|example\.com|sentry|wixpress|godaddy/.test(email) || blocked.has(emailHash(email))) continue;
  seen.add(email);
  if (!(await isDeliverable(email))) {
    dead++;
    continue;
  }
  // A listing row carries the draft's id and the operator's separately; the copy is written from the operator.
  const copy = kind === "otto" ? draftOttoCopy(r, email) : composeOutreach(operatorOf(r as ListingRow), email);
  out.push({
    business: r.name,
    website: r.website || "https://" + r.domain + "/",
    email,
    phone: r.phone || "",
    city: r.city || "",
    region: r.region || "",
    booking_software: r.calendar_vendor || "",
    subject: copy.subject,
    body_text: copy.body,
    body_html: copy.html,
    unsubscribe_url: unsubPageUrl(email),
    draftId: r.id,
  });
}

const csvCell = (v: string) => '"' + v.replace(/"/g, '""') + '"';
const cols = ["business", "website", "email", "phone", "city", "region", "booking_software", "subject", "body_text", "body_html", "unsubscribe_url"] as const;
const csv = [cols.join(","), ...out.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
const day = nowIso().slice(0, 10);
const dir = join(dirname(fileURLToPath(import.meta.url)), "../data/exports");
mkdirSync(dir, { recursive: true });
const file = join(dir, kind + "-handoff-" + day + ".csv");
writeFileSync(file, csv);

const byRegion = new Map<string, number>();
for (const r of out) byRegion.set(r.region || "?", (byRegion.get(r.region || "?") || 0) + 1);
const regions = [...byRegion.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + " " + n).join(", ");
console.log(`${kind}: ${out.length} rows written to ${file} (${dead} skipped, domain takes no mail). By region: ${regions}`);

if (dry) {
  console.log("dry run: nothing marked, nothing emailed");
  process.exit(0);
}

const mark = db.prepare("UPDATE outreach_drafts SET status = 'handoff', subject = ?, body = ?, created_at = ? WHERE id = ?");
db.exec("BEGIN IMMEDIATE");
for (const r of out) mark.run(r.subject, r.body_text, nowIso(), r.draftId);
db.exec("COMMIT");
console.log(`${out.length} rows marked handoff: the daily ramps will not mail them`);

if (to) {
  const pitch = kind === "otto" ? "Otto (AI front desk) pitch to water operators" : "free listing page pitch";
  const text = [
    `Attached: ${out.length} ${kind} outreach targets, the ${pitch}, exported ${day}.`,
    "",
    "One row per business. Columns: business, website, email, phone, city, region, booking_software, subject, body_text, body_html, unsubscribe_url.",
    "",
    "How to send them:",
    "- One email per row: the subject column as the subject, body_html as the message (body_text if the mail app cannot take HTML).",
    "- Every body ends with the footer (Terms, Privacy, Unsubscribe, postal address). Leave it exactly as it is; it is what makes the mail legal to send.",
    "- The copy is written in Harshil's voice, so set the reply-to (or the from name) to Harshil so replies reach him.",
    "- Weekdays only, a few dozen a day from one mailbox, never the same address twice.",
    "- These rows are now excluded from Outset's own daily sends, so nobody hears from us twice.",
    "",
    "By region: " + regions + ".",
  ].join("\n");
  const r = await sendMail({
    to,
    subject: `Outset outreach handoff: ${out.length} ${kind} targets (${day})`,
    text,
    commercial: true,
    attachments: [{ filename: kind + "-handoff-" + day + ".csv", content: Buffer.from(csv), contentType: "text/csv" }],
  });
  console.log(r.sent ? "emailed " + to + " " + r.id : "email not sent: " + r.error);
}
process.exit(0);
