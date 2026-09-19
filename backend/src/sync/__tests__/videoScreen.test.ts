/**
 * The clip a listing leads its hero with.
 *
 * `listingMedia` puts the video in front of every photo, in the biggest tile, under a "Video" badge. It was the
 * one image on a listing that no screen ever looked at: photos pass `cleanImageUrl`, `isPhotoName`, the photo
 * screen's verdicts and `fullSize`, and the video fact passed none of them. So 1,062 shipped listings led with
 * whatever the crawl happened to find, among them a WordPress.com beacon whose own query says
 * `c=site-not-found`, four CleanTalk spam-filter pixels, a PayPal Buy Now button, a Facebook login button, a
 * TripAdvisor badge, a Google Maps close icon, a golf scorecard, a course map and eleven spacer GIFs.
 *
 * Two holes, both closed: the sync published the fact unscreened, and the crawl accepted a GIF as a video
 * whenever the markup declared no size, which is exactly the shape of a beacon.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isPhotoName, keepScreened } from "../contacts.ts";
import { fullSize } from "../imageUrl.ts";
import { harvestVideos, type Video } from "../../enrich/imagescrape.ts";

/** The screen the sync now runs a video fact through, in the same order. */
const kept = (urls: string[]) => keepScreened(urls.filter((u) => (/\.gif(\?|$)/i.test(u) ? isPhotoName(u) : true)).filter((u) => !!fullSize(u)));

test("site furniture never becomes the clip that leads a hero", () => {
  const junk = [
    "https://pixel.wp.com/e.gif?c=site-not-found&u=https%3A//www.ajogolfcourse.com/",
    "https://moderate15-v4.cleantalk.org/pixel/724cccfb2b9109ebe0a3181f19695a50.gif",
    "https://zcsub-cmpzourl.maillist-manage.com/images/spacer.gif",
    "https://www.facebook.com/security/hsts-pixel.gif",
    "https://www.google.com/images/cleardot.gif",
    "https://www.paypalobjects.com/en_US/i/btn/btn_buynow_LG.gif",
    "https://www.blackheathgolfclub.com/wp-content/uploads/sites/8841/2023/05/course_layout.gif",
    "http://bretwoodgc.com/wp-content/uploads/2020/05/north-scorecard-map.gif",
    "http://localhost:3000/promo.mp4",
  ];
  assert.deepEqual(kept(junk), []);
});

test("the shop's own clip still leads the hero", () => {
  const real = [
    // A video file is not judged by the rules that read a photo's name: this one would read as page 1 of a
    // scanned booklet, and it is 7 Seas Brewing's own hero clip.
    "https://www.7seasbrewing.com/wp-content/uploads/7-Seas-Home-Page-1-1.mp4",
    "https://adventurebrewing.com/wp-content/uploads/2022/03/pepper-carolina-reaper-lss-dsc_6311.gif",
    "https://www.allinonecharters.com/wp-content/uploads/2019/09/20180521_215611-1.gif",
  ];
  assert.deepEqual(kept(real), real);
});

test("a beacon in front of a real clip costs the clip nothing", () => {
  // Every candidate is screened, not only the best-scoring one.
  const clip = "https://example.com/video/tour.mp4";
  assert.deepEqual(kept(["https://pixel.wp.com/g.gif?blog=1", clip]), [clip]);
});

const page = (body: string) => "<html><body>" + body + "</body></html>";
const harvest = (body: string) => {
  const seen = new Map<string, Video>();
  harvestVideos(page(body), "https://example.com/", seen);
  return [...seen.keys()];
};

test("a GIF with no declared size is not evidence of a video", () => {
  // `dims` answers 0 for an attribute that is not there, so a test written against a declared size passed
  // everything that declared none, which is every beacon ever written.
  assert.deepEqual(harvest('<img src="https://example.com/g.gif">'), []);
  assert.deepEqual(harvest('<img src="https://example.com/hero.gif" width="1200">'), []);
  assert.deepEqual(harvest('<img src="https://example.com/hero.gif" height="600">'), []);
});

test("a GIF big enough to stand in for a video still does", () => {
  assert.deepEqual(harvest('<img src="https://example.com/hero.gif" width="1200" height="600">'), ["https://example.com/hero.gif"]);
  // The size guard it already had is unchanged.
  assert.deepEqual(harvest('<img src="https://example.com/hero.gif" width="200" height="600">'), []);
  assert.deepEqual(harvest('<img src="https://example.com/hero.gif" width="1200" height="100">'), []);
});

test("a real video file is still read from the markup that declares it", () => {
  assert.deepEqual(harvest('<video src="https://example.com/tour.mp4"></video>'), ["https://example.com/tour.mp4"]);
});
