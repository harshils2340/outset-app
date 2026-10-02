import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Every box a guest or an operator types into has a name.
 *
 * Three search boxes in this app are an `<input>` wrapped in a `<label>` whose only content is a magnifying
 * glass. That is not a label: the icon carries no text alternative, so the computed accessible name is empty,
 * and because the element is wrapped in a label at all the browser never falls back to the placeholder
 * either. Read through Chrome's own accessible-name computation, the claim screen's "find your business" box
 * and the dashboard's booking search were both nameless, which is the first thing an owner types into and the
 * one way they find a guest. The guest home's Where box had always said `aria-label="Where"` in the same
 * shape, so the fix is what two of the three already did.
 *
 * This walks the source rather than the DOM because the app's tests run without a browser. It is a shape
 * check: a label whose content begins with an icon and then an input, with nothing else to name it.
 */

const ROOT = new URL("../../", import.meta.url);

function files(dir: URL): URL[] {
  const out: URL[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...files(new URL(e.name + "/", dir)));
    else if (e.name.endsWith(".tsx")) out.push(new URL(e.name, dir));
  }
  return out;
}

test("a label whose only content is an icon never leaves its input unnamed", () => {
  // <label ...> <Markup .../> <input ... />
  const shape = /<label[^>]*>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<Markup[^>]*\/>\s*<input\b([\s\S]*?)\/>/g;
  const bare: string[] = [];
  let found = 0;
  for (const f of files(ROOT)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(shape)) {
      found += 1;
      if (!/\baria-label(?:ledby)?[={]/.test(m[1])) bare.push(f.pathname.split("/src/")[1]);
    }
  }
  assert.ok(found >= 3, "the icon-and-input search box shape has moved; this check is reading nothing (" + found + ")");
  assert.deepEqual(bare, [], "these inputs sit in an icon-only label and so have no accessible name");
});
