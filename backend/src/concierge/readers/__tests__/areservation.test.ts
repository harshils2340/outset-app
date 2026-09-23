import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { areservationLive, areservationRef, clearAreservationCache, ratesOf } from "../areservation.ts";
import { addDays, ymdLocal } from "../../shopday.ts";

/**
 * Which times and which price an aReservation shop is quoted at.
 *
 * The fixture is what linkapi.areservation.com answered for Daytona Beach Parasail on 23 September 2026,
 * stripped. The things it pins are the ones a guest reads: that a sold-out time is not offered, that the
 * price is the slot's own `totalTicketAmount` for one ticket, that an `internal` rate is never on the
 * sheet, and that a `flatRate` private trip is never the headline.
 */

const realFetch = globalThis.fetch;
beforeEach(() => clearAreservationCache());
afterEach(() => {
  globalThis.fetch = realFetch;
});

const TOMORROW = addDays(ymdLocal(new Date()), 1);

type Fixture = { company: unknown; events: unknown[]; event: { rates: unknown[] }; dates: unknown[]; datetimes: { sell_Status: string }[] };
const FIXTURE: Fixture = JSON.parse(readFileSync(new URL("./fixtures/areservation-daytonaparasail.json", import.meta.url), "utf8").replaceAll("{{D1}}", TOMORROW));

/** One aReservation, answering from the fixture instead of the network, and a log of what was asked. */
function stubApi(fx: Fixture = FIXTURE): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    asked.push(u);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (/\/api\/Company\/daytonaparasail$/.test(u)) return json(fx.company);
    if (/\/api\/169\/Events$/.test(u)) return json(fx.events);
    if (/\/api\/169\/Events\/Group\/\d+$/.test(u)) return json(fx.events.slice(0, 1));
    if (/\/api\/169\/Events\/(Parasailing-16|4813)$/.test(u)) return json(fx.event);
    if (/\/api\/169\/Events\/4813\/Dates\?startDate=\d{4}-\d{2}-\d{2}&endDate=\d{4}-\d{2}-\d{2}$/.test(u)) return json(fx.dates);
    if (new RegExp(`/api/169/Events/4813/DateTimes/${TOMORROW}\\?clientTicketList=8020!1$`).test(u)) return json(fx.datetimes);
    if (/\/DateTimes\//.test(u)) return json([]);
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
  return asked;
}

test("the company, the event and the group are read out of every shape of link the catalog holds", () => {
  assert.deepEqual(areservationRef("https://link.areservation.com/event/daytonaparasail/Parasailing-16"), { company: "daytonaparasail", event: "Parasailing-16", group: null });
  assert.deepEqual(areservationRef("https://link.areservation.com/event/chelanparasail"), { company: "chelanparasail", event: null, group: null });
  assert.deepEqual(areservationRef("https://link.areservation.com/event/watersportstampa/"), { company: "watersportstampa", event: null, group: null });
  assert.deepEqual(areservationRef("https://link.areservation.com/eventCalendar/floridacoastalboatrentals"), { company: "floridacoastalboatrentals", event: null, group: null });
  assert.deepEqual(areservationRef("https://link.areservation.com/event/ranalli?Groupid=632"), { company: "ranalli", event: null, group: "632" });
  assert.deepEqual(areservationRef("https://link.areservation.com/event/parasailflorida.com/Parasailing-17"), { company: "parasailflorida.com", event: "Parasailing-17", group: null });
  // A date on the end of a deep link is a date, not an event.
  assert.equal(areservationRef("https://link.areservation.com/event/daytonaparasail/Parasailing-16/2026-09-26")?.event, "Parasailing-16");
  assert.equal(areservationRef("https://link.areservation.com/catalog/truetours/?justGiftCards=true"), null);
  assert.equal(areservationRef("https://example.com/book"), null);
});

test("internal rates are not on the sheet, and the private trip is a group price rather than a headline", () => {
  const { rates, ask } = ratesOf(FIXTURE.event as Parameters<typeof ratesOf>[0], TOMORROW);
  assert.deepEqual(rates, [
    { label: "500ft Flight", price: 79, minParty: null, maxParty: 12 },
    { label: "1000 ft Flight", price: 89, minParty: null, maxParty: 12 },
  ]);
  assert.deepEqual(ask, { rateId: 8020, label: "500ft Flight" });
});

test("a flat-rate boat sold to the public is kept as a group rate and never asked about as a seat", () => {
  const event = {
    eventId: 1,
    rates: [
      { rateId: 5, description: "Whole Boat", internal: false, flatRate: true, rateEffectives: [{ rate: 800 }] },
      { rateId: 6, description: "Adult", internal: false, flatRate: false, rateEffectives: [{ rate: 79 }] },
      { rateId: 7, description: "Child (5-12)", internal: false, flatRate: false, rateEffectives: [{ rate: 49 }] },
    ],
  };
  const { rates, ask } = ratesOf(event, TOMORROW);
  assert.equal(rates.find((r) => r.label === "Whole Boat")?.group, true);
  // The child fare is the cheapest row and is not the headline.
  assert.deepEqual(ask, { rateId: 6, label: "Adult" });
});

test("a sold-out time is not offered, and an open one carries the slot's own price and the shop's name", async () => {
  const asked = stubApi();
  const live = await areservationLive("https://link.areservation.com/event/daytonaparasail/Parasailing-16", { from: new Date(), days: 7 });
  assert.equal(live?.vendor, "areservation");
  assert.equal(live?.business, "DB Parasail & Watersports, LLC");
  assert.deepEqual(
    live!.departures.map((d) => `${d.date} ${d.time} ${d.item} $${d.fromPrice} ${d.priceLabel}`),
    [`${TOMORROW} 12:00 Daytona Parasailing $79 500ft Flight`, `${TOMORROW} 13:30 Daytona Parasailing $79 500ft Flight`],
  );
  assert.equal(live!.departures[0].taxIncluded, false, "Daytona's own copy says '$30+tax' and 'less 3rd party booking fee'");
  assert.equal(live!.departures[0].bookUrl, `https://link.areservation.com/event/daytonaparasail/Parasailing-16/${TOMORROW}`);
  // One event named in the link: the company, that event, its dates and one day's times. No event list.
  assert.ok(!asked.some((u) => /\/169\/Events$/.test(u)), "the event list was not fetched for a link that names its event");
  assert.equal(asked.filter((u) => /DateTimes/.test(u)).length, 1);
});

test("a link that names no event reads the company's events, and stops at the reader's cap", async () => {
  const asked = stubApi();
  const live = await areservationLive("https://link.areservation.com/eventCalendar/daytonaparasail", { from: new Date(), days: 7, maxItems: 1 });
  assert.ok(asked.some((u) => /\/169\/Events$/.test(u)));
  assert.equal(live!.departures.length, 2);
  assert.equal(live!.departures[0].item, "Daytona Parasailing");
});

test("a slot's own adjusted price is quoted over the sheet rate", async () => {
  const fx: Fixture = JSON.parse(JSON.stringify(FIXTURE));
  for (const t of fx.datetimes as unknown as { totalTicketAmount: number }[]) t.totalTicketAmount = 69;
  stubApi(fx);
  const live = await areservationLive("https://link.areservation.com/event/daytonaparasail/Parasailing-16", { from: new Date(), days: 7 });
  assert.equal(live!.departures[0].fromPrice, 69);
});

test("a company the API does not know is 'did not answer', never an empty calendar", async () => {
  stubApi();
  const live = await areservationLive("https://link.areservation.com/event/nobody-here", { from: new Date(), days: 7 });
  assert.deepEqual(live?.departures, []);
  assert.match(live?.note ?? "", /did not answer/);
});

/**
 * The real shop, five requests at most. Off unless `RUN_LIVE=1`. What it checks is that the API still
 * answers in the shape the fixture froze; a failure here beside passing fixture tests means the vendor
 * changed something.
 */
test("live: Daytona Beach Parasail still answers with open times and a price", { skip: !process.env.RUN_LIVE }, async () => {
  globalThis.fetch = realFetch;
  const live = await areservationLive("https://link.areservation.com/event/daytonaparasail/Parasailing-16", { from: new Date(), days: 14, tz: "America/New_York" });
  assert.equal(live?.vendor, "areservation");
  assert.equal(live?.business, "DB Parasail & Watersports, LLC");
  assert.ok(live!.departures.length > 0, "the shop flies daily: " + live?.note);
  for (const d of live!.departures) {
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(d.time, /^\d{2}:\d{2}$/);
    assert.ok(d.fromPrice != null && d.fromPrice >= 50 && d.fromPrice <= 200, "a parasail flight costs about $79: " + d.fromPrice);
  }
  console.log(JSON.stringify(live, null, 1).slice(0, 1200));
});
