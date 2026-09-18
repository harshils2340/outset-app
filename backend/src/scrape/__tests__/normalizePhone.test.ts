import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizePhone } from "../run.ts";

/**
 * What the scrape is allowed to store as an operator's phone.
 *
 * The rule was "E.164 when it reads as North American, otherwise keep the text as published", and that second
 * half is how the catalog came to publish 258 numbers no guest can ring: a field holding two numbers, a `tel:`
 * link still percent-encoded, an extension, an unrendered template placeholder, and a winery whose phone is
 * "1-800-GAMBLER". The app dialled every one of them. Now the one reader in `src/lib/phone.ts` decides, here
 * and in the sync and on the page, and a field with no number in it is stored as no phone at all.
 */

test("the ordinary shapes a site publishes still come out as E.164", () => {
  assert.equal(normalizePhone("(813) 555-0100"), "+18135550100");
  assert.equal(normalizePhone("813.555.0100"), "+18135550100");
  assert.equal(normalizePhone("+1 252 538 9776"), "+12525389776"); // o-033b649-netsolhost-com
  assert.equal(normalizePhone("1-718-436-8883"), "+17184368883"); // o-100funusa-com
});

test("a field that is not one number is read, not stored as it stands", () => {
  assert.equal(normalizePhone("+1-304-725-6399; +1-703-309-2130"), "+13047256399"); // o-340defense-com
  assert.equal(normalizePhone("(928)%20649-8463"), "+19286498463"); // o-alcantaravineyard-com
  assert.equal(normalizePhone("+1-360-393-4106x102"), "+13603934106"); // o-aslanbrewing-com
});

test("a field with no number in it is no phone", () => {
  assert.equal(normalizePhone("//{{bizInfo.contact.phoneLocal}}"), null); // o-balmbeachgokarts-com
  assert.equal(normalizePhone("1-800-GAMBLER"), null); // o-clautiere-com, a winery
  assert.equal(normalizePhone("269204655747"), null); // o-captainmikesamusementpark-com
  assert.equal(normalizePhone("2147483647"), null); // the overflow a CMS writes where the phone should be
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
});
