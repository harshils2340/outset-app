import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { browseList, metroVenuePlace, NEAR_RADIUS_KM } from "../../components/explore/feed";
import { ALL_METRO_ID, METROS, metroCoords } from "../../data/metros";
import { nearestLocation } from "../places";
import type { Unclaimed } from "../../data/types";

/**
 * Which of a chain's towns a card names when the guest picked a city rather than a point.
 *
 * `atMetro` puts a chain on a city's page through whichever of its venues is near that city, and the card then
 * printed the area line, which names whichever venue the catalog leads with. So Tampa Bay's page carried
 * "Wheel Fun Rentals · Minneapolis, MN", Orlando's escape rooms opened on "The Escape Game · San Francisco,
 * CA" and Boston's on "Escapology · Armature Works, Tampa, FL": 59 cards over the 50 metros, on 29 listings,
 * each naming a city a thousand miles from the one the guest was browsing.
 *
 * With a GPS point `awayLine` has always named the venue it measured to. This is the same reading for a city
 * picked by name, where there is no honest distance to print beside it.
 */

const CATALOG = (JSON.parse(readFileSync(new URL("../../../public/catalog.json", import.meta.url), "utf8")) as {
  operators: Unclaimed[];
}).operators;

const TAMPA = metroCoords("tampa")!;
/** A pin a given number of km due north of Tampa's centre. */
const north = (km: number) => ({ lat: TAMPA.lat + km / 111, lon: TAMPA.lng });

const chain = (over: Partial<Unclaimed> = {}): Unclaimed =>
  ({
    id: "o-chain",
    title: "Wheel Fun Rentals",
    area: "Minneapolis, MN",
    metroId: "minneapolis",
    cat: "water",
    art: "kayak",
    lat: 44.98,
    lon: -93.27,
    options: [],
    photos: [],
    specs: [],
    includes: [],
    tags: [],
    ...over,
  }) as unknown as Unclaimed;

test("a chain on this city's page through another venue names that venue's town", () => {
  const u = chain({ locations: [{ city: "Safety Harbor", region: "FL", ...north(24) }] as Unclaimed["locations"] });
  assert.equal(metroVenuePlace(u, "tampa"), "Safety Harbor, FL");
});

test("a venue the crawl never found a town for falls back to the city being browsed", () => {
  const street = chain({ locations: [{ street: "255 Water Street", ...north(5) }] as Unclaimed["locations"] });
  assert.equal(metroVenuePlace(street, "tampa"), "Tampa Bay, FL");
  // "Nearby" is not a town: the sync used to write it for a venue whose own town was never read.
  const nearby = chain({ locations: [{ city: "Nearby", region: "FL", ...north(5) }] as Unclaimed["locations"] });
  assert.equal(metroVenuePlace(nearby, "tampa"), "Tampa Bay, FL");
});

test("nothing is renamed when the area line is already the right town", () => {
  // Filed here: the area line is this city's own.
  assert.equal(metroVenuePlace(chain({ metroId: "tampa" }), "tampa"), null);
  // The primary pin is the nearest one, so the area line names it.
  const own = chain({ ...north(3), locations: [{ city: "Safety Harbor", region: "FL", ...north(24) }] as Unclaimed["locations"] });
  assert.equal(metroVenuePlace(own, "tampa"), null);
  // No other venue at all.
  assert.equal(metroVenuePlace(chain(), "tampa"), null);
  // A venue further out than browse reaches: this card is not on that page through it.
  const far = chain({ locations: [{ city: "Ocala", region: "FL", ...north(NEAR_RADIUS_KM + 10) }] as Unclaimed["locations"] });
  assert.equal(metroVenuePlace(far, "tampa"), null);
  // Anywhere picks no city, so there is no venue it stands for.
  const here = chain({ locations: [{ city: "Safety Harbor", region: "FL", ...north(24) }] as Unclaimed["locations"] });
  assert.equal(metroVenuePlace(here, ALL_METRO_ID), null);
  assert.equal(metroVenuePlace(here, ""), null);
});

test("every chain row the shipped catalog puts on a city's page through another venue now names a place", () => {
  let renamed = 0;
  let others = 0;
  const examples: string[] = [];
  for (const m of METROS) {
    const c = metroCoords(m.id);
    if (!c) continue;
    for (const u of browseList(CATALOG, "all", m.id, null)) {
      const line = metroVenuePlace(u, m.id);
      const n = u.metroId === m.id ? null : nearestLocation(u, { lat: c.lat, lon: c.lng });
      const throughAnother = !!n && n.alt;
      if (throughAnother) {
        assert.ok(line, m.id + ": " + u.title + " reaches this page through another venue and still names " + u.area);
        renamed++;
        if (examples.length < 3) examples.push(u.title + ": " + u.area + " -> " + line);
      } else if (line) {
        others++;
      }
    }
  }
  assert.equal(renamed, 59, "the shipped catalog is expected to hold 59 of these rows; " + examples.join("; "));
  assert.equal(others, 0, "no card outside that set may have its place line rewritten");
});

test("both cards and the compare table read the rule", () => {
  for (const f of ["../../components/explore/UnclaimedCard.tsx", "../../components/web/WebHome.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /metroVenuePlace\(/, f + " no longer names the venue a chain is on this page for");
  }
  // The compare table is the same screen's own Where row, so it cannot disagree with the card above it.
  const home = readFileSync(new URL("../../components/web/WebHome.tsx", import.meta.url), "utf8");
  const at = home.indexOf('row("Where"');
  assert.ok(at > 0, "the compare table's Where row was renamed; re-read this test");
  assert.match(home.slice(at, at + 200), /metroVenuePlace\(/, "the compare table's Where row is expected to read the same rule");
});
