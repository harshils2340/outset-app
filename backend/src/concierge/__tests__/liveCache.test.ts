import test from "node:test";
import assert from "node:assert/strict";
import { fareharborLive } from "../live.ts";

/**
 * The cache and the calendar fetches, which together were the concierge's non-determinism.
 *
 * The symptom was that the same question answered with live times one minute and none the next. It was
 * reported as a race and it was not one. Measured on Toronto Heli Tours on 20 September 2026: a cold read
 * costs 20.7 seconds, of which 16.5 — eighty per cent — is the month calendars, and `plan.ts` allows a cold
 * shop twelve. So the first read of any shop always lost. The read it abandoned kept running and filled the
 * cache, so the next read took two milliseconds. With the entries living sixty seconds, that whole cost was
 * re-paid every minute, and whether a guest saw times came down to whether anyone had asked about that shop
 * recently. A demo is by definition the first question after a quiet period, which is why it only ever failed
 * in front of an audience.
 *
 * These pin the two things that fixed it, both of which are one edit away from silently coming back: entries
 * that outlive the cost of rebuilding them, and two calendars fetched at the same time rather than one after
 * the other. Neither needs the network.
 */

type Fetched = { url: string; startedAt: number };

/**
 * Answer FareHarbor's shapes from memory, recording when each request began. The delay is what makes the
 * sequential-versus-parallel question answerable: two 60ms calls one after the other start 60ms apart, and
 * two at the same time start together.
 */
function withFakeFareharbor(delayMs: number, run: (calls: Fetched[]) => Promise<void>): Promise<void> {
  const calls: Fetched[] = [];
  const real = globalThis.fetch;
  const t0 = Date.now();
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, startedAt: Date.now() - t0 });
    await new Promise((r) => setTimeout(r, delayMs));
    const body = /\/calendar\//.test(url)
      ? {
          calendar: {
            weeks: [
              {
                days: [
                  {
                    formatted_date: new Date().toISOString().slice(0, 10),
                    availabilities: [{ pk: 1, start_at: new Date().toISOString().slice(0, 11) + "09:00:00-04:00", is_bookable: true, item: { pk: 7, name: "Heli Tour #1" }, book_url: "/b/1/" }],
                  },
                ],
              },
            ],
          },
        }
      : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return run(calls).finally(() => {
    globalThis.fetch = real;
  });
}

/** A shortname nothing else in the suite uses, so the module-level cache cannot be pre-warmed by another test. */
const shop = (n: string) => `https://fareharbor.com/embeds/book/cachetest${n}/`;

test("the two month calendars are asked for at the same time, not one after the other", async () => {
  await withFakeFareharbor(60, async (calls) => {
    // A fortnight from today straddles two months often but not always, so the window is forced wide enough
    // that two are certain: 40 days always spans at least two calendar months.
    await fareharborLive(shop("par"), { from: new Date(), days: 40, maxItems: 1 });
    const cals = calls.filter((c) => /\/calendar\//.test(c.url));
    assert.ok(cals.length >= 2, `expected at least two month calendars, got ${cals.length}`);
    const spread = Math.max(...cals.map((c) => c.startedAt)) - Math.min(...cals.map((c) => c.startedAt));
    // Serial fetches start a full delay apart; parallel ones start together. 60ms apart would be serial.
    assert.ok(spread < 40, `calendars started ${spread}ms apart, which is one after the other, not together`);
  });
});

test("a second read inside the window costs nothing, because that is what stopped the answer changing", async () => {
  await withFakeFareharbor(10, async (calls) => {
    const url = shop("ttl");
    await fareharborLive(url, { from: new Date(), days: 14, maxItems: 1 });
    const first = calls.length;
    assert.ok(first > 0, "the first read has to actually fetch something");
    await fareharborLive(url, { from: new Date(), days: 14, maxItems: 1 });
    assert.equal(calls.length, first, "the second read went upstream again; the cache is not holding");
  });
});

test("entries outlive the cost of rebuilding them", async () => {
  // Not a style preference. A cold read is measured in tens of seconds and plan.ts allows twelve, so an
  // entry that expires in one minute guarantees the expensive read lands on a guest again and again. Ten
  // minutes is also what enrich/availability.ts uses, so the listing page and the concierge agree on how
  // stale a booking calendar may be.
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../live.ts", import.meta.url), "utf8"));
  const ttl = /const TTL_MS = ([^;]+);/.exec(src)?.[1] ?? "";
  const ms = Function(`"use strict"; return (${ttl});`)() as number;
  assert.ok(ms >= 5 * 60_000, `TTL is ${ms}ms; anything under five minutes re-pays a 15 to 20 second cold read at a guest`);
});

test("one flight per URL, so guests asking about the same town do not race each other", async () => {
  await withFakeFareharbor(40, async (calls) => {
    const url = shop("flight");
    const [a, b] = await Promise.all([
      fareharborLive(url, { from: new Date(), days: 14, maxItems: 1 }),
      fareharborLive(url, { from: new Date(), days: 14, maxItems: 1 }),
    ]);
    const cals = calls.filter((c) => /\/calendar\//.test(c.url));
    const distinct = new Set(cals.map((c) => c.url));
    assert.equal(cals.length, distinct.size, "the same calendar URL was fetched twice by two concurrent readers");
    assert.deepEqual(a?.departures.length, b?.departures.length);
  });
});
