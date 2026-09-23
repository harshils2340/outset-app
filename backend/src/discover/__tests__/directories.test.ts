import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTORIES, isBlockedPage, organizationLinks, ownWebsite, parseDirectoryPage, parseDirectoryPageAll, regionCode, regionNearPin } from "../directories.ts";
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

const indoorclimbing = DIRECTORIES.find((d) => d.id === "indoorclimbing")!;
const watl = DIRECTORIES.find((d) => d.id === "watl")!;

// indoorclimbing.com/florida.html, 2026-09-23, cut to three gyms. No structured data: a <p> per gym, the town in
// the <div class="city"> above it, the site as a nofollow link whose text is the name.
const climbingPage = `<html><body><div id="content"><h1>Florida</h1><h2>Climbing Gyms</h2>
<div class="city">Atlantic Beach</div>
<p><b>Beaches Rock Gym - Atlantic Beach</b><br>
14 W. 3rd Street, Atlantic Beach, FL<br>
904-222-0707<br>
<a rel='nofollow' target='_blank' href='https://www.beachesrockgym.com/'>Beaches Rock Gym - Atlantic Beach</a><br>
<span class='rt'></span> Open-air bouldering gym. All ages welcome.</p>
<div class="city">Orlando</div>
<p><b>Blue Swan Boulders</b><br>
400 Pittman St, Orlando, FL 32801<br>
(407) 601-0752<br>
<a rel='nofollow' target='_blank' href='https://blueswanboulders.com/'>Blue Swan Boulders</a><br>
<span class='rt'></span> A 15,000-sq/ft bouldering gym.</p>

<p><b>Central Rock</b><br>
1766 W Sand Lake Rd, Orlando, Florida<br>
407-601-0399<br>
<a rel='nofollow' target='_blank' href='https://www.facebook.com/centralrock'>Central Rock</a><br>
<span class='rt'></span> Bouldering with a yoga studio.</p>
</div></body></html>`;

test("an indoorclimbing.com state page yields every gym on it: name, street, town, state, phone and own site", () => {
  const cs = parseDirectoryPageAll(indoorclimbing, climbingPage, "https://www.indoorclimbing.com/florida.html");
  assert.equal(cs.length, 3);
  assert.equal(cs[0].name, "Beaches Rock Gym - Atlantic Beach");
  assert.equal(cs[0].street, "14 W. 3rd Street");
  assert.equal(cs[0].city, "Atlantic Beach");
  assert.equal(cs[0].region, "FL");
  assert.equal(cs[0].postal, null);
  assert.equal(cs[0].phone, "+19042220707");
  assert.equal(cs[0].website, "https://www.beachesrockgym.com/");
  assert.equal(cs[0].domain, "beachesrockgym.com");
  assert.equal(cs[0].kind, "climbing");
  assert.equal(cs[0].directory, "indoorclimbing");
  assert.equal(cs[1].city, "Orlando", "the town is the heading the paragraph sits under");
  assert.equal(cs[1].postal, "32801");
  assert.equal(cs[2].region, "FL", "the state written out in full still agrees with the page");
  assert.equal(cs[2].website, null, "a Facebook page is not the gym's website");
  assert.equal(cs[2].domain, "indoorclimbing:central-rock", "keyed by name, not by the shared page");
});

test("an indoorclimbing.com page only places a gym when the address line agrees with the page's state, and only market pages match", () => {
  const ontario = `<div class="city">Aurora</div><p><b>Reach Indoor Climbing</b><br>
212 Earl Stewart Dr, Aurora, ON L4G 6V7, Canada<br>
+19057508500<br>
<a rel='nofollow' target='_blank' href='https://reachindoorclimbing.ca/'>Reach Indoor Climbing</a><br></p>
<p><b>Somewhere Else</b><br>
1 Main St, Springfield, IL 62701<br>
217-555-0100<br>
<a rel='nofollow' target='_blank' href='https://example.org/'>Somewhere Else</a><br></p>`;
  const cs = parseDirectoryPageAll(indoorclimbing, ontario, "https://www.indoorclimbing.com/ontario.html");
  assert.equal(cs.length, 2);
  assert.equal(cs[0].region, "ON");
  assert.equal(cs[0].postal, "L4G 6V7");
  assert.equal(cs[0].street, "212 Earl Stewart Dr");
  assert.equal(cs[1].region, null, "an Illinois address on the Ontario page is a gap, not Ontario");
  assert.ok(indoorclimbing.match.test("https://www.indoorclimbing.com/britishcolumbia.html"));
  assert.ok(!indoorclimbing.match.test("https://www.indoorclimbing.com/england.html"), "outside the market");
  assert.ok(!indoorclimbing.match.test("https://www.indoorclimbing.com/climbing_gear.html"), "an article, not a gym list");
  assert.ok(!indoorclimbing.match.test("https://www.indoorclimbing.com/worldgyms.html"), "the world hub repeats the state pages");
});

// worldaxethrowingleague.com/affiliates/, 2026-09-23, cut to three cards. The whole list is one page; a card is
// the name, a region with its country, and the venue's site as the card link. One card has no link.
const watlPage = `<html><body><ul class="wm-grid">
<li class="wm-card" data-name="abilene axe company" data-city="texas" data-country="united states" data-id="15028">
  <a class="wm-card__inner" href="https://abileneaxeco.com" target="_blank" rel="noopener">
    <div class="wm-card__logo"><img src="https://worldaxethrowingleague.com/wp-content/uploads/2023/06/logo-150x150.png" alt="Abilene Axe Company"></div>
    <h3 class="wm-card__name">Abilene Axe Company</h3>
    <p class="wm-card__loc"><span class="wm-card__loc-region">Texas</span><span class="wm-card__loc-country">, United States</span></p>
    <span class="wm-card__link">Visit website</span>
  </a>
</li>
<li class="wm-card" data-name="axes &#038; antics goshen" data-city="indiana" data-country="united states" data-id="19943">
  <div class="wm-card__inner"><h3 class="wm-card__name">Axes &#038; Antics Goshen</h3>
    <p class="wm-card__loc"><span class="wm-card__loc-region">Indiana</span><span class="wm-card__loc-country">, United States</span></p></div>
</li>
<li class="wm-card" data-name="reeast room" data-city="tokyo" data-country="japan" data-id="17001">
  <a class="wm-card__inner" href="https://reeast.jp/" target="_blank" rel="noopener"><h3 class="wm-card__name">REEAST ROOM</h3>
    <p class="wm-card__loc"><span class="wm-card__loc-region">Tokyo</span><span class="wm-card__loc-country">, Japan</span></p></a>
</li>
<li class="wm-card" data-name="far shot" data-city="ontario" data-country="canada" data-id="17002">
  <a class="wm-card__inner" href="https://www.farshot.ca/" target="_blank" rel="noopener"><h3 class="wm-card__name">Far Shot Recreation</h3>
    <p class="wm-card__loc"><span class="wm-card__loc-region">Ontario</span><span class="wm-card__loc-country">, Canada</span></p></a>
</li></ul></body></html>`;

test("the WATL affiliates page yields every venue card: name, state or province, own site; no town is invented", () => {
  const cs = parseDirectoryPageAll(watl, watlPage, "https://worldaxethrowingleague.com/affiliates/");
  assert.equal(cs.length, 4);
  assert.equal(cs[0].name, "Abilene Axe Company");
  assert.equal(cs[0].region, "TX");
  assert.equal(cs[0].city, null, "the page names no town");
  assert.equal(cs[0].website, "https://abileneaxeco.com");
  assert.equal(cs[0].domain, "abileneaxeco.com");
  assert.equal(cs[0].kind, "axe");
  assert.equal(cs[0].directory, "watl");
  assert.equal(cs[1].name, "Axes & Antics Goshen");
  assert.equal(cs[1].website, null);
  assert.equal(cs[1].domain, "watl:axes-antics-goshen", "no link on the card, so the name is the key");
  assert.equal(cs[1].region, "IN");
  assert.equal(cs[2].region, null, "Japan is outside the market, whatever the card says");
  assert.equal(cs[3].region, "ON");
  assert.equal(cs[3].website, "https://www.farshot.ca/");
  assert.ok(watl.match.test("https://worldaxethrowingleague.com/affiliates/"));
  assert.ok(!watl.match.test("https://worldaxethrowingleague.com/community-venues/"));
});
