import { test } from "node:test";
import assert from "node:assert/strict";
import { hasHackedSpam, isSpamImageAddress } from "../contacts.ts";

/**
 * The cloud crawl's photo harvest is a crawled fact like any other, and it is the one the quarantine screen
 * never read: it arrives through `photoSidecar.ts` instead of the facts table, because the GitHub Actions
 * runners that do the crawling have no SQLite. Every address below is a cover or a gallery photo the 23
 * September sync actually published, under a real business's name.
 */
const SHIPPED_SPAM_PHOTOS = [
  "https://togel-hongkong.cc/img/bannerlottohk1.webp", // Birth Place of the Republican Party, Ripon, WI
  "https://togel-indonesia.net/img/fav.webp", // Market House Museum, Paducah, KY
  "https://imgstore.io/images/2026/09/03/600x600-TERJAMIN-MAXWIN.jpeg", // Monarch Pilates, Monterey, CA
  "https://manggis.lol/assets/img/satset138-maxwin.webp", // Salida Golf Club, Salida, CO
  "https://imagecloud.site/view/faker/lingtogel-togel.png", // Dance Studio of Maine South, Sanford, ME
  "https://imgstore.io/images/2025/10/10/bandar-togel-online.png", // Dogmaster Distillery, Columbia, MO
  "https://photoku.io/images/2025/06/12/600-bandar-togel.jpeg", // Timberview Golf Club, Marysville, OH
  "https://ik.imagekit.io/De4dLyS1nS/olbwin-kultivasi-puncak-togel.jpg", // Main Street Armory, Rochester, NY
  "https://i.postimg.cc/2jXVn27F/olympus-slot88.webp", // Susky River Beverage Company, Perryville, MD
  "https://carrefouratlantic.com/img/daftar-situs-togel.png", // The Puffin Gallery, Halifax, NS
  "https://firemensmuseum.com/wp-content/uploads/2025/11/peluang-ganjil-genap-togel-strategi.jpg.png", // New Bern Firemen's Museum
  "https://creativeflowarttherapy.com/img/slot777-online.jpg", // Ross Hill Park Family Campground, Lisbon, CT
  "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhWdM0/s600/pttogel-togel-online.webp", // Windsor Gymnastics, Windsor, VA
];

test("a photo address the cloud crawl harvested is screened like any other crawled fact", () => {
  for (const url of SHIPPED_SPAM_PHOTOS) {
    assert.equal(hasHackedSpam([], [], [url]), true, url + " should quarantine the operator");
  }
});

test("an operator's own photo addresses are left alone", () => {
  const ordinary = [
    "https://saltyjetski.com/wp-content/uploads/2025/06/sunset-ride-1600x900.jpg",
    "https://images.squarespace-cdn.com/content/v1/abc/1680000000000-XYZ/kayak-tour.jpg",
    "https://fareharborcdn.com/media/i/1200x800/pontoon-deck.jpeg",
    "https://cdn.timberviewgolfclub.com/images/clubhouse-18th-green.jpg",
  ];
  assert.equal(hasHackedSpam([], [], ordinary), false);
});

test("the three kinds of crawled thing are each enough on their own, and clean ones are not", () => {
  assert.equal(hasHackedSpam(["Situs slot gacor terpercaya deposit pulsa tanpa potongan"], [], []), true);
  assert.equal(hasHackedSpam([], ["Situs Slot Gacor Tour  "], []), true);
  assert.equal(hasHackedSpam([], [], ["https://example.com/bandar-togel-online.png"]), true);
  assert.equal(hasHackedSpam(["Please arrive fifteen minutes early"], ["Sunset Cruise 2 hours"], ["https://example.com/boat.jpg"]), false);
});

/**
 * The 123 of the 147 the prose screen could not see. SPAM_LINE joins every glued phrase with `\s?`, which
 * matches a space or nothing and never the hyphen a file name uses, and holds each behind a `\b` a glued host
 * name does not offer. The same list is read at load time by `src/lib/spamPhoto.ts`.
 */
test("a glued or hyphenated gambling banner in a file name is caught where the prose screen could not see it", () => {
  for (const url of [
    "https://images-indosattoto.com/Bandar-Slot-Gacor.png", // Astoria World Manor, New York, NY
    "https://dhawansuits.com/img/slot-gacor.webp", // Beauregard Museum, DeRidder, LA
    "https://www.kinodrive.me/gacor77-terpercaya.webp?v=1757450054&width=823", // The Art of Health, Arlington, VA
    "https://www.onevirginia2021foundation.org/index_assets/images/dewislot88-banner_lg2.png", // Cliff House, Dallas, TX
    "https://pub-3d3eadba441e4ab391727644675b0aaf.r2.dev/SitusTotoTogelHits.jpg", // The Bulleit Whiskey Experience
    "https://img-air.b-cdn.net/Airtogel/gacor/kagamixairtogel.png", // Caldwell County Museum, Austin, TX
    "https://liveresulttogel.pro/img/sliderpemudathegreat.webp", // Canadian River Brewing Co, Chickasha, OK
  ]) {
    assert.equal(isSpamImageAddress(url), true, url + " should be refused");
    assert.equal(hasHackedSpam([], [], [url]), true, url + " should quarantine the operator");
  }
});

test("an ordinary file name is not a casino", () => {
  for (const url of [
    "https://cdn.example.com/img/maxwindow-view.jpg",
    "https://cdn.example.com/photos/judith.jpg",
    "https://fareharborcdn.com/media/i/1200x800/slot-picker-screenshot.png",
    "https://timberviewgolfclub.com/images/clubhouse-18th-green.jpg",
  ]) {
    assert.equal(isSpamImageAddress(url), false, url + " is a real photograph");
  }
});
