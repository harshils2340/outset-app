import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/**
 * Every relative import in the backend has to name a file that is on disk.
 *
 * Added 27 September 2026, after HEAD spent a night unable to compile: a commit pointed
 * `src/outreach/ottoDrafts.ts` at `./owner.ts`, a file that was never created, so the backend type check
 * failed and the five outreach tests with it. `npm test` on its own does not catch that, because a test only
 * loads the modules it imports, and `tsc` is not what the nightly runs first. This does catch it, in the same
 * run as everything else, with no database and in well under a second.
 */

const ROOT = resolve(import.meta.dirname, "..", "..");
/** Only a real import or export statement counts. A path inside a string is generated code, not an import. */
const IMPORT = /^(?:import|export)\b[^\n]*?\bfrom\s+"(\.[^"]*)"/;
const BARE = /^import\s+"(\.[^"]*)"/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.m?ts$/.test(entry)) out.push(p);
  }
  return out;
}

test("every relative import in the backend resolves to a file on disk", () => {
  const files = [...tsFiles(join(ROOT, "src")), ...tsFiles(join(ROOT, "scripts"))];
  assert.ok(files.length > 100, "found " + files.length + " source files, expected the whole backend");
  const missing: string[] = [];
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const spec = (IMPORT.exec(line) || BARE.exec(line))?.[1];
      if (!spec) continue;
      const target = resolve(dirname(file), spec);
      const found = existsSync(target) || existsSync(target + ".ts") || existsSync(join(target, "index.ts"));
      if (!found) missing.push(file.slice(ROOT.length + 1) + " -> " + spec);
    }
  }
  assert.deepEqual(missing, [], "imports naming a file that is not there:\n" + missing.join("\n"));
});
