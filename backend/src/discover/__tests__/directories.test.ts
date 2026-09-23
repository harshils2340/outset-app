import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTORIES, organizationLinks, ownWebsite, parseDirectoryPage, regionCode } from "../directories.ts";
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
