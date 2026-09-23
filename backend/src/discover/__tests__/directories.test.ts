import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTORIES, isBlockedPage, organizationLinks, ownWebsite, parseDirectoryPage, regionCode, regionNearPin } from "../directories.ts";
import { categoryById } from "../../taxonomy/catalog.ts";

const captain = DIRECTORIES.find((d) => d.id === "captainexperiences")!;
const coursehorse = DIRECTORIES.find((d) => d.id === "coursehorse")!;

const guidePage = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"10 Point Charters","address":{"@type":"PostalAddress","addressLocality":"Gloucester","addressRegion":"MA"}}</script></head>
<body><h1>10 Point Charters</h1><a href="https://use.typekit.net/x.css">font</a><a href="https://open.spotify.com/user/1">playlist</a></body></html>`;

const schoolPage = `<html><head><script type="application/ld+json">[{"@type":"Organization","name":"Drawing New York","url":"https://coursehorse.com/nyc/schools/art/new-york-city-drawing-group"},{"@type":"Place","name":"Drawing New York","address":{"@type":"PostalAddress","streetAddress":"225 East 21st Street #2","addressLocality":"New York","addressRegion":"NY","postalCode":"10010"}}]</script></head>
<body><h1>Drawing New York</h1><a href="https://www.drawingnewyork.com">Website</a></body></html>`;

test("a guide page becomes a lead with a name and a town, no website invented", () => {
  const c = parseDirectoryPage(captain, guidePage, "https://captainexperiences.com/guides/10-point-charters");
  assert.ok(c);
  assert.equal(c!.name, "10 Point Charters");
  assert.equal(c!.city, "Gloucester");
  assert.equal(c!.region, "MA");
  assert.equal(c!.website, null, "a font host and a playlist are not the guide's website");
  assert.equal(c!.domain, "captainexperiences:10-point-charters", "no website yet, so the directory page is the key");
  assert.equal(c!.kind, "fishing");
  assert.equal(c!.source, "directory");
  assert.equal(c!.directory, "captainexperiences");
});

test("a school page keeps its street address, and a link labelled Website is the school's own site", () => {
  const c = parseDirectoryPage(coursehorse, schoolPage, "https://coursehorse.com/nyc/schools/art/new-york-city-drawing-group");
  assert.ok(c);
  assert.equal(c!.name, "Drawing New York");
  assert.equal(c!.street, "225 East 21st Street #2");
  assert.equal(c!.postal, "10010");
  assert.equal(c!.website, "https://www.drawingnewyork.com");
  assert.equal(c!.domain, "drawingnewyork.com");
  assert.equal(c!.kind, "pottery", "an art school files under the art kind");
});

test("a class page names its school through its Organization url, and only school urls count", () => {
  const classPage = `<script type="application/ld+json">[{"@type":"WebSite","name":"CourseHorse","url":"https://coursehorse.com"},{"@type":"Organization","name":"Drawing New York","url":"https://coursehorse.com/nyc/schools/art/new-york-city-drawing-group/"}]</script>`;
  assert.deepEqual(organizationLinks(classPage, coursehorse.match), ["https://coursehorse.com/nyc/schools/art/new-york-city-drawing-group"]);
  assert.ok(coursehorse.hop!.from.test("https://coursehorse.com/nyc/classes/art/drawing/drawing-and-painting/sunday-open-studio1"), "an art class is worth the hop");
  assert.ok(!coursehorse.hop!.from.test("https://coursehorse.com/nyc/classes/tech/all-software/microsoft/excel/excel-bootcamp1"), "a software class is not");
});

test("a school in a category that is not an activity is left out", () => {
  const page = schoolPage.replace(/art\//g, "tech/");
  assert.equal(parseDirectoryPage(coursehorse, page, "https://coursehorse.com/nyc/schools/tech/some-bootcamp"), null);
});

test("the directory's own host and social networks are never taken as the business's website", () => {
  const html = `<html><body><a href="https://coursehorse.com/nyc/schools/art/x">x</a><a href="https://www.facebook.com/x">fb</a><a href="https://www.instagram.com/x">ig</a></body></html>`;
  assert.equal(ownWebsite(html, "https://coursehorse.com/nyc/schools/art/x"), null);
});

test("a font file linked before the word 'website' on the page is not a website; only an <a> that says so is", () => {
  const page = `<html><head><link rel="preload" href="//static.course-horse.com/fonts/noto.woff2" as="font"></head>
<body><p>Visit the school's website for more.</p><a href="https://static.course-horse.com/x.css">css</a></body></html>`;
  assert.equal(ownWebsite(page, "https://coursehorse.com/nyc/schools/art/x"), null);
  const real = page.replace("</body>", `<a href="https://www.flowerschool.com/">Website</a></body>`);
  assert.equal(ownWebsite(real, "https://coursehorse.com/nyc/schools/art/x"), "https://www.flowerschool.com/");
});

test("regions read as codes, and anywhere outside the US and Canada is null", () => {
  assert.equal(regionCode("MA"), "MA");
  assert.equal(regionCode("Massachusetts"), "MA");
  assert.equal(regionCode("British Columbia"), "BC");
  assert.equal(regionCode("Baja California"), null);
  assert.equal(regionCode(""), null);
});

test("every registry kind is a real category, so the importer never rejects a whole directory as unknown", () => {
  for (const d of DIRECTORIES) {
    assert.ok(categoryById(d.kind), `${d.id}: kind ${d.kind}`);
    if (d.id === "coursehorse") for (const k of ["cooking", "pottery", "dance", "fitness", "theatre"]) assert.ok(categoryById(k), k);
  }
});

const dropzonefinder = DIRECTORIES.find((d) => d.id === "dropzonefinder")!;
const skydivingsource = DIRECTORIES.find((d) => d.id === "skydivingsource")!;

// dropzonefinder.com/dropzones/united-states/atlanta-skydiving-center, 2026-09-23, cut to the relevant markup. The
// dropzone's JSON-LD sits HTML-escaped in a meta content attribute; the script blocks describe the directory itself.
const dropzonePage = `<html><head><meta name="application/ld+json" content="[{&quot;@context&quot;:&quot;https://schema.org&quot;,&quot;@type&quot;:[&quot;SportsActivityLocation&quot;,&quot;LocalBusiness&quot;],&quot;name&quot;:&quot;Atlanta Skydiving Center&quot;,&quot;description&quot;:&quot;See our website at www.ascskydiving.com for detailed directions.&quot;,&quot;address&quot;:{&quot;@type&quot;:&quot;PostalAddress&quot;,&quot;addressCountry&quot;:&quot;United States&quot;},&quot;geo&quot;:{&quot;@type&quot;:&quot;GeoCoordinates&quot;,&quot;latitude&quot;:34.0186944,&quot;longitude&quot;:-85.1464722},&quot;telephone&quot;:&quot;678.747.1014&quot;,&quot;email&quot;:null,&quot;url&quot;:&quot;https://dropzonefinder.com/dropzones/united-states/atlanta-skydiving-center&quot;,&quot;sameAs&quot;:[&quot;https://ascskydiving.com&quot;],&quot;priceRange&quot;:&quot;$$&quot;}]"/>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"DropzoneFinder","url":"https://dropzonefinder.com","sameAs":[]}</script></head>
<body><h1>Atlanta Skydiving Center</h1><a href="tel:678.747.1014">678.747.1014</a><a href="https://ascskydiving.com" target="_blank" rel="noopener noreferrer">Visit the website</a>
<a href="https://apps.apple.com/app/skydive-compass/id6751343815">App Store</a><p>Tandem jumps from 195 USD</p></body></html>`;

test("a DropzoneFinder page is read from the JSON-LD the site escaped into a meta tag: name, phone, pin, own site", () => {
  const c = parseDirectoryPage(dropzonefinder, dropzonePage, "https://dropzonefinder.com/dropzones/united-states/atlanta-skydiving-center");
  assert.ok(c);
  assert.equal(c!.name, "Atlanta Skydiving Center");
  assert.equal(c!.website, "https://ascskydiving.com", "sameAs in the dropzone's own block, not the App Store link");
  assert.equal(c!.domain, "ascskydiving.com");
  assert.equal(c!.phone, "+16787471014");
  assert.equal(c!.lat, 34.0186944);
  assert.equal(c!.city, null, "the page names no town, and none is invented");
  assert.equal(c!.region, "GA", "the state comes off the pin: Atlanta is the nearest grid city and the next agrees");
  assert.equal(c!.kind, "skydive");
  assert.equal(c!.directory, "dropzonefinder");
});

test("a DropzoneFinder page with no dropzone block is not a business, and a border pin gets no state", () => {
  const hub = `<html><head><script type="application/ld+json">{"@type":"Organization","name":"DropzoneFinder","url":"https://dropzonefinder.com"}</script></head><body><h1>Skydiving in Canada</h1><a href="https://apps.apple.com/x">app</a></body></html>`;
  assert.equal(parseDirectoryPage(dropzonefinder, hub, "https://dropzonefinder.com/dropzones/canada"), null);
  assert.equal(regionNearPin(42.78, -71.08), null, "Haverhill: Portsmouth NH and Boston MA are both about 45 km off, so no state is guessed");
  assert.equal(regionNearPin(49.555, -96.685), "MB", "Steinbach: Winnipeg alone is in range");
  assert.equal(regionNearPin(39.27, -103.67), "CO", "Limon: Colorado Springs, then Denver, both Colorado");
  assert.equal(regionNearPin(0, 0), null);
  assert.ok(dropzonefinder.match.test("https://dropzonefinder.com/dropzones/canada/adventure-skydiving"));
  assert.ok(!dropzonefinder.match.test("https://dropzonefinder.com/dropzones/canada/cities/toronto"), "a city hub is not a dropzone");
  assert.ok(!dropzonefinder.match.test("https://dropzonefinder.com/dropzones/australia/skydive-cairns"), "outside the market");
});

// skydivingsource.com/locations/des-moines-skydivers/, 2026-09-23, cut to the relevant markup. Microdata carries the
// address; the website is text under "Website:", not a link.
const sourcePage = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":"3","item":{"@id":"https://skydivingsource.com/locations/des-moines-skydivers/","name":"Des Moines Skydivers"}}]}]}</script></head>
<body><article class="post-161 dropzones type-dropzones status-publish hentry state-iowa country-usa continent-north-america">
<div itemscope itemtype="http://schema.org/LocalBusiness"><meta itemprop="name" content="Des Moines Skydivers">
<span itemprop="address" itemscope="" itemtype="http://schema.org/PostalAddress"><meta itemprop="streetAddress"
                      content="1563 IA-14 "><meta itemprop="addressLocality"
                      content="Knoxville"><meta itemprop="addressRegion" content="Iowa"><meta itemprop="postalCode" content="50138"><meta itemprop="addressCountry"
                      content="USA"></span>
<span itemprop="geo" itemscope="" itemtype="http://schema.org/GeoCoordinates"><meta itemprop="latitude"
                      content="41.298"><meta itemprop="longitude"
                      content="-93.113"></span><meta itemprop="telephone" content="(515) 243-1711"></div>
<h2>Contact Info</h2><p><strong><i class="fa fa-phone"></i> Phone:</strong><br>(515) 243-1711</p>
<p><strong><i class="fa fa-globe"></i> Website:</strong><br>www.dmskydivers.com</p>
<p><strong>Email:</strong><br>info@desmoinesskydivers.com</p><p>Tandem: $290</p></article>
<a href="https://twitter.com/SkydivingSource">Twitter</a></body></html>`;

test("a Skydiving Source page is read from its microdata, and the text under 'Website:' is the dropzone's own site", () => {
  const c = parseDirectoryPage(skydivingsource, sourcePage, "https://skydivingsource.com/locations/des-moines-skydivers/");
  assert.ok(c);
  assert.equal(c!.name, "Des Moines Skydivers");
  assert.equal(c!.street, "1563 IA-14");
  assert.equal(c!.city, "Knoxville");
  assert.equal(c!.region, "IA");
  assert.equal(c!.postal, "50138");
  assert.equal(c!.phone, "+15152431711");
  assert.equal(c!.website, "https://www.dmskydivers.com");
  assert.equal(c!.domain, "dmskydivers.com");
  assert.equal(c!.kind, "skydive");
  assert.equal(c!.directory, "skydivingsource");
});

test("a Skydiving Source page outside the market, or with no dropzone microdata, is not a lead", () => {
  const abroad = sourcePage.replace("country-usa", "country-australia").replace('content="Iowa"', 'content="Victoria"');
  const c = parseDirectoryPage(skydivingsource, abroad, "https://skydivingsource.com/locations/skydive-x/");
  assert.ok(c);
  assert.equal(c!.region, null, "a state name from another country never reads as a US or Canadian code");
  const article = `<html><body><article class="post-1 type-post"><h1>How Much Does Skydiving Cost?</h1><p><strong>Website:</strong><br>www.example.com</p></article></body></html>`;
  assert.equal(parseDirectoryPage(skydivingsource, article, "https://skydivingsource.com/locations/how-much/"), null);
  const noSite = sourcePage.replace("www.dmskydivers.com", "N/A");
  assert.equal(parseDirectoryPage(skydivingsource, noSite, "https://skydivingsource.com/locations/des-moines-skydivers/")!.website, null);
  const social = sourcePage.replace("www.dmskydivers.com", "https://www.facebook.com/dmskydivers");
  assert.equal(parseDirectoryPage(skydivingsource, social, "https://skydivingsource.com/locations/des-moines-skydivers/")!.website, null, "a social page is not a website");
  assert.ok(skydivingsource.childMatch!.test("https://skydivingsource.com/dropzones-sitemap3.xml"));
  assert.ok(!skydivingsource.childMatch!.test("https://skydivingsource.com/post-sitemap.xml"), "articles are not dropzones");
});

test("a rate-limit redirect or a challenge body is the site saying stop, whatever the status code", () => {
  assert.ok(isBlockedPage({ status: 200, html: "<html>...</html>", finalUrl: "https://captainexperiences.com/rate-limit?redirect_to=https%3A%2F%2Fcaptainexperiences.com%2Fguides%2Fx" }));
  assert.ok(isBlockedPage({ status: 200, html: "<title>Just a moment...</title>", finalUrl: "https://classbento.com/x" }));
  assert.ok(isBlockedPage({ status: 429, html: "", finalUrl: "https://x.com/y" }));
  assert.ok(!isBlockedPage({ status: 200, html: "<html><h1>10 Point Charters</h1></html>", finalUrl: "https://captainexperiences.com/guides/10-point-charters" }));
});
