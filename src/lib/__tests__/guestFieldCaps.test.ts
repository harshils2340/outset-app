import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { GUEST_EMAIL_MAX, GUEST_NAME_MAX, GUEST_PHONE_MAX } from "../guestForm";

/**
 * The three fields a guest types about themselves carry the route's own caps, on every surface that draws
 * them.
 *
 * `POST /bookings` cuts the name at 80, the mobile at 40 and the address at 200, and then validates what is
 * left. The operator's own fields have carried a `maxLength` since they were written; the guest's three
 * never did, so the cut was invisible and happened after the guest had finished typing. The mobile is the
 * one that bit: a number with an extension on it is longer than it looks.
 *
 * Read as source text because these are inputs inside pages that import CSS, which no test here can load.
 */

const SURFACES = [
  ["src/components/booking/Sheets.tsx", "../../components/booking/Sheets.tsx"],
  ["src/components/web/WebListing.tsx", "../../components/web/WebListing.tsx"],
  ["src/components/web/WebConcierge.tsx", "../../components/web/WebConcierge.tsx"],
] as const;

/**
 * The one `<input ... />` element whose autoComplete is `kind`. Cut at the first `/>` rather than the first
 * `>`, because an `onChange` arrow carries a `>` of its own.
 */
function field(src: string, kind: string): string {
  const hits = src
    .split("<input")
    .slice(1)
    .map((chunk) => "<input" + chunk.slice(0, chunk.indexOf("/>") + 2))
    .filter((el) => el.includes(`autoComplete="${kind}"`));
  assert.equal(hits.length, 1, `expected one input with autoComplete=${kind}, found ${hits.length}`);
  return hits[0];
}

for (const [label, rel] of SURFACES) {
  const src = readFileSync(new URL(rel, import.meta.url), "utf8");
  test(`${label} caps the guest's name, mobile and email at the route's own lengths`, () => {
    assert.match(field(src, "name"), /maxLength=\{GUEST_NAME_MAX\}/);
    assert.match(field(src, "tel"), /maxLength=\{GUEST_PHONE_MAX\}/);
    assert.match(field(src, "email"), /maxLength=\{GUEST_EMAIL_MAX\}/);
  });
}

test("the caps themselves, so a change to one of them is a change to this line", () => {
  assert.equal(GUEST_NAME_MAX, 80);
  assert.equal(GUEST_PHONE_MAX, 40);
  assert.equal(GUEST_EMAIL_MAX, 200);
});

test("a cap is not a validator: the mobile still has to be a number before Reserve lights up", () => {
  // Both booking surfaces gate on ten digits, which a field at its 40 character limit can still fail.
  for (const [, rel] of SURFACES.slice(0, 2)) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.match(src, /guest\.phone\.replace\(\/\\D\/g, ""\)\.length >= 10/);
  }
});
