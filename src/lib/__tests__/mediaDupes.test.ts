/**
 * The same photograph, twice in one gallery.
 *
 * The hero and the lightbox deduplicated a listing's pictures on the exact URL string, and the crawl keeps every
 * spelling it saw: a site links one photograph under both schemes, with and without `www.`, and at whatever
 * widths its resizing CDN was asked for. 832 of the shipped listings showed one picture between two and eight
 * times, 657 of them inside the five tiles of the hero, so "Show all photos" promised nine and gave four.
 *
 * Every case below is a real listing in `public/o` and names the one it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { listingMedia, photoCandidates } from "../media";

const dir = new URL("../../../public/o/", import.meta.url);
const none = new Set<string>();
const shot = (cover: string | undefined, photos: string[]) =>
  listingMedia({ cover, photos, video: undefined, videoEmbed: undefined } as never, none).map((m) => m.src);

test("one photograph linked under two schemes is one tile", () => {
  // o-360elitearenaofarlington-com
  const https = "https://360elitearenaofarlington.com/wp-content/uploads/2021/08/SlideShow2.png";
  const http = "http://360elitearenaofarlington.com/wp-content/uploads/2021/08/SlideShow2.png";
  assert.deepEqual(shot(https, [https, http]), [https]);
});

test("one photograph linked with and without www is one tile", () => {
  // o-allev8massagetherapy-com
  const www = "https://www.allev8massagetherapy.com/images/ultimateMassage.jpg";
  const bare = "https://allev8massagetherapy.com/images/ultimateMassage.jpg";
  assert.deepEqual(shot(www, [www, bare]), [www]);
});

test("one photograph asked for at three sizes is one tile", () => {
  // o-aahs50-wordpress-com
  const base = "https://aahs50.wordpress.com/wp-content/uploads/2010/09/kumlien-hall-and-sheepskin-school-9-24-2010.jpg";
  assert.deepEqual(shot(base, [base, base + "?w=1280", base + "?w=640"]), [base]);
  // o-academyoflions-com: the Squarespace transform is a size, not a different picture.
  const sq = "https://images.squarespace-cdn.com/content/v1/5ad4c90e7e3c3ac23d00868e/d33aefa7-aaad-4dd1-9637-f20bd302e701/IMG_3072.JPG";
  assert.deepEqual(shot(sq + "?format=2500w", [sq + "?format=2500w", sq]), [sq + "?format=2500w"]);
});

test("the first spelling wins, so the cover the photo screen picked stays the cover", () => {
  const small = "https://6thsenseworld.com/a/Bonaventure-Cemetery-Tours-image-6.jpg?w=700&h=700&zoom=2";
  const big = "https://6thsenseworld.com/a/Bonaventure-Cemetery-Tours-image-6.jpg?w=1600&zoom=2";
  assert.deepEqual(shot(small, [small, big]), [small]);
  assert.deepEqual(shot(big, [big, small]), [big]);
});

test("a host that carries the image in its query keeps every photo", () => {
  // o-aberdeen-sd-us names the file in filePath=, and o-806guidingservice-com in url=. Folding the query away
  // there would collapse a whole gallery into one tile.
  const a = "https://www.aberdeen.sd.us/ImageRepository/Path?filePath=%2fDocuments%2f3O3Q6578.JPG";
  const b = "https://www.aberdeen.sd.us/ImageRepository/Path?filePath=%2fDocuments%2f3O3Q7031.JPG";
  assert.deepEqual(shot(a, [a, b]), [a, b]);
  const c = "https://www.806guidingservice.com/_next/image?url=https%3A%2F%2Fx%2Fone.jpg&w=1024&q=95";
  const d = "https://www.806guidingservice.com/_next/image?url=https%3A%2F%2Fx%2Ftwo.jpg&w=1024&q=95";
  assert.deepEqual(shot(c, [c, d]), [c, d]);
});

test("two different pictures in one directory are still two tiles", () => {
  const one = "https://example.com/photos/dock.jpg";
  const two = "https://example.com/photos/boat.jpg";
  assert.deepEqual(shot(one, [one, two]), [one, two]);
});

test("a photo the page found broken still drops out, whichever spelling it was", () => {
  const https = "https://x.example/p/a.jpg";
  const http = "http://x.example/p/a.jpg";
  const other = "https://x.example/p/b.jpg";
  const media = listingMedia({ cover: https, photos: [https, http, other], video: undefined, videoEmbed: undefined } as never, new Set([https]));
  assert.deepEqual(media.map((m) => m.src), [http, other]);
});

test("what is probed is what the hero renders, in the same order", () => {
  const base = "https://x.example/p/a.jpg";
  const item = { cover: base, photos: [base, base + "?w=200", "https://x.example/p/b.jpg"] };
  assert.deepEqual(photoCandidates(item as never), shot(base, item.photos));
});

test("no shipped listing shows one picture twice", () => {
  const repeats: string[] = [];
  for (const f of readdirSync(dir)) {
    let item: { id?: string; cover?: string; photos?: string[] };
    try {
      item = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as typeof item;
    } catch {
      continue;
    }
    const srcs = shot(item.cover, item.photos || []);
    // Two tiles are the same picture when they reach the same file: same host bar `www.`, same path, and the
    // query set aside once the path names the file.
    const files = srcs.map((s) => {
      try {
        const u = new URL(s);
        const p = u.pathname.replace(/\/+$/, "");
        return u.hostname.toLowerCase().replace(/^www\./, "") + p + (/\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(p) ? "" : u.search);
      } catch {
        return s;
      }
    });
    if (new Set(files).size !== files.length) repeats.push(item.id || f);
  }
  assert.deepEqual(repeats.slice(0, 10), [], repeats.length + " listings still repeat a picture in the hero");
});
