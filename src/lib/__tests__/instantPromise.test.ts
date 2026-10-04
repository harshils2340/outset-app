import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Unclaimed } from "../../data/types";
import { experienceById, instantBookable, mergeCatalog, setOperatorOverride } from "../catalog";
import { defaultProfile, toCatalog } from "../operator";

/**
 * "Instant confirmation" is a promise, and a paused listing cannot keep it.
 *
 * `bookingPaused` has always been read where the Reserve button is, and Otto reads it too. The rows above the
 * button did not: a shop that paused new bookings, or took its page down, had the desktop listing promising
 * "Instant confirmation. Your spot is confirmed the moment you book." in its highlight rows, under "Run by
 * <shop>", and in the business facts list, with "Not taking bookings right now" in the box beside them. The
 * phone sheet did the same in its own highlight rows. A card for such a shop was badged "Instant Book" with a
 * price, and the tap landed on the refusal.
 *
 * One rule now, `instantBookable`, so a fourth surface cannot pick up the switch without the pause.
 */

const here = dirname(fileURLToPath(import.meta.url));

let n = 0;
function op(over: Partial<Unclaimed> = {}): Unclaimed {
  n += 1;
  return {
    id: "o-instant-" + n,
    title: "Shop " + n,
    cat: "water",
    art: "jetski",
    metroId: "tampa",
    area: "Tampa, FL",
    src: "instant" + n + ".example.com",
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

/** A claimed shop with Instant Book on, as the dashboard publishes it. */
function instantShop(): Unclaimed {
  const u = op();
  mergeCatalog([u], {});
  const p = { ...defaultProfile(u, owner), instantBook: true };
  setOperatorOverride(u.id, toCatalog(p, u), true);
  return experienceById(u.id)!;
}

test("an unclaimed listing is never instant, switch or no switch", () => {
  const u = op({ instant: true });
  mergeCatalog([u], {});
  assert.equal(instantBookable(experienceById(u.id)!), false);
});

test("a claimed shop on Instant Book is instant", () => {
  assert.equal(instantBookable(instantShop()), true);
});

test("pausing new bookings withdraws the promise", () => {
  const u = op();
  mergeCatalog([u], {});
  const p = { ...defaultProfile(u, owner), instantBook: true };
  setOperatorOverride(u.id, toCatalog({ ...p, accepting: false }, u), true);
  const item = experienceById(u.id)!;
  // The switch itself is untouched: it is the pause that withdraws the promise, so turning it back on restores it.
  assert.equal(item.instant, true);
  assert.equal(instantBookable(item), false);
  setOperatorOverride(u.id, toCatalog(p, u), true);
  assert.equal(instantBookable(experienceById(u.id)!), true);
});

test("hiding the listing withdraws the promise", () => {
  const u = op();
  mergeCatalog([u], {});
  const p = { ...defaultProfile(u, owner), instantBook: true };
  setOperatorOverride(u.id, toCatalog(p, u), false);
  const item = experienceById(u.id)!;
  assert.equal(item.offline, true);
  assert.equal(instantBookable(item), false);
});

/**
 * A component test would need a renderer this repo does not have, so this reads the source. What matters is
 * that no surface rebuilds the rule out of `claimed` and `instant` on its own, which is how the three of them
 * came to miss the pause.
 */
test("no guest-side surface builds the instant rule for itself", () => {
  const files = [
    ["../../components/web/WebListing.tsx", "the desktop listing page"],
    ["../../components/booking/Sheets.tsx", "the phone frame's listing"],
    ["../../components/explore/UnclaimedCard.tsx", "the feed and wishlist card"],
  ] as const;
  for (const [rel, what] of files) {
    const src = readFileSync(join(here, rel), "utf8");
    assert.ok(/\binstantBookable\s*\(/.test(src), what + " (" + rel + ") does not call instantBookable");
    assert.ok(
      !/claimed\s*&&\s*\w+\.instant/.test(src),
      what + " (" + rel + ") still builds the instant rule itself, so it can miss the pause",
    );
  }
});

/** The card's two paused reads: a shop that paused bookings keeps its place in the rails, so its card has to say so. */
test("the card reads the pause and not only the hidden flag", () => {
  const src = readFileSync(join(here, "../../components/explore/UnclaimedCard.tsx"), "utf8");
  assert.ok(/\bbookingPaused\s*\(/.test(src), "the card does not call bookingPaused");
  assert.ok(!/item\.offline/.test(src), "the card still branches on item.offline, so a paused shop reads as bookable");
});
