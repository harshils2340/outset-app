import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The phone-agent data endpoints read the site's published o/<id>.json (the same record a listing page reads),
 * not SQLite, because the API host has no operators table. So the test serves a listing over a stubbed fetch and
 * checks the agent gets only published facts, real prices and an honest gap where the calendar is not connected.
 */

process.env.SITE_URL = "https://onoutset.com/";
const { voice, speakableDays, speakableRead, windowNote, applyEdits, PAUSED_NOTE } = await import("../voice.ts");
import type { Availability } from "../../enrich/availability.ts";
import type { StoredProfile } from "../profiles.ts";

const reel = {
  id: "o-reeltime-com",
  title: "Reel Time Charters",
  area: "Clearwater, FL",
  blurb: "Family-run inshore fishing out of Clearwater.",
  from: 600,
  dur: "4 hours",
  options: [{ name: "Half day inshore", detail: "up to 4 guests", price: 600 }],
  includes: ["Rods, reels and bait", "Fishing license"],
  requirements: ["Bring a hat and sunscreen."],
  policies: ["50% deposit."],
  cancellation: "Refundable up to 48 hours before.",
  hoursText: ["Mon-Sat 6am-6pm"],
  contact: { phone: "+17275551212", website: "https://reeltime.com" },
};

/** A shipped operator record's real shape: a priced menu and no `from` of its own. */
const menuOnly = {
  id: "o-menu-only-com",
  title: "Gulf Coast Parasail",
  area: "Clearwater Beach, FL",
  options: [{ name: "Ride along", price: 0 }, { name: "Single flight", price: 400 }, { name: "Tandem flight", price: 250 }],
};

/** A partner's product: shown under licence, booked on the partner's site, with no operator of ours behind it. */
const partner = {
  id: "a-viator-100118p1",
  title: "Unforgettable Whistler Full-Day Private Tour",
  area: "Vancouver, BC",
  options: [{ name: "Private tour", price: 799 }],
  affiliate: { source: "viator", label: "Viator", url: "https://www.viator.com/tours/x?pid=P00321495" },
};

/** A shop whose published `includes` carries its own exclusions, which 5,263 shipped listings do. */
const mixedShop = {
  id: "o-mixed-com",
  title: "Harbour Sunset Cruises",
  area: "Tampa, FL",
  options: [{ name: "Sunset sail", price: 85 }],
  includes: ["Bottled water", "Gratuities (not included)", "Lunch (not included)", "Snacks and drinks available for purchase"],
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === "https://onoutset.com/o/o-reeltime-com.json") return new Response(JSON.stringify(reel), { status: 200, headers: { "content-type": "application/json" } });
  if (url === "https://onoutset.com/o/a-viator-100118p1.json") return new Response(JSON.stringify(partner), { status: 200, headers: { "content-type": "application/json" } });
  if (url === "https://onoutset.com/o/o-menu-only-com.json") return new Response(JSON.stringify(menuOnly), { status: 200, headers: { "content-type": "application/json" } });
  if (url === "https://onoutset.com/o/o-mixed-com.json") return new Response(JSON.stringify(mixedShop), { status: 200, headers: { "content-type": "application/json" } });
  // Everything else (the live-index availability reads for a non-vendor operator) is a miss, so availability is not live.
  return new Response("not found", { status: 404 });
}) as typeof fetch;

test("GET /voice/:id returns the listing's own facts, prices and rules, and nothing invented", async () => {
  const res = await voice.request("http://localhost/voice/o-reeltime-com");
  assert.equal(res.status, 200);
  const { business, speak } = (await res.json()) as { business: Record<string, unknown>; speak: Record<string, unknown> };
  assert.equal(business.name, "Reel Time Charters");
  assert.equal(business.where, "Clearwater, FL");
  assert.deepEqual(business.hours, ["Mon-Sat 6am-6pm"]);
  assert.deepEqual(business.offers, [{ name: "Half day inshore", detail: "up to 4 guests", price: "$600" }]);
  assert.equal(business.fromPrice, "$600");
  assert.deepEqual(business.policies, ["50% deposit."]);
  assert.deepEqual(business.requirements, ["Bring a hat and sunscreen."]);
  assert.equal(business.cancellation, "Refundable up to 48 hours before.");
  assert.equal(business.phone, "+17275551212");
  assert.equal(business.bookingUrl, "https://onoutset.com/activities#o=o-reeltime-com");
  assert.equal(speak.onlyPublishedFacts, true);
});

test("GET /voice/:id/availability answers a plain not-connected gap, never a guessed time", async () => {
  const res = await voice.request("http://localhost/voice/o-reeltime-com/availability?from=2026-10-01&days=7");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { live: boolean; days: unknown[]; note?: string };
  assert.equal(body.live, false, "no readable booking vendor, so no live calendar");
  assert.deepEqual(body.days, []);
  assert.match(body.note || "", /person confirms/i);
});

test("an unknown operator is a 404, and a bad id a 400", async () => {
  assert.equal((await voice.request("http://localhost/voice/o-does-not-exist")).status, 404);
  assert.equal((await voice.request("http://localhost/voice/BAD ID")).status, 400);
  assert.equal((await voice.request("http://localhost/voice/o-reeltime-com/availability?from=nope")).status, 400);
});

test("the from price is the cheapest line on the menu, and a zero is no price rather than free", async () => {
  // No operator listing in the shipped catalog carries a crawled `from`: that field is written on partner rows
  // only. So the price a caller asks for first has to come off the menu, exactly as a card works it out.
  const res = await voice.request("http://localhost/voice/o-menu-only-com");
  const { business } = (await res.json()) as { business: { fromPrice: string | null; offers: { name: string; price: string | null }[] } };
  assert.equal(business.fromPrice, "$250", "the cheapest priced line, not the first one and not nothing");
  assert.deepEqual(business.offers.map((o) => o.price), [null, "$400", "$250"], "a zero is a price we could not read");
});

/**
 * o/<id>.json is written by the nightly sync, and the shops Otto is sold to are the claimed ones, whose live
 * facts are their dashboard patch. An operator who put prices up in the morning had their own phone agent
 * quoting yesterday's all day.
 */
const profile = (patch: Record<string, unknown>, extra: Partial<StoredProfile> = {}): StoredProfile =>
  ({ id: "o-reeltime-com", claimedAt: "", updatedAt: "", owner: { name: "", email: "", phone: "" }, published: true, profile: null, patch, ...extra }) as StoredProfile;

test("the operator's own edits win over the nightly file", () => {
  const { listing: shop, takingBookings } = applyEdits(reel, profile({ title: "Reel Time Fishing Co", options: [{ name: "Half day inshore", price: 700 }], cancellation: "" }));
  assert.equal(shop.title, "Reel Time Fishing Co");
  assert.equal(shop.options?.[0].price, 700, "the price the operator typed this morning, not last night's");
  assert.equal(shop.cancellation, "", "a cleared field is published as empty, and reads as no line rather than the old one");
  assert.equal(shop.hoursText?.[0], "Mon-Sat 6am-6pm", "a field the operator never touched keeps the published one");
  assert.equal(takingBookings, true);
  // No row at all is an unclaimed shop, which is the nightly file and nothing else.
  assert.deepEqual(applyEdits(reel, null), { listing: reel, takingBookings: true });
});

test("a hidden or paused listing is not a booking link", async () => {
  assert.equal(applyEdits(reel, profile({}, { published: false })).takingBookings, false, "the Published switch off");
  assert.equal(applyEdits(reel, profile({ accepting: false })).takingBookings, false, "the Accepting switch off");
  const res = await voice.request("http://localhost/voice/o-reeltime-com");
  const { business } = (await res.json()) as { business: { takingBookings: boolean; bookingUrl: string | null; bookingNote: string | null } };
  assert.equal(business.takingBookings, true, "an unclaimed shop with no row is unchanged");
  assert.equal(business.bookingUrl, "https://onoutset.com/activities#o=o-reeltime-com");
  assert.equal(business.bookingNote, null);
});

test("a partner's product has no phone agent, on either route", async () => {
  // backend/AGENTS.md: an affiliate row is never an operator, and gets no Otto. Its facts and calendar are the
  // partner's, licensed for the page that says so, and there is no operator behind it to answer a call.
  const facts = await voice.request("http://localhost/voice/a-viator-100118p1");
  assert.equal(facts.status, 409);
  assert.match(((await facts.json()) as { error: string }).error, /booked on Viator/);
  const av = await voice.request("http://localhost/voice/a-viator-100118p1/availability");
  assert.equal(av.status, 409);
});

/**
 * What the agent may say out loud. The page drops four kinds of row before a guest sees a chip, and the phone
 * has to drop the same four: a marker row that only says the date is open, a sold-out departure, a price of
 * nothing, and a departure that has already left where the shop is.
 */
const avail = (days: Availability["days"]): Availability => ({ vendor: "fareharbor", live: true, updatedAt: "", days });

test("a timeUnknown marker row is never offered as a start time", () => {
  const av = avail([
    { date: "2026-10-02", slots: [{ startsAt: "2026-10-02T00:00", label: "Available", bookUrl: "x", timeUnknown: true }] },
    { date: "2026-10-03", slots: [{ startsAt: "2026-10-03T09:30", label: "Morning reef trip", bookUrl: "y" }] },
  ]);
  const days = speakableDays(av, "America/New_York", new Date("2026-10-01T15:00:00Z"));
  assert.deepEqual(days.map((d) => d.date), ["2026-10-03"], "the date we could not time states no time, so it is not a date the agent offers");
  assert.equal(days[0].times[0].at, "09:30");
});

test("a departure that has already left is dropped, on the shop's clock and not the host's", () => {
  const av = avail([{ date: "2026-10-01", slots: [
    { startsAt: "2026-10-01T09:00", label: "Morning", bookUrl: "a" },
    { startsAt: "2026-10-01T20:00", label: "Sunset", bookUrl: "b" },
  ] }]);
  // 01:00 UTC on the 2nd is still six in the evening on the 1st in Los Angeles, so tonight's eight o'clock
  // is still for sale and this morning's nine is not.
  const days = speakableDays(av, "America/Los_Angeles", new Date("2026-10-02T01:00:00Z"));
  assert.deepEqual(days, [{ date: "2026-10-01", times: [{ at: "20:00", label: "Sunset", price: null, seatsLeft: null, bookUrl: "b" }] }]);
  // The same answer read on the host's UTC clock: the day is over, so nothing is offered.
  assert.deepEqual(speakableDays(av, null, new Date("2026-10-02T01:00:00Z")), []);
});

test("a sold-out departure is not offered, and a price of nothing is no price rather than free", () => {
  const av = avail([{ date: "2026-10-03", slots: [
    { startsAt: "2026-10-03T10:00", label: "Full", bookUrl: "a", seatsLeft: 0 },
    { startsAt: "2026-10-03T14:00", label: "Two left", bookUrl: "b", seatsLeft: 2, priceCents: 0 },
  ] }]);
  const days = speakableDays(av, "America/New_York", new Date("2026-10-01T15:00:00Z"));
  assert.deepEqual(days[0].times, [{ at: "14:00", label: "Two left", price: null, seatsLeft: 2, bookUrl: "b" }]);
});

/**
 * What the agent may say about the window as a whole.
 *
 * The page keeps an open date whose clock times a vendor never listed apart from a date the shop is shut
 * (`liveTimes.ts`: `unread` against `closed`), and refuses to say "nothing open" on a read that only covered
 * part of the window. This route dropped the first kind of date silently and said those words anyway, which is
 * a phone agent telling a caller the business is shut for a fortnight while its own booking system says the
 * opposite. 250 of the 1,911 shipped booking links come back `partial` every time by construction, and 239
 * more are Peek, whose call budget times the first two or three open dates and marks the rest.
 */
test("an open date whose times were never listed is unread, not shut", () => {
  const av = avail([
    { date: "2026-10-02", slots: [{ startsAt: "2026-10-02T00:00", label: "Kayak tour", bookUrl: "x", timeUnknown: true }] },
    { date: "2026-10-03", slots: [] },
    { date: "2026-10-04", slots: [{ startsAt: "2026-10-04T09:30", label: "Morning reef trip", bookUrl: "y" }] },
  ]);
  const read = speakableRead(av, "America/New_York", new Date("2026-10-01T15:00:00Z"));
  assert.deepEqual(read.days.map((d) => d.date), ["2026-10-04"], "only the date we could time is a date the agent offers");
  assert.deepEqual(read.unread, ["2026-10-02"], "the marker date is open and untimed, and the empty one is shut");
  // The old shape, unchanged for every caller that only wants departures.
  assert.deepEqual(speakableDays(av, "America/New_York", new Date("2026-10-01T15:00:00Z")), read.days);
});

test("a departure whose clock is out of range is dropped, and leaves the date unread", () => {
  // `clockOf` in src/lib/liveTimes.ts refuses an hour past 23 and a minute past 59; this was the one reader
  // that would have read "T25:00" out to a caller as "25:00".
  const av = avail([{ date: "2026-10-03", slots: [
    { startsAt: "2026-10-03T25:00", label: "Late", bookUrl: "a" },
    { startsAt: "2026-10-03T09:75", label: "Odd", bookUrl: "b" },
  ] }]);
  const read = speakableRead(av, "America/New_York", new Date("2026-10-01T15:00:00Z"));
  assert.deepEqual(read.days, []);
  assert.deepEqual(read.unread, ["2026-10-03"], "a shape we do not understand is not a closed shop");
});

test("the agent is never told nothing is open on a read that did not cover the window", () => {
  assert.match(windowNote([], [], false) || "", /Nothing is open in this window/);
  // Partial: the vendor answered part of what we asked.
  const onPartial = windowNote([], [], true) || "";
  assert.doesNotMatch(onPartial, /Nothing is open/);
  assert.match(onPartial, /not the whole picture/);
  assert.match(onPartial, /do not say the business is closed/);
  // Every open date arrived as a marker row, which is Peek's ordinary answer past the call budget.
  const onUnread = windowNote([], ["2026-10-02", "2026-10-03"], false) || "";
  assert.doesNotMatch(onUnread, /Nothing is open/);
  assert.match(onUnread, /do not say the business is closed/);
  // Some dates timed and some not: the departures stand, and the untimed dates are still not shut days.
  const day = { date: "2026-10-04", times: [{ at: "09:30", label: "Morning", price: null, seatsLeft: null, bookUrl: "y" }] };
  assert.match(windowNote([day], ["2026-10-05"], true) || "", /not listed/);
  assert.equal(windowNote([day], [], false), null, "a read that covered the window and found times needs no caveat");
});

/**
 * The two routes here against the operator's own two switches. The facts route has always read them; the
 * availability route read no profile at all, so a shop that had hidden its listing or paused bookings had its
 * vendor calendar read out departure by departure, each carrying its own booking link, by the same agent the
 * facts route had just told to take a name and number instead.
 */
test("the availability route reads the Published and Accepting switches the facts route reads", () => {
  const src = readFileSync(new URL("../voice.ts", import.meta.url), "utf8");
  const at = src.indexOf('voice.get("/voice/:operatorId/availability"');
  assert.ok(at > 0, "the availability route moved");
  const handler = src.slice(at);
  assert.ok(/withOperatorEdits\(/.test(handler), "the availability handler never reads the operator's record");
  assert.ok(/takingBookings/.test(handler), "the availability handler never reads the switches");
  assert.ok(/PAUSED_NOTE/.test(handler), "the availability handler has its own words for a paused shop");
  // One sentence, both routes, so they cannot drift apart again.
  assert.equal(src.split("PAUSED_NOTE").length - 1, 3, "PAUSED_NOTE is one declaration read by both routes, not a sentence spelled twice");
  assert.match(PAUSED_NOTE, /not taking bookings through Outset right now/);
  assert.ok(!PAUSED_NOTE.includes("\u2014"), "no em dash");
  // The decision itself is `applyEdits`, which is what the facts route already turns into `takingBookings`.
  assert.equal(applyEdits(reel, profile({}, { published: false })).takingBookings, false);
  assert.equal(applyEdits(reel, profile({ accepting: false })).takingBookings, false);
});

test.after(() => {
  globalThis.fetch = realFetch;
});

/**
 * The last field on this route still handed over raw. A shop publishes its exclusions in the same `includes`
 * array as its inclusions, so a voice agent read "Gratuities (not included)" and "Lunch (not included)" out as
 * things the price covers, and on a call there is no second column for a caller to read instead.
 */
test("a shop's own exclusions are not read out as things the price covers", async () => {
  const res = await voice.request("http://localhost/voice/o-mixed-com");
  assert.equal(res.status, 200);
  const b = (await res.json()).business as { includes: string[]; notIncluded: string[] | null };
  assert.deepEqual(b.includes, ["Bottled water"]);
  assert.deepEqual(b.notIncluded, ["Gratuities", "Lunch", "Snacks and drinks available for purchase"]);
  // A shop that publishes no exclusion says nothing rather than an empty list.
  const clean = (await (await voice.request("http://localhost/voice/o-reeltime-com")).json()).business as { includes: string[]; notIncluded: string[] | null };
  assert.deepEqual(clean.includes, ["Rods, reels and bait", "Fishing license"]);
  assert.equal(clean.notIncluded, null);
});
