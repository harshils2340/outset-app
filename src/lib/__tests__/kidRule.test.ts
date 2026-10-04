import test from "node:test";
import assert from "node:assert/strict";
import { kidFriendly } from "../search";
import { kidRuleText, kidVerdict } from "../kidRule";
import type { Unclaimed } from "../../data/types";

/**
 * "Only places whose published rules allow younger kids" is what the desktop home tells a guest who types
 * "with kids", "family friendly" or "toddler", and the filter behind that sentence is a hard one: a listing it
 * rejects is not shown at all. It read `specs`, `gap` and `extraNote`, and search runs on the browse catalog,
 * where the sync empties all three so the file stays small. So the only line of the rule that could ever fire
 * was its last one, the shop's kind, and 524 of the shipped listings were offered to that guest although their
 * own site says 18+, 21+ or adults only: breweries, 21-and-over bar nights, jet ski rentals that will not hand
 * a ski to a minor. Another 28 that welcome children were left out because their kind is skydiving or axe
 * throwing. The verdict is taken at sync time now and carried on the record as `kid`.
 */

function lite(fields: Partial<Unclaimed>): Unclaimed {
  return { art: "bowling", specs: [], gap: "", options: [], includes: [], lite: true, ...fields } as unknown as Unclaimed;
}

test("a shop's own words settle it, and silence is not a yes", () => {
  assert.equal(kidVerdict("Guests must be 21+ beginning at 8pm with valid ID"), false);
  assert.equal(kidVerdict("18+ with valid photo ID required to drive"), false);
  assert.equal(kidVerdict("Minimum age 18 for group trips"), false);
  assert.equal(kidVerdict("Adults only"), false);
  assert.equal(kidVerdict("Ages 8+ welcome"), true);
  assert.equal(kidVerdict("Great for the whole family"), true);
  assert.equal(kidVerdict("Open seven days a week"), null, "hours say nothing about who may come");
  assert.equal(kidVerdict(""), null);
});

test("an adult floor outranks a family word in the same listing", () => {
  assert.equal(kidVerdict("All ages welcome at the brewery. Must be 21+ to sit at the bar."), false);
});

test("the rule reads specs, the gap note, the extra note and the tags", () => {
  assert.equal(kidVerdict(kidRuleText({ specs: ["Ages 5+"] })), true);
  assert.equal(kidVerdict(kidRuleText({ gap: "Minimum age 21." })), false);
  assert.equal(kidVerdict(kidRuleText({ extraNote: "Adults only after 8pm." })), false);
  assert.equal(kidVerdict(kidRuleText({ tags: ["Kids Birthday Party"] })), true);
});

test("a lite record answers with the flag the sync carried, not with its kind", () => {
  // The same shop, twice: once as the browse catalog ships it, once as its detail file fills it in.
  const full = lite({ specs: ["Guests must be 21+ beginning at 8pm with valid ID"], lite: false });
  assert.equal(kidFriendly(full), false, "the full record reads the rule off the shop's own line");

  const thin = lite({ kid: false });
  assert.equal(kidFriendly(thin), false, "the lite record must say the same thing");

  const thinNoFlag = lite({});
  assert.equal(kidFriendly(thinNoFlag), true, "a shop that never says is still judged by its kind");
});

test("the flag also puts back a listing its kind alone would have dropped", () => {
  assert.equal(kidFriendly(lite({ art: "skydive" })), false);
  assert.equal(kidFriendly(lite({ art: "skydive", kid: true })), true);
  assert.equal(kidFriendly(lite({ art: "axe", kid: true })), true);
});

test("the record's own words beat a stale flag, so a claimed operator's edit is read at once", () => {
  const edited = lite({ kid: false, specs: ["Ages 6 and up, families welcome"] });
  assert.equal(kidFriendly(edited), true);
  const tightened = lite({ kid: true, specs: ["Adults only"] });
  assert.equal(kidFriendly(tightened), false);
});

/**
 * The grown-up's age is not the child's. Every line quoted here is a shipped one, and each was refused to a
 * guest filtering for younger kids although the shop's own sentence is that children may come if an adult
 * comes with them: Legoland Discovery Center, Bette's Fun Center, Zen Tubing, Rock Oasis, Xtreme Action Park,
 * The Escape House, Cipher Solver, James River Outfitters and Shepler's ferry among them.
 */
test("the age of the adult a child has to bring is not a floor on the child", () => {
  assert.equal(kidVerdict("Children (17 and under) must be accompanied and supervised by an adult (18+) at all times"), true);
  assert.equal(kidVerdict("Every group must include at least one adult (18+) to supervise minors"), null, "the escort line alone states nothing either way");
  assert.equal(kidVerdict("Children 13 and under must be supervised at ratio 2 children to 1 adult (adult must be 18+)"), true);
  assert.equal(kidVerdict("Guests under 18 must be accompanied by a parent or legal guardian 21+ who remains with them"), null, "no longer a door, and the line names no child");
  assert.equal(kidVerdict("Parent or guardian 18+ must sign waiver for minors; family campsites available"), true);
  assert.equal(kidVerdict("Anyone under 16, a paid adult (18+) must be present in the room. Recommended age 12 and up"), null, "a two digit floor is not a family word either way");
  assert.equal(kidVerdict("Wine shipments require signature of sober adult 21+"), null, "a courier's signature says nothing about who may visit");
});

test("a floor the shop states about the guest still refuses, escort line or not", () => {
  assert.equal(
    kidVerdict("Public cruises are 21+ or 18+ if accompanied by an adult. Children welcome on private charters"),
    false,
    "the cruise itself has a floor",
  );
  assert.equal(
    kidVerdict("Children must be accompanied by an adult 18+. The long beach location is 21+ only"),
    false,
    "one line is the escort, the other is the door",
  );
  assert.equal(kidVerdict("Minimum age 9 years; minors must be accompanied by an adult 18+ who fills out the waiver"), null);
});

test('"an adult only" is an escort, not a door', () => {
  // Shepler's ferry: "children under 5 travel free but must be accompanied by an adult" with the next line,
  // "Only trained service animals permitted", glued on to the end of it by the crawl.
  assert.equal(kidVerdict("Children under 5 travel free but must be accompanied by an adult only trained service animals permitted"), true);
  assert.equal(kidVerdict("Adults only"), false, "the plural, standing on its own, is still the door");
  assert.equal(kidVerdict("This is an adults only experience"), false);
});
