import assert from "node:assert/strict";
import test from "node:test";

import { dialPhone, displayPhone } from "../phone";
import { fmtPhone, telHref } from "../catalog";

/**
 * The number a guest taps to call the shop. Every string below is a real contact phone from public/o, named by
 * the listing that publishes it, and each one failed on the old reader: it stripped everything but digits and a
 * plus, so whatever the field held was dialled.
 */

test("two numbers in one field dial the first, not both glued together", () => {
  // The old link was tel:+13047256399+17033092130, which dials nobody.
  assert.equal(dialPhone("+1-304-725-6399; +1-703-309-2130"), "+13047256399"); // o-340defense-com
  assert.equal(dialPhone("+1-718-975-2748;+1-718-714-7270"), "+17189752748"); // o-adventurerspark-com
  assert.equal(dialPhone("+1 301 981 3279;+1 301 981 4109;+1 301 981 5663"), "+13019813279"); // o-andrewsfss-com
  assert.equal(dialPhone("(925) 376-2337 (Moraga), (925) 854-2725 (Danville)"), "+19253762337"); // o-canyonclub-works
  assert.equal(displayPhone("+1 740-998-2179; +1 740-998-2278"), "(740) 998-2179"); // o-35raceway-com
});

test("an extension is printed for the guest, never dialled onto the end of the number", () => {
  // tel:+13603934106102 is not a number. The desk to ask for belongs beside it, not inside it.
  assert.equal(dialPhone("+1-360-393-4106x102"), "+13603934106"); // o-aslanbrewing-com
  assert.equal(displayPhone("+1-360-393-4106x102"), "(360) 393-4106 ext. 102");
  assert.equal(dialPhone("(713) 752-0314 ext. 301"), "+17137520314"); // o-buffalobayou-org
  assert.equal(displayPhone("(615) 370-3471 ext. 12122"), "(615) 370-3471 ext. 12122"); // o-wcparksandrec-com
  assert.equal(dialPhone("+1-715-685-7840 ext. 1620"), "+17156857840"); // o-badriver-nsn-gov
});

test("a tel: link the crawl never decoded is read, not dialled as digits", () => {
  // %20 became the digits 2 and 0: tel:+1928206498463.
  assert.equal(dialPhone("(928)%20649-8463"), "+19286498463"); // o-alcantaravineyard-com
  assert.equal(dialPhone("%28360%29%20621-4682"), "+13606214682"); // o-aglyachtsales-com
  assert.equal(dialPhone("+1%20816-701-9642"), "+18167019642"); // o-trueloveyogakc-com
  // A zero width space between the digits, encoded, which added 2808 to the middle of the number.
  assert.equal(dialPhone("+16477936%E2%80%8B410"), "+16477936410"); // o-batlgrounds-com
  assert.equal(dialPhone("100% fun"), null);
});

test("what is not a number at all offers no call", () => {
  assert.equal(dialPhone("//{{bizInfo.contact.phoneLocal}}"), null); // o-balmbeachgokarts-com
  assert.equal(dialPhone("+1 ("), null); // o-capecodballoons-com
  assert.equal(dialPhone("269204655747"), null); // o-captainmikesamusementpark-com
  assert.equal(dialPhone("123-456-7890"), null); // o-broadwaymassage-wixsite-com, the theme's own placeholder
  assert.equal(dialPhone("(934) 098-1259"), null); // o-gplace-chijertlsmxhpikrk9ehid75phe, an exchange starting 0
  assert.equal(dialPhone("2147483647"), null); // the overflowed integer a CMS writes for "no phone"
  assert.equal(dialPhone(""), null);
  assert.equal(dialPhone(null), null);
});

test("a vanity number is not spelled out, because one of them is the gambling helpline", () => {
  // o-clautiere-com, a winery, publishes "1-800-GAMBLER" as its phone. A keypad would happily dial it.
  assert.equal(dialPhone("1-800-GAMBLER"), null);
  assert.equal(dialPhone("(603) 257-BOAT"), null); // o-winniwatersports-com
  assert.equal(dialPhone("418.827.GOLF"), null); // o-legrandvallon-com
});

test("a number published with its own country code keeps it, and one without is not assumed to be ours", () => {
  assert.equal(dialPhone("+62-812-5326-1536"), "+6281253261536"); // o-adventusclub-com
  assert.equal(displayPhone("+62-812-5326-1536"), "+62-812-5326-1536");
  assert.equal(dialPhone("+34 648226286"), "+34648226286"); // o-civitatis-com
  assert.equal(dialPhone("02073971010"), null); // o-brewdog-com, a London number that is not +1 anything
});

test("the ordinary numbers the other 36,680 listings publish are unchanged", () => {
  assert.equal(dialPhone("+16075926226"), "+16075926226"); // o-1000islandexcursions-com
  assert.equal(dialPhone("+1 252 538 9776"), "+12525389776"); // o-033b649-netsolhost-com
  assert.equal(dialPhone("+1-718-436-8883"), "+17184368883"); // o-100funusa-com
  assert.equal(dialPhone("(813) 555-0100"), "+18135550100");
  assert.equal(dialPhone("8135550100"), "+18135550100");
  assert.equal(displayPhone("+16075926226"), "(607) 592-6226");
  assert.equal(fmtPhone("+1 252 538 9776"), "(252) 538-9776");
  assert.equal(telHref("+1 252 538 9776"), "tel:+12525389776");
});

test("the page is told there is no call to offer, rather than given a broken link", () => {
  assert.equal(telHref("1-800-GAMBLER"), null);
  assert.equal(telHref("//{{bizInfo.contact.phoneLocal}}"), null);
  // A guest's own typed number is echoed back as they typed it when we cannot read it.
  assert.equal(fmtPhone("555-1234"), "555-1234");
});
