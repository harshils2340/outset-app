import test from "node:test";
import assert from "node:assert/strict";
import { isConcessionFare, openFarePrice } from "../fares.ts";

/**
 * A headline price has to be a price the reader could actually pay.
 *
 * The cheapest row in a fare list is almost always the infant or child one, so a naive "from" price picks
 * it every time: a ten-person offsite was quoted "$20.14 · Infant", and a guest looking at a listing page
 * saw a child fare as the price of the slot. The concierge already refused to do this for FareHarbor and
 * `enrich/availability.ts`, which is what the guest listing page reads, had no such rule at all. Same data,
 * two readers, two different prices for the same shop.
 */

test("an age fare is never the headline while an adult fare exists", () => {
  const fares = [
    { name: "Infant", price: 20.14 },
    { name: "Child (3-11)", price: 45 },
    { name: "Senior", price: 70 },
    { name: "Adult", price: 89 },
  ];
  assert.equal(openFarePrice(fares, (f) => f.price, (f) => f.name), 89);
});

test("a shop that only sells concessions still gets a price", () => {
  // A children's play centre sells nothing else. Showing nothing would be worse than showing what it costs.
  const fares = [{ name: "Child", price: 18 }, { name: "Toddler", price: 12 }];
  assert.equal(openFarePrice(fares, (f) => f.price, (f) => f.name), 12);
});

test("unnamed fares are all buyable, because nothing says otherwise", () => {
  // Peek prices a bike rental by duration and names none of the rows. The cheapest way in is the right answer.
  const fares = [{ name: null, price: 49 }, { name: null, price: 98 }, { name: null, price: 196 }];
  assert.equal(openFarePrice(fares, (f) => f.price, (f) => f.name), 49);
});

test("zero and nonsense are not prices", () => {
  // A zero is the vendor saying "ask us", not "free", and quoting $0.00 is worse than quoting nothing.
  const fares = [{ name: "Adult", price: 0 }, { name: "Adult", price: Number.NaN }, { name: "Adult", price: 55 }];
  assert.equal(openFarePrice(fares, (f) => f.price, (f) => f.name), 55);
  assert.equal(openFarePrice([{ name: "Adult", price: 0 }], (f) => f.price, (f) => f.name), null);
});

test("only age words count, so real tickets an adult can buy are left alone", () => {
  for (const yes of ["Infant", "child", "Children 2-12", "Kids", "Youth", "Junior", "Student", "Senior", "Toddler", "Veteran"]) {
    assert.equal(isConcessionFare(yes), true, yes);
  }
  // Excluding these would push the headline price up, which is its own kind of lie.
  for (const no of ["Adult", "Group of 6", "Private charter", "Resident rate", "Member", "Standard", "Sunset sail"]) {
    assert.equal(isConcessionFare(no), false, no);
  }
});

test("a fare word buried inside a longer word is not a fare type", () => {
  // The word boundaries are what keep this from eating real ticket names. "Skidoo" contains "kid",
  // "Seniority" contains "senior", "Kidney" contains "kid", and none of them is a concession.
  for (const no of ["Skidoo tour", "Seniority Lounge", "Kidney Island cruise", "Childress TX day trip"]) {
    assert.equal(isConcessionFare(no), false, no);
  }
  // A real fare word still counts wherever it sits in the label, which is how they are actually written.
  for (const yes of ["Adult · Child add-on", "Ticket (Senior)", "2026 Youth Rate"]) {
    assert.equal(isConcessionFare(yes), true, yes);
  }
});
