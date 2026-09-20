import assert from "node:assert/strict";
import test from "node:test";

import { METROS, metroById, metroLabel, metroShort } from "../../data/metros";
import { ZONE_METRO, ipGuessFitsClock, metroFromTimeZone } from "../here";

/**
 * The first thing a guest sees is whatever this guesses, and nothing downstream sanity-checks it: the home
 * rails filter on `u.metroId === state.metroId`, and `metroLabel`/`metroShort` print the id as typed when it
 * names no metro. So an id in the zone table that is not one of the 47 metros is an empty home page under a
 * lowercase heading, for everybody in that time zone, on their first visit.
 */

test("every time zone we map points at a metro that actually exists", () => {
  for (const [zone, id] of Object.entries(ZONE_METRO)) {
    assert.ok(metroById(id), `${zone} maps to "${id}", which is not one of the ${METROS.length} metros`);
  }
});

test("a metro id that is not a metro would print as itself and match no listing", () => {
  // Why the test above matters, pinned so the guard is never quietly dropped.
  assert.equal(metroById("winnipeg"), undefined);
  assert.equal(metroLabel("winnipeg"), "winnipeg");
  assert.equal(metroShort("winnipeg"), "winnipeg");
});

test("a zone we list no metro in answers nothing, so the home opens on Anywhere", () => {
  const zoned = (zone: string) => {
    const real = Intl.DateTimeFormat;
    (Intl as any).DateTimeFormat = function () {
      return { resolvedOptions: () => ({ timeZone: zone }) };
    };
    try {
      return metroFromTimeZone();
    } finally {
      Intl.DateTimeFormat = real;
    }
  };
  assert.equal(zoned("America/Winnipeg"), null);
  assert.equal(zoned("America/Regina"), null);
  assert.equal(zoned("Europe/Berlin"), null);
  assert.equal(zoned("America/Toronto"), "toronto");
  assert.equal(zoned("Pacific/Honolulu"), "honolulu");
});

test("a clock the browser will not name is not an error", () => {
  const real = Intl.DateTimeFormat;
  (Intl as any).DateTimeFormat = function () {
    throw new Error("no Intl here");
  };
  try {
    assert.equal(metroFromTimeZone(), null);
  } finally {
    Intl.DateTimeFormat = real;
  }
});

test("an IP city in another country is not treated as the guest moving", () => {
  const ashburn = { kind: "point" as const, place: { label: "Ashburn", sub: "VA", lat: 39.04, lon: -77.49 } };
  assert.equal(ipGuessFitsClock(ashburn, "toronto"), false);
  assert.equal(ipGuessFitsClock({ kind: "metro", metroId: "nyc" }, "toronto"), false);
  assert.equal(ipGuessFitsClock({ kind: "metro", metroId: "toronto" }, "toronto"), true);
  assert.equal(ipGuessFitsClock({ kind: "point", place: { label: "Toronto", sub: "ON", lat: 43.65, lon: -79.38 } }, "toronto"), true);
  assert.equal(ipGuessFitsClock(ashburn, null), true, "no clock means the IP is the only answer");
});
