import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { contactFor, experienceById, rememberOverlay } from "../catalog";
import { listingFromMaps, mergeMapsHits } from "../mapsNearby";

function stub(over: Partial<Unclaimed> & Pick<Unclaimed, "id" | "title">): Unclaimed {
  return {
    cat: "wellness",
    art: "martialarts",
    area: "Waterloo, ON",
    metroId: "waterloo",
    src: "example.com",
    specs: [],
    options: [],
    includes: [],
    gap: "",
    ...over,
  };
}

test("a Maps stub is still a listing you can open", () => {
  const u = stub({ id: "g-ChIJtestoverlay", title: "Sealy's Karate", lat: 43.46, lon: -80.52 });
  rememberOverlay(u);
  assert.equal(experienceById("g-ChIJtestoverlay")?.title, "Sealy's Karate");
});

test("Maps hits fill gaps without duplicating catalog rows", () => {
  const a = stub({ id: "a", title: "Gentle Arts" });
  const b = stub({ id: "b", title: "Sealy's Karate" });
  assert.deepEqual(mergeMapsHits([a], [a, b]).map((u) => u.id), ["a", "b"]);
  assert.deepEqual(mergeMapsHits([a], []).map((u) => u.id), ["a"]);
});

test("a chain location does not inherit the other city's street", () => {
  const tampa = experienceById("u-escgy");
  assert.ok(tampa);
  assert.match(contactFor(tampa!)?.city || "", /Tampa/i);
  const waterloo = stub({ id: "cg-escapologycomwaterloo", title: "Escapology Waterloo", src: "escapology.com", area: "Waterloo, ON" });
  rememberOverlay(waterloo);
  assert.equal(contactFor(waterloo), null);
});

/**
 * Two Maps results whose place ids agree on their first 40 characters. Google's `Ei...` ids are a base64
 * address, so two units at one address share as long a prefix as the addresses do, and the id a card is built
 * under used to be cut to 40: the second shop was handed the first's card and opened the first's page.
 */
test("two place ids that agree for 40 characters are two shops", () => {
  const long = "EiExMjM0IEtpbmcgU3RyZWV0IFdlc3QsIFdhdGVybG9vLCBPTiwgQ2FuYWRh";
  const place = (placeId: string, name: string) => ({
    placeId,
    name,
    host: "",
    city: "Waterloo",
    region: "ON",
    lat: 43.46,
    lon: -80.52,
    rating: null,
    reviews: null,
  });
  const first = listingFromMaps(place(long + "Unit1", "Grand River Rafting"), "rafting");
  const second = listingFromMaps(place(long + "Unit2", "King Street Climbing"), "climbing");
  assert.notEqual(first.id, second.id);
  assert.equal(second.title, "King Street Climbing");
  // The same place asked for twice is still one listing.
  assert.equal(listingFromMaps(place(long + "Unit2", "King Street Climbing"), "climbing").id, second.id);
});
