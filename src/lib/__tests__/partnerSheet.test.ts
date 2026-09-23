/**
 * What the phone booking sheet says about a partner's product that is not ours to say.
 *
 * An affiliate row is a product on Viator or Tiqets: no menu, no hours, no contact block, no policies, and
 * nothing about it is booked here. The sheet already knew that where it matters (the dates section, the reserve
 * bar and Otto's gate), but three places still drew it as a shop of ours:
 *
 * - "Hosted by Fraser Valley Social Wine Tasting Private Tour", which names a tour as its own host.
 * - "Who can go: Contact the business to check" and "Waiver and check-in: Contact the business to check", with
 *   no contact block on the sheet to do it from.
 * - "Contact Fraser Valley Social Wine Tasting Private Tour for their cancellation terms before you book",
 *   printed under the "Free cancellation" badge the same screen carries from the partner's own flag.
 *
 * All 1,873 partner rows shipped at the time hit all four: none of them carried requirements, policies or a
 * cancellation line, so the desktop listing page built no Things to know columns for one of these either, and
 * this was the phone agreeing with it. The 23 September detail pass gave 6,492 rows the partner's own text, so
 * both surfaces now draw the section, and the guards are what keep our contact wording out of it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SHEETS = read("../../components/booking/Sheets.tsx");
const WEB = read("../../components/web/WebListing.tsx");

test("the phone sheet knows a partner's product has no host of ours", () => {
  assert.match(SHEETS, /\{partnerLabel \? null : \(\s*<section className="airsec airhost">/, "the host block is drawn for a shop only");
  assert.doesNotMatch(WEB, /Hosted by/, "and the desktop page never drew one");
});

test("Things to know stays out when a partner's product states none of it", () => {
  assert.match(
    SHEETS,
    /const knowsAnything = !!\(requirements\.length \|\| item\.bring\?\.length \|\| item\.groupInfo\?\.length \|\| waiverLines\.length \|\| item\.waiverUrl \|\| item\.cancellation \|\| item\.policies\?\.length\);/,
  );
  assert.match(SHEETS, /\{!partnerLabel \|\| knowsAnything \? \(\s*<Section title="Things to know">/);
  // And the two rows that would otherwise send a guest to ring a product name.
  assert.match(SHEETS, /\{!partnerLabel \|\| requirements\.length \? \(/);
  assert.match(SHEETS, /\{!partnerLabel \|\| waiverLines\.length \|\| item\.waiverUrl \? \(/);
});

test("the cancellation row points at the partner rather than at a business nobody can ring", () => {
  assert.match(SHEETS, /partnerLabel\s*\?\s*"Stated on " \+ partnerLabel/, "the summary");
  assert.match(SHEETS, /\{partnerLabel\} states the cancellation terms on the page this books on\./, "the line under it");
  // The shop wording is still there for a shop, which is every listing that is not a partner's.
  assert.match(SHEETS, /Contact \{item\.title\} for their cancellation terms before you book\./);
});

/**
 * All 1,873 partner rows shipped when this was written stated none of Things to know, so every one of them hit
 * all four paths above. The 23 September detail pass changed that: 6,492 rows now carry the partner's own
 * requirements, inclusions and cancellation text, so the section is drawn and the guards are what keep the
 * contact wording out of it. The two surfaces are held to the same line either way.
 */
test("no shipped partner row is told to ring itself about anything", () => {
  const dir = new URL("../../../public/o/", import.meta.url);
  let partners = 0;
  let stating = 0;
  const contactable: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let item: { id?: string; affiliate?: unknown; requirements?: string[]; policies?: string[]; cancellation?: string; waiverUrl?: string; bring?: string[]; groupInfo?: string[] };
    try {
      item = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    } catch {
      continue;
    }
    if (!item.affiliate) continue;
    partners++;
    // `knowsAnything` on the sheet, and what decides whether the desktop page builds a column at all.
    const states = !!(item.requirements?.length || item.policies?.length || item.cancellation || item.waiverUrl || item.bring?.length || item.groupInfo?.length);
    if (states) stating++;
    // The three rows a guest could be sent to ring a product name from. Each is drawn only when the partner
    // states the thing it is about, so a row with nothing behind it is a row that should not be there.
    if (!states) continue;
    if (!item.requirements?.length && !item.cancellation && !item.policies?.length) contactable.push(item.id || f);
  }
  assert.ok(partners > 1000, "partner rows shipped: " + partners);
  assert.equal(stating, partners, partners - stating + " partner rows state none of Things to know, so the section stays out for them");
  assert.deepEqual(contactable.slice(0, 10), [], contactable.length + " partner rows draw Things to know with nothing of the partner's own in it");
});

test("the desktop page names the partner where it would otherwise name a business to contact", () => {
  assert.match(WEB, /const noCancelLine = affiliate \? affiliate\.label \+ " states the cancellation terms on the page this books on\." : "Contact the business for cancellation terms before you book\.";/);
  assert.match(WEB, /cancelLines\.length \? cancelLines : \[noCancelLine\]/);
});
