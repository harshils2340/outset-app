/**
 * Which dollar a guest is told they are paying.
 *
 * A listing is priced, charged and paid out in its own country's dollars. `currencyForArea` in
 * `backend/src/payments/money.ts` reads the listing's area line and sends every booking at a Canadian
 * address to Stripe as CAD, and the booking email that follows writes it that way: `fmtMoney` in
 * `backend/src/lib/emailTemplate.ts` prints "CA$135.00".
 *
 * Every screen in between wrote a bare "$". So a guest at a Canadian shop read "Total $135" in the booking
 * box, met "CA$135" in Stripe's own card form a second later, and read "CA$135.00" again in the email: three
 * spellings of one charge, and the only one the guest chose from was the one that did not say which dollar.
 * 5,153 shipped listings are Canadian, and six metros (Detroit, Niagara, Vancouver, Victoria, Montreal,
 * Ottawa) carry shops on both sides of the border, so the two dollars sit side by side in one list.
 *
 * The label goes on the money a guest is told they will be charged, and nowhere else: a card's "from" price
 * is an indication, not a charge, and stays as it is.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { money, moneyIn } from "../format";
import { countryOfArea } from "../../data/regions";
import { currencyForArea } from "../../../backend/src/payments/money";

const dir = new URL("../../../public/o/", import.meta.url);
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("a Canadian figure names its dollar and an American one is left alone", () => {
  assert.equal(moneyIn(135, "CA"), "CA$135");
  assert.equal(moneyIn(135, "US"), "$135");
  assert.equal(moneyIn(135, "US"), money(135));
  // Cents and thousands are the same rule as before: the label is the only thing added.
  assert.equal(moneyIn(7.5, "CA"), "CA$7.50");
  assert.equal(moneyIn(10094.12, "CA"), "CA$10,094.12");
  assert.equal(moneyIn(0, "CA"), "CA$0");
});

test("the screen spells the charge the way the email that follows it does", () => {
  // fmtMoney in backend/src/lib/emailTemplate.ts: "CA$135.00". An email always shows cents; a screen only
  // shows them when there are any. What has to agree is the currency in front of the figure.
  for (const n of [135, 7.5, 10094.12]) {
    assert.ok(moneyIn(n, "CA").startsWith("CA$"), n + " on screen");
    assert.ok(!moneyIn(n, "US").startsWith("CA$"), n + " in US dollars");
  }
});

test("the app and the server read the same dollar out of the same area line", () => {
  // The guest's screen picks the label from `countryOfArea` and the server picks the Stripe currency from
  // `currencyForArea`. They are two readers of one field: if they ever disagreed, a guest would be told one
  // dollar and charged the other. Held against every area line the catalog ships.
  const seen = new Set<string>();
  let checked = 0;
  let canadian = 0;
  for (const f of readdirSync(dir)) {
    const area = (JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { area?: string }).area;
    if (typeof area !== "string" || seen.has(area)) continue;
    seen.add(area);
    checked++;
    const label = countryOfArea(area);
    const charged = currencyForArea(area);
    if (label === "CA") canadian++;
    assert.equal(label === "CA" ? "cad" : "usd", charged, area);
  }
  assert.ok(checked > 5000, "only " + checked + " distinct area lines read");
  assert.ok(canadian > 0, "no Canadian area line in the catalog at all, which means the read stopped working");
});

/**
 * The four blocks that state what a guest will be charged, held to the labelled formatter. A bare `money(`
 * in one of them is the bug this test exists for: it would read "$135" over a charge of CA$135.
 */
test("every screen that states the charge uses the labelled formatter", () => {
  const blocks: [string, string, string][] = [
    // file, first line of the block, last line of the block
    ["../../components/booking/Sheets.tsx", "    const cta = !guestOk", '<h2>Who\'s booking</h2>'],
    ["../../components/web/WebListing.tsx", '{sending ? "Sending…"', '<p className="alfine">\n                  {instant ?'],
    ["../../components/web/WebConfirm.tsx", '<h3>Price details</h3>', '<p className="alfine">{booking.paid'],
    ["../../components/booking/ConfirmView.tsx", '<span>{b.paid ? "Paid"', "</div>\n        </div>"],
  ];
  for (const [file, from, to] of blocks) {
    const text = src(file);
    const a = text.indexOf(from);
    const b = text.indexOf(to, a);
    assert.ok(a >= 0, "block start not found in " + file);
    assert.ok(b > a, "block end not found in " + file);
    const block = text.slice(a, b);
    assert.ok(block.includes("moneyIn("), file + " states a charge without the labelled formatter");
    assert.ok(!/[^a-zA-Z]money\(/.test(block), file + " still writes a bare money() over a charge");
  }
});
