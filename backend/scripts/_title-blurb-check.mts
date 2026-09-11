/**
 * Before/after check for the title, blurb and tag cleaners in src/sync/contacts.ts.
 * Reads N random operators (default 300) from the database read-only, runs the committed helpers (BASE, default HEAD)
 * and the working-tree helpers on the same raw rows, and prints every row where the result changed.
 *
 *   npx tsx scripts/_title-blurb-check.mts            # 300 random operators with a description
 *   N=500 METRO=tampa npx tsx scripts/_title-blurb-check.mts
 *   BASE=ff615e10 npx tsx scripts/_title-blurb-check.mts
 */
import { DatabaseSync } from "node:sqlite";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanBlurb, cleanTitle, collapseRepeats, decodeEntities, fixShouting } from "../src/sync/contacts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dbPath = process.env.OUTSET_DB || join(root, "data/outset.db");
const N = Number(process.env.N || 300);
const metro = process.env.METRO || "";
const base = process.env.BASE || "HEAD";

// The committed helpers, loaded from git so "before" is what the last sync actually published.
const legacyDir = mkdtempSync(join(tmpdir(), "contacts-legacy-"));
const legacySrc = execSync(`git show ${base}:backend/src/sync/contacts.ts`, { cwd: root, encoding: "utf8" })
  .replace(/from "\.\.\//g, `from "${join(root, "src")}/`)
  .replace(/from "\.\//g, `from "${join(root, "src/sync")}/`);
const legacyPath = join(legacyDir, "contacts-legacy.ts");
writeFileSync(legacyPath, legacySrc);
const legacy = (await import(pathToFileURL(legacyPath).href)) as { cleanTitle: (raw: string) => string; decodeEntities: (raw: string) => string };
// The old blurb line, as toCatalogItem had it: endAtSentence(cleanPara(raw), 420). Both were file-private, so the two are inlined here.
function legacyBlurb(raw: string): string {
  const flat = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[#*_>`]+/g, " ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  const seen = new Set<string>();
  const out: string[] = [];
  let len = 0;
  for (const sentence of flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)) {
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    if (len + sentence.length > 700) break;
    seen.add(key);
    out.push(sentence);
    len += sentence.length + 1;
  }
  if (out.length > 1 && !/[.!?)"]$/.test(out[out.length - 1])) out.pop();
  const t = out.join(" ");
  if (t.length <= 420) return t;
  const cut = t.slice(0, 420);
  const i = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (i > 420 * 0.4 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, "")).trim();
}

const db = new DatabaseSync(dbPath, { readOnly: true });
type Row = { id: string; name: string; legal_name: string | null; city: string | null; region: string | null; domain: string };
const rows = db
  .prepare(
    `SELECT o.id, o.name, o.legal_name, o.city, o.region, o.domain FROM operators o
     WHERE o.origin != 'demo' AND o.name IS NOT NULL AND length(o.name) >= 3
       AND EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key IN ('description','site_desc','one_line'))
       ${metro ? "AND o.metro_id = ?" : ""}
     ORDER BY random() LIMIT ?`,
  )
  .all(...(metro ? [metro, N] : [N])) as Row[];
const factStmt = db.prepare("SELECT fact_key, fact_value FROM facts WHERE operator_id = ? AND fact_key IN ('description','site_desc','one_line','service','google_category')");
const offStmt = db.prepare("SELECT name FROM offerings WHERE operator_id = ? LIMIT 20");

let titleChanged = 0;
let blurbChanged = 0;
let blurbLengthOnly = 0;
let tagChanged = 0;
let anyChanged = 0;
const sep = "\n" + "-".repeat(100);
for (const r of rows) {
  const facts = factStmt.all(r.id) as { fact_key: string; fact_value: string }[];
  const pick = (k: string) => facts.filter((f) => f.fact_key === k).map((f) => decodeEntities(f.fact_value));
  const rawName = decodeEntities(r.name);
  const beforeTitle = legacy.cleanTitle(legacy.decodeEntities(r.name));
  const afterTitle = cleanTitle(rawName, { city: r.city, region: r.region, legalName: r.legal_name });
  // Before: the first source only. After: the first source whose text survives cleaning.
  const rawBlurb = pick("description")[0] || pick("site_desc")[0] || pick("one_line")[0] || "";
  const beforeBlurb = legacyBlurb(rawBlurb);
  const afterBlurb = [pick("description")[0], pick("site_desc")[0], pick("one_line")[0]].map((raw) => cleanBlurb(raw || "", { title: afterTitle, city: r.city, region: r.region })).find(Boolean) || "";
  const rawTags = [...pick("google_category"), ...pick("service"), ...(offStmt.all(r.id) as { name: string }[]).map((o) => decodeEntities(o.name))];
  const tagDiffs = rawTags.map((t) => [t, collapseRepeats(fixShouting(t))]).filter(([a, b]) => a !== b);

  const lines: string[] = [];
  if (beforeTitle !== afterTitle) {
    titleChanged++;
    lines.push(`TITLE  ${JSON.stringify(beforeTitle)} -> ${JSON.stringify(afterTitle)}   [raw ${JSON.stringify(rawName)}; city ${r.city || "-"}, ${r.region || "-"}]`);
  }
  if (beforeBlurb !== afterBlurb) {
    blurbChanged++;
    const lengthOnly = afterBlurb.startsWith(beforeBlurb) && beforeBlurb.length >= 100;
    if (lengthOnly) blurbLengthOnly++;
    lines.push(`BLURB${lengthOnly ? " (longer cut only)" : ""}\n   before: ${JSON.stringify(beforeBlurb.slice(0, 260))}\n   after:  ${JSON.stringify(afterBlurb.slice(0, 260))}`);
  }
  if (tagDiffs.length) {
    tagChanged++;
    lines.push("TAGS   " + tagDiffs.slice(0, 6).map(([a, b]) => `${JSON.stringify(a)} -> ${JSON.stringify(b)}`).join("; "));
  }
  if (lines.length) {
    anyChanged++;
    console.log(sep + `\n${r.domain} (${afterTitle})\n` + lines.join("\n"));
  }
}
console.log(sep);
console.log(`Sampled ${rows.length} operators${metro ? " in " + metro : ""} against ${base}.`);
console.log(`Changed: ${anyChanged} rows. Titles ${titleChanged}, blurbs ${blurbChanged} (${blurbLengthOnly} only because the cut moved from 420 to 600 characters), tags/options ${tagChanged}.`);
process.exit(0);
