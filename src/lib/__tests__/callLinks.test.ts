import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { callablePhone, dialPhone, displayPhone } from "../phone";

/**
 * Every `tel:` link in the app is built by the one reader in `lib/phone.ts`.
 *
 * `phone.ts` exists because the old rule was to strip everything but digits and a plus and dial whatever was
 * left, and the shipped catalog carries 258 fields that are not one number: two numbers in one, a
 * percent-encoded `tel:` link, an extension on the end, and a winery whose published number is the gambling
 * helpline. The listing page was fixed. Two surfaces were not, and both of them are a person pressing Call:
 *
 *   - the concierge's "By phone" card did `"tel:" + phone.replace(/[^\d+]/g, "")`, which is the old rule
 *     verbatim, on the operator row the crawl wrote;
 *   - the operator dashboard's booking drawer dialled the guest's own stored mobile verbatim.
 *
 * A stripping rule looks right on every ordinary number, so nothing catches it until a guest or an owner
 * rings a stranger. This test is the rule itself: a `tel:` href has to be concatenated with something the
 * reader produced.
 */

const ROOTS = ["../../components", "../../lib", "../../state"];

function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: URL, label: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__") continue;
      if (e.isDirectory()) walk(new URL(e.name + "/", dir), label + e.name + "/");
      else if (/\.tsx?$/.test(e.name)) out.push({ file: label + e.name, text: readFileSync(new URL(e.name, dir), "utf8") });
    }
  };
  for (const r of ROOTS) walk(new URL(r + "/", import.meta.url), r.replace("../../", "src/") + "/");
  return out;
}

test("no surface builds a tel: href out of anything but the reader's own answer", () => {
  const offenders: string[] = [];
  for (const { file, text } of sources()) {
    if (file.endsWith("phone.ts")) continue; // its own doc comment quotes the shapes it reads.
    for (const m of text.matchAll(/"tel:"\s*\+\s*([A-Za-z0-9_.?[\]()]+)/g)) {
      if (!/dial/i.test(m[1])) offenders.push(`${file}: tel: + ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("nothing strips a phone field down to digits and a plus any more", () => {
  const offenders: string[] = [];
  for (const { file, text } of sources()) {
    for (const line of text.split("\n")) {
      if (!/tel:|phone/i.test(line)) continue;
      if (/replace\(\/\[\^\\d\+\]/.test(line)) offenders.push(file + ": " + line.trim().slice(0, 100));
    }
  }
  assert.deepEqual(offenders, []);
});

/**
 * The concierge card and the dashboard drawer, on the real shapes. These are the numbers each surface used to
 * dial, taken from the shapes `phone.test.ts` names as real catalog contacts, plus the two the booking route
 * used to make out of what a guest typed.
 */
test("the concierge no longer dials an extension onto the end of a shop's number", () => {
  const strip = (s: string) => "tel:" + s.replace(/[^\d+]/g, "");
  assert.equal(strip("+1-360-393-4106x102"), "tel:+13603934106102"); // what the card used to write
  assert.equal("tel:" + dialPhone("+1-360-393-4106x102"), "tel:+13603934106");
  assert.equal(callablePhone("+1-360-393-4106x102"), "(360) 393-4106 ext. 102");
  // Two numbers in one field, and a percent-encoded tel: link whose "%20" the strip reads as digits.
  assert.equal(strip("+1-304-725-6399; +1-703-309-2130"), "tel:+13047256399+17033092130");
  assert.equal("tel:" + dialPhone("+1-304-725-6399; +1-703-309-2130"), "tel:+13047256399");
  assert.equal(strip("(928)%20649-8463"), "tel:928206498463");
  assert.equal("tel:" + dialPhone("(928)%20649-8463"), "tel:+19286498463");
});

test("a shop whose published field is not a number offers no call at all", () => {
  // The card shows "By phone" only when there is a number to ring, so these fall through to the shop's page.
  for (const raw of ["1-800-GAMBLER", "//{{bizInfo.contact.phoneLocal}}", "+1 (", "269204655747"]) {
    assert.equal(dialPhone(raw), null, raw);
    assert.equal(callablePhone(raw), null, raw);
  }
});

test("the guest's own mobile, as the route now stores it, is a number the operator can ring", () => {
  // `clean(b.guest?.phone, 40)`: the guest's own characters, capped, nothing taken out.
  const stored = (typed: string) => typed.trim().slice(0, 40);
  for (const [typed, dial, shown] of [
    ["(813) 555-0100 ext. 301", "+18135550100", "(813) 555-0100 ext. 301"],
    ["+1 (813) 555-0100 ext. 301", "+18135550100", "(813) 555-0100 ext. 301"],
    ["813-555-0100 x102", "+18135550100", "(813) 555-0100 ext. 102"],
    ["813-555-0100 / 727-555-0199", "+18135550100", "(813) 555-0100"],
    ["8135550100", "+18135550100", "(813) 555-0100"],
  ] as const) {
    assert.equal(dialPhone(stored(typed)), dial, typed);
    assert.equal(displayPhone(stored(typed)), shown, typed);
  }
});
