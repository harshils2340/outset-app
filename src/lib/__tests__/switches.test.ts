import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Every switch in the operator dashboard says what it switches.
 *
 * A `.optoggle` is a knob and nothing else: its `<span class="knob">` is decoration, so unless the button
 * carries an `aria-label` or a visible `.lbl`, a screen reader reads "button, pressed" and stops. The
 * Availability page had seven of them in a column, one per day, all reading the same, while the two selects
 * beside each one said "Monday opening time"; Settings had one for Instant Book whose only name sat in the
 * row next to it. The repo has no renderer, so this reads the source, which is enough to keep the rule.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../components/operator");

/** From `<button` at `at` to its own `</button>`, counting the nested ones. */
function buttonAt(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if (src.startsWith("<button", i)) depth++;
    else if (src.startsWith("</button>", i)) {
      depth--;
      if (depth === 0) return src.slice(at, i + 9);
    }
  }
  return src.slice(at);
}

/**
 * The opening tag alone. The first ">" is no use: every one of these carries an onClick arrow, so a plain
 * search for it stops inside `() =>` and the attributes after it go unread.
 */
function openTag(el: string): string {
  let brace = 0;
  let quote = "";
  for (let i = 0; i < el.length; i++) {
    const c = el[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === ">" && brace === 0 && el[i - 1] !== "=") return el.slice(0, i + 1);
  }
  return el;
}

test("every dashboard switch carries a name a screen reader can read", () => {
  const unnamed: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(join(dir, file), "utf8");
    for (let at = src.indexOf("<button"); at >= 0; at = src.indexOf("<button", at + 1)) {
      const el = buttonAt(src, at);
      const open = openTag(el);
      if (!/optoggle/.test(open)) continue;
      const named = /aria-label=/.test(open) || /className="lbl"/.test(el);
      if (!named) unnamed.push(`${file}: ${open.replace(/\s+/g, " ").slice(0, 90)}`);
    }
  }
  assert.deepEqual(unnamed, [], "a switch with no name reads as a bare \"button\":\n" + unnamed.join("\n"));
});
