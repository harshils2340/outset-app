import { test } from "node:test";
import assert from "node:assert/strict";
import { FOREIGN_SCRIPT_RUN, isCompromisedText, SPAM_LINE } from "../contacts.ts";

/**
 * The 16 September 2026 bug bash found gambling spam hacked onto 97 real operator sites and published as their
 * own words. `SPAM_LINE` caught the gambling phrases; `isCompromisedText` broadens the same screen to every
 * spam category a hacked WordPress page shows up as in practice, in whichever language the injected page used,
 * so a hack does not have to be about gambling specifically to be caught.
 */
test("gambling spam in languages beyond Indonesian is recognised", () => {
  for (const line of [
    "Casino en ligne argent réel, les meilleurs jeux de casino en ligne pour gagner gros.",
    "Casino online dinero real, apuestas deportivas online con los mejores bonos de bienvenida.",
    "Nhà cái uy tín nhất 2026, cá cược bóng đá trực tuyến với tỷ lệ kèo hấp dẫn nhất thị trường.",
    "Казино онлайн на реальные деньги, ставки на спорт с лучшими коэффициентами.",
    "Лучшая букмекерская контора для ставок на футбол и другие виды спорта.",
    "オンラインカジノで今すぐ登録、パチスロの無料デモをお楽しみください。",
    "澳门赌场官网入口，在线赌场老虎机游戏大奖等你来拿。",
  ]) {
    assert.equal(isCompromisedText(line), true, line + " should be recognised as gambling spam");
  }
});

test("counterfeit pharmacy spam is recognised", () => {
  for (const line of [
    "Buy Viagra online without a prescription, fast discreet shipping worldwide.",
    "Cheap generic Viagra online, lowest prices guaranteed on all orders.",
    "Order Xanax online no prescription needed, express delivery in 24 hours.",
    "Oxycodone for sale online, no prescription required, ship anywhere in the US.",
  ]) {
    assert.equal(isCompromisedText(line), true, line + " should be recognised as pharma spam");
  }
});

test("essay mill spam is recognised", () => {
  for (const line of [
    "Buy essays online from our professional essay writing service, plagiarism-free essays guaranteed.",
    "Write my paper for me, cheap and fast, our paper writing service never misses a deadline.",
    "Pay someone to write my essay tonight, our dissertation writing service is available 24/7.",
  ]) {
    assert.equal(isCompromisedText(line), true, line + " should be recognised as essay-mill spam");
  }
});

test("crypto and forex pump spam is recognised", () => {
  for (const line of [
    "Join our forex trading signals group and double your bitcoin in 48 hours, guaranteed daily profit.",
    "Our crypto trading bot delivers guaranteed weekly returns, no experience needed.",
    "Binary options trading made easy, sign up for free pip signals service today.",
  ]) {
    assert.equal(isCompromisedText(line), true, line + " should be recognised as crypto/forex spam");
  }
});

test("adult, replica-goods and loan spam are recognised", () => {
  for (const line of [
    "Watch the hottest XXX videos and live sex cams free, no signup required.",
    "Escorts near you tonight, browse verified profiles in your city.",
    "Shop the best AAA replica watches online, exact same look as the real Rolex.",
    "Get a payday loan online with no credit check, instant cash loans approved today.",
    "Bad credit loans guaranteed approval, same-day loan approval even with poor credit.",
  ]) {
    assert.equal(isCompromisedText(line), true, line + " should be recognised as spam");
  }
});

/**
 * FOREIGN_SCRIPT_RUN is deliberately not folded into isCompromisedText: whether a script mismatch is a hacked
 * page or a real bilingual listing depends on whether it is isolated to one fact, which only the operator-level
 * quarantine check in toCatalogItem can see (see spamCompromised there). The regex itself, on a single string
 * with no other context, is what this test covers.
 */
test("a long run of a script the field has no business carrying is recognised by FOREIGN_SCRIPT_RUN", () => {
  // A block of injected Chinese SEO text with no keyword this screen otherwise recognises.
  assert.equal(FOREIGN_SCRIPT_RUN.test("欢迎光临本站，我们提供最优质的服务与最全面的资讯内容每日更新不断"), true);
  // Cyrillic, same idea, no gambling keyword in it.
  assert.equal(FOREIGN_SCRIPT_RUN.test("Добро пожаловать на наш сайт с лучшими новостями каждый день"), true);
  // A short bilingual label a real tourism operator's own menu would carry stays under the run-length floor.
  assert.equal(FOREIGN_SCRIPT_RUN.test("1日パス、予約制"), false);
});

test("the same long phrase stuffed in many times is recognised even with no spam keyword", () => {
  const stuffed = "best local tour guide best local tour guide best local tour guide best local tour guide best local tour guide";
  assert.equal(isCompromisedText(stuffed), true);
});

/**
 * Every one of these is real, ordinary copy a US or Canada operator's own site would write. None of them
 * should ever quarantine a listing; a false positive here takes a real business's whole page down, not just
 * one line.
 */
test("near misses that must stay: a real operator's own words are left alone", () => {
  for (const line of [
    "Book your slot online, and you'll get a confirmation email with directions.",
    "Join us for Casino Night at the brewery every third Friday, complete with poker tables and prizes.",
    "Our historic pharmacy walking tour covers three centuries of medicine in downtown Charleston.",
    "Louez un kayak ou un paddle et profitez du lac toute la journée en famille.",
    "Reserve su kayak o tabla de remo y disfrute del lago todo el día en familia.",
    "The Adderall Falls trailhead is a local nickname for the overlook at mile marker four.",
    "Adults only after 6pm; children are welcome for our daytime sessions and birthday parties.",
    "We are a jet ski rental shop offering jet ski tours, jet ski rentals and jet ski lessons daily.",
    "A two hour rental, kayak or paddleboard, launches from the marina every hour on the hour.",
  ]) {
    assert.equal(isCompromisedText(line), false, line + " should not be flagged");
  }
});

/**
 * A first pass at the repeated-word signal flagged two real, unrelated businesses: "Casino Parties LLC", a
 * legitimate casino-theme party rental company, and an RV park whose own copy describes a real casino next
 * door ("4 Way Casino"). Neither repeats the word tightly (the same word again within a handful of words of
 * itself); real gambling-brand spam does. This is the near-miss that mattered most in the 16 Sept 2026 scan.
 */
test("a legitimate business named or sited around a casino is not flagged", () => {
  assert.equal(
    isCompromisedText(
      "Casino Parties LLC is Manhattan's premier casino party rental company, delivering authentic Vegas-style casino entertainment to corporate events.",
    ),
    false,
  );
  assert.equal(
    isCompromisedText(
      "4 Way Casino - The 4 Way Casino is a 4,500 square foot casino featuring all your favorite games including slots, blackjack, and game tables. The casino also offers a cafe. The 4 Way Casino is open 24 hours a day.",
    ),
    false,
  );
});

test("a run of different casino brand names packed together is still recognised", () => {
  assert.equal(isCompromisedText("888 casino pin up casino pin up casino pin up casino pin up casino herospin casino herospin"), true);
});

test("SPAM_LINE alone still catches the original gambling phrases (unchanged behaviour)", () => {
  assert.equal(SPAM_LINE.test("MAXSLOT88 adalah situs SLOT777 dan platform slot gacor"), true);
  assert.equal(SPAM_LINE.test("Book your slot online, and you'll get a confirmation email."), false);
});
