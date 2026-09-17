import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { companyReply } from "../companyAgent";
import { groupCap } from "../listingDerive";
import type { Unclaimed } from "../../data/types";

/**
 * The largest party a shop takes, as the listing page prints it and as Otto answers it.
 *
 * These were two readers. The page's reads the group lines carefully; Otto's took the first ceiling word it
 * saw and the first count after it, which is the floor of a range and the head of a thousands separator. On
 * 267 of the 1,722 shipped listings where both had a number they named different ones, so a guest read "Up to
 * 6 guests" on the page and was told "They take groups up to 2" by the assistant on the same page.
 *
 * Every case below is a real listing in `public/o` and names the one it came from.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
// Otto prints the number only when the question names a party size, and a party of one fits every shop that
// states a ceiling at all, so the answer is always "Yes, 1 works. They take groups up to N."
const ASK = "can you take 1 of us?";
const ask = (id: string) => companyReply({ item: listing(id), contact: null }, ASK);

/* ---------- the page and Otto name one number ---------- */

test("the floor of a range is not the ceiling Otto quotes", () => {
  // o-605balloonride-com: "Baskets hold 2 to 6 passengers plus pilot". Otto said 2, the page said 6.
  const j = listing("o-605balloonride-com");
  assert.match(j.groupInfo!.join(" "), /2 to 6 passengers/, "the line changed, so this case needs a new listing");
  assert.equal(groupCap(j.groupInfo), 6);
  assert.match(ask("o-605balloonride-com"), /\b6\b/);
  assert.doesNotMatch(ask("o-605balloonride-com"), /groups up to 2\b/);
});

test("a thousands separator is not read as the number's end", () => {
  // o-enchantedisland-com: "accommodate up to 10,000 people". Otto said 10.
  assert.equal(groupCap(listing("o-enchantedisland-com").groupInfo), 10000);
  assert.match(ask("o-enchantedisland-com"), /10,?000/);
});

test("a stated minimum is still nobody's maximum", () => {
  // o-arapahoefc-com: "require minimum 2 passengers", which must not become "up to 2".
  const j = listing("o-arapahoefc-com");
  assert.equal(groupCap(j.groupInfo), null);
  assert.doesNotMatch(ask("o-arapahoefc-com"), /groups up to 2\b/);
});

/* ---------- what is not a count of people ---------- */

test("a distance, a speed or a height is not a group size", () => {
  // Otto answered each of these with the number beside the ceiling word.
  const cases: [string, RegExp][] = [
    ["o-obparasail-com", /up to 20 miles/i], // "Views up to 20 miles on a clear day"
    ["o-atequestrian-ca", /max 5 km\/h/i], // "Drive slowly (max 5 km/h) on property"
    ["o-lockwoodpark-com", /up to 48 inches/i], // pony rides, a rider height
  ];
  for (const [id, line] of cases) {
    const j = listing(id);
    const all = [...(j.groupInfo || []), ...j.specs, ...(j.requirements || []), ...(j.policies || [])].join(" | ");
    assert.match(all, line, id + " no longer carries that line, so this case needs a new listing");
    assert.doesNotMatch(ask(id), /take groups up to \d/, id + " still reads that line as a group size");
  }
});

/* ---------- and no listing may be read two ways at once ---------- */

test("no shipped listing has the page and Otto naming different numbers", () => {
  const ids = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let checked = 0;
  const wrong: string[] = [];
  for (const f of ids) {
    let j: Unclaimed;
    try {
      j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    } catch {
      continue;
    }
    const page = groupCap(j.groupInfo);
    if (page == null) continue;
    const said = companyReply({ item: j, contact: null }, ASK);
    const m = said.match(/groups up to ([\d,]+)/);
    if (!m) continue;
    checked++;
    if (Number(m[1].replace(/,/g, "")) !== page) wrong.push(j.id + ": page " + page + ", Otto " + m[1]);
  }
  assert.ok(checked > 1000, "only " + checked + " listings had both a printed cap and an Otto number");
  assert.deepEqual(wrong.slice(0, 10), [], wrong.length + " listings name two different group sizes");
});
