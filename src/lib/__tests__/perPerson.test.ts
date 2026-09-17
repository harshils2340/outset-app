import { strict as assert } from "node:assert";
import test from "node:test";

import { perPerson } from "../catalog";
import { priceUnclaimed } from "../pricing";
import { perPerson as serverPerPerson } from "../../../backend/src/payments/money";
import type { UnclaimedOption } from "../../data/types";

/**
 * Whether a price is multiplied by the party. The unit the operator's own site prints settles it, and it is
 * read before the option's words, because those words carry the party a service holds at least as often as the
 * party it is priced for. Each row below is a real one from public/o.
 */

const opt = (o: Partial<UnclaimedOption> & { price: number | null }): UnclaimedOption => ({
  name: "",
  detail: "",
  ...o,
}) as UnclaimedOption;

test("a capacity in the words does not turn a group price into a price per guest", () => {
  // o-sandpipergolf-com: the worst of the 1,726. "up to 200 guests" is the room's size, not the bill.
  const venue = opt({ name: "Event Venue Rental Riviera Lawn", detail: "Event space for up to 200 guests with ocean and mountain views", per: "/group", price: 18500 });
  assert.equal(perPerson(venue), false);
  assert.equal(priceUnclaimed(venue, 4).sub, 18500);
});

test("a guide ratio and a seat count read the same way", () => {
  // o-aleutianadventures-com and o-theflightking-com.
  assert.equal(perPerson(opt({ name: "Sapsuk River Camp Fly Fishing Package", detail: "6 nights guided fishing with 2:1 guest to guide ratio", per: "/group", price: 9325 })), false);
  assert.equal(perPerson(opt({ name: "Extra Large Jet Charter", detail: "Jets seating 12-19 passengers", per: "/hr", price: 9600 })), false);
});

test("a person in the name never overrides the unit the site printed", () => {
  // o-30ainshorecharters-com, o-kelownakarting-com, o-bostonharbormarina-com.
  assert.equal(perPerson(opt({ name: "Kid Friendly Trip", detail: "2-hour private fishing charter", per: "/group", price: 375 })), false);
  assert.equal(perPerson(opt({ name: "Adult Karting Party Bronze", detail: "Party package with 2 adult karting races for up to 8 participants", per: "/group", price: 499 })), false);
  assert.equal(perPerson(opt({ name: "Child Sit On Top Kayak Rental", detail: "For kids 7 y/o and up to paddle alone", per: "/trip", price: 35 })), false);
});

test("a night, a vehicle and a half hour are things, not people", () => {
  // o-alongtherivernh-com, o-epic4x4adventures-com, o-goldengatekarateschool-com.
  assert.equal(perPerson(opt({ name: "RV site", per: "/night", price: 48 })), false);
  assert.equal(perPerson(opt({ name: "Poison Spider Mesa Tour", detail: "Polaris RZR Pro R 2-seater", per: "/vehicle", price: 419 })), false);
  assert.equal(perPerson(opt({ name: "Private Instructor Lessons", per: "/30 min", price: 50 })), false);
  assert.equal(perPerson(opt({ name: "Jet ski rental", per: "/jet ski", price: 199 })), false);
});

test("a unit that names a person still multiplies", () => {
  // o-shahandshah-test-onoutset-com, and the /child and /adult rate cards in the catalog.
  assert.equal(perPerson(opt({ name: "Sunset sail", detail: "2 hours", per: "/person", price: 29 })), true);
  assert.equal(perPerson(opt({ name: "Museum entry", per: "/child", price: 8 })), true);
  assert.equal(perPerson(opt({ name: "Museum entry", per: "/adult", price: 14 })), true);
  assert.equal(priceUnclaimed(opt({ name: "Sunset sail", per: "/person", price: 29 }), 4).sub, 116);
});

test("the operator's own switch still beats every unit", () => {
  assert.equal(perPerson(opt({ name: "Whole boat", per: "/boat", price: 400, perGuest: true })), true);
  assert.equal(perPerson(opt({ name: "Tasting", per: "/person", price: 25, perGuest: false })), false);
});

test("a unit nobody stated is still read from the words", () => {
  // "each" is what Resova writes for a per-person price, and 17 options in the catalog carry it.
  assert.equal(perPerson(opt({ name: "Escape room", detail: "60 minutes", per: "each", price: 32 })), true);
  assert.equal(perPerson(opt({ name: "Adult ticket", price: 20 })), true);
  assert.equal(perPerson(opt({ name: "Pontoon rental", detail: "4 hour rental", price: 350 })), false);
});

test("the guest page and the server price a booking the same way", () => {
  // money.ts is what the card is charged; catalog.ts is what the booking box quotes. They are twins by design.
  const rows: UnclaimedOption[] = [
    opt({ name: "Event Venue Rental Riviera Lawn", detail: "Event space for up to 200 guests", per: "/group", price: 18500 }),
    opt({ name: "Kid Friendly Trip", detail: "2-hour private fishing charter", per: "/group", price: 375 }),
    opt({ name: "RV site", per: "/night", price: 48 }),
    opt({ name: "Museum entry", per: "/child", price: 8 }),
    opt({ name: "Escape room", detail: "60 minutes", per: "each", price: 32 }),
    opt({ name: "Pontoon rental", detail: "4 hour rental", price: 350 }),
    opt({ name: "Whole boat", per: "/boat", price: 400, perGuest: true }),
  ];
  for (const r of rows) assert.equal(perPerson(r), serverPerPerson(r), r.name + " " + (r.per || ""));
});
