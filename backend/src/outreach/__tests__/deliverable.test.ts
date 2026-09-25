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
