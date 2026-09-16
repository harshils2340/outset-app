import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnownIndex, importFiles, listCandidateFiles, mapCandidate, parseFileName, report, type AnyCandidate } from "../../../scripts/import-discovered.mts";

/**
 * Two hand-written candidate files through the importer's mapper in dry-run mode (no insert callback, no database).
 * places-toronto.json is what src/discover/places.ts writes for the Toronto metro; florida-web.json is what
 * scripts/discover-florida-ci.mts writes from Brave hits. No request was ever made for any of this.
 */

const toronto: AnyCandidate[] = [
  {
    name: "Dish Cooking Studio", website: "https://www.dishcookingstudio.com/", domain: "dishcookingstudio.com", street: "390 Dupont Street",
    city: "Toronto", region: "ON", country: "CA", postal: "M5R 1V9", lat: 43.6749, lon: -79.4082, phone: "+14169205559", kind: "cooking",
    source: "web", sourceUrl: "https://www.google.com/maps/place/?q=place_id:ChIJ_dish", activity: "cooking classes", rating: 4.7, reviewCount: 312,
    placeId: "ChIJ_dish", query: "cooking classes in Toronto, ON",
  },
  {
    // No pin from Google: the metro comes from the file's metro centre.
    name: "Chef's Table Workshop", website: "https://chefstableworkshop.ca/", domain: "chefstableworkshop.ca", street: null, city: "Toronto",
    region: "ON", country: "CA", postal: null, lat: null, lon: null, phone: null, kind: "cooking", source: "web",
    sourceUrl: "https://www.google.com/maps/place/?q=place_id:ChIJ_chefs", activity: "cooking classes", placeId: "ChIJ_chefs", query: "cooking classes in Toronto, ON",
  },
  {
    // Directory host with a Canadian suffix.
    name: "Toronto Cooking Classes", website: "https://www.tripadvisor.ca/Attractions-g155019", domain: "tripadvisor.ca", street: null, city: "Toronto",
    region: "ON", country: "CA", postal: null, lat: 43.65, lon: -79.38, phone: null, kind: "cooking", source: "web",
    sourceUrl: "https://www.google.com/maps/place/?q=place_id:ChIJ_ta", placeId: "ChIJ_ta", query: "cooking classes in Toronto, ON",
  },
  {
    // A search result with no website is not a listing.
    name: "Pop-Up Pasta Night", website: null, domain: "gplace-ChIJ_popup", street: null, city: "Toronto", region: "ON", country: "CA", postal: null,
    lat: 43.65, lon: -79.38, phone: null, kind: "cooking", source: "web", sourceUrl: "https://www.google.com/maps/place/?q=place_id:ChIJ_popup",
    placeId: "ChIJ_popup", query: "cooking classes in Toronto, ON",
  },
  {
    name: "Unicorn Rides", website: "https://unicornrides.ca/", domain: "unicornrides.ca", street: null, city: "Toronto", region: "ON", country: "CA",
    postal: null, lat: 43.65, lon: -79.38, phone: null, kind: "unicorn", source: "web", sourceUrl: "https://www.google.com/maps/place/?q=place_id:ChIJ_uni",
    placeId: "ChIJ_uni", query: "unicorn rides in Toronto, ON",
  },
  {
    // Already an operator (seeded into the known index below).
    name: "Escape City Toronto", website: "https://escapecity.ca/", domain: "escapecity.ca", street: null, city: "Toronto", region: "ON", country: "CA",
    postal: null, lat: 43.66, lon: -79.39, phone: null, kind: "escape", source: "web", sourceUrl: "https://www.google.com/maps/place/?q=place_id:ChIJ_esc",
    placeId: "ChIJ_esc", query: "escape rooms in Toronto, ON",
  },
  {
    // Same business as the first row under a second host: caught inside the run by name and city.
    name: "Dish Cooking Studio", website: "https://dishcooking.ca/", domain: "dishcooking.ca", street: null, city: "Toronto", region: "ON", country: "CA",
    postal: null, lat: null, lon: null, phone: null, kind: "cooking", source: "web", sourceUrl: "https://www.google.com/maps/place/?q=place_id:ChIJ_dish2",
    placeId: "ChIJ_dish2", query: "cooking classes in Toronto, ON",
  },
];

const florida: AnyCandidate[] = [
  {
    // Brave hits carry no pin; the destination they were searched from gives the metro.
    name: "Miami Mixology", website: "https://miamimixology.com/", domain: "miamimixology.com", street: null, city: "Miami", region: "FL", postal: null,
    lat: null, lon: null, phone: null, kind: "cooking", source: "web", sourceUrl: "https://miamimixology.com/", activity: "cocktail-class",
  },
  {
    // Known by website host: the operator row sits under an OSM id but owns this site.
    name: "Everglades Airboat Co", website: "https://gladesairboats.com/tours", domain: "gladesairboats.com", street: null, city: "Fort Lauderdale", region: "FL",
    postal: null, lat: null, lon: null, phone: null, kind: "cooking", source: "web", sourceUrl: "https://gladesairboats.com/tours", activity: "airboat",
  },
  {
    name: "Key Largo Paddle", website: "https://keylargopaddle.com/", domain: "keylargopaddle.com", street: null, city: "Nowhere Special", region: "FL", postal: null,
    lat: 25.09, lon: -80.44, phone: null, kind: "cooking", source: "web", sourceUrl: "https://keylargopaddle.com/", activity: "kayak",
  },
];

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "outset-discovered-"));
  writeFileSync(join(dir, "places-toronto.json"), JSON.stringify(toronto, null, 1));
  writeFileSync(join(dir, "florida-web.json"), JSON.stringify(florida, null, 1));
  writeFileSync(join(dir, "brave-queries.json"), JSON.stringify({ queries: {} }));
  writeFileSync(join(dir, "florida-summary.json"), JSON.stringify({ at: "2026-09-16" }));
  return dir;
}

function seededKnown(): KnownIndex {
  const known = new KnownIndex();
  known.remember({ domain: "escapecity.ca", name: "Escape City", website: "https://escapecity.ca/", phone: null, city: "Toronto", lat: 43.66, lon: -79.39 });
  known.remember({ domain: "osm-node-1", name: "Everglades Airboats", website: "https://www.gladesairboats.com/", phone: null, city: "Fort Lauderdale", lat: 26.1, lon: -80.3, osm_ref: "node/1" });
  return known;
}

test("candidate files are recognised by name, ordered by source, and summaries are skipped", () => {
  const dir = fixture();
  const { files, skipped } = listCandidateFiles(dir);
  assert.deepEqual(files.map((f) => [f.source, f.job, f.metro?.id || null]), [["web", "florida", null], ["places", "places", "toronto"]]);
  assert.deepEqual(skipped, ["brave-queries.json", "florida-summary.json"]);
  assert.deepEqual(listCandidateFiles(dir, ["places"]).files.map((f) => f.source), ["places"]);
  assert.throws(() => listCandidateFiles(dir, ["brave"]), /unknown --source brave/);
  assert.equal(parseFileName("/x/florida-chains.json")?.source, "chains");
  assert.equal(parseFileName("/x/places-nowhere.json")?.metro, null);
  assert.equal(parseFileName("/x/notes.json"), null);
});

test("dry run maps a Toronto places file and a Florida web file to rows, and explains every rejection", () => {
  const dir = fixture();
  const { files } = listCandidateFiles(dir);
  const inserted: unknown[] = [];
  const { stats, rows } = importFiles(files, seededKnown(), { log: () => {} });
  assert.equal(inserted.length, 0, "a dry run passes no insert callback and writes nothing");

  assert.equal(stats.read, 10);
  assert.equal(stats.inserted, 4);
  assert.deepEqual(stats.rejected, { "aggregator, directory or social host": 1, "website required": 1, "unknown kind": 1 });
  assert.deepEqual(stats.known, { domain: 1, "name and city": 1, "website host": 1 });
  assert.deepEqual(stats.bySource, { web: 2, places: 2 });
  assert.deepEqual(stats.byOrigin, { search: 2, places: 2 });
  assert.deepEqual(stats.perFile, [
    { file: "florida-web.json", source: "web", candidates: 3, added: 2 },
    { file: "places-toronto.json", source: "places", candidates: 7, added: 2 },
  ]);

  const by = Object.fromEntries(rows.map((r) => [r.domain, r]));
  const dish = by["dishcookingstudio.com"];
  assert.equal(dish.metro_id, "toronto", "pin inside 160 km of Toronto");
  assert.equal(dish.country, "CA");
  assert.equal(dish.region, "ON");
  assert.equal(dish.origin, "places");
  assert.equal(dish.category_id, "cooking");
  assert.equal(dish.family, "food");
  assert.equal(dish.extractor, "discover-places:web");
  assert.equal(dish.note, "cooking classes");
  assert.equal(dish.phone, "+14169205559");
  assert.equal(dish.street, "390 Dupont Street");

  const chefs = by["chefstableworkshop.ca"];
  assert.equal(chefs.lat, null);
  assert.equal(chefs.metro_id, "toronto", "no pin: the metro the file was searched from");
  assert.equal(chefs.country, "CA");

  const miami = by["miamimixology.com"];
  assert.equal(miami.metro_id, "miami", "no pin: the Florida destination it was searched from");
  assert.equal(miami.country, "US");
  assert.equal(miami.region, "FL");
  assert.equal(miami.origin, "search", "Florida origins are unchanged");
  assert.equal(miami.extractor, "discover-florida:web");
  assert.equal(miami.osm_ref, null);

  const keys = by["keylargopaddle.com"];
  assert.equal(keys.metro_id, "miami", "pin near Key Largo lands in the Miami metro even with an unknown city");
  assert.equal(keys.country, "US");

  assert.match(report(stats, true), /^DRY RUN, nothing written\. 10 candidates read, 4 would be inserted, 3 rejected/);
  assert.match(report(stats, true), /new by origin:\n\s+2 {2}(search|places)/);
});

test("the insert callback receives exactly the accepted rows, in file order", () => {
  const dir = fixture();
  const { files } = listCandidateFiles(dir);
  const got: string[] = [];
  const { rows } = importFiles(files, seededKnown(), { insert: (r) => got.push(r.domain) });
  assert.deepEqual(got, rows.map((r) => r.domain));
  assert.deepEqual(got, ["miamimixology.com", "keylargopaddle.com", "dishcookingstudio.com", "chefstableworkshop.ca"]);
});

test("mapCandidate: OSM and chain rows may lack a website, search rows may not; region drives country", () => {
  const meta = { file: "florida-osm.json", source: "osm" as const, job: "florida" as const, metro: null };
  const osm: AnyCandidate = {
    name: "Tampa Bay Brewing Company", website: null, domain: "osm-node-322799575", street: null, city: "Tampa", region: "FL", postal: null,
    lat: 27.9612846, lon: -82.441561, phone: null, kind: "brewery", source: "osm", sourceUrl: "https://www.openstreetmap.org/node/322799575", activity: "brewery",
  };
  const r = mapCandidate(osm, meta);
  assert.ok("row" in r);
  assert.equal(r.row.osm_ref, "node/322799575");
  assert.equal(r.row.origin, "osm");
  assert.equal(r.row.metro_id, "tampa");
  assert.equal(r.row.country, "US");

  const web = mapCandidate({ ...osm, source: "web", domain: "x" }, meta);
  assert.deepEqual(web, { reject: "website required" });

  const bc = mapCandidate({ ...osm, region: "BC", lat: 49.28, lon: -123.12, city: "Vancouver" }, { ...meta, source: "places", job: "places" });
  assert.ok("row" in bc);
  assert.equal(bc.row.country, "CA");
  assert.equal(bc.row.origin, "places");
  assert.equal(bc.row.metro_id, "vancouver");

  assert.deepEqual(mapCandidate({ ...osm, region: null }, meta), { reject: "no region" });
  assert.deepEqual(mapCandidate({ ...osm, website: "https://www.yelp.com/biz/x" }, meta), { reject: "aggregator, directory or social host" });
  assert.deepEqual(mapCandidate({ ...osm, name: "TB" }, meta), { reject: "no usable name" });
});
