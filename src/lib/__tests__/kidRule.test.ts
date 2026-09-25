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
