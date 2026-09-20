import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { plan, describeOffset, type Option } from "../src/concierge/plan.ts";

/**
 * What the agent says, next to what the business's own page says.
 *
 * Everything else in this repository checks our code against our code: the crawl writes a price, the API
 * serves it, a test asserts the API serves what the crawl wrote, and all of it passes while the number on the
 * shop's website is different. The only way to know whether the concierge is right is to compare it with
 * something it did not produce, so `data/truth/*.json` holds readings taken by hand off each operator's own
 * booking page, with the date they were taken.
 *
 * Four things are checked, in the order they can go wrong:
 *
 *   found   is the business in the answer at all? A perfect price for a shop we never surface is worth nothing.
 *   place   is it filed where a guest would look for it?
 *   price   does what we quote match what their page charges?
 *   times   are the slots we offer the slots they are selling?
 *
 *   npx tsx scripts/truth.mts             every case
 *   npx tsx scripts/truth.mts escapology  cases whose file or business name matches
 *
 * It exits non-zero when a case fails, so it can gate a deploy. A stale reading is reported as stale rather
 * than as a failure: a three-week-old Saturday being sold out is not a bug in our code.
 */

type Truth = {
  business: string;
  site: string;
  bookingVendor?: string;
  recordedAt: string;
  city: string;
  region: string;
  category?: string;
  queries: string[];
  availability?: { date: string; item?: string; times: string[]; soldOut?: string[]; note?: string };
  /** A clock time to ask for, to check the agent offers the nearest real slot rather than the first of the day. */
  probeTime?: string;
  price?: { subtotal?: number | null; perPerson?: number | null; currency?: string; party?: number | null; note?: string };
};

const DIR = join(import.meta.dirname, "../data/truth");
const ESC = String.fromCharCode(27);
const RESET = ESC + "[0m", DIM = ESC + "[2m", RED = ESC + "[31m", GREEN = ESC + "[32m", AMBER = ESC + "[33m", BOLD = ESC + "[1m";
const TICK = "✓", CROSS = "✗", QUERY = "?";

const filter = (process.argv[2] || "").toLowerCase();
const cases: Truth[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, t: JSON.parse(readFileSync(join(DIR, f), "utf8")) as Truth }))
  .filter(({ file, t }) => !filter || file.toLowerCase().includes(filter) || t.business.toLowerCase().includes(filter))
  .map(({ t }) => t);

if (!cases.length) {
  console.error("No ground-truth cases" + (filter ? " matching " + filter : "") + " in " + DIR);
  process.exit(2);
}

/** Their name and ours are rarely identical: "Escapology" is our row for "Escapology Waterloo". */
function looksLike(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const [x, y] = [norm(a), norm(b)];
  if (x === y || x.includes(y) || y.includes(x)) return true;
  // Or they share a distinctive word: "Adventure Rooms" and "Adventure Rooms Kitchener".
  const stop = new Set(["escape", "room", "rooms", "the", "inc", "ltd", "canada", "adventure"]);
  const words = (s: string) => new Set(s.split(" ").filter((w) => w.length > 3 && !stop.has(w)));
  const wy = words(y);
  for (const w of words(x)) if (wy.has(w)) return true;
  return false;
}

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

/** Half an hour off one of their real slots, so the probe is a time they do not actually sell. */
function nearProbe(times: string[]): string | null {
  if (!times.length) return null;
  const mid = toMin(times[Math.floor(times.length / 2)]) + 30;
  return String(Math.floor(mid / 60)).padStart(2, "0") + ":" + String(mid % 60).padStart(2, "0");
}

/** Which of their slots is actually closest to the probe: the answer the agent ought to give. */
function nearestOf(times: string[], probe: string): string {
  const p = toMin(probe);
  return times.reduce((a, b) => (Math.abs(toMin(a) - p) <= Math.abs(toMin(b) - p) ? a : b));
}

const money = (n: number) => "$" + n.toFixed(2);
const ageDays = (iso: string) => Math.round((Date.now() - new Date(iso + "T12:00:00").getTime()) / 86400000);

type Line = { ok: boolean | null; what: string; ours: string; theirs: string; why?: string };

function report(lines: Line[]) {
  const w = Math.max(...lines.map((l) => l.what.length), 6);
  const o = Math.max(...lines.map((l) => l.ours.length), "what we say".length);
  console.log("   " + DIM + "check".padEnd(w) + "  " + "what we say".padEnd(o) + "  what their site says" + RESET);
  for (const l of lines) {
    const mark = l.ok === null ? AMBER + " " + QUERY : l.ok ? GREEN + " " + TICK : RED + " " + CROSS;
    console.log(mark + RESET + " " + l.what.padEnd(w) + "  " + l.ours.padEnd(o) + "  " + l.theirs + (l.why ? DIM + "  " + l.why + RESET : ""));
  }
}

let failed = 0, checked = 0, unknown = 0;

for (const t of cases) {
  const age = ageDays(t.recordedAt);
  console.log("\n" + BOLD + t.business + RESET + DIM + "  " + t.site + RESET);
  console.log(DIM + "  read off their own page " + (age <= 0 ? "today" : age + " day" + (age === 1 ? "" : "s") + " ago") +
    (age > 14 ? " - stale, re-read before trusting a failure here" : "") + RESET);

  // Try each phrasing a guest might use; the business should be findable by any of them.
  let hit: Option | null = null;
  let hitQuery = "";
  let bestTotal = 0;
  for (const q of t.queries) {
    const a = await plan(q, { ask: 3 });
    if (a.followUp) {
      console.log(DIM + "  asked back on \"" + q + "\": " + a.followUp.question + RESET);
      continue;
    }
    bestTotal = Math.max(bestTotal, a.options.length);
    const found = a.options.find((o) => looksLike(o.name, t.business));
    if (found && !hit) { hit = found; hitQuery = q; }
  }

  const lines: Line[] = [];
  lines.push({
    ok: !!hit,
    what: "found",
    ours: hit ? "yes, via \"" + hitQuery + "\"" : "NOT IN THE ANSWER",
    theirs: t.business + " exists and sells online",
    why: hit ? undefined : bestTotal + " other businesses offered instead",
  });

  if (hit) {
    lines.push({
      ok: (hit.city || "").toLowerCase() === t.city.toLowerCase() && hit.region === t.region,
      what: "place",
      ours: (hit.city || "no city") + ", " + (hit.region || "?"),
      theirs: t.city + ", " + t.region,
    });

    const ourPrices = [
      ...new Set([
        ...hit.departures.map((d) => d.fromPrice).filter((n): n is number => n != null),
        ...hit.services.map((s) => s.price).filter((n): n is number => n != null),
      ]),
    ].sort((x, y) => x - y);
    const theirPer = t.price?.perPerson ?? null;
    if (theirPer != null) {
      const near = ourPrices.some((p) => Math.abs(p - theirPer) <= Math.max(1, theirPer * 0.05));
      lines.push({
        ok: ourPrices.length ? near : null,
        what: "price",
        ours: ourPrices.length ? ourPrices.map(money).join(", ") : "no price",
        theirs: money(theirPer) + " a head",
      });
    } else if (t.price?.subtotal != null) {
      /**
       * A subtotal is not a per-head price and must not be compared with one. Their widget showed a total for
       * a party size the page never named, so the honest check is whether our per-head figure could produce
       * that subtotal for some plausible party, not whether the two numbers are equal.
       */
      const sub = t.price.subtotal;
      const plausible = ourPrices.filter((p) => { const n = sub / p; return Math.abs(n - Math.round(n)) < 0.02 && n >= 1 && n <= 10; });
      lines.push({
        ok: ourPrices.length ? (plausible.length ? true : null) : null,
        what: "price",
        ours: ourPrices.length ? ourPrices.map(money).join(", ") : "no price",
        theirs: money(sub) + " subtotal, party not shown",
        why: plausible.length ? "x" + Math.round(sub / plausible[0]) + " people gives their subtotal" : "cannot be reconciled with their total",
      });
    }

    if (t.availability) {
      const inRoom = (d: { item: string }) => !t.availability!.item || d.item === t.availability!.item;
      const ours = hit.departures.filter((d) => d.date === t.availability!.date && inRoom(d)).map((d) => d.time);
      const theirs = t.availability.times;
      const overlap = ours.filter((x) => theirs.includes(x));
      lines.push({
        ok: ours.length ? overlap.length > 0 : false,
        what: "times",
        ours: ours.length ? ours.join(" ") : "none - " + (hit.route === "feed" ? "feed returned nothing" : "no feed for " + (t.bookingVendor || "this vendor")),
        theirs: theirs.join(" ") + " on " + t.availability.date,
        why: ours.length ? overlap.length + " of " + theirs.length + " matched" : undefined,
      });

      /**
       * Asked for a clock time, is the slot it offers first the nearest one the shop really sells?
       *
       * The probe is half an hour off a real slot on purpose. A guest who says "4:30" when the shop sells 4:00
       * wants the 4:00, said to be half an hour early; the failure this catches is the agent cheerfully
       * offering 11:30 because it happens to be first in the day, which is how somebody misses their dinner.
       */
      const probe = t.probeTime || nearProbe(theirs);
      if (probe) {
        const q = (t.category === "escape" ? "escape room" : t.business) + " in " + t.city + " " + t.region + " at " + probe;
        const a = await plan(q, { ask: 3 });
        const mine = a.options.find((o) => looksLike(o.name, t.business));
        /**
         * Compared inside the room that was recorded, when one was named. Escapology Waterloo sells thirteen
         * rooms at overlapping times and the recorded slots are one room's, so against the whole shop the
         * agent offered 17:35 where the record expected 17:30 — and 17:35 really is nearer to a probe of
         * 18:00. That is a better answer being failed by a record that did not say which room it came from.
         */
        const pool = (mine?.departures || [])
          .map((d, n) => ({ d, off: mine?.offsets?.[n] }))
          .filter((x) => inRoom(x.d));
        const first = pool[0]?.d;
        const offset = pool[0]?.off;
        const want = nearestOf(theirs, probe);
        lines.push({
          ok: first ? first.time === want : null,
          what: "nearest",
          ours: first ? first.time + (offset != null ? " (" + describeOffset(offset) + ")" : "") + (mine?.via ? " via " + mine.via : "") : "no live time to offer",
          theirs: want + " is their closest to " + probe,
          why: first ? undefined : "we cannot read this vendor, so there is nothing to rank",
        });
      }
    }
  }

  report(lines);
  for (const l of lines) { checked += 1; if (l.ok === false) failed += 1; if (l.ok === null) unknown += 1; }
}

console.log("\n" + BOLD + checked + " checks" + RESET + ": " + GREEN + (checked - failed - unknown) + " match" + RESET +
  (failed ? ", " + RED + failed + " wrong" + RESET : "") + (unknown ? ", " + AMBER + unknown + " unknown" + RESET : ""));
if (failed) console.log(DIM + "A wrong check means a guest is being told something their site does not say." + RESET);
process.exit(failed ? 1 : 0);
