import assert from "node:assert/strict";
import test from "node:test";

import { normalizeReview } from "../reviews.ts";

/**
 * A review card prints the reviewer's name once, beside their words. 53 shipped reviews printed it twice,
 * because the shop's own page closed the quote and put the byline behind it and the crawl kept both: the card
 * read "... Thank you captain Len!"Jim B." with "Jim B." under it. Every case below is a shipped review.
 */

const read = (author: string | null, text: string) =>
  normalizeReview({ author, rating: 5, text, date: "2025-06-01", source: "site", sourceUrl: "" })?.text ?? null;

test("a name behind the closing quote is the byline, not the review", () => {
  // o-capecodsportsmen-com closes with a straight quote and no space at all.
  assert.equal(
    read("Jim B.", 'No one better than Captain Len. We have been out twice with him and both have been extremely memorable days. Extremely knowledgeable, friendly and funny! We will absolutely be out again for our annual trip. Thank you captain Len!"Jim B.'),
    "No one better than Captain Len. We have been out twice with him and both have been extremely memorable days. Extremely knowledgeable, friendly and funny! We will absolutely be out again for our annual trip. Thank you captain Len!",
  );
  // A handle rather than a name, same shop.
  assert.equal(
    read("casey2x2", 'Been out with these guys for years. We have always come back with strippers. If fishing is slow, they work their butts off to get you to multiple spots to ensure you have a great experience."casey2x2')?.endsWith("great experience."),
    true,
  );
  // o-chicagosailboatcharters-com and o-captainhoggscharters-com use a curly quote, with and without a dash,
  // and neither passes an author through at all.
  assert.equal(
    read(null, "After doing a ton of research, I came upon Chicago Sailboat Charters. They were quick to respond and answered all of my questions. I ended up booking a Cruiser Class Power Boat for a bachelorette party of 11 girls.” Lindsey S."),
    "After doing a ton of research, I came upon Chicago Sailboat Charters. They were quick to respond and answered all of my questions. I ended up booking a Cruiser Class Power Boat for a bachelorette party of 11 girls.",
  );
  assert.equal(
    read(null, "We booked a half day trip with Captain Hogg, and everything was perfect from there.”— Mark C"),
    "We booked a half day trip with Captain Hogg, and everything was perfect from there.",
  );
});

test("the same name again at the end of a finished sentence comes off too", () => {
  // o-clearwaterinshorefishing-com signs each review with no quote and no dash.
  assert.equal(
    read("Larry L.", "I highly recommend Brian, my son and I went today and caught a lot of quality fish. He explained and worked with my son the whole trip and took time to teach him methods and the whys of how we fished. Excellent. Larry L."),
    "I highly recommend Brian, my son and I went today and caught a lot of quality fish. He explained and worked with my son the whole trip and took time to teach him methods and the whys of how we fished. Excellent.",
  );
  // o-capecodcharterguys-com writes the name with a full stop after it.
  assert.equal(
    read("Captain Ross", "Ross put us on fish all day and worked the boat to our maximum ability. Looking forward to our next trip. Captain Ross.")?.endsWith("our next trip."),
    true,
  );
});

test("a captain thanked by name inside the words keeps his name", () => {
  // The rule only reads a name that follows a finished sentence, a quote or a dash, so a review that thanks the
  // person it names mid-sentence is left as the guest wrote it.
  const thanks = "We had the best morning out on the water and caught more than we could eat. Thanks again, Brian!";
  assert.equal(read("Brian", thanks), thanks);
  const named = "The whole crew was patient with our children and the boat was spotless throughout the whole trip. We would sail again with Captain Rob";
  assert.equal(read("Captain Rob", named), named);
});
