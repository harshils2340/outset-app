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
import { vendorLabel, vendorLine } from "../src/outreach/drafts.ts";

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
    and lower(trim(o.email)) not in (select email from mail_unsub)`).all() as Row[];
const urlFacts = db.prepare("select operator_id, fact_key, fact_value from facts where fact_key in ('booking_url','online_booking','booking_software','booking_vendor','widget_url')").all() as { operator_id: string; fact_key: string; fact_value: string }[];
const byOp = new Map<string, string[]>();
for (const f of urlFacts) { const a = byOp.get(f.operator_id) || []; a.push(f.fact_value); byOp.set(f.operator_id, a); }
const KNOWN = new Set(["fareharbor","peek","xola","bookeo","checkfront","rezdy","square","acuity","burblesoft","tock","vallypro","resova","rezgo","booksy","simplybook","mindbody","calendly","opentable","resy","eventbrite","viator","getyourguide"]);
let detected = 0;
const out: Row[] = [];
for (const o of ops) {
  let vendor = String(o.calendar_vendor || "");
  const vals = byOp.get(String(o.id)) || [];
  if (!vendor) {
    for (const v of vals) { const d = /^https?:/i.test(v) ? detectVendor(v) : null; if (d) { vendor = d; detected++; break; } }
    if (!vendor) for (const v of vals) { const t = v.toLowerCase().trim(); if (KNOWN.has(t)) { vendor = t; detected++; break; } }
  }
  const reviews = Number(o.review_count) || 0;
  const good = o.has_cover === 1 && Number(o.photos) >= 3 && Number(o.priced_lines) >= 1 && (reviews >= 5 || Number(o.written_reviews) >= 1);
  const score = (o.has_cover as number) * 3 + Math.min(Number(o.priced_lines), 5) + (Number(o.widget_lines) > 0 ? 3 : 0) + Math.min(Number(o.photos), 6) / 2 + (reviews >= 5 ? 2 : 0) + (Number(o.written_reviews) > 0 ? 2 : 0) + (o.has_cancellation as number) + (o.has_hours as number);
  const slug = "o-" + String(o.domain).toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  out.push({ ...o, booking_software: vendor || "", booking_software_name: vendorLabel(vendor) || "", vendor_line: vendorLine(vendor, Number(o.widget_lines) > 0) || "", quality: good ? "good" : "", listing_url: "https://onoutset.com/#o=" + slug, score: Math.round(score * 10) / 10 });
}
out.sort((a, b) => (b.quality === "good" ? 1 : 0) - (a.quality === "good" ? 1 : 0) || Number(b.score) - Number(a.score) || (Number(b.review_count) || 0) - (Number(a.review_count) || 0));
const cols = ["quality","score","name","email","booking_software","booking_software_name","vendor_line","priced_services","priced_lines","widget_lines","photos","has_cover","review_count","rating","written_reviews","has_cancellation","has_hours","city","region","country","family","category_id","phone","website","domain","listing_url","id"];
const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
writeFileSync(new URL("../data/outreach-list.csv", import.meta.url), [cols.join(","), ...out.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n");
const good = out.filter((r) => r.quality === "good");
const counts = new Map<string, number>(); for (const r of good) counts.set(String(r.booking_software) || "(none found)", (counts.get(String(r.booking_software) || "(none found)") || 0) + 1);
console.log(JSON.stringify({ rows: out.length, good: good.length, vendorNewlyDetected: detected, goodByVendor: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 14) }, null, 1));
