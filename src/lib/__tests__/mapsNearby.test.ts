import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { contactFor, experienceById, rememberOverlay } from "../catalog";
import { mergeMapsHits } from "../mapsNearby";

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
