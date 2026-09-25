import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { kidRuleText, kidVerdict } from "../../../../src/lib/kidRule.ts";

/**
 * The browse catalog is a projection: it drops `specs`, `gap` and `extraNote` so the file stays small, and the
 * guest app's kids filter read exactly those three. So "Only places whose published rules allow younger kids"
 * was decided by the shop's kind alone, and 524 of the shipped listings were offered to a guest who typed
 * "with kids" although their own site says 18+, 21+ or adults only.
 *
 * Writing the projection needs the operator database, so this pins the coupling instead: the rule the app reads
 * is the rule the sync writes, and the flag is the only way the verdict can cross into a lite record.
 */

const SRC = readFileSync(new URL("../contacts.ts", import.meta.url), "utf8");

test("the sync carries the kid verdict onto the lite record", () => {
  assert.match(SRC, /kid:\s*\n?\s*kidVerdict\(/, "the lite record no longer carries the kids verdict");
  assert.match(SRC, /import \{ kidRuleText, kidVerdict \} from "\.\.\/\.\.\/\.\.\/src\/lib\/kidRule\.ts";/, "and it must be the app's own rule, not a second copy of it");
});

test("the three fields the rule reads are still emptied, which is why the flag exists", () => {
  const lite = SRC.slice(SRC.indexOf("// The browse catalog carries only what cards, rails and search need."));
  assert.match(lite.slice(0, 4000), /options: \[\], specs: \[\], includes: \[\], gap: ""/);
  assert.ok(!/extraNote:/.test(lite.slice(0, 4000)), "a lite record carries no extraNote either");
});

test("the rule answers the three ways the flag has to encode", () => {
  assert.equal(kidVerdict(kidRuleText({ specs: ["Guests must be 21+ after 8pm"] })), false);
  assert.equal(kidVerdict(kidRuleText({ specs: ["Ages 6+ welcome"] })), true);
  assert.equal(kidVerdict(kidRuleText({ specs: ["Open Tuesday to Sunday"] })), null, "silence stays absent, so the kind still decides");
});
