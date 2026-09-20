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

/**
 * The ages a shop writes in numbers rather than words, and the far more common numbers that are not ages.
 *
 * The numeric branch of this rule had no test of its own, and it believed every small number on a menu line.
 * Excluding a fare can only push the headline up, so each misread over-quoted a guest with the shop's own
 * second-cheapest row: 206 of the 212,052 shipped menu rows were misread, and 18 listings quoted the wrong
 * price because of it. The shapes below are all real lines from the catalog.
 */
test("an age written in numbers is a concession fare", () => {
  for (const yes of [
    "Little Ones 5-17", // the Channel Islands sheet this branch was written for
    "Wise Ones 65+",
    "Little Ones 5–17", // an en dash is the same label
    "Pro-D Day Camp- ages 5-12",
    "St. Mary's Fall 2026 (7-11 y/o)",
    "Cours d'escalade 3-15 ans",
    "Golden 80+ years", // a year behind a plus-form is an age, unlike a minute or a ball
    "Session B (Ages 12-17)",
  ]) {
    assert.equal(isConcessionFare(yes), true, yes);
  }
});

test("a clock, a date, a span and a party are not ages", () => {
  for (const no of [
    "Fishing Charter (1-2 anglers)", // $550, dropped in favour of the $600 three-angler trip
    "Public Cruises Sat., Sept. 19, River Tour: 1-2:30 pm", // $25, dropped for a $1,600 private charter
    "Party Yacht 2-hour cruise (6-8 PM)", // a clock with no colon at all
    "Lounge Like a Local Open 11-7 pm",
    "CrossFit 5:30-6:30 AM",
    "Session 2 Dates: July 5-10, 2026",
    "Cruising Brigadoon - Early Season (5/1 - 6/15)",
    "Santa Clara Taproom Beer 20-30 rotating beers on tap, $7-9 each",
    "Adult Tennis Doubles Drills Level 2.5-3.5",
    "Harrison Lake Bumper Boat Rental 1/2-1 hour",
    "Casting Lessons: 1-2 Hours",
    "Offshore Fishing 0-15 Miles Trip",
    "Shrink Wrapping Runabout Boat 12-15 Feet",
    "Private Instruction 1-2 sessions",
    "Antipasto Salad (10-12 servings)",
    "Deluxe Ice Fishing House Rental Sleeps 2-4",
    "Accelerated Free Fall Levels 2-7",
    "Classical Ballet Exams Grades 1-2",
    "Alpine Racing Series Rounds 2-4",
    "Back-in sites 1-16",
    "#23 - 16' Dolphin Slide",
    "VIP Flight for 3-4",
    "RV site Monthly: 60+ days' notice", // a plus-form is an age only when what follows is not a span
    "60+ minutes",
    "70+ balls",
    "Freefall Photography 75+ photos download",
  ]) {
    assert.equal(isConcessionFare(no), false, no);
  }
});

test("a party size is not a child fare, however the vendor spells it", () => {
  // Every escape room on Xola and Rezdy prices by the size of the team, and both readers kept their own
  // copy of this rule for a night: the copies had no capacity guard, so a room's real tiers read as
  // children's tickets and the headline became whatever was left.
  for (const no of ["2-8 Players", "4-6 guests", "Group from 1 to 2", "Semi-Private Lesson (2-5 ppl)", "1-3 passengers", "Team of 2-6"]) {
    assert.equal(isConcessionFare(no), false, no);
  }
});

test("the headline is the cheapest fare an adult can buy, not the cheapest row", () => {
  // Mountain Skills Academy's real sheet, as Rezdy publishes it.
  const rezdy = [
    { name: "Youth (8-16 Years)", price: 114 },
    { name: "Adult (Per Person)", price: 149 },
  ];
  assert.equal(openFarePrice(rezdy, (f) => f.price, (f) => f.name), 149);
  // An escape room's own tiers, where the cheapest row is the one to quote.
  const room = [{ name: "2-4 Players", price: 35 }, { name: "5-8 Players", price: 30 }];
  assert.equal(openFarePrice(room, (f) => f.price, (f) => f.name), 30);
});
