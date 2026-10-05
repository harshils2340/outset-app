import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hijackedMenu } from "../menuRow";

/**
 * One shipped listing's whole menu was written for a business that is not this one.
 *
 * Wright Centennial Museum in Wright, Wyoming publishes a single bookable row, "Pontoon (البريطاني)", with
 * Arabic prose about the house edge on a card game under it, and the page's own glossary then tells a guest
 * that "Pontoon" is "A flat, steady boat on two floats, good for relaxed groups". The sync's
 * `foreignScriptCompromised` quarantines the listing, but no sync has run, and what a guest reads when the
 * page opens is the detail file in `public/o`.
 *
 * The rule is the whole menu rather than one row, because two real Hawaii operators state some of their own
 * kayak trips in Japanese for their own guests and must keep them. Their English rows are the difference.
 */

const read = (id: string) => JSON.parse(readFileSync(new URL("../../../public/o/" + id + ".json", import.meta.url), "utf8"));

test("the one listing whose whole menu is in a script its own name and town are not", () => {
  assert.equal(hijackedMenu(read("o-wrightcentennialmuseum-org")), true);
});

test("an operator who writes part of their own menu in a second language keeps all of it", () => {
  for (const id of ["o-kailuabeachadventures-com", "o-heeiakeaharbor-com"]) {
    assert.equal(hijackedMenu(read(id)), false, id + " states its own trips in Japanese and means them");
  }
});

test("a shop with no menu at all is not hijacked, and neither is an ordinary one", () => {
  assert.equal(hijackedMenu({ title: "Salty Jet Ski", area: "Tampa, FL" }), false);
  assert.equal(hijackedMenu({ title: "Salty Jet Ski", area: "Tampa, FL", options: [], services: [] }), false);
  assert.equal(
    hijackedMenu({ title: "Salty Jet Ski", area: "Tampa, FL", options: [{ name: "Two hour ride" }], services: [{ name: "Two hour ride", desc: "Guided, two to a ski." }] }),
    false,
  );
});

/** A business whose own name is written in that script is a business, not a hacked page. */
test("a shop named in the same script as its menu keeps its menu", () => {
  assert.equal(hijackedMenu({ title: "カイルアカヤックセンター", area: "Honolulu, HI", options: [{ name: "セルフガイドカヤックツアー" }] }), false);
});

/**
 * And that the rule is read where records arrive, so the listing page, the booking box, the phone sheet, the
 * price filter and Otto all stop at the same answer rather than one of them drawing the row.
 */
test("the hijacked listing arrives with nothing to book and keeps its name and town", async () => {
  const { experienceById, mergeCatalog } = await import("../catalog");
  const raw = read("o-wrightcentennialmuseum-org");
  mergeCatalog([{ ...raw, id: "o-hijacked-test-example", src: "hijacked-test.example" } as never], {});
  const got = experienceById("o-hijacked-test-example")!;
  assert.deepEqual(got.options, []);
  assert.equal(got.services, undefined);
  assert.equal(got.title, "Wright Centennial Museum");
  assert.equal(got.area, "Wright, WY");
});
