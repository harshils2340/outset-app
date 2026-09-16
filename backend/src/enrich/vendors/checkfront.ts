import { mineSentences, plain } from "../widgets.ts";
import type { Company, Offering, WidgetResult } from "../widgets.ts";
import { safeFetch } from "../../lib/safeFetch.ts";

/**
 * Checkfront as a free, exact source. Every Checkfront account serves a hosted booking page at
 * https://<account>.checkfront.com/reserve/ and the same page powers the "DROPLET" widget operators embed
 * on their own sites (`new CHECKFRONT.Widget({host: '<account>.checkfront.com', category_id: '10,9'})`).
 * Three of that page's own requests answer with no key, no cookie and no CSRF token:
 *
 *   GET  /reserve/                                            company name and id, the category grid (name, image),
 *                                                             the operator's own domain (parentPages)
 *   GET  /reserve/inventory/?start_date=D&end_date=D          JSON {inventory: <html>} with one card per item:
 *                                                             id, name, cover, truncated summary, grid price or range
 *   POST /reserve/api/?call=rate  item_id=<id>&start_date=D   the v3 JSON the widget prices a booking with: full summary
 *                                                             and details HTML, images (S/M/L), YouTube id, category, unit,
 *                                                             every rate or customer-type "param" with its label and price,
 *                                                             timeslots, deposit rules, stock. Prices come back even when
 *                                                             the day is CLOSED, so one dated call per item is enough.
 *
 * The partner API (/api/3.0/item) still needs an account token; nothing here uses it. Checkfront publishes no
 * account-level terms or cancellation policy through these calls, so policies are mined from item copy only.
 * Requests go one at a time with a pause, all to the account's own host. robots.txt is read first.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT = 15000;
const PAUSE_MS = 300;
const MAX_ITEMS = 60;

export type CheckfrontRef = {
  /** The account's subdomain: `navarrefamilywatersports` in navarrefamilywatersports.checkfront.com. */
  account: string;
  /** Category filter from the link or the embed (`?category_id=1,9` / `category_id: '10,9'`), else empty = every category. */
  categoryIds: number[];
  /** Item filter from the link or the embed (`?item_id=3,106` / `filter_item_id=16,82`), else empty = every item. */
  itemIds: number[];
};

/** Hosts under checkfront.com that are Checkfront's own, never an operator account. */
const NOT_ACCOUNTS = /^(www|app|api|my|support|help|docs|blog|status|cdn|static|assets|mail|login|secure|checkfront|demo|sandbox|developer|developers)$/i;

/** A booking link, an operator page's HTML, or an embed snippet -> the account and any item/category filter, or null. */
export function checkfrontRef(bookingUrlOrHtml: string): CheckfrontRef | null {
  const s = String(bookingUrlOrHtml || "");
  const hosts = [...s.matchAll(/(?:https?:)?\/\/([a-z0-9][a-z0-9-]{0,62})\.checkfront\.com\b/gi), ...s.matchAll(/host\s*:\s*['"]([a-z0-9][a-z0-9-]{0,62})\.checkfront\.com['"]/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((h) => !NOT_ACCOUNTS.test(h));
  if (!hosts.length) return null;
  // The most-mentioned account wins when an HTML page names several (a plugin loader plus the widget itself).
  const counts = new Map<string, number>();
  for (const h of hosts) counts.set(h, (counts.get(h) || 0) + 1);
  const account = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const ids = (re: RegExp) => {
    const out = new Set<number>();
    for (const m of s.matchAll(re)) for (const p of m[1].split(",")) if (/^\d+$/.test(p.trim())) out.add(Number(p.trim()));
    return [...out];
  };
  return {
    account,
    categoryIds: ids(/[?&/]category_id=([\d,]+)/gi).concat(ids(/category_id\s*:\s*['"]([\d,]+)['"]/gi)).filter((v, i, a) => a.indexOf(v) === i),
    itemIds: ids(/[?&/](?:filter_)?item_id=([\d,]+)/gi).concat(ids(/(?:filter_)?item_id\s*:\s*['"]([\d,]+)['"]/gi)).filter((v, i, a) => a.indexOf(v) === i),
  };
}

/* ---------- http ---------- */

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getText(url: string, accept = "text/html,application/json"): Promise<string | null> {
  try {
    const res = await safeFetch(url, { headers: { "User-Agent": UA, Accept: accept }, timeoutMs: TIMEOUT, maxBytes: 5_000_000 });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function postJson<T>(url: string, form: Record<string, string>): Promise<T | null> {
  try {
    const res = await safeFetch(url, {
      method: "POST",
      headers: { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      timeoutMs: TIMEOUT,
      maxBytes: 5_000_000,
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** True when the account's robots.txt lets a generic agent read /reserve/. Missing or unreadable robots = allowed. */
async function reserveAllowed(base: string): Promise<boolean> {
  const txt = await getText(base + "/robots.txt", "text/plain");
  if (!txt) return true;
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") applies = val === "*";
    else if (applies && key === "disallow" && val && ("/reserve/".startsWith(val) || val === "/")) return false;
  }
  return true;
}

/* ---------- parsing ---------- */

type Card = { id: number; name: string; image: string | null; summary: string; gridPrice: string; priceUnit: string; type: string };

/**
 * The inventory HTML into item cards. Each card starts at `<div id="cf-item-data-N"`. Accounts choose one of three
 * layouts: a grid with a summary, a title-only grid (`data-type="Product"`, price carries an `<em>per hour</em>` hint),
 * or a list (`cf-item-price-N`, `<img src>` thumbnails, double-quoted ids). All three are read here.
 */
function parseCards(html: string): Card[] {
  const out: Card[] = [];
  const starts = [...html.matchAll(/<div id=["']cf-item-data-(\d+)["'] class=["']cf-item-data[^"']*["'] data-type=["']([^"']*)["']>/g)];
  for (let i = 0; i < starts.length; i++) {
    const id = Number(starts[i][1]);
    const block = html.slice(starts[i].index!, i + 1 < starts.length ? starts[i + 1].index : undefined);
    const name = plain((block.match(new RegExp(`id=["']cf-item-name-${id}["'][^>]*>([\\s\\S]*?)(?:<span class=["']sr-only|</h2>)`)) || [])[1] || "");
    if (!name) continue;
    const image = (block.match(/url\((['"]?)(https?:[^)'"]+)\1\)/) || [])[2] || (block.match(/<img[^>]*src=['"](https?:[^'"]+)['"]/) || [])[1] || null;
    const summary = (block.match(new RegExp(`id=["']cf-item-summary-${id}["'][^>]*>([\\s\\S]*?)<\\/div>`)) || [])[1] || "";
    const priceBlock = (block.match(new RegExp(`id=["']cf-(?:grid-|item-)?price-${id}["'][\\s\\S]*?<strong[^>]*>([\\s\\S]*?)</strong>(?:\\s*<em>([^<]*)</em>)?`)) || []);
    const gridPrice = plain((priceBlock[1] || "").replace(/<span class=['"]cf-currency[^>]*>[^<]*<\/span>/g, ""));
    out.push({ id, name, image, summary, gridPrice, priceUnit: plain(priceBlock[2] || ""), type: starts[i][2] });
  }
  return out;
}

type RateParam = { lbl?: string; price?: number; qty?: number; hide?: number; customer_hide?: number; guest?: number; MIN?: number | string; MAX?: number | string };
type RateItem = {
  item_id: number; name: string; unit?: string; len?: number; sku?: string; url?: string; status?: string; type?: string; category?: string; category_id?: number;
  summary?: string; details?: string; stock?: number; unlimited?: number; tags?: unknown[];
  video?: { id?: string } | null;
  image?: Record<string, { title?: string; url?: string; url_medium?: string; url_small?: string }>;
  rules?: string;
  param?: Record<string, RateParam>;
  rate?: {
    status?: string;
    summary?: { details?: string; price?: { total?: string; title?: string; unit?: string; param?: Record<string, string> } };
    start_time?: string; end_time?: string;
    dates?: Record<string, { price?: Record<string, number>; timeslots?: { start_time?: string; end_time?: string }[] }>;
  };
};
type RateDoc = { name?: string; locale?: { currency?: string }; item?: RateItem; request?: { status?: string; error?: unknown } };

function money(s: string | null | undefined): number | null {
  const m = (s || "").match(/(?:[A-Z]{1,3}\s?)?[$€£]\s?(\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.(\d{2}))?(?![\d,])/);
  return m ? Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : "")) : null;
}

function durationOf(...parts: (string | null | undefined)[]): string | null {
  for (const p of parts) {
    const t = p || "";
    if (/\b(half|1\/2)[- ]day\b/i.test(t)) return "half day";
    if (/\bfull[- ]day\b/i.test(t)) return "full day";
    if (/\bovernight\b/i.test(t)) return "overnight";
    if (/\bday trip\b/i.test(t)) return "1 day";
    const m = t.match(/(?<![\d/])\b(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(hours?|hrs?|hr\b|minutes?|mins?|min\b|days?|nights?|weeks?)\b/i);
    if (m) {
      const n = m[1].replace(/\s+/g, "");
      const u = m[2].toLowerCase().replace(/^hrs?$/, "hour").replace(/^hours$/, "hour").replace(/^mins?$/, "min").replace(/^minutes?$/, "min").replace(/s$/, "");
      const plural = n === "1" ? "" : "s";
      return u === "min" ? n + " min" : n + " " + u + plural;
    }
  }
  return null;
}

/** "09:00" .. "18:00" -> "9 hours"; overnight or same-time slots give nothing. */
function slotDuration(start?: string, end?: string): string | null {
  const a = (start || "").match(/^(\d{1,2}):(\d{2})/);
  const b = (end || "").match(/^(\d{1,2}):(\d{2})/);
  if (!a || !b) return null;
  const mins = Number(b[1]) * 60 + Number(b[2]) - (Number(a[1]) * 60 + Number(a[2]));
  if (mins <= 0 || mins >= 24 * 60) return null;
  if (mins < 60) return mins + " min";
  const h = mins / 60;
  return (Number.isInteger(h) ? h : h.toFixed(1)) + (h === 1 ? " hour" : " hours");
}

/** A param label that is a quantity picker, not a tier a guest chooses ("# of Waverunners", "Qty", "Guests"). */
const GENERIC_LABEL = /^(#\s*of\s+\w+|qty|quantity|guests?|people|persons?|participants?|riders?|players?|tickets?|units?|boats?|kayaks?|bikes?|number of \w+)$/i;
const GIFT_RE = /gift (?:certificate|card|voucher)|\bvoucher\b|\bmerch\b|t-?shirt|hoodie/i;

/** A param label as the widget shows it. `plain` would strip a leading "#" as a markdown heading. */
function labelText(s: unknown): string {
  return String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function unitFor(label: string, itemName: string, hint = ""): string {
  const text = label + " " + itemName;
  if (/\bper (?:hour|hr)\b/i.test(hint)) return "/hr";
  if (/\bper (?:person|adult|guest|rider|player|participant|passenger)\b/i.test(hint)) return "each";
  if (/\bper (?:day|night)\b/i.test(hint)) return "/" + hint.match(/\bper (day|night)\b/i)![1].toLowerCase();
  if (/\bper (?:group|boat|jet ?ski|kayak|room|lane|cart|kart)\b/i.test(hint)) return "/" + hint.match(/\bper (group|boat|jet ?ski|kayak|room|lane|cart|kart)\b/i)![1].toLowerCase();
  if (/\b(adult|child|children|kid|youth|senior|student|infant|toddler|person|guest|rider|player|passenger|participant|per person)\b/i.test(label)) return "each";
  if (/\b(\d+)\s*-?\s*(people|persons?|guests?|passengers?|riders?|players?)\b/i.test(label) && Number(RegExp.$1) > 1) return "/group";
  if (/\b(group|party|private|charter|whole|entire)\b/i.test(label)) return "/group";
  if (/\b(jet ?ski|waverunner|sea-?doo|pwc)\b/i.test(text)) return "/jet ski";
  if (/\b(pontoon|tritoon|boat|yacht|vessel|tiki|deck boat|ski boat|fishing boat|sailboat|catamaran)\b/i.test(text)) return "/boat";
  if (/\b(kayak|canoe|paddle ?board|sup|tube|raft|bike|bicycle|e-?bike|scooter|golf cart|cart|kart|slingshot|atv|utv)\b/i.test(text)) return "each";
  if (/\b(lane|room|court|bay|table|cabana|site)\b/i.test(text)) return "/" + text.match(/\b(lane|room|court|bay|table|cabana|site)\b/i)![1].toLowerCase();
  if (/\b(per )?(hour|hr)\b/i.test(label) && !/\d\s*(hours?|hrs?)/i.test(label)) return "/hr";
  return "each";
}

/* ---------- read ---------- */

/** Reserve page context the widget boots with: `{"csrfToken": ..., "companyName": ..., "companyId": ...}`. */
function pageContext(html: string): { companyName: string | null; companyId: string | null; parentPages: string[] } {
  const ctx = (html.match(/\{"csrfToken":\s*"[^"]*",\s*"brandId":[^}]*"companyName":\s*"((?:[^"\\]|\\.)*)"[^}]*"companyId":\s*"(\d+)"/) || []);
  const pp = (html.match(/var parentPages = (\[[^\]]*\])/) || [])[1];
  let parentPages: string[] = [];
  try { parentPages = pp ? (JSON.parse(pp) as string[]) : []; } catch { parentPages = []; }
  return { companyName: ctx[1] ? plain(ctx[1].replace(/\\"/g, '"')) : null, companyId: ctx[2] || null, parentPages };
}

function parseCategories(html: string): Map<number, { name: string; image: string | null }> {
  const out = new Map<number, { name: string; image: string | null }>();
  for (const m of html.matchAll(/<div class="category-wrapper cf-grid"[^>]*?(?:url\(['"]?([^'")]+)['"]?\))?[^>]*>\s*<h3>([\s\S]*?)<\/h3>[\s\S]*?href="#(\d+)"/g)) {
    out.set(Number(m[3]), { name: plain(m[2]), image: m[1] || null });
  }
  return out;
}

export async function readCheckfront(ref: CheckfrontRef): Promise<WidgetResult | null> {
  if (!ref?.account) return null;
  const base = "https://" + ref.account + ".checkfront.com";
  if (!(await reserveAllowed(base))) return null;
  await pause(PAUSE_MS);

  const page = await getText(base + "/reserve/");
  if (!page || !/cf-query|queuedLegacyJs|checkfront/i.test(page)) return null;
  const ctx = pageContext(page);
  const categories = parseCategories(page);
  await pause(PAUSE_MS);

  // Three days out: far enough that today's cutoffs do not hide timeslots, near enough to be inside every season the
  // operator is selling now. Prices come back even when the day is closed.
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const invQuery = new URLSearchParams({ start_date: day, end_date: day });
  if (ref.categoryIds.length) invQuery.set("category_id", ref.categoryIds.join(","));
  const invText = await getText(base + "/reserve/inventory/?" + invQuery.toString(), "application/json");
  let cards: Card[] = [];
  try { cards = invText ? parseCards(String((JSON.parse(invText) as { inventory?: string }).inventory || "")) : []; } catch { cards = []; }
  if (ref.itemIds.length) cards = cards.filter((c) => ref.itemIds.includes(c.id));
  cards = cards.filter((c) => !GIFT_RE.test(c.name)).slice(0, MAX_ITEMS);
  if (!cards.length) return null;

  const offerings: (Offering & { category?: string | null })[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  let currency: string | null = null;
  let video: string | null = null;
  let pages = 2;
  const deposits = new Set<string>();
  let fullPayment = false;

  for (const card of cards) {
    await pause(PAUSE_MS);
    const doc = await postJson<RateDoc>(base + "/reserve/api/?call=rate", { item_id: String(card.id), start_date: day });
    pages += 1;
    const it = doc?.item;
    const url = base + "/reserve/?item_id=" + card.id;
    const name = plain(it?.name || card.name).slice(0, 120);
    if (!name) continue;
    // `status` is the chosen day's availability (A, U, X...), not whether the item is for sale: the inventory listing
    // already limits us to what the operator shows, so nothing is skipped here.
    currency = currency || doc?.locale?.currency || null;
    const category = it?.category || null;
    const summaryHtml = it?.summary || card.summary;
    const detailsHtml = it?.details || "";
    const descFull = plain(summaryHtml);
    const desc = descFull.slice(0, 700).replace(/\s+\S*$/, "") || null;
    const photos = [...new Set([
      ...Object.values(it?.image || {}).map((im) => im.url || im.url_medium || null),
      card.image,
    ].filter((u): u is string => !!u))].slice(0, 8);
    if (!video && it?.video?.id) video = "https://www.youtube.com/embed/" + it.video.id;

    // Duration from the widget's own fields only: the item name, the day's timeslot bounds, the rate line
    // ("Boats: 1 Day @ $74.95"), the unit and length. Item copy is not used: a canoe sold for day trips says
    // "overnight camping" in its blurb, firewood says "2 hours of campfire".
    const dayInfo = it?.rate?.dates ? Object.values(it.rate.dates)[0] : undefined;
    const slot = dayInfo?.timeslots?.[0];
    const rateLine = labelText(it?.rate?.summary?.details || "").replace(/@\s*\$[\d.,]+/g, "");
    const itemDuration =
      durationOf(name) ||
      (it?.unit === "TS" ? slotDuration(slot?.start_time, slot?.end_time) : null) ||
      (it?.unit === "D" || it?.unit === "N" || it?.unit === "H" ? durationOf(rateLine) : null) ||
      (it?.unit === "D" && it?.len ? `${it.len} day${it.len > 1 ? "s" : ""}` : null) ||
      (it?.unit === "N" && it?.len ? `${it.len} night${it.len > 1 ? "s" : ""}` : null);

    // Every rate / customer type the widget shows, with the price it charges. Hidden params never reach a guest.
    const params = Object.entries(it?.param || {}).filter(([, p]) => p && !p.hide && !p.customer_hide);
    const priceOf = (key: string): number | null => {
      const n = dayInfo?.price?.[key];
      if (typeof n === "number" && n > 0) return n;
      return money(it?.rate?.summary?.price?.param?.[key]);
    };
    const priced = params.map(([key, p]) => ({ key, label: labelText(p.lbl || key), price: priceOf(key) })).filter((p) => p.label);
    const withPrice = priced.filter((p) => p.price != null && p.price > 0);
    const gridPrice = money(card.gridPrice);
    // "per hour" / "per person" as the widget itself labels the price, from the card or the rate summary.
    const hint = card.priceUnit || labelText(it?.rate?.summary?.price?.unit || "");
    const common = { name, url, desc, photo: photos[0] || null, photos, category };

    if (withPrice.length > 1 || (withPrice.length === 1 && !GENERIC_LABEL.test(withPrice[0].label) && withPrice[0].label.toLowerCase() !== name.toLowerCase())) {
      // One line per tier the guest picks: "2 Hr Rental $129", "4 Hr Rental $159"; "Adult $60", "Child $40".
      let first = true;
      for (const p of withPrice) {
        offerings.push({
          ...common,
          detail: p.label.slice(0, 120),
          duration: durationOf(p.label) || itemDuration,
          price: p.price,
          unit: unitFor(p.label, name, hint),
          desc: first ? desc : null,
          photo: first ? common.photo : null,
          photos: first ? photos : [],
        });
        first = false;
      }
    } else {
      const label = withPrice[0]?.label || priced[0]?.label || "";
      offerings.push({
        ...common,
        detail: itemDuration || (label && !GENERIC_LABEL.test(label) && label.toLowerCase() !== name.toLowerCase() ? label.slice(0, 120) : null),
        duration: itemDuration,
        price: withPrice[0]?.price ?? gridPrice ?? money(descFull),
        unit: unitFor(label, name, hint),
      });
    }

    // Deposit rule the widget enforces, and any requirement / policy / inclusion sentence in the item's own copy.
    try {
      const rules = it?.rules ? (JSON.parse(it.rules) as { deposit?: { amount?: string; type?: string } }) : null;
      const amt = Number(rules?.deposit?.amount);
      if (rules?.deposit?.type === "P" && amt >= 100) fullPayment = true;
      else if (amt > 0) deposits.add(rules?.deposit?.type === "P" ? amt + "%" : "$" + amt.toFixed(2));
    } catch { /* rules is free text on some accounts */ }
    const mined = mineSentences(plain(summaryHtml) + " " + plain(detailsHtml));
    mined.requirements.forEach((s) => req.add(s));
    mined.policies.forEach((s) => pol.add(s));
    mined.includes.forEach((s) => inc.add(s));
    // A param's MIN is a rule the guest meets; its MAX is the operator's stock ceiling, not a guest fact.
    for (const [, p] of params) {
      const min = Number(p.MIN);
      if (p.lbl && min > 1) req.add(`${name}: at least ${min} ${labelText(p.lbl).toLowerCase()} per booking.`);
    }
  }
  if (!offerings.length) return null;
  if (deposits.size) {
    const d = [...deposits];
    pol.add(d.length === 1 ? `A deposit of ${d[0]} is taken when you book.` : `A deposit (${d.slice(0, 3).join(", ")} depending on the item) is taken when you book.`);
  } else if (fullPayment) pol.add("Full payment is taken when you book.");

  const firstCat = [...categories.values()].find((c) => c.image);
  const company: Company = {
    currency: currency ? currency.toUpperCase() : null,
    cover: firstCat?.image || offerings.find((o) => o.photo)?.photo || null,
    videoEmbed: video,
  };
  return {
    vendor: "checkfront",
    offerings,
    company,
    requirements: [...req].slice(0, 10),
    policies: [...pol].slice(0, 10),
    includes: [...inc].slice(0, 10),
    pages,
  };
}

/** What the hosted page says about the account itself, for callers that want the company name and categories. */
export async function checkfrontAccountInfo(account: string): Promise<{ companyName: string | null; companyId: string | null; domains: string[]; categories: { id: number; name: string; image: string | null }[] } | null> {
  const base = "https://" + account + ".checkfront.com";
  const page = await getText(base + "/reserve/");
  if (!page) return null;
  const ctx = pageContext(page);
  return { companyName: ctx.companyName, companyId: ctx.companyId, domains: ctx.parentPages.filter((d) => !/checkfront\.com$/i.test(d)), categories: [...parseCategories(page).entries()].map(([id, c]) => ({ id, ...c })) };
}
