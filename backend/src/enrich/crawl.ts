import { load } from "cheerio";
import { fetchHtml, sleep } from "../scrape/fetch.ts";

/**
 * Site crawl for enrichment. Fetches the operator's own pages only, honoring robots.txt via fetchHtml.
 * Social networks are login-walled and forbid scraping, so we collect their public handles from the
 * operator's links and stop there.
 */

export type CrawledPage = { url: string; title: string; text: string };
export type SocialLinks = Partial<Record<"instagram" | "facebook" | "tiktok" | "youtube" | "yelp" | "tripadvisor" | "google", string>>;
export type CrawlResult = { pages: CrawledPage[]; social: SocialLinks; bookingVendor: string | null };

const WANT = /about|price|pricing|rate|cost|tour|trip|rental|rent|book|reserv|faq|contact|hour|service|package|experience|adventure|charter|lesson|group|party|event|policy|waiver|safety|require/i;
const SKIP = /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|zip)$|\/(wp-json|feed|tag|category|author|cart|checkout|login|account|blog\/page)\b|#|\?/i;
const SOCIAL: [keyof SocialLinks, RegExp][] = [
  ["instagram", /instagram\.com\/([A-Za-z0-9_.]+)/i],
  ["facebook", /facebook\.com\/([A-Za-z0-9_.\-]+)/i],
  ["tiktok", /tiktok\.com\/@([A-Za-z0-9_.]+)/i],
  ["youtube", /youtube\.com\/(?:@|channel\/|c\/|user\/)([A-Za-z0-9_.\-]+)/i],
  ["yelp", /yelp\.[a-z.]+\/biz\/([A-Za-z0-9_\-]+)/i],
  ["tripadvisor", /tripadvisor\.[a-z.]+\/([A-Za-z0-9_\-]+\.html)/i],
  ["google", /(g\.page\/[A-Za-z0-9_\-]+|goo\.gl\/maps\/[A-Za-z0-9_\-]+|google\.com\/maps\/place\/[^"'\s]+)/i],
];
const VENDORS: [string, RegExp][] = [
  ["fareharbor", /fareharbor\.com/i], ["peek", /peek\.com|peekpro/i], ["checkfront", /checkfront\.com/i],
  ["rezdy", /rezdy\.com/i], ["xola", /xola\.com/i], ["bookeo", /bookeo\.com/i], ["resova", /resova\.com/i],
  ["booksy", /booksy\.com/i], ["square", /squareup\.com\/appointments|square\.site/i], ["simplybook", /simplybook\.me/i],
  ["bookinglayer", /bookinglayer/i], ["rezgo", /rezgo\.com/i], ["singenuity", /singenuity/i],
];

function visibleText(html: string): { title: string; text: string } {
  const $ = load(html);
  $("script, style, noscript, svg, iframe, nav, footer, header, form, [aria-hidden='true']").remove();
  const title = $("title").first().text().trim();
  const parts: string[] = [];
  $("h1, h2, h3, h4, p, li, td, th, dt, dd, span, div, a, label").each((_, el) => {
    const t = $(el).clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    if (t.length >= 2) parts.push(t);
  });
  const seen = new Set<string>();
  const lines = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return { title, text: lines.join("\n").slice(0, 14000) };
}

export async function crawlSite(website: string, maxPages = 25): Promise<CrawlResult> {
  const start = website.startsWith("http") ? website : "https://" + website;
  const origin = new URL(start).origin;
  const home = await fetchHtml(start);
  const pages: CrawledPage[] = [];
  const social: SocialLinks = {};
  let bookingVendor: string | null = null;
  if (home.status !== 200 || !home.html) return { pages, social, bookingVendor };

  const queue: string[] = [];
  const seen = new Set<string>([start]);
  const harvest = (html: string, baseUrl: string) => {
    const $ = load(html);
    for (const [k, re] of VENDORS) if (!bookingVendor && re.test(html)) bookingVendor = k;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      for (const [k, re] of SOCIAL) {
        const m = href.match(re);
        if (m && !social[k]) social[k] = m[1];
      }
      try {
        const abs = new URL(href, baseUrl);
        if (abs.origin !== origin || SKIP.test(abs.pathname + abs.search + abs.hash)) return;
        const clean = abs.origin + abs.pathname.replace(/\/$/, "");
        if (!seen.has(clean) && !queue.includes(clean)) {
          // Breadth-first over the whole site, but likely service and pricing pages go to the front of the line.
          if (WANT.test(abs.pathname + " " + $(el).text())) queue.unshift(clean);
          else queue.push(clean);
        }
      } catch {
        /* ignore */
      }
    });
  };

  const homeText = visibleText(home.html);
  pages.push({ url: home.finalUrl || start, ...homeText });
  harvest(home.html, home.finalUrl || start);

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    await sleep(120);
    const res = await fetchHtml(url).catch(() => null);
    if (!res || res.status !== 200 || !res.html) continue;
    const t = visibleText(res.html);
    if (t.text.length < 200) continue;
    pages.push({ url: res.finalUrl || url, ...t });
    harvest(res.html, res.finalUrl || url);
  }
  return { pages, social, bookingVendor };
}

/* ---------- what the model actually reads ---------- */

const PAGE_SCORE: [RegExp, number][] = [
  [/price|pricing|rate|cost|fee/i, 6],
  [/book|reserv|schedule|availability/i, 4],
  [/faq|question|policy|policies|waiver|rule|require|safety|terms|cancel|refund|weather/i, 5],
  [/tour|trip|rental|rent|charter|lesson|class|package|experience|adventure|session|ride|flight|jump|cruise|room|lane/i, 3],
  [/service|activit|what-we-offer|offer/i, 3],
  [/about|hour|contact|location|direction|find-us/i, 2],
  [/blog|news|gallery|photo|video|review|testimonial|career|job|team|staff|press|gift|shop|cart|privacy|sitemap|login/i, -6],
];

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.8);
}

/**
 * Pick the handful of pages that carry prices, rules and policies, drop lines that repeat across pages
 * (menus, footers, cookie banners), and cap the total so one site costs a few thousand tokens, not fifty.
 */
export function selectPages(pages: CrawledPage[], opts: { maxPages?: number; maxChars?: number; perPageChars?: number } = {}): CrawledPage[] {
  const maxPages = opts.maxPages ?? 7;
  const maxChars = opts.maxChars ?? 30000;
  const perPageChars = opts.perPageChars ?? 8000;
  if (!pages.length) return [];
  // Lines seen on 2+ pages are chrome, not content.
  const counts = new Map<string, number>();
  for (const pg of pages) for (const line of new Set(pg.text.split("\n"))) counts.set(line, (counts.get(line) || 0) + 1);
  const dedupe = (t: string) =>
    t
      .split("\n")
      .filter((line) => line.length >= 3 && (pages.length < 2 || (counts.get(line) || 0) < 2 || /\$\s?\d/.test(line)))
      .filter((line) => !/^(home|menu|close|search|login|sign in|cart|©|copyright|all rights reserved|skip to|cookie|accept|privacy policy|terms)/i.test(line))
      .join("\n");
  const scored = pages.map((pg, i) => {
    let score = i === 0 ? 3 : 0;
    const key = pg.url + " " + pg.title;
    for (const [re, n] of PAGE_SCORE) if (re.test(key)) score += n;
    const money = (pg.text.match(/\$\s?\d/g) || []).length;
    score += Math.min(6, money);
    if (/\b(must be|minimum age|years old|weight|licen[cs]e|cancel|refund|deposit|waiver)\b/i.test(pg.text)) score += 3;
    return { pg, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const out: CrawledPage[] = [];
  let used = 0;
  for (const { pg, score } of scored) {
    if (out.length >= maxPages || score < 0) break;
    const text = dedupe(pg.text).slice(0, perPageChars);
    if (text.length < 120) continue;
    if (used + text.length > maxChars) {
      const room = maxChars - used;
      if (room < 1500) break;
      out.push({ ...pg, text: text.slice(0, room) });
      break;
    }
    out.push({ ...pg, text });
    used += text.length;
  }
  return out.length ? out : [{ ...pages[0], text: dedupe(pages[0].text).slice(0, perPageChars) }];
}
