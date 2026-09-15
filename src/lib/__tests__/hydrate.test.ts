import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { hydrateProfile, type OperatorProfile } from "../operator";

/**
 * Filling a fresh profile's gaps from the operator's own detail file.
 *
 * A profile claimed off the slim browse record has no services, photos or blurb, so the dashboard reads the
 * detail file and fills what is still empty. "Still empty" only means "not filled in yet" until the operator
 * starts working: after that, an empty menu is a menu they took down, and an empty gallery is photos they
 * deleted. Refilling both on every load gave the owner no way to keep either off the guest listing.
 */

const full = {
  id: "u-x",
  title: "Shop",
  blurb: "A scraped description of the shop.",
  cover: "https://example.com/a.jpg",
  photos: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
  options: [{ name: "Tour", detail: "Standard", price: 80, per: "/person" }],
  services: [{ name: "Tour", desc: null, variants: [{ label: "Standard", price: 80, per: "/person", optionIdx: 0 }] }],
  addons: [{ name: "Dry bag", detail: "", price: 12 }],
  policies: ["No refunds inside 24 hours."],
} as unknown as Unclaimed;

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

test("a fresh profile is filled from the detail file, and marked as filled", () => {
  const p = hydrateProfile(profile({}), full);
  assert.equal(p.services.length, 1);
  assert.equal(p.photos.length, 2);
  assert.equal(p.blurb, full.blurb);
  assert.equal(p.addons.length, 1);
  assert.deepEqual(p.policy, ["No refunds inside 24 hours."]);
  assert.equal(p.hydrated, true);
});

test("a menu the operator took down does not come back on the next load", () => {
  const filled = hydrateProfile(profile({}), full);
  // The owner hides then deletes every service, and deletes every photo with them.
  const emptied = { ...filled, services: [], photos: [], cover: "" };
  const again = hydrateProfile(emptied, full);
  assert.equal(again.services.length, 0, "the crawled menu came back");
  assert.equal(again.photos.length, 0, "the crawled photos came back");
});

test("what the operator typed is never overwritten, on the first pass or any other", () => {
  const typed = profile({ blurb: "Our own words.", services: [{ id: "s1", name: "Our tour", desc: "", live: true, durationMin: 60, capacity: 4, variants: [{ id: "v1", label: "Standard", price: 99, per: "person" }] }] });
  const p = hydrateProfile(typed, full);
  assert.equal(p.blurb, "Our own words.");
  assert.equal(p.services.length, 1);
  assert.equal(p.services[0].name, "Our tour");
  // Photos were still empty, so those are filled: a gap is a gap until the operator has been here.
  assert.equal(p.photos.length, 2);
});

test("a detail file with nothing to give leaves the profile alone and unmarked, so a real file still lands", () => {
  const empty = { id: "u-x", title: "Shop", options: [] } as unknown as Unclaimed;
  const p = profile({});
  const after = hydrateProfile(p, empty);
  assert.equal(after, p);
  assert.equal(after.hydrated, undefined);
  assert.equal(hydrateProfile(after, full).services.length, 1);
});
