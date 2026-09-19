import { test } from "node:test";
import assert from "node:assert/strict";
import { getAvailability } from "../availability.ts";

/**
 * The operator's real calendar, read from their own booking system.
 *
 * Two things these fixtures pin, both of them things a guest sees:
 *
 * 1. A FareHarbor company calendar is every trip that company sells, so a shop running two boats at nine
 *    answers with two departures carrying the same `start_at`. The reader keeps both, which is right, and the
 *    picker has to know they are one start time.
 * 2. Peek costs one call per date for its times and the budget stops after two or three, so most open dates
 *    come back with no times at all. The marker row that stands in for them now says `timeUnknown`, because
 *    its "T00:00" was being drawn as a midnight departure a guest could book.
 *
 * No network: `safeFetch` goes through `globalThis.fetch`, which is answered here from hand written payloads
 * shaped the way each vendor answers. Ids are unique per test because a live answer is cached ten minutes.
 */

type Answer = (url: string) => unknown | undefined;

async function withVendor<T>(answer: Answer, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = answer(url);
    if (body === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/**
 * `publishedBookingUrl` keeps the index it fetched for an hour, so every test here answers with the same one
 * and the first fetch serves the rest. An id left out of it is a listing with no booking url.
 */
const INDEX = {
  urls: {
    "o-two-boats-test": "https://fareharbor.com/embeds/book/twoboats/?full-items=yes",
    "o-peek-budget-test": "https://book.peek.com/s/2530f333-35eb-43fc-b661-6c7d3c95dfea/LR2Jm",
    "o-other-vendor-test": "https://www.rezdy.com/booking?w=123",
    "o-xola-button-test": "https://xola.com/button/6a7b8c9d0e1f2a3b4c5d6e7f",
    "o-xola-nobutton-test": "https://xola.com/button/1112223334445556667778a9",
  },
};

test("two FareHarbor boats leaving at nine are two departures on one start time", async () => {
  const id = "o-two-boats-test";
  const r = await withVendor(
    (url) => {
      if (url.includes("live-index.json")) return INDEX;
      if (url.endsWith("/items/")) return { items: [{ pk: 1, name: "Dolphin Watch" }, { pk: 2, name: "Sunset Cruise" }] };
      if (url.includes("/calendar/"))
        return {
          calendar: {
            weeks: [
              {
                days: [
                  {
                    at: "2026-09-20",
                    availabilities: [
                      { start_at: "2026-09-20T09:00:00-04:00", item: { pk: 1 }, approximate_available_capacity: 2, book_url: "/b/1/" },
                      { start_at: "2026-09-20T09:00:00-04:00", item: { pk: 2 }, approximate_available_capacity: 40, book_url: "/b/2/" },
                      { start_at: "2026-09-20T13:00:00-04:00", item: { pk: 1 }, book_url: "/b/3/" },
                    ],
                  },
                ],
              },
            ],
          },
        };
      return undefined;
    },
    () => getAvailability(id, "2026-09-20", 2),
  );

  assert.equal(r.live, true);
  assert.equal(r.vendor, "fareharbor");
  const slots = r.days[0].slots;
  assert.equal(r.days[0].date, "2026-09-20");
  assert.equal(slots.length, 3);
  // The wall clock is the shop's own and is never shifted into ours.
  assert.deepEqual(slots.map((s) => s.startsAt), ["2026-09-20T09:00", "2026-09-20T09:00", "2026-09-20T13:00"]);
  assert.deepEqual(slots.map((s) => s.seatsLeft), [2, 40, undefined]);
  // Neither of the nine o'clock departures is a placeholder: both are real times.
  assert.ok(slots.every((s) => !s.timeUnknown));
});

test("a Peek date whose times the budget never reached is marked, not given a midnight", async () => {
  const id = "o-peek-budget-test";
  const dates = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];
  const r = await withVendor(
    (url) => {
      if (url.includes("live-index.json")) return INDEX;
      if (url.includes("/programs/")) return { data: { id: "p1" }, included: [{ type: "activity", id: "a1", attributes: { name: "Sunset Cruise" } }] };
      if (url.includes("availability-times")) return { data: [{ id: "t1", attributes: { time: "5:30 PM", spots: 6, prices: [{ pricing: [{ price: { amount: "89.00" } }] }] } }] };
      if (url.includes("availability-dates")) return { data: dates.map((d) => ({ id: d, attributes: { date: d, "availability-status": "available" } })) };
      return undefined;
    },
    () => getAvailability(id, dates[0], dates.length),
  );

  assert.equal(r.live, true);
  assert.equal(r.vendor, "peek");
  assert.equal(r.partial, true);
  const timed = r.days[0].slots;
  assert.equal(timed.length, 1);
  assert.equal(timed[0].startsAt, "2026-09-20T17:30");
  assert.equal(timed[0].timeUnknown, undefined);
  assert.equal(timed[0].priceCents, 8900);
  assert.equal(timed[0].seatsLeft, 6);
  // Every other open date carries one marker row and nothing that reads as a departure.
  for (const day of r.days.slice(1)) {
    assert.equal(day.slots.length, 1, day.date);
    assert.equal(day.slots[0].timeUnknown, true, day.date);
    assert.equal(day.slots[0].startsAt, day.date + "T00:00");
  }
});

test("a listing with no booking url, and one on a system we cannot read, both answer dead", async () => {
  const none = await withVendor(
    (url) => (url.includes("live-index.json") ? INDEX : undefined),
    () => getAvailability("o-no-url-test", "2026-09-20", 3),
  );
  assert.equal(none.live, false);
  assert.deepEqual(none.days, []);
  assert.equal(none.vendor, null);

  const other = await withVendor(
    (url) => (url.includes("live-index.json") ? INDEX : undefined),
    () => getAvailability("o-other-vendor-test", "2026-09-20", 3),
  );
  assert.equal(other.live, false);
  assert.equal(other.vendor, null);
});

test("a Xola button embed names its seller before the experience feed is asked", async () => {
  const id = "o-xola-button-test";
  const seller = "5f1a2b3c4d5e6f708192a3b4";
  const asked: string[] = [];
  const r = await withVendor(
    (url) => {
      asked.push(url);
      if (url.includes("live-index.json")) return INDEX;
      if (url.includes("/api/buttons/")) return { seller: { id: seller } };
      if (url.includes("/api/experiences")) {
        // The feed is only ever asked for the real seller, never for "button:<id>".
        if (!url.includes("seller=" + seller)) return undefined;
        return { data: [{ id: "e1", name: "Night Dive", priceSchemes: [{ price: 150 }, { price: 99.5 }] }] };
      }
      if (url.includes("/api/availability")) return { e1: { "2026-09-20": { "930": 4, "1730": 0 } } };
      return undefined;
    },
    () => getAvailability(id, "2026-09-20", 2),
  );

  assert.equal(r.live, true);
  assert.equal(r.vendor, "xola");
  assert.ok(asked.some((u) => u.includes("/api/buttons/6a7b8c9d0e1f2a3b4c5d6e7f")));
  const slots = r.days[0].slots;
  // 09:30 has seats; the 17:30 departure states none left and is not offered.
  assert.deepEqual(slots.map((s) => s.startsAt), ["2026-09-20T09:30"]);
  assert.equal(slots[0].seatsLeft, 4);
  assert.equal(slots[0].priceCents, 9950);
  assert.equal(slots[0].bookUrl, "https://checkout.xola.com/index.html#seller/" + seller + "/experiences/e1");
});

test("a Xola button whose seller cannot be read answers dead rather than guessing", async () => {
  const r = await withVendor(
    (url) => {
      if (url.includes("live-index.json")) return INDEX;
      if (url.includes("/api/buttons/")) return { seller: {} };
      return undefined;
    },
    () => getAvailability("o-xola-nobutton-test", "2026-09-20", 2),
  );
  assert.equal(r.live, false);
  assert.equal(r.vendor, "xola");
  assert.deepEqual(r.days, []);
});
