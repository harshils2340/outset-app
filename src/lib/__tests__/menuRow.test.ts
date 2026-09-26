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

import { bookableAddon, bookableMenu, bookableRow, standingRow, tidyRowName } from "../menuRow";

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

/* ---------- a year of the place ---------- */

test("a membership, a season pass or a gift card is not a slot a guest books", () => {
  // o-goulbournmuseum-ca ships one option, "Memberships" at $10, so the sheet preselects it and asks for a
  // date; o-airclassicsmuseum-org the same at $15. 220 shipped rows are named plainly "Memberships".
  for (const name of [
    "Memberships",
    "Membership",
    "New Memberships",
    "Annual Memberships",
    "Monthly Memberships",
    "2026 Outdoor Season Memberships",
    "Museum Memberships",
    "Year Memberships: Residents",
    "Memberships (billed every 4 weeks)",
    "Season Passes",
    "SUP and Kayak Season Passes",
    "Gift Cards",
    "Gift Certificate",
  ]) {
    assert.equal(standingRow(name), true, name);
    assert.equal(bookableRow(name, 10), false, name);
    assert.equal(bookableRow(name, null), false, name + ", unpriced");
  }
});

test("a row that names a single visit as well keeps its place, because that price is real", () => {
  // o-cityofrevelstoke-com prices a teen swim at $5 and an adult at $8 under "Admission & Memberships";
  // o-rivertrailstennis-net a weekday court at $49 under "Memberships & Court Time"; o-theglassbarboston-com
  // a $35 session under "Open Studio Time & Memberships".
  for (const name of ["Admission & Memberships", "Memberships & Court Time", "Day Passes & Memberships", "Open Studio Time & Memberships", "Memberships & Guest Passes", "Adult Ticket Season Passes"]) {
    assert.equal(standingRow(name), false, name);
    assert.equal(bookableRow(name, 49), true, name);
  }
});

test("a service that merely has a member rate is a service", () => {
  for (const name of ["Members Only Paddle", "Non-member Round of Golf", "Remembrance Day Tour", "Season Opener Regatta", "Day Pass"]) {
    assert.equal(standingRow(name), false, name);
    assert.equal(bookableRow(name, 25), true, name);
  }
});

test("no shipped listing offers a year of the place as the thing to book", () => {
  // Read the way the booking box reads it: with no service to show, the sheet lists `options` straight.
  const bad: string[] = [];
  for (const j of details()) {
    for (const o of bookableMenu(j).options || []) if (standingRow(o.name)) bad.push(j.id + ": " + JSON.stringify(o.name));
    for (const s of bookableMenu(j).services || []) if (standingRow(s.name)) bad.push(j.id + " service: " + JSON.stringify(s.name));
  }
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " rows still offer one, first: " + bad[0]);
});

test("the shipped from-price never comes off a membership again", () => {
  // `fromPrice` is the cheapest priced option, and on 102 listings that was an annual membership while the
  // page's own service list was empty: the card said "From $10" for a year at Goulbourn Museum.
  let quoted = 0;
  let fixed = 0;
  for (const j of details()) {
    const raw = (j.options || []).filter((o) => o.price != null && o.price > 0);
    if (!raw.length) continue;
    const cheapest = raw.reduce((a, b) => (a.price! <= b.price! ? a : b));
    if (standingRow(cheapest.name)) fixed++;
    const kept = (bookableMenu(j).options || []).filter((o) => o.price != null && o.price > 0);
    if (kept.length && standingRow(kept.reduce((a, b) => (a.price! <= b.price! ? a : b)).name)) quoted++;
  }
  assert.equal(quoted, 0, quoted + " listings still price their card from a membership");
  assert.ok(fixed > 50, "expected the shipped listings this was written for, found " + fixed);
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

/* ---------- the page's own punctuation ---------- */

test("a nav arrow on either end of a row is the site's chrome, not the service", () => {
  assert.equal(tidyRowName("< Exhibitions"), "Exhibitions");
  assert.equal(tidyRowName("> Private Events Rental"), "Private Events Rental");
  assert.equal(tidyRowName("Program Punch Card Flyer>>"), "Program Punch Card Flyer");
  assert.equal(tidyRowName("Tickets Here <"), "Tickets Here");
});

test("an arrow that means less than or more than stays", () => {
  // 67 rows lead or trail an arrow; these are the ones where it carries the meaning.
  for (const name of [
    "Golf Weekday Juniors (<17) and Seniors (50+) Resident",
    "All Day LaDue Boat & Equipment Rental (> 6 Hours)",
    "Hilton Head -> Daufuskie Island Daily Round Trip Ferry",
    "Pickup OR Delivery (KP <-> Margay)",
    "Digital photo scan < 200 DPI",
    "< 299 photos +",
  ]) {
    assert.equal(tidyRowName(name), name, name);
  }
});

test("a phone number is not the name of a service booked here", () => {
  assert.equal(tidyRowName("Lake George Boat Tour (518) 801-7208"), "Lake George Boat Tour");
  assert.equal(tidyRowName("campground (606-663-3650)"), "campground");
  assert.equal(tidyRowName("Fire Island Sup Co. 631-326-7926"), "Fire Island Sup Co.");
  assert.equal(tidyRowName("Adobe RV Park ~ 928-565-3010 ~ 55"), "Adobe RV Park ~ 55");
  assert.equal(tidyRowName("Private Charter (Call to Book 808-742-6331)"), "Private Charter (Call to Book)");
  // A row named for its own numbers keeps them.
  assert.equal(tidyRowName("Cabin 101 2 Night Stay"), "Cabin 101 2 Night Stay");
});

test("a price list's dot leaders and an icon font's glyph are not part of the name", () => {
  assert.equal(tidyRowName("1 passenger …………"), "1 passenger");
  assert.equal(tidyRowName("2 passengers ......."), "2 passengers");
  // A Font Awesome codepoint out of the private use area, which draws as an empty box for a guest.
  assert.equal(tidyRowName(" Season Pass upgrade"), "Season Pass upgrade");
  assert.equal(tidyRowName("​SUP Lessons 75 minutes"), "SUP Lessons 75 minutes");
});

test("add-ons are tidied with everything else in the booking box", () => {
  const item = {
    options: [{ name: "Standard", price: 40 }],
    addons: [{ name: " Season Pass upgrade", price: 20 }, { name: "1 passenger ………", price: 10 }],
  };
  const out = bookableMenu(item);
  assert.deepEqual(out.addons.map((a) => a.name), ["Season Pass upgrade", "1 passenger"]);
  assert.equal(out.addons[0].price, 20);
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

/* ---------- add-ons, which are read off any line with money at the end of it ---------- */

test("a sentence about a charge is not a thing a guest can tick", () => {
  // Every one of these is a shipped add-on, name and price as the booking box drew them.
  for (const name of [
    "Gazebo sites are an additional", // o-033b649-netsolhost-com, $5
    "Lost or damaged bikes will incur a cost of", // o-albertasportshalloffame-ca, $1,000
    "This internship includes a stipend of", // o-bdmuseum-org, $3,000
    "Get Delivery with orders of", // o-a1abeachrentals-com, $50, which is an order minimum and not a price
    "Prices include first 1-3 persons, extras are", // o-actionfishingmyrtlebeach-com, $50
    "5 Holbrook, Tips were reported at an average of", // o-abhmuseum-org, $100
    "Deposits will be returned minus a", // $15
    "Multiple camp days are subject to", // $55
    "every additional person after that it would be", // $50
    "PRIVATE TOUR UPGRADE! Additional", // $50
    "Bring your lunch, or add on the", // $5
    "Service Description *Additional", // $25
    "+ taxes and", // $50
    "(additional", // $100, and nothing else at all
    "Submit Your Monthly Photos For A Chance To Win A", // $50
    "All rates are subject to taxes. A", // $50
  ]) {
    assert.equal(bookableAddon(name), false, name);
  }
});

test("an add-on that names a thing stays, however it is punctuated", () => {
  for (const name of [
    "Digital photo package (", // the price was inside the bracket
    "S'mores kit (additional",
    "Four (4) 50-minute Private Pilates Lessons (",
    "Nitrox upgrade (",
    "Guided tours of the Becuna (a",
    "Live Guided House Tour w/ Q & A", // a capital A after "&" is the name, not a cut article
    "Session A",
    "Wetsuit Drying Station",
    "Rates are for each night - Extra person charge",
    "Handcam Video",
  ]) {
    assert.equal(bookableAddon(name), true, name);
  }
});

test("the bracket the price was taken out of comes off the name", () => {
  assert.equal(tidyRowName("Digital photo package ("), "Digital photo package");
  assert.equal(tidyRowName("S'mores kit (additional"), "S'mores kit");
  assert.equal(tidyRowName("Prime Rib Au Jus (Additional"), "Prime Rib Au Jus");
  assert.equal(tidyRowName("INCLUDES GAS! (was"), "INCLUDES GAS!");
  assert.equal(tidyRowName("Astrid Klein: Trager, New Photoworks ["), "Astrid Klein: Trager, New Photoworks");
  // A bracket that closes is the row's own and stays, and so does one that is not at the end.
  assert.equal(tidyRowName("Four (4) 50-minute Private Pilates Lessons ("), "Four (4) 50-minute Private Pilates Lessons");
  assert.equal(tidyRowName("All Day LaDue Boat & Equipment Rental (> 6 Hours)"), "All Day LaDue Boat & Equipment Rental (> 6 Hours)");
  assert.equal(tidyRowName("Golf Weekday Juniors (<17) and Seniors (50+) Resident"), "Golf Weekday Juniors (<17) and Seniors (50+) Resident");
});

test("a service row's own trailing word is still only trimmed, never dropped", () => {
  // 93 shops put "Tickets are" and "Admission is" on their menu and the row in front of it is the service.
  // Only add-ons are read out of whole sentences, so only add-ons are dropped for it.
  for (const name of ["Tickets are", "Admission is", "Boxing For"]) {
    assert.equal(bookableRow(name, 20), true, name);
    assert.ok(tidyRowName(name).length >= 2, name);
  }
});

test("no shipped add-on hands a guest half a sentence with a price beside it", () => {
  // Read the way the booking box reads it: bookableMenu is what every record the app loads goes through.
  const bad: string[] = [];
  let addons = 0;
  for (const j of details() as (Detail & { addons?: { name: string; price: number | null }[] })[]) {
    for (const a of bookableMenu(j).addons || []) {
      addons++;
      if (!bookableAddon(a.name) || /[\s([{]$/.test(a.name)) bad.push(j.id + ": " + JSON.stringify(a.name));
    }
  }
  assert.ok(addons > 3000, "expected the shipped add-ons, read " + addons);
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " add-ons still read as a cut sentence, first: " + bad[0]);
});

test("the add-ons this takes off the shipped catalog are the ones it was written for", () => {
  let dropped = 0;
  let total = 0;
  for (const j of details() as (Detail & { addons?: { name: string; price: number | null }[] })[]) {
    for (const a of j.addons || []) {
      total++;
      if (!bookableAddon(a.name)) dropped++;
    }
  }
  // 365 of 3,825 the day this was written; 0 of 3,444 once the sync of 23 September 2026 stopped writing them.
  // The ceiling is what this guards: the rule must never start eating a real add-on list. The fixtures above
  // are what prove it still takes the cut sentences.
  assert.ok(dropped < 500, "the rule is taking too much of the shipped add-ons, dropped " + dropped + " of " + total);
  assert.ok(total - dropped > 3000, "the rule is eating real add-ons, kept " + (total - dropped));
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
  // filter must take the archive rows, the FAQ headings and the memberships, and never start eating a real menu.
  // 527 of the 545 standing rows are what the membership rule added to it, across 285 listings.
  assert.ok(dropped < 1000, "the filter is taking too much of the shipped menus, got " + dropped);
  assert.ok(listings < 1500, "the filter is reaching too many listings, got " + listings);
  assert.ok(priced <= dropped, "more priced rows dropped than rows, got " + priced + " of " + dropped);
});
