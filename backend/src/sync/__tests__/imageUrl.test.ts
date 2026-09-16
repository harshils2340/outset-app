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
