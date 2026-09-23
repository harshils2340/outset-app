import { test } from "node:test";
import assert from "node:assert/strict";
import { contradictedPrice } from "../contacts.ts";

/**
 * A row that states its own price and is then published at a different one prints both numbers on the same line.
 * 15 shipped rows did: "4-Hour Sailfishing: $700" at $850, "Two Races (Adult Kart) $56" at $399, "Private 1-Hour
 * Sunset Boat Tour $175" at $40, "Fort Myers- Whole Day Pass - $199" at $3.
 *
 * The name is usually the truthful half, and it is still not believed, because "$20,000 Maui JIM Grand Prix" is
 * the prize money and taking it would advertise a show jumping class at twenty thousand dollars. Dropping the
 * number is right in all 15, and it is the rule the rest of the sync already follows: keep the honest gap.
 *
 * A figure that is the face value of something the row includes is not a contradiction and keeps its price.
 */

const drops = (name: string, dollars: number) => contradictedPrice(name, dollars * 100) != null;

test("a name that states a different price gives up the number", () => {
  assert.ok(drops("Fort Myers- Whole Day Pass - $199", 3));
  assert.ok(drops("Private 1-Hour Sunset Boat Tour $175, Entire boat. Romantic Date", 40));
  assert.ok(drops("4-Hour Sailfishing: $700", 850));
  assert.ok(drops("Two Races (Adult Kart) $56", 399));
  assert.ok(drops("Single Person Charter $375", 475));
  assert.ok(drops("20' Car Hauler - From $65", 85));
  assert.ok(drops("24' Ice Castle RV Extreme Edition Single Night $675· 2 Nights", 350));
});

test("prize money is not believed either, it is only refused", () => {
  // Reading the name would put a $20,000 show jumping class on the card. The comma survives the parse.
  assert.equal(contradictedPrice("$20,000 Maui JIM Grand Prix 1.45M", 2000), "its name states $20000, the row holds $20");
});

test("a name that states the price it is published at is left alone", () => {
  assert.equal(contradictedPrice("Monthly RV Full Hook Up is $600", 60000), null);
  assert.equal(contradictedPrice("Tandem Skydive $289 per person", 28900), null);
  // A range keeps its price when either end matches.
  assert.equal(contradictedPrice("4-packs from $10.99 to $18.99", 1099), null);
});

test("the face value of something the row includes is not a contradiction", () => {
  assert.equal(contradictedPrice("Unlimited Attractions plus $10 Arcade Card", 2599), null);
  assert.equal(contradictedPrice("Unlimited Rides + $20 Bonus Cash Fun Card", 6200), null);
  assert.equal(contradictedPrice("Value Card $200 Credit", 16000), null);
  assert.equal(contradictedPrice("Dining Credit $150", 13500), null);
  assert.equal(contradictedPrice("$250 Two Harbors Dining Credit", 20000), null);
  assert.equal(contradictedPrice("Lift or Loose - $50 Pool", 17000), null);
});

test("a name with no figure in it is never touched", () => {
  assert.equal(contradictedPrice("Half Day Inshore Charter", 85000), null);
  assert.equal(contradictedPrice("30ft Center Console Boat Deep Sea Charter - Full Day", 20000), null);
});
