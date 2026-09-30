import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * No script may name an identifier that is not in scope where it stands.
 *
 * `backend/tsconfig.json` includes `src` and nothing else, so `npx tsc --noEmit -p .`, the check the nightly
 * runs and the one that gates a push, compiles none of `backend/scripts`. Every command Harshil actually runs
 * lives there: the pipeline, the ramps, the cloud sender, the imports. Added 30 September 2026, after
 * `scripts/otto-ramp.mts` spent two days throwing `ReferenceError: quota is not defined` on the last line of
 * every real run, naming the round loop's own binding from outside the loop. It threw after the mail had gone
 * out and before any state was saved, so the launchd job failed every day, no sending day was ever recorded,
 * and the warm-up ramp sat on its first rung for good. Nothing caught it: `npm test` loads only the modules a
 * test imports, a script is not one, and the type check does not read the directory at all.
 *
 * Only unbound names are asserted on (TS2304, and TS2552 for the near miss with a suggestion). They are the
 * faults that are always a bug and never a matter of taste, and they cannot be introduced by a dependency
 * this machine happens not to have installed. Everything else the compiler has to say about `scripts` is left
 * alone on purpose: there are pre-existing nullability complaints in the e2e helpers, and turning this into a
 * full type check of the directory is a bigger change than the class of bug it is here to stop.
 */

const ROOT = resolve(import.meta.dirname, "..", "..");

function scriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...scriptFiles(p));
    else if (/\.m?ts$/.test(entry)) out.push(p);
  }
  return out;
}

test("every name a backend script uses is in scope where it is used", () => {
  const files = scriptFiles(join(ROOT, "scripts"));
  assert.ok(files.length > 50, "found " + files.length + " scripts, expected the whole directory");
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: ["node"],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
  });
  const unbound = program
    .getSemanticDiagnostics()
    .filter((d) => (d.code === 2304 || d.code === 2552) && d.file)
    .map((d) => {
      const { line } = d.file!.getLineAndCharacterOfPosition(d.start || 0);
      return d.file!.fileName.slice(ROOT.length + 1) + ":" + (line + 1) + ": " + ts.flattenDiagnosticMessageText(d.messageText, " ");
    });
  assert.deepEqual(unbound, [], "names used where nothing declares them:\n" + unbound.join("\n"));
});
