import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleText, selectPages } from "../crawl.ts";

// 416jetskis.ca/pricing, 2026-09-14: a Next.js rate card where every dollar amount sits in <strong> with a React comment marker.
const PRICING = `<html><head><title>Pricing — Toronto Jet Ski Rental Rates | 416 Jet Skis</title></head><body>
<nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
<main><h1>Rental rates</h1><p>Weekday and weekend pricing. Book hourly slots online — contact us for longer rentals.</p>
<section class="pricing-rates-grid"><article class="price-card"><h3>Weekdays</h3><ul>
<li><span>Hourly</span><strong>$<!-- -->130</strong></li><li><span>4 hours</span><strong>$<!-- -->375</strong></li><li><span>8 hours</span><strong>$<!-- -->550</strong></li></ul></article>
<article class="price-card"><h3>Weekends</h3><ul>
<li><span>Hourly</span><strong>$<!-- -->150</strong></li><li><span>4 hours</span><strong>$<!-- -->450</strong></li></ul></article></section>
<p>Price: <b>$99</b> per <em>person</em>, <a href="/book">book now</a>.</p>
<div><span>Adult</span><span class="price">$45</span><div>Includes a life jacket</div></div>
</main><footer>© 2026 416 Jet Skis</footer></body></html>`;

test("prices inside inline tags stay on the line that names them", () => {
  const { title, text } = visibleText(PRICING);
  assert.equal(title, "Pricing — Toronto Jet Ski Rental Rates | 416 Jet Skis");
  const lines = text.split("\n");
  assert.ok(lines.includes("Hourly $130"), text);
  assert.ok(lines.includes("4 hours $375"), text);
  assert.ok(lines.includes("Hourly $150"), text);
  assert.ok(lines.includes("Price: $99 per person, book now."), text);
  assert.ok(lines.includes("Adult $45"), text);
  assert.ok(lines.includes("Includes a life jacket"), text);
  // Navigation and the footer are chrome, not content.
  assert.ok(!text.includes("Home"), text);
  assert.ok(!text.includes("© 2026"), text);
});

test("a page that prints prices outranks a page that does not", () => {
  const pages = [
    { url: "https://x.example/", title: "Home", text: "Welcome to our jet skis.\nWe are on the water every day.\nCall us to ride.\n".repeat(8) },
    { url: "https://x.example/pricing", title: "Pricing", text: visibleText(PRICING).text },
  ];
  const picked = selectPages(pages);
  assert.equal(picked[0].url, "https://x.example/pricing");
  assert.ok(picked[0].text.includes("Hourly $130"));
});
