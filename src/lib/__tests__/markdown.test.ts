import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { stripMarkdown } from "../markdown";
import { listingFacts, plainWords } from "../catalog";

/**
 * Markdown in the words a guest reads. Every line below is a real one from public/o, named by the listing it
 * came from. 54 lines across the shipped catalog reached a guest with the syntax still in them, on the listing
 * page, the phone sheet and the booking confirmation alike.
 */

test("a link is worth its words and an image is worth none", () => {
  assert.equal(
    stripMarkdown("FAQs [Read our full list of FAQs here.](https://www.rental.bigmmarina.com/faqs) Arrival"),
    "FAQs Read our full list of FAQs here. Arrival",
  ); // o-bigmmarina-com
  assert.equal(
    stripMarkdown("Check the map below: ![Ali'i Ocean Torus](https://d1a2dkr8rai8e2.cloudfront.net/api/file/BN) then park"),
    "Check the map below: then park",
  ); // o-aliioceantours-com
});

test("the crawl's 400-character cut leaves no bracket, label or half a URL behind", () => {
  // o-holoholocharters-com: the whole arrival note, as it shipped.
  assert.equal(stripMarkdown("Connect with Holoholo Charters [![TikTok](https://"), "Connect with Holoholo Charters");
  // o-stepintoalaska-com: cut on the opening parenthesis.
  assert.equal(
    stripMarkdown("Tour Location Elizabeth Peratrovich Plaza - [Google Maps Location]("),
    "Tour Location Elizabeth Peratrovich Plaza - Google Maps Location",
  );
  // o-navalbasecruises-com: cut inside the URL of a closed link.
  assert.equal(
    stripMarkdown("in the Heart of Coastal Virginia [1 Waterside Drive Norfolk, VA 23510](http"),
    "in the Heart of Coastal Virginia 1 Waterside Drive Norfolk, VA 23510",
  );
  // o-agpaintball-com: a full label with the address cut short.
  assert.equal(
    stripMarkdown("Check out our [Frequently Asked Questions](https://a"),
    "Check out our Frequently Asked Questions",
  );
});

test("a heading marker goes, whether it stands alone or is glued to the word before it", () => {
  assert.equal(stripMarkdown("Fuel charged separately Check in Location## 2200 Lakeshore Blvd"), "Fuel charged separately Check in Location 2200 Lakeshore Blvd"); // o-disneysboatrentals-com
  assert.equal(stripMarkdown("A tip for your great Guide! ### Please arrive on time."), "A tip for your great Guide! Please arrive on time."); // o-adventure60-com
  assert.equal(stripMarkdown("# Arrival"), "Arrival");
});

test("a bracket that is not a link is left exactly as the operator wrote it", () => {
  // 20 lines write a conversion in brackets. Reading one as a link would eat the number.
  assert.equal(
    stripMarkdown("temperatures range from -15ºF [-26ºC] to 50ºF [10ºC]."),
    "temperatures range from -15ºF [-26ºC] to 50ºF [10ºC].",
  ); // o-alaskaphototreks-com
  assert.equal(stripMarkdown("Arrive at Dock 2 [see the map]"), "Arrive at Dock 2 [see the map]");
});

test("a hash that numbers something is not a heading", () => {
  assert.equal(stripMarkdown("Slip: E084 Parking: lot #2"), "Slip: E084 Parking: lot #2"); // o-ohanasportfishingdanapoint-com
  assert.equal(stripMarkdown("Slip #E084"), "Slip #E084");
});

test("a line with no markdown in it comes back untouched", () => {
  const plain = "Please arrive 20-30 minutes before scheduled departure time.";
  assert.equal(stripMarkdown(plain), plain); // o-cavecountrycanoes-com
  assert.equal(stripMarkdown(""), "");
});

test("no shipped listing hands a guest markdown any more", () => {
  const dir = new URL("../../../public/o/", import.meta.url);
  const MD = /!\[[^\]]*\]\(|\[[^\]]*\]\(|(?:^|\s|\S)#{1,6}(?:\s|$)/;
  let n = 0;
  const bad: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const item = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    n++;
    const facts = listingFacts(item);
    for (const l of [...facts.who, ...facts.waiver]) if (MD.test(l.text)) bad.push(item.id + ": " + l.text.slice(0, 90));
    if (facts.note && MD.test(facts.note)) bad.push(item.id + " note: " + facts.note.slice(0, 90));
    if (item.checkin && MD.test(plainWords(item.checkin))) bad.push(item.id + " checkin: " + plainWords(item.checkin).slice(0, 90));
    if (item.blurb && MD.test(plainWords(item.blurb))) bad.push(item.id + " blurb: " + plainWords(item.blurb).slice(0, 90));
  }
  assert.ok(n > 50000, "expected the shipped catalog, swept " + n);
  assert.deepEqual(bad, [], bad.length + " lines still carry markdown, first: " + bad[0]);
});
