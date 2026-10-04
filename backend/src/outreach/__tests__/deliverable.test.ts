import { strict as assert } from "node:assert";
import test from "node:test";
import { decide, readDnsError, siteAlive, siteHosts } from "../deliverable.ts";
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

test("only the two codes that answer for the domain are read as an answer", () => {
  // NXDOMAIN, and the name existing with no record of that type: both are the domain's own answer.
  assert.equal(readDnsError("ENOTFOUND"), false);
  assert.equal(readDnsError("ENODATA"), false);
});

test("a resolver that gave up is not read as a domain that does not exist", () => {
  // SERVFAIL is the resolver saying it could not complete the question, not an answer about the name. It was
  // read as "no such domain" until 30 September 2026, and the cloud sender writes a 'failed' touch for every
  // address this refuses, which takes it out of the pool for good: one resolver hiccup retired the batch.
  assert.equal(readDnsError("ESERVFAIL"), null);
  assert.equal(readDnsError("EAI_AGAIN"), null);
  assert.equal(readDnsError("ETIMEOUT"), null);
  assert.equal(readDnsError("ECONNREFUSED"), null);
  assert.equal(readDnsError(undefined), null);
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

test("a business whose website's name no longer exists is passed over, and nothing less counts", () => {
  assert.equal(siteAlive([{ a: false, aaaa: false }, { a: false, aaaa: false }]), false, "both names answered that nothing is there");
  assert.equal(siteAlive([{ a: false, aaaa: false }, { a: true, aaaa: false }]), true, "the site answers without www");
  assert.equal(siteAlive([{ a: null, aaaa: false }, { a: false, aaaa: false }]), true, "a resolver that could not answer is not evidence");
  assert.equal(siteAlive([]), true, "no website at all is not evidence either");
  assert.deepEqual(siteHosts("http://www.escapetheknight.com/"), ["www.escapetheknight.com", "escapetheknight.com"]);
  assert.deepEqual(siteHosts("timeheistescapes.com"), ["timeheistescapes.com", "www.timeheistescapes.com"]);
  assert.deepEqual(siteHosts("https://countdownthunderba.wixsite.com/mysite"), ["countdownthunderba.wixsite.com", "www.countdownthunderba.wixsite.com"]);
  for (const w of [null, "", "not a site", "http://10.0.0.1/"]) assert.deepEqual(siteHosts(w), [], String(w));
});
