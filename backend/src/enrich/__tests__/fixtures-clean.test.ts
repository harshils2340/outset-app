import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Recorded vendor sessions are real pages, and real pages carry real tokens: on 15 September 2026 GitHub flagged a
 * Google browser key that Square's storefront embeds, copied into fixtures/square/exchanges.json by the recorder.
 * The key was Square's, not ours, but a recording must never carry one, so every fixture is scanned here.
 */
const SECRET = /AIza[0-9A-Za-z_-]{30,}|sk_(live|test)_[0-9A-Za-z]{10,}|whsec_[0-9A-Za-z]{10,}|AKIA[0-9A-Z]{16}|ghp_[0-9A-Za-z]{20,}|xox[bp]-[0-9A-Za-z-]{10,}|"set-cookie",\s*"(?!REDACTED")/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".json")) out.push(p);
  }
  return out;
}

test("no recorded fixture carries an API key or a live cookie", () => {
  const dir = join(import.meta.dirname, "fixtures");
  const bad = walk(dir).filter((f) => SECRET.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});
