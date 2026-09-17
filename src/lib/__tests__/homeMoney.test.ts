import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { splitBooking } from "../../../backend/src/payments/money";
import { dateKey, startOfToday } from "../dates";
import { bookingPayout, bookingTotal, completedLately, onTheBooks, payoutSum, type OpBooking } from "../operator";
import { serviceFee, subtotalFromTotal } from "../pricing";

/**
 * The two money tiles on the dashboard's Home page, which is the screen an owner opens first.
 *
 * A booking's `total` is what the guest paid: the operator's price plus the guest's stepped service fee.
 * What the operator receives is that price less Outset's 5%, which is the number their booking email prints
 * as "You receive" and the number the Payouts page shows. Home summed the guest totals instead, so a $29 per
 * head sail for four read "$121 on the books" beside an email promising $110.20, and it counted a trip
 * completed today in both tiles at once, and it counted the demo's sample rows as money the Payouts page has
 * always said was zero.
 */

const at = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return dateKey(x);
};

const bk = (over: Partial<OpBooking> = {}): OpBooking => ({
  id: "b" + (over.code || "1"),
  code: "OS-1000",
  guest: "Mia",
  service: "Sunset sail",
  variant: "2 hours",
  price: null,
  qty: 4,
  total: 121,
  date: dateKey(startOfToday()),
  slot: "16:00",
  status: "accepted",
  created: Date.now(),
  source: "remote",
  ...over,
});

test("the guest total is not the operator's money", () => {
  // $29 a head for four is $116, the guest's fee on that is $5, so the card takes $121.
  assert.equal(serviceFee(116), 5);
  assert.equal(subtotalFromTotal(121), 116);
  // $121 is what the tile printed, and $110.20 is what the operator is actually sent.
  assert.equal(bookingTotal(bk()), 121);
  assert.equal(bookingPayout(bk()), 110.2);
});

test("a payout is the same cent the booking email promises", () => {
  for (let sub = 1; sub <= 2000; sub += 0.5) {
    const price = Math.round(sub * 100) / 100;
    const total = Math.round((price + serviceFee(price)) * 100) / 100;
    const server = splitBooking(total, "usd");
    assert.equal(Math.round(bookingPayout(bk({ total })) * 100), server.net, "payout on a $" + total + " total");
  }
});

test("an unpriced booking pays out nothing rather than a negative", () => {
  assert.equal(bookingPayout(bk({ total: null, price: null })), 0);
});

test("sample rows are never money, the way the Payouts page has always had it", () => {
  const rows = [bk({ total: 121 }), bk({ code: "OS-2", id: "b2", total: 1000, source: "sample" })];
  assert.equal(payoutSum(rows), 110.2);
  assert.equal(onTheBooks(rows).length, 1);
});

test("a sum of payouts is exact to the cent", () => {
  // 96.9 + 110.2 in floating point is 207.10000000000002, and money() would print that in full.
  const rows = [bk({ total: 106 }), bk({ code: "OS-2", id: "b2", total: 121 })];
  assert.equal(payoutSum(rows), 207.1);
});

test("a trip completed today is earned money, not money on the books", () => {
  const today = startOfToday();
  const rows = [
    bk({ code: "OS-1", id: "b1", date: at(today, 0), status: "completed" }),
    bk({ code: "OS-2", id: "b2", date: at(today, 0), status: "accepted" }),
  ];
  assert.deepEqual(onTheBooks(rows, today).map((b) => b.code), ["OS-2"]);
  assert.deepEqual(completedLately(rows, 30, today).map((b) => b.code), ["OS-1"]);
});

test("on the books is the next seven days, confirmed, and nothing else", () => {
  const today = startOfToday();
  const rows = [
    bk({ code: "OS-past", id: "b1", date: at(today, -1) }),
    bk({ code: "OS-today", id: "b2", date: at(today, 0) }),
    bk({ code: "OS-six", id: "b3", date: at(today, 6) }),
    bk({ code: "OS-seven", id: "b4", date: at(today, 7) }),
    bk({ code: "OS-new", id: "b5", date: at(today, 2), status: "new" }),
    bk({ code: "OS-cancelled", id: "b6", date: at(today, 2), status: "cancelled" }),
  ];
  assert.deepEqual(onTheBooks(rows, today).map((b) => b.code), ["OS-today", "OS-six"]);
});

test("completed money is the last 30 days and stops at today", () => {
  const today = startOfToday();
  const rows = [
    bk({ code: "OS-31", id: "b1", date: at(today, -31), status: "completed" }),
    bk({ code: "OS-30", id: "b2", date: at(today, -30), status: "completed" }),
    bk({ code: "OS-noshow", id: "b3", date: at(today, -2), status: "noshow" }),
    bk({ code: "OS-ahead", id: "b4", date: at(today, 1), status: "completed" }),
  ];
  assert.deepEqual(completedLately(rows, 30, today).map((b) => b.code), ["OS-30"]);
});

test("Home's money tiles and the Payouts tiles read the one payout rule", () => {
  const home = readFileSync(new URL("../../components/operator/OpHome.tsx", import.meta.url), "utf8");
  const pulse = home.slice(home.indexOf('className="ohpulse"'), home.indexOf("</div>", home.indexOf('className="ohpulse"')));
  assert.ok(pulse.includes("{money(weekTotal)}") && pulse.includes("{money(monthTotal)}"), "the two Home tiles moved");
  assert.ok(!/bookingTotal\s*\(/.test(home), "OpHome is showing an operator a guest total again");
  assert.ok(/weekTotal = payoutSum\(/.test(home) && /monthTotal = payoutSum\(/.test(home), "a Home tile stopped taking fees off");
  const more = readFileSync(new URL("../../components/operator/OpMore.tsx", import.meta.url), "utf8");
  assert.ok(/payoutOf = bookingPayout/.test(more), "the Payouts page has grown a second payout rule");
  assert.ok(/upcomingLocal = payoutSum\(/.test(more), "the Payouts page's confirmed tile stopped taking fees off");
});

/**
 * The price the API already recorded, against working it back out of the guest total.
 *
 * The service fee steps down at $100 and at $500 and stops at $25, so a total does not name one price: 600 of
 * the prices between $1 and $2,000 in cent steps share a total with a higher one, and the inverse returns the
 * higher. Every one of them is a booking the API priced and stored the price of, so nothing has to be guessed.
 */

test("a price the API recorded is read, not guessed back out of the total", () => {
  // $495.01 takes a 4% fee of $20, and $515.01 also comes off $500.01, whose 4% fee is $20 too.
  assert.equal(serviceFee(495.01), 20);
  assert.equal(subtotalFromTotal(515.01), 500.01);
  const guessed = bk({ total: 515.01, subtotal: null });
  const known = bk({ total: 515.01, subtotal: 495.01 });
  assert.equal(bookingPayout(guessed), 475.01);
  assert.equal(bookingPayout(known), 470.26);
  assert.equal(Math.round(bookingPayout(known) * 100), splitBooking(515.01, "usd", 495.01).net);
});

test("every price the API can record pays out the cent the transfer sends", () => {
  let checked = 0;
  for (let c = 9800; c <= 50100; c++) {
    const sub = c / 100;
    const total = Math.round((sub + serviceFee(sub)) * 100) / 100;
    if (Math.abs(subtotalFromTotal(total) - sub) < 0.001) continue;
    checked += 1;
    assert.equal(Math.round(bookingPayout(bk({ total, subtotal: sub })) * 100), splitBooking(total, "usd", sub).net, "payout on a $" + sub + " price");
  }
  // Every price whose total is shared is in this band: 99 of them just under $100, 501 just under $500.
  assert.equal(checked, 600);
});

test("a booking the API never priced still falls back to the total", () => {
  assert.equal(bookingPayout(bk({ total: 121, subtotal: null, source: "guest" })), 110.2);
  assert.equal(bookingPayout(bk({ total: 121, subtotal: undefined, source: "guest" })), 110.2);
});

test("the booking drawer's 'you receive' is what the operator receives", () => {
  const src = readFileSync(new URL("../../components/operator/OpBookings.tsx", import.meta.url), "utf8");
  const line = src.slice(src.indexOf("<small>Total</small>"), src.indexOf("</div>", src.indexOf("<small>Total</small>")));
  assert.ok(line.includes("you receive"), "the drawer's money line moved");
  assert.ok(line.includes("money(bookingPayout(b))"), "the drawer is promising the operator's price, not their payout");
  assert.ok(!line.includes("money(b.subtotal)"), "the drawer is promising the operator's price, not their payout");
});

test("the calendar's week total is the same money as Home's tile", () => {
  const src = readFileSync(new URL("../../components/operator/OpCalendar.tsx", import.meta.url), "utf8");
  assert.ok(/weekTotal = payoutSum\(/.test(src), "the calendar week total is back to summing guest totals");
  assert.ok(!/bookingTotal\s*\(/.test(src), "the calendar is showing an operator a guest total again");
  // Home's first tile links straight to this page, so the two have to name one number.
  assert.ok(/weekTotal \? <b>/.test(src), "the calendar prints a money figure when there is no money to print");
});
