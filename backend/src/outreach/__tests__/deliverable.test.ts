import { strict as assert } from "node:assert";
import test from "node:test";
import { decide } from "../deliverable.ts";
import { dayStartIso } from "../sendOtto.ts";

test("a domain with a mail exchanger, or at least an address, can be sent to", () => {
  assert.equal(decide({ mx: true, a: false }), true);
  assert.equal(decide({ mx: false, a: true }), true);
  assert.equal(decide({ mx: true, a: null }), true);
});

test("a domain that DNS says does not exist at all is left out of the batch", () => {
  assert.equal(decide({ mx: false, a: false }), false);
});

test("a resolver that could not answer is not evidence against the address", () => {
  // No network, a timeout, a sandbox with DNS blocked: the batch goes out as it would have without the check.
  assert.equal(decide({ mx: null, a: null }), true);
  assert.equal(decide({ mx: false, a: null }), true);
  assert.equal(decide({ mx: null, a: false }), true);
});


test("the campaign's day starts at local midnight, not UTC midnight", () => {
  // 11 PM in Toronto on 24 September is 03:00 UTC on the 25th; the day still began at 04:00 UTC on the 24th.
  const late = new Date("2026-09-25T03:00:00Z");
  assert.equal(dayStartIso("America/Toronto", late), "2026-09-24T04:00:00.000Z");
  // 9:30 the next morning in Toronto is 13:30 UTC; that day began at 04:00 UTC on the 25th.
  const morning = new Date("2026-09-25T13:30:00Z");
  assert.equal(dayStartIso("America/Toronto", morning), "2026-09-25T04:00:00.000Z");
});

test("the day boundary is right on the two days a year the clocks move", () => {
  // Spring forward: 8 March 2026 begins at 05:00 UTC, because Toronto was still on EST at midnight.
  assert.equal(dayStartIso("America/Toronto", new Date("2026-03-08T12:17:00Z")), "2026-03-08T05:00:00.000Z");
  assert.equal(dayStartIso("America/Toronto", new Date("2026-03-09T03:17:00Z")), "2026-03-08T05:00:00.000Z");
  // Fall back: 1 November 2026 begins at 04:00 UTC, still on EDT. Taking the offset as it reads at midday
  // put this at 05:00, so the mails sent in Toronto's first hour were not counted against the day's ceiling.
  assert.equal(dayStartIso("America/Toronto", new Date("2026-11-01T12:17:00Z")), "2026-11-01T04:00:00.000Z");
  assert.equal(dayStartIso("America/Toronto", new Date("2026-11-01T23:17:00Z")), "2026-11-01T04:00:00.000Z");
  // And a zone on a half hour offset, which the same arithmetic also has to survive.
  assert.equal(dayStartIso("America/St_Johns", new Date("2026-06-15T15:00:00Z")), "2026-06-15T02:30:00.000Z");
});
