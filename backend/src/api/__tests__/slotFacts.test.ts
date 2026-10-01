import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The listing's own time zone and published week, which the slot picker runs on, and which are remembered for
 * an hour so every slot request does not re-read the file.
 *
 * The read was `readJson(...).catch(() => null)`, which collapsed "there is no such file" into "the read
 * failed". `readJson` tells them apart: null for a file that is not there, a throw for a read it could not
 * make (a malformed file, GitHub answering 403 or 500, no answer at all). So one bad moment pinned "no zone,
 * no published week" on a real shop for a full hour, and both halves are read by the engine that offers a
 * guest start times: with no zone it runs on the server's clock, offering a 1 PM Pacific departure at 1 PM UTC
 * and refusing the shop's real afternoon as past; with no week an unclaimed listing stops offering only the
 * times its own site is open for, so a guest takes a 7 AM at a brewery that opens at four and the operator is
 * emailed a booking for an hour they are shut.
 *
 * STORE_DIR points the catalog reader at a throwaway folder, so this runs with no database. GITHUB_TOKEN goes
 * with it: with a token set, a listing with no local file is a GitHub API read, and whether that answers 404
 * or 403 is not this test's business. It is the production shape of the bug, though, because a 403 from the
 * rate limiter is a read that failed and used to be kept for the hour as a shop with no zone.
 */

const dir = mkdtempSync(join(tmpdir(), "outset-slotfacts-"));
mkdirSync(join(dir, "o"), { recursive: true });
process.env.STORE_DIR = dir;
delete process.env.GITHUB_TOKEN;

const { factsAfterRead, weekIn, zoneOf } = await import("../openSlots.ts");

const write = (id: string, body: string) => writeFileSync(join(dir, "o", id + ".json"), body);

test("a listing file that could not be read is not remembered as a listing with no zone", async () => {
  const id = "o-slotfacts-broken-com";
  // A truncated file: `existsSync` passes and `JSON.parse` throws, which is what a half-written sync, or
  // GitHub answering 403 on a host reading over the API, looks like from here.
  write(id, '{"area":"Seattle, WA"');
  assert.equal(await zoneOf(id), null, "nothing is known about it on a read that failed");
  write(id, '{"area":"Seattle, WA"}');
  assert.equal(await zoneOf(id), "America/Los_Angeles", "and the next request reads it again rather than holding the fault for an hour");
});

test("a listing the store really has nothing for is remembered, so it is not re-read every slot request", async () => {
  const id = "o-slotfacts-absent-com";
  assert.equal(await zoneOf(id), null, "no file at all is an answer");
  write(id, '{"area":"Seattle, WA"}');
  assert.equal(await zoneOf(id), null, "and it is held for the hour, which is what the cache is for");
});

test("the last answer, however old, beats falling back to nothing", () => {
  const known = { zone: "America/Los_Angeles", week: null };
  const failed = factsAfterRead(known, { detail: null, failed: true });
  assert.deepEqual(failed.facts, known, "a stale zone is still that shop's zone");
  assert.equal(failed.remember, false, "and the clock is not restarted, so the next request tries the read");
  const first = factsAfterRead(undefined, { detail: null, failed: true });
  assert.deepEqual(first.facts, { zone: null, week: null }, "with nothing known yet there is nothing to keep");
  assert.equal(first.remember, false);
});

test("a read that answered is remembered, file or no file", () => {
  const got = factsAfterRead(undefined, { detail: { area: "Tampa, FL", hrs: null as never }, failed: false });
  assert.equal(got.facts.zone, "America/New_York");
  assert.equal(got.remember, true);
  const none = factsAfterRead({ zone: "America/Denver", week: null }, { detail: null, failed: false });
  assert.deepEqual(none.facts, { zone: null, week: null }, "a listing the store has no file for keeps no borrowed zone");
  assert.equal(none.remember, true);
  assert.equal(weekIn(null), null);
});
