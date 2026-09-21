import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { checkfrontLive } from "../drivers/checkfront.ts";
import { addDays, ymdLocal } from "../shopday.ts";

/**
 * Which day a Checkfront shop is allowed to answer with.
 *
 * This driver walks forward to whatever day an item next runs, which is the right behaviour for "when could
 * we come" and the wrong one for "tonight": a shop shut tonight answered with a departure up to a fortnight
 * away, under a live badge, and because the read was not empty `plan.ts` never widened and never said the
 * date had moved. The vendor is stubbed; what is under test is which of its days reach a guest.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ACCOUNT = "adventureroomscanada";
const LINK = `https://${ACCOUNT}.checkfront.com/reserve/`;

const TODAY = ymdLocal(new Date());
const compact = (d: string) => d.replace(/-/g, "");

/** A slot late enough in the day that "already started" never decides a test run at an awkward hour. */
const LATE = "23:30:00";

/**
 * One Checkfront account, answering from a table instead of the network.
 *
 * `open` is the set of dates the item really runs. Every other date in the fortnight comes back closed,
 * which is also what proves to the driver that this account answers per date rather than publishing a
 * fixed opening-hours grid.
 */
function stubCheckfront(open: Record<string, string[]>) {
  const dates = (only?: string) => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i <= 15; i += 1) {
      const date = addDays(TODAY, i);
      const times = open[date];
      const listed = times && (!only || only === date);
      out[compact(date)] = listed
        ? { status: "A", timeslots: times.map((t) => ({ start_time: t, status: "A", A: 4 })), price: { adult: 32 } }
        : { status: "X", timeslots: [] };
    }
    return out;
  };

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/reserve/inventory/")) {
      return new Response(`<div class="cf-item-data-428"></div>`, { status: 200 });
    }
    if (u.includes("/reserve/api/?call=rate")) {
      const body = String(init?.body ?? "");
      // A query for one date answers for that date; the fortnight query answers for all of them.
      const one = body.match(/start_date=(\d{4}-\d{2}-\d{2})(?!.*end_date)/)?.[1];
      return new Response(
        JSON.stringify({
          item: {
            item_id: 428,
            name: "The Mayor's Office",
            param: { adult: { lbl: "Adult" } },
            rate: { dates: dates(one), summary: { price: { unit: "per person" } } },
          },
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

test("a one-day window is not answered with a day the shop next runs a fortnight out", async () => {
  const faraway = addDays(TODAY, 9);
  stubCheckfront({ [faraway]: ["14:00:00"] });
  const read = await checkfrontLive(LINK, { date: new Date(), days: 1 });
  assert.deepEqual(
    read?.departures.map((d) => d.date),
    [],
    "a shop shut tonight must come back empty, so plan.ts can widen and say the date moved",
  );
});

test("a fortnight's window still reaches the day the shop next runs", async () => {
  const faraway = addDays(TODAY, 9);
  stubCheckfront({ [faraway]: ["14:00:00"] });
  const read = await checkfrontLive(LINK, { date: new Date(), days: 14 });
  assert.deepEqual(read?.departures.map((d) => `${d.date} ${d.time}`), [`${faraway} 14:00`]);
});

test("no window at all keeps the behaviour this driver shipped with", async () => {
  const faraway = addDays(TODAY, 9);
  stubCheckfront({ [faraway]: ["14:00:00"] });
  const read = await checkfrontLive(LINK, { date: new Date() });
  assert.deepEqual(read?.departures.map((d) => d.date), [faraway]);
});

test("today's own slots still answer a one-day window, priced from the day's own fares", async () => {
  stubCheckfront({ [TODAY]: [LATE] });
  const read = await checkfrontLive(LINK, { date: new Date(), days: 1 });
  assert.deepEqual(read?.departures.map((d) => `${d.date} ${d.time}`), [`${TODAY} 23:30`]);
  assert.equal(read?.departures[0]?.fromPrice, 32);
});
