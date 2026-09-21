import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { squareLive, squareRef } from "../square.ts";

/**
 * Which calendar days a Square shop is read for.
 *
 * Square is the one vendor asked in instants rather than in the shop's own dates, and an instant window is
 * not a day window at either end. The window ran `horizon * 86400_000` forward from the question, so a
 * one-day "tonight" reached tomorrow evening and a shop sold out tonight answered with tomorrow morning;
 * and it began at `start` rather than at the start of that day, so "tomorrow" asked at eight in the evening
 * never asked about tomorrow before eight. The vendor is stubbed, because what matters here is which window
 * we ask for and which answers we keep.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const WIDGET = "rivga4vgg85qfq";
const LOCATION = "LN0J87F6T53R6";
const LINK = `https://book.squareup.com/appointments/${WIDGET}/location/${LOCATION}`;

/** UTC throughout, so the test's arithmetic and the shop's clock are the same clock. */
const ZONE = "UTC";

const widgetMeta = () =>
  JSON.stringify({
    id: WIDGET,
    unit_token: LOCATION,
    business: { name: "Gulf Coast Escape Rooms", timezone: ZONE },
    staff: [{ id: "staff-1", employee_token: "TM1aWH8Kylv6JXP4" }],
    services: [
      {
        item_token: "svc-1",
        name: "The Vault",
        variations: [
          { item_variation_token: "var-1", name: "4 people", price_cents: 12000, service_time: 3600, staff_ids: ["staff-1"], price_type: "fixed" },
        ],
      },
    ],
  }).replace(/"/g, "&quot;");

/**
 * One Square, answering from a table instead of the network. `starts` are epoch seconds; the stub hands back
 * every one of them whatever window is asked for, so what the reader keeps is the reader's own decision.
 */
function stubSquare(starts: number[]): { asked: { start: string; end: string }[] } {
  const asked: { start: string; end: string }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/appointments/api/buyer/availability")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        search_availability_request?: { query?: { filter?: { start_at_range?: { start_at?: string; end_at?: string } } } };
      };
      const range = body.search_availability_request?.query?.filter?.start_at_range ?? {};
      asked.push({ start: range.start_at ?? "", end: range.end_at ?? "" });
      return new Response(JSON.stringify({ availability: starts.map((s) => ({ start: s, available: true })) }), { status: 200 });
    }
    return new Response(`<html><head><meta name="widget" content="${widgetMeta()}" /></head></html>`, { status: 200 });
  }) as typeof fetch;
  return { asked };
}

/** Midnight UTC on the day an instant falls on, plus a number of hours. */
const at = (day: Date, hours: number): number =>
  Math.floor(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours) / 1000);

test("squareRef tells a booking widget from a profile page and from a payment link", () => {
  assert.deepEqual(squareRef(LINK), { kind: "widget", widgetId: WIDGET, locationId: LOCATION });
  assert.deepEqual(squareRef(`https://squareup.com/appointments/book/${WIDGET}/${LOCATION}/start`), {
    kind: "widget",
    widgetId: WIDGET,
    locationId: LOCATION,
  });
  assert.deepEqual(squareRef(`https://square.site/book/${LOCATION}/gulf-coast`), {
    kind: "page",
    url: `https://square.site/book/${LOCATION}/gulf-coast`,
  });
  assert.equal(squareRef("https://fareharbor.com/embeds/book/someshop/")?.kind, undefined);
});

test("a one-day window keeps that day's starts and drops the next day's", async () => {
  // The question is asked at nine in the morning, so the whole of today is still ahead of it.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9));
  const tomorrow = new Date(today.getTime() + 86400_000);
  stubSquare([at(today, 21), at(tomorrow, 10)]);

  const read = await squareLive(LINK, { from: today, days: 1, tz: ZONE });
  assert.deepEqual(
    read?.departures.map((d) => d.date),
    [today.toISOString().slice(0, 10)],
    "tomorrow's ten o'clock is outside a one-day window and must not answer tonight",
  );
});

test("a fortnight's window still reaches the days inside it", async () => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9));
  const tomorrow = new Date(today.getTime() + 86400_000);
  stubSquare([at(tomorrow, 10)]);

  const read = await squareLive(LINK, { from: today, days: 14, tz: ZONE });
  assert.deepEqual(read?.departures.map((d) => d.date), [tomorrow.toISOString().slice(0, 10)]);
});

/**
 * The other half of an instant window. `windowFor("tomorrow")` is "now, plus a day", so a guest asking at
 * eight in the evening asked Square about tomorrow from eight in the evening and was told a shop with a free
 * ten o'clock had nothing. The window is the shop's calendar day now, and the request covers all of it.
 */
test("tomorrow asked late in the evening still reaches tomorrow morning", async () => {
  const now = new Date();
  const tonight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20));
  const tomorrow = new Date(tonight.getTime() + 86400_000);
  const { asked } = stubSquare([at(tomorrow, 10)]);

  const read = await squareLive(LINK, { from: tomorrow, days: 1, tz: ZONE });
  assert.deepEqual(read?.departures.map((d) => `${d.date} ${d.time}`), [`${tomorrow.toISOString().slice(0, 10)} 10:00`]);
  assert.ok(
    asked[0] && asked[0].start <= `${tomorrow.toISOString().slice(0, 10)}T00:00`,
    `the request must open before tomorrow began, not at the hour the guest asked: ${asked[0]?.start}`,
  );
});
