import { test } from "node:test";
import assert from "node:assert/strict";
import { fullSize, publishableImage } from "../imageUrl.ts";

test("a developer's own machine is not an address a guest can load", () => {
  // All fifteen solidcore studios shipped with this as their cover; solidcore.com's own markup carries it.
  const solidcore = "http://localhost:3000/solidcore-studios.webp";
  assert.equal(publishableImage(solidcore), false);
  assert.equal(fullSize(solidcore), undefined);
  for (const u of [
    "http://127.0.0.1:8080/hero.jpg",
    "http://192.168.1.14/img/boat.jpg",
    "http://10.0.0.5/photos/kayak.png",
    "http://172.16.4.9/a.jpg",
    "http://0.0.0.0/a.jpg",
    "http://studio.local/hero.jpg",
    "http://staging.test/hero.jpg",
  ]) {
    assert.equal(publishableImage(u), false, u + " should be refused");
  }
});

test("a registrar's parking banner is not a photo of the business", () => {
  // 43 listings led with this one file, Land-O-Fun and a brewery among them.
  const parked = "https://static.hugedomains.com/images/hdv3-img/og_hugedomains.png";
  assert.equal(publishableImage(parked), false);
  assert.equal(fullSize(parked), undefined);
  for (const u of [
    "https://assets.squarespace.com/universal/images-v6/parking-page/backgrounds/img101-landscape.jpg", // Salt Spring Vineyards
    "http://sitecdn.com/nb/cdl/coming-soon.png", // Cheaha Brewing Company
    "https://sitecdn.com/nb/cdl/under-suspension.png", // Demented Brewing Company
    "https://bat.bing.com/action/0?ti=187144948", // a parked domain's tracking pixel
    "https://public.atom.com/story_images/og_cards/v3/nwflspeedway.com.png", // Northwest Florida Speedway
    "https://langleycurlingcentre.com/images/Development_-_COMING_SOON.png", // Langley Curling Centre
    "https://images.squarespace-cdn.com/content/v1/5dfa/7079/coming+soon.png", // South Asia Institute
  ]) {
    assert.equal(publishableImage(u), false, u + " should be refused");
  }
});

/**
 * A beacon is not a picture of a business. These all shipped as the `video` a listing leads its hero with,
 * under a "Video" badge, because the video fact was the one image no screen ever looked at.
 */
test("an analytics beacon, a spam filter's receipt and a layout spacer are not photos", () => {
  for (const u of [
    "https://pixel.wp.com/e.gif?c=site-not-found&u=https%3A//www.ajogolfcourse.com/&rand=0.084", // AJO Golf Course
    "https://pixel.wp.com/g.gif?blog=3276749&v=wpcom&host=ahlandance.com", // Ah Lan Dance
    "https://moderate15-v4.cleantalk.org/pixel/724cccfb2b9109ebe0a3181f19695a50.gif", // 868 Estate Vineyards
    "https://analytics.alpine.io/collect/p.gif",
    "https://zcsub-cmpzourl.maillist-manage.com/images/spacer.gif",
    "https://www.facebook.com/security/hsts-pixel.gif",
    "https://www.google.com/images/cleardot.gif",
    "http://applehillgolf.com/wp-content/plugins/soliloquy/assets/css/images/holder.gif", // Apple Hill Golf Course
    "https://aroundlakemurray.simplybook.me/v2/themes/assets/img/waiting.gif",
    "https://www.bushwoodgc.com/images/blank.gif?crc=4208392903", // Bushwood Golf Club
    "https://www.nissanpartsforyou.com/assets/images/grey.gif",
  ]) {
    assert.equal(publishableImage(u), false, u + " should be refused");
  }
});

test("a photograph is not a beacon because of what it is called or where it sits", () => {
  for (const u of [
    // A real photograph can be called white.png; only a solid-colour GIF is taken for a spacer.
    "https://www.liveactionsportfishing.com/wp-content/uploads/2024/09/white.png",
    "https://example.com/photos/pixelated-sunset.jpg",
    "https://example.com/tracks/trail-map-photo.jpg",
    "https://pixelperfectphoto.com/gallery/kayak.jpg",
    "https://example.com/collections/boats/one.jpg",
  ]) {
    assert.equal(publishableImage(u), true, u + " should be kept");
  }
});

test("an operator's own photo is left alone", () => {
  for (const u of [
    "https://cdn.prod.website-files.com/6617b9233975c2e1cdf0a7a6/68cabad4707e934792c3b411_SC_04_groupD_grey_0345.webp",
    "https://img.rezdy.com/PRODUCT_IMAGE/251142/1000007754_lg.jpg",
    "https://walleyedan.com/wp-content/uploads/women-fishing-walleyedan-guides-service.jpg.webp",
    "https://winetoursofsedona.com/wp-content/uploads/2022/01/scenic-tours-Sedona-1.jpg",
  ]) {
    assert.equal(publishableImage(u), true, u + " should be kept");
    assert.equal(fullSize(u), u);
  }
  // The Wix rewrite still happens, and a tiny variant is still dropped.
  assert.match(String(fullSize("https://static.wixstatic.com/media/abc~mv2.jpg")), /w_1600,h_1000/);
  assert.equal(fullSize("https://example.com/a.jpg?w=34"), undefined);
});

/** No address the app's own image proxy or a photo screen could ask for: an inline blob, not a fetch. */
test("an inline data or blob URL is never a published photo", () => {
  for (const u of [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    "blob:https://example.com/9f6a1c2e-2b0a-4f3a-9c1e-6a0b1c2d3e4f",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
  ]) {
    assert.equal(publishableImage(u), false, u + " should be refused");
  }
});

test("a private or carrier-NAT address, IPv6 loopback included, is refused", () => {
  for (const u of ["http://100.64.0.5/a.jpg", "http://100.100.1.1/a.jpg", "http://[::1]/a.jpg", "http://[fe80::1]/a.jpg", "http://[fd12::9]/a.jpg", "http://box.localhost/a.jpg"]) {
    assert.equal(publishableImage(u), false, u + " should be refused");
  }
  // A public IP that merely starts the same way as a private range stays published.
  for (const u of ["http://100.63.255.255/a.jpg", "http://100.128.0.1/a.jpg", "http://8.8.8.8/a.jpg"]) {
    assert.equal(publishableImage(u), true, u + " should be kept");
  }
});

/**
 * A stored photo can already be a wsrv.nl (images.weserv.nl) address when the operator's own site uses it as
 * their CDN. `errorredirect` sends a guest's browser to any URL the page names if the image fails to load: an
 * open redirect riding what looks like an ordinary image address. Only the parameters this codebase's own
 * wrapping (`src/lib/images.ts`, `backend/src/enrich/photoquality.ts`) ever sets are let through unexamined.
 */
test("a wsrv.nl address with an unrecognized query parameter is refused", () => {
  assert.equal(publishableImage("https://wsrv.nl/?url=example.com/a.jpg&errorredirect=https://evil.example/phish"), false);
  assert.equal(publishableImage("https://images.weserv.nl/?url=example.com/a.jpg&errorredirect=https://evil.example/phish"), false);
  // The plain, ordinary wrap this codebase itself produces stays published.
  assert.equal(publishableImage("https://wsrv.nl/?url=example.com%2Fa.jpg&w=800&output=webp&q=78"), true);
});
