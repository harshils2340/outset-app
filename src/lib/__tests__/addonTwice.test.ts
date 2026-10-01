/**
 * Two rows of one menu carrying the same name, held to the catalog the app ships.
 *
 * A booking stores the option it picked as an index and every extra by name, so the confirmation screen has
 * to find the menu rows again from those names. It filtered the menu by them, which hands back every row
 * carrying one: on the 7 shipped listings whose menus name an extra twice, ticking a single $6 "Gas Premium"
 * produced two lines totalling $11. The screen prints its price details only when they add up to the total the
 * booking stored, so what the guest actually saw was the breakdown silently gone, on the one screen whose job
 * is to say what they are paying for. The picker above it had the matching fault: two buttons under one React
 * key, where the phone sheet and the "What you can book" list three lines up both key on the row's position.
 *
 * `pickedAddons` takes a row per name picked and a different row each time a name is picked twice, which is
 * the reading `priceBooking` makes on the server: the first row carrying a name unless the guest's own total
 * says they meant another.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { addonPrice, pickedAddons, priceUnclaimed } from "../pricing";
import type { UnclaimedOption } from "../../data/types";

const dir = new URL("../../../public/o/", import.meta.url);
type Detail = { id?: string; addons?: UnclaimedOption[] };

const row = (name: string, price: number | null): UnclaimedOption => ({ name, detail: "", price }) as UnclaimedOption;
// o-marinas-com sells fuel at two grades under one name; o-buffalocreekgc-com the same lesson at two prices.
const gas = [row("Gas Premium", 5), row("Gas Premium", 6), row("Ice", 4)];

test("one tick takes one row, and it is the row the server charges by default", () => {
  const got = pickedAddons(gas, ["Gas Premium"]);
  assert.equal(got.length, 1);
  assert.equal(addonPrice(got[0]), 5);
});

test("ticking both takes both, and neither twice", () => {
  const got = pickedAddons(gas, ["Gas Premium", "Gas Premium"]);
  assert.deepEqual(got.map(addonPrice), [5, 6]);
});

test("a name the menu no longer carries drops out rather than throwing", () => {
  assert.deepEqual(pickedAddons(gas, ["Wetsuit", "Ice"]).map((a) => a.name), ["Ice"]);
  assert.deepEqual(pickedAddons(undefined, ["Ice"]), []);
});

test("the extras a confirmation adds up are the ones the guest ticked, not every row sharing a name", () => {
  const trip = row("Pontoon, half day", 300);
  const before = priceUnclaimed(trip, 2, gas.filter((a) => ["Gas Premium"].includes(a.name)));
  const after = priceUnclaimed(trip, 2, pickedAddons(gas, ["Gas Premium"]));
  assert.equal(before.add, 11); // what the filter produced: both grades, for one tick
  assert.equal(after.add, 5);
  assert.ok(after.total < before.total);
});

test("every shipped menu that names an extra twice is read a row per tick", () => {
  const dups: string[] = [];
  for (const f of readdirSync(dir)) {
    const d = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Detail;
    const addons = d.addons || [];
    const names = addons.map((a) => a.name);
    if (new Set(names).size === names.length) continue;
    dups.push(f);
    // Whatever the guest ticked, one name is one row, and the rows handed back are distinct menu entries.
    for (const name of new Set(names)) {
      const once = pickedAddons(addons, [name]);
      assert.equal(once.length, 1, f + " gave " + once.length + " rows for one tick of " + name);
    }
    const all = pickedAddons(addons, names);
    assert.equal(all.length, names.length, f);
    assert.equal(new Set(all).size, all.length, f + " handed one menu row back twice");
  }
  // A floor rather than an equality: a sync may read another shop's menu this way, and that is not a failure.
  assert.ok(dups.length >= 7, "expected at least the 7 known listings, saw " + dups.length);
});
