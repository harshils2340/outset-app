/**
 * Harshil's leads sheet, from the command line: the people he has personally contacted and when to call back.
 *
 * The sheet is a Google Sheet he owns. Its brain is the Apps Script in docs/leads-sheet.gs, deployed as a web
 * app; this talks to that door, so a Claude session (or the backend) can read the sheet and add or update a
 * row without Google credentials. Needs LEADS_SHEET_URL (the /exec URL) and LEADS_SHEET_SECRET in backend/.env.
 *
 *   npx tsx scripts/leads.mts list
 *   npx tsx scripts/leads.mts due
 *   npx tsx scripts/leads.mts add --business "Dixie Belle" --person Keith --phone "+1 928 486 5894" \
 *       --email keith@dixiebellelhc.com --city "Lake Havasu City, AZ" --status Replied \
 *       --follow-up 2027-01-05 --note "Said to reach out in a year. Follow up in January."
 *
 * `add` on a phone or email already in the sheet appends the note to that row and moves its dates, so the
 * same person is never listed twice. Follow-up dates are the ones Harshil names; nothing here invents one.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../backend/.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const URL_ = (process.env.LEADS_SHEET_URL || "").trim();
const SECRET = (process.env.LEADS_SHEET_SECRET || "").trim();
if (!URL_ || !SECRET) {
  console.error("Set LEADS_SHEET_URL and LEADS_SHEET_SECRET in backend/.env (see docs/leads-sheet.gs).");
  process.exit(1);
}

type Lead = { row: number; business: string; person: string; phone: string; email: string; city: string; status: string; lastContact: string; followUp: string; notes: string };

const [cmd = "list", ...rest] = process.argv.slice(2);
const flag = (k: string) => {
  const i = rest.indexOf("--" + k);
  return i >= 0 ? rest[i + 1] ?? "" : "";
};

async function read(): Promise<Lead[]> {
  const r = await fetch(URL_ + "?secret=" + encodeURIComponent(SECRET), { redirect: "follow", signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok || text === "no") throw new Error("the sheet refused the read (" + r.status + "): check LEADS_SHEET_SECRET");
  return JSON.parse(text) as Lead[];
}

function print(rows: Lead[]): void {
  if (!rows.length) return console.log("(nothing)");
  for (const l of rows) {
    const who = [l.person, l.phone, l.email].filter(Boolean).join(" · ");
    console.log((l.followUp || "no date") + "  " + (l.business || l.person) + (who ? "  (" + who + ")" : "") + "  [" + l.status + "]");
    if (l.notes) console.log("            " + String(l.notes).slice(0, 200));
  }
}

if (cmd === "list") {
  print((await read()).sort((a, b) => (a.followUp || "9999").localeCompare(b.followUp || "9999")));
} else if (cmd === "due") {
  const today = new Date().toISOString().slice(0, 10);
  const done = new Set(["Customer", "No", "Not now"]);
  print((await read()).filter((l) => l.followUp && l.followUp <= today && !done.has(l.status)));
} else if (cmd === "add") {
  const body = {
    secret: SECRET,
    business: flag("business"), person: flag("person"), phone: flag("phone"), email: flag("email"), city: flag("city"),
    status: flag("status") || "Contacted", notes: flag("note"), followUp: flag("follow-up") || undefined,
  };
  if (!body.business && !body.person) {
    console.error("give at least --business or --person");
    process.exit(1);
  }
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body), redirect: "follow", signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok || text.trim() !== "ok") throw new Error("the sheet refused the write (" + r.status + "): " + text.slice(0, 120));
  console.log("saved: " + (body.business || body.person) + (body.followUp ? ", follow up " + body.followUp : ""));
} else {
  console.error("commands: list, due, add");
  process.exit(1);
}
