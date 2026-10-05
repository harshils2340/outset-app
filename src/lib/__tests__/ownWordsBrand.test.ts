import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { notTheirWords, ownWords } from "../ownWords";
import { spamImageUrl } from "../spamPhoto";

/**
 * Two shipped museums describe themselves as an online casino, in a language the off-language screen cannot
 * read.
 *
 * The 4 October security sweep found six gambling brands hotlinking banners onto real businesses and added
 * them to the sync's screen and to `spamPhoto.ts`, so no casino picture is drawn any more. Two of those same
 * hacked pages also rewrote the words: 17 Frost Gallery's blurb is an English Mostbet pitch and the Martin &
 * Sue King Railroad Museum's is a Turkish one, and `offLanguageMarketing` only speaks Indonesian and Malay.
 * The sync would quarantine both, but no sync has run, and the detail file the app fetches when the page
 * opens is what a guest reads. So the page drew the shop's own photographs under a betting advert's copy.
 */

/** Both blurbs exactly as `public/o` ships them, trimmed to the sentence that names the brand. */
const SHIPPED = [
  [
    "17 Frost Gallery, Brooklyn, NY",
    "Mostbet gives Bangladeshi players rapid entry to sports wagering and online casino fun. Directly on the official site, members can wrap up registration in moments, open an account, and sign in to unlock their welcome rewards.",
  ],
  [
    "Martin & Sue King Railroad Museum, Cleveland, MS",
    "Mostbet, Türkiye’de lisanslı ve güvenilir bir çevrim içi casino platformu olarak faaliyet göstermektedir. 2009 yılından bu yana hizmet veren Mostbet, güncel giriş adresi ya da mobil uygulaması sayesinde oyuncularına pratik erişim imkânı sunar.",
  ],
] as const;

test("a blurb a hacked page rewrote into a betting advert is not the shop's words, whatever language it wrote in", () => {
  for (const [who, blurb] of SHIPPED) {
    assert.equal(notTheirWords(blurb), true, who + " should read as no description");
    assert.equal(ownWords(blurb), "", who + " should publish a gap rather than the advert");
  }
});

test("every brand the sweep found is caught in prose, not only in a banner address", () => {
  for (const brand of ["Mostbet", "1xBet", "Bettilt", "Melbet", "22Bet", "LeoVegas"]) {
    assert.equal(notTheirWords(`Welcome to ${brand}, the home of live sport and slots.`), true, brand + " should be refused");
  }
});

/**
 * Narrow on purpose, the same way the banner list is. A real venue writes "casino" about the one up the road,
 * and the brand names are held to a word edge so an ordinary sentence that happens to contain one is not a
 * casino either.
 */
test("a shop's own words about a real place are kept", () => {
  for (const real of [
    "Five minutes from the casino, with free parking and a shuttle to the strip.",
    "Our Vegas-themed escape room seats six.",
    "Ask about the Mostbetter package: two nights and a guided paddle.",
    "We run bets-and-brunch trivia on Sundays.",
    "A twenty-two bet minimum applies at the blackjack table on casino nights.",
  ]) {
    assert.equal(notTheirWords(real), false, real + " is the shop describing itself");
    assert.equal(ownWords(real), real);
  }
});

/**
 * And that the screen is read where records arrive, not only exported: `asPublished` in `catalog.ts` is the
 * one place every surface's copy of a listing passes through, so the listing page, the phone sheet, search and
 * Otto all stop at the same answer, and the shop's own photographs stay.
 */
test("a record arriving from a detail file loses the advert and keeps its photographs", async () => {
  const { experienceById, mergeCatalog } = await import("../catalog");
  const item = {
    id: "o-ownwordsbrand-test-example",
    title: "Martin & Sue King Railroad Museum",
    cat: "see",
    art: "museum",
    area: "Cleveland, MS",
    src: "ownwordsbrand-test.example",
    options: [],
    blurb: SHIPPED[1][1],
    cover: "https://ownwordsbrand-test.example/engine-house.jpg",
    photos: ["https://ownwordsbrand-test.example/engine-house.jpg"],
  } as unknown as import("../../data/types").Unclaimed;
  mergeCatalog([item], {});
  const got = experienceById("o-ownwordsbrand-test-example")!;
  assert.equal(got.blurb, "");
  assert.deepEqual(got.photos, ["https://ownwordsbrand-test.example/engine-house.jpg"]);
});

/**
 * Three files name these six brands: the sync's own screen, which is the durable one, the banner list beside
 * this file, and the prose list this test is about. A brand dropped from one of them is a page that reads
 * clean on one surface and not on the next, so the lists are held against each other here.
 */
test("the prose list, the banner list and the sync's screen name the same brands", () => {
  const BACKEND = readFileSync(new URL("../../../backend/src/sync/contacts.ts", import.meta.url), "utf8");
  for (const brand of ["mostbet", "1xbet", "bettilt", "melbet", "22bet", "leovegas"]) {
    assert.ok(notTheirWords("Play at " + brand + " today"), brand + " is missing from the prose list in ownWords.ts");
    assert.ok(spamImageUrl("https://example.com/" + brand + "-banner.png"), brand + " is missing from the banner list in spamPhoto.ts");
    assert.ok(BACKEND.includes(brand), brand + " is missing from the sync's screen in backend/src/sync/contacts.ts");
  }
});
