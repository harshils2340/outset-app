import { strict as assert } from "node:assert";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fmtCount, fmtReviews, money, plural } from "../format";

/**
 * Which grouping a guest reads a count in: the product's, not their browser's.
 *
 * `money`, `fmtDate`, `dayPickLabel` and every other formatter in `format.ts` name "en-US", and so do the 52
 * call sites that format a date or a dollar by hand. The counts on browse, on the desktop home and on both
 * search sheets called bare `toLocaleString()`, which asks the browser instead: 38 of them over six files.
 * Half the catalog is Canadian and a browser there is often fr-CA, where the separator is a no-break space, so
 * the same sentence read "Over 1,000 experiences" beside "1 234", and an Arabic or Persian browser drew the
 * figure in Eastern Arabic numerals inside an English sentence.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** `toLocaleString()`, `toLocaleDateString()`, `toLocaleTimeString()` with nothing in the brackets. */
const NO_LOCALE = /\.toLocale(?:String|DateString|TimeString)\(\s*\)/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__") sources(path, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

test("no screen in the app hands a number, a date or a time to the browser's own locale", () => {
  const offences: string[] = [];
  const files = sources(ROOT);
  for (const file of files) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (NO_LOCALE.test(line)) offences.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offences, []);
  // The sweep has to be reading the app at all: a walk that found nothing would pass silently.
  assert.ok(files.length > 50, "expected the whole app, found " + files.length + " files");
});

test("a count groups the same way whatever the reader's browser is set to", () => {
  assert.equal(fmtCount(48198), "48,198");
  assert.equal(fmtCount(1234), "1,234");
  // Below a thousand nothing is grouped, which is why routing `plural` through this changed no answer.
  assert.equal(fmtCount(5), "5");
  assert.equal(plural(5, "seat"), "5 seats");
  assert.equal(plural(1, "seat"), "1 seat");
  assert.equal(plural(1234, "place"), "1,234 places");
  assert.equal(fmtReviews(2431), "2,431");
});

test("the same count under a browser that is not American", () => {
  // Node reads its default locale from the environment the same way a browser reads it from the operating
  // system, so this is the real gap rather than a restatement of it: `fmtCount` holds, bare does not.
  const script =
    "const n = 48198;" +
    "process.stdout.write(JSON.stringify([n.toLocaleString(), n.toLocaleString('en-US'), Intl.NumberFormat().resolvedOptions().locale]));";
  for (const [lang, bare] of [
    ["fr_CA.UTF-8", "48 198"],
    ["de_DE.UTF-8", "48.198"],
    ["ar_EG.UTF-8", "٤٨٬١٩٨"],
  ] as const) {
    const out = execFileSync(process.execPath, ["-e", script], { env: { ...process.env, LANG: lang, LC_ALL: lang }, encoding: "utf8" });
    const [browser, pinned, resolved] = JSON.parse(out) as [string, string, string];
    assert.equal(resolved, lang.split(".")[0].replace("_", "-"), "the child has to actually be in that locale");
    assert.equal(browser, bare, "what a bare toLocaleString() draws there");
    assert.equal(pinned, "48,198");
    assert.equal(fmtCount(48198), pinned);
  }
});

test("the dollars were already pinned, so the two now agree on one line", () => {
  assert.equal(money(1234), "$1,234");
  assert.equal(fmtCount(1234) + " places · from " + money(1234), "1,234 places · from $1,234");
});
