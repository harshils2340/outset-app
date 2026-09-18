import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KINDS, MIN_METRO_LISTINGS, buildFaq, pageTitle, publicSite, writeLandingPages, type Item } from "../pages.ts";
import { METROS } from "../../taxonomy/catalog.ts";
import { ART_ALIASES } from "../../../../src/data/synonyms.ts";

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
  const sitemap = readFileSync(join(dir, "sitemap.xml"), "utf8");
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
    assert.match(html, /<img src="https:\/\/x\/1\.jpg"/);
    assert.match(html, /From <b>\$60<\/b>/);
    assert.match(html, /From <b>\$140<\/b>/);
    assert.match(html, /href="https:\/\/onoutset\.com\/#o=o-cooking-toronto-1"/);
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
