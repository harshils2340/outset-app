import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The gate before a claim email goes out. An operator who opens their page should see a picture, a menu with
 * believable prices, and sentences a person would write. This checks that from the published files, the same
 * ones the live site serves, and prints a pass or fail per listing with the reason.
 *
 * Usage: npx tsx scripts/presend-check.mts [--metro=tampa] [--ids=a,b,c] [--limit=20]
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../../public");

type Listing = {
  id: string;
  title: string;
  area?: string;
  cover?: string;
  photos?: string[];
  blurb?: string;
  options?: { name: string; price: number | null; per?: string; detail?: string }[];
  services?: { name: string }[];
  contact?: { phone?: string | null; hours?: string[] };
  hrs?: unknown[];
  checkin?: string;
  cancellation?: string;
};

const arg = (name: string) => process.argv.find((a) => a.startsWith("--" + name + "="))?.split("=")[1];

/** A price that cannot be what the trip costs: a deposit, a per-person add-on read as the whole trip. */
function implausible(o: { price: number | null; per?: string; detail?: string; name: string }): boolean {
  if (o.price == null) return false;
  if (o.price < 15) return true;
  const hours = Number((o.detail || o.name).match(/(\d+(?:\.\d+)?)\s*(?:to\s*\d+\s*)?h(?:ou)?rs?\b/i)?.[1] || 0);
  if (hours >= 3 && o.price < 60) return true;
  return false;
}

const SHOUT = (t: string) => {
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length > 25 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7;
};

function check(d: Listing): { ok: boolean; problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const photos = d.photos || [];
  const opts = d.options || [];
  const priced = opts.filter((o) => o.price != null);

  if (!d.cover) problems.push("no cover photo");
  else if (photos.length < 3) notes.push(`only ${photos.length} photo${photos.length === 1 ? "" : "s"}`);

  if (!opts.length) problems.push("no menu");
  else if (!priced.length) notes.push("menu has no prices");

  const silly = priced.filter(implausible);
  if (silly.length) problems.push(`price looks wrong: ${silly.slice(0, 2).map((o) => "$" + o.price + " " + o.name.slice(0, 28)).join("; ")}`);

  if (!d.blurb) notes.push("no description");
  else if (SHOUT(d.blurb)) problems.push("description is in capitals");
  else if (!/^[A-Z"']/.test(d.blurb.trim())) problems.push("description starts mid-sentence");

  for (const [label, text] of [["check-in", d.checkin], ["cancellation", d.cancellation]] as const) {
    if (text && SHOUT(text)) problems.push(`${label} text is in capitals`);
  }

  if (SHOUT(d.title)) problems.push("title is in capitals");
  if (!d.contact?.phone) notes.push("no phone");
  if (!d.contact?.hours?.length && !(d.hrs || []).some(Boolean)) notes.push("no hours");

  return { ok: problems.length === 0, problems, notes };
}

function load(id: string): Listing | null {
  try {
    return JSON.parse(readFileSync(join(publicDir, "o", id + ".json"), "utf8")) as Listing;
  } catch {
    return null;
  }
}

const ids = arg("ids")?.split(",").filter(Boolean);
const metro = arg("metro");
const limit = Number(arg("limit") || 20);

let targets: string[] = [];
if (ids?.length) targets = ids;
else {
  const cat = JSON.parse(readFileSync(join(publicDir, "catalog.json"), "utf8")) as { operators: { id: string; metroId?: string; reviews?: number; cover?: string }[] };
  targets = cat.operators
    .filter((o) => (!metro || o.metroId === metro) && o.cover)
    .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
    .slice(0, limit)
    .map((o) => o.id);
}

let pass = 0;
const failed: string[] = [];
console.log(`Checking ${targets.length} listings${metro ? " in " + metro : ""}\n`);
for (const id of targets) {
  const d = load(id);
  if (!d) {
    console.log(`MISSING  ${id}`);
    failed.push(id);
    continue;
  }
  const r = check(d);
  if (r.ok) pass++;
  else failed.push(id);
  const tail = [...r.problems.map((p) => "! " + p), ...r.notes.map((n) => "- " + n)].join("  ");
  console.log(`${r.ok ? "READY   " : "HOLD    "} ${d.title.slice(0, 34).padEnd(35)} ${tail}`);
}
console.log(`\n${pass} ready to email, ${failed.length} to hold.`);
if (failed.length) console.log("Hold: " + failed.join(" "));
if (readdirSync(join(publicDir, "o")).length === 0) console.log("public/o is empty; run the sync first.");
