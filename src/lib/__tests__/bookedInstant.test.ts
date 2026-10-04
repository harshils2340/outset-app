import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Booking, Unclaimed } from "../../data/types";
import { bookedInstant } from "../storage";

/**
 * Whether a guest was booked on the spot is a fact about their booking, not about the dashboard today.
 *
 * The same fault `bookedRow` closes, on the other half of the ticket. Both confirmation screens asked the live
 * catalog record, and the operator's own switches move afterwards: Instant Book off, Accepting off, or the
 * Published switch down. So an operator flicking Instant Book off relabelled every instant booking already
 * taken. The desktop confirmation went from "You're booked" to "Request sent", and its money lines from "Paid
 * by card. Charged to your card." to "Held on your card. Charged only when <shop> confirms." for a card the
 * API had already captured; the phone ticket went from "Booked." to "Request sent." and told the guest nothing
 * would be charged until the shop answered.
 *
 * So the booking writes it down at confirm time, and the live switch is only the fallback for bookings older
 * than the field, which is what both screens did for every booking before.
 */

const here = dirname(fileURLToPath(import.meta.url));

const shop = (over: Partial<Unclaimed> = {}) => ({ claimed: true, instant: true, ...over }) as Unclaimed;
const booking = (over: Partial<Booking> = {}): Booking =>
  ({ listing: "o-1", date: "2026-10-10", slot: "09:00", qty: 2, addons: [], total: 398, code: "OU-1", created: 0, ...over }) as Booking;

test("a booking that wrote down an instant confirmation keeps it when the switch goes off", () => {
  const b = booking({ instant: true, paid: true });
  assert.equal(bookedInstant(b, shop()), true);
  // The operator turns Instant Book off the next morning.
  assert.equal(bookedInstant(b, shop({ instant: false })), true);
  // And pauses bookings, and takes the page down.
  assert.equal(bookedInstant(b, shop({ accepting: false })), true);
  assert.equal(bookedInstant(b, shop({ offline: true })), true);
});

test("a request stays a request when the shop later switches Instant Book on", () => {
  const b = booking({ instant: false });
  assert.equal(bookedInstant(b, shop({ instant: false })), false);
  assert.equal(bookedInstant(b, shop({ instant: true })), false);
});

test("a booking older than the field falls back to the live switch, as both screens always did", () => {
  const b = booking();
  assert.equal(b.instant, undefined);
  assert.equal(bookedInstant(b, shop()), true);
  assert.equal(bookedInstant(b, shop({ instant: false })), false);
  assert.equal(bookedInstant(b, shop({ claimed: false })), false);
  // A hand-built listing has no catalog record at all: those are requests, which is what the screens read.
  assert.equal(bookedInstant(b, null), false);
  assert.equal(bookedInstant(b, undefined), false);
});

/** The reducer is the one place a catalog booking is written, so it is the one place that can freeze this. */
test("the booking written at confirm time carries the flag", () => {
  const src = readFileSync(join(here, "../../state/AppProvider.tsx"), "utf8");
  assert.match(src, /instant: instantBookable\(u\)/, "confirmUnclaimed does not freeze the instant flag");
  assert.ok(
    !/u\.claimed && u\.instant/.test(src),
    "the reducer still rebuilds the instant rule from the live record",
  );
});

/**
 * A component test would need a renderer this repo does not have, so this reads the source: a confirmation
 * that computes the rule itself is one that goes wrong the next time an operator touches a switch.
 */
test("neither confirmation screen reads the live switch directly", () => {
  const files = [
    ["../../components/web/WebConfirm.tsx", "the desktop confirmation"],
    ["../../components/booking/ConfirmView.tsx", "the phone ticket"],
  ] as const;
  for (const [rel, what] of files) {
    const src = readFileSync(join(here, rel), "utf8");
    assert.ok(/\bbookedInstant\s*\(/.test(src), what + " (" + rel + ") does not call bookedInstant");
    assert.ok(
      !/claimed && \w*\??\.?instant/.test(src),
      what + " (" + rel + ") still builds the instant rule from the live record",
    );
  }
});
