/**
 * The outreach list: every operator we can email, with what their page already holds and which booking software
 * they use, so the email can say the true thing about it. Writes backend/data/outreach-list.csv (ignored by git;
 * it holds email addresses and must never be committed). Read-only against the database, no network.
 *
 *   npx tsx scripts/outreach-list.mts
 *
 * quality = "good" when the page has a cover, three or more photos, a priced menu, and reviews (five or more public
 * ones, or at least one written review copied from their site). Send those first, highest score first.
 */
import "../src/env.ts";
import { writeFileSync } from "node:fs";
import { db } from "../src/db/client.ts";
import { detectVendor } from "../src/enrich/vendors.ts";
import { catalogId, vendorLabel, vendorLine } from "../src/outreach/drafts.ts";
import { emailHash, recordedLocally } from "../src/lib/unsub.ts";

/**
 * The suppression list stores a hash of an address and never the address, so it cannot be joined to in SQL.
 * This used to read `lower(trim(o.email)) not in (select email from mail_unsub)`: mail_unsub has no `email`
 * column, so SQLite resolved that name against the outer query, the subquery became `select o.email` once
 * per suppressed row, and the clause read "keep this operator only if its stored address is not already
 * lower-cased and trimmed". Empty it let everyone through and suppressed nobody; with one row in it, it
 * dropped every operator whose address was stored tidily, which is nearly all of them.
 */
const suppressed = recordedLocally();

type Row = Record<string, string | number | null>;
const ops = db.prepare(`
  select o.id, o.name, o.domain, o.website, lower(trim(o.email)) as email, o.phone, o.city, o.region, o.country, o.family, o.category_id, o.calendar_vendor, o.review_count, o.rating,
    (select count(*) from offerings f where f.operator_id=o.id and f.price_cents is not null) as priced_lines,
    (select count(distinct name) from offerings f where f.operator_id=o.id and f.price_cents is not null) as priced_services,
    (select count(*) from offerings f where f.operator_id=o.id and f.confidence='widget') as widget_lines,
    (select count(*) from facts f where f.operator_id=o.id and f.fact_key='photo') as photos,
    (case when exists (select 1 from facts f where f.operator_id=o.id and f.fact_key='cover') then 1 else 0 end) as has_cover,
    (select count(*) from facts f where f.operator_id=o.id and f.fact_key='review') as written_reviews,
    (case when exists (select 1 from facts f where f.operator_id=o.id and f.fact_key='cancellation') then 1 else 0 end) as has_cancellation,
    (case when exists (select 1 from facts f where f.operator_id=o.id and f.fact_key in ('hours_text','hours')) then 1 else 0 end) as has_hours
  from operators o
  where o.origin not in ('demo','test') and o.email like '%@%' and o.website is not null and o.country in ('US','CA')
    -- Museums, theme parks, waterparks, aquariums and zoos are large, professionally-run institutions, not
    -- the small local operators this pitch is written for (free 5%-commission listing, cold email to a
    -- generic inbox): checked 22 September 2026, this exact ordering put Disney Springs, the 9/11 Memorial,
    -- MoMA, Busch Gardens and Kennedy Space Center at the very top, by category_id, 41+17+7+5+2 of them.
    and (o.category_id is null or o.category_id not in ('museum','themepark','waterpark','aquarium','zoo'))
    -- category_id alone still missed real institutions filed under an ordinary-looking one: the Gateway
    -- Arch under "cruise" for its dinner boat, Biltmore under "garden", the Museum of Flight under "heli".
    -- .org/.gov/.edu is the next cheap, high-signal cut: a for-profit local activity business is essentially
    -- always a .com, and every one of those three institutions is exactly one of the other three.
    and o.domain not like '%.org' and o.domain not like '%.gov' and o.domain not like '%.edu'
    -- A backstop, not the primary filter: a real small operator (a busy charter, a well-known tour company)
    -- can genuinely reach the high five figures, but above this the catalog is either an institution the
    -- filters above missed or a scrape that matched the wrong business's review count, like the "cruise"-
    -- categorized listing that came in at 115,429 reviews for a four-tour swamp company.
    and (o.review_count is null or o.review_count <= 20000)`).all() as Row[];
const urlFacts = db.prepare("select operator_id, fact_key, fact_value from facts where fact_key in ('booking_url','online_booking','booking_software','booking_vendor','widget_url')").all() as { operator_id: string; fact_key: string; fact_value: string }[];
const byOp = new Map<string, string[]>();
for (const f of urlFacts) { const a = byOp.get(f.operator_id) || []; a.push(f.fact_value); byOp.set(f.operator_id, a); }
const KNOWN = new Set(["fareharbor","peek","xola","bookeo","checkfront","rezdy","square","acuity","burblesoft","tock","vallypro","resova","rezgo","booksy","simplybook","mindbody","calendly","opentable","resy","eventbrite","viator","getyourguide"]);
let detected = 0;
const out: Row[] = [];
for (const o of ops) {
  if (suppressed.has(emailHash(String(o.email)))) continue;
  let vendor = String(o.calendar_vendor || "");
  const vals = byOp.get(String(o.id)) || [];
  if (!vendor) {
    for (const v of vals) { const d = /^https?:/i.test(v) ? detectVendor(v) : null; if (d) { vendor = d; detected++; break; } }
    if (!vendor) for (const v of vals) { const t = v.toLowerCase().trim(); if (KNOWN.has(t)) { vendor = t; detected++; break; } }
  }
  const reviews = Number(o.review_count) || 0;
  const good = o.has_cover === 1 && Number(o.photos) >= 3 && Number(o.priced_lines) >= 1 && (reviews >= 5 || Number(o.written_reviews) >= 1);
  const score = (o.has_cover as number) * 3 + Math.min(Number(o.priced_lines), 5) + (Number(o.widget_lines) > 0 ? 3 : 0) + Math.min(Number(o.photos), 6) / 2 + (reviews >= 5 ? 2 : 0) + (Number(o.written_reviews) > 0 ? 2 : 0) + (o.has_cancellation as number) + (o.has_hours as number);
  out.push({ ...o, booking_software: vendor || "", booking_software_name: vendorLabel(vendor) || "", vendor_line: vendorLine(vendor, Number(o.widget_lines) > 0) || "", quality: good ? "good" : "", listing_url: "https://onoutset.com/#o=" + catalogId(String(o.domain)), score: Math.round(score * 10) / 10 });
}
out.sort((a, b) => (b.quality === "good" ? 1 : 0) - (a.quality === "good" ? 1 : 0) || Number(b.score) - Number(a.score) || (Number(b.review_count) || 0) - (Number(a.review_count) || 0));
const cols = ["quality","score","name","email","booking_software","booking_software_name","vendor_line","priced_services","priced_lines","widget_lines","photos","has_cover","review_count","rating","written_reviews","has_cancellation","has_hours","city","region","country","family","category_id","phone","website","domain","listing_url","id"];
const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
writeFileSync(new URL("../data/outreach-list.csv", import.meta.url), [cols.join(","), ...out.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n");
const good = out.filter((r) => r.quality === "good");
// The outreach-ready subset alone: a cover, three or more photos, a priced menu, and reviews. Everything in
// it has a working listing link, a real phone or email, and its own true "keep your setup" line when a
// booking vendor was detected.
writeFileSync(new URL("../data/outreach-list-good.csv", import.meta.url), [cols.join(","), ...good.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n");
const counts = new Map<string, number>(); for (const r of good) counts.set(String(r.booking_software) || "(none found)", (counts.get(String(r.booking_software) || "(none found)") || 0) + 1);
console.log(JSON.stringify({ rows: out.length, good: good.length, vendorNewlyDetected: detected, goodByVendor: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 14) }, null, 1));
