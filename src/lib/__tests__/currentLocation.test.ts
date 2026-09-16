import assert from "node:assert/strict";
import test from "node:test";
import { LOCATE_TIMEOUT_MS, currentLocation } from "../places";

/**
 * "Nearby" has to come back.
 *
 * The Where box and the phone search sheet both set a `locating` flag, await `currentLocation()` and clear
 * the flag. While it is set the row reads "Finding you…" and is disabled. So if the promise never settles,
 * the only control that finds a guest's own town is dead for the rest of the visit, and reloading the page
 * is the only way back.
 *
 * It never settled. `getCurrentPosition` is given `timeout: 8000`, but the Geolocation spec stops that clock
 * while the browser asks for permission, so a guest who leaves the permission bar unanswered gets neither
 * callback. Driven in Chromium against the real API with permission withheld, neither one had fired 62
 * seconds later and the row was still "Finding you…", still disabled.
 */

type Geo = {
  getCurrentPosition: (ok: (p: unknown) => void, err: (e: unknown) => void, opts?: unknown) => void;
};

const withGeolocation = async <T,>(geo: Geo | null, run: () => Promise<T>): Promise<T> => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "navigator");
  const before = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, "navigator", { value: geo ? { geolocation: geo } : {}, configurable: true, writable: true });
  try {
    return await run();
  } finally {
    if (had) Object.defineProperty(globalThis, "navigator", { value: before, configurable: true, writable: true });
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
};

test("a permission prompt that is never answered still lets go of the control", async () => {
  const t0 = Date.now();
  const pt = await withGeolocation({ getCurrentPosition: () => {} }, () => currentLocation());
  assert.equal(pt, null, "it gives up rather than hanging");
  assert.ok(Date.now() - t0 >= LOCATE_TIMEOUT_MS - 50, "and only after waiting a fair while for an answer");
});

test("a refusal resolves null rather than rejecting", async () => {
  const pt = await withGeolocation({ getCurrentPosition: (_ok, err) => err({ code: 1, message: "User denied Geolocation" }) }, () => currentLocation());
  assert.equal(pt, null);
});

test("a position resolves at once, and the giving-up timer does not hold the process open", async () => {
  const t0 = Date.now();
  const pt = await withGeolocation(
    { getCurrentPosition: (ok) => ok({ coords: { latitude: 27.9506, longitude: -82.4572 } }) },
    () => currentLocation(),
  );
  assert.deepEqual(pt, { lat: 27.9506, lon: -82.4572 });
  assert.ok(Date.now() - t0 < 1000, "a granted fix does not wait on the timer");
});

test("a browser that throws on the call, or has no geolocation at all, resolves null", async () => {
  assert.equal(
    await withGeolocation({ getCurrentPosition: () => { throw new Error("blocked by permissions policy"); } }, () => currentLocation()),
    null,
  );
  assert.equal(await withGeolocation(null, () => currentLocation()), null);
});

test("a browser that calls back twice resolves once and does not throw", async () => {
  const pt = await withGeolocation(
    {
      getCurrentPosition: (ok, err) => {
        ok({ coords: { latitude: 1, longitude: 2 } });
        err({ code: 3 });
        ok({ coords: { latitude: 9, longitude: 9 } });
      },
    },
    () => currentLocation(),
  );
  assert.deepEqual(pt, { lat: 1, lon: 2 });
});
