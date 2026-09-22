import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KINDS, MIN_METRO_LISTINGS, buildFaq, pageTitle, publicSite, singular, writeLandingPages, type Item } from "../pages.ts";
import { METROS } from "../../taxonomy/catalog.ts";
import { ART_ALIASES } from "../../../../src/data/synonyms.ts";
import { GUIDES } from "../../../../src/data/guides.ts";

const metro = (id: string) => METROS.find((m) => m.id === id)!;

function item(art: string, metroId: string | null, n: number, extra: Partial<Item> = {}): Item {
  return {
    id: `o-${art}-${metroId || "none"}-${n}`,
    title: `${art} ${n}`,
    art,
    area: metroId ? `${metro(metroId).name}, ${metro(metroId).region}` : "Nowhere, ZZ",
    metroId,
    options: [],
    ...extra,
  };
}

const fixture: Item[] = [
  item("cooking", "toronto", 1, { area: "Toronto, ON", cover: "https://x/1.jpg", options: [{ name: "Pasta night", price: 95 }], dur: "2 hours", rating: 4.8, reviews: 120, hrs: [[600, 1200]] }),
  item("cooking", "toronto", 2, { area: "Mississauga, ON", cover: "https://x/2.jpg", from: 60, dur: "2 hours", reviews: 40 }),
  item("cooking", "toronto", 3, { area: "Toronto, ON", services: [{ name: "Sushi class", desc: null, variants: [{ label: "3 hours", price: 140 }] }], dur: "3 hours" }),
  item("cooking", "niagara", 1),
  item("cooking", "niagara", 2),
  item("cooking", "niagara", 3),
  item("cooking", "montreal", 1),
  item("escape", "toronto", 1),
  item("escape", "toronto", 2),
  item("kayak", null, 1),
];

function run(items: Item[]) {
  const dir = mkdtempSync(join(tmpdir(), "outset-pages-"));
  const result = writeLandingPages(items, { publicDir: dir });
  const files = readdirSync(join(dir, "p")).filter((f) => f.endsWith(".html")).sort();
  const read = (f: string) => readFileSync(join(dir, "p", f), "utf8");
  const sitemap = readFileSync(join(dir, "sitemap-pages.xml"), "utf8");
  return { dir, result, files, read, sitemap, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("every kind's search phrase is how people type it: an alias of that kind in src/data/synonyms.ts", () => {
  for (const k of KINDS) {
    const aliases = ART_ALIASES[k.art as keyof typeof ART_ALIASES];
    assert.ok(aliases, `${k.art} has no aliases`);
    const phrase = k.search.toLowerCase();
    const ok = aliases.includes(phrase) || aliases.includes(phrase.replace(/s$/, "")) || aliases.includes(phrase.replace(/es$/, ""));
    assert.ok(ok, `"${k.search}" is not a search phrase for ${k.art}`);
  }
});

test("every kind that can hold listings has a landing page definition", () => {
  const missing = Object.keys(ART_ALIASES).filter((art) => !KINDS.some((k) => k.art === art));
  assert.deepEqual(missing, []);
});

test("titles name the activity the way it is searched, with the city and its province or state", () => {
  assert.equal(pageTitle(KINDS.find((k) => k.art === "cooking")!, metro("toronto")), "Cooking classes in Toronto, Ontario");
  assert.equal(pageTitle(KINDS.find((k) => k.art === "pottery")!, metro("toronto")), "Pottery classes in Toronto, Ontario");
  assert.equal(pageTitle(KINDS.find((k) => k.art === "escape")!, metro("tampa")), "Escape rooms in Tampa Bay, Florida");
  assert.equal(pageTitle(KINDS.find((k) => k.art === "escape")!, metro("dc")), "Escape rooms in Washington DC");
  assert.equal(pageTitle(KINDS.find((k) => k.art === "escape")!, null), "Escape rooms in the US and Canada");
});

test("a metro page needs 3 listings, the all-metros page needs one anywhere, and nothing is published empty", () => {
  const r = run(fixture);
  try {
    assert.equal(MIN_METRO_LISTINGS, 3);
    assert.deepEqual(r.files, ["cooking-in-anywhere.html", "cooking-in-niagara.html", "cooking-in-toronto.html", "escape-in-anywhere.html", "index.html", "kayak-in-anywhere.html"]);
    assert.equal(r.result.pages, 5);
    assert.equal(r.result.metroPages, 2);
    assert.equal(r.result.kindPages, 3);
    // Two escape rooms in Toronto is under the bar; one cooking class in Montreal too. Kinds with no listings get no page at all.
    assert.ok(!r.files.includes("escape-in-toronto.html"));
    assert.ok(!r.files.includes("cooking-in-montreal.html"));
    assert.ok(!r.files.includes("pottery-in-anywhere.html"));
  } finally {
    r.cleanup();
  }
});

test("the Toronto cooking page: title, h1, real count, cards with price and photo, canonical, facts-only FAQ", () => {
  const r = run(fixture);
  try {
    const html = r.read("cooking-in-toronto.html");
    assert.match(html, /<title>Cooking classes in Toronto, Ontario · Outset<\/title>/);
    assert.match(html, /<h1>Cooking classes in Toronto, Ontario<\/h1>/);
    assert.match(html, /3 cooking classes around Toronto, 3 with prices/);
    assert.match(html, /<link rel="canonical" href="https:\/\/onoutset\.com\/p\/cooking-in-toronto\.html">/);
    assert.match(html, /<img src="https:\/\/wsrv\.nl\/\?url=x%2F1\.jpg&amp;w=560/);
    assert.match(html, /From <b>\$60<\/b>/);
    assert.match(html, /From <b>\$140<\/b>/);
    // A card whose listing has a cover photo links to that listing's own static page (listingPages.ts), not the hash route.
    assert.match(html, /href="https:\/\/onoutset\.com\/l\/o-cooking-toronto-1\.html"/);
    // FAQ built from the listings' own facts.
    assert.match(html, /Outset lists 3 cooking classes around Toronto, including places in Toronto and Mississauga\. 2 of them have photos\./);
    assert.match(html, /3 of the 3 operators publish prices on their own site\. Starting prices run from \$60 to \$140\./);
    assert.match(html, /Listed durations include 2 hours and 3 hours/);
    assert.match(html, /cooking 1 \(4\.8 stars, 120 reviews\) and cooking 2 \(40 reviews\)/);
    assert.match(html, /1 of the 3 show hours copied from the operator's website/);
    assert.match(html, /"@type":"FAQPage"/);
    assert.doesNotMatch(html, /instant booking/i);
    // Links: the nearest metro with the same kind, and the other kinds with a page in this metro (none here).
    assert.match(html, /href="cooking-in-niagara\.html"/);
    assert.doesNotMatch(html, /cooking-in-montreal\.html/);
    assert.doesNotMatch(html, /escape-in-toronto\.html/);
    assert.match(html, /href="cooking-in-anywhere\.html"/);
  } finally {
    r.cleanup();
  }
});

test("a listing title with a script-closing sequence cannot break out of the JSON-LD tag", () => {
  // itemListElement carries each listing's title straight off the operator's own site; a hacked one could plant
  // this. JSON.stringify alone would close the <script> tag early and let the rest of the page parse as HTML.
  const evil = fixture.map((i, n) => (n === 0 ? { ...i, title: '</script><script>alert(1)</script>' } : i));
  const r = run(evil);
  try {
    const html = r.read("cooking-in-toronto.html");
    assert.doesNotMatch(html, /<script type="application\/ld\+json">[^]*?<\/script><script>alert/);
  } finally {
    r.cleanup();
  }
});

test("a page with no prices, hours, durations or reviews asks none of those questions", () => {
  const r = run(fixture);
  try {
    const html = r.read("cooking-in-niagara.html");
    assert.doesNotMatch(html, /How much do/);
    assert.doesNotMatch(html, /How long do/);
    assert.doesNotMatch(html, /most reviews/);
    assert.doesNotMatch(html, /opening hours/);
    assert.match(html, /Outset lists 3 cooking classes around Niagara\. Photos are added/);
    const faq = buildFaq(KINDS.find((k) => k.art === "cooking")!, metro("niagara"), fixture.filter((i) => i.metroId === "niagara"));
    assert.deepEqual(faq.map((f) => f.q), ["How many cooking classes are there in Niagara?", "Where does this information come from?"]);
  } finally {
    r.cleanup();
  }
});

test("every written page is in the sitemap, and every internal link points at a written page", () => {
  const r = run(fixture);
  try {
    for (const f of r.files) assert.ok(r.sitemap.includes(`<loc>https://onoutset.com/p/${f}</loc>`), `${f} missing from sitemap`);
    const locs = r.sitemap.match(/<loc>[^<]+<\/loc>/g)!.length;
    assert.equal(locs, r.files.length + 1); // plus the site root
    for (const f of r.files) {
      const links = [...r.read(f).matchAll(/href="([a-z-]+\.html)"/g)].map((m) => m[1]);
      for (const l of links) assert.ok(r.files.includes(l), `${f} links to ${l}, which was not written`);
    }
    assert.match(r.read("index.html"), /Toronto, Ontario/);
  } finally {
    r.cleanup();
  }
});

/**
 * SITE_URL is where a claim email's link points, and backend/AGENTS.md tells anyone testing that mail from a
 * laptop to set it to localhost. These pages are published, so one sync from that laptop used to write a
 * canonical tag, a sitemap and a robots.txt full of localhost URLs into committed files. The rehearsal sets
 * SITE_URL too, which is how this turned up: two tests here failed inside it and passed everywhere else.
 */
test("a local SITE_URL never reaches a canonical link, a card link or the sitemap", () => {
  const had = { site: process.env.SITE_URL, pub: process.env.PUBLIC_SITE_URL };
  process.env.SITE_URL = "http://localhost:5173/";
  delete process.env.PUBLIC_SITE_URL;
  const r = run(fixture);
  try {
    assert.equal(publicSite(), "https://onoutset.com/");
    const html = r.read("cooking-in-toronto.html");
    assert.doesNotMatch(html, /localhost/);
    assert.match(html, /<link rel="canonical" href="https:\/\/onoutset\.com\/p\/cooking-in-toronto\.html">/);
    assert.doesNotMatch(r.sitemap, /localhost/);
    assert.equal(readFileSync(join(r.dir, "robots.txt"), "utf8").includes("localhost"), false);
    // A real deployment somewhere else still says so, through the variable that means exactly that.
    process.env.PUBLIC_SITE_URL = "https://staging.onoutset.com";
    assert.equal(publicSite(), "https://staging.onoutset.com/");
  } finally {
    r.cleanup();
    if (had.site === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = had.site;
    if (had.pub === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = had.pub;
  }
});

test("a rerun removes pages whose listings are gone", () => {
  const r = run(fixture);
  try {
    writeLandingPages(fixture.filter((i) => i.art !== "cooking"), { publicDir: r.dir });
    const files = readdirSync(join(r.dir, "p")).filter((f) => f.endsWith(".html")).sort();
    assert.deepEqual(files, ["escape-in-anywhere.html", "index.html", "kayak-in-anywhere.html"]);
  } finally {
    r.cleanup();
  }
});

/**
 * 17,155 of the 59,163 shipped listings carry the catalog's `thin` flag: no photo, no price, no hours, no
 * services, no tags, no description. Browse and the rails leave them out on purpose. The landing pages took
 * every listing, so 2,787 cards across 866 published pages were a grey square, a name and "Price on request",
 * six pages were nothing else, and every count on every page (the lede, the FAQ, the pills, the JSON-LD) was
 * measured on listings a guest cannot act on.
 */
test("a listing with nothing on it is left off a page, out of its counts, and cannot create a page", () => {
  const items: Item[] = [
    item("cooking", "toronto", 1, { area: "Toronto, ON", cover: "https://x/1.jpg", options: [{ name: "Pasta night", price: 95 }] }),
    item("cooking", "toronto", 2, { area: "Toronto, ON", cover: "https://x/2.jpg", from: 60 }),
    item("cooking", "toronto", 3, { area: "Toronto, ON", cover: "https://x/3.jpg", from: 80 }),
    item("cooking", "toronto", 4, { area: "Toronto, ON", thin: true }),
    item("cooking", "toronto", 5, { area: "Toronto, ON", thin: true }),
    // Niagara reaches three listings only by counting two empty ones, so it gets no page at all.
    item("cooking", "niagara", 1),
    item("cooking", "niagara", 2, { thin: true }),
    item("cooking", "niagara", 3, { thin: true }),
  ];
  const r = run(items);
  try {
    assert.deepEqual(r.files, ["cooking-in-anywhere.html", "cooking-in-toronto.html", "index.html"]);
    const html = r.read("cooking-in-toronto.html");
    assert.match(html, /3 cooking classes around Toronto, 3 with prices/);
    assert.match(html, /Outset lists 3 cooking classes around Toronto\./);
    assert.match(html, /"numberOfItems":3/);
    assert.doesNotMatch(html, /o-cooking-toronto-4/);
    assert.doesNotMatch(html, /cooking-in-niagara\.html/);
    // The all-metros page counts the same way: four real listings, not eight rows.
    assert.match(r.read("cooking-in-anywhere.html"), /<h1>Cooking classes in the US and Canada<\/h1>/);
    assert.match(r.read("cooking-in-anywhere.html"), /4 cooking classes across the US and Canada/);
  } finally {
    r.cleanup();
  }
});

/**
 * 1,087 of the 39,044 covers we hold are `http://` addresses, because that is what the operator's own site
 * serves. These pages are served over https, so the browser refused the image, `onerror` took the tag out and
 * the card was a grey square: 387 photos across 306 of the 1,481 published pages. The app never had this
 * because it proxies every card photo through wsrv.nl, which answers over https whatever the original was.
 */
test("a card photo is proxied, so an operator's http image still appears on an https page", () => {
  const items: Item[] = [
    item("cooking", "toronto", 1, { cover: "http://shop.example/kitchen.jpg" }),
    item("cooking", "toronto", 2, { cover: "https://shop.example/pasta.png" }),
    item("cooking", "toronto", 3, { cover: "https://shop.example/tour.gif" }),
    item("cooking", "toronto", 4, { cover: "data:image/png;base64,iVBORw0KGgo=" }),
  ];
  const r = run(items);
  try {
    const html = r.read("cooking-in-toronto.html");
    // Nothing on the page is fetched over http, and the operator's own address is not what the browser asks for.
    assert.doesNotMatch(html, /src="http:\/\//);
    assert.doesNotMatch(html, /srcset="[^"]*http:\/\//);
    assert.match(html, /<img src="https:\/\/wsrv\.nl\/\?url=shop\.example%2Fkitchen\.jpg&amp;w=560/);
    assert.match(html, /srcset="https:\/\/wsrv\.nl\/\?url=shop\.example%2Fpasta\.png&amp;w=280[^"]*280w, [^"]*&amp;w=560[^"]*560w"/);
    assert.match(html, /sizes="\(max-width: 700px\) 50vw, 280px"/);
    // A gif is left alone, the way the app leaves it alone, because the proxy would only re-encode it.
    assert.match(html, /<img src="https:\/\/shop\.example\/tour\.gif"/);
    // A cover that is not an http address is not a photo: no tag at all, rather than a strange one.
    assert.doesNotMatch(html, /data:image/);
  } finally {
    r.cleanup();
  }
});

/**
 * A page that found exactly one of something said "1 cooking classes" in its title tag and its lede, and
 * "Outset lists 1 cooking classe" in the FAQ a search engine reads as an answer, because the singular was a
 * stripped trailing s. Every kind's own noun has to survive it, including the eleven that name a pair.
 */
test("a page with one listing names one of it, for every kind", () => {
  assert.equal(singular("cooking classes"), "cooking class");
  assert.equal(singular("escape rooms"), "escape room");
  assert.equal(singular("museums and galleries"), "museum or gallery");
  assert.equal(singular("boat tours and cruises"), "boat tour or cruise");
  assert.equal(singular("saunas and bathhouses"), "sauna or bathhouse");
  assert.equal(singular("motorsport and off-road operators"), "motorsport or off-road operator");
  assert.equal(singular("breweries"), "brewery");
  assert.equal(singular("bowling alleys"), "bowling alley");
  assert.equal(singular("zoos"), "zoo");
  assert.equal(singular("ski areas"), "ski area");
  // No kind is left ending in a plural s, an "es" that was a doubled consonant, or an invented word.
  for (const k of KINDS) {
    const one = singular(k.plural);
    assert.doesNotMatch(one, /(?:[^s]s|ies)$/, `"1 ${one}" reads as a plural (${k.art})`);
    assert.doesNotMatch(one, /\b\w+(?:ch|sh|ss|x|z)e$/, `"1 ${one}" is not a word (${k.art})`);
    assert.equal(one.split(" ").length, k.plural.split(" ").length, `${k.plural} lost a word becoming ${one}`);
  }
});

/**
 * `kindUnconfirmed` means nothing in the listing's own text confirms its kind: it was guessed off the business
 * name. The rails put these last for exactly that reason. The landing pages stated the guess as fact, to a
 * search engine, in a title, a count and a schema.org ItemList: "Escape rooms in Tampa Bay, Florida" opened on
 * Anna Maria Beach Resort™, Anna Maria Island Inn ™ and AMI Locals, and said there were 35 escape rooms when
 * 32 were escape rooms. 1,624 shipped listings carry the flag, across 239 pages, and 17 metro pages existed
 * only because guesses pushed them over the three-listing bar.
 */
test("a kind we only guessed is not published as a fact, counted, or allowed to create a page", () => {
  const items: Item[] = [
    item("escape", "tampa", 1, { area: "Tampa, FL", cover: "https://x/1.jpg", from: 30 }),
    item("escape", "tampa", 2, { area: "Tampa, FL", cover: "https://x/2.jpg", from: 35 }),
    item("escape", "tampa", 3, { area: "Clearwater, FL", from: 40 }),
    item("escape", "tampa", 4, { area: "Anna Maria Island, FL", title: "Anna Maria Beach Resort", kindUnconfirmed: true }),
    // Three cooking classes in Toronto, two of them guesses, so there is no Toronto cooking page.
    item("cooking", "toronto", 1, { area: "Toronto, ON" }),
    item("cooking", "toronto", 2, { area: "Toronto, ON", kindUnconfirmed: true }),
    item("cooking", "toronto", 3, { area: "Toronto, ON", kindUnconfirmed: true }),
  ];
  const r = run(items);
  try {
    assert.deepEqual(r.files, ["cooking-in-anywhere.html", "escape-in-anywhere.html", "escape-in-tampa.html", "index.html"]);
    const html = r.read("escape-in-tampa.html");
    assert.match(html, /<h1>Escape rooms in Tampa Bay, Florida<\/h1>/);
    assert.match(html, /3 escape rooms around Tampa Bay/);
    assert.match(html, /Outset lists 3 escape rooms around Tampa Bay/);
    assert.match(html, /"numberOfItems":3/);
    assert.doesNotMatch(html, /Anna Maria/);
    // The guessed listing is not a town of Tampa Bay's either, since it is not on the page.
    assert.doesNotMatch(html, /Anna Maria Island/);
    assert.match(r.read("cooking-in-anywhere.html"), /"numberOfItems":1/);
    assert.match(r.read("cooking-in-anywhere.html"), /1 cooking class across the US and Canada/);
  } finally {
    r.cleanup();
  }
});

/**
 * An operator whose town the crawl never found publishes its area as the state code alone ("FL"), which is
 * 4,736 rows in the shipped catalog and fourteen of them inside a metro. A state is not a town, and the FAQ
 * line lists towns: "including places in FL, Tampa and Clearwater" is a published page saying it.
 */
test("a state code is never listed as one of a metro's towns", () => {
  const items: Item[] = [
    item("cooking", "tampa", 1, { area: "Tampa, FL" }),
    item("cooking", "tampa", 2, { area: "Clearwater, FL" }),
    item("cooking", "tampa", 3, { area: "FL" }),
    item("cooking", "tampa", 4, { area: "FL" }),
    item("cooking", "tampa", 5, { area: "FL" }),
  ];
  const [first] = buildFaq(KINDS.find((k) => k.art === "cooking")!, metro("tampa"), items);
  assert.match(first.a, /including places in Tampa and Clearwater\b/);
  assert.doesNotMatch(first.a, /\bFL\b/);
});

/**
 * The guide block ("What escape rooms are actually like") is the only prose on a landing page that is ours
 * rather than an operator's, and it is keyed on the listing's art kind. Nothing connects the two but that
 * string: rename an art kind and the guide stops being found, silently, on every page and every listing page
 * for that activity. 14 of the 64 kinds have one, so a quiet loss of one is a fifteenth of the prose gone.
 */
test("every guide we have written is printed on a kind that exists", () => {
  const orphans = Object.keys(GUIDES).filter((art) => !KINDS.some((k) => k.art === art));
  assert.deepEqual(orphans, [], "guides written for an art kind no KIND uses are never printed");
});

test("the guide heading agrees with its own subject, for all 64 kinds", () => {
  // The heading picks "is" or "are" by whether the search label ends in an s. Every kind goes through it,
  // whether or not it has a guide today, because a guide written later inherits the heading as it stands.
  const plural = (s: string) => /s$/.test(s);
  for (const k of KINDS) {
    const verb = plural(k.search) ? "are" : "is";
    const looksPlural = /\b(rentals|rooms|tours|classes|courses|charters|alleys|parks|rinks|ranges|gyms|venues|studios|resorts|halls|centers|centres|bars|lessons|rides|saunas|spas|zoos|aquariums|museums|gardens|campgrounds|breweries|wineries|distilleries|courts|pools|ziplines|arcades)\b/i.test(k.search);
    if (looksPlural) assert.equal(verb, "are", `"${k.search}" is a plural noun but the heading would say "${verb}"`);
    // A gerund or a mass noun ("Skydiving", "Paintball", "Mini golf") must not be called plural.
    if (/(?:ing|ball|golf|tag)$/i.test(k.search)) assert.equal(verb, "is", `"${k.search}" reads as singular but the heading would say "${verb}"`);
  }
});

/**
 * A page that found more than MAX_CARDS listings drew 24 cards and said nothing about it, while every other
 * number on the page kept counting the whole place. The JSON-LD was the version of that a machine reads:
 * `numberOfItems` was the full count and `itemListElement` held 24, so "Museums in the US and Canada"
 * published a list declaring 6,902 entries and then handed a crawler 24 of them. 313 of the 3,004 pages a
 * sync writes today carried that contradiction, and a guest who counted the cards found the h1 was a lie.
 *
 * The h1, the lede and the FAQ keep the real total: that is a fact about the place. The list says what the
 * list holds, and the page now says out loud that it is showing a sample and where the rest are.
 */
test("a page with more listings than it can draw counts its own list honestly and says so", () => {
  const many: Item[] = Array.from({ length: 30 }, (_, n) =>
    item("cooking", "toronto", n + 1, { area: "Toronto, ON", cover: `https://x/${n}.jpg`, from: 50 + n }),
  );
  const r = run(many);
  try {
    const html = r.read("cooking-in-toronto.html");
    assert.equal((html.match(/<a class="card"/g) || []).length, 24);
    // The list element and its own count agree, and both count the cards rather than the place.
    assert.match(html, /"numberOfItems":24/);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1].replace(/\\u003c/g, "<"));
    assert.equal(ld[0].itemListElement.length, 24);
    assert.equal(ld[0].numberOfItems, ld[0].itemListElement.length);
    // The place still has 30, and the page still says so where that is the honest number.
    assert.match(html, /30 cooking classes around Toronto/);
    assert.match(html, /Outset lists 30 cooking classes around Toronto/);
    // And the gap between the two is named on the page rather than left for the guest to find.
    assert.match(html, /Showing 24 of 30/);
  } finally {
    r.cleanup();
  }
});

test("a page that draws every listing it found claims no sample and says nothing about a rest", () => {
  const r = run(fixture);
  try {
    const html = r.read("cooking-in-toronto.html");
    assert.match(html, /"numberOfItems":3/);
    assert.doesNotMatch(html, /class="more"/);
    assert.doesNotMatch(html, /Showing \d+ of/);
  } finally {
    r.cleanup();
  }
});

/**
 * Every one of the 3,004 landing pages and 11,545 listing pages shipped without a single `og:` tag, so a link
 * to one pasted into iMessage, WhatsApp, Slack or a Discord channel previewed as the bare URL: no name, no
 * photo, no description. These are the two page shapes that exist to be shared, and the app's own index.html
 * has carried the tags since it was written, so the generated pages were the only ones without them.
 */
test("every landing page carries a social card, with its own lead photo where it has one", () => {
  const r = run(fixture);
  try {
    for (const f of r.files) {
      const html = r.read(f);
      assert.match(html, /<meta property="og:title" content="[^"]+">/, `${f} has no og:title`);
      assert.match(html, /<meta property="og:description" content="[^"]+">/, `${f} has no og:description`);
      assert.match(html, /<meta property="og:image" content="[^"]+">/, `${f} has no og:image`);
      assert.match(html, /<meta property="og:url" content="https?:[^"]+">/, `${f} has no og:url`);
      assert.match(html, /<meta name="twitter:card" content="summary(_large_image)?">/, `${f} has no twitter card`);
    }
    // A page whose lead listing has a cover offers that photo, proxied to the 1200x630 every scraper crops to,
    // and claims the large card. The title is the page's own, not the site's.
    const toronto = r.read("cooking-in-toronto.html");
    assert.match(toronto, /og:image" content="https:\/\/wsrv\.nl\/\?url=[^"]*&amp;w=1200&amp;h=630/);
    assert.match(toronto, /twitter:card" content="summary_large_image"/);
    assert.match(toronto, /og:title" content="Cooking classes in Toronto, Ontario · Outset"/);
    // A page with no photo at all falls back to the app icon and drops to the small card rather than
    // promising a large image it has not got.
    const nowhere = r.read("kayak-in-anywhere.html");
    assert.match(nowhere, /og:image" content="[^"]*apple-touch-icon\.png"/);
    assert.match(nowhere, /twitter:card" content="summary"/);
  } finally {
    r.cleanup();
  }
});

/**
 * "1638 of the 6902 operators publish prices on their own site. Starting prices run from $5 to $5,000."
 * `money` has grouped its thousands since it was written and nothing else on the page did, so the two
 * conventions sat in one sentence. Every count a person reads goes through `num` now.
 */
test("a count a person reads is grouped the way the prices beside it already were", () => {
  const many: Item[] = Array.from({ length: 1200 }, (_, n) =>
    item("cooking", "toronto", n + 1, { area: "Toronto, ON", cover: `https://x/${n}.jpg`, from: 50 }),
  );
  const r = run(many);
  try {
    const html = r.read("cooking-in-toronto.html");
    assert.match(html, /1,200 cooking classes around Toronto/);
    assert.match(html, /Outset lists 1,200 cooking classes/);
    assert.match(html, /1,200 of them have photos/);
    assert.match(html, /1,200 of the 1,200 operators publish prices/);
    assert.match(html, /Showing 24 of 1,200/);
    // The meta description a search result prints is the same sentence and counts the same way.
    assert.match(html, /<meta name="description" content="1,200 cooking classes around Toronto/);
    // No ungrouped copy of the number survives in the prose. The listing ids carry a bare "1200" and are not
    // prose, so the check is aimed at the sentences rather than the whole file.
    for (const prose of html.match(/<p class="(?:lede|more)">[^<]*/g) || []) assert.doesNotMatch(prose, /\d{4,}/);
  } finally {
    r.cleanup();
  }
});

/**
 * A page nothing links to.
 *
 * A town page is reached from its metro page's "by city" pills, from a sibling town that ranks it in its
 * nearest twelve, or from another kind in the same town. A town whose metro never qualified for that kind,
 * with no sibling near enough and nothing else to do in it, was reached by none of the three: 389 of the
 * 3,004 pages a sync writes had no link into them from anywhere on the site, and a crawler met them in
 * sitemap-pages.xml alone. Museums lost 127 pages that way and fishing 38.
 *
 * The invariant is the one the generator's own header claims in the other direction ("every internal link
 * points at a page that was written in the same run"), read back the other way: every page written in the run
 * is reached from p/index.html by following links.
 */
test("every page a run writes can be reached from p/index.html by following links", () => {
  const lone = (n: number) => item("bike", null, n, { area: "Springdale, UT", cover: `https://x/s${n}.jpg`, from: 40 });
  const r = run([...fixture, lone(1), lone(2), lone(3)]);
  try {
    // The lone town really does get a page of its own, or this test proves nothing.
    assert.ok(r.files.some((f) => /^bike-in-springdale/.test(f)), `no Springdale page among ${r.files.join(", ")}`);
    const seen = new Set(["index.html"]);
    for (const queue = ["index.html"]; queue.length; ) {
      const html = r.read(queue.shift()!);
      for (const m of html.matchAll(/href="([a-z0-9-]+\.html)"/g)) {
        if (r.files.includes(m[1]) && !seen.has(m[1])) { seen.add(m[1]); queue.push(m[1]); }
      }
    }
    assert.deepEqual(r.files.filter((f) => !seen.has(f)), [], "pages written with no link into them from anywhere");
  } finally {
    r.cleanup();
  }
});

test("the all-metros page lists every place its kind has a page for, towns as well as metros", () => {
  const lone = (n: number) => item("cooking", null, n, { area: "Springdale, UT", cover: `https://x/s${n}.jpg`, from: 40 });
  const r = run([...fixture, lone(1), lone(2), lone(3)]);
  try {
    const anywhere = r.read("cooking-in-anywhere.html");
    assert.match(anywhere, /<h2>Cooking classes by city<\/h2>/);
    // Both metros that qualified, and the town that belongs to none of them.
    assert.match(anywhere, /href="cooking-in-toronto\.html"/);
    assert.match(anywhere, /href="cooking-in-niagara\.html"/);
    assert.match(anywhere, /href="cooking-in-springdale-ut\.html"/);
  } finally {
    r.cleanup();
  }
});
