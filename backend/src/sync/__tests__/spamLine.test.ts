import { test } from "node:test";
import assert from "node:assert/strict";
import { SPAM_LINE } from "../contacts.ts";

/**
 * 97 published listings, museums and golf courses among them, carried Indonesian gambling SEO spam as their
 * blurb, and 12 more had it as their cover photo, because the operator's own site had been hacked and the crawl
 * read the injected page straight through. Each line below is a shortened published blurb.
 */
test("gambling SEO spam injected into a hacked page is recognised", () => {
  for (const line of [
    "MAXSLOT88 adalah situs SLOT777 dan platform slot gacor yang menyediakan akses ke link slot88 resmi",
    "Dalam dunia perjudian daring, slot gacor hari ini game selalu menjadi favorit yang tak pernah mati.",
    "RTP Slot menjadi informasi paling penting yang wajib digunakan oleh bettor ketika bermain judi slot",
    "Sbobet login adalah situs judi bola online terpercaya di asia.",
    "Result pengeluaran sgp serta keluaran sgp hari ini sekarang sudah berubah menjadi togel favorit",
    "Demo Slot Bonanza 1000 Pragmatic Play merupakan fasilitas simulasi ideal bagi para peminat mesin virtual.",
    "Raih maxwin harian bersama COLOKSGP bandar slot online gacor maxwin terpercaya 2026.",
    "https://gapics.com/uploads/gambargacor/slotgacor.webp",
    "https://photoku.io/images/2025/06/12/600-bandar-togel.jpeg",
  ]) {
    assert.equal(SPAM_LINE.test(line), true, line + " should be recognised as spam");
  }
});

/**
 * A gambling brand name reads as spam regardless of which language the hacked page wrote around it: a brand
 * is never a real tour operator's own word. Martin & Sue King Railroad Museum's blurb was replaced outright by
 * Turkish Mostbet marketing; 17 Frost Gallery's by the English equivalent. Neither mentions "casino" three
 * times tightly enough for `hasRepeatedSuspectWord`, so the brand name itself is what has to catch them.
 */
test("a gambling brand name in a hacked page's own language is recognised as spam", () => {
  for (const line of [
    "Mostbet, Türkiye’de lisanslı ve güvenilir bir çevrim içi casino platformu olarak faaliyet göstermektedir.",
    "Mostbet gives Bangladeshi players rapid entry to sports wagering and online casino fun.",
  ]) {
    assert.equal(SPAM_LINE.test(line), true, line + " should be recognised as spam");
  }
});

/**
 * America's Center Convention Complex in St. Louis genuinely has a bowling alley named "Pin-Up Bowl", so a
 * betting-brand screen cannot fire on "pin-up" or "pinup" alone, only on brand names that never double as a
 * real venue's own name.
 */
test("a real venue named for something else is left alone", () => {
  assert.equal(SPAM_LINE.test("Pin-Up Bowl"), false);
});

test("an operator's own words about a real booking slot are left alone", () => {
  for (const line of [
    "Book your slot online, and you'll get a confirmation email with directions.",
    "Book your time slot online and enjoy limitless access to the farm.",
    "Enjoy access to the farm and all our activities on your chosen day and time slot.",
    "A two hour rental, kayak or paddleboard, launches from the marina every hour on the hour.",
  ]) {
    assert.equal(SPAM_LINE.test(line), false, line + " should not be flagged");
  }
});
