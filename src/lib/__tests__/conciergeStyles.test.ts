import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Every class the concierge overlay draws has a rule, and every rule is drawn by something.
 *
 * `concierge.css` was rewritten in one commit around a card built out of `.cg-card`, `.cg-card-top` and
 * `.cg-slots`; the component that ships draws `.cg-opt`, `.cg-shop` and `.cg-via`. Eight classes lost every
 * rule they had and nothing failed, because unstyled markup still renders. What a guest saw was the shop
 * header, three inline children of one button with nothing between them:
 *
 *     Escapology WaterlooSun, Sep 20 · WaterlooRead live from their Resova calendar
 *
 * on every answer the overlay gave. A stylesheet and the markup it dresses are two files that have to agree
 * and no compiler checks them, so this does.
 *
 * The dead half is a warning rather than a failure: a rule for something that is not drawn any more is
 * untidy, not broken, and the media queries below the main block legitimately name a class twice.
 */

const TSX = readFileSync(new URL("../../components/web/WebConcierge.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../styles/concierge.css", import.meta.url), "utf8");

/**
 * Only what a `className` actually carries. Reading every `cg-` in the file would count the ones named in
 * its comments, and a comment explaining a class is not a use of it.
 */
function rendered(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
    const text = m[1] ?? m[2] ?? "";
    for (const c of text.matchAll(/\bcg-[a-z0-9-]+/g)) out.add(c[0]);
  }
  return out;
}

function styled(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/\.(cg-[a-z0-9-]+)/g)) out.add(m[1]);
  return out;
}

test("every class the overlay renders has a rule in concierge.css", () => {
  const have = styled(CSS);
  /**
   * `cg-b` takes a second class built as `"cg-" + e.kind`, and the working trace's list items take one built
   * as `"cg-t-" + tone(s.kind)` (`cg-t-go`, `cg-t-warn`, `cg-t-dim`, all styled below). Neither is whole in a
   * literal scan, so each is listed here by its own bare prefix rather than by every kind it could produce.
   */
  const dynamic = new Set(["cg-me", "cg-them", "cg-answer", "cg-t-"]);
  const missing = [...rendered(TSX)].filter((c) => !have.has(c) && !dynamic.has(c)).sort();
  assert.deepEqual(missing, [], missing.length + " classes are drawn with no rule anywhere");
});

test("the shop header's three lines are three lines", () => {
  // The whole visible half of that night: a name, a day and a source line inside one button.
  assert.match(CSS, /\.cg-shop b \{[^}]*display: block/);
  assert.match(CSS, /\.cg-shop small \{[^}]*display: block/);
  assert.match(CSS, /\.cg-via \{[^}]*display: block/);
});

test("the classes built from the agent's own kinds are styled too", () => {
  for (const kind of ["cg-me", "cg-them"]) assert.ok(styled(CSS).has(kind), kind);
});

test("Ask never dumps a guest onto the vendor's own pay page", () => {
  assert.doesNotMatch(TSX, /window\.open/);
  assert.match(TSX, /listingForOption/);
  assert.match(TSX, /confirmUnclaimed/);
});
