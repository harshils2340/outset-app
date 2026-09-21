import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { peekLive, peekRef } from "../peek.ts";
import { addDays, ymdLocal } from "../shopday.ts";

/**
 * What a Peek shop is quoted at, on which day, and under what name.
 *
 * Peek is 257 booking links, the largest single vendor after FareHarbor, and the reader shipped with no test
 * of any kind. Two things a guest reads come out of it: the day the times belong to, which the card only
 * prints when every time on it shares one, and the fare `priceOfSlot` heads the card with. The vendor is
 * stubbed, because what matters here is what we do with the answer rather than whether Peek replies.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const KEY = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const URL_ = `https://book.peek.com/s/${KEY}/K1D9M`;

const TODAY = ymdLocal(new Date());
const TOMORROW = addDays(TODAY, 1);

type Ticket = { id: string; name: string | null; price: number | null };
type Slot = {
  time: string;
  spots?: number | null;
  mode?: string;
  freesale?: boolean;
  minTickets?: number | null;
  duration?: string | null;
  prices?: { option: string; amount?: string | null }[];
};
type Activity = { id: string; name: string; mode?: string; tickets?: Ticket[]; days?: Record<string, Slot[]> };

/** A Peek shop answering from a table instead of the network. */
function stubPeek(shop: { business?: string; timezone?: string | null; activities: Activity[] }) {
  const jsonApi = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);

    // The landing payload: every activity on the link, plus the partner that names the shop's own zone.
    if (/\/programs\/K1D9M$/.test(u)) {
      return jsonApi({
        data: { type: "program", id: "K1D9M" },
        included: [
          { type: "partner", id: "p1", attributes: { name: shop.business ?? "Gulf Coast Cruises", timezone: shop.timezone ?? null } },
          ...shop.activities.map((a) => ({
            type: "program-configuration-activity",
            id: `pca-${a.id}`,
            relationships: {
              activity: { data: { type: "activity", id: a.id } },
              "program-configuration": { data: { type: "program-configuration", id: `p_x--${a.id}` } },
            },
          })),
          ...shop.activities.map((a) => ({
            type: "activity",
            id: a.id,
            attributes: { name: a.name, mode: a.mode ?? "activity" },
          })),
        ],
      });
    }

    // The per-activity program, which is the only place the ticket names and prices appear.
    const perActivity = u.match(/\/programs\/p_x--([^?]+)$/);
    if (perActivity) {
      const a = shop.activities.find((x) => x.id === decodeURIComponent(perActivity[1]));
      const tickets = a?.tickets ?? [];
      return jsonApi({
        data: { type: "program", id: `p_x--${a?.id}` },
        included: [
          {
            type: "activity",
            id: a?.id,
            attributes: { name: a?.name, mode: a?.mode ?? "activity" },
            relationships: { tickets: { data: tickets.map((t) => ({ type: "ticket", id: t.id })) } },
          },
          ...tickets.map((t) => ({
            type: "ticket",
            id: t.id,
            attributes: { name: t.name, "source-price-gross": t.price },
          })),
        ],
      });
    }

    // Which days in the asked range have anything free.
    if (u.includes("/availability-dates?")) {
      const id = new URL(u).searchParams.get("activity-id") || "";
      const a = shop.activities.find((x) => x.id === id);
      return jsonApi({
        data: Object.keys(a?.days ?? {}).map((date) => ({
          id: date,
          attributes: { date, "availability-status": "available" },
        })),
      });
    }

    // The day itself.
    const times = u.match(/\/availability-dates\/(\d{4}-\d{2}-\d{2})\/availability-times\?activity_id=(.+)$/);
    if (times) {
      const a = shop.activities.find((x) => x.id === decodeURIComponent(times[2]));
      const slots = a?.days?.[times[1]] ?? [];
      return jsonApi({
        data: slots.map((s, i) => ({
          id: `${times[1].replace(/-/g, "")}${s.time.replace(":", "")}00_90_slot-${i}`,
          attributes: {
            time: s.time,
            date: times[1],
            spots: s.spots === undefined ? 8 : s.spots,
            "availability-mode": s.mode ?? "available",
            "is-freesale": s.freesale ?? false,
            "minimum-tickets-required": s.minTickets ?? null,
            duration: s.duration ? { name: s.duration } : null,
            prices: (s.prices ?? []).map((p) => ({
              resource_option_id: p.option,
              pricing: [{ price: { amount: p.amount ?? null } }],
            })),
          },
        })),
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

/** A slot late enough in the day that "already started" never decides a test run at an awkward hour. */
const LATE = "23:30";

test("peekRef reads both hosts and both path shapes, and refuses a waiver", () => {
  assert.deepEqual(peekRef(URL_), { key: KEY, code: "K1D9M" });
  assert.deepEqual(peekRef(`https://www.peek.com/w/${KEY}/K1D9M/t?mode=standalone`), { key: KEY, code: "K1D9M" });
  assert.equal(peekRef(`https://book.peek.com/waivers/${KEY}`), null);
  assert.equal(peekRef("https://example.com/book"), null);
});

test("a one-day window is answered with that one day, not with tomorrow as well", async () => {
  stubPeek({
    activities: [
      {
        id: "act-1",
        name: "Sunset Dolphin Cruise",
        tickets: [{ id: "t-adult", name: "Adult", price: 26 }],
        // Nothing left today; the shop's next free day is tomorrow.
        days: { [TOMORROW]: [{ time: "09:00", prices: [{ option: "t-adult", amount: "26.00" }] }] },
      },
    ],
  });
  const read = await peekLive(URL_, { from: new Date(), days: 1 });
  assert.deepEqual(
    read?.departures.map((d) => d.date),
    [],
    "a shop with nothing free tonight must come back empty, so plan.ts can widen and say the date moved",
  );
  assert.match(read?.note ?? "", /Nothing bookable online/);
});

test("a fortnight's window still reaches the days inside it", async () => {
  stubPeek({
    activities: [
      {
        id: "act-1",
        name: "Sunset Dolphin Cruise",
        tickets: [{ id: "t-adult", name: "Adult", price: 26 }],
        days: { [TOMORROW]: [{ time: "09:00", prices: [{ option: "t-adult", amount: "26.00" }] }] },
      },
    ],
  });
  const read = await peekLive(URL_, { from: new Date(), days: 14 });
  assert.deepEqual(read?.departures.map((d) => `${d.date} ${d.time}`), [`${TOMORROW} 09:00`]);
});

test("today's own slots still answer a one-day window", async () => {
  stubPeek({
    activities: [
      {
        id: "act-1",
        name: "Sunset Dolphin Cruise",
        tickets: [{ id: "t-adult", name: "Adult", price: 26 }],
        days: { [TODAY]: [{ time: LATE, prices: [{ option: "t-adult", amount: "26.00" }] }] },
      },
    ],
  });
  const read = await peekLive(URL_, { from: new Date(), days: 1 });
  assert.deepEqual(read?.departures.map((d) => `${d.date} ${d.time}`), [`${TODAY} ${LATE}`]);
});
