import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { clearResovaSessions, resovaAccount, resovaLive, resovaWarm } from "../resova.ts";
import { feedIsWarm } from "../live.ts";
import { addDays, ymdLocal } from "../shopday.ts";

/**
 * Which day a Resova shop is read for, and which fare heads the card.
 *
 * Escapology runs Resova at all 25 of its locations and this reader shipped with no test of any kind. It
 * walks the window a day at a time, so the window is the thing it can get wrong most cheaply: it asked
 * `i <= horizon`, which is a day more than it was given, and stopped at the first day with something free.
 * The vendor is stubbed, because what matters here is what we do with the answer rather than whether Resova
 * replies.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const TODAY = ymdLocal(new Date());
const TOMORROW = addDays(TODAY, 1);

/** A slot late enough in the day that "already started" never decides a test run at an awkward hour. */
const LATE = "23:30:00";

type Category = { name?: string; single_price?: string | number | null; hide?: boolean; min_quantity?: number | null; max_quantity?: number | null };
type Slot = { time: string; available?: boolean; blocked?: boolean; spaces?: number | null; categories?: Category[] };

/**
 * `session()` caches per account for the life of the process, failures included, so every case needs an
 * account of its own or the second one reads the first one's shop.
 */
let n = 0;

/** One Resova, answering from a table instead of the network. */
function stubResova(shop: { rooms: { id: number; name: string; from?: number | null; days?: Record<string, Slot[]> }[] }): string {
  const account = `escapology-${++n}`;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

    // The 2KB Angular shell, which declares the two globals in plain sight.
    if (u.startsWith(`https://${account}.resova.us?widget=true`)) {
      return new Response(`<script>var baseUrl = "${account}.resova.us"; var aeuToken = "tok";</script>`, { status: 200 });
    }
    if (u.endsWith("/api/booking/v1/misc/init")) {
      return json({ items: { data: shop.rooms.map((r) => ({ id: r.id, name: r.name, status: 1, from: { price: r.from ?? null } })) } });
    }
    const times = u.match(/\/availability\/times\/(\d+)\?date=(\d{4}-\d{2}-\d{2})$/);
    if (times) {
      const room = shop.rooms.find((r) => r.id === Number(times[1]));
      const slots = room?.days?.[times[2]] ?? [];
      return json({
        times: slots.map((s) => ({
          time: s.time,
          available: s.available ?? true,
          resource_blocked: s.blocked ?? false,
          occupancy: {
            spaces: { available: s.spaces === undefined ? 6 : s.spaces },
            pricing_categories: s.categories ?? [{ name: "Player", single_price: "37.00" }],
          },
        })),
      });
    }
    // Every other path under the API falls through to the Angular shell, and answers 200 with HTML.
    return new Response("<!doctype html><html></html>", { status: 200 });
  }) as typeof fetch;
  return `https://${account}.resova.us/`;
}

test("resovaAccount reads the account out of a booking link", () => {
  assert.equal(resovaAccount("https://escapologywaterloo.resova.us/book"), "escapologywaterloo");
  assert.equal(resovaAccount("https://Escapology.RESOVA.com/"), "escapology");
  assert.equal(resovaAccount("https://fareharbor.com/embeds/book/someshop/"), null);
});

test("a one-day window is answered with that one day, not with tomorrow as well", async () => {
  const url = stubResova({
    // Nothing left tonight; the room's next free day is tomorrow.
    rooms: [{ id: 7, name: "Who Stole Mona", days: { [TOMORROW]: [{ time: "13:00:00" }] } }],
  });
  const read = await resovaLive(url, { from: new Date(), days: 1 });
  assert.deepEqual(
    read?.departures.map((d) => d.date),
    [],
    "a room with nothing free tonight must come back empty, so plan.ts can widen and say the date moved",
  );
  assert.match(read?.note ?? "", /Nothing bookable online/);
});

test("a week's window still reaches the days inside it", async () => {
  const url = stubResova({ rooms: [{ id: 7, name: "Who Stole Mona", days: { [TOMORROW]: [{ time: "13:00:00" }] } }] });
  const read = await resovaLive(url, { from: new Date(), days: 7 });
  assert.deepEqual(read?.departures.map((d) => `${d.date} ${d.time}`), [`${TOMORROW} 13:00`]);
});

test("today's own slots still answer a one-day window", async () => {
  const url = stubResova({ rooms: [{ id: 7, name: "Who Stole Mona", days: { [TODAY]: [{ time: LATE }] } }] });
  const read = await resovaLive(url, { from: new Date(), days: 1 });
  assert.deepEqual(read?.departures.map((d) => `${d.date} ${d.time}`), [`${TODAY} 23:30`]);
});

test("the slot's own price beats the item's teaser, which is half of it", async () => {
  /**
   * Resova publishes two numbers that disagree: "Who Stole Mona" carries a `from.price` of $18.00 on its
   * tile and charges $37.00 a player at the slot. The slot is what their checkout takes.
   */
  const url = stubResova({
    rooms: [{ id: 7, name: "Who Stole Mona", from: 18, days: { [TODAY]: [{ time: LATE, categories: [{ name: "Player", single_price: "37.00" }] }] } }],
  });
  const read = await resovaLive(url, { from: new Date(), days: 1 });
  assert.equal(read?.departures[0]?.fromPrice, 37);
  assert.equal(read?.departures[0]?.priceLabel, "Player");
});

test("a concession never heads the card while an adult fare is on the sheet", async () => {
  const url = stubResova({
    rooms: [{
      id: 7,
      name: "Who Stole Mona",
      days: {
        [TODAY]: [{
          time: LATE,
          categories: [
            { name: "Adult", single_price: "37.00" },
            { name: "Child (5-12)", single_price: "19.00" },
          ],
        }],
      },
    }],
  });
  const read = await resovaLive(url, { from: new Date(), days: 1 });
  assert.equal(read?.departures[0]?.fromPrice, 37, "a guest who said two of us cannot buy the child's ticket");
  assert.equal(read?.departures[0]?.priceLabel, "Adult");
  assert.deepEqual(read?.departures[0]?.rates.map((r) => r.label), ["Adult", "Child (5-12)"], "both stay on the sheet");
});

test("a hidden category is not a price, and a sold-out or blocked slot is not availability", async () => {
  const url = stubResova({
    rooms: [{
      id: 7,
      name: "Who Stole Mona",
      from: 18,
      days: {
        [TODAY]: [
          { time: "23:00:00", available: false },
          { time: "23:15:00", blocked: true },
          { time: LATE, categories: [{ name: "Staff rate", single_price: "5.00", hide: true }, { name: "Player", single_price: "37.00" }] },
        ],
      },
    }],
  });
  const read = await resovaLive(url, { from: new Date(), days: 1 });
  assert.deepEqual(read?.departures.map((d) => d.time), ["23:30"]);
  assert.equal(read?.departures[0]?.fromPrice, 37);
});

/**
 * Whether a second read of the same shop is given the short deadline.
 *
 * `plan.ts` allows a first read of a shop twelve seconds and a read it expects to be quick rather less, and
 * asks `feedIsWarm` which this is. Its Resova branch read the account out of the link and then looked for it
 * in `live.ts`'s response cache, which only FareHarbor writes to, so the branch could never fire and every
 * Resova shop was given the cold deadline however recently it had been read. What makes the second read quick
 * is the shop's own booking page, kept for the life of the process here.
 */
test("a Resova account already read is known to be warm, and one never read is not", async () => {
  clearResovaSessions();
  const url = stubResova({ rooms: [{ id: 7, name: "Who Stole Mona", days: { [TODAY]: [{ time: LATE }] } }] });
  assert.equal(feedIsWarm(url), false, "nothing has been read yet");
  assert.equal(resovaWarm(url), false);
  await resovaLive(url, { from: new Date(), days: 1 });
  assert.equal(feedIsWarm(url), true, "the shop's page is in hand, so the next read is quick");
  assert.equal(feedIsWarm("https://someoneelse.resova.us/"), false, "one account's page is not another's");
  assert.equal(feedIsWarm("https://fareharbor.com/embeds/book/neverread/"), false, "and FareHarbor keeps its own answer");
});
