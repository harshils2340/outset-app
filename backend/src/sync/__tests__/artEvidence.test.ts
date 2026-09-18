import { test } from "node:test";
import assert from "node:assert/strict";
import { KIND_EVIDENCE, artFromName, reconcileArt } from "../artEvidence.ts";

/**
 * The kind a listing is filed under is the chip a guest browses it by, so a name rule that matches inside a
 * longer word puts a business in a rail it has never traded in. Every title below is a shipped listing on
 * 18 September 2026, and every one of them was in the wrong rail: "gator" inside Purgatory, Propagator and
 * Instigator; "horse" inside Horseshoe, Horseheads, Horsefly and Horseless; "stable" inside Stable Craft;
 * "cruise" inside Cruiser; "angl" inside Anglebrook and Anglican; "axe" inside Axemann and Axelrod.
 */

/** A name that names nothing keeps the kind discovery filed it under. */
const DISCOVERY = "__discovery__";

test("an activity word inside a longer word does not file the listing under that activity", () => {
  for (const title of [
    "Horseshoe Bay Golf Club",
    "Horseheads Brewing",
    "Horsefly Brewing Company",
    "Horseheads BMX",
    "Horseless Carriage Museum",
    "Lucky Horseshoe RV Park",
    "Horseshoe Acres Campground",
    "Stable Craft Brewing",
    "Stable Gate Winery",
    "Stabler-Leadbeater Apothecary Musuem",
    "Land Cruiser Heritage Museum",
    "Northern Timber Cruisers",
    "Ocala Street Cruisers",
    "Anglebrook Golf Club",
    "Anglin Smith Fine Art",
    "Gallery Paule Anglim",
    "Anglican Memorial Camp",
    "Axemann Brewery",
    "Axelrod Performing Arts Academy",
    "Purgatory Sports",
    "Purgatory Cellars Winery",
    "Firestone Walker Propagator",
    "Twinstigator Charters",
  ]) {
    assert.equal(artFromName(title, DISCOVERY), DISCOVERY, title + " should keep the kind discovery filed it under");
  }
});

test("a name that does name its activity still wins over discovery", () => {
  const cases: [string, string][] = [
    ["Sunshine Horseback Riding", "horse"],
    ["Bar W Stables", "horse"],
    ["Golden Gait Horse Farm", "horse"],
    ["Cruisin' Tikis Tampa", "cruise"],
    ["Maine Coast Cruising", "cruise"],
    ["Sunset Cruise Key West", "cruise"],
    ["Candere Cruising", "cruise"],
    ["Avid Angling Fishing Charters", "fishing"],
    ["AnglerFish Guides", "fishing"],
    ["Outermost Angling Charters", "fishing"],
    ["Bad Axe Throwing", "axe"],
    ["Axes and Ice Cream", "axe"],
    ["Hawaiian Parasail", "parasail"],
    ["Everglades Airboat Tours", "tour"],
    ["Gator Bait Airboat Adventures", "tour"],
    ["Rocky Mountain Horseman", "horse"],
    ["Punta Gorda Horseman's Association-PGHA", "horse"],
    ["Escapology Destin", "escape"],
    ["Escape Room Tampa", "escape"],
    ["Key West Room Escape", "escape"],
  ];
  for (const [title, art] of cases) assert.equal(artFromName(title, DISCOVERY), art, title);
});

/**
 * "Escape" on its own is leisure branding. 104 shipped listings were in the Escape room rail on the strength
 * of nothing but that word in their name: a wellness spa, two massage studios, a craft brewery, a bowling
 * centre, a dance studio, an electric bike hire, a pottery studio, three RV parks, Six Flags Great Escape and
 * a hot air balloon company called Grape Escape.
 */
test("a bare escape in a name is not an escape room", () => {
  for (const title of [
    "L'Escape Wellness Spa",
    "Pure Escape Massage",
    "Tranquil Escape Massage",
    "Escape Brewery: Downtown Oasis",
    "The Escape Bowling Center",
    "Kristina's Dance Escape",
    "Escape Electric Bikes",
    "Pottery Escape",
    "The Great Escape RV and Camp Resort",
    "Saratoga Escape Lodges & RV Resort",
    "Six Flags Great Escape",
    "Escape Charters",
  ]) {
    assert.equal(artFromName(title, DISCOVERY), DISCOVERY, title);
  }
  assert.equal(artFromName("Grape Escape Balloon Adventures", DISCOVERY), "balloon");
  assert.equal(artFromName("Escape with Horses", DISCOVERY), "horse");
});

/** A gator is a mascot as often as an animal, so it speaks only for a name that says nothing else. */
test("a gator loses to a name that says what the business does", () => {
  assert.equal(artFromName("Gators Parasail", DISCOVERY), "parasail");
  assert.equal(artFromName("Instigator Sportfishing", DISCOVERY), "fishing");
  assert.equal(artFromName("Gator Golf", DISCOVERY), "tour");
  assert.equal(artFromName("Alligator Cove Tours", DISCOVERY), "tour");
  // "Gatorland" is a wildlife park, not a swamp tour, and discovery already knows which.
  assert.equal(artFromName("Gatorland", DISCOVERY), DISCOVERY);
});

/** Breweries and wineries are fond of horses, and 25 of them were filed under an activity they do not sell. */
test("a name whose last word is a taproom is a drink venue", () => {
  for (const title of [
    "Iron Horse Vineyards",
    "Draught Horse Brewery",
    "Dark Horse Estate Winery",
    "Gift Horse Brewing Company",
    "White Horse Brewery",
    "Whyte Horse Winery",
    "Stable 12 Brewing Co.",
    "Stable Rock Winery & Distillery",
    "Stable Craft Brewing",
    "Horsefly Brewing Company",
    "Big Axe Brewing",
    "Axe & Arrow Brewery",
    "Bent Paddle Brewing Co.",
    "Pontoon Brewing",
    "Paddle Hard Brewing",
    "Swamp Head Brewery",
    "Purgatory Cellars Winery",
  ]) {
    assert.equal(artFromName(title, DISCOVERY), DISCOVERY, title);
  }
  // Only the last word counts, so the boats of Vineyard Haven, on Martha's Vineyard, are left alone.
  assert.equal(artFromName("Vineyard Haven Kayak Rentals", DISCOVERY), "kayak");
  assert.equal(artFromName("Brewery District Horseback Trails", DISCOVERY), "horse");
});

/** The same words judge the text a listing is confirmed by, and its own name is part of that text. */
test("tightened evidence no longer confirms a golf club as horseback riding", () => {
  assert.equal(KIND_EVIDENCE.horse.test("Horseshoe Bay Golf Club"), false);
  assert.equal(KIND_EVIDENCE.horse.test("Stabler-Leadbeater Apothecary Musuem"), false);
  assert.equal(KIND_EVIDENCE.horse.test("Sunshine Horseback Riding, horses for all ages"), true);
  assert.equal(KIND_EVIDENCE.fishing.test("Wrangler Ranch"), false);
  assert.equal(KIND_EVIDENCE.fishing.test("Outermost Angling Charters"), true);
  assert.equal(KIND_EVIDENCE.axe.test("Axelrod Performing Arts Academy"), false);
  assert.equal(KIND_EVIDENCE.axe.test("Bad Axe Throwing, axes and lanes"), true);
  // "Seakart Adventure" rents small boats and was confirming itself as a go-kart track.
  assert.equal(KIND_EVIDENCE.kart.test("Seakart Adventure SC"), false);
  assert.equal(KIND_EVIDENCE.kart.test("K1 Speed indoor karting"), true);
});

test("a kind with no evidence of its own is marked unconfirmed, not moved", () => {
  const v = reconcileArt("jetski", "Coastal Board Shop", "boards and wetsuits");
  assert.equal(v.art, "jetski");
  assert.equal(v.confirmed, false);
});
