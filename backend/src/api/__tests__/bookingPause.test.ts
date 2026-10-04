import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bookingPause, pauseReason, type StoredProfile } from "../profiles.ts";
import { noDays } from "../openSlots.ts";

/**
 * The dashboard's Published and Accepting switches, as the routes that offer or take a booking read them.
 *
 * The same two switches were read in three places and spelled two ways, and the third place did not read them
 * at all. `POST /bookings` refuses both and `/voice` turns both into `takingBookings`, but
 * `GET /bookings/open/:listing` answered a shop that had hidden its page or paused bookings with a full
 * calendar of open times, every one of which the booking route would then refuse with a 409. The guest page
 * hides its own picker for both, which is why nobody met it, but that page is not the only client and this
 * route is public and unauthenticated.
 */

const here = dirname(fileURLToPath(import.meta.url));

const rec = (over: Partial<StoredProfile> = {}): StoredProfile =>
  ({
    id: "o-test",
    claimedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    owner: { name: "", email: "", phone: "" },
    published: true,
    profile: null,
    patch: {},
    ...over,
  }) as StoredProfile;

test("a shop with both switches up is not paused", () => {
  assert.equal(bookingPause(rec()), null);
  assert.equal(bookingPause(rec({ patch: { accepting: true } })), null);
  assert.equal(bookingPause(rec({ profile: { accepting: true } })), null);
});

test("no profile row at all is an unclaimed listing, which nobody has switched off", () => {
  assert.equal(bookingPause(null), null);
  assert.equal(bookingPause(undefined), null);
});

test("the Published switch down reads as hidden, whatever Accepting says", () => {
  assert.equal(bookingPause(rec({ published: false })), "hidden");
  assert.equal(bookingPause(rec({ published: false, patch: { accepting: true } })), "hidden");
  assert.equal(pauseReason("hidden"), "This listing is hidden right now");
});

test("the Accepting switch down reads as paused, from the patch or from the profile", () => {
  assert.equal(bookingPause(rec({ patch: { accepting: false } })), "paused");
  assert.equal(bookingPause(rec({ profile: { accepting: false } })), "paused");
  assert.equal(pauseReason("paused"), "This business is not taking bookings right now");
});

test("the patch wins over the profile, because the patch is what the dashboard publishes to guests", () => {
  assert.equal(bookingPause(rec({ patch: { accepting: true }, profile: { accepting: false } })), null);
  assert.equal(bookingPause(rec({ patch: { accepting: false }, profile: { accepting: true } })), "paused");
});

test("a patch stored as an array is not read for its numbered keys", () => {
  assert.equal(bookingPause(rec({ patch: [] as unknown as Record<string, unknown> })), null);
  assert.equal(bookingPause(rec({ patch: [1, 2] as unknown as Record<string, unknown>, profile: { accepting: false } })), "paused");
});

test("the empty answer still names every date asked about, so a caller can tell it apart from no answer", () => {
  const days = noDays(new Date(2026, 9, 4), 3);
  assert.deepEqual(days, [
    { date: "2026-10-04", slots: [] },
    { date: "2026-10-05", slots: [] },
    { date: "2026-10-06", slots: [] },
  ]);
  // Across a month end, on the local calendar the rest of the route keeps.
  assert.deepEqual(noDays(new Date(2026, 9, 31), 2).map((d) => d.date), ["2026-10-31", "2026-11-01"]);
});

/** Three routes, one rule: a fourth place spelling it again is how the slot route came to miss it. */
test("every route that offers or takes a booking reads the one rule", () => {
  const files = [
    ["../bookings.ts", "the booking route"],
    ["../voice.ts", "the phone agent's facts route"],
    ["../openSlots.ts", "the public slot route"],
  ] as const;
  for (const [rel, what] of files) {
    const src = readFileSync(join(here, rel), "utf8");
    assert.ok(/\bbookingPause\s*\(/.test(src), what + " (" + rel + ") does not call bookingPause");
    assert.ok(
      !/accepting\s*===\s*false/.test(src),
      what + " (" + rel + ") still spells the Accepting switch out for itself",
    );
  }
});
