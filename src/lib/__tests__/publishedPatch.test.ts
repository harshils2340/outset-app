import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { defaultProfile, toCatalog } from "../operator";
import { durationLabel as menuDuration } from "../listingDerive";
import { itemWeek } from "../openNow";
import { photoCandidates } from "../media";

/**
 * What an operator's saved edits look like by the time they reach a guest who is not the operator.
 *
 * `toCatalog` builds one patch and it goes two ways: straight into this browser's catalog through
 * `setOperatorOverride`, and to the API as JSON, which is how it reaches every other device. JSON drops a key
 * whose value is `undefined`, so a field cleared by setting it to `undefined` is cleared on the operator's own
 * screen and nowhere else. That is the worst shape a bug can take here, because the one person who would
 * notice is the one person who cannot see it. The cancellation line was fixed this way once already, by
 * publishing "" rather than `undefined`; the hours were not.
 */

const base = {
  id: "o-test-com",
  title: "Test Charters",
  src: "test.com",
  area: "Tampa, FL",
  cat: "water",
  art: "jetski",
  options: [{ name: "Half day", detail: "4 hours", price: 300, per: "/trip" }],
  services: [{ name: "Half day", desc: null, variants: [{ label: "4 hours", price: 300, per: "/trip", optionIdx: 0 }] }],
  dur: "4 hours",
  hrs: [0, 1, 2, 3, 4, 5, 6].map(() => [540, 1020] as [number, number]),
  hoursText: ["Daily 9am-5pm"],
  tags: [],
  includes: [],
  specs: [],
  gap: "",
} as unknown as Unclaimed;

/** An operator who claimed this shop, rewrote the menu to a 90 minute cruise and set their own hours. */
function edited() {
  const p = defaultProfile(base, { name: "O", email: "o@test.com", phone: "" });
  p.services = [{ id: "s1", name: "Sunset cruise", desc: "", photo: "", live: true, durationMin: 90, capacity: 6, variants: [{ id: "v1", label: "90 min", price: 150, per: "trip", perGuest: false }] }];
  p.hours = p.hours.map((h, i) => (i === 0 ? { ...h, closed: true } : { ...h, closed: false, open: "07:00", close: "11:00" }));
  return p;
}

/** The patch as a guest's device receives it: over the wire and merged onto the crawled record. */
function asGuestSeesIt(patch: Partial<Unclaimed>): Unclaimed {
  return { ...base, ...(JSON.parse(JSON.stringify(patch)) as Partial<Unclaimed>) };
}

const D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const show = (item: Unclaimed) => {
  const w = itemWeek(item);
  return w === null
    ? "(no hours)"
    : w.map((d, i) => (d ? (d.open === 0 && d.close === 0 ? D[i] + " closed" : D[i] + " " + d.open + "-" + d.close) : D[i] + " -")).join(", ");
};

test("the hours an operator sets reach a guest who is not the operator", () => {
  // The shop published Monday to Saturday, 7 AM to 11 AM, and shut on Sunday. Every guest opening it by link,
  // from search or from an email was told it was open nine to five every day, Sunday included, because
  // `hrs: undefined` never crossed the wire and `itemWeek` reads the crawled compact week before the lines.
  const patch = toCatalog(edited(), base);
  const guest = asGuestSeesIt(patch);
  assert.ok("hrs" in guest && !guest.hrs?.length, "the crawled compact week has to be cleared by a value JSON keeps");
  assert.equal(show(guest), "Sun closed, " + [1, 2, 3, 4, 5, 6].map((i) => D[i] + " 420-660").join(", "));
  // The operator's own browser, which was always right, stays right.
  assert.equal(show({ ...base, ...patch }), show(guest));
});

test("an operator who states no hours keeps the week crawled off their site", () => {
  const p = edited();
  p.hours = p.hours.map((h) => ({ ...h, closed: true }));
  const guest = asGuestSeesIt(toCatalog(p, base));
  assert.equal(show(guest), [0, 1, 2, 3, 4, 5, 6].map((i) => D[i] + " 540-1020").join(", "));
});

test("the duration on the card is the operator's menu, not the one crawled before they claimed", () => {
  // `dur` is read before a duration is derived from the menu, on the card, the listing hero, the booking
  // sheet and in Otto's "About 4 hours." A shop whose every service now says 90 min advertised 4 hours.
  const guest = asGuestSeesIt(toCatalog(edited(), base));
  assert.equal(guest.dur, "90 min");
  assert.equal(menuDuration(guest), "90 min", "the card's own fallback has to agree with what `dur` says");
});

test("a menu that states no duration leaves the crawled one standing", () => {
  const p = edited();
  p.services = [{ id: "s1", name: "Sunset cruise", desc: "", photo: "", live: true, durationMin: 90, capacity: 6, variants: [{ id: "v1", label: "Adult", price: 150, per: "person", perGuest: true }] }];
  assert.equal(asGuestSeesIt(toCatalog(p, base)).dur, "4 hours");
});

test("a photo the operator removed is gone from the guest's listing too", () => {
  const withPhotos = { ...base, cover: "https://test.com/a.jpg", photos: ["https://test.com/a.jpg", "https://test.com/b.jpg"] } as unknown as Unclaimed;
  const p = defaultProfile(withPhotos, { name: "O", email: "o@test.com", phone: "" });
  p.hydrated = true;
  // A fresh profile publishes the cover it was given, exactly as before.
  assert.equal(({ ...withPhotos, ...(JSON.parse(JSON.stringify(toCatalog(p, withPhotos))) as Partial<Unclaimed>) }).cover, "https://test.com/a.jpg");
  // The operator empties the gallery. `cover: undefined` never crossed the wire, so the crawled cover stayed
  // on every card, on the listing hero and at the front of the guest's gallery, which reads it before photos.
  p.photos = [];
  p.cover = "";
  const guest = { ...withPhotos, ...(JSON.parse(JSON.stringify(toCatalog(p, withPhotos))) as Partial<Unclaimed>) };
  assert.equal(guest.cover, "", "the crawled cover has to be cleared by a value JSON keeps");
  assert.deepEqual(photoCandidates(guest), []);
  // Removing only the cover promotes the photo behind it rather than falling back to the crawled one.
  p.photos = ["https://test.com/b.jpg"];
  p.cover = "";
  assert.equal(({ ...withPhotos, ...(JSON.parse(JSON.stringify(toCatalog(p, withPhotos))) as Partial<Unclaimed>) }).cover, "https://test.com/b.jpg");
});
