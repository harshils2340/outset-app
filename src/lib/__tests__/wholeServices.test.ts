/**
 * Every tier a shop's own menu holds, reachable in the booking box.
 *
 * `options` and `services` are two views of one menu, and the sync builds the second from the first: a tier is
 * labelled with the row's duration where the row states one, then tiers that read as the same line are merged.
 * A shop whose pages state one duration for the whole rate card gives every row of a service the same label, so
 * the merge kept the cheapest and dropped the rest. Nothing points at the dropped rows any more, and the service
 * picker is the only picker a listing with services shows, so the booking box offered one tier of a service the
 * shop sells several of, priced at the cheapest and labelled with a length that was not its own.
 *
 * Every case below is a real listing in `public/o` and names the one it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { bookableMenu, wholeServices } from "../menuRow";
import { defaultProfile } from "../operator";

const dir = new URL("../../../public/o/", import.meta.url);
type Tier = { label?: string; price: number | null; optionIdx: number; moreOptions?: true };
type Detail = { id?: string; options?: { name: string; price: number | null; detail?: string }[]; services?: { name: string; variants: Tier[] }[] };
const details = (): Detail[] => readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Detail);
const read = (id: string): Detail => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Detail;

const lines = (item: Detail, name: string): string[] => {
  const svc = (item.services || []).find((s) => s.name === name);
  assert.ok(svc, "no service called " + name);
  return svc.variants.map((v) => v.label + " $" + v.price + (v.moreOptions ? " (folded)" : ""));
};

/* ---------- the rows that came back ---------- */

test("a jet ski shop's whole rate card is bookable, not only its cheapest hour", () => {
  // o-1stclasscharterboatrental-com shipped one tier: "10 hours, $150". $150 buys one hour, and its own menu
  // holds two through eight hour rentals at $300 to $1,200.
  const before = read("o-1stclasscharterboatrental-com");
  assert.deepEqual(lines(before, "Sea Doo Jet Ski Rental"), ["10 hours $150"]);
  const after = bookableMenu(before) as Detail;
  assert.deepEqual(lines(after, "Sea Doo Jet Ski Rental"), [
    "One hour rental $150",
    "Two hour rental $300 (folded)",
    "Three hour rental $450 (folded)",
    "Four hour rental $600 (folded)",
    "Five hour rental $750 (folded)",
    "Six hour rental $900 (folded)",
    "Seven hour rental $1050 (folded)",
    "Eight hour rental $1200 (folded)",
  ]);
  // Every tier points at the row it names, so the sheet books the rental the guest read.
  for (const v of (after.services || []).find((s) => s.name === "Sea Doo Jet Ski Rental")!.variants) {
    assert.equal((after.options || [])[v.optionIdx].price, v.price);
    assert.equal((after.options || [])[v.optionIdx].detail, v.label);
  }
});

test("the half day and the full day a shop sells are tiers of the service that sells them", () => {
  // o-aaajetski-com shipped one tier, "1 to 8 hours, $125", for a service whose own name lists four lengths.
  const after = bookableMenu(read("o-aaajetski-com")) as Detail;
  assert.deepEqual(lines(after, "Jet Ski Rental - 1 Hour, 2 Hours, 4 Hours, and 8 Hours"), [
    "One hour rental $125",
    "Two hour rental $199 (folded)",
    "Half day rental $349 (folded)",
    "Full day rental $549 (folded)",
  ]);
});

/* ---------- what it leaves alone ---------- */

test("two lines of the same words at two prices are not offered as a choice", () => {
  // o-arayathaimassage-com holds six one-hour massages, at $88, $93, $108, $115, $119 and $175, and publishes
  // nothing else to tell them apart. A guest reading "1 hour" six times learns nothing, so the cheapest stands
  // for them and the tiers the shop does distinguish are left as they were.
  const item = read("o-arayathaimassage-com");
  const was = lines(item, "Massage");
  assert.deepEqual(was, ["1 hour $88", "30 minutes $90", "1 hour 30 minutes $165"]);
  assert.deepEqual(lines(bookableMenu(item) as Detail, "Massage"), was);
});

test("a row whose sub-line the sync refused stays where it is", () => {
  const item = {
    options: [
      { name: "Escape room", price: 30, detail: "60 minutes" },
      { name: "Escape room", price: 45, detail: "" },
    ],
    services: [{ name: "Escape room", variants: [{ label: "60 minutes", price: 30, optionIdx: 0 }] }],
  };
  assert.equal(wholeServices(item), item);
});

test("a service nothing is missing from is returned untouched", () => {
  const item = {
    options: [{ name: "Sunset sail", price: 80, detail: "2 hours" }],
    services: [{ name: "Sunset sail", variants: [{ label: "2 hours", price: 80, optionIdx: 0 }] }],
  };
  assert.equal(wholeServices(item), item);
});

test("a spare row belongs to the service that names it, not to the one beside it", () => {
  const item = {
    options: [
      { name: "Jet ski", price: 100, detail: "1 hour" },
      { name: "Pontoon", price: 300, detail: "4 hours" },
      { name: "Jet ski", price: 180, detail: "2 hours" },
    ],
    services: [
      { name: "Jet ski", variants: [{ label: "1 hour", price: 100, optionIdx: 0 }] },
      { name: "Pontoon", variants: [{ label: "4 hours", price: 300, optionIdx: 1 }] },
    ],
  };
  const out = wholeServices(item);
  assert.deepEqual(out.services[0].variants, [
    { label: "1 hour", price: 100, optionIdx: 0 },
    { label: "2 hours", price: 180, optionIdx: 2, moreOptions: true },
  ]);
  assert.deepEqual(out.services[1].variants, [{ label: "4 hours", price: 300, optionIdx: 1 }]);
});

test("a listing with no service list keeps its options as they are", () => {
  const item = { options: [{ name: "Tickets", price: 12, detail: "Adult" }] };
  assert.equal(wholeServices(item), item);
});

/* ---------- the operator side reads the same menu ---------- */

test("an owner claiming their shop is handed their whole rate card, not its cheapest line", () => {
  // The dashboard's Services editor is seeded from the listing's own tiers (`servicesFrom`), so a shop whose
  // tiers the sync dropped opened on a menu with its rate card missing, and the owner's first job would have
  // been to type it back in.
  const owner = { name: "Owner", email: "owner@example.com", phone: "5550100" };
  const item = bookableMenu(read("o-1stclasscharterboatrental-com")) as Detail;
  const svc = defaultProfile(item as never, owner).services.find((s) => s.name === "Sea Doo Jet Ski Rental");
  assert.ok(svc, "the claimed profile lost the service");
  assert.deepEqual(
    svc.variants.map((v) => v.label + " $" + v.price),
    ["One hour rental $150", "Two hour rental $300", "Three hour rental $450", "Four hour rental $600", "Five hour rental $750", "Six hour rental $900", "Seven hour rental $1050", "Eight hour rental $1200"],
  );
});

/* ---------- held to the shipped catalog ---------- */

test("what this puts back across the shipped catalog is bookable and nothing more", () => {
  let gained = 0;
  let listings = 0;
  let opensWider = 0;
  for (const j of details()) {
    const wasVisible = (j.services || []).reduce((n, s) => n + s.variants.filter((v) => !v.moreOptions).length, 0);
    const wasTiers = (j.services || []).reduce((n, s) => n + s.variants.length, 0);
    const out = bookableMenu(j) as Detail;
    const tiers = (out.services || []).reduce((n, s) => n + s.variants.length, 0);
    const visible = (out.services || []).reduce((n, s) => n + s.variants.filter((v) => !v.moreOptions).length, 0);
    if (tiers > wasTiers) {
      listings++;
      gained += tiers - wasTiers;
    }
    // A restored tier is folded, so no page opens on more lines than it opened on before.
    if (visible > wasVisible) opensWider++;
    // Never a tier pointing past the end of the options, and never one the options do not price the same way.
    for (const s of out.services || []) {
      for (const v of s.variants) {
        const row = (out.options || [])[v.optionIdx];
        assert.ok(row, "a tier of " + s.name + " points past the end of the menu");
        assert.equal(v.price, row.price, s.name + " prices " + v.label + " differently from its own row");
      }
    }
  }
  // 1,440 tiers on 244 listings the day this was written. The counts fall as the sync stops dropping them, so
  // the ceiling is what this guards: the rule must never start inventing a menu.
  assert.ok(gained > 1000, "the rows this was written for are not coming back, got " + gained);
  assert.ok(gained < 4000, "this is putting back more than the sync ever dropped, got " + gained);
  assert.ok(listings < 600, "this is reaching too many listings, got " + listings);
  assert.equal(opensWider, 0, "a restored tier is showing above the fold on " + opensWider + " listings");
});
