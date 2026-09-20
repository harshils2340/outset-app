import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle } from "../contacts.ts";

/**
 * The name a guest reads, on the card, the hero, the page title, the landing pages and the confirmation. It had
 * no test of its own. Run over all 59,125 shipped names, `cleanTitle` was not idempotent: feeding a published
 * name back through it changed 50 of them, which is the sync's own output saying it had not finished.
 */

test("a name cut to length does not end on the word the cut left dangling", () => {
  /**
   * 15 published names ended on a preposition or a conjunction. The rule that drops one ran before the 70
   * character trim, and trimming at a word boundary makes a dangling word of its own, so it never saw them.
   */
  for (const [raw, want] of [
    ["Delray Beach, Florida Balloon Delivery & Balloon Decor by BalloonPlanet.com", "Delray Beach, Florida Balloon Delivery & Balloon Decor"],
    ["Vertical Illusions Wisconsin Dells Zip Line, Kayak, Rock Climb, And Ziplining Adventures", "Vertical Illusions Wisconsin Dells Zip Line, Kayak, Rock Climb"],
    ["Reginald F Lewis Museum of Maryland African-American History and Culture", "Reginald F Lewis Museum of Maryland African-American History"],
    ["Surf Lessons in Florida with EZride Surf School Florida. Learn to Surfboard", "Surf Lessons in Florida with EZride Surf School Florida. Learn"],
    ["Historical Society and Museum of the California Department of Forestry and Fire Protection", "Historical Society and Museum of the California Department"],
  ] as const) {
    assert.equal(cleanTitle(raw), want, raw);
    assert.doesNotMatch(cleanTitle(raw), /\s(?:of|for|with|and|or|to|our|your|by|at|in)$/i, raw);
  }
});

test("a phone number is not part of a business name", () => {
  for (const [raw, want] of [
    ["Beverly Hills Day Spa (850) 714-4459", "Beverly Hills Day Spa"],
    ["Wet Willy's WaterSports 609-972-1730", "Wet Willy's WaterSports"],
    ["Fort Myers Beach (239) 765.8500", "Fort Myers Beach"],
    ["Siesta Key Bike and Kayak Rentals -941-346-0891", "Siesta Key Bike and Kayak Rentals"],
    ["Emerald Oasis Mobile Massage 910-705-6253", "Emerald Oasis Mobile Massage"],
  ] as const) {
    assert.equal(cleanTitle(raw), want, raw);
  }
});

test("a price, a licence number and an appointment note are not part of a name either", () => {
  for (const [raw, want] of [
    ["Orlando Fishing for $99", "Orlando Fishing"],
    ["Helicopter Riding Tours in Orlando Starting at $45", "Helicopter Riding Tours in Orlando"],
    ["St. Petersburg Street Food Tour from $143.05", "St. Petersburg Street Food Tour"],
    ["Jasmine Day Spa (561) 557-3748 By appointment only Lic# MM32019", "Jasmine Day Spa"],
    ["Red Beard Boats, Boat Rentals & More(by appointment only)", "Red Beard Boats, Boat Rentals & More"],
  ] as const) {
    assert.equal(cleanTitle(raw), want, raw);
  }
});

test("a listing site's own truncation is not a name, and neither is an invisible character", () => {
  assert.equal(cleanTitle("GGs Spa ..."), "GGs Spa");
  assert.equal(cleanTitle("Dillies Jet Ski Rentals LLC..."), "Dillies Jet Ski Rentals LLC");
  // An ellipsis leaves its own dangling word behind: "Rentals At ..." is "Rentals".
  assert.equal(cleanTitle("St. Augustine Kayak Tour & Matanzas River Rentals At ..."), "St. Augustine Kayak Tour & Matanzas River Rentals");
  // A left-to-right mark and a zero width space, both straight off the operator's own page.
  assert.equal(cleanTitle("Arroyo Trabuco Golf Club‎"), "Arroyo Trabuco Golf Club");
  assert.equal(cleanTitle("​The Whiting Boathouse"), "The Whiting Boathouse");
});

test("a name that is only a name keeps every word of it", () => {
  for (const name of [
    "Licensed Captain Charters",
    "Hangar 45 Aviation",
    "Route 66 Tours",
    "Fifty - Fifty Water Sports",
    "Cooking@Millie's",
    "Celtic Axe Throwing @ Corner 14",
    "Home Range Brewing",
    "Home, Sweet Home Museum",
    "Topwater Charters",
    "Co|So: Copley Society of Art".replace("|", "/"),
  ]) {
    assert.equal(cleanTitle(name), name, name);
  }
});

test("cleaning a name twice says the same thing as cleaning it once", () => {
  for (const raw of [
    "Beverly Hills Day Spa (850) 714-4459",
    "Delray Beach, Florida Balloon Delivery & Balloon Decor by Balloon Planet Florist",
    "Jasmine Day Spa (561) 557-3748 By appointment only Lic# MM32019",
    "GGs Spa ...",
    "Sky Combat Ace | San Diego",
    "Welcome to the Official Axe & Ale Website",
    "Orlando Fishing for $99",
  ]) {
    const once = cleanTitle(raw);
    assert.equal(cleanTitle(once), once, raw);
  }
});
