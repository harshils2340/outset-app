import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The home must never be left saying "Finding you" with nothing able to stop it.
 *
 * `state.locating` blanks the whole home: `ExploreView` draws two skeleton rails instead of the feed and
 * `WebHome` does the same, and only a dispatch turns it off. Exactly one thing dispatches, the locate effect in
 * AppProvider, and it gets one go: `placed` is set the moment the browser answers about location, and
 * `shouldLocate` refuses every run after that. So any path through that effect which returns without
 * dispatching strands the guest on skeletons until they reload the page.
 *
 * One such path shipped. `apply` declines to move the ground under a guest who has a sheet open, which is
 * right, and returned without a word, which is not: a first-time guest who tapped the search pill on the
 * skeleton while the browser's location prompt was still up, then closed the sheet without picking a city, had
 * the answer land against an open sheet and never got a home at all.
 *
 * Driving that needs a browser, a geolocation prompt and a React tree, none of which this suite has, so this
 * reads the effect the way `opening.test.ts` reads the rest of the file: it fails if a return inside `apply`
 * stops settling.
 */

const SRC = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");

/** The body of the locate run's `apply`, from its opening brace to the matching one. */
function applyBody(): string {
  const head = "const apply = (g: NonNullable<typeof start.guess>) => {";
  const at = SRC.indexOf(head);
  assert.ok(at > 0, "AppProvider no longer defines the locate run's `apply`; this guard needs rewriting");
  let depth = 0;
  for (let i = at + head.length - 1; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) return SRC.slice(at + head.length, i);
  }
  throw new Error("could not find the end of `apply`");
}

test("the search is declared over even when the answer is not acted on", () => {
  const body = applyBody();
  assert.match(body, /const settle = \(\) =>|settle\(\)/, "`apply` no longer settles at all");
  assert.match(SRC, /const settle = \(\) => \{\s*if \(stateRef\.current\.locating\) dispatch\(\{ type: "located" \}\);/, "settle() must be the thing that turns the skeletons off");
  assert.match(body, /if \(stateRef\.current\.sheet\) return settle\(\);/, "an open sheet stops the dispatch, so it has to settle instead");
  const chose = body.slice(body.indexOf("if (chose.current)"));
  assert.equal((chose.match(/return settle\(\);/g) || []).length, 2, "both ways a guest's own choice declines the answer must settle too");
});

test("no new silent return creeps back into apply", () => {
  const body = applyBody();
  // Every `return` in `apply`, each held against the only three that may leave `locating` as it found it.
  const returns = body.split("\n").map((l) => l.trim()).filter((l) => /\breturn\b/.test(l));
  const allowed = [
    // The effect was torn down; the run that replaced it will answer instead.
    "if (!alive) return;",
    // Settled on the line above.
    "return;",
    // Returns only when `locating` is already false, which is the state settle() would put it in.
    'if (sameGuess(g, start.guess) && !stateRef.current.locating) return;',
  ];
  for (const line of returns) {
    assert.ok(
      /return settle\(\);$/.test(line) || allowed.includes(line),
      `"${line}" leaves the home locating with nothing left to stop it; settle() before returning`,
    );
  }
  assert.ok(returns.length >= 5, "apply got smaller than this guard expects; re-read it");
});

test("the clock city is applied, not dispatched around apply", () => {
  // A bare `dispatch({ type: "metro" })` here closed whatever sheet the guest had open, because the reducer
  // clears `sheet` on a metro change.
  const run = SRC.slice(SRC.indexOf("const zone = metroFromTimeZone();"));
  const branch = run.slice(0, run.indexOf('dispatch({ type: "located" });'));
  assert.match(branch, /apply\(\{ kind: "metro", metroId: zone \}\)/);
  assert.doesNotMatch(branch, /dispatch\(\{ type: "metro", metroId: zone \}\)/);
});

test("the reducer's metro action still closes the sheet, which is why apply guards it", () => {
  assert.match(SRC, /case "metro":\s*\n\s*return \{ \.\.\.state, metroId: action\.metroId, near: null, locating: false, sheet: null \};/);
});
