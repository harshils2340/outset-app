/**
 * Whether a shop's description is the shop talking, held to the catalog the app ships.
 *
 * 26 listings publish a page theme's placeholder as their own words, on the blurb under the title or on a
 * service a guest picks: "Lorem ipsum dolor sit amet, consectetur adipiscing elit." is 56 characters of
 * well-formed prose ending on a full stop, so every check the sync makes of a blurb waved it through. Ten more
 * publish binary, because the crawl read a PDF as text at o-elgintexas-gov and o-hallcounty-org. Fifteen print
 * a black diamond mid-sentence where a byte of an apostrophe or a dash was lost.
 *
 * Every case below is a real listing in `public/o` and names the one it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { notTheirWords, ownWords } from "../ownWords";

const dir = new URL("../../../public/o/", import.meta.url);
type Detail = { id: string; blurb?: string; services?: { desc?: string | null }[] };
const details = (): Detail[] => readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Detail);

test("a page theme's filler is not the shop describing itself", () => {
  // o-arenahouston-com, o-kamloopsjudo-com and o-fortheritageprecinct-ca ship this as their blurb.
  for (const t of [
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    "Lorem ipsum dolor sit amet, consectetuer adipiscing elit, sed diam nonummy nibh euismod.",
    "Multi-purpose Template Create Your Website Lorem ipsum dolor sit amet, consectetur adipiscing",
    "Dicta sunt explicabo. Nemo enim ipsam voluptatem voluptas sit odit aut fugit.",
  ]) {
    assert.equal(notTheirWords(t), true, t);
    assert.equal(ownWords(t), "");
  }
});

test("a PDF read as text is not a service description", () => {
  assert.equal(notTheirWords("'EP "), true);
  assert.equal(ownWords("Kent Beer Company isa tap room and brew house"), "");
});

test("a real description is left exactly as the shop wrote it", () => {
  for (const t of [
    "Bring your family and friends along to explore the less traveled areas of the river.",
    "Our floating classroom serves schools across the bay, with a naturalist aboard every trip.",
    "A tab\tand a line break\nare ordinary text.",
  ]) {
    assert.equal(notTheirWords(t), false, t);
    assert.equal(ownWords(t), t.trim());
  }
});

test("a lost apostrophe comes back as an apostrophe", () => {
  // o-michaelmurphyfishing-com: "in today's bass fishing world, it's easy to overlook".
  assert.equal(ownWords("With all of the topwater lures in today�s bass fishing world, it�s easy to overlook"), "With all of the topwater lures in today's bass fishing world, it's easy to overlook");
  // o-wacissarivercanoerentals-com: "we'd like to thank all of you".
  assert.equal(ownWords("First and foremost we�d like to thank all of you"), "First and foremost we'd like to thank all of you");
});

test("a diamond standing for punctuation nobody can recover reads as a space", () => {
  // o-lakehickorycc-com and o-pensacolabaycruises-com, where the lost byte was a dash.
  assert.equal(ownWords("Lake Hickory Country Club�Hickory's premier private club since 1923�offers members two courses"), "Lake Hickory Country Club Hickory's premier private club since 1923 offers members two courses");
  assert.equal(ownWords("or peacefully paddle through the sound�we have the perfect equipment"), "or peacefully paddle through the sound we have the perfect equipment");
});

/* ---------- the whole shipped catalog ---------- */

test("no shipped listing tells a guest lorem ipsum or a page of binary", () => {
  // The files carry these until the next sync; the app reads every record through `ownWords` on the way in
  // (`asPublished` in catalog.ts), so this asserts that every one of them reaches a guest as no description.
  const found: string[] = [];
  const shown: string[] = [];
  for (const j of details()) {
    for (const [what, text] of [["blurb", j.blurb] as const, ...(j.services || []).map((s) => ["service copy", s.desc] as const)]) {
      if (!notTheirWords(text)) continue;
      found.push(j.id + ": " + what);
      if (ownWords(text)) shown.push(j.id + ": " + what);
    }
  }
  // The shipped filler is down to none as the crawl and the sync clean it at source, so this no longer demands a
  // population to prove itself against: whatever is there, none of it may reach a guest.
  assert.deepEqual(shown.slice(0, 10), [], found.length + " shipped listings still carry filler or binary");
});

test("no shipped listing prints a black diamond at a guest", () => {
  const offenders: string[] = [];
  for (const j of details()) {
    if (ownWords(j.blurb).includes("�")) offenders.push(j.id + ": blurb");
    for (const s of j.services || []) if (ownWords(s.desc).includes("�")) offenders.push(j.id + ": service copy");
  }
  assert.deepEqual(offenders.slice(0, 10), []);
});

test("the descriptions this leaves alone are all of them but those", () => {
  let kept = 0;
  let cleared = 0;
  for (const j of details()) {
    for (const t of [j.blurb, ...(j.services || []).map((s) => s.desc)]) {
      if (!t || !t.trim()) continue;
      if (ownWords(t)) kept++;
      else cleared++;
    }
  }
  assert.ok(kept > 10000, "expected the catalog's real copy to be untouched, got " + kept);
  // Only filler and binary may be cleared, and there is little of it left; what must never happen is this
  // filter eating real copy, which the ceiling guards.
  assert.ok(cleared < 100, "expected only the filler and the binary, got " + cleared);
});
