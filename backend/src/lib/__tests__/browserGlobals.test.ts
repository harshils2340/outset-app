import { strict as assert } from "node:assert";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Who in a Node service is allowed to name a browser's globals.
 *
 * `tsconfig.json` carries `DOM` in its `lib`, and it has to: `page.evaluate(() => ...)` hands Playwright a
 * function that runs inside the page, where `document`, `window` and `getComputedStyle` genuinely exist, and
 * without the DOM types that function does not compile. It was added the night `src/concierge/agent.ts`
 * landed with thirteen of those errors and took the whole backend type-check red, the second time in one
 * night that browser globals in a Node project had done it.
 *
 * What it cost is what this replaces. Before, `document` in ordinary server code was a compile error. Now it
 * is a runtime crash in production, and the only thing between the two is this list: a file may name these
 * globals if it drives a browser or if it writes a page for one. Adding a file here should be a deliberate
 * act, so the error arrives at whoever adds it rather than at a guest.
 */

const BROWSER_GLOBALS = /(?:^|[^.\w$])(?:document|window|getComputedStyle|navigator|localStorage)\s*[.(]/;

/** Drives a real browser, or writes the HTML one will run. Everything else here is a Node service. */
const MAY = new Set([
  "src/concierge/agent.ts",
  "src/concierge/sniff.ts",
  "src/scrape/render.ts",
  "src/api/sessionsPage.ts",
]);

/**
 * A whole directory, because every file in it is one of these by definition: a per-vendor driver opens the
 * shop's own booking page in a real browser and reads it. Naming them one by one would turn this into a
 * chore that gets skipped, which is how a guard stops guarding.
 */
const MAY_DIRS = ["src/concierge/drivers/"];

const ROOT = join(fileURLToPath(new URL("../../..", import.meta.url)));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = dir + "/" + name;
    // Tests do not ship, and one of them carries `alert(document.cookie)` as the XSS string it escapes.
    if (name === "__tests__" || name === "fixtures") continue;
    if (statSync(join(ROOT, rel)).isDirectory()) sources(rel, out);
    else if (name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Comments are prose: "the request budget stopped us short of the whole window" is not a DOM reference. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("only the files that drive a browser name a browser's globals", () => {
  const offenders = sources("src")
    .filter((rel) => !MAY.has(rel) && !MAY_DIRS.some((d) => rel.startsWith(d)))
    .filter((rel) => BROWSER_GLOBALS.test(code(readFileSync(join(ROOT, rel), "utf8"))));
  assert.deepEqual(
    offenders,
    [],
    "DOM is in this project's lib so Playwright's page callbacks compile, which means server code naming " +
      "these no longer fails to build: it fails in production instead. Add the file above only if it really " +
      "drives a browser.",
  );
});

test("the lib that makes a page callback compile is still there", () => {
  // If this goes, agent.ts and every future page callback stop building, and the list above stops mattering.
  const tsconfig = readFileSync(join(ROOT, "tsconfig.json"), "utf8");
  assert.match(tsconfig, /"lib":\s*\[[^\]]*"DOM"/i);
});
