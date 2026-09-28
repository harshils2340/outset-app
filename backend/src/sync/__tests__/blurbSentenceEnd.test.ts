import assert from "node:assert/strict";
import test from "node:test";

import { cleanBlurb } from "../contacts.ts";

/**
 * The blurb is the first thing a guest reads about a shop, on the card, on the listing page and in the chat,
 * and `cleanBlurb` cuts it to 600 characters at the last sentence end inside that budget. A shortened word
 * ends in a full stop too, so the last one is often not a sentence end at all: 73 shipped blurbs read "The Art
 * of Alfred A.", "a snow capped Mt." and "hosted names like Joe Pesci, Michael B.".
 *
 * Both texts below are shipped blurbs, long enough that the cut runs.
 */

test("a blurb is never cut at a shortened word, so an honorific keeps its name", () => {
  const dc =
    "Experience Washington, DC by night on this 2-hour walking tour that begins with a stunning panoramic skyline view from Arlington Ridge. Stroll across the Arlington Memorial Bridge and explore iconic memorials, including the Lincoln Memorial, Vietnam Veterans Memorial, Korean War Veterans Memorial, and World War II Memorial, with the monuments beautifully reflected in the glimmering pools along the National Mall. End at the Martin Luther King Jr. Memorial, illuminated along the Tidal Basin, for a magical view of DC’s skyline and historic monuments — perfect for photographers, couples, and first-time visitors. Your guide will share fascinating stories and historical insights that bring each memorial to life.";
  const out = cleanBlurb(dc);
  assert.equal(out.endsWith("Martin Luther King Jr."), false, "the cut still lands on the honorific");
  assert.equal(out.endsWith("along the National Mall."), true);
});

test("a shop keeps its blurb even where every stop inside the budget is a shortened word", () => {
  // No sentence end at all is what the checks at the end of cleanBlurb throw the whole blurb away for, so the
  // old cut stands rather than costing a shop its only words.
  const abbreviations = "Meet Capt. " + "Bob and his crew at the dock on Main St. ".repeat(40);
  const out = cleanBlurb(abbreviations);
  assert.equal(out.length > 40, true, "the blurb was dropped instead of cut");
  assert.equal(/[.!?]$/.test(out), true);
});
