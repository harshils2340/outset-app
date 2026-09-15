import assert from "node:assert/strict";
import test from "node:test";
import { liveVariants, toCatalog, type OperatorProfile } from "../operator";
import { splitAddons } from "../storage";
import type { Unclaimed } from "../../data/types";

/**
 * The menu a claimed shop publishes, against the menu it is still editing. Adding a row is one click and
 * naming it is a separate act, so the guest listing has to tell the two apart: an empty row on the dashboard
 * was an empty row on the listing, and under Add-ons it read as a nameless tick box saying "Free".
 */

const base = { id: "u-x", title: "Shop", options: [], services: [], addons: [] } as unknown as Unclaimed;

const profile = (over: Partial<OperatorProfile>): OperatorProfile =>
  ({
    v: 1, id: "u-x", claimedAt: 0, ownerName: "", ownerEmail: "", ownerPhone: "",
    accepting: true, published: true, instantBook: false, assistant: true,
    title: "Shop", cat: "water", blurb: "", phone: "", email: "", website: "", address: "", cover: "",
    photos: [], policy: [], services: [], addons: [],
    hours: Array.from({ length: 7 }, () => ({ closed: true, open: "09:00", close: "17:00" })),
    slotMinutes: 60, leadHours: 2, windowDays: 60, blockedDates: [], blockedSlots: [], bookings: [], decisions: {},
    notify: { email: true, sms: true, push: true }, payout: null,
    ...over,
  }) as OperatorProfile;

const service = (name: string) => ({ id: "s" + name, name, desc: "", live: true, durationMin: 60, capacity: 8, variants: [{ id: "v" + name, label: "Standard", price: 40, per: "person" }] });

test("an add-on the operator has not named yet is not on the guest's menu", () => {
  const p = profile({ addons: [{ id: "a1", name: "", detail: "", price: null }, { id: "a2", name: "Dry bag", detail: "", price: 12 }] });
  assert.deepEqual(toCatalog(p, base).addons?.map((a) => a.name), ["Dry bag"]);
});

test("an add-on with a price and no name is still not on the guest's menu", () => {
  // The worse half of the same bug: a nameless tick box that charges $30.
  const p = profile({ addons: [{ id: "a1", name: "   ", detail: "", price: 30 }] });
  assert.deepEqual(toCatalog(p, base).addons, []);
});

test("a service with no name is not offered, and is not counted as a gap in the menu", () => {
  const p = profile({ services: [service("Sunset tour"), { ...service("x"), name: "" }] });
  const patch = toCatalog(p, base);
  assert.deepEqual(patch.services?.map((s) => s.name), ["Sunset tour"]);
  assert.deepEqual(patch.options?.map((o) => o.name), ["Sunset tour"]);
  assert.equal(liveVariants(p).length, 1);
});

test("a service switched off is still off, named or not", () => {
  const p = profile({ services: [{ ...service("Sunset tour"), live: false }] });
  assert.deepEqual(toCatalog(p, base).options, []);
});

/**
 * The two things a booking's `addons` list holds: the service, as an index into the listing's menu, and every
 * extra, by name. The phone confirmation read the whole list as indexes and so showed no extras at all.
 */

test("a booking's service and its extras are read apart", () => {
  assert.deepEqual(splitAddons(["2", "Dry bag", "Photo pack"]), { optionIdx: 2, extras: ["Dry bag", "Photo pack"] });
  assert.deepEqual(splitAddons(["0"]), { optionIdx: 0, extras: [] });
  // A trip booked with no service picked, and an extra whose name happens to start with a digit.
  assert.deepEqual(splitAddons(["2 wetsuits"]), { optionIdx: null, extras: ["2 wetsuits"] });
  assert.deepEqual(splitAddons([]), { optionIdx: null, extras: [] });
  assert.deepEqual(splitAddons(undefined), { optionIdx: null, extras: [] });
});
