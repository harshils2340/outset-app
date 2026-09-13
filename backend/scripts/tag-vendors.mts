import "../src/env.ts";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client.ts";
import {
  VENDOR_BY_ID,
  capsSummary,
  detectVendor,
  isNotBookingLink,
  isOwnSoftware,
  vendorFor,
  type VendorMatch,
} from "../src/enrich/vendors.ts";

/**
 * Which booking software every operator already runs.
 *
 * Read-only over the crawl: the only writes are a `booking_software` fact (value = vendor id,
 * confidence 'derived') and `operators.calendar_vendor` where it is still empty. No network calls.
 *
 *   npx tsx scripts/tag-vendors.mts --dry     print the table, write nothing
 *   npx tsx scripts/tag-vendors.mts           write
 *   --sample=40                               also print that many classified URLs to eyeball
 *   --unknown=40                              print the most common unclassified booking hosts
 */

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const num = (flag: string, dflt: number) => {
  const a = args.find((x) => x.startsWith(flag + "="));
  if (!a) return dflt;
  const n = Number(a.slice(flag.length + 1));
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};
const SAMPLE = num("--sample", 20);
const UNKNOWN = num("--unknown", 30);

db.exec("PRAGMA busy_timeout = 120000");

type FactRow = { operator_id: string; fact_key: string; fact_value: string };

const facts = db
  .prepare(
    `SELECT operator_id, fact_key, fact_value FROM facts
      WHERE fact_key IN ('booking_url', 'online_booking', 'booking_vendor')`,
  )
  .all() as FactRow[];

const byOperator = new Map<string, FactRow[]>();
for (const f of facts) {
  let list = byOperator.get(f.operator_id);
  if (!list) byOperator.set(f.operator_id, (list = []));
  list.push(f);
}

const operators = db
  .prepare("SELECT id, name, domain, calendar_vendor FROM operators")
  .all() as { id: string; name: string; domain: string | null; calendar_vendor: string | null }[];
const opById = new Map(operators.map((o) => [o.id, o]));

const existing = new Set(
  (db.prepare("SELECT DISTINCT operator_id FROM facts WHERE fact_key = 'booking_software'").all() as {
    operator_id: string;
  }[]).map((r) => r.operator_id),
);

/* ---------- classify ---------- */

type Tally = { ops: number; withUrl: number };
const perVendor = new Map<string, Tally>();
const matches: { opId: string; m: VendorMatch }[] = [];
const samples: string[] = [];
const unknownHosts = new Map<string, { n: number; ex: string }>();

let opsWithAnyLink = 0;
let opsWithOnlyJunkLinks = 0;
let unclassified = 0;

for (const [opId, rows] of byOperator) {
  if (!opById.has(opId)) continue;
  const links = rows.filter((r) => r.fact_key !== "booking_vendor").map((r) => r.fact_value);
  const realLinks = links.filter((u) => !isNotBookingLink(u));
  if (links.length) opsWithAnyLink += 1;

  const m = vendorFor(rows);
  if (!m) {
    if (links.length && !realLinks.length) opsWithOnlyJunkLinks += 1;
    else if (realLinks.length) {
      unclassified += 1;
      for (const u of realLinks) {
        if (detectVendor(u)) continue;
        let h = "";
        try {
          h = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
        } catch {
          continue;
        }
        // An operator booking on their own domain is not a missing vendor, it is a bespoke site.
        const dom = opById.get(opId)?.domain?.replace(/^www\./, "").toLowerCase() || "";
        if (dom && (h === dom || h.endsWith("." + dom))) continue;
        const e = unknownHosts.get(h) || { n: 0, ex: u.slice(0, 100) };
        e.n += 1;
        unknownHosts.set(h, e);
      }
    }
    continue;
  }
  matches.push({ opId, m });
  const t = perVendor.get(m.id) || { ops: 0, withUrl: 0 };
  t.ops += 1;
  if (m.bookingUrl) t.withUrl += 1;
  perVendor.set(m.id, t);
  if (samples.length < SAMPLE && m.bookingUrl && Math.random() < 0.5) {
    samples.push(`${m.id.padEnd(20)} ${(opById.get(opId)?.name || "").slice(0, 28).padEnd(30)} ${m.bookingUrl.slice(0, 92)}`);
  }
}

/* ---------- report ---------- */

const rows = [...perVendor.entries()]
  .map(([id, t]) => ({ id, t, v: VENDOR_BY_ID.get(id)! }))
  .sort((a, b) => b.t.ops - a.t.ops);

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
console.log("");
console.log(pad("VENDOR", 22) + pad("LABEL", 30) + pad("KIND", 13) + pad("OPS", 7) + "CAPS TODAY");
console.log("-".repeat(110));
for (const r of rows) {
  console.log(
    pad(r.id, 22) + pad(r.v.label, 30) + pad(r.v.kind, 13) + pad(String(r.t.ops), 7) + capsSummary(r.v.caps),
  );
}
console.log("-".repeat(110));

const own = matches.filter((x) => isOwnSoftware(x.m.id));
const market = matches.filter((x) => !isOwnSoftware(x.m.id));
const readable = matches.filter((x) => x.m.caps.catalog || x.m.caps.availability);
const liveAvail = matches.filter((x) => x.m.caps.availability);

console.log(`operators in catalog                 ${operators.length}`);
console.log(`  with any booking-ish link          ${opsWithAnyLink}`);
console.log(`  classified to a known platform     ${matches.length}`);
console.log(`    of those, own booking software   ${own.length}`);
console.log(`    of those, marketplace/listing    ${market.length}`);
console.log(`  link exists but platform unknown   ${unclassified}  (own-domain or bespoke booking pages)`);
console.log(`  only junk links (share/tel/file)   ${opsWithOnlyJunkLinks}`);
console.log(`  no booking link at all             ${operators.length - opsWithAnyLink}`);
console.log("");
console.log(`we can read a catalog or availability today for   ${readable.length} operators`);
console.log(`we can read LIVE AVAILABILITY today for           ${liveAvail.length} operators`);
console.log("");

if (SAMPLE && samples.length) {
  console.log("sample classifications:");
  for (const s of samples) console.log("  " + s);
  console.log("");
}
if (UNKNOWN && unknownHosts.size) {
  console.log("top unclassified booking hosts (candidates for the registry):");
  for (const [h, e] of [...unknownHosts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, UNKNOWN)) {
    console.log(`  ${String(e.n).padStart(4)}  ${pad(h, 40)} ${e.ex}`);
  }
  console.log("");
}

/* ---------- write ---------- */

if (DRY) {
  const newFacts = matches.filter((x) => !existing.has(x.opId)).length;
  const newVendors = matches.filter((x) => !opById.get(x.opId)?.calendar_vendor).length;
  console.log(`DRY RUN: would write ${newFacts} booking_software facts and set calendar_vendor on ${newVendors} operators. Nothing written.`);
  process.exit(0);
}

db.exec("BEGIN IMMEDIATE");
let wrote = 0;
let vendorSet = 0;
try {
  const del = db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key = 'booking_software'");
  const ins = db.prepare(
    "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, 'booking_software', ?, ?, 'derived')",
  );
  const upd = db.prepare(
    "UPDATE operators SET calendar_vendor = ? WHERE id = ? AND (calendar_vendor IS NULL OR calendar_vendor = '')",
  );
  for (const { opId, m } of matches) {
    if (existing.has(opId)) del.run(opId);
    ins.run(randomUUID(), opId, m.id, m.bookingUrl);
    wrote += 1;
    // Only the operator's own software belongs in calendar_vendor; a Viator link is not their calendar.
    if (isOwnSoftware(m.id)) {
      const r = upd.run(m.id, opId);
      vendorSet += Number(r.changes || 0);
    }
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
console.log(`Wrote ${wrote} booking_software facts; set calendar_vendor on ${vendorSet} operators that had none.`);
process.exit(0);
