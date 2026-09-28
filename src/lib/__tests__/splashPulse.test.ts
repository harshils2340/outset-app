import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Only a splash that is waiting on the network may pulse.
 *
 * `.odsplash > :first-child` carries `odsplashpulse` forever, and that is right for the one screen it was
 * written for: "Opening your dashboard…" leads with the brand mark, and the mark breathing is what says the
 * page has not stopped. The claim-confirm screen ("This is your business?") came later and leads with the
 * business card instead, so the same rule caught it: on the one screen that asks an owner to hand their
 * business over, the card naming that business throbbed like a loading skeleton, at 400px, 360px and 1280px
 * alike, with nothing loading and nothing to wait for but their own click.
 *
 * The card opts out inline, because the selector itself lives in `src/styles/operator.css`. If that selector
 * is narrowed to the loading splash, the first test here fails and this whole file can go.
 */

const CSS = readFileSync(new URL("../../styles/operator.css", import.meta.url), "utf8");
const TSX = readFileSync(new URL("../../components/operator/OpLogin.tsx", import.meta.url), "utf8");

test("the stylesheet still pulses whatever leads a splash", () => {
  const rule = /\.odsplash\s*>\s*:first-child\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, ".odsplash > :first-child no longer exists; re-read this file, the opt-out below may be dead code");
  assert.match(rule![1], /animation\s*:/, "the rule is expected to animate its child");
});

test("the loading splash leads with the mark, which is what the pulse is for", () => {
  const at = TSX.indexOf('linkState === "checking"');
  assert.ok(at > 0, 'the "checking" splash was renamed; re-read this test');
  const body = TSX.slice(at, at + 600);
  const splash = body.indexOf('"odsplash"');
  assert.ok(splash > 0, "the checking branch no longer renders an .odsplash");
  assert.match(body.slice(splash, splash + 200), /<Mark\b/, "the checking splash is expected to lead with the brand mark");
});

test("the claim-confirm splash leads with a card that does not pulse", () => {
  const at = TSX.indexOf('linkState === "confirm"');
  assert.ok(at > 0, 'the "confirm" splash was renamed; re-read this test');
  const body = TSX.slice(at, at + 900);
  const splash = body.indexOf('"odsplash"');
  assert.ok(splash > 0, "the confirm branch no longer renders an .odsplash");
  // Whatever leads that splash: today the claim card, through claimHead's own opt-out.
  assert.match(body.slice(splash, splash + 700), /claimHead\([^)]*,\s*true\s*\)/, "the confirm splash's leading card is expected to ask claimHead to hold still");
});

test("claimHead holds still only when it is asked to", () => {
  const m = /const claimHead = \(u: Unclaimed, still = false\) => \(\s*<div className="odclaimhead" style=\{([^}]*\}[^}]*)\}>/.exec(TSX);
  assert.ok(m, "claimHead no longer takes a `still` flag or no longer spends it on an inline style");
  assert.match(m![1], /animation:\s*"none"/, "`still` is expected to turn the inherited animation off");
  assert.match(m![1], /still\s*\?/, "and to leave the card alone everywhere else");
});

/**
 * The guest side has the same rule (`.paysplash > :first-child`) over three screens, and all three lead with
 * the mark, which is what it is for. This is the guard, so a fourth one that leads with something else is
 * caught here rather than on a guest's screen between "Book and pay" and Stripe.
 */
test("every guest splash leads with the mark", () => {
  const APP = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  const CSSAPP = readFileSync(new URL("../../styles/app.css", import.meta.url), "utf8");
  const rule = /\.paysplash\s*>\s*:first-child\s*\{([^}]*)\}/.exec(CSSAPP);
  assert.ok(rule, ".paysplash > :first-child no longer exists; re-read this test");
  assert.match(rule![1], /animation\s*:/, "the rule is expected to animate its child");
  const splashes = [...APP.matchAll(/className="paysplash"/g)];
  assert.ok(splashes.length >= 3, "expected the three splashes App.tsx draws; re-read this test");
  for (const m of splashes) {
    const lead = APP.slice(m.index!, m.index! + 220);
    assert.match(lead, /<Mark\b/, "a .paysplash that does not lead with the mark would pulse whatever does");
  }
});
