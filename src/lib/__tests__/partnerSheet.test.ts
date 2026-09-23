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
 * All 1,873 partner rows in the shipped catalog hit all four: none of them carries requirements, policies or a
 * cancellation line today. The desktop listing page builds no Things to know columns at all for one of these
 * (`knowCols` stays empty), so this is the phone agreeing with it.
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

test("every partner row in the shipped catalog is one of the rows this was wrong about", () => {
  const dir = new URL("../../../public/o/", import.meta.url);
  let partners = 0;
  let bare = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let item: { affiliate?: unknown; requirements?: string[]; policies?: string[]; cancellation?: string; waiverUrl?: string; bring?: string[]; groupInfo?: string[] };
    try {
      item = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    } catch {
      continue;
    }
    if (!item.affiliate) continue;
    partners++;
    if (!item.requirements?.length && !item.policies?.length && !item.cancellation && !item.waiverUrl && !item.bring?.length && !item.groupInfo?.length) bare++;
  }
  assert.ok(partners > 1000, "partner rows shipped: " + partners);
  assert.equal(bare, partners, "every one of them states none of Things to know, so every one drew the three contact rows");
});
