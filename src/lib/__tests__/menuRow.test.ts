/**
 * The menu rows a guest can pick and pay for, held to the catalog the app ships.
 *
 * The crawl takes a shop's menu off their own pages and brings those pages' headings with it. 333 listings
 * offer "Past Exhibitions" as a service, 118 of them with a price on it, so a guest could pick a date, a
 * party and a card and be confirmed into an exhibition that closed, for $5 at the Anchorage Museum and
 * $3,000 at o-aahmsnj-org. 17 more offer an FAQ heading that leads nowhere, and 93 shops have a sentence the
 * crawl cut in half on their menu: "Tickets are", "Admission is".
 *
 * Every case below is a real listing in `public/o` and names the one it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { bookableMenu, bookableRow, tidyRowName } from "../menuRow";

const dir = new URL("../../../public/o/", import.meta.url);
type Detail = { id: string; options?: { name: string; price: number | null }[]; services?: { name: string; variants: { label: string; price: number | null; optionIdx: number }[] }[] };
const details = (): Detail[] => readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Detail);

/* ---------- the archive ---------- */

test("what a shop used to show is not a row a guest can book", () => {
  // o-1805gallery-com, o-anchoragemuseum-org ($5), o-aahmsnj-org ($3,000 per group), o-audainartmuseum-com.
  for (const name of ["Past Exhibitions", "Past Exhibits", "Previous Exhibits", "Former Exhibitions", "Exhibition Archive", "Exhibits & Archives", "Archived Lesson Supplements", "Past Programs 2026", "Dive into the Archives"]) {
    assert.equal(bookableRow(name, null), false, name);
    assert.equal(bookableRow(name, 17), false, name + ", priced");
  }
});

test("a service that only sounds like one is left alone", () => {
  // o-clearholistictherapies-com sells a 90 minute Past Life Regression for $150.
  for (const name of ["Past Life Regression", "Archery Lesson", "Past Times Carriage Ride", "Sunset Cruise", "Pastry Class"]) {
    assert.equal(bookableRow(name, 150), true, name);
  }
});

/* ---------- the page's own questions ---------- */

test("a question the page answers about itself is not a service", () => {
  // o-ldvbeach-com listed "What is sunset seating?" beside its jet skis and kayaks.
  for (const name of ["What is sunset seating?", "Do you offer parasailing?", "Are pets allowed on your pontoon?", "How deep can dolphins dive?", "Is there a place to park my bike?", "Who can parasail?"]) {
    assert.equal(bookableRow(name, null), false, name);
  }
});

test("a priced question is the shop's own menu under a heading, and stays", () => {
  // o-escapegameknoxville-net prices every room under "What is an escape room?": 2 people $40, 4 people $30,
  // a $545 pizza party. Dropping those would take the whole shop's menu with them.
  assert.equal(bookableRow("What is an escape room?", 40), true);
  assert.equal(bookableRow("How Do I Book A Cruise?", 59), true);
});

test("a name that merely ends in a question mark is a name", () => {
  // o-escapology-com runs a room called "Who Stole Mona?"; o-intheflowflyfishing-com heads its prices
  // "Ready to go fishing?" and charges $150 and $300 under it.
  for (const name of ["Who Stole Mona?", "Why Escape Rooms?", "Ready to go fishing?", "E-Bike or Shuttle?", "Need Fishing Gear?"]) {
    assert.equal(bookableRow(name, null), true, name);
  }
});

/* ---------- half a sentence ---------- */

test("the tail of a sentence the crawl cut in half comes off the row", () => {
  assert.equal(tidyRowName("Tickets are"), "Tickets");
  assert.equal(tidyRowName("Admission is"), "Admission");
  assert.equal(tidyRowName("Boxing For"), "Boxing");
  assert.equal(tidyRowName("Fishing; the"), "Fishing");
  assert.equal(tidyRowName("Charter And"), "Charter");
  assert.equal(tidyRowName("Karate IS"), "Karate");
});

test("a name that ends in one of those words on purpose is untouched", () => {
  for (const name of ["Drop In", "Drop-in", "Session A", "Dive In", "Sunday Drop-in", "Learn to Sail", "Ladies Night Out"]) {
    assert.equal(tidyRowName(name), name, name);
  }
});

/* ---------- options and services stay one fact ---------- */

test("dropping a row re-points every tier that came after it", () => {
  const item = {
    options: [
      { name: "Past Exhibitions", price: 5 },
      { name: "Guided tour", price: 20 },
      { name: "Tickets are", price: 12 },
    ],
    services: [
      { name: "Past Exhibitions", variants: [{ label: "Museum admission", price: 5, optionIdx: 0 }] },
      { name: "Guided tour", variants: [{ label: "Adults", price: 20, optionIdx: 1 }] },
      { name: "Tickets are", variants: [{ label: "Standard", price: 12, optionIdx: 2 }] },
    ],
  };
  const out = bookableMenu(item);
  assert.deepEqual(out.options.map((o) => o.name), ["Guided tour", "Tickets"]);
  assert.deepEqual(out.services.map((s) => s.name), ["Guided tour", "Tickets"]);
  for (const s of out.services) for (const v of s.variants) assert.equal(v.price, out.options[v.optionIdx].price, s.name);
});

test("a shop whose whole menu was the archive is left with no menu, not a wrong one", () => {
  // o-1805gallery-com ships exactly one option, "Past Exhibitions". Two thirds of the catalog already has none.
  const out = bookableMenu({ options: [{ name: "Past Exhibitions", price: null }], services: [{ name: "Past Exhibitions", variants: [{ label: "Standard", price: null, optionIdx: 0 }] }] });
  assert.deepEqual(out.options, []);
  assert.deepEqual(out.services, []);
});

test("a clean menu comes back as it was", () => {
  const item = { options: [{ name: "Tandem Skydive", price: 249 }], services: [{ name: "Tandem Skydive", variants: [{ label: "Standard", price: 249, optionIdx: 0 }] }] };
  assert.equal(bookableMenu(item), item);
});

/* ---------- the whole shipped catalog ---------- */

test("no shipped listing offers a guest the shop's archive", () => {
  const offenders: string[] = [];
  for (const j of details()) {
    const out = bookableMenu(j);
    for (const o of out.options || []) if (!bookableRow(o.name, o.price)) offenders.push(j.id + ": " + o.name);
  }
  assert.deepEqual(offenders.slice(0, 10), []);
});

test("every tier on every shipped menu still points at its own option", () => {
  // The invariant the picker books on: a tier's price is the price of the option it selects.
  const offenders: string[] = [];
  for (const j of details()) {
    const out = bookableMenu(j);
    for (const s of out.services || []) {
      for (const v of s.variants) {
        const o = (out.options || [])[v.optionIdx];
        if (!o) offenders.push(j.id + ": " + s.name + " points past the end");
        else if ((v.price ?? null) !== (o.price ?? null)) offenders.push(j.id + ": " + s.name + " " + v.label + " $" + v.price + " selects " + o.name + " $" + o.price);
      }
    }
  }
  assert.deepEqual(offenders.slice(0, 10), []);
});

test("the rows this takes off the shipped catalog are the ones it was written for", () => {
  let dropped = 0;
  let listings = 0;
  let priced = 0;
  let renamed = 0;
  for (const j of details()) {
    const before = (j.options || []).length;
    const out = bookableMenu(j);
    const gone = before - (out.options || []).length;
    if (gone > 0) listings++;
    dropped += gone;
    for (const o of j.options || []) {
      if (!bookableRow(o.name, o.price)) {
        if (o.price != null && o.price > 0) priced++;
      } else if (tidyRowName(o.name) !== o.name) renamed++;
    }
  }
  // The counts fall as the crawl and the sync clean the menus at source, so the ceiling is what this guards: the
  // filter must take the archive rows and the FAQ headings, and never start eating a real menu.
  assert.ok(dropped < 460, "the filter is taking too much of the shipped menus, got " + dropped);
  assert.ok(listings < 1000, "the filter is reaching too many listings, got " + listings);
  assert.ok(priced <= dropped, "more priced rows dropped than rows, got " + priced + " of " + dropped);
});
