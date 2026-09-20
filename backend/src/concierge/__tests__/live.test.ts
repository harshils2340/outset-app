import { strict as assert } from "node:assert";
import test, { afterEach } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * What a shop can actually sell, read from its own booking system.
 *
 * The vendor is stubbed rather than called: this is about what we do with the answer, which is where the bugs
 * a guest notices live. A departure that has already left, or one on a day they did not ask about, is offered
 * under a line that reads "here is what's actually free", so both are worth pinning down.
 *
 * The module opens the catalog on import and the catalog is not in a checkout, so the tests point it at a
 * scratch file first. Nothing here reads it: the whole answer comes from the stub below.
 */
process.env.OUTSET_DB = process.env.OUTSET_DB || join(tmpdir(), "outset-concierge-test.db");
const { departed, fareharborLive, clearFeedCache } = await import("../live.ts");

const SHOP = "https://fareharbor.com/embeds/book/torontohelitours/?full-items=yes";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function avail(pk: number, itemPk: number, name: string, startAt: string): Record<string, unknown> {
  return {
    pk, start_at: startAt, is_bookable: true, is_sold_out: false, is_unlisted: false,
    is_bookable_only_by_phone: false, approximate_available_capacity: 6,
    book_url: `/embeds/book/torontohelitours/items/${itemPk}/calendar/`, item: { pk: itemPk, name },
  };
}

/** One FareHarbor, answering from a table instead of the network. */
function stubFareharbor(days: { date: string; avs: Record<string, unknown>[] }[]): { calls: string[] } {
  // A new stub is a new world: the reader caches responses by URL for a minute, and these tests share URLs.
  clearFeedCache();
  const calls: string[] = [];
  const body = (url: string): unknown => {
    if (url.includes("/calendar/")) {
      return { calendar: { weeks: [{ days: days.map((d) => ({ formatted_date: d.date, availabilities: d.avs })) }] } };
    }
    if (url.includes("/effective-sheets/")) return { effective_sheets: { total_sheet: { pk: 55 } } };
    if (url.includes("/pricing/availabilities/")) {
      return {
        price_previews: {
          customer_types: [
            { customer_type_rate: 100, total: 9951 },
            { customer_type_rate: 101, total: 5000 },
            // A zero total is FareHarbor saying "ask us", not "free".
            { customer_type_rate: 102, total: 0 },
          ],
        },
      };
    }
    if (/\/items\/\d+\/availabilities\/\d+\//.test(url)) {
      return {
        availability: {
          customer_type_rates: [
            { pk: 100, minimum_party_size: 1, maximum_party_size: 6, customer_prototype: { display_name: "Adult" } },
            { pk: 101, minimum_party_size: 1, maximum_party_size: 6, customer_prototype: { display_name: "Child (2-11)" } },
            { pk: 102, minimum_party_size: 1, maximum_party_size: 6, customer_prototype: { display_name: "Private charter" } },
          ],
        },
      };
    }
    return {};
  };
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    return { ok: true, json: async () => body(url) };
  }) as unknown as typeof fetch;
  return { calls };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a departure that has already left is not free tonight", () => {
  const now = Date.parse("2026-09-20T21:00:00-04:00");
  assert.equal(departed("2026-09-20T10:00:00-04:00", now), true);
  assert.equal(departed("2026-09-20T22:30:00-04:00", now), false);
  // Nine in the evening in Toronto is six in Vancouver, where a nine o'clock departure has not left yet.
  assert.equal(departed("2026-09-20T21:00:00-07:00", now), false);
  // No offset means we do not know whose clock it is on, so nothing is assumed.
  assert.equal(departed("2026-09-20T10:00:00", now), false);
  assert.equal(departed(undefined, now), false);
  assert.equal(departed("not a time", now), false);
});

test("a one day window is that day, not that day and the next", async () => {
  const from = new Date(Date.now() + 3 * 86400_000);
  const next = new Date(from.getTime() + 86400_000);
  stubFareharbor([
    { date: ymd(from), avs: [avail(1, 10, "Heli Tour #1", ymd(from) + "T12:00:00-04:00")] },
    { date: ymd(next), avs: [avail(2, 11, "Romantic Jewel", ymd(next) + "T19:00:00-04:00")] },
  ]);

  const today = await fareharborLive(SHOP, { from, days: 1 });
  assert.deepEqual(today?.departures.map((d) => d.item), ["Heli Tour #1"]);
  assert.deepEqual(today?.departures.map((d) => d.date), [ymd(from)]);

  const both = await fareharborLive(SHOP, { from, days: 2 });
  assert.deepEqual(both?.departures.map((d) => d.item).sort(), ["Heli Tour #1", "Romantic Jewel"]);
});

test("this morning's departure is dropped and this evening's is kept", async () => {
  const now = new Date();
  const gone = new Date(now.getTime() - 2 * 3600_000);
  const soon = new Date(now.getTime() + 2 * 3600_000);
  stubFareharbor([
    {
      date: ymd(now),
      avs: [
        avail(1, 10, "This morning", gone.toISOString()),
        avail(2, 11, "This evening", soon.toISOString()),
      ],
    },
  ]);

  const r = await fareharborLive(SHOP, { from: now, days: 1 });
  assert.deepEqual(r?.departures.map((d) => d.item), ["This evening"]);
});

test("the headline price is one an adult can buy, before tax", async () => {
  const from = new Date(Date.now() + 3 * 86400_000);
  stubFareharbor([{ date: ymd(from), avs: [avail(1, 10, "Heli Tour #1", ymd(from) + "T12:00:00-04:00")] }]);

  const r = await fareharborLive(SHOP, { from, days: 1 });
  const d = r?.departures[0];
  assert.ok(d);
  assert.equal(d.fromPrice, 99.51, "the child fare is cheaper and is not the headline");
  assert.equal(d.priceLabel, "Adult");
  assert.equal(d.taxIncluded, false, "FareHarbor's own totals exclude tax");
  assert.equal(d.time, "12:00");
  assert.equal(d.seatsLeft, 6);
  assert.equal(d.bookUrl, "https://fareharbor.com/embeds/book/torontohelitours/items/10/calendar/");
  // The $0.00 row is FareHarbor saying "ask us"; it is not a ticket anyone can buy.
  assert.deepEqual(d.rates.map((x) => x.label).sort(), ["Adult", "Child (2-11)"]);
});

test("a sold out day is an answer, not a failure", async () => {
  const from = new Date(Date.now() + 3 * 86400_000);
  const sold = { ...avail(1, 10, "Heli Tour #1", ymd(from) + "T12:00:00-04:00"), is_sold_out: true };
  stubFareharbor([{ date: ymd(from), avs: [sold] }]);

  const r = await fareharborLive(SHOP, { from, days: 1 });
  assert.equal(r?.departures.length, 0);
  assert.equal(r?.note, "Nothing bookable online in the next 1 days.");
});

test("a link that names no shop is not asked about", async () => {
  const { calls } = stubFareharbor([]);
  assert.equal(await fareharborLive("https://fareharbor.com/legal/privacy/"), null);
  assert.equal(calls.length, 0, "no company to ask about, so nothing should have been fetched");
});
