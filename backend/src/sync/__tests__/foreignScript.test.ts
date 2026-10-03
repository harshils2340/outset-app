import { test } from "node:test";
import assert from "node:assert/strict";
import { foreignScriptCompromised } from "../contacts.ts";

/**
 * The decision `toCatalogItem` makes when a crawled fact carries a long run of a script the rest of the
 * listing never uses. The regex itself is covered by compromisedText.test.ts; this is the rule around it,
 * which had no test and which published a hacked page as a Wyoming museum's own menu.
 */

/** The hacked listing, as the 23 September sync published it: two rows, both Arabic, no English anywhere. */
const WRIGHT_ROWS = [
  "Pontoon (البريطاني) ",
  "Pontoon (البريطاني) الفروق بين الكلاسيكي والأوروبي صغيرة لكنها حقيقية. الكلاسيكي أسهل وأكثر شفافية، الأوروبي يقدّم ميزة كازينو أقل قليلًا. للمبتدئ، الكلاسيكي",
];

test("a menu whose every row is in a script the listing never uses is the hack's", () => {
  const why = foreignScriptCompromised([], WRIGHT_ROWS);
  assert.equal(why, "every row of the crawled menu is in a script the rest of the listing never uses");
});

test("a bilingual operator who states their own language too keeps their menu", () => {
  // Kailua Beach Adventures: 18 of 44 rows name the tour in Japanese as well, the rest are its English menu.
  const rows = [
    "Guided Kayak Tour 2 hours with a guide, all gear included",
    "2時間ガイド付きカヤックツアー ",
    "Self Guided Kayak Tour Take the kayak out on your own",
    "セルフガイドカヤックツアー（ガイドなし）(SGKT) ",
  ];
  assert.equal(foreignScriptCompromised([], rows), null);
});

test("a run isolated to one place is still the hack's", () => {
  const facts = ["Please arrive fifteen minutes before your start time", "欢迎光临本站，我们提供最优质的服务与最全面的资讯内容每日更新不断"];
  assert.equal(foreignScriptCompromised(facts, ["Sunset Cruise 2 hours"]), "an isolated run of a script the rest of the listing never uses");
});

test("the same script in more than one of an operator's own facts is their second language", () => {
  const facts = [
    "インストラクターは日本語でも指導いたしますのでご安心ください",
    "体験レッスンのご予約はお電話またはウェブサイトからお願いします",
  ];
  assert.equal(foreignScriptCompromised(facts, ["Beginner Class 60 minutes"]), null);
});

test("a listing with nothing foreign anywhere is not quarantined, and an empty menu is not a whole menu", () => {
  assert.equal(foreignScriptCompromised(["Bring a towel and sunscreen"], ["Jet Ski Rental 1 hour"]), null);
  assert.equal(foreignScriptCompromised([], []), null);
  assert.equal(foreignScriptCompromised(["Bring a towel"], []), null);
});
