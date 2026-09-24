/**
 * Relevance check for the guest search, run against the real catalog: `npm run search:eval`.
 *
 * Search engines improve by measuring, not by looking at one query until it seems right. Each case below is a
 * query a guest really types, the city they are looking at, and a few plain rules about what the top eight
 * must look like ("all jet ski", "nothing longer than a day", "kids can join"). The rules are written from the
 * guest's side of the screen, never from what the ranking happens to return, so a change to the ranking that
 * passes more of them is better and one that passes fewer is worse. Add a case whenever a real search comes
 * back wrong; the fix is not done until the case passes.
 */
import { readFileSync } from "node:fs";
import { searchListings } from "../src/lib/search.ts";
import type { ArtKind, Unclaimed } from "../src/data/types.ts";

const TOP = 8;
const catalog = JSON.parse(readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8")) as { operators: Unclaimed[] };
const pool = catalog.operators;

type Rule = { why: string; ok: (top: Unclaimed[]) => boolean };
type Case = { q: string; metro: string; rules: Rule[] };

const DATE: ArtKind[] = ["cooking", "winery", "pottery", "theatre", "spa", "sauna", "escape", "cruise", "dance", "axe", "minigolf", "icerink", "bowling", "karaoke", "billiards", "brewery", "distillery", "balloon", "climbing", "kayak", "horse", "sailing", "tour"];
const DAYTIME: ArtKind[] = ["skydive", "heli", "balloon", "parasail", "jetski", "kayak", "paddleboard", "pontoon", "fishing", "zoo", "garden", "zipline", "golf", "discgolf", "horse", "rafting", "surf", "scuba", "camping", "tennis", "gliding", "paragliding", "waterpark", "themepark"];
const FAMILY: ArtKind[] = ["zoo", "museum", "garden", "swim", "gymnastics", "camping", "aquarium", "trampoline", "minigolf", "bowling", "waterpark", "themepark", "icerink", "arcade", "lasertag", "horse", "kayak", "pontoon", "cruise", "escape", "kart", "parasail", "balloon", "fishing", "bike", "climbing", "tour"];
const GROWN_UP: ArtKind[] = ["skydive", "axe", "paintball", "range", "rage", "brewery", "winery", "distillery"];
const WATER_OUT: ArtKind[] = ["jetski", "kayak", "paddleboard", "pontoon", "parasail", "surf", "rafting", "fishing", "sailing"];
const BACH: ArtKind[] = ["pontoon", "jetski", "kart", "axe", "brewery", "distillery", "winery", "range", "karaoke", "paintball", "cruise", "skydive", "parasail", "spa", "sailing"];
const BIRTHDAY: ArtKind[] = ["rage", "venue", "gymnastics", "kart", "escape", "axe", "trampoline", "lasertag", "bowling", "arcade", "minigolf", "karaoke", "paintball", "waterpark", "pontoon", "cruise", "jetski", "parasail"];
const TEAM: ArtKind[] = ["escape", "rage", "tour", "axe", "kart", "bowling", "cooking", "brewery", "archery", "range", "climbing", "lasertag", "paintball", "pontoon", "cruise", "venue"];

const hoursOf = (u: Unclaimed): number => { const m = (u.dur || "").match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|days?)/i); return m ? (/day/i.test(m[2]) ? 24 : Number(m[1])) : 0; };
const priceOf = (u: Unclaimed): number | null => { const p = u.options.map((o) => o.price).filter((n): n is number => n != null); return p.length ? Math.min(...p) : u.from ?? null; };

const allKind = (arts: ArtKind[]): Rule => ({ why: "all " + arts.join("/"), ok: (t) => t.every((u) => arts.includes(u.art)) });
const mostlyKind = (arts: ArtKind[], min: number, label = arts.slice(0, 4).join("/") + "..."): Rule => ({ why: `at least ${min} of ${TOP} are ${label}`, ok: (t) => t.filter((u) => arts.includes(u.art)).length >= Math.min(min, t.length) });
const noKind = (arts: ArtKind[], label = arts.join("/")): Rule => ({ why: "none are " + label, ok: (t) => !t.some((u) => arts.includes(u.art)) });
const fewKind = (arts: ArtKind[], max: number, label: string): Rule => ({ why: `at most ${max} are ${label}`, ok: (t) => t.filter((u) => arts.includes(u.art)).length <= max });
const noDayTrips: Rule = { why: "nothing five hours or longer", ok: (t) => !t.some((u) => hoursOf(u) >= 5) };
const inMetro = (id: string): Rule => ({ why: "all in " + id, ok: (t) => t.every((u) => u.metroId === id) });
const priceUnder = (max: number): Rule => ({ why: "all priced at or under $" + max, ok: (t) => t.every((u) => { const p = priceOf(u); return p != null && p <= max; }) });
const mostlyCheap = (max: number, min: number): Rule => ({ why: `at least ${min} priced at or under $${max}`, ok: (t) => t.filter((u) => { const p = priceOf(u); return p != null && p <= max; }).length >= Math.min(min, t.length) });
const someResults: Rule = { why: "at least one result", ok: (t) => t.length >= 1 };
/** Every result is the kind, or says it offers it by name: a kayak shop that rents paddleboards is a fair answer to "paddleboard". */
const allOffer = (arts: ArtKind[], re: RegExp, label: string): Rule => ({ why: "all " + label + " or offering it by name", ok: (t) => t.every((u) => arts.includes(u.art) || re.test([u.title, ...(u.tags || []), ...u.options.map((o) => o.name)].join(" "))) });
const ownBeforePartner: Rule = { why: "Outset's own operators before a partner's products when both fit", ok: (t) => { const own = t.findIndex((u) => !u.affiliate); const partner = t.findIndex((u) => !!u.affiliate); return partner < 0 || own < 0 || own < partner; } };

const CASES: Case[] = [
  { q: "date night", metro: "toronto", rules: [someResults, mostlyKind(DATE, 7, "date kinds"), noDayTrips, ownBeforePartner] },
  { q: "date night ideas", metro: "tampa", rules: [someResults, mostlyKind(DATE, 7, "date kinds"), noDayTrips] },
  { q: "romantic evening", metro: "denver", rules: [someResults, mostlyKind(DATE, 7, "date kinds"), noDayTrips, noKind(["venue"], "banquet venues")] },
  { q: "date night under $50", metro: "toronto", rules: [someResults, mostlyKind(DATE, 6, "date kinds"), priceUnder(50)] },
  { q: "things to do tonight", metro: "denver", rules: [someResults, noDayTrips, fewKind(DAYTIME, 2, "daytime kinds")] },
  { q: "things to do tonight", metro: "tampa", rules: [someResults, noDayTrips, fewKind(DAYTIME, 3, "daytime kinds")] },
  { q: "escape room tonight", metro: "toronto", rules: [someResults, allKind(["escape"]), noDayTrips] },
  { q: "jet ski", metro: "tampa", rules: [someResults, allKind(["jetski"])] },
  { q: "jetsky", metro: "tampa", rules: [someResults, allKind(["jetski"])] },
  { q: "jet ski rental miami", metro: "all", rules: [someResults, allKind(["jetski"]), inMetro("miami")] },
  { q: "escape room", metro: "waterloo", rules: [someResults, allKind(["escape"]), inMetro("waterloo")] },
  { q: "skydiving", metro: "seattle", rules: [someResults, allKind(["skydive"])] },
  { q: "kyaking", metro: "seattle", rules: [someResults, allKind(["kayak"])] },
  { q: "cooking class", metro: "vancouver", rules: [someResults, mostlyKind(["cooking"], 7, "cooking")] },
  { q: "wine tasting", metro: "nashville", rules: [someResults, mostlyKind(["winery"], 6, "wineries")] },
  { q: "brewery", metro: "denver", rules: [someResults, allKind(["brewery"])] },
  { q: "axe throwing", metro: "toronto", rules: [someResults, allKind(["axe"])] },
  { q: "go karts", metro: "orlando", rules: [someResults, allKind(["kart"])] },
  // Portland has no listing filed as pottery yet; the one clay studio there is filed as theatre. Reading its name is the best a search can do.
  { q: "pottery class", metro: "portland", rules: [someResults, allOffer(["pottery"], /pottery|clay|ceramic/i, "pottery")] },
  { q: "helicopter tour", metro: "las-vegas", rules: [someResults, allKind(["heli"])] },
  { q: "hot air balloon", metro: "phoenix", rules: [someResults, allKind(["balloon"])] },
  { q: "fishing charter", metro: "key-west", rules: [someResults, allKind(["fishing"])] },
  // Kayak outfits rent boards too, and the catalog files most of them under kayak, so they are a fair answer after the board shops.
  { q: "paddleboard", metro: "san-diego", rules: [someResults, allKind(["paddleboard", "kayak"])] },
  { q: "spa day", metro: "miami", rules: [someResults, mostlyKind(["spa", "sauna"], 6, "spa/sauna")] },
  { q: "sunset cruise", metro: "tampa", rules: [someResults, mostlyKind(["cruise", "sailing", "pontoon"], 6, "cruise/sailing/pontoon")] },
  { q: "with kids", metro: "denver", rules: [someResults, mostlyKind(FAMILY, 6, "family kinds"), noKind(GROWN_UP, "grown-up kinds")] },
  { q: "rainy day with kids", metro: "toronto", rules: [someResults, noKind(GROWN_UP, "grown-up kinds"), noKind(WATER_OUT, "open-water kinds")] },
  { q: "bachelorette", metro: "nashville", rules: [someResults, mostlyKind(BACH, 6, "bachelorette kinds")] },
  { q: "birthday party", metro: "tampa", rules: [someResults, mostlyKind(BIRTHDAY, 6, "birthday kinds")] },
  { q: "team building", metro: "chicago", rules: [someResults, mostlyKind(TEAM, 6, "team kinds")] },
  { q: "under $30", metro: "orlando", rules: [someResults, priceUnder(30)] },
  { q: "cheap things to do", metro: "austin", rules: [someResults, mostlyCheap(75, 6)] },
  { q: "things to do", metro: "halifax", rules: [someResults, inMetro("halifax")] },
];

let passed = 0;
let rulesPassed = 0;
let rulesTotal = 0;
const fails: string[] = [];
for (const c of CASES) {
  const top = searchListings(pool, c.q, { metroId: c.metro }).slice(0, TOP);
  const bad = c.rules.filter((r) => !r.ok(top));
  rulesTotal += c.rules.length;
  rulesPassed += c.rules.length - bad.length;
  const tag = bad.length ? "FAIL" : "ok  ";
  if (!bad.length) passed++;
  console.log(`${tag} "${c.q}" @ ${c.metro}` + (bad.length ? "  ✗ " + bad.map((r) => r.why).join("; ") : ""));
  if (bad.length) {
    fails.push(c.q + " @ " + c.metro);
    for (const u of top) console.log(`       [${u.art}${u.affiliate ? "/" + u.affiliate.source : ""}] ${u.title.slice(0, 50)} | ${u.metroId} | ${u.dur || ""} | ${priceOf(u) == null ? "no price" : "$" + priceOf(u)}`);
  }
}
console.log(`\n${passed}/${CASES.length} cases pass, ${rulesPassed}/${rulesTotal} rules pass`);
process.exitCode = fails.length ? 1 : 0;
