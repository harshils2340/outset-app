import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A link to a listing the catalog no longer holds.
 *
 * Every sync drops listings and a business can ask to be taken down, while the links already sent keep
 * working forever: a bookmark, a shared link, the listing link in our own outreach mail. The app opens the
 * request sheet straight from the hash so a link paints the listing rather than the home, and `ListingSplash`
 * covers the gap until the catalog is in. Nothing closed that sheet again when the listing turned out not to
 * exist, so the guest was left on an open listing screen with no listing on it, the home showing through, the
 * dead #o= still in the address bar for every refresh and bookmark after it, and no word about any of it.
 */

const provider = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

test("the sheet a listing link opens from the hash is still opened that way", () => {
  // The reason the close below has to exist. If a link stops opening the sheet before the catalog lands,
  // this test is the place to notice that the rest of this file is now about nothing.
  assert.ok(
    /sheet: "request" as const, reqTargetId: o\[2\]/.test(provider),
    "a listing link no longer opens the request sheet from the hash",
  );
});

test("the splash over that sheet stops once the catalog is in, so nothing else covers the gap", () => {
  assert.ok(
    /!reqTarget && !state\.catalogComplete \? <ListingSplash \/>/.test(app),
    "ListingSplash changed shape: check whether an unresolvable listing is still left showing the home through",
  );
});

test("a listing that is nowhere closes its own sheet and says so", () => {
  const m = /if \(deep && !experienceById\(deep\[1\]\)\) \{([\s\S]*?)\n      \}/.exec(provider);
  assert.ok(m, "the boot no longer checks whether a deep-linked listing exists");
  const body = m![1];
  assert.ok(/dispatch\(\{ type: "closeSheet" \}\)/.test(body), "the stuck request sheet is not closed again");
  assert.ok(/type: "toast"/.test(body), "the guest is told nothing about the listing being gone");
  assert.ok(/no longer on Outset/.test(body), "the wording stopped saying what happened");
});

test("a listing still on its way is not called gone", () => {
  // The listing's own file and the catalog are fetched side by side and either can land first, so the
  // decision waits on the deep load rather than reading `experienceById` the moment the catalog is complete.
  const m = /if \(deep && !experienceById\(deep\[1\]\)\) \{([\s\S]*?)\n      \}/.exec(provider);
  const body = m![1];
  assert.ok(/deepOpened\.then\(/.test(body), "the gone check no longer waits for the listing's own file");
  assert.ok(/opened \|\| experienceById\(deep\[1\]\)/.test(body), "a listing that landed in the meantime is not re-checked");
});

test("closing that sheet is what takes the dead link out of the address bar", () => {
  // The address-bar effect writes #o= while a request sheet is open and clears it otherwise, and it is keyed
  // on the sheet, so the close above is what makes a refresh and a bookmark honest again.
  assert.ok(
    /\}, \[state\.sheet, state\.reqTargetId, state\.screen\]\);/.test(provider),
    "the address-bar effect is no longer keyed on the sheet, so closing it may not clear the hash",
  );
});
