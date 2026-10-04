import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { experienceById, mergeCatalog, setOperatorOverride } from "../catalog";
import { defaultProfile, toCatalog } from "../operator";

/**
 * A claim has to reach a guest in one piece.
 *
 * `claimed` and `instant` are two halves of one rule: every guest surface reads `claimed && instant` before it
 * promises instant confirmation, and the booking API accepts and captures on the operator's Instant Book
 * switch alone. But `claimed` was written only by the nightly sync, which bakes it in beside the very patch
 * that carries `instant`, so for as long as a day after a shop claimed and switched Instant Book on:
 *
 *  - the listing page and the phone sheet offered "Request to book" and promised nothing,
 *  - the confirmation read "Request sent. Nothing is charged until they confirm", and where the guest paid,
 *    "Held on your card. Charged only when they confirm", for a card the API had already captured,
 *  - and the two "a claimed shop sells its own slots" rules (the picker's `ownSlots`, Otto's empty-window
 *    line) treated the shop as unclaimed, so a third party calendar could close a shop taking bookings here.
 *
 * The patch exists because somebody claimed the listing, so the patch says so.
 */

let n = 0;
function op(over: Partial<Unclaimed> = {}): Unclaimed {
  n += 1;
  return {
    id: "o-claimed-" + n,
    title: "Shop " + n,
    cat: "water",
    art: "jetski",
    metroId: "tampa",
    area: "Tampa, FL",
    src: "claimarrive" + n + ".example.com",
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

test("the patch an operator publishes says the listing is claimed", () => {
  const u = op();
  const patch = toCatalog(defaultProfile(u, owner), u);
  assert.equal(patch.claimed, true);
});

test("a shop that claimed and switched Instant Book on reaches a guest as instant, with no sync", () => {
  const u = op();
  mergeCatalog([u], {});
  // The crawled record, exactly as the catalog ships it: nobody has claimed it.
  assert.equal(experienceById(u.id)!.claimed, undefined);
  const p = { ...defaultProfile(u, owner), instantBook: true };
  // The one road a guest's browser has before a sync: GET /profiles/:id, applied through setOperatorOverride.
  setOperatorOverride(u.id, toCatalog(p, u), true);
  const item = experienceById(u.id)!;
  assert.equal(item.claimed, true);
  assert.equal(item.instant, true);
});

test("dropping the override puts the listing back to the crawled record", () => {
  const u = op();
  mergeCatalog([u], {});
  setOperatorOverride(u.id, toCatalog(defaultProfile(u, owner), u), true);
  assert.equal(experienceById(u.id)!.claimed, true);
  setOperatorOverride(u.id, null, true);
  assert.equal(experienceById(u.id)!.claimed, undefined);
});

test("Instant Book off stays off: claiming alone promises nothing", () => {
  const u = op();
  mergeCatalog([u], {});
  const p = defaultProfile(u, owner);
  // A fresh claim starts with Instant Book off, so the operator answers each request.
  assert.equal(p.instantBook, false);
  setOperatorOverride(u.id, toCatalog(p, u), true);
  const item = experienceById(u.id)!;
  assert.equal(item.claimed, true);
  assert.equal(item.instant, false);
});
