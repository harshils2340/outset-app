import "../src/env.ts";
import { readFileSync } from "node:fs";
import { db, nowIso } from "../src/db/client.ts";
import { recordUnsub } from "../src/lib/unsub.ts";
import { recordTouch } from "../src/outreach/touches.ts";

/**
 * What came back from the cold-email platform, folded into our own records, so a business that answered,
 * bounced or asked to stop is never touched again from anywhere: not by the platform's next campaign (we
 * export from the same queue), not by the daily ramp, and not by a claim email either when they asked to stop.
 *
 *   npx tsx scripts/outreach-gtm-import.mts --file=~/Downloads/instantly-leads.csv
 *   npx tsx scripts/outreach-gtm-import.mts --file=unsubscribed.csv --all=unsub
 *   npx tsx scripts/outreach-gtm-import.mts --file=bounced.csv --all=bounce
 *
 * Every platform names its columns differently, so this reads the row, not the header: an email column plus
 * any column whose cell says unsubscribed / not interested / stop, bounced / invalid, or replied / interested /
 * meeting. `--all=unsub|bounce|replied` treats every row in the file as that outcome, for a platform's own
 * filtered export. Only the outcome is stored, never the reply text.
 *
 * Outcomes:
 *   unsub   -> the address goes on the suppression list (the one the ramps, the API and the claim mail read)
 *              and its drafts become 'unsubscribed'
 *   bounce  -> suppression list with reason 'bounce', drafts become 'failed'
 *   replied -> drafts become 'replied', which both queues treat like 'handoff': no further automated touch,
 *              the conversation is Harshil's now. Not suppressed, so a real reply from him still goes through.
 */
const arg = (k: string) => process.argv.find((a) => a.startsWith("--" + k + "="))?.split("=").slice(1).join("=");
const file = (arg("file") || "").replace(/^~/, process.env.HOME || "");
const all = arg("all") as "unsub" | "bounce" | "replied" | undefined;
if (!file) throw new Error("--file=<csv from the platform> is required");
if (all && !["unsub", "bounce", "replied"].includes(all)) throw new Error("--all must be unsub, bounce or replied");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const rows = parseCsv(readFileSync(file, "utf8"));
const header = rows[0].map((h) => h.trim().toLowerCase());
const emailCol = header.findIndex((h) => h === "email" || h === "email address" || h === "lead email" || h === "to_email");
if (emailCol < 0) throw new Error("no email column in " + file + " (headers: " + header.join(", ") + ")");

const UNSUB = /unsub|not interested|do not contact|don't contact|stop|remove me|opt.?out|wrong person/i;
const BOUNCE = /bounce|invalid|undeliverable|no such/i;
const REPLIED = /repl(y|ied)|interested|meeting|booked|call back|responded/i;

function outcomeOf(row: string[]): "unsub" | "bounce" | "replied" | null {
  if (all) return all;
  const cells = row.filter((_, i) => i !== emailCol).join(" | ");
  if (UNSUB.test(cells)) return "unsub";
  if (BOUNCE.test(cells)) return "bounce";
  if (REPLIED.test(cells)) return "replied";
  return null;
}

const setStatus = db.prepare("UPDATE outreach_drafts SET status = ?, created_at = ? WHERE lower(to_email) = ? AND status IN ('draft', 'handoff', 'sent')");
const opsOf = db.prepare("SELECT DISTINCT operator_id FROM outreach_drafts WHERE lower(to_email) = ?");
const share = async (email: string, status: "replied" | "bounce" | "failed") => {
  for (const r of opsOf.all(email) as { operator_id: string }[]) await recordTouch({ operatorId: r.operator_id, email, status }).catch(() => undefined);
};
const counts = { unsub: 0, bounce: 0, replied: 0, untouched: 0 };
for (const row of rows.slice(1)) {
  const email = (row[emailCol] || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) continue;
  const outcome = outcomeOf(row);
  if (!outcome) {
    counts.untouched++;
    continue;
  }
  if (outcome === "unsub") {
    await recordUnsub(email, "unsubscribe");
    setStatus.run("unsubscribed", nowIso(), email);
    await share(email, "failed");
  } else if (outcome === "bounce") {
    await recordUnsub(email, "bounce");
    setStatus.run("failed", nowIso(), email);
    await share(email, "bounce");
  } else {
    setStatus.run("replied", nowIso(), email);
    await share(email, "replied");
  }
  counts[outcome]++;
}
console.log("gtm import: " + JSON.stringify(counts));
process.exit(0);
