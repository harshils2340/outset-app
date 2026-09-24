/**
 * What a guest is told the price covers, held to the catalog the app ships.
 *
 * `splitIncluded` sorts a shop's published `includes` lines into the two columns the desktop listing page and
 * the phone booking sheet both draw: a green tick for what comes with the trip, a cross for what does not.
 * Three ways a line ended up under the tick saying the opposite of what the shop wrote:
 *
 * - The "Not included:" label was stripped off the front and then looked for. "Not Included: Gratuity for your
 *   guide" became "Gratuity for your guide", which carries no marker, so 2 shipped listings ticked a gratuity
 *   and a captain's tip as included.
 * - A thing the shop sells beside the trip is not a thing the trip comes with. 86 lines on 81 shipped listings
 *   ticked "Golf clubs rental (extra fee)", "Snacks and drinks available for purchase", "Fish cleaning service
 *   available for additional fee" and "Photos and videos available for purchase starting at $50".
 * - The section's own heading came along with the first bullet, so the page read "What's included" and then
 *   "What's Included: Guests will enjoy a grand buffet dinner", on 42 lines across 27 listings.
 *
 * Every line below is a real one from `public/o`, named by the listing it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { companyReply } from "../companyAgent";
import type { Unclaimed } from "../../data/types";
import { splitIncluded } from "../listingDerive";

const yes = (lines: string[]) => splitIncluded(lines).yes;
const no = (lines: string[]) => splitIncluded(lines).no.map((n) => n.text);

test("a line labelled Not included is not an inclusion", () => {
  // o-kanabtourcompany-com and o-parasailsiesta-com, both ticked as included.
  assert.deepEqual(yes(["Not Included: Gratuity for your guide"]), []);
  assert.deepEqual(no(["Not Included: Gratuity for your guide"]), ["Gratuity for your guide"]);
  assert.deepEqual(no(["Not Included: Captain/Deck Hand Gratuities are NOT automatically included in your price."]), [
    "Captain/Deck Hand Gratuities are NOT automatically included in your price.",
  ]);
});

test("what the shop sells beside the trip is not what the trip comes with", () => {
  for (const line of [
    "Golf clubs rental (extra fee)", // o-bearcreekaz-com
    "Golf carts available at extra cost", // o-blandfordcountryclub-com
    "Snacks and drinks available for purchase", // o-braggcreekpaintball-com
    "Fish cleaning service available for additional fee", // o-kingeiderfishing-com
    "Photos and videos available for purchase starting at $50", // o-skycombatace-com
    "Personal training sessions (additional cost)", // o-crunch-com
    "Full bar and concessions onboard (food and drinks for purchase)", // o-circleline-com
    "30-minute lesson and 90 minutes of curling may be added for an additional fee", // o-crestwoodcurling-com
    "Tasting Upgrades at extra cost", // a-viator-129234p2
  ]) {
    assert.deepEqual(yes([line]), [], `ticked as included: ${line}`);
    assert.deepEqual(no([line]), [line], `lost the shop's own words: ${line}`);
  }
});

test("the shop's own words are kept, not struck through into a different claim", () => {
  // Striking "Full bar with light snacks" would say the bar is missing. The shop said it costs money.
  const split = splitIncluded(["Full bar with light snacks available for purchase"]);
  assert.equal(split.no[0].strike, false);
  assert.equal(split.no[0].text, "Full bar with light snacks available for purchase");
});

test("a line that states both an inclusion and a thing for sale stays an inclusion", () => {
  for (const line of [
    "Your first drink is included, with additional drinks and light snacks available for purchase.", // o-vistafleet-com
    "Clams are supplied on all trips and worms are available for purchase on Open Boat trips and included on all Private Charters.", // o-soundboundcharters-com
    "Trip includes all snorkel equipment, T-top wetsuits and all non-alcoholic beverages, with beer, wine and spirits available for purchase.", // o-konastyle-com
  ]) {
    assert.deepEqual(yes([line]), [line], `moved a line that states an inclusion too: ${line}`);
  }
});

test("a thing offered at no extra charge is included", () => {
  for (const line of [
    "Fish cleaned and packaged at no extra charge", // o-a-bayfishing-com
    "Equipment for batting cages (helmets/bats) at no additional cost", // o-adventurecoastfunpark-com
    "Paddleboards included at no extra charge", // o-bigwiliwateradventures-com
  ]) {
    assert.deepEqual(yes([line]), [line], `read "no extra charge" as a charge: ${line}`);
  }
});

test("the section's own heading does not ride the first bullet", () => {
  assert.deepEqual(yes(["What's Included: Guests will enjoy a grand buffet dinner, dessert, coffee, tea, water."]), [
    "Guests will enjoy a grand buffet dinner, dessert, coffee, tea, water.",
  ]); // o-cornucopiacruise-com
  assert.deepEqual(yes(["Includes: 2-hour guided E-Bike ride."]), ["2-hour guided E-Bike ride."]); // o-advoutwest-com
  assert.deepEqual(yes(["Inclusions: Paddles, life jackets, and adjustable backrests are included."]), [
    "Paddles, life jackets, and adjustable backrests are included.",
  ]); // o-heeiakeaharbor-com
  assert.deepEqual(yes(["Included: Our Iconic Full Open Bar!"]), ["Our Iconic Full Open Bar!"]); // o-keywestcocktailcruise-com
  // A heading with nothing under it is not a bullet.
  assert.deepEqual(splitIncluded(["What's included:"]), { yes: [], no: [] });
});

test("what the split already got right is unchanged", () => {
  assert.deepEqual(no(["Fuel (not included)"]), ["Fuel"]);
  assert.deepEqual(no(["Gratuity is not included in the ticket price"]), ["Gratuity is not included in the ticket price"]);
  assert.deepEqual(yes(["Bottled water", "Bottled water"]), ["Bottled water"]);
  assert.deepEqual(yes(["Bring your own towel"]), []);
});

/* ---------- the whole shipped catalog ---------- */

const DIR = new URL("../../../public/o/", import.meta.url);
type Detail = { id: string; includes?: string[]; affiliate?: unknown };
function details(): Detail[] {
  const out: Detail[] = [];
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const j = JSON.parse(readFileSync(new URL(f, DIR), "utf8")) as Detail;
      if (j.includes?.length) out.push(j);
    } catch {
      /* a file the sync is mid-write on is not this test's business */
    }
  }
  return out;
}

const HEADING = /^(?:not included|what(?:'|’)?s? (?:is )?included|what is included|included|includes|inclusions?|package includes)\s*:/i;
const COSTS_EXTRA = /\b(?:at|for)\s+(?:an?\s+)?(?:extra|additional)\s+(?:cost|charge|fee|price)\b|\(\s*(?:extra|additional)\s+(?:cost|charge|fee)\s*\)|\bavailable for purchase\b|\bfor purchase\b|\bcosts? extra\b/i;
const ALSO_INCLUDED = /\bincluded\b|\bincludes\b|\bprovided\b|\bsupplied\b|\bcomplimentary\b|\bfree of charge\b|\bat no (?:extra|additional)\b/i;

test("no shipped listing ticks its own exclusions as included", () => {
  const rows = details();
  assert.ok(rows.length > 9000, `only ${rows.length} detail files with includes: the catalog did not load`);
  const headings: string[] = [];
  const extras: string[] = [];
  for (const row of rows) {
    for (const line of splitIncluded(row.includes!).yes) {
      if (HEADING.test(line)) headings.push(`${row.id}: ${line}`);
      if (COSTS_EXTRA.test(line) && !ALSO_INCLUDED.test(line)) extras.push(`${row.id}: ${line}`);
    }
  }
  assert.deepEqual(headings, [], `the section heading is still on the bullet:\n${headings.slice(0, 8).join("\n")}`);
  assert.deepEqual(extras, [], `still ticked as included though the shop charges for it:\n${extras.slice(0, 8).join("\n")}`);
});

test("the split never loses a line the shop published", () => {
  for (const row of details()) {
    const split = splitIncluded(row.includes!);
    // Every kept line is one column or the other, never both.
    const both = split.yes.filter((y) => split.no.some((n) => n.text === y));
    assert.deepEqual(both, [], `${row.id} printed a line in both columns: ${both.join(" | ")}`);
  }
});

/**
 * 14 shipped listings publish the same thing in both halves of their own list, so the page both promised and
 * denied it: a-viator-132218p188 lists "Admission fees" and "Admission fees (not included)", a-viator-14868p19
 * "All Fees and Taxes" twice over.
 */
test("a page does not promise what the same list excludes", () => {
  const split = splitIncluded(["Bottled water", "Admission fees", "Gratuities (not included)", "Admission fees (not included)"]);
  assert.deepEqual(split.yes, ["Bottled water"]);
  assert.deepEqual(
    split.no.map((n) => n.text),
    ["Gratuities", "Admission fees"],
  );
});

/* ---------- the third surface: Otto ---------- */

/**
 * Otto is sold to claimed operators and answers "what's included?" off the same field. It read that field raw,
 * so it read a shop's own exclusions out as things a guest gets: "Included: gratuities, hotel pickup and
 * drop-off (not included) and lunch". It reads the split now, like the page and the sheet.
 */
test("Otto does not read a shop's exclusions out as things included", () => {
  const item = {
    id: "o-test",
    title: "Test Charters",
    cat: "boating",
    art: "boat",
    area: "Tampa, FL",
    metroId: "tampa",
    src: "test.com",
    specs: [],
    options: [],
    gap: "",
    includes: ["Bottled water", "Gratuities (not included)", "Lunch (not included)", "Snacks available for purchase"],
  } as unknown as Unclaimed;
  const answer = companyReply({ item, contact: null }, "what's included?");
  assert.match(answer, /Bottled water|bottled water/);
  assert.doesNotMatch(answer, /Gratuities|gratuities/, `Otto offered an exclusion as included: ${answer}`);
  assert.doesNotMatch(answer, /Lunch|lunch/, `Otto offered an exclusion as included: ${answer}`);
  assert.doesNotMatch(answer, /for purchase/, `Otto offered what the shop sells separately as included: ${answer}`);

  // A shop whose every published line is an exclusion has still answered the question.
  const allOut = { ...item, includes: ["Gratuities (not included)", "Lunch (not included)"] } as Unclaimed;
  const second = companyReply({ item: allOut, contact: null }, "what's included?");
  assert.match(second, /Not included/i, `Otto said nothing where the shop said something: ${second}`);
});
