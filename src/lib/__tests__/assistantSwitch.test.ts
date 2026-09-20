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
 * The desktop listing and the phone sheet used to be two of the three places a guest could reach Otto, and
 * this test held both of them to the switch. Both were folded into Ask Outset, the one agent surface in the
 * product: neither builds its own Otto chat any more, so neither has anything left to gate. What is left is
 * `AppProvider`, which still opens a guest's own pre-existing Otto thread from before the fold (a returning
 * guest's conversation should not vanish), and that path still has to consult the switch: a shop that has
 * since turned Otto off should not go on answering into a thread it opened while it was still on.
 */
test("the chat thread a guest reopens still consults the switch", () => {
  const src = readFileSync(join(here, "../../state/AppProvider.tsx"), "utf8");
  assert.ok(/\bassistantOn\s*\(/.test(src), "AppProvider.tsx does not call assistantOn");
});

/**
 * Naming the switch is not obeying it. The desktop listing kept calling `assistantOn` elsewhere on the page
 * while its own way in, the "Ask Outset about <shop>" button, sat outside every branch of it, so a shop that
 * had switched the assistant off was still offering a guest its own published answers. This reads the branch
 * itself: the button that opens the agent must be inside the switch's true arm.
 */
test("the desktop listing's Ask button sits inside the switch, not beside it", () => {
  const src = readFileSync(join(here, "../../components/web/WebListing.tsx"), "utf8");
  const open = src.indexOf("assistantOn(item) ?");
  assert.ok(open > 0, "the listing no longer branches on assistantOn(item)");
  const close = src.indexOf(") : (", open);
  assert.ok(close > open, "the switch has no off branch, so a shop that turned it off is told nothing");
  const on = src.slice(open, close);
  assert.match(on, /openAsk\s*\(/, "the Ask Outset button is outside the assistant switch");
  // And the off arm has to say something: an empty panel under "Questions before you book?" is worse than none.
  const off = src.slice(close, close + 600);
  assert.match(off, /answers these themselves/, "the off branch does not hand the guest to the shop");
});
