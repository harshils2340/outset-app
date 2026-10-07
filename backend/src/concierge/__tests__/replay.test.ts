import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { db, migrate, nowIso } from "../../db/client.ts";
import { forDate, replayLive, endpointFor } from "../replay.ts";
import { addDays, zonedNow, zonedYmd } from "../shopday.ts";

/**
 * The generic replay reader, which had no test of any kind.
 *
 * It is the half of the sniff that runs while a guest waits: `sniff.ts` finds a shop's own availability
 * endpoint once, on the worker, and this reads it. Written after the nine vendor readers and sharing none of
 * their fixes, it carried three of the four traps `backend/src/concierge/AGENTS.md` lists by name: a window a
 * day too wide, days walked in milliseconds rather than on a calendar, and "has this slot already started"
 * asked of the host's clock instead of the shop's.
 *
 * The vendor is stubbed. What matters here is what we do with the answer.
 */

migrate();
db.exec(`CREATE TABLE IF NOT EXISTS booking_endpoints (
  id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, page_url TEXT NOT NULL, endpoint TEXT NOT NULL,
  method TEXT NOT NULL, post_body TEXT, content_type TEXT, score INTEGER NOT NULL,
  sample_times TEXT, sample_prices TEXT, found_at TEXT)`);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let n = 0;

/** One shop with one discovered endpoint. Each case needs its own, because the domain is the key. */
function stubShop(endpoint: string, body: unknown, asked?: string[]): string {
  const id = `replay-${++n}`;
  db.prepare(
    `INSERT INTO operators (id, domain, name, website, icon_key, origin, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'x', 'osm', ?, ?)`,
  ).run(id, `${id}.com`, id, `https://${id}.com`, nowIso(), nowIso());
  db.prepare(
    `INSERT INTO booking_endpoints (id, operator_id, page_url, endpoint, method, post_body, content_type, score, found_at)
     VALUES (?, ?, ?, ?, 'GET', NULL, 'application/json', 9, ?)`,
  ).run(id, id, `https://${id}.com/book`, endpoint, nowIso());
  globalThis.fetch = (async (u: string | URL) => {
    asked?.push(String(u));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return `${id}.com`;
}

/** Late enough that "already started" never decides a test run at an awkward hour. */
const LATE = "23:30";

test("a one-day window is that day, not that day and the next", async () => {
  const asked: string[] = [];
  const domain = stubShop("https://ex.test/avail?date=2026-01-01", [{ time: LATE, name: "Room A", price: 40 }], asked);
  const read = await replayLive(domain, { from: new Date(), days: 1 });
  const today = zonedNow(null).date;
  assert.deepEqual(asked, [`https://ex.test/avail?date=${today}`], "a one-day window asked a second day");
  assert.deepEqual(
    read?.departures.map((d) => d.date),
    [today],
    "a guest asking about tonight was given tomorrow under the same live badge",
  );
});

test("a two-day window is today and tomorrow", async () => {
  const asked: string[] = [];
  const domain = stubShop("https://ex.test/avail?date=2026-01-01", [{ time: LATE, name: "Room A", price: 40 }], asked);
  await replayLive(domain, { from: new Date(), days: 2 });
  const today = zonedNow(null).date;
  assert.deepEqual(asked.map((u) => u.slice(-10)), [today, addDays(today, 1)]);
});

test("the day a guest means is the day where the shop is", async () => {
  const asked: string[] = [];
  // Half past nine in the evening in Los Angeles, which is already tomorrow by UTC.
  const evening = new Date("2026-06-15T04:30:00Z");
  const domain = stubShop("https://ex.test/avail?date=2026-01-01", [], asked);
  await replayLive(domain, { from: evening, days: 1, tz: "America/Los_Angeles" });
  assert.equal(zonedYmd(evening, "America/Los_Angeles"), "2026-06-14");
  assert.deepEqual(asked, ["https://ex.test/avail?date=2026-06-14"], "the shop was asked about tomorrow");
});

/**
 * A fixed zone that puts the shop's own clock at a chosen hour, whatever hour it is on the host.
 *
 * The "has this slot already started" check reads the real clock, as it does in every other reader here and
 * as `resova.ts` and `fishingreservations.ts` both do, so there is no instant to pass it. Choosing the zone
 * instead pins the shop's wall clock without pinning anybody's, and `Etc/GMT+N` is UTC minus N: the sign is
 * inverted in that database on purpose.
 */
function zoneWhereItIs(hour: number): string {
  let off = (hour - new Date().getUTCHours() + 24) % 24;
  if (off > 14) off -= 24;
  return off >= 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
}

test("a slot that has not started where the shop is is still availability", async () => {
  /**
   * Ten in the morning in Los Angeles is five in the evening UTC, and `render.yaml` gives the API no TZ. Read
   * against the host's clock, every slot before five o'clock is already gone, which is most of a west coast
   * shop's trading day: the afternoon it is still selling was dropped and the guest was told it publishes
   * nothing. The same gap the other way offers a morning that finished hours ago.
   */
  const tz = zoneWhereItIs(14);
  const domain = stubShop("https://ex.test/avail?date=2026-01-01", [
    { time: "12:00", name: "Lunchtime", price: 40 },
    { time: "16:00", name: "Afternoon", price: 40 },
  ]);
  const read = await replayLive(domain, { from: new Date(), days: 1, tz });
  assert.deepEqual(
    read?.departures.map((d) => d.time),
    ["16:00"],
    "the shop's own afternoon was dropped as past, or its finished lunchtime offered",
  );
});

test("forDate rewrites the day the widget happened to be discovered on", () => {
  const domain = stubShop("https://ex.test/avail?date=2026-01-01&n=3", []);
  const ep = endpointFor(domain);
  assert.ok(ep);
  assert.equal(forDate(ep, "2026-10-20").url, "https://ex.test/avail?date=2026-10-20&n=3");
});
