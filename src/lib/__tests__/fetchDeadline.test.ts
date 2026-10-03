import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every request the app makes has to be able to end.
 *
 * `fetch` has no deadline of its own: a connection a phone's network holds open but never answers leaves the
 * promise pending for the rest of the session, which is a different failure from an error and the one nothing
 * recovers from. `loadRemoteCatalog` has said so in a comment since it was written, and the fetch beside it,
 * the one that reads a single listing's detail file, had no deadline at all.
 *
 * What that cost a guest: a shared `#o=` link paints the listing screen before anything is fetched, and the
 * "that listing is no longer on Outset" rescue in `AppProvider` only runs once that fetch has settled. With it
 * stalled the splash stops at `catalogComplete`, the sheet is never closed, no toast is said, and the dead link
 * stays in the address bar for every refresh after it. `inflight` keeps the pending promise under that id too,
 * so pasting the same link again hands back the same stalled promise for the rest of the visit.
 *
 * So this is a sweep rather than one case: every `fetch` in `src` carries a signal, whichever file it is in.
 */

const SRC = new URL("../../", import.meta.url).pathname;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__") files(full, out);
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** The text of one call's arguments, from the opening bracket to the one that closes it. */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

type Call = { file: string; line: number; args: string };

function fetchCalls(): Call[] {
  const out: Call[] = [];
  for (const file of files(SRC)) {
    const src = readFileSync(file, "utf8");
    // `fetch(` only where it is the call itself: not `prefetch(`, not `refetch(`, not a `.fetch(` method.
    const re = /(^|[^.\w])fetch\s*\(/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const open = src.indexOf("(", m.index + m[0].length - 1);
      out.push({ file: file.slice(SRC.length), line: src.slice(0, m.index).split("\n").length, args: argsAt(src, open) });
    }
  }
  return out;
}

test("every fetch the app makes carries a signal, so a stalled connection cannot hang for ever", () => {
  const calls = fetchCalls();
  // A guard on the sweep itself: an empty walk would pass this test while reading nothing.
  assert.ok(calls.length >= 10, `expected the app to make several fetches, found ${calls.length}`);
  const naked = calls.filter((c) => !/\bsignal\s*:/.test(c.args)).map((c) => `${c.file}:${c.line}`);
  assert.deepEqual(naked, [], "these fetches have no way to end: " + naked.join(", "));
});

test("the two files a listing screen waits on both have a real deadline", () => {
  const byFile = new Map(fetchCalls().map((c) => [`${c.file}:${c.line}`, c.args]));
  const listing = [...byFile].filter(([, args]) => /"o\/"|"o\/" \+|\/o\//.test(args) || /BASE_URL \+ "o\//.test(args));
  assert.equal(listing.length, 2, "the listing detail file and its seed twin are the two reads a claim or a shared link waits on");
  for (const [where, args] of listing) {
    assert.match(args, /AbortSignal\.timeout\(/, where + " needs a timeout, not a caller's signal: nothing else ever ends it");
  }
});

test("a listing's own file is not given the whole catalog's patience", async () => {
  const src = readFileSync(new URL("../catalogLoad.ts", import.meta.url), "utf8");
  const catalog = Number(/CATALOG_TIMEOUT_MS = (\d+)/.exec(src)?.[1]);
  const listing = Number(/LISTING_TIMEOUT_MS = (\d+)/.exec(src)?.[1]);
  assert.ok(Number.isFinite(catalog) && Number.isFinite(listing));
  assert.ok(listing > 0 && listing < catalog, `a 3 kB detail file (${listing} ms) should not wait as long as a 24 MB catalog (${catalog} ms)`);
});
