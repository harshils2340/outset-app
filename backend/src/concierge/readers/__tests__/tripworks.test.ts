import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { tripworksAccount, tripworksLive } from "../tripworks.ts";
import { addDays, ymdLocal } from "../../shopday.ts";

/**
 * Which fare a TripWorks shop is quoted at, and what that fare is called.
 *
 * This reader shipped with no test of any kind, and the part of it a guest actually reads is the one number
 * and the one word printed under a shop's name. Both are decided by `priceOfSlot`, whose own comment is a
 * list of things that have already gone wrong once: `customer_type.price` is not money, a waitlist is not a
 * seat, and a name put on `min_price` is a claim about which ticket that price belongs to. The vendor is
 * stubbed, because what matters here is what we do with the answer rather than whether TripWorks replies.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Tomorrow, so that "a slot that has already started is not availability" never decides a test. */
const TOMORROW = addDays(ymdLocal(new Date()), 1);

type Type = { name: string; price?: number | null; is_visible?: boolean };
type Slot = {
  min_price?: number | null;
  types?: Type[];
  status?: string;
  availability_cnt?: number | null;
  is_ecom_visible?: boolean;
};

/**
 * `shopOf` caches per slug for the life of the process, including its failures, so every case needs a slug
 * of its own or the second one reads the first one's shop.
 */
let n = 0;

/** One TripWorks, answering from a table instead of the network. */
function stubTripworks(exp: { name: string; timezone?: string | null; slots: Slot[] }): string {
  const slug = `shop-${++n}`;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (u.endsWith("/api/init")) {
      return json({
        success: true,
        properties: { company_name: "Harbor Breeze Cruises", default_timezone: exp.timezone ?? null },
        experiences: [{ id: 41, name: exp.name, location: { timezone: exp.timezone ?? null } }],
      });
    }
    if (u.includes("/api/experiences/getInDateRange/")) {
      return json({
        success: true,
        dates: {
          [TOMORROW]: [
            {
              experience_id: 41,
              date: TOMORROW,
              timeslots: exp.slots.map((s, i) => ({
                id: i + 1,
                start_time: `${TOMORROW}T1${i}:00:00+00:00`,
                is_past: false,
                is_ecom_visible: s.is_ecom_visible ?? true,
                availability_cnt: s.availability_cnt ?? 12,
                min_price: s.min_price ?? null,
                experience_timeslot_status: { slug: s.status ?? "open" },
                availabilities: (s.types || []).map((t) => ({
                  customer_type: { id: 1, name: t.name, price: t.price ?? null, is_visible: t.is_visible ?? true },
                })),
              })),
            },
          ],
        },
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return slug;
}

const read = (slug: string) => tripworksLive(`https://${slug}.tripworks.com/widgets/tripBuilder`);

test("a shop selling one kind of ticket has its name put on the price", async () => {
  const slug = stubTripworks({ name: "Shared Helicopter Tour", slots: [{ min_price: 24900, types: [{ name: "Shared" }] }] });
  const live = await read(slug);
  assert.equal(live?.departures.length, 1);
  assert.equal(live?.departures[0].fromPrice, 249);
  assert.equal(live?.departures[0].priceLabel, "Shared");
});

/**
 * The bug this file was written for. `min_price` is the cheapest ticket at the time, so on a sheet of "Adult"
 * and "Child" it is the child's fare; filtering the concessions out and then naming the one type left
 * standing prints the child's number under the adult's name, which no guest can see through.
 */
test("a sheet of Adult and Child is quoted at min_price with no name on it", async () => {
  const slug = stubTripworks({
    name: "Whale Watch",
    slots: [{ min_price: 4800, types: [{ name: "Adult", price: 3500 }, { name: "Child", price: 2500 }] }],
  });
  const live = await read(slug);
  assert.equal(live?.departures[0].fromPrice, 48);
  assert.equal(live?.departures[0].priceLabel, null);
});

test("a slot whose only visible ticket is a child's is priced and left unnamed", async () => {
  const slug = stubTripworks({ name: "Kids Sail", slots: [{ min_price: 2000, types: [{ name: "Child (5-12)" }] }] });
  const live = await read(slug);
  assert.equal(live?.departures[0].fromPrice, 20);
  assert.equal(live?.departures[0].priceLabel, null);
});

/** `customer_type.price` repeats across unrelated shops in round hundredths, so it is a share and not a fare. */
test("the customer type's own price is never quoted, however much it looks like money", async () => {
  const slug = stubTripworks({ name: "Pirate Cruise", slots: [{ min_price: 3200, types: [{ name: "Adult", price: 10000 }] }] });
  const live = await read(slug);
  assert.equal(live?.departures[0].fromPrice, 32);
  assert.deepEqual(live?.departures[0].rates, [{ label: "Adult", price: 32, minParty: null, maxParty: null }]);
});

test("a slot that sells nothing but a waitlist is not a departure", async () => {
  const slug = stubTripworks({
    name: "Balloon Ride",
    slots: [{ min_price: 15000, types: [{ name: "Waitlist" }, { name: "Call to Book" }] }],
  });
  const live = await read(slug);
  assert.deepEqual(live?.departures, []);
});

test("a hidden ticket type is not counted against the one on sale", async () => {
  const slug = stubTripworks({
    name: "Sunset Sail",
    slots: [{ min_price: 6000, types: [{ name: "Adult" }, { name: "Crew Comp", is_visible: false }] }],
  });
  assert.equal((await read(slug))?.departures[0].priceLabel, "Adult");
});

test("a slot with no price of its own is offered with no number rather than a guessed one", async () => {
  const slug = stubTripworks({ name: "Harbour Tour", slots: [{ min_price: null, types: [{ name: "Adult", price: 5000 }] }] });
  const live = await read(slug);
  assert.equal(live?.departures[0].fromPrice, null);
  assert.deepEqual(live?.departures[0].rates, []);
});

test("the account and the shop are read out of every shape of link the catalog holds", () => {
  assert.equal(tripworksAccount("https://harborbreeze.tripworks.com/widgets/tripBuilder?defaultView=agenda"), "harborbreeze");
  assert.equal(tripworksAccount("https://www.google.com/url?q=https%3A%2F%2Fnemesis-balloon-team.tripworks.com%2F"), "nemesis-balloon-team");
  assert.equal(tripworksAccount("https://build.tripworks.com/app.js"), null);
  assert.equal(tripworksAccount("https://example.com/book"), null);
});
