import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Unclaimed } from "../../data/types";
import { bookingPaused, experienceById, mergeCatalog, setOperatorOverride } from "../catalog";
import { defaultProfile, toCatalog } from "../operator";

/**
 * The dashboard's Published and Accepting switches, as a guest meets them.
 *
 * The desktop listing page has read both since they were built: it swaps the reserve card for "This listing is
 * hidden right now" or "Not taking bookings right now" and offers a way on. The phone frame's listing, which is
 * the same listing opened through a shared link, a booking email, Trips or a wishlist, read neither. It offered
 * the whole picker: a guest chose a service, a date, a time and a party, typed their name, mobile and email,
 * pressed Request to book, and only then got a toast reading "This listing is hidden right now", with the
 * booking refused and nothing to do next.
 *
 * Both flags are one predicate now, so a third surface cannot pick up only one of them.
 */

const here = dirname(fileURLToPath(import.meta.url));

let n = 0;
function op(over: Partial<Unclaimed> = {}): Unclaimed {
  n += 1;
  return {
    id: "o-paused-" + n,
    title: "Shop " + n,
    cat: "water",
    art: "jetski",
    metroId: "tampa",
    area: "Tampa, FL",
    src: "paused" + n + ".example.com",
    blurb: "",
    gap: "",
    specs: [],
    includes: [],
    policies: [],
    quotes: [],
    tags: [],
    options: [{ name: "Jet Ski Tours", detail: "2 hours", price: 199 }],
    ...over,
  } as unknown as Unclaimed;
}

const owner = { name: "Owner", email: "owner@example.com", phone: "8135550100" };

test("an unclaimed listing is not paused, because nobody has switched anything off", () => {
  const u = op();
  mergeCatalog([u], {});
  const item = experienceById(u.id)!;
  assert.equal(item.accepting, undefined);
  assert.equal(item.offline, undefined);
  assert.equal(bookingPaused(item), false);
});

test("the Accepting switch off reaches the guest record and reads as paused", () => {
  const u = op();
  mergeCatalog([u], {});
  const p = defaultProfile(u, owner);
  // A fresh claim takes bookings, the way the dashboard shows it.
  assert.equal(toCatalog(p, u).accepting, true);
  setOperatorOverride(u.id, toCatalog({ ...p, accepting: false }, u), true);
  const item = experienceById(u.id)!;
  assert.equal(item.accepting, false);
  assert.equal(bookingPaused(item), true);
});

test("the Published switch off leaves the link working and reads as paused", () => {
  const u = op();
  mergeCatalog([u], {});
  const p = defaultProfile(u, owner);
  setOperatorOverride(u.id, toCatalog(p, u), false);
  const item = experienceById(u.id)!;
  // The record stays reachable by its own id, which is what every shared link and booking email carries.
  assert.ok(item);
  assert.equal(item.offline, true);
  assert.equal(bookingPaused(item), true);
});

test("switching Published back on clears the pause", () => {
  const u = op();
  mergeCatalog([u], {});
  const p = defaultProfile(u, owner);
  setOperatorOverride(u.id, toCatalog(p, u), false);
  assert.equal(bookingPaused(experienceById(u.id)!), true);
  setOperatorOverride(u.id, toCatalog(p, u), true);
  assert.equal(bookingPaused(experienceById(u.id)!), false);
});

/**
 * The two surfaces that offer a guest a time. A component test would need a renderer the repo does not have,
 * so this reads the source: a surface that does not consult the predicate offers bookings the API refuses.
 */
test("every guest-side surface that offers a booking consults the pause", () => {
  const files = [
    ["../../components/web/WebListing.tsx", "the desktop listing page"],
    ["../../components/booking/Sheets.tsx", "the phone frame's listing"],
  ] as const;
  for (const [rel, what] of files) {
    const src = readFileSync(join(here, rel), "utf8");
    assert.ok(/\bbookingPaused\s*\(/.test(src), what + " (" + rel + ") does not call bookingPaused");
  }
});
