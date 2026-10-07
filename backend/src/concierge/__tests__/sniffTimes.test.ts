import test from "node:test";
import assert from "node:assert/strict";
import { findTimes } from "../sniff.ts";

/**
 * The clock values the endpoint sniffer finds in a payload.
 *
 * This is the module's strongest single signal and the thing everything downstream rests on: it sets the
 * score that decides whether an endpoint is written down at all, it is what `varsByDate` compares two days
 * by before admitting one, and the times it finds are stored beside the endpoint as the evidence for it and
 * reported as times a person could see on the page.
 *
 * `agent.ts` reads a clock out of rendered text with the same two patterns and one more character: a
 * negative lookahead stopping the 24-hour pattern from reading "7:00" out of "7:00 PM". This had none.
 */

/** The filter `scoreOf` applies: inside trading hours and on a neat five minutes. */
const slotish = (times: string[]) =>
  times.filter((t) => {
    const [h, m] = t.split(":").map(Number);
    return h >= 7 && h <= 23 && m % 5 === 0;
  });

test("an afternoon slot is one time, not that time and a morning one", () => {
  assert.deepEqual(findTimes("7:00 PM"), ["19:00"]);
  assert.deepEqual(findTimes("6:00 PM - 7:45 PM"), ["18:00", "19:45"]);
  assert.deepEqual(findTimes("Book 1:30 p.m."), ["13:30"]);
});

test("two slots on a page do not score like four", () => {
  /**
   * `scoreOf` gives +4 for three or more slot-shaped times and +1 for fewer, so counting each afternoon
   * twice crossed that threshold on two real slots: a page with two times scored like a calendar. Every
   * phantom was a morning hour, which is squarely inside trading hours and lands on the same neat minute as
   * the slot it was invented from, so the cheap filter could not catch any of them.
   */
  assert.deepEqual(slotish(findTimes("Available: 7:00 PM, 9:00 PM")), ["19:00", "21:00"]);
  assert.ok(slotish(findTimes("Available: 7:00 PM, 9:00 PM")).length < 3);
});

test("the hours a shop writes on a 24-hour clock are read as themselves", () => {
  assert.deepEqual(findTimes("09:00 and 17:30"), ["09:00", "17:30"]);
  assert.deepEqual(findTimes('"start":"14:05:00"'), ["14:05"]);
  assert.deepEqual(findTimes("Open 9:00 - 17:00"), ["09:00", "17:00"]);
});

test("midnight and noon either side of twelve", () => {
  assert.deepEqual(findTimes("12:30am"), ["00:30"]);
  assert.deepEqual(findTimes("12:30 am"), ["00:30"]);
  assert.deepEqual(findTimes("12:30 pm"), ["12:30"]);
});

test("a time nobody wrote is not found", () => {
  assert.deepEqual(findTimes("created_at 2026-10-07T04:08:11Z"), []);
  assert.deepEqual(findTimes("call 555-0199"), []);
  assert.deepEqual(findTimes("25:00 and 9:75"), []);
});
