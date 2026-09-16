import { test } from "node:test";
import assert from "node:assert/strict";
import { tockRef } from "../vendors/tock.ts";

// Tock serves every page behind a Cloudflare challenge (see vendors/tock.ts), so there is no fixture; only the URL and
// embed parser, which reads the operator's own site, is pinned here.

test("tockRef reads the business slug and experience ids from links and tock.js embeds", () => {
  assert.deepEqual(tockRef("https://www.exploretock.com/somewinery"), { business: "somewinery", experiences: [] });
  assert.deepEqual(tockRef("https://exploretock.com/somewinery/experience/123456/estate-tasting"), {
    business: "somewinery",
    experiences: [{ id: "123456", slug: "estate-tasting", url: "https://www.exploretock.com/somewinery/experience/123456/estate-tasting" }],
  });
  assert.deepEqual(tockRef("https://www.exploretock.com/somewinery/event/98765"), {
    business: "somewinery",
    experiences: [{ id: "98765", slug: null, url: "https://www.exploretock.com/somewinery/experience/98765" }],
  });
  assert.deepEqual(
    tockRef(`<script>Tock('init', 'somewinery');</script><button data-tock-experience="777">Book</button><a href="https://www.exploretock.com/somewinery/experience/123456/estate-tasting">Tasting</a>`),
    {
      business: "somewinery",
      experiences: [
        { id: "123456", slug: "estate-tasting", url: "https://www.exploretock.com/somewinery/experience/123456/estate-tasting" },
        { id: "777", slug: null, url: "https://www.exploretock.com/somewinery/experience/777" },
      ],
    },
  );
  // Experiences of a second business on the same page are not mixed into the first.
  assert.deepEqual(tockRef("https://www.exploretock.com/somewinery https://www.exploretock.com/otherplace/experience/1/x"), { business: "somewinery", experiences: [] });
  assert.equal(tockRef("https://www.exploretock.com/city/san-francisco"), null);
  assert.equal(tockRef("https://www.exploretock.com/widget/experiences"), null);
  assert.equal(tockRef("https://fareharbor.com/embeds/book/x/"), null);
});
