/**
 * What a guest reads in "What guests say", against the files the app actually ships.
 *
 * Every case here is a real listing in `public/o`: the crawl took the operator's own review page and brought the
 * page's furniture with it, so the comment form under the reviews, a banner selling the trip, and the site's own
 * labels in the author slot were all being drawn as guest reviews. Each test names the listing it came from and
 * fails on the reading this file replaced.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { shownReviews } from "../reviews";

const listing = (id: string) => JSON.parse(readFileSync(new URL("../../../public/o/" + id + ".json", import.meta.url), "utf8")) as { title: string; quotes?: { author?: string; rating?: number; text: string; date?: string; source?: string }[] };
const read = (id: string) => {
  const j = listing(id);
  return shownReviews(j.quotes, j.title);
};

/* ---------- text that is not a guest talking ---------- */

test("the comment form under the reviews is not a review", () => {
  // Two WordPress listings carried "Name *" beside "Your email address will not be published."
  for (const id of ["o-skycoastsports-ca", "o-downtownwineryto-com"]) {
    const j = listing(id);
    const raw = (j.quotes || []).map((q) => q.text).join(" | ");
    assert.match(raw, /email address will not be published/i, id + " no longer carries the form, so this case needs a new listing");
    for (const r of read(id)) {
      assert.doesNotMatch(r.text, /email address will not be published|required fields are marked/i);
      assert.notEqual(r.name, "Name *");
    }
  }
});

test("the shop's own banner is not a review", () => {
  const banners: [string, RegExp][] = [
    ["o-cruise-sd-com", /JOIN OUR TOP-RATED/i],
    ["o-fishin5-com", /we will have you/i],
    ["o-captdaveonline-com", /BOOK ONLINE NOW/i],
  ];
  for (const [id, re] of banners) {
    const raw = (listing(id).quotes || []).map((q) => q.text).join(" | ");
    assert.match(raw, re, id + " no longer carries that banner");
    for (const r of read(id)) assert.doesNotMatch(r.text, re);
  }
});

test("a call to follow the shop's Instagram is not a review", () => {
  for (const r of read("o-captdaveonline-com")) assert.doesNotMatch(r.text, /follow our ig/i);
  // Both of that listing's quotes are its own marketing, so it shows no reviews at all rather than two.
  assert.equal(read("o-captdaveonline-com").length, 0);
});

test("a shouted review is still a review", () => {
  // Guests do write in capitals. Dropping loud text would have cost seven real reviews across five listings.
  const loud = read("o-carolinahookandfly-com");
  assert.ok(loud.length >= 2);
  assert.ok(loud.some((r) => /FANTASTIC FAMILY OUTING/.test(r.text)));
});

/* ---------- the author slot ---------- */

test("a link is not a reviewer's name", () => {
  const j = listing("o-captdaveonline-com");
  assert.ok((j.quotes || []).some((q) => q.author === "https://www.instagram.com/captdavefishing"));
  for (const r of read("o-captdaveonline-com")) assert.equal(r.name, null);
});

test("the site's rating label is not part of the name", () => {
  const names = read("o-mysnowmobiletour-com").map((r) => r.name);
  assert.ok(names.includes("Laura G."), "expected Laura G., got " + JSON.stringify(names));
  assert.ok(names.includes("Hayley German"), "expected Hayley German, got " + JSON.stringify(names));
  for (const n of names) assert.doesNotMatch(n || "", /Rating/i);
});

test("a job title glued to a first name is not part of the name", () => {
  const names = read("o-skycoastsports-ca").map((r) => r.name);
  for (const want of ["Emily R", "Mark", "Sophie", "Jake M.", "Ava"]) {
    assert.ok(names.includes(want), "expected " + want + ", got " + JSON.stringify(names));
  }
  for (const n of names) assert.doesNotMatch(n || "", /CEO|Executive|Designer|Manager|Engineer/);
});

test("a company is not a reviewer", () => {
  const names = read("o-whiplashfishingcharters-com").map((r) => r.name);
  assert.ok(!names.includes("SCB Designs INC"));
  // The real names on the same listing are untouched.
  assert.ok(names.includes("James Titus") && names.includes("Marcia Palmer"));
});

test("an ordinary listing's reviews are read exactly as before", () => {
  const rs = read("o-threehoursail-com");
  const names = rs.map((r) => r.name);
  for (const want of ["Laura Chasmer", "Kathi B", "MIke Hill", "Laura McKenzie", "Eden Smith", "Randy Laporte", "Steve Ellis"]) {
    assert.ok(names.includes(want), "expected " + want + ", got " + JSON.stringify(names));
  }
  assert.ok(rs.every((r) => r.text.length >= 25));
});

/* ---------- the rules themselves, away from any one file ---------- */

test("a rating is dropped rather than shown against plainly glowing words", () => {
  const [glowing] = shownReviews([{ text: "We had an absolutely wonderful day out on the water with the crew.", rating: 2 }], "Shop");
  assert.equal(glowing.stars, null);
  const [sour] = shownReviews([{ text: "The crew was rude and the boat was filthy. I want a refund for this.", rating: 2 }], "Shop");
  assert.equal(sour.stars, 2);
});

test("a date reads as a month and a year, and anything else as no date", () => {
  const [a] = shownReviews([{ text: "A really lovely afternoon out with the two of them on the boat.", date: "2025-03-14" }], "Shop");
  assert.equal(a.when, "March 2025");
  const [b] = shownReviews([{ text: "A really lovely afternoon out with the two of them on the boat.", date: "last summer" }], "Shop");
  assert.equal(b.when, null);
  const [c] = shownReviews([{ text: "A really lovely afternoon out with the two of them on the boat.", date: "2025-13" }], "Shop");
  assert.equal(c.when, null);
});

test("the platform in the date field is a source, not a date", () => {
  const [r] = shownReviews([{ text: "A really lovely afternoon out with the two of them on the boat.", author: "Dana", date: "via Google" }], "Shop");
  assert.equal(r.source, "Google");
  assert.equal(r.when, null);
});

test("the whole shipped catalog reads clean", () => {
  // Every review the app can draw, held to the rules above at once.
  const ids = ["o-skycoastsports-ca", "o-downtownwineryto-com", "o-cruise-sd-com", "o-fishin5-com", "o-captdaveonline-com", "o-mysnowmobiletour-com", "o-whiplashfishingcharters-com", "o-fourwindsmaui-com"];
  for (const id of ids) {
    for (const r of read(id)) {
      assert.doesNotMatch(r.text, /email address will not be published|required fields are marked|join our|follow our ig/i, id);
      assert.doesNotMatch(r.name || "", /https?:|www\.|@|Rating:|\bINC\b/i, id);
      assert.ok(r.text.length >= 25, id);
    }
  }
});
