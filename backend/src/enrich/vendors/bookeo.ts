import { mineSentences, plain } from "../widgets.ts";
import type { Company, Offering, WidgetResult } from "../widgets.ts";

/**
 * Bookeo as a free, exact source, read the way a guest's browser reads it.
 *
 * Bookeo has no public catalog feed. Its REST API (api.bookeo.com/v2/settings/products) refuses every call
 * without a per-account secretKey that only the operator can grant, and the value in the embed
 * `<script src="https://bookeo.com/widget.js?a=<GUID>">` is the account GUID, not an API key (the API answers
 * "Missing parameter secretKey" to it). What is public is the server-rendered customer UI, a Java web app
 * that every widget and every https://bookeo.com/<account> link opens:
 *
 *   GET  https://bookeo.com/<slug>            302 -> https://www-<shard>.bookeo.com/bookeo/b_<slug>_start.html?ctlsrc2=..&src=02r
 *   GET  https://bookeo.com/go/<GUID>         same, for accounts linked by GUID
 *        The start page sets the AXIOMID session cookie and renders the product grid: one `gridItem` per
 *        bookable type with its id (`cb_type_onSelect(<rid>, '<name>')`), name, blurb, "from" price, duration
 *        and cover photo, plus the business header (name, street address, email, phone, website) and the
 *        page's session tokens (cb_bsid, _axiom_nocsrfid, _axiom_nocsrfid2, cb_itemId).
 *   GET  /bookeo/b_viewResourceTypeInfo.html?bsid=&rid=&ncs=&ncs2=&cfch=   (XHR)
 *        the "i" popup: the type's full description, photos and any extra tabs (rules, what to bring).
 *   POST /bookeo/b_saveType.html?ncs=&cfch=   ncs2=&bsid=&rid=
 *        selects the type in the session and answers with the next step. When the type sells add-ons that
 *        step is an options form (action b_saveRes.html) and one more POST with no option chosen moves on.
 *        The step that follows is the date-and-people page: one `<label class="inputLabel">` per person
 *        category (Adults, Children, custom tiers) each with its `perPersonPrice` amount, the type's fixed
 *        "Price" when it is sold per booking, and cb_numPeople_minMax with the party size limits.
 *        The reader stops there. It never posts a date, never reaches checkout, never leaves a hold.
 *
 * Two account settings stand in the way and are respected, not worked around:
 *   - "Human verification": the start page is a Google reCAPTCHA form. Only the business header renders,
 *     so the reader returns the company facts with no offerings.
 *   - "Redirect direct visitors to my website": bookeo.com/<slug> answers a JS redirect to the operator's
 *     site. With the GUID the reader takes the widget's own full-page route (widget.js?a= -> signed
 *     start URL); without it there is nothing to read.
 *
 * Requests go one at a time with a pause, all to the account's shard. bookeo.com/robots.txt allows everything.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT = 15000;
/** Bookeo throttles an address after about eight quick requests ("Too many requests from your computer"). */
const PAUSE_MS = 1500;
const THROTTLE_WAIT_MS = 12000;
/** Types read in depth (info popup and people page). Escape rooms have 3 to 8; the grid itself is read in full. */
const MAX_DEEP_ITEMS = 12;
const DEBUG = !!process.env.BOOKEO_DEBUG;
const dbg = (...a: unknown[]) => { if (DEBUG) console.error("[bookeo]", ...a); };

export type BookeoRef = {
  /** The account's short name in https://bookeo.com/<slug>. */
  slug: string | null;
  /** The 21- or 22-character account GUID from widget.js?a=<GUID>, bookeo.com/go/<GUID> or a cfile path. */
  guid: string | null;
};

const GUID = /\b(\d{4,5}[A-Z0-9]{17})\b/;
/** First path segments under bookeo.com that are Bookeo's own pages, never an account. */
const NOT_SLUGS = /^(go|bookeo|widget\.js|api|www|apps?|signup|login|logout|static|css|js|img|images|index|home|en|de|es|fr|it|pricing|features|blog|support|help|about|aboutus|terms|privacy|contact|appointments|customers|robots\.txt|sitemap\.xml)$/i;

/** The account behind a booking link, a widget start URL or a page's HTML. */
export function bookeoRef(bookingUrlOrHtml: string): BookeoRef | null {
  const s = bookingUrlOrHtml || "";
  let guid: string | null = null;
  let slug: string | null = null;
  const w = s.match(/widget\.js\?[^"'\s>]*?\ba=(\d{4,5}[A-Z0-9]{17})\b/);
  if (w) guid = w[1];
  const go = s.match(/bookeo\.com\/go\/(\d{4,5}[A-Z0-9]{17})\b/);
  if (go) guid = guid || go[1];
  const start = s.match(/bookeo\.com\/bookeo\/b_([A-Za-z0-9_-]{2,60})_start\.html/);
  if (start) {
    if (GUID.test(start[1]) && start[1].length >= 21 && start[1].length <= 22) guid = guid || start[1];
    else slug = start[1];
  }
  const cfile = s.match(/\/bookeo\/cfile\/(\d{4,5}[A-Z0-9]{17})\//);
  if (cfile) guid = guid || cfile[1];
  const bp = s.match(/[?&]bp_a=(\d{4,5}[A-Z0-9]{17})\b/);
  if (bp) guid = guid || bp[1];
  if (!slug) {
    const re = /(?:^|[^.\w-])(?:www\.)?bookeo\.com\/([A-Za-z0-9_-]{2,60})(?=[/?#"'\s<)]|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (NOT_SLUGS.test(m[1])) continue;
      if (GUID.test(m[1]) && m[1].length >= 21 && m[1].length <= 22) { guid = guid || m[1]; continue; }
      slug = m[1];
      break;
    }
  }
  return slug || guid ? { slug, guid } : null;
}

/* ---------- HTTP with a cookie jar ---------- */

class Session {
  jar = new Map<string, Map<string, string>>();
  pages = 0;
  /** Set once the shard has refused a request; cleared when the retry is answered. */
  throttled = false;

  private cookieHeader(host: string): string {
    const c = this.jar.get(host);
    return c ? [...c].map(([k, v]) => k + "=" + v).join("; ") : "";
  }

  private store(host: string, res: Response) {
    const raw: string[] = typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function" ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie() : [];
    if (!raw.length) return;
    const c = this.jar.get(host) || new Map<string, string>();
    for (const line of raw) {
      const kv = line.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    this.jar.set(host, c);
  }

  /** GET or POST with manual redirects so cookies set on every hop are kept. Returns the final URL and body. */
  async request(url: string, opt: { method?: "GET" | "POST"; body?: string; referer?: string; xhr?: boolean } = {}): Promise<{ url: string; html: string; status: number } | null> {
    let cur = url;
    let method = opt.method || "GET";
    let body = opt.body;
    for (let hop = 0; hop < 6; hop++) {
      const host = new URL(cur).host;
      const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept: opt.xhr ? "text/html, */*; q=0.01" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      };
      const cookie = this.cookieHeader(host);
      if (cookie) headers.Cookie = cookie;
      if (opt.referer) headers.Referer = opt.referer;
      if (opt.xhr) headers["X-Requested-With"] = "XMLHttpRequest";
      if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
      let res: Response;
      try {
        res = await fetch(cur, { method, headers, body: method === "POST" ? body : undefined, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
      } catch {
        return null;
      }
      this.pages += 1;
      this.store(host, res);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        cur = new URL(loc, cur).toString();
        method = "GET";
        body = undefined;
        continue;
      }
      let html = "";
      try {
        html = await res.text();
      } catch {
        return null;
      }
      if (isThrottled(html)) {
        // One long pause and one retry; a second refusal ends the walk so the shard is left alone.
        if (this.throttled) return { url: cur, html, status: res.status };
        this.throttled = true;
        await pause(THROTTLE_WAIT_MS);
        const again = await this.request(url, opt);
        if (again && !isThrottled(again.html)) this.throttled = false;
        return again;
      }
      return { url: cur, html, status: res.status };
    }
    return null;
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- Page readers ---------- */

const unesc = (s: string) => s.replace(/\\(.)/g, "$1");
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** The few entities Bookeo writes into titles and copy ("Quizzler&#39;s"). */
const entities = (s: string) => s.replace(/&(#x([0-9a-f]+)|#(\d+)|[a-z]+);/gi, (m, _a, hex, dec) => hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ENT[m.slice(1, -1).toLowerCase()] ?? m);
const text = (html: string | null | undefined) => entities(plain((html || "").replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, ". "))).replace(/^[\s.]+|[\s.]+$/g, "").replace(/(\.\s*){2,}/g, ". ").trim();
const first = (html: string, re: RegExp) => { const m = html.match(re); return m ? m[1] : null; };

type Tokens = { bsid: string; ncs: string; ncs2: string; cfch: string | null };

function tokensOf(html: string): Tokens | null {
  const bsid = first(html, /cb_bsid\s*=\s*"([^"]+)"/);
  const ncs = first(html, /_axiom_nocsrfid\s*=\s*"([^"]+)"/);
  const ncs2 = first(html, /_axiom_nocsrfid2\s*=\s*"([^"]+)"/);
  if (!bsid || !ncs || !ncs2) return null;
  return { bsid, ncs, ncs2, cfch: first(html, /cb_itemId\s*=\s*"([^"]+)"/) };
}

const isCaptcha = (html: string) => /g-recaptcha|verify you're not a robot|Human verification/i.test(html);
const jsRedirect = (html: string) => first(html, /window\.location\.replace\('([^']+)'\)/);
const isThrottled = (html: string) => html.length < 400 && /Too many requests/i.test(html);
const isExpired = (html: string) => /Session expired|inactive for too long/i.test(html) && !/cb_type_onSelect|inputLabel/.test(html);

type Header = { name: string | null; address: string | null; email: string | null; phone: string | null; website: string | null; logo: string | null; guid: string | null };

function readHeader(html: string, base: string): Header {
  const block = first(html, /<header class="header[\s\S]*?<\/header>/) || html.slice(0, 20000);
  const seg = (cls: string) => first(block, new RegExp(cls + '[\\s\\S]*?<span class="text">\\s*([\\s\\S]*?)\\s*<\\/span>'));
  const logo = first(block, /<img class="logo" src="([^"]+)"/);
  return {
    name: entities(plain(first(block, /<div class="title">\s*([\s\S]*?)\s*<\/div>/))) || null,
    address: plain(seg("headerAddress")) || null,
    email: (first(block, /href="mailto:([^"?]+)"/) || "").trim() || null,
    phone: (first(block, /href="tel:([^"]+)"/) || "").trim() || null,
    website: first(block, /class="headerWebsite" href="([^"]+)"/) || first(block, /<a href="([^"]+)"[^>]*class="noHover"/),
    logo: logo ? new URL(logo, base).toString() : null,
    guid: first(html, /[?&]bp_a=(\d{4,5}[A-Z0-9]{17})\b/) || first(html, /\/bookeo\/cfile\/(\d{4,5}[A-Z0-9]{17})\//),
  };
}

/** "42 Centre Square, Easton, Pennsylvania 18042[, United States of America]" -> parts. */
function splitAddress(a: string | null): Pick<Company, "street" | "city" | "region" | "postal"> {
  if (!a) return {};
  const parts = a.replace(/,?\s*(United States of America|United States|USA|Canada)\.?$/i, "").split(/\s*,\s*/).filter(Boolean);
  if (parts.length < 2) return { street: a };
  const last = parts[parts.length - 1];
  const pm = last.match(/^(.*?)\s*([A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?)$/i);
  const region = pm ? pm[1].trim() || null : last;
  const postal = pm ? pm[2].replace(/\s+/g, " ") : null;
  const city = parts.length >= 3 ? parts[parts.length - 2] : null;
  const street = parts.slice(0, parts.length >= 3 ? -2 : -1).join(", ") || null;
  return { street, city, region, postal };
}

function money(s: string | null | undefined): number | null {
  const m = (s || "").replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

/** "1 hour" | "1h 30m" | "2 hours" | "45 minutes" | "2 days" -> "60 min", "90 min", "2 hours", "45 min", "2 days". */
function duration(s: string | null): string | null {
  const t = plain(s).toLowerCase();
  if (!t) return null;
  const hm = t.match(/(\d+)\s*h(?:ours?|rs?)?\s*(\d+)\s*m/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]) + " min";
  const h = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hours?|hrs?)\b/);
  if (h) { const n = Number(h[1]); return n === 1 ? "1 hour" : n + " hours"; }
  const m = t.match(/(\d+)\s*(?:m|min|mins|minutes?)\b/);
  if (m) return m[1] + " min";
  const d = t.match(/(\d+)\s*(days?)\b/);
  if (d) return d[1] + " " + (Number(d[1]) === 1 ? "day" : "days");
  return null;
}

export type BookeoItem = { rid: string; name: string; blurb: string | null; price: number | null; priceText: string | null; duration: string | null; photo: string | null; photos: string[]; category: string | null; hasInfo: boolean };

/** A type name as the page's onclick carries it: JS-escaped and, in some accounts, URL-encoded ("Quizzler%27s"). */
function decodeName(s: string): string {
  const u = unesc(s);
  try { return /%[0-9A-Fa-f]{2}/.test(u) ? decodeURIComponent(u) : u; } catch { return u; }
}

/**
 * The product list on the start page: one entry per bookable type, in page order. Two layouts exist:
 * the photo grid (`gridItem`: title, blurb, "from" price, duration, background photo, "i" link) and the
 * category list (`cb_category` tabs, `item` blocks with a title and an HTML description that may hold photos).
 */
export function parseStartPage(html: string, base: string): BookeoItem[] {
  const out: BookeoItem[] = [];
  const seen = new Set<string>();
  // Category headings precede their items; an item belongs to the last one that starts before it.
  const cats: { at: number; name: string | null }[] = [];
  const catLabels = new Map([...html.matchAll(/id="_catButton_(\d+)"[\s\S]*?<div>\s*([^<]*?)\s*<\/div>/g)].map((x) => [x[1], plain(x[2]) || null]));
  for (const m of html.matchAll(/<a id="_cat_(\d+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/g)) cats.push({ at: m.index!, name: plain(m[2]) || null });
  for (const m of html.matchAll(/id="_cb_category_(\d+)"/g)) cats.push({ at: m.index!, name: catLabels.get(m[1]) || null });
  cats.sort((x, y) => x.at - y.at);
  const starts: { at: number; rid: string; name: string }[] = [];
  const re = /cb_type_onSelect\((\d+),\s*'((?:[^'\\]|\\.)*)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    // The item's block opens before the first call to it: the grid div's own onclick, or the list item's BOOK button.
    const grid = html.lastIndexOf('class="gridItem"', m.index);
    const list = html.lastIndexOf('<div class="item ', m.index);
    const back = Math.max(grid, list);
    const at = back >= 0 && m.index - back < 6000 ? back : m.index;
    starts.push({ at, rid: m[1], name: decodeName(m[2]) });
  }
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const chunk = html.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : Math.min(html.length, s.at + 12000));
    const title = entities(plain(first(chunk, /class="(?:gridItemTitle|itemTitle)">\s*([\s\S]*?)\s*<\/div>/))) || entities(plain(s.name));
    if (!title) continue;
    const descHtml = first(chunk, /class="gridItemBlurb">\s*([\s\S]*?)\s*<\/div>/) || first(chunk, /class="itemDescription">\s*([\s\S]*?)<\/div>\s*<\/div>\s*(?:<\/div>\s*)?<div class="itemButtons"/) || first(chunk, /class="itemDescription">\s*([\s\S]*?)<\/div>/);
    const imgs = [first(chunk, /background-image:\s*url\('([^']+)'\)/), ...[...chunk.matchAll(/<img[^>]+src="([^"]+)"/g)].map((x) => x[1])]
      .filter((u): u is string => !!u && !/\/logo|_logo|icon|spacer|blank\.gif|\.svg$/i.test(u))
      .map((u) => { try { return new URL(u, base).toString(); } catch { return null; } })
      .filter((u): u is string => !!u);
    const priceText = plain(first(chunk, /class="(?:gridItemPrice|itemPrice|price)">\s*([\s\S]*?)\s*<\/(?:span|div)>/)) || null;
    const cat = cats.filter((c) => c.at < s.at).pop();
    out.push({
      rid: s.rid,
      name: title,
      blurb: text(descHtml) || null,
      price: money(priceText),
      priceText,
      duration: duration(first(chunk, /class="(?:gridItemDuration|itemDuration|duration)">\s*([\s\S]*?)\s*<\/(?:span|div)>/)),
      photo: imgs[0] || null,
      photos: [...new Set(imgs)],
      category: cat?.name || null,
      hasInfo: new RegExp("cb_openResourceTypeInfo\\(" + s.rid + "\\)").test(chunk),
    });
  }
  return out;
}

export type BookeoInfo = { description: string | null; photos: string[]; tabs: { label: string; text: string }[] };

/** The "i" popup: description, photos and any extra tabs. */
export function parseInfo(html: string, base: string): BookeoInfo {
  const photos = [...html.matchAll(/<img[^>]+src="([^"]+\/bookeo\/cfile\/[^"]+|\/bookeo\/cfile\/[^"]+)"/g)].map((x) => new URL(x[1], base).toString());
  const description = text(first(html, /class="inlineDescriptionText">\s*([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/) || first(html, /class="inlineDescriptionText">\s*([\s\S]*?)<\/div>/)) || null;
  const labels = new Map([...html.matchAll(/id="groupTab_([A-Za-z0-9_]+)"[\s\S]*?<span class="groupTabText">\s*([\s\S]*?)\s*<\/span>/g)].map((x) => [x[1], plain(x[2])]));
  const tabs: { label: string; text: string }[] = [];
  for (const t of html.matchAll(/id="tab_([A-Za-z0-9_]+)"\s*>([\s\S]*?)(?=<div class="tabContent|<\/div>\s*<\/div>\s*<script)/g)) {
    const label = labels.get(t[1]) || t[1];
    const body = text(t[2]);
    if (body) tabs.push({ label, text: body });
  }
  return { description, photos: [...new Set(photos)], tabs };
}

export type BookeoPeople = { tiers: { label: string; price: number | null; min: number | null; max: number | null }[]; fixedPrice: number | null; minPeople: number | null; maxPeople: number | null };

/** The date-and-people step: person categories with their per-person price, the fixed price, party limits. */
export function parsePeoplePage(html: string): BookeoPeople {
  const tiers: BookeoPeople["tiers"] = [];
  const minMax = new Map<string, { min: number; max: number }>();
  const mm = first(html, /cb_numPeople_minMax\s*=\s*\{([\s\S]*?)\};/);
  if (mm) for (const x of mm.matchAll(/(\w+):\s*\{\s*min:\s*(-?\d+),\s*max:\s*(-?\d+)\s*\}/g)) minMax.set(x[1], { min: Number(x[2]), max: Number(x[3]) });
  const region = first(html, /(<div class="numpeople"[\s\S]*?id="_numPeopleError")/) || first(html, /(class="numPeopleControls"[\s\S]*?)<\/script>/) || "";
  const blocks = region.split(/(?=<div class="dropdown combo inputControl[^"]*"\s+id="[A-Za-z0-9_]+_inputControl")/);
  for (const b of blocks) {
    const id = first(b, /id="([A-Za-z0-9_]+)_inputControl"/);
    if (!id) continue;
    const label = plain(first(b, /<label class="inputLabel"[^>]*>\s*([\s\S]*?)\s*<\/label>/));
    if (!label) continue;
    const amount = first(b, /class="perPersonPrice"[^>]*>[\s\S]*?class="amount">\s*([^<]+?)\s*</);
    const lim = minMax.get(id);
    const opts = [...b.matchAll(/<option value="(\d+)"/g)].map((o) => Number(o[1])).filter((n) => n > 0);
    tiers.push({ label, price: amount ? money(amount) : null, min: lim && lim.min >= 0 ? lim.min : opts.length ? Math.min(...opts) : null, max: lim && lim.max >= 0 ? lim.max : opts.length ? Math.max(...opts) : null });
  }
  const fixed = first(html, /<div class="summaryPartLabel">\s*Price\s*<\/div>\s*<div class="summaryPartValue">\s*([^<]+?)\s*</);
  const minP = first(html, /cb_numPeople_minPeople\s*=\s*(\d+)/);
  const maxP = first(html, /cb_numPeople_maxPeople\s*=\s*(\d+)/);
  return { tiers, fixedPrice: fixed ? money(fixed) : null, minPeople: minP ? Number(minP) : null, maxPeople: maxP ? Number(maxP) : null };
}

/* ---------- Entry ---------- */

/** widget.js's own hash of the account GUID plus the signed token, sent back as `s` on the full-page route. */
function widgetHash(s: string): number {
  let d = 0;
  for (let i = 0; i < s.length; i++) d = ((d << 3) - d + s.charCodeAt(i)) | 0;
  return d;
}

/** The URL the widget sends a phone to when it cannot stay in an iframe: the same start page, signed. */
async function fullPageUrl(sess: Session, guid: string): Promise<string | null> {
  const js = await sess.request("https://bookeo.com/widget.js?a=" + guid);
  if (!js) return null;
  const provider = first(js.html, /axiomct_providerUrl\s*=\s*'([^']+)'/);
  const frame = first(js.html, /axiomct_frameUrl\s*=\s*'([^']+)'/);
  if (!provider || !frame || provider === "NOTFOUND") return null;
  const p = new URL(provider);
  const t = p.searchParams.get("t");
  const c = p.searchParams.get("c");
  if (!t || !c) return null;
  const s = widgetHash(guid + t);
  return frame.replace("inwidget=true", "inwidget=false") + "&nowidget=true&s=" + s + "&O=" + s + "&c=" + encodeURIComponent(c) + "&t=" + encodeURIComponent(t);
}

async function openStart(sess: Session, ref: BookeoRef): Promise<{ url: string; html: string } | null> {
  const entry = ref.slug ? "https://bookeo.com/" + encodeURIComponent(ref.slug) : ref.guid ? "https://bookeo.com/go/" + ref.guid : null;
  if (!entry) return null;
  let page = await sess.request(entry);
  dbg("start", entry, "->", page?.url, page?.status, page ? (isCaptcha(page.html) ? "captcha" : jsRedirect(page.html) ? "js-redirect " + jsRedirect(page.html) : page.html.length + " bytes") : "no answer");
  if (!page) return null;
  if (jsRedirect(page.html) || page.status >= 400) {
    // The account bounces direct visitors to its own website; take the route the widget itself uses.
    let guid = ref.guid || bookeoRef(page.html)?.guid || null;
    const target = jsRedirect(page.html);
    if (!guid && target && /^https?:\/\//.test(target)) {
      // The page it bounces to is the operator's booking page, and that page carries the widget embed with the GUID.
      await pause(PAUSE_MS);
      const site = await sess.request(target, { referer: "https://bookeo.com/" });
      guid = site ? bookeoRef(site.html)?.guid || null : null;
      dbg("redirect target", target, "guid:", guid);
    }
    if (!guid) return null;
    await pause(PAUSE_MS);
    const full = await fullPageUrl(sess, guid);
    if (!full) return null;
    await pause(PAUSE_MS);
    page = await sess.request(full, { referer: "https://bookeo.com/" });
    if (!page || jsRedirect(page.html)) return null;
  }
  return page;
}

function companyOf(h: Header): Company {
  return {
    phone: h.phone,
    email: h.email,
    ...splitAddress(h.address),
    cover: null,
  };
}

function unitFor(name: string, blurb: string | null): string {
  return /\b(private|group|per (?:room|lane|boat|kart|table|booking)|whole|entire)\b/i.test(name + " " + (blurb || "")) ? "/group" : "each";
}

export async function readBookeo(ref: BookeoRef): Promise<WidgetResult | null> {
  const sess = new Session();
  const start = await openStart(sess, ref);
  if (!start) return null;
  const base = new URL(start.url).origin;
  const header = readHeader(start.html, base);
  const bookUrl = ref.slug ? "https://bookeo.com/" + ref.slug : "https://bookeo.com/go/" + (ref.guid || header.guid || "");
  const company = companyOf(header);
  if (isCaptcha(start.html)) {
    // The account asks every visitor to pass reCAPTCHA before it shows a menu. The header is all it publishes.
    if (!header.name && !header.address && !header.phone) return null;
    return { vendor: "bookeo", offerings: [], company, requirements: [], policies: [], includes: [], pages: sess.pages };
  }
  const items = parseStartPage(start.html, base);
  let tok = tokensOf(start.html);
  if (!items.length || !tok) {
    if (!items.length && !header.name) return null;
    return { vendor: "bookeo", offerings: [], company, requirements: [], policies: [], includes: [], pages: sess.pages };
  }

  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  const post = (path: string, body: Record<string, string>) =>
    sess.request(base + "/bookeo/" + path + "?ncs=" + encodeURIComponent(tok!.ncs) + (tok!.cfch ? "&cfch=" + encodeURIComponent(tok!.cfch) : ""), {
      method: "POST",
      body: new URLSearchParams({ ncs2: tok!.ncs2, bsid: tok!.bsid, ...body }).toString(),
      referer: start.url,
    });

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let info: BookeoInfo | null = null;
    let people: BookeoPeople | null = null;
    if (i < MAX_DEEP_ITEMS && !sess.throttled) {
      if (it.hasInfo) {
        await pause(PAUSE_MS);
        const q = "bsid=" + tok.bsid + "&rid=" + it.rid + "&ncs=" + tok.ncs + "&ncs2=" + tok.ncs2 + (tok.cfch ? "&cfch=" + tok.cfch : "");
        const r = await sess.request(base + "/bookeo/b_viewResourceTypeInfo.html?" + q, { xhr: true, referer: start.url });
        if (r && !isExpired(r.html)) info = parseInfo(r.html, base);
      }
      await pause(PAUSE_MS);
      let step = await post("b_saveType.html", { rid: it.rid });
      if (step && isExpired(step.html)) {
        // The shard dropped the session; open a fresh one and select the type again.
        await pause(PAUSE_MS);
        const again = await openStart(sess, ref);
        const t2 = again && !isCaptcha(again.html) ? tokensOf(again.html) : null;
        if (t2) { tok = t2; await pause(PAUSE_MS); step = await post("b_saveType.html", { rid: it.rid }); }
      }
      if (step && /action="b_saveRes\.html/.test(step.html)) {
        // An add-ons step (tokens, photos, extra time): decline them all and move to the people page.
        await pause(PAUSE_MS);
        step = await post("b_saveRes.html", { optionsAsStringForSpring: "" });
      }
      if (step && !isExpired(step.html) && /inputLabel|summaryPartLabel/.test(step.html)) people = parsePeoplePage(step.html);
      dbg("item", it.rid, it.name, "| info:", it.hasInfo ? (info ? "ok" : "failed") : "none", "| step:", step ? (isExpired(step.html) ? "expired" : /action="b_saveRes/.test(step.html) ? "options-page" : first(step.html, /<form[^>]*action="([^"?]+)/) || "?") : "no answer", "| people:", JSON.stringify(people));
    }
    const photos = [...new Set([...it.photos, ...(info?.photos || [])])];
    const descLong = info?.description || "";
    const desc = (it.blurb && it.blurb.length > 30 ? it.blurb : descLong.slice(0, 700).replace(/\s+\S*$/, "") || it.blurb || "") || null;
    const priced = (people?.tiers || []).filter((t) => t.price != null && t.price > 0);
    const unit = unitFor(it.name, it.blurb);
    if (priced.length) {
      for (const t of priced) {
        const detail = t.label.toLowerCase() === it.name.toLowerCase() ? "Per person" : t.label;
        offerings.push({ name: it.name, detail, duration: it.duration, price: t.price, unit: "each", url: bookUrl, desc, photo: photos[0] || null, photos });
      }
    } else {
      const price = people?.fixedPrice ?? it.price;
      // A "Price" with no per-person amounts is the whole booking: a room, a lane, a boat, "(2 GUESTS)".
      const perBooking = people?.fixedPrice != null && !(people.tiers || []).some((t) => t.price != null) && ((people.maxPeople || 0) > 1 || /\(\s*\d+\s*(?:guests?|people|players?|persons?|pax)\s*\)|\bfor \d+\b/i.test(it.name));
      offerings.push({ name: it.name, detail: it.category && it.category.toLowerCase() !== it.name.toLowerCase() ? it.category : it.duration, duration: it.duration, price, unit: perBooking ? "/group" : unit, url: bookUrl, desc, photo: photos[0] || null, photos });
    }
    const mined = mineSentences([it.blurb, descLong, ...(info?.tabs || []).map((t) => t.text)].filter(Boolean).join(" "));
    mined.requirements.forEach((s) => req.add(s));
    mined.policies.forEach((s) => pol.add(s));
    mined.includes.forEach((s) => inc.add(s));
    for (const t of people?.tiers || []) {
      const ages = t.label.match(/\b(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\b|\b(\d{1,2})\s*\+|ages?\s*(\d{1,2})/i);
      if (ages && !/adult/i.test(t.label)) req.add(`${it.name}: ${t.label}.`);
    }
    if (people?.minPeople && people.minPeople > 1) req.add(`${it.name}: minimum ${people.minPeople} guests per booking.`);
    if (people?.maxPeople && people.maxPeople > 1) inc.add(`${it.name}: up to ${people.maxPeople} guests per booking.`);
  }
  return {
    vendor: "bookeo",
    offerings,
    company,
    requirements: [...req].slice(0, 10),
    policies: [...pol].slice(0, 10),
    includes: [...inc].slice(0, 10),
    pages: sess.pages,
  };
}
