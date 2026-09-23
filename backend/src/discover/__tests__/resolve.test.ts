import { test } from "node:test";
import assert from "node:assert/strict";
import { nameOverlap, pickMatch, usableWebsite } from "../resolve.ts";

const lead = { name: "10 Point Charters", city: "Gloucester", region: "MA" };

test("the same business in the same town with its own website is the match", () => {
  const m = pickMatch(lead, [
    { title: "10 Point Charters", address: "Harbor Loop, Gloucester, MA 01930", website: "https://www.10pointcharters.com" },
    { title: "Gloucester Bait & Tackle", address: "Main St, Gloucester, MA", website: "https://gbait.com" },
  ]);
  assert.equal(m?.website, "https://www.10pointcharters.com/");
});

test("a result in another state is not the match, even with the same name", () => {
  assert.equal(pickMatch(lead, [{ title: "10 Point Charters", address: "Key West, FL 33040", website: "https://tenpoint.fl" }]), null);
});

test("a website that is a social page or another marketplace does not count as the business's own", () => {
  assert.equal(usableWebsite("https://www.facebook.com/10pointcharters"), null);
  assert.equal(usableWebsite("https://fishingbooker.com/charters/view/1"), null);
  assert.equal(usableWebsite("10pointcharters.com"), "https://10pointcharters.com/");
  assert.equal(pickMatch(lead, [{ title: "10 Point Charters", address: "Gloucester, MA", website: "https://www.facebook.com/x" }]), null);
});

test("two plausible results is ambiguity, and ambiguity is no match", () => {
  const m = pickMatch(lead, [
    { title: "10 Point Charters", address: "Gloucester, MA", website: "https://a.com" },
    { title: "10 Point Charters LLC", address: "Gloucester, MA", website: "https://b.com" },
  ]);
  assert.equal(m, null);
});

test("name overlap ignores filler words and needs most of the distinctive ones", () => {
  assert.ok(nameOverlap("Legasea Life LLC", "Legasea Life Fishing Charters") >= 0.99);
  assert.ok(nameOverlap("Going Deep Charters", "Deep Sea Charters") < 0.6);
  assert.equal(nameOverlap("The Fishing Guide Service", "Anything"), 0, "a name that is all filler matches nothing");
});
