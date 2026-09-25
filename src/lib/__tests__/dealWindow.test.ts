import { strict as assert } from "node:assert";
import { test } from "node:test";
import { promoOn } from "../companyAgent.ts";

/**
 * A deal's own clock window, the half that ends before it starts. Nothing in the shipped catalog runs
 * one today, but the crawl reads "happy hour" and a time range, so the first bar or late-night lane that
 * publishes one would have had a deal that could never be on.
 */
test("a deal window that runs past midnight is on in the small hours, on the day it started", () => {
  const happyHour = { text: "Happy hour every Friday 9pm to 1am, half price lanes.", days: [5], start: "21:00", end: "01:00" };
  assert.equal(promoOn(happyHour, { day: 5, minutes: 22 * 60 }), true);
  assert.equal(promoOn(happyHour, { day: 6, minutes: 30 }), true);
  assert.equal(promoOn(happyHour, { day: 5, minutes: 30 }), false);
  assert.equal(promoOn(happyHour, { day: 5, minutes: 20 * 60 }), false);
  assert.equal(promoOn(happyHour, { day: 6, minutes: 22 * 60 }), false);
});

test("an ordinary window is unchanged", () => {
  const p = { text: "Free setup and pickup, 9am to 5pm.", days: [], start: "09:00", end: "17:00" };
  assert.equal(promoOn(p, { day: 3, minutes: 10 * 60 }), true);
  assert.equal(promoOn(p, { day: 3, minutes: 8 * 60 }), false);
  assert.equal(promoOn(p, { day: 3, minutes: 17 * 60 }), false);
});
