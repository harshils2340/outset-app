/**
 * What a "from" price is per, on the two phone surfaces that print a unit beside it.
 *
 * `perPerson` reads the option that sets the price, and defaults to per person when the option's own words say
 * nothing. Both phone surfaces asked it a different question: they printed "/ person" when there was no option
 * at all, which is every card in the phone feed, because the rails and the feed paint from the lite shard and a
 * lite record ships `options: []`. So a $1,000 event space priced per group, a $450 balloon ride priced per
 * hour, a $700 charter priced per trip and a $175 private boat tour priced per hour all read "/ person" on the
 * card a guest taps: 2,509 of the 10,217 priced listings in the shipped catalog.
 *
 * Both desktop surfaces already said nothing where they had no option to read (`WebListing`'s `fromUnit` is ""
 * when `defaultOption` finds none, and the desktop card prints no unit at all), so this is the phone catching
 * up rather than a new rule.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import type { UnclaimedOption } from "../../data/types";
import { perPerson } from "../catalog";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const CARD = read("../../components/explore/UnclaimedCard.tsx");
const SHEETS = read("../../components/booking/Sheets.tsx");

test("neither phone surface claims a unit without the option that sets the price", () => {
  for (const [name, src, decl] of [
    ["the feed card", CARD, /const per = unit && perPerson\(unit\) \? " \/ person" : "";/],
    ["the booking sheet", SHEETS, /const fromPer = fromUnit && perPerson\(fromUnit\) \? " \/ person" : "";/],
  ] as const) {
    assert.match(src, decl, name + " prints a unit only when it has the option");
    assert.doesNotMatch(src, /!unit \|\| perPerson|!fromUnit \|\| perPerson/, name + " no longer assumes per person with nothing to read");
  }
});

test("the option's own words still decide the unit when the detail file is in hand", () => {
  const per = (o: Partial<UnclaimedOption>) => perPerson({ name: "", detail: "", price: 1, ...o } as UnclaimedOption);
  // o-2226studio-com, o-2flyus-com, o-2lagooncharters-com, o-1stclasscharterboatrental-com: the four shapes the
  // card was getting wrong, each still read as flat now that the option reaches the rule.
  assert.equal(per({ name: "Studio 2226 Event Space Rental", detail: "Bundle package", per: "/group" }), false);
  assert.equal(per({ name: "Balloon Rides", detail: "", per: "/hour" }), false);
  assert.equal(per({ name: "5-hour fishing trip", detail: "5-hour guided fishing trip", per: "/trip" }), false);
  assert.equal(per({ name: "Sea Doo Jet Ski Rental", detail: "One hour rental", per: "/jet ski" }), false);
  // And a per-head option still says so, so the fix takes nothing off a listing that does state its unit.
  assert.equal(per({ name: "Sunset sail", detail: "Two hours", per: "/person" }), true);
  assert.equal(per({ name: "Adult admission", detail: "" }), true);
});

test("a lite record carries no option to read, which is what the feed paints from", () => {
  const dir = new URL("../../../public/o/", import.meta.url);
  const shipped = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(shipped.length > 40000, "the sweep below is against the whole shipped catalog");
  let priced = 0;
  let flat = 0;
  for (const f of shipped) {
    let item: { affiliate?: unknown; options?: UnclaimedOption[] };
    try {
      item = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    } catch {
      continue;
    }
    if (item.affiliate) continue;
    const prices = (item.options || []).map((o) => o.price).filter((n): n is number => n != null && n > 0);
    if (!prices.length) continue;
    priced++;
    const from = Math.min(...prices);
    const unit = (item.options || []).find((o) => o.price === from);
    if (unit && !perPerson(unit)) flat++;
  }
  // The listings the old rule was wrong about. The count is a floor rather than an equality so a re-crawl that
  // reads one more rate card does not go red for it.
  assert.ok(priced > 9000, "priced listings: " + priced);
  assert.ok(flat > 2000, "listings whose cheapest price is not per person: " + flat);
});
