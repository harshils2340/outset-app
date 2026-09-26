import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { companyReply } from "../companyAgent";
import { durationFrom, isNoticeWindow, sayLength, withoutNoticeWindows } from "../duration";
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

/* ---------- a day is said in days ---------- */

/**
 * A partner's API states every length in minutes and the row that stores one is written in hours, so a
 * product that runs for days reached a guest counted in hours: 218 shipped listings say a two day tour takes
 * "48 hours" and a nine day CityPASS "216 hours". One e-bike rental says "24 hours to 744 hours" and one
 * says "24 hours to 8760 hours", which is a year. Every guest surface reads `sayLength`, so the shipped
 * files are right without waiting for a sync, and `viator.ts` now writes days at the source.
 */
test("a span of a day or more is said in days, and nothing shorter moves", () => {
  assert.equal(sayLength("24 hours"), "1 day");
  assert.equal(sayLength("48 hours"), "2 days");
  assert.equal(sayLength("216 hours"), "9 days");
  assert.equal(sayLength("24 hours to 744 hours"), "1 day to 31 days");
  assert.equal(sayLength("1 hour to 24 hours"), "1 hour to 1 day");
  assert.equal(sayLength("92 hours"), "3.8 days", "a span that is not whole days keeps one decimal, as 1.5 hours does");
  assert.equal(sayLength("14.5 hours"), "14.5 hours", "under a day is left exactly as the shop wrote it");
  assert.equal(sayLength("2 hours"), "2 hours");
  assert.equal(sayLength("2 days"), "2 days");
});

test("the minute rule the cards already read is still the same rule", () => {
  assert.equal(sayLength("60 min"), "1 hour");
  assert.equal(sayLength("90 min"), "1.5 hours");
  assert.equal(sayLength("45 min"), "45 min");
  assert.equal(sayLength("1 hours"), "1 hour");
  assert.equal(sayLength("3 hrs"), "3 hours");
});

test("a shipped tour whose own title says four days no longer says ninety six hours", () => {
  const j = listing("a-viator-100492p14");
  assert.match(j.title, /4 Days/i, "the product changed, so this case needs a new listing");
  assert.equal(j.dur, "96 hours");
  assert.equal(sayLength(j.dur as string), "4 days");
});

test("Otto answers how long it runs in days too", () => {
  assert.match(ask("a-viator-100492p14"), /\b4 days\b/);
  assert.doesNotMatch(ask("a-viator-100492p14"), /96 hours/);
});

test("no shipped listing tells a guest a length counted in days' worth of hours", () => {
  // 218 before this rule, from "24 hours" up to "24 hours to 8760 hours".
  const offenders: string[] = [];
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    if (!j.dur) continue;
    const shown = sayLength(j.dur);
    if ([...shown.matchAll(/(\d+(?:\.\d+)?)\s*hours?/gi)].some((m) => Number(m[1]) >= 24)) offenders.push(j.id + ": " + j.dur + " -> " + shown);
  }
  assert.deepEqual(offenders.slice(0, 10), []);
});

test("the rule leaves every operator-written length alone", () => {
  // The defect is a partner's minutes written back as hours. A shop's own menu says "2 hours" or "90 min",
  // and the only change those may see is the minute rule the cards have always applied.
  const offenders: string[] = [];
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    if (!j.dur || j.affiliate) continue;
    const shown = sayLength(j.dur);
    if (shown !== j.dur && !/\bmin\b|minutes?|hrs?\b|^1 hours$/i.test(j.dur)) offenders.push(j.id + ": " + j.dur + " -> " + shown);
  }
  assert.deepEqual(offenders.slice(0, 10), []);
});
