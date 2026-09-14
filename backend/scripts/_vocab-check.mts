/**
 * Vocabulary check for `src/enrich/sitescrape.ts`.
 *
 * Runs the real `scrapeSite` over a stratified sample of the structure queue — two operators from each of
 * twenty arts — and prints every service it found with its price, so the rules can be judged by eye. It also
 * replays the OLD word list and OLD canon table (copied verbatim below) over the same found names, so the
 * report can say how many of these lines the previous vocabulary would have kept.
 *
 * A network crawl of 40 sites is over this machine's 8-site working limit, so it runs in batches:
 *   npm run cpu && npx tsx scripts/_vocab-check.mts --batch 0      (repeat for 1..4)
 * Concurrency 2, 40 sites total, never more.
 */
import { readFileSync } from "node:fs";
import { scrapeSite, serviceLike, bookableName, canon } from "../src/enrich/sitescrape.ts";

const ARTS = ["golf", "museum", "camping", "theatre", "brewery", "spa", "martialarts", "dance", "winery", "yoga", "fitness", "pottery", "icerink", "bowling", "arcade", "tennis", "swim", "cooking", "climbing", "billiards"];
const PER_ART = 2;
const BATCH = 8;

/** The vocabulary before this change, for the before/after count. */
const OLD_WORDS = /beach (chair|furniture|umbrella)|cabana|umbrella|jet ?ski|waverunner|\bpwc\b|kayak|canoe|paddle ?board|\bsup\b|pontoon|boat rental|boat tour|charter|fishing|cruise|\bsail(ing|boat|s)?\b|sunset|dolphin|snorkel|parasail|skydiv|tandem|helicopter|heli ?tour|balloon|\bkart|escape room|\baxe\b|paintball|airsoft|horse|trail ride|zipline|\btub(e|ing)\b|banana boat|flyboard|eco ?tour|mangrove|manatee|whale|scuba|\bdiv(e|ing)\b|\bsurf|wakeboard|water ?ski|yacht|catamaran|glass ?bottom|airboat|\batv|\butv|\bjeep|segway|\bbikes?\b|e-?bike|rental/i;
const OLD_CANON: RegExp[] = [/jet ?ski|waverunner|pwc/i, /paddle ?board|sup\b/i, /kayak|canoe/i, /pontoon/i, /pedal ?boat|paddle ?boat/i, /\bdock\b|swim platform/i, /\bmega\b|giant (sup|paddle)/i, /boat rental|boat rent/i, /parasail/i, /banana boat|tube|tubing/i, /flyboard/i, /snorkel/i, /scuba|dive/i, /dolphin|manatee|whale|eco ?tour|mangrove|wildlife/i, /sunset|cruise|sail|catamaran|yacht|glass ?bottom|airboat|boat tour|harbor|harbour/i, /fishing|charter/i, /skydiv|tandem/i, /helicopter|heli/i, /balloon/i, /escape room/i, /axe/i, /paintball|airsoft/i, /kart/i, /horse|trail ride/i, /zipline/i, /surf|wakeboard|water ?ski/i, /atv|utv|jeep|segway|bike/i, /beach (chair|furniture|umbrella)|cabana/i];
const oldKeeps = (n: string) => OLD_WORDS.test(n) && OLD_CANON.some((r) => r.test(n));

const q = JSON.parse(readFileSync("data/structure-queue.json", "utf8")) as { operators: { id: string; domain: string; website: string; name: string; art: string }[] };
const sample: typeof q.operators = [];
for (const art of ARTS) {
  const rows = q.operators.filter((o) => o.art === art && /^https?:/.test(o.website)).sort((a, b) => a.domain.localeCompare(b.domain));
  const step = Math.max(1, Math.floor(rows.length / (PER_ART + 1)));
  for (let i = 0; i < PER_ART && rows[step * (i + 1)]; i++) sample.push(rows[step * (i + 1)]);
}

if (process.argv.includes("--offline")) {
  // No network: the rules judged directly, one line per case. YES must be a service, NO must not be.
  const YES: [string, string][] = [
    ["Tee Times", ""], ["9 Hole Green Fee", ""], ["Large Bucket of Balls", ""], ["Junior Golf Clinic", ""],
    ["Adult Group Swim Lessons", ""], ["Open Skate", ""], ["Stick & Puck", ""], ["Learn to Skate Program", ""],
    ["Shoe Rental", ""], ["Bowling Lanes", "$25 per hour"], ["Court Rental", "book now"], ["Billiards Table", "$12 / hour"],
    ["60 Minute Deep Tissue Massage", ""], ["Signature Facial", ""], ["Infrared Sauna Session", ""],
    ["Wine Tasting Flight", ""], ["Brewery Tour", ""], ["Cellar Door Tasting", ""],
    ["RV Site with Full Hookup", ""], ["Tent Site", "$35 per night"], ["Cabin", "$120 per night"],
    ["General Admission", ""], ["Docent Guided Tour", ""], ["Field Trip", ""],
    ["Kids Jiu Jitsu", ""], ["Beginner Pottery Class", ""], ["Paint & Sip", ""], ["Cooking Class", ""],
    ["Monthly Unlimited Membership", "$108"], ["Drop-In Class", ""], ["10 Class Pack", ""], ["Birthday Party Package", ""],
    ["Trail Ride", ""], ["Lift Ticket", ""], ["Top Rope Belay Lesson", ""], ["Jump Time", ""], ["Karaoke Room", ""],
    ["Escape Room", ""], ["Jet Ski Rental", ""], ["Fishing Charter", ""],
    ["Private Sessions", "60 minutes $200"], ["Ladies Night", "$20 per person"],
  ];
  const NO: [string, string][] = [
    ["Home", ""], ["About Us", ""], ["Contact", ""], ["Gift Cards", ""], ["Book Now", ""], ["Careers", ""],
    ["Privacy Policy", ""], ["FAQ", ""], ["Blog", ""], ["News", ""], ["Events", ""], ["Events Calendar", ""],
    ["World Class Instruction", ""], ["We use session cookies", ""], ["1420 Maple Lane", ""],
    ["A flight of stairs", ""], ["Courthouse Square", ""], ["Table of Contents", ""], ["Entry-Level Positions", ""],
    ["Third Party Vendors", ""], ["Opening Night Gala", ""], ["Support Ticket", ""], ["Of course we do", ""],
    ["Virtual Tour", ""], ["Our Team", ""], ["Terms of Service", ""], ["T-Shirts", ""], ["Pro Shop", ""],
  ];
  const BADNAME = ["2025-2026 Class Schedule", "Event Rental Info", "Trial Class Intake", "Book your massage today",
    "Come explore our trails", "Amenity: Pull-Through", "Pilates by Simona Logo", "Monthly Membership $89",
    "The Escape Bowling Center", "Rozenvain Ballet Studio", "Ambassador Program", "Class Calendar", "Waiver Form"];
  let bad = 0;
  for (const [t, ctx] of YES) if (!serviceLike(t, ctx) || !bookableName(t) || !canon(t)) { bad++; console.log(`MISS  ${t}  (word=${serviceLike(t, ctx)} name=${bookableName(t)} canon=${canon(t)})`); }
  for (const [t, ctx] of NO) if (serviceLike(t, ctx) && bookableName(t) && canon(t)) { bad++; console.log(`FALSE POSITIVE  ${t} -> ${canon(t)}`); }
  for (const t of BADNAME) if (bookableName(t)) { bad++; console.log(`BAD NAME ALLOWED  ${t}`); }
  console.log(bad === 0 ? `offline rules: all ${YES.length + NO.length + BADNAME.length} cases pass` : `offline rules: ${bad} failures`);
  process.exit(bad === 0 ? 0 : 1);
}

const batch = Number((process.argv.find((a) => a.startsWith("--batch")) || "").split(/[= ]/)[1] ?? process.argv[process.argv.indexOf("--batch") + 1] ?? 0);
const slice = sample.slice(batch * BATCH, batch * BATCH + BATCH);
if (!slice.length) {
  console.error("no sites in batch " + batch + " (sample size " + sample.length + ")");
  process.exit(1);
}
console.error(`batch ${batch}: ${slice.length} sites of ${sample.length}, arts ${[...new Set(slice.map((s) => s.art))].join(",")}`);

let after = 0;
let before = 0;
async function one(op: (typeof sample)[number]) {
  const r = await scrapeSite(op);
  const names = r.facts.filter((f) => f.fact_key === "service").map((f) => f.fact_value);
  after += names.length;
  before += names.filter(oldKeeps).length;
  const lines = r.services.map((s) => `    - ${s.name}${s.detail ? " / " + s.detail : ""}${s.price_cents == null ? "" : "  $" + (s.price_cents / 100).toFixed(0)}`);
  console.log(`\n[${op.art}] ${op.domain}  (${r.status}, ${r.pages} pages, ${names.length} services)`);
  console.log(lines.join("\n") || "    (none)");
}

const queue = [...slice];
await Promise.all([1, 2].map(async () => {
  while (queue.length) await one(queue.shift()!).catch((e) => console.log("  error " + e.message));
}));
console.log(`\nBATCH ${batch} TOTALS  after=${after}  before(old vocabulary would keep)=${before}`);
