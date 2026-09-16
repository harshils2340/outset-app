import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Unclaimed } from "../../data/types";
import { experienceById, mergeCatalog, setOperatorOverride } from "../catalog";
import { assistantOn, companyHandoff } from "../companyAgent";
import { defaultProfile, toCatalog } from "../operator";

/**
 * The Assistant page's On/Off switch, end to end.
 *
 * `OperatorProfile.assistant` has existed, normalized and defaulted since the dashboard was built, and the
 * switch beside "Otto answers guests on your listing, day and night" wrote to it. Nothing read it. `toCatalog`
 * never published the key, so no guest listing could see it: an operator who switched Otto off, because it had
 * quoted something wrong or because they would rather answer guests themselves, watched the switch move to
 * "Off" and had Otto go on answering every guest, on the desktop listing and the phone sheet alike.
 *
 * Driven in a browser against the rehearsal's test listing before the fix: the switch read "Off", the device
 * saved `assistant: false`, the published patch carried no `assistant` key at all, and a guest in a clean
 * browser still got the Otto panel and an answer quoting the shop's prices.
 */

const here = dirname(fileURLToPath(import.meta.url));

let n = 0;
function op(over: Partial<Unclaimed> = {}): Unclaimed {
  n += 1;
  return {
    id: "o-assist-" + n,
    title: "Shop " + n,
    cat: "water",
    art: "jetski",
    metroId: "tampa",
    area: "Tampa, FL",
    src: "assist" + n + ".example.com",
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

test("an unclaimed listing offers the assistant, because nobody has switched it off", () => {
  const u = op();
  mergeCatalog([u], {});
  const item = experienceById(u.id)!;
  assert.equal(item.assistant, undefined);
  assert.equal(assistantOn(item), true);
});

test("the switch reaches the guest listing: toCatalog publishes what the operator chose", () => {
  const u = op();
  mergeCatalog([u], {});
  const p = defaultProfile(u, owner);
  // A fresh claim starts with Otto on, the way the dashboard shows it.
  assert.equal(p.assistant, true);
  assert.equal(toCatalog(p, u).assistant, true);
  // The switch pressed once.
  assert.equal(toCatalog({ ...p, assistant: false }, u).assistant, false);
});

test("a shop that switched the assistant off stops offering it to guests", () => {
  const u = op();
  mergeCatalog([u], {});
  assert.equal(assistantOn(experienceById(u.id)!), true);
  const p = defaultProfile(u, owner);
  setOperatorOverride(u.id, toCatalog({ ...p, assistant: false }, u), true);
  const after = experienceById(u.id)!;
  assert.equal(after.assistant, false);
  assert.equal(assistantOn(after), false);
});

test("switching it back on offers it again", () => {
  const u = op();
  mergeCatalog([u], {});
  const p = defaultProfile(u, owner);
  setOperatorOverride(u.id, toCatalog({ ...p, assistant: false }, u), true);
  assert.equal(assistantOn(experienceById(u.id)!), false);
  setOperatorOverride(u.id, toCatalog({ ...p, assistant: true }, u), true);
  assert.equal(assistantOn(experienceById(u.id)!), true);
});

test("a patch saved before the key existed reads as on, not off", () => {
  const u = op();
  mergeCatalog([u], {});
  // Every profile stored by an older dashboard round-trips through the API as JSON with no `assistant` key.
  // Only an explicit false may turn Otto off, or an upgrade would silently mute every claimed shop.
  setOperatorOverride(u.id, { title: u.title, options: u.options }, true);
  assert.equal(assistantOn(experienceById(u.id)!), true);
});

test("the handoff names the shop and offers the way through to a person", () => {
  const u = op({ title: "Bay Jet Skis" });
  const withPhone = companyHandoff({ item: u, contact: { phone: "+17275550100" } as never });
  assert.match(withPhone, /^Bay Jet Skis answers questions themselves\./);
  assert.match(withPhone, /\(727\) 555-0100/);
  // No published number: the booking request is the way through, the same line contactAnswer gives.
  const noPhone = companyHandoff({ item: u, contact: null });
  assert.match(noPhone, /booking request on this page reaches them directly/);
  assert.doesNotMatch(noPhone, /Call/);
});

/**
 * The three places a guest can reach Otto. A component test would need a renderer the repo does not have, so
 * this reads the source: every entry point must consult the switch, or the next one added quietly ignores it.
 */
test("every guest-side entry point to the assistant consults the switch", () => {
  const files = [
    ["../../components/web/WebListing.tsx", "the desktop listing's Otto panel"],
    ["../../components/booking/Sheets.tsx", "the phone listing's Ask Otto block"],
    ["../../state/AppProvider.tsx", "the chat thread a guest opens"],
  ] as const;
  for (const [rel, what] of files) {
    const src = readFileSync(join(here, rel), "utf8");
    assert.ok(/\bassistantOn\s*\(/.test(src), what + " (" + rel + ") does not call assistantOn");
  }
});
