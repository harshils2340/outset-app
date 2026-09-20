import assert from "node:assert/strict";
import test from "node:test";

import { METROS, metroById, metroLabel, metroShort } from "../../data/metros";
import type { Opening } from "../here";
import { ZONE_METRO, ipGuessFitsClock, metroFromTimeZone, openingFeed, shouldLocate } from "../here";

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

/**
 * `openingFeed` answers what the home may draw before GPS lands, and `withPlace` reads `.kind` on the answer
 * and then `.place` or `.metroId` off it. It never returns `null`, and said it might: that one word cost the
 * app's whole type-check, because a possibly-null `feed.kind` stops TypeScript narrowing the union at all and
 * every field read after it became an error. Pinned as behaviour so the signature cannot drift back.
 */
test("the home's opening feed is always one of the three shapes, never nothing", () => {
  const pin = { kind: "point" as const, place: { label: "Near me", sub: "Current location", lat: 43.46, lon: -80.52 } };
  const town = { kind: "point" as const, place: { label: "Waterloo", sub: "ON", lat: 43.46, lon: -80.52 } };
  const city = { kind: "metro" as const, metroId: "toronto" };
  const cases: Opening[] = [
    { guess: null, chosen: false, recheck: true },
    { guess: null, chosen: true, recheck: false },
    { guess: pin, chosen: false, recheck: true },
    { guess: town, chosen: true, recheck: false },
    { guess: town, chosen: false, recheck: true },
    { guess: city, chosen: true, recheck: false },
    { guess: city, chosen: false, recheck: true },
  ];
  for (const c of cases) {
    const feed = openingFeed(c);
    assert.ok(feed, "openingFeed answered nothing for " + JSON.stringify(c));
    assert.ok(["point", "metro", "wait"].includes(feed.kind), "unknown feed kind " + feed.kind);
  }
  // A GPS pin draws at once; a clock city nobody picked waits rather than painting the wrong town.
  assert.deepEqual(openingFeed({ guess: pin, chosen: false, recheck: true }), pin);
  assert.equal(openingFeed({ guess: city, chosen: false, recheck: true }).kind, "wait");
});

/**
 * Who gets asked where they are, and when. A guest whose first visit is a shared listing link is not asked on
 * that page, which is the point, but the home behind it opens in `locating` and something has to end that
 * wait. Asked of the opening URL alone, nothing ever did: "Back to results" drew two skeleton rails and left
 * them there for the rest of the visit. Driven in a real Chromium before this was written.
 */
test("a listing link does not ask for a location, and the home behind it still does", () => {
  const listing = { screen: "explore", sheet: "request" };
  const home = { screen: "explore", sheet: null };
  assert.equal(shouldLocate(listing, false), false, "a shared listing link must not prompt a stranger");
  assert.equal(shouldLocate(home, false), true, "the home behind it has to be able to settle a place");
  // The dashboard is not the guest home, however the owner got there.
  assert.equal(shouldLocate({ screen: "operator", sheet: null }, false), false);
  // And once a place is settled, coming back to the home is not a reason to ask again.
  assert.equal(shouldLocate(home, true), false);
});
