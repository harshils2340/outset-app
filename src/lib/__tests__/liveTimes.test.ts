import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { LiveAvailability } from "../api";
import { clockOf, fewSeats, liveChipsByDate } from "../liveTimes";

/**
 * The start times a guest picks from when the shop runs FareHarbor, Peek or Xola.
 *
 * Both pickers built these themselves, from their own copy of the same lines, and both got two things wrong.
 * A company calendar carries every trip that company sells, so two boats leaving at nine are two departures
 * on one start time; they were drawn as two chips keyed on the time they share, which React sees as one key
 * twice, the phone drew as "9:00 AM" twice, and a pick lit both of. And Peek marks an open date it could not
 * time with a row at midnight; both pickers offered it as a departure a guest could book.
 */

const day = (date: string, slots: LiveAvailability["days"][number]["slots"]): LiveAvailability["days"][number] => ({ date, slots });
const live = (days: LiveAvailability["days"]): LiveAvailability => ({ vendor: "fareharbor", live: true, days });

test("two boats leaving at nine are one start time, not two chips with one key", () => {
  const chips = liveChipsByDate(
    live([
      day("2026-09-20", [
        { startsAt: "2026-09-20T09:00", label: "9:00 AM · Dolphin Watch", seatsLeft: 2, bookUrl: "x" },
        { startsAt: "2026-09-20T09:00", label: "9:00 AM · Sunset Cruise", seatsLeft: 40, bookUrl: "y" },
        { startsAt: "2026-09-20T13:00", label: "1:00 PM · Dolphin Watch", bookUrl: "z" },
      ]),
    ]),
  ).get("2026-09-20")!;

  assert.deepEqual(chips.map((c) => c.time), ["09:00", "13:00"]);
  assert.equal(new Set(chips.map((c) => c.key)).size, chips.length, "a key is drawn once");
  // Neither trip may be named by a chip that stands for both of them.
  assert.equal(chips[0].label, "9:00 AM");
  assert.equal(chips[1].label, "1:00 PM · Dolphin Watch");
  // The roomiest boat at nine is what a party can still get into: "2 left" was the other boat's number.
  assert.equal(chips[0].seatsLeft, 40);
});

test("a time is left without a seat count when one of its departures never stated one", () => {
  const chips = liveChipsByDate(
    live([
      day("2026-09-20", [
        { startsAt: "2026-09-20T09:00", label: "9:00 AM · Dolphin Watch", seatsLeft: 2, bookUrl: "x" },
        { startsAt: "2026-09-20T09:00", label: "9:00 AM · Sunset Cruise", bookUrl: "y" },
      ]),
    ]),
  ).get("2026-09-20")!;
  assert.equal(chips.length, 1);
  assert.equal(chips[0].seatsLeft, undefined, "a count that covers one of two departures is not the truth");
});

test("a shared time quotes the lowest price of the trips leaving then", () => {
  const chips = liveChipsByDate(
    live([
      day("2026-09-20", [
        { startsAt: "2026-09-20T09:00", label: "9:00 AM · Deluxe", priceCents: 24900, bookUrl: "x" },
        { startsAt: "2026-09-20T09:00", label: "9:00 AM · Standard", priceCents: 8900, bookUrl: "y" },
      ]),
    ]),
  ).get("2026-09-20")!;
  assert.equal(chips[0].price, 89);
});

test("an open date whose times were never read is not offered as a midnight departure", () => {
  const map = liveChipsByDate(
    live([
      day("2026-09-20", [{ startsAt: "2026-09-20T17:30", label: "5:30 PM · Sunset Cruise", seatsLeft: 6, bookUrl: "x" }]),
      day("2026-09-21", [{ startsAt: "2026-09-21T00:00", label: "Sunset Cruise", bookUrl: "x", timeUnknown: true }]),
    ]),
  );
  assert.deepEqual([...map.keys()], ["2026-09-20"]);
  assert.deepEqual(map.get("2026-09-20")!.map((c) => c.time), ["17:30"]);
});

test("a shop that really does leave at midnight keeps its midnight", () => {
  const chips = liveChipsByDate(live([day("2026-09-20", [{ startsAt: "2026-09-20T00:00", label: "12:00 AM · Night Dive", bookUrl: "x" }])])).get("2026-09-20")!;
  assert.deepEqual(chips.map((c) => c.time), ["00:00"]);
});

test("the wall clock is read out of the string, never through the browser's zone", () => {
  assert.equal(clockOf("2026-09-20T09:00"), "09:00");
  // FareHarbor sends an offset; the reader cuts it off before this, and a stray one must not move the time.
  assert.equal(clockOf("2026-09-20T09:00:00-04:00"), "09:00");
  assert.equal(clockOf("2026-09-20"), null);
  assert.equal(clockOf("2026-09-20T99:99"), null);
  assert.equal(clockOf(""), null);
});

test("a departure the vendor says is full is not offered, and a dead answer shows nothing", () => {
  const chips = liveChipsByDate(
    live([day("2026-09-20", [
      { startsAt: "2026-09-20T09:00", label: "9:00 AM", seatsLeft: 0, bookUrl: "x" },
      { startsAt: "2026-09-20T11:00", label: "11:00 AM", seatsLeft: 3, bookUrl: "x" },
    ])]),
  );
  assert.deepEqual(chips.get("2026-09-20")!.map((c) => c.time), ["11:00"]);
  assert.equal(liveChipsByDate({ vendor: null, live: false, days: [] }).size, 0);
  assert.equal(liveChipsByDate(null).size, 0);
});

test("chips come back in clock order however the vendor listed them", () => {
  const chips = liveChipsByDate(
    live([day("2026-09-20", [
      { startsAt: "2026-09-20T17:30", label: "5:30 PM", bookUrl: "x" },
      { startsAt: "2026-09-20T07:05", label: "7:05 AM", bookUrl: "x" },
      { startsAt: "2026-09-20T12:00", label: "12:00 PM", bookUrl: "x" },
    ])]),
  ).get("2026-09-20")!;
  assert.deepEqual(chips.map((c) => c.time), ["07:05", "12:00", "17:30"]);
});

test("both pickers call a time short of seats by the same number", () => {
  assert.equal(fewSeats(4), true);
  assert.equal(fewSeats(5), false);
  assert.equal(fewSeats(undefined), false);
  assert.equal(fewSeats(0), false);
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../../components/web/WebListing.tsx", "../../components/booking/Sheets.tsx"]) {
    const src = readFileSync(join(here, rel), "utf8");
    assert.ok(src.includes("fewSeats("), rel + " reads the shared rule");
    assert.ok(src.includes("liveChipsByDate("), rel + " builds its live chips from the shared reader");
    assert.ok(!/seatsLeft\s*<=\s*\d/.test(src), rel + " must not carry a threshold of its own");
  }
});
