import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bookablePages, priceOf, writeLandingPages, type Item } from "../pages.ts";
import { clip, writeListingPages } from "../listingPages.ts";

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

/**
 * The Gainesville museums page linked "Morton Museum of Cooke County" to /l/o-mortonmuseum-org.html, and that
 * file was never written: the city page linked every listing with a cover, the listing generator required a
 * price or reviews as well. One rule now decides both, so a card link to /l/ always lands on a page.
 */
test("a city page links to /l/ only for a listing that actually gets a page, and every page carries the legal footer", () => {
  const items: Item[] = [
    item("o-priced", { cover: "https://x/a.jpg" }),
    item("o-photo-only", { cover: "https://x/d.jpg", options: [] }),
    item("o-reviewed", { cover: "https://x/e.jpg", options: [], reviews: 40 } as Partial<Item>),
  ];
  const r = run(items);
  try {
    const city = readFileSync(join(r.dir, "p", "cooking-in-toronto.html"), "utf8");
    assert.match(city, /href="https:\/\/onoutset\.com\/l\/o-priced\.html"/);
    assert.match(city, /href="https:\/\/onoutset\.com\/l\/o-reviewed\.html"/);
    assert.match(city, /href="https:\/\/onoutset\.com\/#o=o-photo-only"/);
    assert.doesNotMatch(city, /l\/o-photo-only\.html/);
    for (const l of [...city.matchAll(/href="https:\/\/onoutset\.com\/l\/([^"]+)"/g)].map((m) => m[1])) assert.ok(r.files.includes(l), `${l} linked but not written`);
    for (const html of [city, r.read("o-priced.html")]) {
      assert.match(html, /href="https:\/\/onoutset\.com\/terms\.html"/);
      assert.match(html, /href="https:\/\/onoutset\.com\/privacy\.html"/);
      assert.match(html, /href="https:\/\/onoutset\.com\/about\.html"/);
      assert.match(html, /hello@onoutset\.com/);
      assert.match(html, /339 King St N, Waterloo, ON N2J 0C5, Canada/);
    }
  } finally {
    r.cleanup();
  }
});

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

/**
 * A listing page is the link a guest actually sends a friend, and all 11,545 of them shipped without an `og:`
 * tag, so the send previewed as a bare onoutset.com URL: no business name, no photo, no line about it. The
 * card is built from the listing's own facts, the same ones the page prints, and its lead photo goes through
 * the same proxy the page's own images do.
 */
test("a listing page carries a social card built from the listing's own name and lead photo", () => {
  const r = run([
    item("o-a", { cover: "https://x/a.jpg", blurb: "Hand-rolled pasta in a real kitchen." } as Partial<Item>),
    // A .gif cover is one the proxy is told to leave alone, so the card falls back to the app icon rather
    // than pointing a scraper at an animation it will not crop.
    item("o-g", { cover: "https://x/g.gif" } as Partial<Item>),
  ]);
  try {
    const html = r.read("o-a.html");
    assert.match(html, /<meta property="og:title" content="o-a in Toronto, ON · Outset">/);
    assert.match(html, /<meta property="og:description" content="Hand-rolled pasta in a real kitchen\.">/);
    assert.match(html, /<meta property="og:url" content="[^"]*\/l\/o-a\.html">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/wsrv\.nl\/\?url=x%2Fa\.jpg&amp;w=1200&amp;h=630/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    // The og:url is the canonical one, never the hash route a crawler cannot read.
    assert.doesNotMatch(html, /<meta property="og:url" content="[^"]*#o=/);

    const gif = r.read("o-g.html");
    assert.match(gif, /<meta property="og:image" content="[^"]*apple-touch-icon\.png">/);
    assert.match(gif, /<meta name="twitter:card" content="summary">/);
  } finally {
    r.cleanup();
  }
});

/**
 * `slice(0, 300)` cut 3,049 of the 11,545 listing descriptions mid-word: "The guide shares favorite fishing
 * spot", "Inferno Hot Pilates, Vi". That is the meta description a search result prints and, since the social
 * card landed, the og:description a friend sees in a link preview, where a word stopping halfway reads as
 * broken rather than trimmed.
 */
test("a blurb too long for a description is cut at a sentence or a word, never mid-word", () => {
  // A sentence ends well inside the allowance, so it is the cut and needs no mark.
  const sentences = "A first sentence about the boat. ".repeat(9) + "And a tenth that runs past the end of the allowance entirely.";
  assert.ok(sentences.length > 300);
  assert.equal(clip(sentences, 300).slice(-32), "A first sentence about the boat.");
  assert.ok(!clip(sentences, 300).endsWith("…"));

  // No sentence end late enough, so the last whole word wins and says it goes on.
  const oneLong = "Fishing " + "word ".repeat(200);
  const cut = clip(oneLong, 300);
  assert.ok(cut.length <= 300, `${cut.length} chars`);
  assert.ok(cut.endsWith("…"));
  assert.ok(!/\bwor…$/.test(cut), "cut in the middle of a word");
  // A trailing comma or colon does not survive in front of the ellipsis.
  assert.equal(clip("a".repeat(295) + ", gamma", 300), "a".repeat(295) + "…");

  // Anything that fits is the operator's own text, untouched.
  assert.equal(clip("  Short and whole.  ", 300), "Short and whole.");

  const r = run([item("o-a", { cover: "https://x/a.jpg", blurb: "Hand-rolled " + "pasta ".repeat(80) } as Partial<Item>)]);
  try {
    const d = r.read("o-a.html").match(/<meta name="description" content="([^"]*)"/)![1];
    assert.ok(d.endsWith("…"), d.slice(-30));
    assert.doesNotMatch(d, /pas…$/);
    // The page and its social card carry the same sentence.
    assert.ok(r.read("o-a.html").includes(`<meta property="og:description" content="${d}">`));
  } finally {
    r.cleanup();
  }
});

/**
 * The cancellation line on a listing page. It used to print the stored `fc` verbatim, which is the badge the
 * sync wrote with an older reading of the same policy. 171 of the 1,237 pages taking their line from it named
 * a different window than the app named for the same shop, and one advertised free cancellation on a page the
 * app refuses to badge at all. Both read `freeCancelBadge` now.
 */
test("the cancellation line is the badge the app draws, not the one the file stores", () => {
  const items: Item[] = [
    // o-archangelcharters-com's shape: the stored badge took its number from the forfeit line.
    item("o-a", {
      cover: "https://x/a.jpg",
      fc: "Free cancellation up to 24 hours before",
      cancellation: "Charters cancelled within 24 hours will result in a forfeited deposit. Customers will receive a full refund or credit with 48 hours notice of cancellation.",
    } as Partial<Item>),
    // A shop that only refunds a day it calls off itself: no badge, so the policy text itself is printed.
    item("o-b", {
      cover: "https://x/b.jpg",
      fc: "Free cancellation up to 48 hours before",
      cancellation: "All sales are final. Full refund in case of operator cancellation due to weather.",
    } as Partial<Item>),
  ];
  const r = run(items);
  try {
    const a = r.read("o-a.html");
    assert.ok(a.includes("Free cancellation up to 48 hours before"), "page kept the stored window");
    assert.ok(!a.includes("up to 24 hours before"), "page still names the forfeit line's window");
    const b = r.read("o-b.html");
    assert.ok(!b.includes("Free cancellation"), "page advertises a promise the app strips");
    assert.ok(b.includes("All sales are final."), "page dropped the policy text with the badge");
  } finally {
    r.cleanup();
  }
});

test("a partner product gets a page that books on the partner's site, with the commission said and the link marked sponsored", () => {
  const items: Item[] = [
    item("a-viator-t1", {
      cover: "https://media.tacdn.com/t1.jpg", options: [], from: 89, reviews: 3, art: "cruise", area: "Tampa, FL", metroId: "tampa",
      affiliate: { source: "viator", label: "Viator", url: "https://www.viator.com/tours/Tampa/x/d123-T1?pid=P1&mcid=42383&medium=api" },
    } as Partial<Item>),
  ];
  const r = run(items);
  try {
    assert.deepEqual(r.files, ["a-viator-t1.html"], "a from-price is something to act on, even with three reviews");
    const html = r.read("a-viator-t1.html");
    assert.ok(html.includes('rel="sponsored noopener noreferrer">Book on Viator</a>'), html.slice(0, 400));
    assert.ok(html.includes("Outset earns a commission"), "the disclosure is on the page");
    assert.ok(!html.includes("Request a time on Outset"), "never offered as a request");
    assert.ok(html.includes("https://www.viator.com/tours/Tampa/x/d123-T1?pid=P1&amp;mcid=42383&amp;medium=api"), "the partner-attributed link, escaped");
    // The licence: "you must not index any Viator unique content". The page is noindex, it is in no sitemap,
    // and the city page (which is indexed) does not carry the product either.
    assert.ok(html.includes('<meta name="robots" content="noindex">'), "a partner page is noindex");
    assert.ok(!r.listing.urls.some((u) => u.includes("a-viator-t1")), "and is offered to no sitemap");
    assert.ok(!readdirSync(join(r.dir, "p")).some((f) => readFileSync(join(r.dir, "p", f), "utf8").includes("a-viator-t1")), "and is on no city page");
  } finally {
    r.cleanup();
  }
});

test("a partner product publishes no geo point of its own", () => {
  // Its lat and lon are the centre of the destination the partner's API filed it under, the same pair for
  // every product in that city, so structured data must not state them as this listing's own location.
  const items: Item[] = [
    item("a-viator-t2", {
      cover: "https://media.tacdn.com/t2.jpg", options: [], from: 120, art: "cruise", area: "Tampa, FL", metroId: "tampa", lat: 27.9506, lon: -82.4572,
      affiliate: { source: "viator", label: "Viator", url: "https://www.viator.com/tours/Tampa/y/d123-T2?pid=P1" },
    } as Partial<Item>),
    item("o-realshop-com", { cover: "https://realshop.com/a.jpg", options: [{ name: "Tour", price: 60 }], art: "cruise", area: "Tampa, FL", metroId: "tampa", lat: 27.9, lon: -82.5 } as Partial<Item>),
  ];
  const r = run(items);
  try {
    assert.ok(!r.read("a-viator-t2.html").includes("GeoCoordinates"), "no pin for a partner's product");
    assert.ok(r.read("o-realshop-com.html").includes("GeoCoordinates"), "an operator's own pin is unchanged");
  } finally {
    r.cleanup();
  }
});

test("the hours block is the lines the app prints, not the raw published ones", () => {
  const items: Item[] = [
    // o-acuitymaasc-com's shape: OpenStreetMap's own syntax, which 41 of these pages published as written.
    item("o-a", { cover: "https://x/a.jpg", hoursText: ['Su off; Mo "by appointment"; Tu-Fr 09:00-16:30'] } as Partial<Item>),
    // The site builder's placeholder, which the open-or-closed line already refuses to read as hours.
    item("o-b", { cover: "https://x/b.jpg", hoursText: ["Mon-Sun 12:00 AM - 11:59 PM"] } as Partial<Item>),
    // A campground whose only hours line is its quiet hours: those are not when the door is open.
    item("o-c", { cover: "https://x/c.jpg", hoursText: ["Quiet hours are from 11:00pm - 8:00am"] } as Partial<Item>),
  ];
  const r = run(items);
  try {
    const a = r.read("o-a.html");
    assert.ok(a.includes("<li>Sun Closed</li>"), "page said a closed day in words");
    assert.ok(a.includes("<li>Tue-Fri 9:00 AM - 4:30 PM</li>"), "page read the day codes and the 24 hour clock");
    assert.ok(!a.includes("Tu-Fr"), "page still prints OpenStreetMap day codes");
    assert.ok(!a.includes("&quot;"), "page still prints the syntax's quote marks");
    const b = r.read("o-b.html");
    assert.ok(!b.includes("<h2>Hours</h2>"), "page still advertises the placeholder as round-the-clock hours");
    const c = r.read("o-c.html");
    assert.ok(!c.includes("<h2>Hours</h2>"), "page read quiet hours as opening hours");
  } finally {
    r.cleanup();
  }
});

/**
 * The "What's included" block was the last section on this page still printed from the raw published lines,
 * and 5,263 shipped pages put the shop's own "not included" items under that heading: "Gratuities", "Lunch",
 * "Hotel pickup and drop-off" and "Alcoholic drinks (not included)" were all offered as things the price covers,
 * on the page a shared link opens. It goes through `splitIncluded` now, the rule both app surfaces read.
 */
test("what's included on the page is the split the app reads, not the raw published lines", () => {
  const items: Item[] = [
    item("o-a", {
      cover: "https://x/a.jpg",
      includes: ["Bottled water", "Gratuities", "Hotel pickup and drop-off (not included)", "Snacks and drinks available for purchase", "Not included: Fuel"],
    } as Partial<Item>),
    item("o-b", { cover: "https://x/b.jpg", includes: ["Gratuities (not included)"] } as Partial<Item>),
  ];
  const r = run(items);
  try {
    const a = r.read("o-a.html");
    const included = a.slice(a.indexOf("<h2>What's included</h2>"), a.indexOf("<h2>Not included</h2>"));
    assert.ok(included.includes("<li>Bottled water</li>"), "page dropped a real inclusion");
    assert.ok(!included.includes("Hotel pickup"), "page still lists a not-included item as included");
    assert.ok(!included.includes("available for purchase"), "page still lists what the shop sells separately as included");
    assert.ok(!included.includes("Fuel"), "page still reads a line's own Not included label as an inclusion");
    assert.ok(a.includes("<h2>Not included</h2>"), "page never named the other column");
    const no = a.slice(a.indexOf("<h2>Not included</h2>"));
    for (const missing of ["Hotel pickup and drop-off", "Snacks and drinks available for purchase", "Fuel"]) {
      assert.ok(no.includes(missing), `Not included column lost "${missing}"`);
    }
    // A shop whose every line is an exclusion gets no "What's included" heading over an empty list.
    const b = r.read("o-b.html");
    assert.ok(!b.includes("<h2>What's included</h2>"), "page headed an empty included list");
    assert.ok(b.includes("<h2>Not included</h2>"), "page dropped the only lines the shop published");
  } finally {
    r.cleanup();
  }
});

/**
 * "Requirements" is a heading about the guest: what they must be, bring or sign. 2,369 shipped listings state
 * no requirements at all, and this page filled the section with their `specs` instead, which is where the
 * crawl puts a shop's selling lines. So a winery's page headed "Beautiful gardens with bicycles hidden
 * throughout the property" as a requirement, and a brewery's "Located in downtown Anoka, MN".
 *
 * The app has never done that: `listingFacts` sorts a spec line by what it says, a rule about the guest under
 * "Who can go" and the rest as the listing's highlights. Reading the same split moves 5,439 lines out of the
 * section and keeps the 807 that are real rules, and gives 6,511 listings a Highlights section this page did
 * not have at all, the 6,456 that publish their own included.
 */
test("requirements on the page are the rules the app reads, and a shop's selling lines lead as highlights", () => {
  const items: Item[] = [
    item("o-a", {
      cover: "https://x/a.jpg",
      specs: ["Beautiful gardens with bicycles hidden throughout the property", "Located in downtown Anoka, MN", "Minimum age 18"],
    } as Partial<Item>),
    // A shop that states its own requirements keeps them, and its own highlights lead.
    item("o-b", {
      cover: "https://x/b.jpg",
      requirements: ["Closed-toe shoes required"],
      highlights: ["Award-winning beers such as Treachery and Soleil"],
      specs: ["Located in downtown Anoka, MN"],
    } as Partial<Item>),
    // Nothing published either way: no empty heading over either list.
    item("o-c", { cover: "https://x/c.jpg" }),
  ];
  const r = run(items);
  try {
    const a = r.read("o-a.html");
    const reqs = a.slice(a.indexOf("<h2>Requirements</h2>"));
    assert.ok(a.includes("<h2>Requirements</h2>"), "the one real rule lost its section");
    assert.ok(reqs.includes("Minimum age 18"), "page dropped the only rule the shop stated");
    assert.ok(!reqs.includes("Beautiful gardens"), "page still heads a selling line as a requirement");
    assert.ok(!reqs.includes("downtown Anoka"), "page still heads a location line as a requirement");
    const hi = a.slice(a.indexOf("<h2>Highlights</h2>"), a.indexOf("<h2>Requirements</h2>"));
    assert.ok(a.includes("<h2>Highlights</h2>"), "the selling lines went nowhere");
    assert.ok(hi.includes("Beautiful gardens with bicycles hidden throughout the property"), "highlights lost a line");
    assert.ok(hi.includes("Located in downtown Anoka, MN"), "highlights lost a line");
    // A line already printed as a rule is not repeated as a selling point, the same guard the app uses.
    assert.ok(!hi.includes("Minimum age 18"), "a rule was printed twice");

    const b = r.read("o-b.html");
    assert.ok(b.slice(b.indexOf("<h2>Requirements</h2>")).includes("Closed-toe shoes required"), "a stated requirement was replaced");
    assert.ok(b.slice(b.indexOf("<h2>Highlights</h2>"), b.indexOf("<h2>Requirements</h2>")).includes("Treachery"), "a published highlight was replaced");
    assert.ok(!b.includes("downtown Anoka"), "specs won over what the shop itself stated");

    const c = r.read("o-c.html");
    assert.ok(!c.includes("<h2>Requirements</h2>"), "page headed an empty requirements list");
    assert.ok(!c.includes("<h2>Highlights</h2>"), "page headed an empty highlights list");
  } finally {
    r.cleanup();
  }
});

/**
 * The static pages are built from the committed files straight, so they never ran the app's own menu rule: the
 * page a search engine and a shared link open kept offering rows the app had stopped offering, and quoted their
 * prices. 283 shipped listings listed one.
 */
test("a page offers only what the app offers, and prices it the same way", () => {
  const items: Item[] = [
    item("o-museum", {
      cover: "https://x/a.jpg",
      options: [
        { name: "Memberships", detail: "Individual", price: 10 },
        { name: "Past Exhibitions", detail: "", price: 12 },
        { name: "Guided Tour", detail: "", price: 30 },
      ],
      // What an earlier sync wrote off rows this page no longer carries.
      from: 10,
    } as Partial<Item>),
  ];
  const r = run(items);
  try {
    const html = r.read("o-museum.html");
    assert.doesNotMatch(html, /Memberships/, "a year of the place is not a row a guest books");
    assert.doesNotMatch(html, /Past Exhibitions/, "an archive is not a row a guest books");
    assert.match(html, /Guided Tour/);
    // The menu's own cheapest, not the browse record's stale `from`.
    assert.match(html, /\$30/);
    assert.doesNotMatch(html, /\$10\b/);
    // The same number a city card prints, which reads priceOf off the same record.
    assert.equal(priceOf(bookablePages(items)[0]), 30);
  } finally {
    r.cleanup();
  }
});

test("a listing whose only priced row was a membership keeps the browse record's price off the page", () => {
  // o-goulbournmuseum-ca ships one option, "Memberships" at $10, and an empty service list.
  const r = run([item("o-only", { cover: "https://x/b.jpg", options: [{ name: "Memberships", detail: "", price: 10 }], reviews: 40, from: 10 } as Partial<Item>)]);
  try {
    const html = r.read("o-only.html");
    assert.doesNotMatch(html, /Memberships/);
    assert.doesNotMatch(html, /\$10\b/, "with nothing bookable priced, the page states no price rather than the membership's");
  } finally {
    r.cleanup();
  }
});

/**
 * The blurb and the FAQ were the last fields on this page still printed from the raw stored record. The app
 * reads a blurb through `cleanDesc` on both surfaces and a question and its answer through `tidyLine`, so 977
 * of these pages described a shop in words the app does not use for it, and 9 of the 72 shipped FAQ entries
 * printed a shouting question or the Q&A page's own "A." label the app had already taken off.
 */
test("the blurb and the FAQ on the page are the words the app prints, not the raw stored ones", () => {
  const items: Item[] = [
    item("o-a", {
      cover: "https://x/a.jpg",
      blurb: "Fully staffed by USCG licensed captain and crew . Tandem jumps, solo dives, breathtaking views. Book now!",
      faq: [
        { q: "HOW MUCH TIME WILL I HAVE?", a: "A. You will have one hour to complete the room." },
        { q: "Do you sail in bad weather?", a: "- We reschedule when the wind is up." },
      ],
    } as Partial<Item>),
  ];
  const r = run(items);
  try {
    const a = r.read("o-a.html");
    assert.ok(a.includes("Fully staffed by Coast Guard licensed captain and crew."), "blurb still short of the app's own words");
    assert.ok(!a.includes("USCG"), "page still prints the jargon the app spells out");
    assert.ok(!a.includes("crew ."), "page still prints the space the crawl left in front of a full stop");
    assert.ok(!/Book now/i.test(a), "page still prints the button swept up with the last sentence");
    assert.ok(a.includes("<h3>How much time will i have?</h3>"), "page still prints a shouting question");
    assert.ok(a.includes("<p>You will have one hour to complete the room.</p>"), "page still prints the Q&A page's own label");
    assert.ok(a.includes("<p>We reschedule when the wind is up.</p>"), "page still prints the bullet swept up with the answer");
    // The description a search engine and a shared link read comes off the same cleaned blurb.
    assert.ok(a.includes('content="Fully staffed by Coast Guard licensed captain'), "meta description still built from the raw blurb");
  } finally {
    r.cleanup();
  }
});
