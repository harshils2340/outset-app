import { test } from "node:test";
import assert from "node:assert/strict";
import { bookableOptions } from "../contacts.ts";

/**
 * `options` and `services` are two views of one crawled menu, joined by an `optionIdx` that is a position in
 * `options`. An earlier fix taught `options` to drop a membership, a season pass and a gift card, the way
 * `services` already did, but the services loop went on numbering its tiers against the whole menu. So from the
 * first dropped row onwards every tier pointed one place too far: a guest picking "2.5 hours, $220" would have
 * selected the row under it, and the last tier on the menu pointed past the end of the list at nothing at all.
 *
 * Nothing shipped with it, because `public/o` was written before the options filter existed. The next sync is
 * what would have carried it to guests, which is why this is a test and not a repair.
 */

const row = (name: string, price_cents: number | null = 10000) => ({ name, price_cents });
const plan = (menu: { name: string; price_cents: number | null }[]) => {
  const { optionIdxOf, menuRowOf } = bookableOptions(menu, "water");
  return { kept: menuRowOf.map((i) => menu[i].name), idx: menu.map((_m, i) => optionIdxOf.get(i) ?? null) };
};

test("a gift card in front of a charter does not push the charter's tier off the end", () => {
  const { kept, idx } = plan([row("Gift Card"), row("2.5 Hour Charter", 22000), row("Sunset Cruise", 9000)]);
  assert.deepEqual(kept, ["2.5 Hour Charter", "Sunset Cruise"]);
  assert.deepEqual(idx, [null, 0, 1]);
});

test("a menu with nothing to drop is numbered exactly as it was", () => {
  const { kept, idx } = plan([row("Tandem Skydive", 24900), row("Solo Jump", 19900)]);
  assert.deepEqual(kept, ["Tandem Skydive", "Solo Jump"]);
  assert.deepEqual(idx, [0, 1]);
});

test("every row a membership, a pass or a gift card names is still dropped", () => {
  const { kept } = plan([row("Annual Membership", 5000), row("Season Pass", 30000), row("Gift Certificate"), row("Two Hour Kayak Rental", 4500)]);
  assert.deepEqual(kept, ["Two Hour Kayak Rental"]);
});

test("the archive of what a museum used to show never becomes an option", () => {
  const { kept, idx } = plan([row("Past Exhibitions", 500), row("Guided Tour", 2000), row("Past Exhibits", null)]);
  assert.deepEqual(kept, ["Guided Tour"]);
  assert.deepEqual(idx, [null, 0, null]);
});

test("an FAQ heading with nothing priced under it goes, and a priced one stays", () => {
  assert.deepEqual(plan([row("Do you offer parasailing?", null), row("Parasail Flight", 8500)]).kept, ["Parasail Flight"]);
  assert.deepEqual(plan([row("What is an escape room?", 4000)]).kept, ["What is an escape room?"]);
});
