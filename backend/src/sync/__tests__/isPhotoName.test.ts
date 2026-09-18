import { test } from "node:test";
import assert from "node:assert/strict";
import { isPhotoName } from "../contacts.ts";

/**
 * 41 shipped photos, an escape room's cover among them, were a business's own logo rather than a photo of the
 * place: `isPhotoName` only ever looked at the last slash-separated segment of the address, so a logo sitting in
 * its own directory ("company/logo/id.png"), a CDN transform suffix pushed past the real name
 * ("logo%20biz.JPG/:/cr=t:0%25,..."), or a Next.js image proxy carrying the real address in its own query string
 * ("_next/image?url=%2Flogo.png") all read as an ordinary filename.
 */
test("a logo is refused wherever it sits in the address, not only in the last segment", () => {
  for (const url of [
    "https://cdn.saffire.com/images.ashx?t=ig&rid=ASMSyracuse&i=-LOGO(1).jpg&cb=C3F7B39E",
    "https://cmsv2-assets.apptegy.net/uploads/21317/logo/24131/4f5d3725-7e92-4141-9399-110ebebd3fe3.png",
    "https://fieldofscreams.com/assets/logos/medium/chainsaw-bar.jpg",
    "https://marshbeastairboattours.com/_next/image/?url=%2Fimages%2Fmarsh-beast-logo-title.webp&w=3840&q=75",
    "https://img1.wsimg.com/isteam/ip/0a61194a-2952-488b-8c15-2b25ea78eef3/logo%20biz.JPG/:/cr=t:0%25,l:0%25,w:100%25,h:100%25",
    "https://content.booqablecdn.com/uploads/8cfe39fdc7299d989891a5bc21aeadd8/company/logo/b4c23086-5896-4072-b7b8-9bd4c5ceff18/x(2).png",
    "https://s3.us-east-2.amazonaws.com/images.rentmy.co/store-logo/4145/tv607nl_1758296205_pvgztpm.png",
  ]) {
    assert.equal(isPhotoName(url), false, url + " should be refused as a logo");
  }
});

/**
 * A site running BotDetect answers a crawler with a CAPTCHA image. Its address has no file name at all
 * ("/.well-known/captcha/343/botdetect/?y=ipc:...&get=image"), so nothing in the name filters could see it, and
 * `get=image` in the query was enough to get it past the harvester's extension gate. Ten shipped listings have
 * one as their cover, among them a skydive centre, a yoga studio and two whale watching operators, and eleven
 * more carry one in the gallery. It is not a picture a guest could ever see either: the address is bound to the
 * crawler's own IP and a timestamp.
 */
test("a bot check served to the crawler is not a photograph", () => {
  for (const url of [
    "https://www.playemerge.com/.well-known/captcha/343/botdetect/?y=ipc:174.92.31.200:1788934905.46",
    "http://www.albertaskydivecentral.com/.well-known/captcha/565/botdetect/?y=err&get=image&c=bd_captcha",
    "https://bikramyogasanjose.com/.well-known/captcha/343/botdetect/?y=err&get=image&c=bd_captcha&t=6cb93330",
    "https://example.com/images/captcha.png",
    "https://example.com/captcha/challenge-8821.jpg",
  ]) {
    assert.equal(isPhotoName(url), false, url + " should be refused as a bot check");
  }
});

test("an ordinary photo, even from the same kind of address, is kept", () => {
  for (const url of [
    // "capt" is how half the fishing charters in the catalog name their own skipper.
    "https://reelscreamcharters.com/wp-content/uploads/2023/05/captain-mike-with-a-kingfish.jpg",
    "https://saltyducharters.com/images/capt-dave-and-the-boat.jpg",
    "https://mapleleafadventures.com/wp-content/uploads/2024/07/Desolation-Sound-Dan-Batchelor.jpg",
    "https://monticellogolfclub.org/wp-content/uploads/2024/07/283606155_10209581935342077_2598255781646961602_n.jpg",
    "https://res.cloudinary.com/letscamp/image/upload/c_fill,h_600,w_950/k9qbztqrihap4lihz3de?_a=BAMAPqkS0",
    "https://www.level99.com/_next/image?url=https%3A%2F%2Fstorage.googleapis.com%2Flevel99-images%2Fwebsite%2Ffood_and_beverage%2Fmktmenu---victory-.webp&w=1080&q=75",
    // "prologodesign.com" carries the letters of "logo" with no word of its own on either side.
    "https://prologodesign.com/photos/team-2024.jpg",
  ]) {
    assert.equal(isPhotoName(url), true, url + " should stay a photo");
  }
});
