import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { cleanDesc } from "../listingDerive";
import { plainWords } from "../catalog";
import type { Unclaimed } from "../../data/types";

/**
 * The call-to-action words `cleanDesc` cuts out of a shop's own copy, swept over every blurb and service
 * description the catalog ships.
 *
 * Each of them is also an ordinary English word, and the rule used to match the bare word anywhere, so it took
 * sentences apart on 1,035 listings: 1,300 texts lost a word they needed and only 41 of the cuts were a button
 * the crawl had swept up. "Select" was 538 of them and never once a button.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const punctOnly = (raw: string) => plainWords(raw).replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
const cut = (raw: string) => cleanDesc(raw) !== punctOnly(raw);

test("a call to action inside the shop's own sentence is left alone", () => {
  assert.equal(cleanDesc("We will learn more about chocolate varietals."), "We will learn more about chocolate varietals.");
  assert.equal(cleanDesc("Our experienced guides select the best breweries in town."), "Our experienced guides select the best breweries in town.");
  assert.equal(cleanDesc("Enjoy transportation from select Strip hotels."), "Enjoy transportation from select Strip hotels.");
  assert.equal(cleanDesc("This tour delivers. Book now for an insider's look."), "This tour delivers. Book now for an insider's look.");
  assert.equal(cleanDesc("For more information, click here to visit the Education Tours Page."), "For more information, click here to visit the Education Tours Page.");
});

test("a button the crawl swept up goes, and the separator it sat behind goes with it", () => {
  assert.equal(cleanDesc("Tandem jumps, solo dives, breathtaking views. Book now!"), "Tandem jumps, solo dives, breathtaking views.");
  assert.equal(cleanDesc("Ages 18+ • 3 Hours • Book Now"), "Ages 18+ • 3 Hours");
  assert.equal(cleanDesc("$80/Person · BOOK NOW!"), "$80/Person");
  assert.equal(cleanDesc("For all ages! • 1Hr 45Min • Sells Out - Book Now!"), "For all ages! • 1Hr 45Min • Sells Out");
  assert.equal(cleanDesc("Book Now for an Unforgettable Journey!"), "Book Now for an Unforgettable Journey!");
});

test("the separator that starts the next row survives, and a trailing one is not left dangling", () => {
  assert.equal(cleanDesc("Up to 12 People! • Casco Bay! • Book Online! • 1.5 Hours"), "Up to 12 People! • Casco Bay! • 1.5 Hours");
  assert.equal(cleanDesc("Single ticket with United and Alaska Airlines. Book now >"), "Single ticket with United and Alaska Airlines.");
});

test("a sentence that ends on a call to action keeps its last words", () => {
  // "So what are you waiting for? BOOK NOW!" used to read "So what are you waiting for? !".
  assert.equal(cleanDesc("So what are you waiting for? BOOK NOW!"), "So what are you waiting for?");
  assert.equal(cleanDesc("Email us to schedule a class or to learn more"), "Email us to schedule a class or to learn more");
  assert.equal(cleanDesc("Visit our page Winter Flying to learn more."), "Visit our page Winter Flying to learn more.");
});

test("every cut the shipped catalog still takes is at the end of a row or a sentence", () => {
  const listings = new Set<string>();
  let texts = 0;
  const midSentence: string[] = [];
  for (const f of readdirSync(dir)) {
    const it = listing(f.replace(/\.json$/, ""));
    const all: string[] = [];
    if (typeof it.blurb === "string" && it.blurb) all.push(it.blurb);
    for (const s of (it as { services?: { desc?: string }[] }).services || []) if (s.desc) all.push(s.desc);
    for (const raw of all) {
      const before = punctOnly(raw);
      const after = cleanDesc(raw);
      if (before === after) continue;
      texts++;
      listings.add(String(it.id));
      // The words the two share up to the cut. A cut that is honest sits on a seam: the copy before it ends on
      // a sentence or a row separator, or the label itself is introduced by one. A lowercase word on one side
      // and the label on the other means a sentence ran through it and has just lost a piece of itself.
      let i = 0;
      while (i < before.length && i < after.length && before[i] === after[i]) i++;
      const head = before.slice(0, i).trim();
      const seam = !head || /[.!?\u2026\u2022\u00b7|>]$/.test(head) || /^\s*[\u2022\u00b7|>\u2014\u2013-]/.test(before.slice(i));
      if (!seam) midSentence.push(`${it.id}: ${head.slice(-60)} >>> ${before.slice(i, i + 30)}`);
    }
  }
  assert.equal(texts, 41, "41 shipped texts carry a button the crawl swept up");
  assert.equal(listings.size, 33);
  assert.deepEqual(midSentence, []);
});
