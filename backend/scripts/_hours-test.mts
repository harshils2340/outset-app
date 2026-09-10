import { harvestHours } from "../src/enrich/hoursMarkup.ts";
import { encodeWeek } from "../src/sync/hours.ts";

const SITES = [
  "https://www.skydivehouston.com/",
  "https://aaajetski.com/",
  "https://www.hawaiianparasail.com/",
  "https://www.sunsetwatersportskeywest.com/",
  "https://www.k1speed.com/",
  "https://www.bowlero.com/",
  "https://www.escapetheroomaz.com/",
  "https://www.bigairusa.com/",
];

// Offline fixtures first, so the parser is checked even when the network is not.
const FIXTURES: [string, string][] = [
  ["jsonld-objects", `<script type="application/ld+json">{"@type":"LocalBusiness","openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday","Wednesday","Thursday","Friday"],"opens":"09:00","closes":"17:00"},{"dayOfWeek":"https://schema.org/Saturday","opens":"10:00:00","closes":"16:00:00"},{"dayOfWeek":"Sunday","opens":"00:00","closes":"00:00"}]}</script>`],
  ["jsonld-strings", `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Store","openingHours":["Mo-Fr 09:00-17:00","Sa 10:00-16:00"]}]}</script>`],
  ["microdata", `<div itemscope itemtype="http://schema.org/LocalBusiness"><time itemprop="openingHours" datetime="Tu-Su 11:00-23:00">Tue-Sun 11am-11pm</time></div>`],
  ["text", `<html><body><h3>Hours</h3><ul><li>Monday - Thursday: 10am - 9pm</li><li>Fri &amp; Sat: 10am-11pm</li><li>Sunday: Closed</li></ul></body></html>`],
  ["text-daily", `<html><body><p>We're open daily 8:00 AM to 6:00 PM, weather permitting.</p></body></html>`],
];
for (const [name, html] of FIXTURES) {
  const lines = harvestHours(html);
  console.log(`[fixture ${name}]`, JSON.stringify(lines), JSON.stringify(encodeWeek(lines)));
}

for (const url of SITES) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let html = "";
  let status = 0;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "text/html" }, signal: ctrl.signal, redirect: "follow" });
    status = r.status;
    html = await r.text();
  } catch (e) {
    console.log(`\n== ${url}\n  fetch failed: ${String(e).slice(0, 120)}`);
    continue;
  } finally {
    clearTimeout(timer);
  }
  if (process.env.HOURS_DUMP) await import("node:fs").then((fs) => fs.writeFileSync(`${process.env.HOURS_DUMP}/${new URL(url).hostname}.html`, html));
  const lines = harvestHours(html);
  console.log(`\n== ${url} (${status}, ${html.length} bytes)`);
  console.log("  lines:", lines.length ? lines.join(" | ") : "(none)");
  console.log("  week: ", JSON.stringify(encodeWeek(lines)));
}
