import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * The house rule, on every screen rather than on Otto alone.
 *
 * `AGENTS.md` says never use an em dash, and `assistant.test.ts` already holds the assistant to it. Nothing
 * held the screens to it, and two had slipped through on the metrics page: a sentence joined with one, and a
 * bare em dash standing in for "no value" on a page that had never been read for copy.
 *
 * A dash inside a regular expression is a character the crawl has to match, not something anyone reads, so
 * those lines are the one exception.
 */

/** The rehearsal runs these from `backend/`, so the app is found from this file rather than the shell. */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EM = "—";
/** The dash sits inside a regular expression literal on this line. */
const IN_REGEX = /(?:^|[^\\])\/[^/\n]*—[^/\n]*\/[a-z]*/;

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

test("no screen in the app prints an em dash", () => {
  const offences: string[] = [];
  const files = sources(ROOT);
  for (const file of files) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (line.includes(EM) && !IN_REGEX.test(line)) offences.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offences, []);
  // The sweep has to be reading the app at all: a walk that found nothing would pass silently.
  assert.ok(files.length > 50, "expected the whole app, found " + files.length + " files");
});
