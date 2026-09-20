import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLandingPages, type Item } from "../pages.ts";
import { writeListingPages } from "../listingPages.ts";

/**
 * A listing that earns a page: a photo plus something a guest acts on, which is what the generator requires. A
 * test about scope passes `options: []` and no reviews to mean "does not earn one".
 */
function item(id: string, extra: Partial<Item> = {}): Item {
  return { id, title: id, art: "cooking", area: "Toronto, ON", metroId: "toronto", options: [{ name: "Class", detail: "", price: 60 }], ...extra } as Item;
}

function run(items: Item[]) {
  const dir = mkdtempSync(join(tmpdir(), "outset-listing-pages-"));
  const landing = writeLandingPages(items, { publicDir: dir });
  const listing = writeListingPages(items, landing, { publicDir: dir });
  const files = readdirSync(join(dir, "l")).filter((f) => f.endsWith(".html")).sort();
  const read = (f: string) => readFileSync(join(dir, "l", f), "utf8");
  return { dir, landing, listing, files, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a page needs a photo and something to act on; unlisted never gets one", () => {
  const items: Item[] = [
    item("o-a", { cover: "https://x/a.jpg" }),
    item("o-b"), // no cover
    item("o-c", { cover: "https://x/c.jpg", unlisted: true } as Partial<Item>),
    // A photo and nothing else: it stays in the app, but a page of its own would be one more thin page among
    // thousands, which is what Google's scaled-content policy is for.
    item("o-d", { cover: "https://x/d.jpg", options: [] }),
    // Reviews are the other way to earn one: worth comparing even with no price published.
    item("o-e", { cover: "https://x/e.jpg", options: [], reviews: 40 } as Partial<Item>),
  ];
  const r = run(items);
  try {
    assert.deepEqual(r.files, ["o-a.html", "o-e.html"]);
    assert.equal(r.listing.pages, 2);
  } finally {
    r.cleanup();
  }
});

test("a rerun clears a listing page whose listing lost its cover or disappeared", () => {
  const r = run([item("o-a", { cover: "https://x/a.jpg" }), item("o-b", { cover: "https://x/b.jpg" })]);
  try {
    const landing2 = writeLandingPages([item("o-a", { cover: "https://x/a.jpg" })], { publicDir: r.dir });
    writeListingPages([item("o-a", { cover: "https://x/a.jpg" })], landing2, { publicDir: r.dir });
    const files = readdirSync(join(r.dir, "l")).filter((f) => f.endsWith(".html"));
    assert.deepEqual(files, ["o-a.html"]);
  } finally {
    r.cleanup();
  }
});

test("canonical, title, blurb, menu with prices, hours and requirements come only from the item's own fields", () => {
  const items: Item[] = [
    item("o-a", {
      title: "Pasta Night",
      area: "Toronto, ON",
      cover: "https://x/a.jpg",
      blurb: "Hands-on Italian cooking in a home kitchen.",
      services: [{ name: "Pasta class", desc: null, variants: [{ label: "3 hours", price: 95 }] }],
      hoursText: ["Tue-Sat 10am-6pm"],
      requirements: ["Closed-toe shoes required."],
      dur: "3 hours",
      rating: 4.9,
      reviews: 42,
    } as Partial<Item>),
  ];
  const r = run(items);
  try {
    const html = r.read("o-a.html");
    assert.match(html, /<link rel="canonical" href="https:\/\/onoutset\.com\/l\/o-a\.html">/);
    assert.match(html, /<title>Pasta Night in Toronto, ON · Outset<\/title>/);
    assert.match(html, /Hands-on Italian cooking in a home kitchen\./);
    assert.match(html, /<span>Pasta class<small>3 hours<\/small><\/span><span>\$95<\/span>/);
    assert.match(html, /Tue-Sat 10am-6pm/);
    assert.match(html, /Closed-toe shoes required\./);
    assert.match(html, /★ 4\.9 \(42 reviews\)/);
    // Never invented text for a fact the listing does not hold.
    assert.doesNotMatch(html, /not published/i);
    assert.doesNotMatch(html, /coming soon/i);
  } finally {
    r.cleanup();
  }
});

test("an unpriced option says 'Price on request', never an invented number", () => {
  // Reviews earn this one its page, so an option with no price is reached and has to say so honestly.
  const items: Item[] = [item("o-a", { cover: "https://x/a.jpg", reviews: 40, options: [{ name: "Sunset tour", detail: "2 hours", price: null }] } as Partial<Item>)];
  const r = run(items);
  try {
    const html = r.read("o-a.html");
    assert.match(html, /Price on request/);
    assert.doesNotMatch(html, /"offers"/);
  } finally {
    r.cleanup();
  }
});

test("JSON-LD carries only real facts: no aggregateRating or offers the listing never published", () => {
  // A page earned by reviews alone: no rating figure and no price anywhere in the file, so neither may appear.
  const items: Item[] = [item("o-a", { cover: "https://x/a.jpg", reviews: 40, options: [] } as Partial<Item>)];
  const r = run(items);
  try {
    const ld = JSON.parse(r.read("o-a.html").match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    assert.equal(ld["@type"], "LocalBusiness");
    assert.equal("aggregateRating" in ld, false);
    assert.equal("offers" in ld, false);
    assert.equal(ld.name, "o-a");
  } finally {
    r.cleanup();
  }
});

test("a business name with a script-closing sequence cannot break out of the JSON-LD tag", () => {
  // The title comes off the operator's own site; a hacked one could plant this. JSON.stringify alone would close
  // the <script> tag early and let the rest of the page parse as HTML.
  const items: Item[] = [item("o-a", { cover: "https://x/a.jpg", title: '</script><script>alert(1)</script>' } as Partial<Item>)];
  const r = run(items);
  try {
    const html = r.read("o-a.html");
    assert.doesNotMatch(html, /<script type="application\/ld\+json">[^]*?<\/script><script>alert/);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    assert.equal(ld.name, "</script><script>alert(1)</script>");
  } finally {
    r.cleanup();
  }
});

test("a kind the activity implies gets a more specific schema.org type; a guessed kind never does", () => {
  const items: Item[] = [
    item("o-golf", { art: "golf", cover: "https://x/a.jpg" }),
    item("o-guess", { art: "golf", cover: "https://x/b.jpg", kindUnconfirmed: true } as Partial<Item>),
  ];
  const r = run(items);
  try {
    const ldOf = (f: string) => JSON.parse(r.read(f).match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    assert.equal(ldOf("o-golf.html")["@type"], "GolfCourse");
    assert.equal(ldOf("o-guess.html")["@type"], "LocalBusiness");
  } finally {
    r.cleanup();
  }
});

test("links to the app view, the activity-and-city landing page when one exists, and the activity index otherwise, and to /p/index.html always", () => {
  const items: Item[] = [
    item("o-1", { cover: "https://x/1.jpg" }),
    item("o-2", { cover: "https://x/2.jpg" }),
    item("o-3", { cover: "https://x/3.jpg" }), // 3 in toronto clears MIN_METRO_LISTINGS
    item("o-4", { cover: "https://x/4.jpg", art: "kayak", metroId: null }), // never reaches a metro page
  ];
  const r = run(items);
  try {
    const html1 = r.read("o-1.html");
    assert.match(html1, /href="https:\/\/onoutset\.com\/#o=o-1"/);
    assert.match(html1, /href="https:\/\/onoutset\.com\/p\/cooking-in-toronto\.html"/);
    assert.match(html1, /href="https:\/\/onoutset\.com\/p\/index\.html"/);
    const html4 = r.read("o-4.html");
    assert.match(html4, /href="https:\/\/onoutset\.com\/p\/kayak-in-anywhere\.html"/);
  } finally {
    r.cleanup();
  }
});

test("a listing whose kind was only guessed links to no activity landing page, since none was ever built for it", () => {
  const items: Item[] = [item("o-1", { cover: "https://x/1.jpg", art: "golf", kindUnconfirmed: true } as Partial<Item>)];
  const r = run(items);
  try {
    const html = r.read("o-1.html");
    assert.doesNotMatch(html, /golf-in-/);
  } finally {
    r.cleanup();
  }
});

test("every listing page written is under the byte budget the whole catalog needs to fit under 300 MB, and every internal link points at a file this run wrote", () => {
  const items: Item[] = [
    item("o-1", {
      cover: "https://x/1.jpg",
      blurb: "A short, honest description of the business.",
      services: Array.from({ length: 20 }, (_, i) => ({ name: `Service ${i}`, desc: null, variants: [{ label: "1 hour", price: 10 + i }] })),
      requirements: Array.from({ length: 20 }, (_, i) => `Requirement number ${i} about safety and gear.`),
      includes: Array.from({ length: 20 }, (_, i) => `Included item number ${i}.`),
      faq: Array.from({ length: 20 }, (_, i) => ({ q: `Question ${i}?`, a: `Answer number ${i}, a full sentence.` })),
      photos: Array.from({ length: 20 }, (_, i) => `https://x/photo${i}.jpg`),
    } as Partial<Item>),
  ];
  const r = run(items);
  try {
    const bytes = Buffer.byteLength(r.read("o-1.html"), "utf8");
    assert.ok(bytes < 16_000, `o-1.html is ${bytes} bytes, unexpectedly large even after every list is capped`);
    for (const m of r.read("o-1.html").matchAll(/href="https:\/\/onoutset\.com\/(l|p)\/([^"]+)"/g)) {
      const rel = join(m[1], m[2]);
      assert.ok(readdirSync(join(r.dir, m[1])).includes(m[2]), `o-1.html links to ${rel}, which was not written`);
    }
  } finally {
    r.cleanup();
  }
});

test("a sitemap index points at the pages sitemap and one listings sitemap, and robots.txt still names the index", () => {
  const r = run([item("o-1", { cover: "https://x/1.jpg" })]);
  try {
    const index = readFileSync(join(r.dir, "sitemap.xml"), "utf8");
    assert.match(index, /<sitemapindex/);
    assert.match(index, /<loc>https:\/\/onoutset\.com\/sitemap-pages\.xml<\/loc>/);
    assert.match(index, /<loc>https:\/\/onoutset\.com\/sitemap-listings-1\.xml<\/loc>/);
    const listings = readFileSync(join(r.dir, "sitemap-listings-1.xml"), "utf8");
    assert.match(listings, /<loc>https:\/\/onoutset\.com\/l\/o-1\.html<\/loc>/);
    assert.equal(readFileSync(join(r.dir, "robots.txt"), "utf8"), "User-agent: *\nAllow: /\nSitemap: https://onoutset.com/sitemap.xml\n");
  } finally {
    r.cleanup();
  }
});

test("a sitemap never carries more than 40,000 urls in one file", () => {
  const items: Item[] = Array.from({ length: 40_005 }, (_, i) => item(`o-${i}`, { cover: `https://x/${i}.jpg`, art: "kayak", metroId: null }));
  const r = run(items);
  try {
    assert.equal(readdirSync(r.dir).filter((f) => /^sitemap-listings-\d+\.xml$/.test(f)).length, 2);
    const first = (readFileSync(join(r.dir, "sitemap-listings-1.xml"), "utf8").match(/<loc>/g) || []).length;
    const second = (readFileSync(join(r.dir, "sitemap-listings-2.xml"), "utf8").match(/<loc>/g) || []).length;
    assert.equal(first, 40_000);
    assert.equal(second, 5);
  } finally {
    r.cleanup();
  }
});

test("a stale extra sitemap chunk from a bigger previous run is removed", () => {
  const dir = mkdtempSync(join(tmpdir(), "outset-listing-pages-"));
  writeFileSync(join(dir, "sitemap-listings-2.xml"), "<urlset/>");
  try {
    const items: Item[] = [item("o-1", { cover: "https://x/1.jpg" })];
    const landing = writeLandingPages(items, { publicDir: dir });
    writeListingPages(items, landing, { publicDir: dir });
    assert.deepEqual(readdirSync(dir).filter((f) => /^sitemap-listings-\d+\.xml$/.test(f)), ["sitemap-listings-1.xml"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
