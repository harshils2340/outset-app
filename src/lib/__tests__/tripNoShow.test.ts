import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askStatus } from "../tripStatus";

/**
 * What a guest reads, and what the tab spends, when the operator marks them absent.
 *
 * `noshow` is one of the seven answers `GET /bookings/paid/:listing/:code` gives, and it was the only one the
 * Trips tab had no word for: its pill map was keyed by `string`, so the missing row cost nothing at compile
 * time and the guest read their trip with a title, a time, a party and a code and no word on it at all,
 * which is the exact fault the status read was added to stop. No email is sent for a no-show either, so the
 * pill is the only place it can be read. `askStatus` had the same gap: a no-show is a verdict, and it was
 * being asked after again on every window activation out of the sixty reads an hour the guest's own return
 * from Stripe needs.
 */

const STATUSES = ["pending", "new", "accepted", "declined", "completed", "noshow", "cancelled"] as const;

test("every answer the API can give has a word for the guest", () => {
  const src = readFileSync(new URL("../../components/trips/TripsView.tsx", import.meta.url), "utf8");
  const map = src.slice(src.indexOf("const STATUS"), src.indexOf("};", src.indexOf("const STATUS")));
  for (const s of STATUSES) assert.match(map, new RegExp("\\n\\s*" + s + ": \\{ label: \""), "the Trips tab has no pill for " + s);
  // Keyed by the union rather than by `string`, so an eighth status cannot slip in unlabelled.
  assert.match(map, /Record<BookingStatus,/);
});

test("the pill map is the one the union names, with nothing extra", () => {
  const api = readFileSync(new URL("../api.ts", import.meta.url), "utf8");
  const line = api.split("\n").find((l) => l.startsWith("export type BookingStatus ="));
  assert.ok(line, "BookingStatus is not exported from api.ts");
  const named = [...line!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(named, [...STATUSES]);
});

test("a verdict is read once; what the operator is still to answer is re-asked", () => {
  for (const s of ["declined", "cancelled", "completed", "noshow"]) {
    assert.equal(askStatus(s, 1, Infinity), false, s + " is asked after again");
  }
  for (const s of ["new", "accepted", "pending"]) {
    assert.equal(askStatus(s, 1, Infinity), true, s + " stopped being re-asked");
  }
  // Nothing read yet is always asked; the first pass trusts anything already in hand.
  assert.equal(askStatus(undefined, 0), true);
  assert.equal(askStatus("noshow", 0), false);
  // Inside the fifteen second gap, even an unsettled booking waits.
  assert.equal(askStatus("new", 1, 1000), false);
});
