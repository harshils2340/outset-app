/**
 * The business name, held to the names the catalog actually ships.
 *
 * It is the most printed string in the product: the card, the page hero, the booking sheet, the confirmation,
 * the static page, the outreach email, and every answer Otto gives that says who confirms a booking. 54
 * shipped names carry a mark that is not theirs, 16 of them an operator's own name and 38 a partner's product.
 * Every case below is real and names the listing it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import type { Unclaimed } from "../../data/types";
import { experienceById, mergeCatalog } from "../catalog";
import { companyAnswer } from "../companyAgent";
import { shopTitle } from "../shopName";

test("a space the crawl left in front of a comma or a colon is closed up", () => {
  assert.equal(shopTitle("Tac Ops : A Tactical Laser Tag Experience"), "Tac Ops: A Tactical Laser Tag Experience"); // o-tacopslasertag-com
  assert.equal(shopTitle("Across Africa Tours Travel , LLC"), "Across Africa Tours Travel, LLC"); // o-acrossafricatours-com
  assert.equal(shopTitle("Public Art Walking Tour : Visit : Friends of the Riverwalk"), "Public Art Walking Tour: Visit: Friends of the Riverwalk"); // o-thetampariverwalk-com
  assert.equal(shopTitle("Quebec City : Bike Excursion to Montmorency Falls"), "Quebec City: Bike Excursion to Montmorency Falls"); // a-viator-13623p1
});

test("a bracket the crawl never closed, and one it never opened, come off", () => {
  assert.equal(shopTitle("2 Hour Guided Segway Tour ("), "2 Hour Guided Segway Tour"); // o-feverup-com
  assert.equal(
    shopTitle("Trans-Allegheny Lunatic Asylum (West Virginia Hospital for the"),
    "Trans-Allegheny Lunatic Asylum",
  ); // o-trans-alleghenylunaticasylum-com
  assert.equal(shopTitle("Quack N' Cruise Portland Maine Duck Tours)"), "Quack N' Cruise Portland Maine Duck Tours"); // o-quackncruise-com
  // A name whose brackets balance keeps them.
  assert.equal(shopTitle("Philadelphia: Custom Walking Tour with A Guide (Private Tour)"), "Philadelphia: Custom Walking Tour with A Guide (Private Tour)");
});

test("a separator with nothing on the far side of it comes off, and a sign a shop is named for stays", () => {
  assert.equal(shopTitle("Pilates &"), "Pilates"); // o-pilatesandor-com
  assert.equal(shopTitle("Pub de la Microbrasserie de Tadoussac;"), "Pub de la Microbrasserie de Tadoussac"); // o-microtadoussac-com
  assert.equal(shopTitle(";Water Street Brewing Company"), "Water Street Brewing Company"); // o-waterstreetbrewingco-com
  assert.equal(shopTitle("Charleston History Tour /"), "Charleston History Tour"); // a-viator-86921p2
  assert.equal(shopTitle("Arts+"), "Arts+"); // o-artsplus-org, the plus is the name
  assert.equal(shopTitle("& Fitness"), "& Fitness"); // o-ampersandfitnessgym-com, and so is the ampersand
  assert.equal(shopTitle("Small Group 5-Hour DC Tour via Electric Scooter for Ages 16+"), "Small Group 5-Hour DC Tour via Electric Scooter for Ages 16+");
});

/** A space in front of a final mark says the mark is the page's, not the name's. */
test("a question mark the shop wrote is kept and one the crawl left is not", () => {
  assert.equal(
    shopTitle("Siesta Key Fishing Charters-Inshore & Offshore Fishing Trips ?"),
    "Siesta Key Fishing Charters-Inshore & Offshore Fishing Trips",
  ); // o-fishsiestakey-com
  assert.equal(shopTitle("Who Stole Mona?"), "Who Stole Mona?");
  assert.equal(shopTitle("The Bagel Class presents : Montreal Bagel Making Workshop!"), "The Bagel Class presents: Montreal Bagel Making Workshop!"); // a-viator-149234p1
});

test("a name that is nothing but punctuation is left as it was rather than emptied", () => {
  assert.equal(shopTitle("&"), "&");
  assert.equal(shopTitle("()"), "()");
  assert.equal(shopTitle(""), "");
});

/** Read-time, so the 54 already shipped are right without waiting for a sync on Render. */
test("the catalog every surface reads has the tidy name, and so does Otto", () => {
  const lite: Unclaimed = {
    id: "o-shopname-test",
    title: "Tac Ops : A Tactical Laser Tag Experience",
    cat: "play", art: "arcade", area: "Tampa, FL", metroId: "tampa", src: "shopname-test.example",
    options: [{ name: "Laser tag", price: 25, per: null, detail: null }],
    specs: [], includes: [], gap: "", lite: true,
  } as unknown as Unclaimed;
  mergeCatalog([lite], {});
  const u = experienceById("o-shopname-test");
  assert.ok(u, "merged");
  assert.equal(u!.title, "Tac Ops: A Tactical Laser Tag Experience");
  const said = companyAnswer({ item: u!, contact: null, live: null }, "can i book for 6 people?").text;
  assert.doesNotMatch(said, / :/, said);
});

/** The one listing the fix was found on, as the detail file ships it. */
test("the shipped record the defect was found on reads clean through the tidy", () => {
  const raw = JSON.parse(readFileSync(new URL("../../../public/o/o-feverup-com.json", import.meta.url), "utf8")) as Unclaimed;
  assert.match(String(raw.title), /\($/, "the shipped record still ends on the open bracket");
  assert.equal(shopTitle(String(raw.title)), "2 Hour Guided Segway Tour");
});

/**
 * Two values joined with a semicolon.
 *
 * OpenStreetMap joins a tag's several values with a semicolon and no space, and 25 shipped names arrived that
 * way: a shop beside its own alternative spelling, or two businesses sharing an address. Every one of them was
 * printed whole, on the card, the page hero, the booking sheet, the confirmation and in Otto's answers.
 */
test("a name and its own alternative spelling print as one name", () => {
  assert.equal(shopTitle("Paper Mill Playhouse;Papermill Playhouse", "papermill.org"), "Paper Mill Playhouse");
  assert.equal(shopTitle("Germantown Historical Society;Germantown Historic Society", "osm-way-335497699"), "Germantown Historical Society");
  assert.equal(shopTitle("Broken Spoke;The Broken Spoke", "brokenspokeaustintx.net"), "Broken Spoke");
});

test("the half the shop's own domain names wins, at its fullest", () => {
  // A Taco Bell on locations.tacobell.com is not a Fun Factory, whichever value OpenStreetMap wrote first.
  assert.equal(shopTitle("Fun Factory;Taco Bell", "locations.tacobell.com"), "Taco Bell");
  assert.equal(shopTitle("Eclipse Grange;Parish Players", "parishplayers.org"), "Parish Players");
  // Both halves name simplechanges.org, so the one that says more does.
  assert.equal(shopTitle("Simple Changes Farm;Simple Changes Therapeutic Riding Center", "simplechanges.org"), "Simple Changes Therapeutic Riding Center");
  assert.equal(shopTitle("Browns Crafthouse Kitchen & Bar;Browns Crafthouse", "brownscrafthouse.com"), "Browns Crafthouse Kitchen & Bar");
});

test("with no domain to go on, the first value stands", () => {
  // nmm.life names neither of its halves, and three letters would carry almost any name.
  assert.equal(shopTitle("Niagara Falls Armoury;Niagara Falls Museum", "nmm.life"), "Niagara Falls Armoury");
  assert.equal(shopTitle("Pizza and Taproom;Martin City Brewing Company"), "Pizza and Taproom");
});

test("a semicolon the shop wrote itself is punctuation and stays", () => {
  // The 5 partner products that carry one, all of them a sentence rather than two names.
  assert.equal(shopTitle("City tour; afternoon in Montreal", "viator.com"), "City tour; afternoon in Montreal");
  assert.equal(shopTitle("Okanagan Blackberry Fest; Wine Flights & Charcuterie - Kelowna", "viator.com"), "Okanagan Blackberry Fest; Wine Flights & Charcuterie - Kelowna");
});

test("a semicolon at either end is still trimmed rather than split on", () => {
  assert.equal(shopTitle(";Water Street Brewing Company", "waterstreetbrewingco.com"), "Water Street Brewing Company");
  assert.equal(shopTitle("Pub de la Microbrasserie de Tadoussac;", "microtadoussac.com"), "Pub de la Microbrasserie de Tadoussac");
});

test("the shipped records the join was found on read clean through the tidy", () => {
  const ops = (JSON.parse(readFileSync(new URL("../../../public/catalog.json", import.meta.url), "utf8")) as { operators: { title: string; src?: string }[] }).operators;
  const joined = ops.filter((o) => /;\S/.test(o.title || ""));
  assert.ok(joined.length >= 20, "the shipped catalog still carries the joined names: " + joined.length);
  for (const o of joined) assert.doesNotMatch(shopTitle(o.title, o.src), /;\S/, o.title);
});
