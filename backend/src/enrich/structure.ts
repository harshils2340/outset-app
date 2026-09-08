import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { db, nowIso } from "../db/client.ts";
import { fetchHtml, sleep } from "../scrape/fetch.ts";
import { normalizePhone } from "../scrape/run.ts";

/**
 * Rule-based site reading, no language model. It reads what the operator's own site is organized around:
 * navigation links, page titles and headings. "Jet Ski Rentals", "Kayak Rentals", "Sunset Cruise", "Online Waiver",
 * "Reserve Now". Prices are copied only when a dollar amount sits right next to a service heading.
 * Everything stored has confidence 'site' and the page it came from. Nothing is guessed.
 */

const SERVICE_WORDS =
  /jet ?ski|waverunner|pwc|kayak|canoe|paddle ?board|sup\b|pontoon|boat rental|boat tour|charter|fishing|cruise|sail|sunset|dolphin|snorkel|parasail|skydiv|tandem|helicopter|heli ?tour|balloon|kart|escape room|axe|paintball|airsoft|horse|trail ride|zipline|tube|banana boat|flyboard|eco ?tour|mangrove|manatee|whale|scuba|dive|surf|wakeboard|water ?ski|yacht|catamaran|glass ?bottom|airboat|atv|utv|jeep|segway|bike/i;
const NOT_SERVICE = /blog|news|about|contact|faq|gallery|photo|review|career|job|privacy|terms|policy|sitemap|login|cart|account|gift|membership|sale|shop|store|merch|home$|location|weather|map|directions|press|partner|affiliate|franchise|donate|sponsor|newsletter|email|subscribe|coupon|special|deal/i;
const WAIVER = /waiver|release form|sign (the|your) (form|waiver)|smartwaiver|wherewolf|waiverforever/i;
const BOOK = /book now|reserve|reservation|book online|buy tickets|schedule|check availability|fareharbor|peek\.com|xola|rezdy|checkfront|bookeo|resova/i;
const HOURS = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*(-|to|–|through)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[:,]?\s*\d{1,2}(:\d{2})?\s*(am|pm)?\s*(-|to|–)\s*\d{1,2}(:\d{2})?\s*(am|pm)|\b(open|hours)\b[^.]{0,40}\d{1,2}(:\d{2})?\s*(am|pm)\s*(-|to|–)\s*\d{1,2}(:\d{2})?\s*(am|pm)/i;
const PRICE_NEAR = /\$\s?(\d{2,4})(?:\.\d{2})?(?:\s*(?:\/|per|an?|each)\s*(hour|hr|half.?hour|30 ?min|person|adult|child|kid|ski|boat|day|half.?day|trip|group|ride|flight|jump|room|lane|game)s?)?/i;

/** Groups of service names that mean the same activity. The first regex match wins. */
const CANON: [RegExp, string][] = [
  [/jet ?ski|waverunner|pwc/i, "Jet ski rental"], [/paddle ?board|sup\b/i, "Paddleboard rental"], [/kayak|canoe/i, "Kayak rental"],
  [/pontoon/i, "Pontoon rental"], [/boat rental|boat rent/i, "Boat rental"], [/parasail/i, "Parasailing"],
  [/banana boat|tube|tubing/i, "Banana boat and tubing"], [/flyboard/i, "Flyboarding"], [/snorkel/i, "Snorkel trip"],
  [/scuba|dive/i, "Dive trip"], [/dolphin|manatee|whale|eco ?tour|mangrove|wildlife/i, "Wildlife tour"],
  [/sunset|cruise|sail|catamaran|yacht|glass ?bottom|airboat|boat tour|harbor|harbour/i, "Boat tour"],
  [/fishing|charter/i, "Fishing charter"], [/skydiv|tandem/i, "Tandem skydive"], [/helicopter|heli/i, "Helicopter tour"],
  [/balloon/i, "Balloon flight"], [/escape room/i, "Escape room"], [/axe/i, "Axe throwing"], [/paintball|airsoft/i, "Paintball"],
  [/kart/i, "Karting"], [/horse|trail ride/i, "Trail ride"], [/zipline/i, "Zipline"], [/surf|wakeboard|water ?ski/i, "Surf and wake"],
  [/atv|utv|jeep|segway|bike/i, "Land rental"], [/beach (chair|furniture|umbrella)|cabana/i, "Beach furniture rental"],
];

function canon(name: string): string | null {
  for (const [re, label] of CANON) if (re.test(name)) return label;
  return null;
}

/** Collapse near-duplicates to one line per activity, keeping the shortest original name and any price seen. */
function consolidate(found: Map<string, Found>): Found[] {
  const groups = new Map<string, Found & { canon: string }>();
  for (const f of found.values()) {
    const c = canon(f.name);
    if (!c) continue;
    const cur = groups.get(c);
    if (!cur) {
      groups.set(c, { ...f, canon: c });
      continue;
    }
    if (f.name.length < cur.name.length && !/^(an?|the|your|our)\b|!$/i.test(f.name)) cur.name = f.name;
    if (cur.price == null && f.price != null) {
      cur.price = f.price;
      cur.unit = f.unit;
      cur.url = f.url;
    }
    if (!cur.detail && f.detail) cur.detail = f.detail;
    if (f.variants?.length) {
      cur.variants = cur.variants || [];
      for (const v of f.variants) if (!cur.variants.some((x) => x.label.toLowerCase() === v.label.toLowerCase())) cur.variants.push(v);
    }
  }
  return [...groups.values()].map((g) => ({ ...g, name: g.name.length > 34 ? g.canon : g.name.replace(/\s*&\s*more!?$/i, "") })).slice(0, 10);
}

export type StructureResult = {
  operatorId: string;
  domain: string;
  pages: number;
  services: number;
  status: "ok" | "no_pages" | "error";
  error?: string;
};

function clean(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[|•·–—]+/g, "-").trim();
}

function titleCase(s: string): string {
  return s.length > 3 && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}

type Variant = { label: string; price: number };
type Found = { name: string; detail: string | null; price: number | null; unit: string | null; url: string; variants?: Variant[] };
type Addon = { name: string; price: number; url: string };

const ADDON_WORDS = /additional|extra|add[- ]?on|upgrade|rider|passenger|photo|video|gopro|camera|fuel|gas|cooler|insurance|damage|deposit|guide|lesson|delivery|late|tax|gratuity|tip|snorkel gear|wetsuit|dry bag|tube|towel/i;
const PRICE_CELL = /^\$\s?(\d{1,4})(?:\.\d{2})?(?:\s*(?:\+|and up|\/|per)?.*)?$/i;
const LABEL_PRICE = /^(.{3,48}?)\s*(?:[-–:]|\.{2,}|\s{2,})\s*\$\s?(\d{1,4})(?:\.\d{2})?\b/;

function isAddon(label: string): boolean {
  return ADDON_WORDS.test(label);
}

/** Nearest service heading above an element: check preceding siblings at each ancestor level, then the page's main heading. */
function headingAbove($: ReturnType<typeof load>, el: any): string | null {
  let node = $(el);
  for (let depth = 0; depth < 8 && node.length; depth++) {
    const prev = node.prevAll("h1, h2, h3, h4").filter((_, h) => SERVICE_WORDS.test($(h).text())).first();
    if (prev.length) return clean(prev.text());
    node = node.parent();
  }
  const page = $("h1, h2").filter((_, h) => SERVICE_WORDS.test($(h).text())).first();
  if (page.length) return clean(page.text());
  const title = clean($("title").first().text()).split(/[|\-–]/)[0].trim();
  return SERVICE_WORDS.test(title) ? title : null;
}

/** Read price tables and "label - $price" lists into variants and add-ons attached to the nearest service heading. */
function harvestPrices($: ReturnType<typeof load>, url: string, out: Map<string, Found>, addons: Map<string, Addon>) {
  const attach = (heading: string | null, label: string, price: number) => {
    if (isAddon(label)) {
      const k = label.toLowerCase();
      if (!addons.has(k)) addons.set(k, { name: titleCase(label), price, url });
      return;
    }
    const svc = heading && SERVICE_WORDS.test(heading) ? heading : label;
    const key = svc.toLowerCase();
    const cur = out.get(key) || { name: titleCase(svc), detail: null, price: null, unit: null, url };
    cur.variants = cur.variants || [];
    if (!cur.variants.some((v) => v.label.toLowerCase() === label.toLowerCase())) cur.variants.push({ label, price });
    if (cur.price == null || price < cur.price) cur.price = price;
    cur.url = url;
    out.set(key, cur);
  };

  $("table").each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells = $(tr).find("th, td").map((_, c) => clean($(c).text())).get().filter((t) => t.length);
        if (cells.length) rows.push(cells);
      });
    if (!rows.length) return;
    const heading = headingAbove($, table);
    // Layout A: a label row followed by a price row (columns are variants).
    for (let i = 0; i + 1 < rows.length; i++) {
      const labels = rows[i];
      const prices = rows[i + 1];
      if (labels.length === prices.length && prices.every((c) => PRICE_CELL.test(c)) && !labels.some((c) => PRICE_CELL.test(c))) {
        labels.forEach((l, j) => attach(heading, l, Number(prices[j].match(PRICE_CELL)![1])));
        i++;
      }
    }
    // Layout B: rows of [label, ..., price].
    for (const r of rows) {
      if (r.length < 2) continue;
      const priceIdx = r.findIndex((c) => PRICE_CELL.test(c));
      if (priceIdx > 0 && !PRICE_CELL.test(r[0]) && r[0].length <= 48) attach(heading, r[0], Number(r[priceIdx].match(PRICE_CELL)![1]));
    }
  });

  $("li, p, dt, dd, span, div").each((_, el) => {
    if ($(el).children().length > 3) return;
    const text = clean($(el).clone().children("ul, ol, table").remove().end().text());
    if (text.length > 90 || !/\$/.test(text)) return;
    const m = text.match(LABEL_PRICE);
    if (!m) return;
    const label = m[1].trim();
    if (!SERVICE_WORDS.test(label) && !/hour|hr|min|day|person|adult|child|kid|rider|ride|trip|flight|jump|game|lane|session|tour|package/i.test(label) && !isAddon(label)) return;
    attach(headingAbove($, el), label, Number(m[2]));
  });
}

function harvest(html: string, url: string, out: Map<string, Found>, links: Set<string>, meta: { waiver?: string; book?: string; phone?: string; hours?: string }, addons: Map<string, Addon>) {
  const $ = load(html);
  const origin = new URL(url).origin;
  $("script, style, noscript, svg").remove();
  harvestPrices($, url, out, addons);

  $("a[href]").each((_, el) => {
    const text = clean($(el).text());
    const href = $(el).attr("href") || "";
    let abs: URL | null = null;
    try {
      abs = new URL(href, url);
    } catch {
      abs = null;
    }
    if (!meta.phone && /^tel:/i.test(href)) meta.phone = href.replace(/^tel:/i, "");
    if (!meta.waiver && (WAIVER.test(text) || WAIVER.test(href))) meta.waiver = abs?.toString() || href;
    if (!meta.book && (BOOK.test(text) || BOOK.test(href)) && abs) meta.book = abs.toString();
    if (!abs || abs.origin !== origin) return;
    if (/\.(pdf|jpg|jpeg|png|gif|webp|mp4)$/i.test(abs.pathname) || abs.hash) return;
    if (text.length >= 4 && text.length <= 60 && SERVICE_WORDS.test(text) && !NOT_SERVICE.test(text)) {
      links.add(abs.origin + abs.pathname.replace(/\/$/, ""));
      const key = text.toLowerCase();
      if (!out.has(key)) out.set(key, { name: titleCase(text), detail: null, price: null, unit: null, url });
    }
  });

  $("h1, h2, h3").each((_, el) => {
    const text = clean($(el).text());
    if (text.length < 4 || text.length > 70 || !SERVICE_WORDS.test(text) || NOT_SERVICE.test(text)) return;
    const key = text.toLowerCase();
    const near = clean($(el).nextAll().slice(0, 3).text()).slice(0, 240);
    const m = near.match(PRICE_NEAR) || text.match(PRICE_NEAR);
    const cur = out.get(key) || { name: titleCase(text), detail: null, price: null, unit: null, url };
    if (m && cur.price == null) {
      cur.price = Number(m[1]);
      cur.unit = m[2] ? "/" + m[2].toLowerCase().replace(/s$/, "") : null;
      cur.url = url;
    }
    if (!cur.detail && near && !/\$/.test(near.slice(0, 5)) && !/reserve now|book now/i.test(near.slice(0, 20))) cur.detail = near.slice(0, 120).replace(/\s+\S*$/, "");
    out.set(key, cur);
  });

  if (!meta.hours) {
    const body = clean($("body").text());
    const h = body.match(HOURS);
    if (h) meta.hours = h[0].slice(0, 120);
  }
}

export async function readSiteStructure(op: { id: string; domain: string; website: string }): Promise<StructureResult> {
  const base: StructureResult = { operatorId: op.id, domain: op.domain, pages: 0, services: 0, status: "ok" };
  try {
    const start = op.website.startsWith("http") ? op.website : "https://" + op.website;
    const home = await fetchHtml(start);
    if (home.status !== 200 || !home.html) return { ...base, status: "no_pages" };
    const found = new Map<string, Found>();
    const links = new Set<string>();
    const addons = new Map<string, Addon>();
    const meta: { waiver?: string; book?: string; phone?: string; hours?: string } = {};
    harvest(home.html, home.finalUrl || start, found, links, meta, addons);
    base.pages = 1;
    const seen = new Set<string>([start.replace(/\/$/, "")]);
    for (const url of [...links].slice(0, 6)) {
      if (seen.has(url)) continue;
      seen.add(url);
      await sleep(250);
      const res = await fetchHtml(url).catch(() => null);
      if (!res || res.status !== 200 || !res.html) continue;
      harvest(res.html, res.finalUrl || url, found, new Set<string>(), meta, addons);
      base.pages += 1;
    }

    const now = nowIso();
    db.prepare("DELETE FROM offerings WHERE operator_id = ? AND confidence = 'site'").run(op.id);
    db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'site'").run(op.id);
    const insOff = db.prepare(
      `INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'USD', ?, 'site')`,
    );
    const insFact = db.prepare(
      "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')",
    );
    const hasAi = db.prepare("SELECT 1 FROM offerings WHERE operator_id = ? AND confidence IN ('ai','seed') LIMIT 1").get(op.id);
    for (const f of consolidate(found)) {
      if (!hasAi) {
        if (f.variants?.length) {
          for (const v of f.variants.slice(0, 8)) {
            insOff.run(randomUUID(), op.id, f.name.slice(0, 80), v.label.slice(0, 80), v.price * 100, "each", f.url);
          }
        } else {
          insOff.run(randomUUID(), op.id, f.name.slice(0, 80), f.detail, f.price == null ? null : f.price * 100, f.unit || "each", f.url);
        }
      }
      insFact.run(randomUUID(), op.id, "service", f.name.slice(0, 80), f.url);
      base.services += 1;
    }
    for (const a of [...addons.values()].slice(0, 8)) insFact.run(randomUUID(), op.id, "addon", a.name.slice(0, 60) + " $" + a.price, a.url);
    if (meta.waiver) insFact.run(randomUUID(), op.id, "waiver_url", meta.waiver, start);
    if (meta.book) insFact.run(randomUUID(), op.id, "booking_url", meta.book, start);
    if (meta.hours) insFact.run(randomUUID(), op.id, "hours_text", meta.hours, start);
    db.prepare(
      `UPDATE operators SET phone = COALESCE(phone, ?), hours = COALESCE(hours, ?), updated_at = ? WHERE id = ?`,
    ).run(normalizePhone(meta.phone), meta.hours || null, now, op.id);
    db.prepare(
      "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'site-structure', 1, ?)",
    ).run(randomUUID(), op.id, start, now, "Service names, waiver and booking links read from the site's own navigation and headings.");
    return base;
  } catch (e) {
    return { ...base, status: "error", error: (e as Error).message.slice(0, 200) };
  }
}

export function pendingStructure(limit: number): { id: string; domain: string; website: string }[] {
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure')
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

export async function readPendingStructures(limit: number, concurrency = 6): Promise<StructureResult[]> {
  const queue = pendingStructure(limit);
  const out: StructureResult[] = [];
  let i = 0;
  let done = 0;
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      const r = await readSiteStructure(op);
      out.push(r);
      done += 1;
      if (done % 50 === 0) {
        const ok = out.filter((x) => x.status === "ok").length;
        const svc = out.reduce((n, x) => n + x.services, 0);
        console.log(`${done}/${queue.length} sites, ${ok} readable, ${svc} services found`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
