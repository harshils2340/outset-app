import assert from "node:assert/strict";
import test from "node:test";
import { regionOfArea } from "../../data/regions";
import { cardPlace } from "../catalog";
import type { Unclaimed } from "../../data/types";
import { searchRegions } from "../search";

/**
 * Which state or province a listing is in, for the Where box and for the state and province rows a search
 * offers when a query names one.
 *
 * The sync writes the area as "town, code", and when the crawl never found a town it writes the code alone:
 * 4,736 of the catalog's 59,091 rows. Asking for a comma in front of the code dropped every one of them from
 * the row counts and from the page a picked state opens, so a guest who searched Saskatchewan was shown 63
 * businesses out of 224, Manitoba 73 out of 225, and the Northwest Territories one out of twelve.
 */

test("the region is read whether or not the area names a town", () => {
  assert.equal(regionOfArea("Tampa, FL"), "FL");
  assert.equal(regionOfArea("Tobermory, ON"), "ON");
  assert.equal(regionOfArea("SK"), "SK");
  assert.equal(regionOfArea("NT"), "NT");
  assert.equal(regionOfArea("Hollywood, fl"), "FL");
  assert.equal(regionOfArea("Weedon Island, St. Petersburg, FL"), "FL");
  // The town is never read, so this real row stays in New Jersey rather than moving to Montana.
  assert.equal(regionOfArea("Mt, NJ"), "NJ");
  assert.equal(regionOfArea("Somewhere"), "");
  assert.equal(regionOfArea(undefined), "");
});

let n = 0;
const op = (area: string): Unclaimed => {
  n += 1;
  return { id: "o-" + n, title: "Shop " + n, cat: "play", art: "bowling", area, src: "t" + n + ".com", metroId: "", lat: 52.1, lon: -106.6 } as unknown as Unclaimed;
};

test("a province's row counts the listings that have no town", () => {
  const pool = [op("Saskatoon, SK"), op("SK"), op("SK"), op("Regina, SK")];
  const [hit] = searchRegions(pool, "saskatchewan");
  assert.equal(hit.code, "SK");
  assert.equal(hit.count, 4);
});

/**
 * The place line on a feed card. An operator whose town was never scraped publishes its state as the whole
 * area, and fourteen of those rows are inside a metro, so the card appended the metro to the state and read
 * "FL, Orlando".
 */
test("a card reads town then state, whichever way round the area came", () => {
  assert.equal(cardPlace("Clearwater Beach, FL", "Tampa Bay"), "Clearwater Beach, FL");
  assert.equal(cardPlace("Tampa, FL", "Tampa Bay"), "Tampa, FL"); // the metro's name is already there
  assert.equal(cardPlace("FL", "Orlando"), "Orlando, FL");
  assert.equal(cardPlace("ON", "Toronto"), "Toronto, ON");
  assert.equal(cardPlace("Weeki Wachee", "Tampa Bay"), "Weeki Wachee, Tampa Bay");
  assert.equal(cardPlace("FL", undefined), "FL");
});
