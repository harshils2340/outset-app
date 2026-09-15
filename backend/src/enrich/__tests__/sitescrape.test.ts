import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
import { harvestPrices } from "../sitescrape.ts";

// A rate card that names tiers only. The service is what the page is about, and the group heading qualifies the tier.
const PRICING = `<html><head><title>Pricing — Toronto Jet Ski Rental Rates | 416 Jet Skis</title></head><body>
<main><h1>Rental rates</h1>
<section><article><h3>Weekdays</h3><ul>
<li><span>Hourly</span><strong>$<!-- -->130</strong></li><li><span>4 hours</span><strong>$<!-- -->375</strong></li><li><span>8 hours</span><strong>$<!-- -->550</strong></li></ul></article>
<article><h3>Weekends</h3><ul>
<li><span>Hourly</span><strong>$<!-- -->150</strong></li><li><span>4 hours</span><strong>$<!-- -->450</strong></li></ul></article></section>
</main></body></html>`;

test("tier-only rate cards attach to the activity the page sells", () => {
  const out = new Map();
  harvestPrices(load(PRICING), "https://416jetskis.ca/pricing", out, new Map());
  const svc = out.get("jet ski rental");
  assert.ok(svc, JSON.stringify([...out.keys()]));
  const tiers = Object.fromEntries((svc.variants || []).map((v: { label: string; price: number }) => [v.label, v.price]));
  assert.equal(tiers["Weekdays Hourly"], 130, JSON.stringify(tiers));
  assert.equal(tiers["Weekdays 4 hours"], 375, JSON.stringify(tiers));
  assert.equal(tiers["Weekends Hourly"], 150, JSON.stringify(tiers));
  assert.equal(svc.price, 130);
});

test("a rate table with no heading above it still belongs to the page's activity", () => {
  const html = `<html><head><title>Rates | Bay Kayak Co</title></head><body><main>
<table><tr><td>Single kayak</td><td>$25/hr</td></tr><tr><td>Tandem kayak</td><td>$40/hr</td></tr></table></main></body></html>`;
  const out = new Map();
  harvestPrices(load(html), "https://baykayak.example/rates", out, new Map());
  const svc = out.get("kayak rental");
  assert.ok(svc, JSON.stringify([...out.keys()]));
  assert.deepEqual((svc.variants || []).map((v: { label: string; price: number }) => v.price).sort(), [25, 40]);
});
