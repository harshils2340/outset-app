import assert from "node:assert/strict";
import test from "node:test";

import { clip } from "../clip.ts";

/**
 * Cutting a shop's prose to a budget. Every case below is a real one from the shipped catalog or from a
 * vendor fixture, named where it came from.
 */

test("text already inside the budget comes back whole, last word and all", () => {
  // The Peek reader chopped "Rentals" off Dogpatch Paddle's own 53-character line, because the cut it used
  // ran unconditionally: `slice(0, 700).replace(/\s+\S*$/, "")` eats the last word of every short string.
  assert.equal(clip("Beginner, Youth, Performance, and Dog Friendly Rentals", 700), "Beginner, Youth, Performance, and Dog Friendly Rentals");
  assert.equal(clip("Meet at the dock.", 400), "Meet at the dock.");
  assert.equal(clip("", 400), "");
});

test("a sentence end late in the budget is a real ending and needs no mark", () => {
  const text = "Please arrive twenty minutes early. Parking is limited and fills up on weekends, so leave time for it.";
  assert.equal(clip(text, 40), "Please arrive twenty minutes early.");
});

test("with no sentence to stop at, the cut backs up to a word and says the text goes on", () => {
  // o-1000islandexcursions-com shipped "...book another trip of equal or greater valu".
  const text = "If we cancel for weather 1000 Islands Excursions is able to book another trip of equal or greater value";
  const out = clip(text, 95);
  assert.equal(/valu$/.test(out), false, "the cut still lands inside a word");
  assert.equal(out.endsWith("…"), true);
  assert.equal(out, "If we cancel for weather 1000 Islands Excursions is able to book another trip of equal or…");
});

test("a comma left hanging by the cut comes off with it", () => {
  // o-extremearizona-com shipped "...charged for damages, recovery, downtime, cleaning,".
  const out = clip("Your credit card will be charged for damages, recovery, downtime, cleaning, and fuel", 75);
  assert.equal(out, "Your credit card will be charged for damages, recovery, downtime…");
});

test("one word longer than the whole budget has no boundary to back up to", () => {
  const out = clip("https://example.com/" + "a".repeat(80), 40);
  assert.equal(out.length <= 41, true);
  assert.equal(out.endsWith("…"), true);
});

test("the budget is never exceeded", () => {
  const text = "Guests must sign a waiver before boarding. ".repeat(40);
  for (const max of [40, 100, 240, 400, 500, 700, 1200]) {
    assert.equal(clip(text, max).length <= max + 1, true, "clip to " + max + " ran over");
  }
});

test("a shortened word is not a sentence end, so the cut backs up to one that is", () => {
  // The 300 characters below are the /l/ page's og:description, which is what a shared listing link previews
  // as. 109 of them ended on a shortened word: cutting at the last full stop inside the budget read
  // "Explore the George W." and "- Panoramic views of Mt.".
  const bush = "We love Dallas and you will find out why on this exciting city tour! Join your private Tour Guide and you’re off to enjoy the Highlights of Dallas. You will learn about Dallas' history, art, architecture, JFK, professional sports teams, parks and more.\n\nExplore the George W. Bush Presidential Library and Museum with your Guide. \"With its ";
  assert.equal(clip(bush, 300), "We love Dallas and you will find out why on this exciting city tour! Join your private Tour Guide and you’re off to enjoy the Highlights of Dallas. You will learn about Dallas' history, art, architecture, JFK, professional sports teams, parks and more.\n\nExplore the George W. Bush Presidential…");
  const rainier = "Join us for a thrilling gondola ride to the stunning Mt. Rainier, offering breathtaking views of the surrounding mountains and valleys. Enjoy a relaxing and scenic journey, taking in the majestic beauty of one of the Pacific Northwest's most iconic landmarks.\n\nHighlights:\n\n- Panoramic views of Mt. Rainier and the surrounding landscape\n- R";
  assert.equal(clip(rainier, 300), "Join us for a thrilling gondola ride to the stunning Mt. Rainier, offering breathtaking views of the surrounding mountains and valleys. Enjoy a relaxing and scenic journey, taking in the majestic beauty of one of the Pacific Northwest's most iconic landmarks.\n\nHighlights:\n\n- Panoramic views of…");
});

test("the words a sentence really does end on still end one", () => {
  // The other half of the rule. A unit and a decade end a sentence, so they are not on the list, and capitals
  // tell "Ft." (Fort) from "ft." (feet): all three of these read correctly before and must still.
  const tahoe = "If you are looking for an exhilarating journey through the stunning backcountry of Lake Tahoe, the Summit Snowmobile Tour promises an unforgettable experience. Your adventure starts at the top of the trailhead in beautiful Hope Valley at an elevation of 7,200 ft. This guided, two-hour adventure is perfect for beginners and intermediate ri";
  assert.equal(clip(tahoe, 300), "If you are looking for an exhilarating journey through the stunning backcountry of Lake Tahoe, the Summit Snowmobile Tour promises an unforgettable experience. Your adventure starts at the top of the trailhead in beautiful Hope Valley at an elevation of 7,200 ft.");
  const skiing = "Whether you're a complete novice or a seasoned slalom skier, get ready to carve up the water like a pro. While wakeboarding has taken the spotlight, water skiing remains a classic thrill—a timeless sport that's as glamorous today as it was in the '60s. At Miami Watersports Paradise, our expert instructors and top-of-the-line equipment wil";
  assert.equal(clip(skiing, 300), "Whether you're a complete novice or a seasoned slalom skier, get ready to carve up the water like a pro. While wakeboarding has taken the spotlight, water skiing remains a classic thrill—a timeless sport that's as glamorous today as it was in the '60s.");
  const miami = "Enjoy a 3-4 hr Magic City Tour with expert private guide with tour customized for you\nAdrienne has over 30 years of experience in the tour, travel, and private guide profession. Adrienne knows all the secret places to visit on your trip in Miami or Ft. Lauderdale, and with tour guides in every language reserved.";
  assert.equal(clip(miami, 300), "Enjoy a 3-4 hr Magic City Tour with expert private guide with tour customized for you\nAdrienne has over 30 years of experience in the tour, travel, and private guide profession. Adrienne knows all the secret places to visit on your trip in Miami or Ft. Lauderdale, and with tour guides in every…");
});

test("a stop inside an unclosed bracket is not a sentence end either", () => {
  // o-chitimacha-gov writes its Saturday rule inside a bracket it opens and never closes inside the budget.
  const museum = "The Chitimacha Museum preserves and promotes the enduring heritage and pride of Southern Louisiana’s original inhabitants. Open Monday - Thursday from 9:00 am - 4:30 pm.Lunch hour is 12- 1:00 pm.Friday 9:00 am - 11:30 am(Saturday admission by appointment only. Please call at least 2 weeks in advance to set up your appointment). Groups of ";
  assert.equal(clip(museum, 300), "The Chitimacha Museum preserves and promotes the enduring heritage and pride of Southern Louisiana’s original inhabitants. Open Monday - Thursday from 9:00 am - 4:30 pm.Lunch hour is 12- 1:00 pm.Friday 9:00 am - 11:30 am(Saturday admission by appointment only. Please call at least 2 weeks in…");
});
