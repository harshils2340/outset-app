import "../src/env.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, nowIso } from "../src/db/client.ts";
import { sendMail } from "../src/lib/mail.ts";
import { looksPersonal } from "../src/outreach/address.ts";

/**
 * The people behind the water operators, for reaching out by hand on LinkedIn (Harshil, 26 September 2026:
 * "a proper list of site managers or owners of these watersport places so I can directly reach out to them
 * on linkedin as well"). One row per person the owners crawl found on the operator's own site, with the
 * business, where it is, the person's title as the site gave it, their own mailbox and cell when the site
 * gave those, and a LinkedIn people search for the name plus the business, since the catalog holds no
 * LinkedIn profiles and none are guessed.
 *
 *   npx tsx scripts/owners-list.mts --to=founder@example.com
 *   npx tsx scripts/owners-list.mts --limit=500
 *
 * The crawl's name extraction is greedy, so this keeps only what reads as a person: two or three capitalised
 * words after any title, no business words, not the business's own name. "us and our (owner)", "Duck Diver
 * Marketing (owner)" and "the Powelson family (owner)" are what it drops. Nothing here changes the queue: a
 * LinkedIn message is Harshil's own touch, and the `emailed` column says whether the same business has
 * already had the pitch by mail so he can decide.
 */
const arg = (k: string) => process.argv.find((a) => a.startsWith("--" + k + "="))?.split("=").slice(1).join("=");
const to = arg("to");
const limit = Number(arg("limit") || 5000);

const TITLE = /^(capt|captain|cpt|dr|mr|mrs|ms|miss|chef|coach|rev|skipper)\.?$/i;
const SUFFIX = /^(sr|jr|ii|iii|iv)\.?$/i;
const NOT_A_PERSON = /\b(design|graphics|marketing|international|inc|llc|ltd|corp|company|co|family|team|local|group|rentals?|charters?|tours?|adventures?|cruises?|club|marina|resort|beach|lake|bay|sports?|watersports?|boats?|kayaks?|paddle|dive|scuba|surf|jet|ski|management|services?|solutions|media|studio|facilitators?|certified|lifetime|and|our|us|the|of|who|by)\b/i;

function personName(raw: string, business: string): { name: string; title: string } | null {
  const m = /^(.*?)\s*(?:\(([^)]*)\))?\s*$/.exec(raw.trim());
  if (!m) return null;
  const tokens = m[1].split(/\s+/).filter(Boolean);
  while (tokens.length && TITLE.test(tokens[0])) tokens.shift();
  const suffix = tokens.length && SUFFIX.test(tokens[tokens.length - 1]) ? tokens.pop() : "";
  if (tokens.length < 2 || tokens.length > 3) return null;
  for (const t of tokens) {
    if (!/^[A-Z][a-z'’-]+$|^[A-Z]\.$/.test(t)) return null;
  }
  const name = tokens.join(" ");
  if (NOT_A_PERSON.test(name)) return null;
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  if (flat(business).includes(flat(name))) return null;
  return { name: suffix ? name + " " + suffix : name, title: (m[2] || "").trim() };
}

type Row = {
  id: string; name: string; domain: string; website: string | null; city: string | null; region: string | null; calendar_vendor: string | null;
  email: string | null; emailed: string | null;
};
const ops = db
  .prepare(
    `SELECT o.id, o.name, o.domain, o.website, o.city, o.region, o.calendar_vendor, o.email,
            (SELECT status FROM outreach_drafts d WHERE d.operator_id = o.id AND d.kind = 'otto' AND d.status IN ('sent', 'handoff', 'replied') LIMIT 1) AS emailed
       FROM operators o
      WHERE o.family = 'water' AND o.claim_status = 'unclaimed' AND o.origin NOT IN ('demo', 'test')
        AND EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'owner_name')
      ORDER BY o.completeness DESC NULLS LAST`,
  )
  .all() as Row[];
const facts = db.prepare("SELECT fact_key, fact_value, source_url FROM facts WHERE operator_id = ? AND fact_key IN ('owner_name', 'owner_email', 'owner_phone')");

type Person = Record<string, string>;
const people: Person[] = [];
const seen = new Set<string>();
for (const op of ops) {
  if (people.length >= limit) break;
  const rows = facts.all(op.id) as { fact_key: string; fact_value: string; source_url: string | null }[];
  const emails = rows.filter((r) => r.fact_key === "owner_email").map((r) => r.fact_value.trim().toLowerCase()).filter((e) => looksPersonal(e, op.domain) && !/\d/.test(e.split("@")[0]));
  const phones = rows.filter((r) => r.fact_key === "owner_phone").map((r) => r.fact_value.trim());
  for (const r of rows.filter((r) => r.fact_key === "owner_name")) {
    const p = personName(r.fact_value, op.name);
    if (!p) continue;
    const key = op.id + "|" + p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const first = p.name.split(" ")[0].toLowerCase();
    const email = emails.find((e) => e.split("@")[0].startsWith(first)) || "";
    const phone = (phones.find((ph) => ph.toLowerCase().includes(first)) || "").replace(/\s*\(.*\)$/, "");
    const q = encodeURIComponent(p.name + " " + op.name);
    people.push({
      person: p.name,
      title: p.title,
      business: op.name,
      city: op.city || "",
      region: op.region || "",
      website: op.website || "https://" + op.domain + "/",
      booking_software: op.calendar_vendor || "",
      linkedin_search: "https://www.linkedin.com/search/results/people/?keywords=" + q,
      owner_email: email,
      owner_cell: phone,
      front_desk_email: (op.email || "").toLowerCase(),
      emailed: op.emailed ? "yes (" + op.emailed + ")" : "no",
      found_on: r.source_url || "",
    });
  }
}

const cols = ["person", "title", "business", "city", "region", "website", "booking_software", "linkedin_search", "owner_email", "owner_cell", "front_desk_email", "emailed", "found_on"];
const cell = (v: string) => '"' + (v || "").replace(/"/g, '""') + '"';
const csv = [cols.join(","), ...people.map((p) => cols.map((c) => cell(p[c])).join(","))].join("\r\n") + "\r\n";
const day = nowIso().slice(0, 10);
const dir = join(dirname(fileURLToPath(import.meta.url)), "../data/exports");
mkdirSync(dir, { recursive: true });
const file = join(dir, "water-owners-" + day + ".csv");
writeFileSync(file, csv);
const businesses = new Set(people.map((p) => p.business)).size;
const withEmail = people.filter((p) => p.owner_email).length;
const withCell = people.filter((p) => p.owner_cell).length;
console.log(`owners list: ${people.length} people at ${businesses} businesses (${withEmail} with their own mailbox, ${withCell} with a cell), written to ${file}`);

if (to) {
  const text = [
    `Attached: ${people.length} owners and managers at ${businesses} water operators, as their own sites name them, exported ${day}.`,
    "",
    "Columns: person, title, business, city, region, website, booking_software, linkedin_search, owner_email, owner_cell, front_desk_email, emailed, found_on.",
    "",
    "linkedin_search opens a LinkedIn people search for the name plus the business; the catalog holds no profile links, so none are guessed.",
    "owner_email and owner_cell are filled only when the site gave that person's own. found_on is the page the name came from, so you can check before you write.",
    "emailed says whether that business has already had the Otto pitch by mail (sent, handed off, or replied), so you can decide whether to reach the person on LinkedIn as well.",
    "",
    "The owners crawl is still running over the Otto queue; re-run scripts/owners-list.mts for a longer list next week.",
  ].join("\n");
  const mail = { to, subject: `Water operators: ${people.length} owners and managers for LinkedIn (${day})`, text, attachments: [{ filename: "water-owners-" + day + ".csv", content: Buffer.from(csv), contentType: "text/csv" }] };
  // To the founder, not to a business: the outreach mailbox first so it sits with the rest of the campaign,
  // and the transactional sender if that mailbox cannot be reached from this network.
  let r = await sendMail({ ...mail, commercial: true });
  if (!r.sent) r = await sendMail({ ...mail, commercial: false });
  console.log(r.sent ? "emailed " + to + " " + r.id : "email not sent: " + r.error);
}
process.exit(0);
