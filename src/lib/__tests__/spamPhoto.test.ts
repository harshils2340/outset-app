import assert from "node:assert/strict";
import test from "node:test";
import { keepRealPhotos, spamImageUrl } from "../spamPhoto";

/**
 * 68 shipped listings carry 147 of these addresses, 53 of them as the cover: the one image on the browse card
 * and at the top of the listing's own page. Each address below is one of them, named with the business whose
 * card it leads. The backend's sync screen is the durable half; this is what keeps them off the screen before
 * the next sync, the same division `deadCovers.ts` keeps.
 */
const SHIPPED = [
  ["https://togel-hongkong.cc/img/bannerlottohk1.webp", "Birth Place of the Republican Party, Ripon, WI"],
  ["https://manggis.lol/assets/img/satset138-maxwin.webp", "Salida Golf Club, Salida, CO"],
  ["https://photoku.io/images/2025/06/12/600-bandar-togel.jpeg", "Timberview Golf Club, Marysville, OH"],
  ["https://images-indosattoto.com/Bandar-Slot-Gacor.png", "Astoria World Manor, New York, NY"],
  ["https://dhawansuits.com/img/slot-gacor.webp", "Beauregard Museum, DeRidder, LA"],
  ["https://www.kinodrive.me/gacor77-terpercaya.webp?v=1757450054&width=823", "The Art of Health, Arlington, VA"],
  ["https://pub-3d3eadba441e4ab391727644675b0aaf.r2.dev/SitusTotoTogelHits.jpg", "The Bulleit Frontier Whiskey Experience"],
  ["https://www.onevirginia2021foundation.org/index_assets/images/dewislot88-banner_lg2.png", "Cliff House, Dallas, TX"],
  ["https://img-air.b-cdn.net/Airtogel/gacor/kagamixairtogel.png", "Caldwell County Museum, Austin, TX"],
  ["https://i.postimg.cc/2jXVn27F/olympus-slot88.webp", "Susky River Beverage Company, Perryville, MD"],
  ["https://creativeflowarttherapy.com/img/slot777-online.jpg", "Ross Hill Park Family Campground, Lisbon, CT"],
];

test("every gambling banner the sync published is refused", () => {
  for (const [url, who] of SHIPPED) assert.ok(spamImageUrl(url), who + " should not draw " + url);
});

/**
 * The rule reads a file name and a host, so it is held to word edges: a photograph of Judith, a file called
 * maxwindow.jpg and a slot of time in a booking widget's own URL are all photographs of a business.
 */
test("an operator's own photo address is left alone", () => {
  for (const url of [
    "https://saltyjetski.com/wp-content/uploads/2025/06/sunset-ride-1600x900.jpg",
    "https://images.squarespace-cdn.com/content/v1/abc/1680000000000-XYZ/judith-and-the-crew.jpg",
    "https://cdn.example.com/img/maxwindow-view.jpg",
    "https://fareharborcdn.com/media/i/1200x800/slot-picker-screenshot.png",
    "https://timberviewgolfclub.com/images/clubhouse-18th-green.jpg",
    "https://cdn.example.com/photos/judith.jpg",
  ]) {
    assert.ok(!spamImageUrl(url), url + " is a real photograph");
  }
});

test("keepRealPhotos keeps the order of what is left, and tolerates no list at all", () => {
  const out = keepRealPhotos(["https://a.example/one.jpg", "https://manggis.lol/assets/img/satset138-maxwin.webp", "https://a.example/two.jpg"]);
  assert.deepEqual(out, ["https://a.example/one.jpg", "https://a.example/two.jpg"]);
  assert.deepEqual(keepRealPhotos(undefined), []);
  assert.equal(spamImageUrl(undefined), false);
  assert.equal(spamImageUrl(""), false);
});

/**
 * And that the screen is actually read where records arrive, not only exported: `asPublished` is the one place
 * every surface's copy of a listing passes through, so a card, a rail, the hero, the lightbox, the photo count
 * and "Show all photos" all stop at the same answer.
 */
test("a record arriving from the catalog loses its casino banner and keeps its own photographs", async () => {
  const { experienceById, mergeCatalog } = await import("../catalog");
  const item = {
    id: "o-spamcover-test-example",
    title: "Timberview Golf Club",
    cat: "play",
    art: "golf",
    area: "Marysville, OH",
    src: "spamcover-test.example",
    lite: true,
    options: [],
    cover: "https://photoku.io/images/2025/06/12/600-bandar-togel.jpeg",
    photos: ["https://photoku.io/images/2025/06/12/600-bandar-togel.jpeg", "https://spamcover-test.example/18th-green.jpg"],
  } as unknown as import("../../data/types").Unclaimed;
  mergeCatalog([item], {});
  const got = experienceById("o-spamcover-test-example")!;
  assert.equal(got.cover, undefined);
  assert.deepEqual(got.photos, ["https://spamcover-test.example/18th-green.jpg"]);
});
