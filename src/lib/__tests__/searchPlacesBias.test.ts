import assert from "node:assert/strict";
import test from "node:test";
import { searchPlaces } from "../places";

/**
 * The Where box passes the guest's own place as a bias, so Photon can rank a query like "Spring" by what is
 * actually close. The cache used to key on the typed text alone, so the same text asked once with no bias and
 * again after "Nearby" set one, or asked near two different places across a session, returned whichever answer
 * happened to land in the cache first: the bias had no effect the second time a guest typed the same word.
 */

function stubFetch(byLat: Record<string, string>): typeof fetch {
  return (async (url: string | URL) => {
    const u = new URL(String(url));
    const lat = u.searchParams.get("lat") || "none";
    const name = byLat[lat] ?? "Unbiased Town";
    return {
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-82, 28] },
            properties: { name, countrycode: "US" },
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;
}

test("the same typed text with a different bias asks Photon again instead of reusing the other bias's answer", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = stubFetch({ "10": "Near Point A", "20": "Near Point B" });
  try {
    const a = await searchPlaces("uniqueneedle1", { lat: 10, lon: 10 });
    const b = await searchPlaces("uniqueneedle1", { lat: 20, lon: 20 });
    assert.equal(a[0]?.label, "Near Point A");
    assert.equal(b[0]?.label, "Near Point B", "a different bias for the same text must not read the first bias's cached answer");
  } finally {
    globalThis.fetch = real;
  }
});

test("the same text and bias still hits the cache rather than asking twice", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: string | URL) => {
    calls++;
    return stubFetch({ "30": "Repeat Town" })(url);
  }) as typeof fetch;
  try {
    await searchPlaces("uniqueneedle2", { lat: 30, lon: 30 });
    await searchPlaces("uniqueneedle2", { lat: 30, lon: 30 });
    assert.equal(calls, 1, "a repeat of the same query and bias is served from the cache");
  } finally {
    globalThis.fetch = real;
  }
});
