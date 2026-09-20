import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every file this service imports has to exist.
 *
 * On 20 September one commit imported two modules it never committed: a ForeUp reader from `plan.ts` and a
 * `nearby` route from `api/routes.ts`. Neither file is in any commit, on any branch, in any tree. An import
 * of a missing module is not a feature that quietly does nothing, it is a module that will not load, so
 * `plan.ts` threw on import and took the whole concierge with it, and `routes.ts` is the router every route
 * hangs off, so the API itself could not boot: not one booking, claim, profile or payout. It sat on `main`
 * that way because nothing runs on a push, and because a suite that cannot load a module fails in a way
 * that reads like a test failure rather than like a missing file.
 *
 * Node only resolves an import when something reaches it, and `npm test` only reaches the modules the tests
 * import, so this walks the source instead: every relative specifier in every file, checked against the
 * disk. It is the cheapest test in the suite and it is the one that would have caught this.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** An import statement, an export-from, and a dynamic import alike. */
const SPECIFIER = /(?:^|[\s({,;])(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?\(?\s*["'](\.[^"']+)["']/gm;

/**
 * Comments go first, because this file's own header quotes the two imports that prompted it, and a doc
 * comment elsewhere is free to name a module that has since moved. Stripping from `//` to the end of a line
 * cuts a URL in a string short too, which can only lose a specifier on that same line and never invent one.
 */
const uncommented = (body: string) => body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("every relative import in the backend points at a file that exists", () => {
  const missing: string[] = [];
  for (const file of sources(root)) {
    const body = uncommented(readFileSync(file, "utf8"));
    SPECIFIER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SPECIFIER.exec(body))) {
      const target = resolve(dirname(file), m[1]);
      const found = [target, `${target}.ts`, `${target}.tsx`, join(target, "index.ts")].some((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      });
      if (!found) missing.push(`${relative(root, file)} imports ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `these imports have no file behind them:\n${missing.join("\n")}`);
});
