import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { companyReply } from "../companyAgent";
import { durationFrom, isNoticeWindow, withoutNoticeWindows } from "../duration";
import { durationLabel } from "../listingDerive";
import { minutesIn } from "../operator";
import type { Unclaimed } from "../../data/types";

/**
 * How long a booking runs, as the listing page prints it and as Otto answers it.
 *
 * Three readers read the same menu lines: the sync writes `dur`, the page derives one when the sync wrote
 * none, and Otto answers "how long is it?". Only the sync's knew that a menu line also states how much notice
 * a cancellation needs and how far ahead a tee time opens. So the page printed exactly what the sync had
 * refused, on 135 of the 178 shipped listings that fall back to it, and Otto quoted the same windows out loud.
 *
 * Every case below is a real listing in `public/o` and names the one it came from.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const ask = (id: string) => companyReply({ item: listing(id), contact: null }, "how long is it?");
const menuLines = (j: Unclaimed) => [...(j.services || []).flatMap((s) => s.variants.map((v) => v.label)), ...j.options.map((o) => o.detail)];

/* ---------- a window is not a length ---------- */

test("a cancellation window is not how long the trip runs", () => {
  // o-cripplecreekcampground-com: "Cancellations prior to 72 hours". The page said 72 hours, Otto said
  // "About 72 hours", and the shop's own sync had already declined to publish it.
  const j = listing("o-cripplecreekcampground-com");
  assert.match(menuLines(j).join(" "), /Cancellations prior to 72 hours/i, "the line changed, so this case needs a new listing");
  assert.equal(j.dur ?? null, null);
  assert.equal(durationLabel(j), null);
  assert.doesNotMatch(ask("o-cripplecreekcampground-com"), /72/);
});

test("a tee time that opens a week out is not a week long", () => {
  // o-antelopehillsgolf-com: "online booking up to 7 days in advance" printed "7 days" under the title.
  const j = listing("o-antelopehillsgolf-com");
  assert.match(menuLines(j).join(" "), /7 days in advance/i, "the line changed, so this case needs a new listing");
  assert.equal(durationLabel(j), null);
});

test("a twilight rate two hours before close is not a two hour round", () => {
  // o-gunpowdergolfcourse-com: "Twilight - 2 hours before close", which Otto answered with.
  const j = listing("o-gunpowdergolfcourse-com");
  assert.match(menuLines(j).join(" "), /2 hours before close/i, "the line changed, so this case needs a new listing");
  assert.equal(durationLabel(j), null);
  assert.doesNotMatch(ask("o-gunpowdergolfcourse-com"), /\b2 hours\b/);
});

test("a teacher training is not an afternoon out", () => {
  // o-8limbsyoga-com: "Repeat 8 Limbs 200-Hour Graduate" put "200 hours" under the studio's title.
  const j = listing("o-8limbsyoga-com");
  assert.match(menuLines(j).join(" "), /200-Hour/i, "the line changed, so this case needs a new listing");
  assert.equal(durationLabel(j), null);
});

/* ---------- what still counts ---------- */

test("a notice word inside another word leaves the length alone", () => {
  // "priority" carries "prior" and "advanced" carries "advance". The sync's line-wide test threw both away.
  assert.equal(durationFrom(["4-hour watercraft experience with priority scheduling and cooler"]), "4 hours");
  assert.equal(durationFrom(["Advanced lead climbing course for climbers 16 years and older; two 3-hour sessions"]), "3 hours");
});

test("only the span the notice rule governs goes", () => {
  // o-havasuboattour-com states both on one line, and the tour is three hours long either way.
  assert.equal(durationFrom(["3-hour boat tour starting about 2 hours before sunset, cruising to Copper Canyon"]), "3 hours");
  assert.equal(withoutNoticeWindows("If you provide MORE than 10 days notice").replace(/\s+/g, " "), "If you provide MORE than notice");
  assert.equal(isNoticeWindow("Reserve tee times up to 7 days in advance"), true);
  assert.equal(isNoticeWindow("2 hour jet ski rental"), false);
});

test("a shop that states a length still states it", () => {
  // o-amadosjetskis-com and o-biloxihelicoptertours-com, both read off the menu the guest books from.
  assert.equal(durationLabel(listing("o-amadosjetskis-com")), "1 hour");
  assert.match(ask("o-amadosjetskis-com"), /1 hour to 4 hours/);
  assert.match(ask("o-biloxihelicoptertours-com"), /3 minutes to 25 minutes/);
});

test("a service imported into the dashboard does not open a day long", () => {
  // The menu editor reads the same lines for a service's length, so o-gunpowdergolfcourse-com's twilight
  // round opened the dashboard as a two hour booking and the calendar laid its slots out that way.
  assert.equal(minutesIn("Twilight - 2 hours before close"), 0);
  assert.equal(minutesIn("Cancellations prior to 72 hours"), 0);
  assert.equal(minutesIn("90 minute sunset sail"), 90);
});

/* ---------- the whole shipped catalog ---------- */

test("no shipped listing derives a length nobody could book", () => {
  // On the old reader this reports 135, among them "716 days", "200 hours" and three separate 72 hour
  // cancellation windows. The bound is the sync's own: a booking is minutes to a day or two.
  const offenders: string[] = [];
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    if (j.dur) continue;
    const d = durationLabel(j);
    if (!d) continue;
    const n = Number(d.match(/([\d.]+)\s*\D*$/)?.[1] ?? 0);
    const tooLong = /min/.test(d) ? n > 600 : /day/.test(d) ? n > 7 : n > 14;
    if (tooLong) offenders.push(j.id + ": " + d);
  }
  assert.deepEqual(offenders.slice(0, 10), []);
});

test("no shipped listing lets a claimed shop replace a good duration with a window", () => {
  // `publishedPatch` prefers the operator's own menu over the crawled `dur`, so every one of these reached
  // every guest on the day the shop claimed. o-a1abeachrentals-com went from "2 hours" to "24 hours",
  // o-agniyogaportland-com from "2.5 hours" to "30 days".
  const offenders: string[] = [];
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    const d = durationLabel(j);
    if (!j.dur || !d) continue;
    const n = Number(d.match(/([\d.]+)\s*\D*$/)?.[1] ?? 0);
    const tooLong = /min/.test(d) ? n > 600 : /day/.test(d) ? n > 7 : n > 14;
    if (tooLong || menuLines(j).some((l) => isNoticeWindow(l) && durationFrom([l]))) offenders.push(j.id + ": " + j.dur + " -> " + d);
  }
  assert.deepEqual(offenders.slice(0, 10), []);
});
