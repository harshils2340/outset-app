import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

import { GUESTS_UNKNOWN, guestCapFor, maxGuestsFor } from "../catalog";
import type { Unclaimed } from "../../data/types";

/**
 * The largest party the guest picker offers, against what the listing above it says the shop can take.
 *
 * The page printed "Up to 6 guests" in its key facts and offered twenty in its stepper, on 1,217 shipped
 * listings. Every group line below is a real one from public/o, named by the listing it came from.
 */

const listing = (o: Partial<Unclaimed>): Unclaimed =>
  ({ id: "o-test", title: "Test", options: [], ...o }) as Unclaimed;

/** A service holding one priced tier, the shape the picker reads `maxGuests` off. */
const service = (maxGuests: number | undefined) => ({
  name: "Charter",
  variants: [{ label: "Half day", price: 400, optionIdx: 0 }],
  ...(maxGuests == null ? {} : { maxGuests }),
});

test("the shop's own group line is the ceiling the picker offers", () => {
  // o-4reel-charters-com, o-1000islandsprivateboattours-com, o-actionsportfishingmaui-com.
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Boat accommodates up to 6 passengers"] }), null), 6);
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Maximum 6 guests on The Ultimate Boat Day"] }), null), 6);
  // o-allinonecharters-com, whose own menu row reads "up to maximum party size of 6".
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Fishing charters accommodate up to 6 passengers"] }), null), 6);
  // o-603balloonrides-com: a basket for four was quoting a party of twenty $6,000.
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Balloon basket holds up to 4 passengers plus pilot"] }), null), 4);
});

test("a listing that states nothing keeps the generous fallback", () => {
  assert.equal(maxGuestsFor(listing({}), null), GUESTS_UNKNOWN);
  assert.equal(maxGuestsFor(listing({ groupInfo: [] }), null), GUESTS_UNKNOWN);
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Private events and corporate bookings welcome"] }), null), GUESTS_UNKNOWN);
  assert.equal(guestCapFor(listing({}), null), null);
});

test("a floor is never read as the ceiling, so nobody is turned away at the stepper", () => {
  // o-arapahoefc-com: "minimum 2 passengers" capping the picker at two would be worse than the bug it fixes.
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Helicopter tours require minimum 2 passengers and have weight restrictions"] }), null), GUESTS_UNKNOWN);
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Minimum 25 people for group visits"] }), null), GUESTS_UNKNOWN);
});

test("a shop with room to spare is not narrowed to sixty by a line about its lawn", () => {
  // o-austinspark-com and o-enchantedisland-com state thousands. Stating room is not asking for a wider picker.
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Group events for 10 to 3,000 guests with customizable packages"] }), null), GUESTS_UNKNOWN);
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Private picnic grounds accommodate up to 10,000 people"] }), null), GUESTS_UNKNOWN);
  assert.equal(maxGuestsFor(listing({ groupInfo: ["Groups of up to 24 welcome"] }), null), GUESTS_UNKNOWN);
});

test("an operator who set a capacity is the shop speaking today, so it wins", () => {
  const claimed = listing({ groupInfo: ["Boat accommodates up to 6 passengers"], services: [service(10)] });
  assert.equal(maxGuestsFor(claimed, 0), 10);
  // And with no capacity set on the service, the crawled line still holds.
  const unset = listing({ groupInfo: ["Boat accommodates up to 6 passengers"], services: [service(undefined)] });
  assert.equal(maxGuestsFor(unset, 0), 6);
});

test("a stated ceiling is what the guest is told, and the fallback is told to nobody", () => {
  assert.equal(guestCapFor(listing({ groupInfo: ["Boat accommodates up to 6 passengers"] }), null), 6);
  assert.equal(guestCapFor(listing({ groupInfo: ["Private picnic grounds accommodate up to 10,000 people"] }), null), null);
  assert.equal(guestCapFor(listing({ services: [service(12)] }), 0), 12);
});

test("both booking surfaces read the one helper, so they cannot offer different parties", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  for (const [name, src] of [
    ["the phone listing sheet", read("../../components/booking/Sheets.tsx")],
    ["the desktop listing page", read("../../components/web/WebListing.tsx")],
  ] as const) {
    assert.match(src, /maxGuestsFor\(item, optionIdx\)/, name + " takes its ceiling from the helper");
    assert.match(src, /guestCapFor\(item, optionIdx\)/, name + " names the limit that stopped the stepper");
  }
});
