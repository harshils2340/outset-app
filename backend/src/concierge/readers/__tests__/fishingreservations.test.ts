import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fishingReservationsLive, fishingReservationsRef, parseTrips } from "../fishingreservations.ts";
import { addDays, ymdLocal } from "../../shopday.ts";

/**
 * What a sportfishing landing's schedule page says, read the way the reader reads it.
 *
 * The fixture is the real Long Beach Sportfishing markup of 23 September 2026 with the chatter cut and the
 * dates replaced, so the four things that make this page awkward are all in it: seats written as `&#52;`,
 * "Sold Out" in words, a blank price, and a charter row whose $895 is the boat rather than a seat.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const TOMORROW = addDays(ymdLocal(new Date()), 1);
const AFTER = addDays(TOMORROW, 1);

/** "2026-09-24" the way the page writes it, "9-24-2026". */
const pageDate = (ymd: string) => `${Number(ymd.slice(5, 7))}-${Number(ymd.slice(8, 10))}-${ymd.slice(0, 4)}`;
const longDate = (ymd: string) => new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

const FIXTURE = readFileSync(new URL("./fixtures/fishingreservations-longbeach.html", import.meta.url), "utf8")
  .replaceAll("{{D1LONG}}", longDate(TOMORROW))
  .replaceAll("{{D2LONG}}", longDate(AFTER))
  .replaceAll("{{D1}}", pageDate(TOMORROW))
  .replaceAll("{{D2}}", pageDate(AFTER));

function stubPage(html: string, status = 200): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    asked.push(String(url));
    return new Response(html, { status, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  return asked;
}

test("the landing and its schedule page are read out of every shape of link the catalog holds", () => {
  assert.deepEqual(fishingReservationsRef("https://longbeach.fishingreservations.net/sales/"), {
    landing: "longbeach",
    page: "https://longbeach.fishingreservations.net/sales/",
    bookBase: "https://longbeach.fishingreservations.net/sales/user.php?trip_id=",
  });
  assert.equal(fishingReservationsRef("https://fishermanslanding.fishingreservations.net/resos/")?.page, "https://fishermanslanding.fishingreservations.net/resos/");
  assert.equal(fishingReservationsRef("https://morrobaylanding.fishingreservations.net/cruises/")?.page, "https://morrobaylanding.fishingreservations.net/cruises/");
  // A link with no path is the default schedule; a boat filter is kept because the listing is for that boat.
  assert.equal(fishingReservationsRef("https://lovelymartha.fishingreservations.net")?.page, "https://lovelymartha.fishingreservations.net/sales/");
  assert.equal(fishingReservationsRef("https://hmb.fishingreservations.net/sales?boat_filter[]=230")?.page, "https://hmb.fishingreservations.net/sales/?boat_filter[]=230");
  assert.equal(fishingReservationsRef("https://redondo.fishingreservations.com/sales/")?.landing, "redondo");
  assert.equal(fishingReservationsRef("https://www.fishingreservations.net/"), null);
  assert.equal(fishingReservationsRef("https://example.com/book"), null);
});

test("every trip on the page is read with its seats decoded and its sold-out rows named", () => {
  const trips = parseTrips(FIXTURE);
  assert.equal(trips.length, 5);
  const [catalina, victory, ahra, charter, victory2] = trips;
  assert.equal(catalina.boat, "El Patron");
  assert.equal(catalina.type, "Full Day Catalina Island Freelance");
  assert.equal(catalina.date, TOMORROW);
  assert.equal(catalina.time, "05:00");
  assert.equal(catalina.price, 150.08);
  // `&#52;` is a four, and `&#49;&#55;` is seventeen.
  assert.equal(catalina.spots, 4);
  assert.equal(victory.spots, 17);
  assert.equal(victory.price, 82.8);
  assert.equal(ahra.soldOut, true);
  assert.equal(ahra.price, null);
  assert.equal(charter.charter, true);
  assert.equal(charter.price, 895);
  assert.equal(victory2.date, AFTER);
  assert.equal(victory2.spots, 48);
});

test("a sold-out trip is not offered, a seat's price heads the card, and a charter's does not", async () => {
  stubPage(FIXTURE);
  const live = await fishingReservationsLive("https://longbeach.fishingreservations.net/sales/", { from: new Date(), days: 7 });
  assert.equal(live?.vendor, "fishingreservations");
  assert.equal(live?.business, "longbeach");
  const items = live!.departures.map((d) => `${d.date} ${d.time} ${d.item} ${d.fromPrice} seats=${d.seatsLeft}`);
  assert.deepEqual(items, [
    `${TOMORROW} 05:00 Full Day Catalina Island Freelance (El Patron) 150.08 seats=4`,
    `${TOMORROW} 06:00 3/4 Day (Victory) 82.8 seats=17`,
    `${AFTER} 06:00 3/4 Day (Victory) 82.8 seats=48`,
    `${AFTER} 06:30 Boat Charter-Chagolla (Eldorado) null seats=1`,
  ]);
  const charter = live!.departures[3];
  // The whole boat stays on the rate where a guest can read it, marked as a group price.
  assert.deepEqual(charter.rates, [{ label: "Ticket", price: 895, minParty: null, maxParty: null, group: true }]);
  // Nothing on the page says the figure is what the checkout charges, so it is said to be pre-tax.
  assert.equal(live!.departures[0].taxIncluded, false);
  assert.equal(live!.departures[0].priceLabel, null);
  assert.equal(live!.departures[0].bookUrl, "https://longbeach.fishingreservations.net/sales/user.php?trip_id=1084458");
});

test("a one-day window is answered with that one day, not with the day after as well", async () => {
  stubPage(FIXTURE);
  const tomorrowNoon = new Date(TOMORROW + "T12:00:00");
  const live = await fishingReservationsLive("https://longbeach.fishingreservations.net/sales/", { from: tomorrowNoon, days: 1 });
  assert.deepEqual([...new Set(live!.departures.map((d) => d.date))], [TOMORROW]);
});

test("a landing that answers a parked page or an error is 'did not answer', never an empty calendar", async () => {
  stubPage("<html><body>This domain is parked</body></html>");
  const parked = await fishingReservationsLive("https://gone.fishingreservations.net/sales/");
  assert.deepEqual(parked?.departures, []);
  assert.match(parked?.note ?? "", /did not answer/);
  stubPage("", 503);
  const down = await fishingReservationsLive("https://down.fishingreservations.net/sales/");
  assert.match(down?.note ?? "", /did not answer/);
});

/**
 * The real landing, one request. Off unless `RUN_LIVE=1`, because a unit run must not fetch anything, and
 * what it checks is only that the page still has the shape the fixture froze: if this fails and the fixture
 * tests pass, the vendor changed their template.
 */
test("live: Long Beach Sportfishing's schedule still parses", { skip: !process.env.RUN_LIVE }, async () => {
  globalThis.fetch = realFetch;
  const live = await fishingReservationsLive("https://longbeach.fishingreservations.net/sales/", { from: new Date(), days: 14, tz: "America/Los_Angeles" });
  assert.equal(live?.vendor, "fishingreservations");
  assert.ok(live!.departures.length > 0, "the landing publishes trips a fortnight out: " + live?.note);
  for (const d of live!.departures) {
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(d.time, /^\d{2}:\d{2}$/);
    assert.match(d.bookUrl, /user\.php\?trip_id=\d+$/);
  }
  console.log(JSON.stringify(live, null, 1).slice(0, 1200));
});
