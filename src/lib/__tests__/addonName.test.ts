/**
 * The add-on rows in the booking box, held to the catalog the app ships.
 *
 * An option row and a service row are printed through `tidyName`, which is the word pass every crawled row
 * name gets before a guest reads it: a leading bullet goes, a lowercase opener is capitalised, a shout is
 * sentence-cased, a space in front of the shop's own punctuation closes, and the glossary spells out what a
 * guest would not know. An add-on row was never given that pass, so the Add-ons list sat directly under the
 * "What you can book" list with one cleaned and one raw, and the price breakdown under it named the option
 * tidied and the add-on as the crawl found it.
 *
 * 195 add-on names on 136 shipped listings read differently for it. Every line below is a real one from
 * `public/o`, named by the listing it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { tidyLine } from "../listingDerive";

const dir = new URL("../../../public/o/", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
type Detail = { id: string; addons?: { name: string; detail?: string }[] };
const details = (): Detail[] => readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Detail);

test("a bullet's hyphen and a list number are the page's, not the add-on's", () => {
  assert.equal(tidyLine("- Two Passenger Private Flight"), "Two Passenger Private Flight"); // o-altitudeendeavors-com
  assert.equal(tidyLine("-Double rider tube rental"), "Double rider tube rental"); // o-bayventureboatrentals-com
  assert.equal(tidyLine("- Additional bunnies (extra pen)"), "Additional bunnies (extra pen)"); // o-bunnyluv-org
  assert.equal(tidyLine("2. Home Delivery"), "Home Delivery"); // o-boatrentalseekers-com
  assert.equal(tidyLine(": 1-hour guided tours"), "1-hour guided tours"); // o-charlestonriverfrontwatersports-com
});

test("an add-on that opens lowercase or shouts reads like the row above it", () => {
  assert.equal(tidyLine("each additional person"), "Each additional person"); // o-airboatineverglades-com
  assert.equal(tidyLine("all additional seats"), "All additional seats"); // o-azttg-com
  assert.equal(tidyLine("tie-dye beach towel"), "Tie-dye beach towel"); // o-camptekakwitha-org
  assert.equal(tidyLine("FUN GUIDED SURF FISHING TRIPS (4 hours)"), "Fun guided surf fishing trips (4 hours)"); // o-americanseafishing-com
  assert.equal(tidyLine("GUIDED NATURE HIKE: 30-40 min"), "Guided nature hike: 30-40 min"); // o-calusanature-org
});

test("the space in front of the shop's own punctuation closes, and the glossary is spelled out", () => {
  assert.equal(tidyLine("Group lesson : 45min"), "Group lesson: 45min"); // o-akoballet-com
  assert.equal(tidyLine("Upgrades Available : Boxes and Banks"), "Upgrades Available: Boxes and Banks"); // o-ceramicafenw-com
  assert.equal(tidyLine("Cost per passenger : US"), "Cost per passenger: US"); // o-balloonovermiami-com
  assert.equal(tidyLine("SUP Lessons 75 minutes"), "Stand-up paddleboard Lessons 75 minutes"); // o-5280paddlesports-com
});

test("the add-on names the rest of the catalog publishes are left as the shop wrote them", () => {
  for (const name of ["Wetsuit rental", "Photo package", "GoPro rental", "Extra hour", "Prime Rib", "Kayak (single)"]) {
    assert.equal(tidyLine(name), name, name);
  }
});

/**
 * The scale of it, measured rather than asserted: the count only falls as the crawl cleans its own menus, so
 * what this guards is that the rule still reaches the rows it was written for and has not started rewriting a
 * catalog that was already clean.
 */
test("the shipped add-on names that read differently are the ones this was written for", () => {
  let rows = 0;
  let changed = 0;
  const listings = new Set<string>();
  for (const j of details()) {
    for (const a of j.addons || []) {
      rows++;
      const name = String(a.name || "");
      if (name && tidyLine(name) !== name) {
        changed++;
        listings.add(j.id);
      }
    }
  }
  assert.ok(rows > 3000, "the catalog stopped shipping add-ons, got " + rows);
  assert.ok(changed >= 150, "the rule stopped reaching the add-ons it was written for, got " + changed);
  assert.ok(changed < rows / 4, "the rule is rewriting add-on names that were already clean, got " + changed + " of " + rows);
  assert.ok(listings.size < 400, "far more listings than the 136 measured, got " + listings.size);
});

test("every surface that prints an add-on prints it through the row rule", () => {
  const surfaces = [
    ["../../components/web/WebListing.tsx", 3],
    ["../../components/web/WebConfirm.tsx", 1],
    ["../../components/booking/Sheets.tsx", 2],
  ] as const;
  for (const [rel, count] of surfaces) {
    const src = read(rel);
    // The add-on's own rows, wherever the file draws one: the picker and the price breakdown.
    assert.equal((src.match(/tidyName\(a\.name\)/g) || []).length, count, rel);
    // Nothing prints the stored name straight into the page any more. `key={a.name}` is identity, not text.
    assert.ok(!/[>{]\s*\{a\.name\}/.test(src.replace(/key=\{a\.name[^}]*\}/g, "")), rel + " still prints a raw add-on name");
    assert.ok(!/\{a\.detail\}/.test(src), rel + " still prints a raw add-on detail");
  }
});
