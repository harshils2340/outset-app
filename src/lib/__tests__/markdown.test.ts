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
  // 59,126 before the publish gate of 18 September 2026 ("a listing reaches guests once we have read something
  // off its own site"); 48,199 operators plus 1,873 partner products after the first sync through it.
  assert.ok(n > 40000, "expected the shipped catalog, swept " + n);
  assert.deepEqual(bad, [], bad.length + " lines still carry markdown, first: " + bad[0]);
});

test("a run of asterisks is emphasis or decoration, and neither is words", () => {
  // a-viator-120411p3 opens its description with one, a-viator-169395p4 puts one around a single word.
  assert.equal(stripMarkdown("**SPRING-SUMMER-FALL**\n\nEnjoy a cool drink"), "SPRING-SUMMER-FALL Enjoy a cool drink");
  assert.equal(stripMarkdown("Complimentary **local** pick up"), "Complimentary local pick up");
  assert.equal(stripMarkdown("** PLEASE NOTE THAT THIS TOUR IS VERY WEATHER DEPENDENT**"), "PLEASE NOTE THAT THIS TOUR IS VERY WEATHER DEPENDENT");
  // o-210studioseattle-com runs two of its own headings together with six asterisks between the words.
  assert.equal(stripMarkdown("***IN PIONEER SQUARE******SPACE SIZES VARY***"), "IN PIONEER SQUARE SPACE SIZES VARY");
});

test("a single asterisk is a bullet as often as an emphasis, so it stays", () => {
  // o-bellevuewilmington-com lists its inclusions with one. Taking it out runs the items together.
  const list = "Included: * FREE PARKING LOT * 50 black Chiavari chairs * 9 six-foot tables";
  assert.equal(stripMarkdown(list), list);
  assert.equal(stripMarkdown("Hurricane Sundeck DC *Premium Exclusive* Call"), "Hurricane Sundeck DC *Premium Exclusive* Call"); // o-boatelmers-com
});

test("no shipped listing hands a guest a bold marker", () => {
  const dir = new URL("../../../public/o/", import.meta.url);
  const bad: string[] = [];
  const walk = (id: string, v: unknown) => {
    if (typeof v === "string") {
      if (v.includes("**") && plainWords(v).includes("**")) bad.push(id + ": " + plainWords(v).slice(0, 90));
      return;
    }
    if (Array.isArray(v)) return void v.forEach((x) => walk(id, x));
    if (v && typeof v === "object") for (const k of Object.keys(v)) walk(id, (v as Record<string, unknown>)[k]);
  };
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const item = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    walk(item.id, item);
  }
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " lines still carry one");
});
