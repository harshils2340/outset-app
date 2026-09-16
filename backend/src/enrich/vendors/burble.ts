import { mineSentences, plain, type Company, type Offering, type WidgetResult } from "../widgets.ts";
import { robotsAllowed } from "../../scrape/fetch.ts";
import { safeFetch } from "../../lib/safeFetch.ts";

/**
 * Burble (skydiving manifest and booking). What is and is not public, checked 15 September 2026:
 *
 *   bookings.burblesoft.com/index/<dz>/<page>   the booking flow the operator links to. Its robots.txt (nginx, dated
 *                                               May 2018) is "User-agent: * / Disallow: /", so this reader never touches it.
 *   dzm.burblesoft.com/jmp?dz_id=<dz>            302 to us-displays.burblesoft.com/jmp: an ExtJS manifest board (loads and
 *                                               slots for today), not a product list.
 *   store.burblesoft.com/?dz_id=<dz>             the dropzone's gift-card store. No robots.txt (404), server-rendered HTML,
 *                                               no key or login. Each card is a real product at its real price (weekday
 *                                               tandem, weekend tandem, video and photo packages) plus fixed-value cards.
 *                                               /detail/gift_card/<id> adds the description and the operator's own terms
 *                                               (age, weight, waiver, ID, time on site, refund rule).
 *
 * So the menu comes from the store: the same jump types and add-ons the booking page sells, in the operator's own words.
 * Fixed-value cards ("$100 towards skydiving services") are money, not a product, and are skipped. A dropzone with no
 * store returns null. The `dz_id` query binds a session cookie which the detail pages need, so the cookie is carried.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const STORE = "https://store.burblesoft.com";
const MAX_DETAILS = 12;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type BurbleRef = { dz: number };

/** Any Burble link or embed: bookings.burblesoft.com/index/<dz>/<page>, bookings.burblesoft.com/<dz>/<page>, or ?dz_id=<dz> on dzm/store. */
export function burbleRef(bookingUrlOrHtml: string): BurbleRef | null {
  const s = bookingUrlOrHtml || "";
  const m = s.match(/bookings\.burblesoft\.com\/(?:index\/)?(\d{1,7})(?![\d])/i) || s.match(/burblesoft\.com\/[^"'\s]*?[?&](?:amp;)?dz_id=(\d{1,7})/i);
  if (!m) return null;
  const dz = Number(m[1]);
  return dz > 0 ? { dz } : null;
}

async function getHtml(url: string, cookie: string | null): Promise<{ html: string; cookie: string | null } | null> {
  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9", ...(cookie ? { Cookie: cookie } : {}) },
      timeoutMs: 15000,
      maxBytes: 5_000_000,
    });
    if (!res.ok) return null;
    const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    const jar = set.map((c) => c.split(";")[0]).filter(Boolean);
    return { html: await res.text(), cookie: jar.length ? jar.join("; ") : cookie };
  } catch {
    return null;
  }
}

type StoreItem = { id: number; name: string; price: number | null; photo: string | null };

/** Product blocks on the store front: detail link, image, bold name, "$ 229.00", and the cart form's hidden name and price inputs. */
function parseFront(html: string): StoreItem[] {
  const out: StoreItem[] = [];
  const seen = new Set<number>();
  // Old template: <div class="span3 item">; 2025 template: <div class="card col mt-5 item">. Both end at the cart form.
  const re = /<div class="[^"]*\bitem\b[^"]*"[^>]*>([\s\S]*?)<\/form>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const block = m[1];
    const id = Number((block.match(/\/detail\/gift_card\/(\d+)/) || block.match(/add_gift_card\/(\d+)/) || [])[1]);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    const name = plain((block.match(/id="cart_item_name_\d+"[^>]*value="([^"]*)"/) || block.match(/value="([^"]*)"\s+id="cart_item_name_\d+"/) || block.match(/<strong>([\s\S]*?)<\/strong>/) || [])[1]);
    if (!name) continue;
    const priceRaw = (block.match(/value="([\d.]+)"\s+id="cart_item_price_\d+"/) || block.match(/id="cart_item_price_\d+"[^>]*value="([\d.]+)"/) || [])[1] ?? (block.match(/\$\s*([\d,]+(?:\.\d{2})?)/) || [])[1];
    const price = priceRaw ? Number(String(priceRaw).replace(/,/g, "")) : NaN;
    const photo = (block.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    seen.add(id);
    out.push({ id, name, price: Number.isFinite(price) && price > 0 ? price : null, photo });
  }
  return out;
}

/** A card worth a fixed sum of money is not a product. */
const MONEY_CARD = /^\$\s?\d|\b(?:towards?|toward)\b|\bgift (?:card|certificate|voucher)\b|\bvoucher\b|\bstore credit\b/i;
const ADD_ON = /\b(video|photo|stills|media|footage|camera|handcam|hand-?cam|go ?pro|outside cam|social media|t-?shirt|hoodie|merch|logbook|certificate of|upgrade)\b/i;

const REQ = /\b(must be|minimum age|ages?\s*\d|\d+\s*(?:\+|and up|or older|years? old|years of age)|under \d+|weight|\d{2,3}\s*(?:lbs?|pounds|kg)|waiver|photo id|government issued|identification|pregnan|sober|alcohol|drugs?|medical|physician|scuba|closed[- ]toe|swim)\b/i;
const POL = /\b(cancel|refund|deposit|reschedul|no[- ]show|weather|rain ?check|expire|valid (?:for|until|within)|used within|non-?transferable|transferable|forfeit|non-?refundable|full payment|gratuit|tip|late)\b/i;
const INC = /\b(includes?|included|provided|we provide|comes with)\b/i;
const NOISE = /\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}|http|@|click here|\bwww\b/i;

function sentence(s: string): string {
  const t = plain(s).replace(/^[^A-Za-z0-9$]+/, "").trim();
  return /[.!?]$/.test(t) ? t : t + ".";
}

/** Time on site only ("plan to be with us 3-4 hours"), never a "1 minute trimmed clip" or "60 seconds of freefall". */
function durationOf(text: string): string | null {
  const m = text.match(/\b(?:plan|allow|takes?|lasts?|spend|approximately|about|with us|on site|entire|whole|process|expect|arrive)\b[^.!?]{0,60}?\b(\d+(?:\.\d+)?(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?)\s*(hours?|hrs?)\b/i);
  if (!m) return null;
  return m[1].replace(/\s*to\s*/, "-").replace(/\s+/g, "") + " " + m[2].toLowerCase().replace(/^hrs?$/, "hours");
}

type Detail = { desc: string | null; terms: string[]; photo: string | null; name: string | null };

/** Detail page: an intro paragraph, then "Terms and Conditions:" as an ordered list. */
function parseDetail(raw: string): Detail {
  const html = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  const body = (html.match(/<div[^>]+class="[^"]*(?:span9|row-fluid|detail)[^"]*"[^>]*>([\s\S]*?)<\/form>/) || [null, html])[1] || html;
  const name = plain((body.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/) || [])[1]) || null;
  const photo = (body.match(/<img[^>]+src="([^"]+)"[^>]*alt="Gift card image"/) || body.match(/<img[^>]+src="(https?:\/\/store\.burblesoft\.com\/uploads\/[^"]+)"/) || [])[1] || null;
  const terms = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => plain(x[1])).filter((t) => t.length >= 8 && t.length <= 260 && !NOISE.test(t));
  // Description: paragraphs before the terms heading, minus the name and price.
  const before = body.split(/Terms and Conditions/i)[0];
  const paras = [...before.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((x) => plain(x[1])).filter((p) => p && !/^\$\s?[\d.,]+$/.test(p) && p !== name);
  // Sentences about the card itself ("Receive a gift card to print when your order is complete", "This gift certificate is
  // valid at: <address>", "You are purchasing a Gift Card through...") describe the store, not the jump, and are dropped.
  const joined = paras.join(" ").replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .filter((s) => !/\b(?:gift (?:card|certificate|voucher)s?|purchasing a|print when your order|valid at:|contact us|our (?:company )?website|schedule your)\b|\.(?:com|net|org)\b/i.test(s) && !NOISE.test(s))
    .join(" ").replace(/\s+/g, " ").trim();
  const desc = (joined.length > 700 ? joined.slice(0, 700).replace(/\s+\S*$/, "") : joined) || null;
  return { desc, terms, photo, name };
}

export async function readBurble(ref: BurbleRef): Promise<WidgetResult | null> {
  if (!ref || !(ref.dz > 0)) return null;
  if (!(await robotsAllowed(STORE, "/"))) return null;
  const front = await getHtml(`${STORE}/?dz_id=${ref.dz}`, null);
  if (!front) return null;
  const items = parseFront(front.html);
  if (!items.length) return null;
  const currency = (front.html.match(/var currency = '([A-Z]{3})'/) || [])[1] || null;
  const company: Company = { currency };
  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  let pages = 1;
  const products = items.filter((i) => !MONEY_CARD.test(i.name));
  for (const item of products.slice(0, MAX_DETAILS)) {
    await pause(300);
    const page = await getHtml(`${STORE}/detail/gift_card/${item.id}`, front.cookie);
    const d: Detail = page ? parseDetail(page.html) : { desc: null, terms: [], photo: null, name: null };
    if (page) pages++;
    const text = [d.desc || "", ...d.terms].join(" ");
    offerings.push({
      name: item.name.replace(/\s*!+\s*$/, ""),
      detail: ADD_ON.test(item.name) && !/tandem|jump|skydive|aff|course/i.test(item.name) ? "Add-on" : null,
      duration: durationOf(text),
      price: item.price,
      unit: "each",
      url: `${STORE}/detail/gift_card/${item.id}`,
      desc: d.desc,
      photo: d.photo || item.photo,
      photos: [...new Set([d.photo, item.photo].filter((x): x is string => !!x))],
    });
    for (const t of d.terms) {
      // A card's own life ("valid one year", "non-refundable, transferable") is a policy even when it never says "refund".
      if (/gift (?:card|certificate|voucher)|year of purchase|transfer+able|purchases are final|redeem/i.test(t) && !REQ.test(t)) { if (pol.size < 10) pol.add(sentence(t)); continue; }
      if (REQ.test(t)) { if (req.size < 10) req.add(sentence(t)); }
      else if (POL.test(t)) { if (pol.size < 10) pol.add(sentence(t)); }
      else if (INC.test(t)) { if (inc.size < 10) inc.add(sentence(t)); }
    }
    const mined = mineSentences(d.desc || "");
    mined.requirements.forEach((x) => req.size < 10 && req.add(x));
    mined.policies.forEach((x) => pol.size < 10 && pol.add(x));
    mined.includes.forEach((x) => inc.size < 10 && inc.add(x));
  }
  if (!offerings.length) return null;
  return { vendor: "burblesoft", offerings, company, requirements: [...req], policies: [...pol], includes: [...inc], pages };
}
