import { load } from "cheerio";
import { fetchHtml, sleep } from "../scrape/fetch.ts";
import { renderPage } from "../scrape/render.ts";
import { probeImage, shapeBonus } from "./imagesize.ts";
import { largestFromSrcset } from "./srcset.ts";
import { publishableImage } from "../sync/imageUrl.ts";

/**
 * The photo harvest itself: fetch an operator's own pages, collect real photos and videos, drop logos,
 * icons, badges and stock UI, score what is left. Split out of `images.ts` in September 2026 so the crawl
 * can run where there is no SQLite: `scripts/crawl-photos-ci.mts` runs exactly this code on a GitHub
 * Actions runner, reading a committed work list and writing a committed sidecar. Nothing here touches the
 * database, and nothing here may start to. `images.ts` keeps the database side and re-exports every name
 * below, so existing callers are unchanged.
 *
 * Breadth-first over the operator's own pages; the best few photos come back with the top one first.
 * We keep image URLs pointing at the operator's server. Nothing is copied to our storage.
 */

/**
 * Names that are not a photo of the place. The 11 Sept 2026 listing audit added scanned booklet pages (pg01.jpg, p2.png),
 * screen shots, schedules, menus, can mockups, Figma exports (Mask-group), wordmarks, theme placeholders (dummy.png,
 * og-default.jpg, 700x400.png) and page chrome (dividers, spacers). Tested on the last two path segments and the alt.
 */
export const BAD_NAME = /logo|icon|sprite|poster|flyer|giftcard|gift-card|gift_card|guide\d*\b|safety[-_]?guide|rules|waiver|form\b|page[-_]?\d|(?:^|[\/_\-. ])pg[-_]?\d{1,3}(?=[\/_\-.]|$)|(?:^|[\/_\-. ])p\d{1,2}(?=[_\-.]|$)|booklet|scan|document|pdf|certificate|license|licence|permit|card\d*\b|brochure|infographic|(?:^|[\/_\-. ])menus?(?=[\/_\-. (]|$)|menu-board|price-?list|schedule|badge|award|seal|payment|visa|mastercard|paypal|amex|tripadvisor|yelp|facebook|instagram|twitter|youtube|tiktok|google|bbb|chamber|certif|arrow|button|btn|banner-ad|placeholder|dummy|og-default|(?:^|\/)default[-_.]|(?:^|[\/_\-. ])\d{3,4}x\d{3,4}(?:[-_]\d+)?\.(?:jpe?g|png|webp)$|loading|spinner|pixel|tracking|avatar|profile|headshot|staff|team|map|flag|check|star|rating|review|coupon|gift|card|menu-?icon|hamburger|close|play|calendar|clock|phone|mail|social|footer|header|branding|brand|pattern|texture|blank|spacer|1x1|transparent|favicon|apple-touch|thumb-?nail|widget|weather|covid|member|rates?\b|price|pricing|special|deal|promo|sale|desktop|mobile|screen[-_ ]?shot|text|title|heading|quote|testimonial|partner|sponsor|affiliate|accessib|audioeye|mock-?ups?|mask[-_]?group|wordmark|lettermark|lockup|newsletter|cartoon|clip-?art|illustration|graphics?\b|floor[-_]?plan|course[-_]?layout|(?:^|[\/_\-. ])layout(?=[\/_\-.]|$)|removebg|divider|qr[-_]?code|(?:^|[\/_\-. ])qr(?=[\/_\-. ]|$)|thank[-_ ]?you|(?:^|[\/_\-. ])sorry(?=[\/_\-. ]|$)/i;
/**
 * A bot check is not a photograph. A site running BotDetect or a similar challenge answers with a one-off
 * CAPTCHA image whose address carries `get=image`, which is enough to get it past the extension gate above,
 * and whose path is `/.well-known/captcha/...` so no file name ever reaches BAD_NAME. Ten shipped listings
 * have one as their cover and eleven more carry one in the gallery, and it is not even a picture a guest can
 * see: the address is bound to the crawler's IP and a timestamp, so it answers nothing months later.
 *
 * Tested on the whole address, query string included, and mirrored in sync/contacts.ts `isPhotoName` so the
 * next sync drops the ones already stored.
 */
export const CHALLENGE_IMAGE = /\/\.well-known\/captcha\b|botdetect|(?:^|[/_\-. ?&=])captchas?(?:[/_\-. ?&=]|$)/i;

export function isChallengeImage(url: string): boolean {
  let full = url;
  try {
    full = decodeURIComponent(url);
  } catch {
    /* keep the raw address */
  }
  return CHALLENGE_IMAGE.test(full);
}

const GOOD_NAME = /jet|ski|kayak|paddle|boat|pontoon|charter|fish|cruise|sail|sunset|dolphin|snorkel|parasail|skydiv|tandem|jump|heli|balloon|kart|race|track|escape|room|axe|throw|paintball|horse|trail|ride|tour|rental|water|beach|ocean|lake|river|bay|island|adventure|fun|guest|group|family|action|hero|slide|gallery|photo|img_|dsc|image/i;
const PAGE_FIRST = /rental|rent|tour|trip|gallery|photo|experience|adventure|charter|activit|service|package|about/i;
const SKIP = /\.(pdf|zip|css|js|mp4|webm)$|\/(wp-json|feed|tag|category|author|cart|checkout|login|account|wp-admin|xmlrpc)\b|blog\/|\/news\/|\/page\/\d|\?|#/i;

export type Photo = { url: string; score: number; page: string; alt: string };
/** A moving cover: a direct mp4/webm/gif on the operator's site, or a YouTube / Vimeo embed. */
export type Video = { url: string; kind: "file" | "gif" | "embed"; score: number; page: string; poster: string | null };

const VIDEO_BAD = /logo|intro|loader|loading|spinner|background-?loop|testimonial|review|ad[-_]|advert|promo-?code|cookie/i;

function embedUrl(raw: string): string | null {
  const m1 = raw.match(/(?:youtube\.com\/(?:embed\/|watch\?v=|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m1) return "https://www.youtube.com/embed/" + m1[1];
  const m2 = raw.match(/vimeo\.com\/(?:video\/)?(\d{5,})/);
  if (m2) return "https://player.vimeo.com/video/" + m2[1];
  return null;
}

export function harvestVideos(html: string, pageUrl: string, seen: Map<string, Video>): void {
  const $ = load(html);
  const home = /^https?:\/\/[^/]+\/?$/.test(pageUrl);
  const put = (v: Video) => {
    const cur = seen.get(v.url);
    if (!cur || cur.score < v.score) seen.set(v.url, v);
  };
  const addFile = (raw: string | null, base: number, poster: string | null, near: string) => {
    if (!raw) return;
    const url = absUrl(raw, pageUrl);
    if (!url) return;
    const path = url.split("?")[0];
    const gif = /\.gif$/i.test(path);
    if (!gif && !/\.(mp4|webm|m4v|mov)$/i.test(path)) return;
    if (VIDEO_BAD.test(path.split("/").slice(-1)[0]) || VIDEO_BAD.test(near)) return;
    let score = base + (home ? 2 : 0);
    if (GOOD_NAME.test(path.split("/").slice(-1)[0])) score += 2;
    if (/hero|slider|banner|intro|featured|home/i.test(near)) score += 2;
    put({ url, kind: gif ? "gif" : "file", score: gif ? score - 1 : score, page: pageUrl, poster: poster ? absUrl(poster, pageUrl) : null });
  };
  $("video").each((_, el) => {
    const near = String($(el).attr("class") || "") + " " + String($(el).parent().attr("class") || "") + " " + String($(el).closest("section, div").attr("id") || "");
    const poster = $(el).attr("poster") || null;
    const bg = $(el).closest("header, [class*=hero], [class*=banner], [class*=slider]").length ? 3 : 0;
    addFile($(el).attr("src") || $(el).attr("data-src") || null, 4 + bg, poster, near);
    $(el).find("source").each((__, s) => addFile($(s).attr("src") || $(s).attr("data-src") || null, 4 + bg, poster, near));
  });
  addFile($('meta[property="og:video"]').attr("content") || $('meta[property="og:video:url"]').attr("content") || null, 3, $('meta[property="og:image"]').attr("content") || null, "og");
  $("img").each((_, el) => {
    const src = $(el).attr("data-src") || $(el).attr("src") || "";
    if (!/\.gif(\?|$)/i.test(src)) return;
    const w = dims($(el).attr("width"));
    const h = dims($(el).attr("height"));
    // `dims` answers 0 for an attribute that is not there, and a size test written against a declared size
    // passes everything that declares none. That is exactly the shape of a beacon: `<img src=".../g.gif">`
    // with no width, no height and no alt. A GIF only stands in for a video when the markup says it is big
    // enough to be one; the cost of asking is a genuine hero GIF that omits its size, and the fallback for
    // that is the cover the photo screen picked.
    if (!w || !h || w < 400 || h < 250) return;
    if ($(el).closest("header, nav, footer, aside").length) return;
    addFile(src, 2, null, String($(el).attr("alt") || "") + " " + String($(el).attr("class") || ""));
  });
  $("iframe[src], iframe[data-src], a[href*='youtu'], a[href*='vimeo']").each((_, el) => {
    const raw = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("href") || "";
    const url = embedUrl(raw);
    if (!url) return;
    if ($(el).closest("footer, nav").length) return;
    let score = 2 + (home ? 1 : 0);
    if ($(el).closest("[class*=hero], [class*=banner], [class*=video], [id*=video]").length) score += 2;
    put({ url, kind: "embed", score, page: pageUrl, poster: null });
  });
}

function absUrl(src: string, base: string): string | null {
  try {
    const u = new URL(src.trim(), base);
    if (!/^https?:$/.test(u.protocol)) return null;
    // A developer's own machine and a registrar's parking banner are addresses no guest can use.
    if (!publishableImage(u.toString())) return null;
    return u.toString();
  } catch {
    return null;
  }
}


function dims(v: string | undefined): number {
  const n = Number(String(v || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function harvestImages(html: string, pageUrl: string, seen: Map<string, Photo>): void {
  const $ = load(html);
  const servicePage = PAGE_FIRST.test(pageUrl);
  const add = (raw: string | null, base: number, alt = "") => {
    if (!raw) return;
    const url = absUrl(raw, pageUrl);
    if (!url) return;
    const path = url.split("?")[0];
    if (!/\.(jpe?g|png|webp|avif)$/i.test(path) && !/\.(jpe?g|png|webp)/i.test(url) && !/image|photo|upload|media|cdn|img/i.test(url)) return;
    if (/\.(svg|gif|ico)(\?|$)/i.test(path)) return;
    const name = path.split("/").slice(-2).join("/");
    if (isChallengeImage(url)) return;
    if (BAD_NAME.test(name) || BAD_NAME.test(alt)) return;
    let score = base;
    if (GOOD_NAME.test(name) || GOOD_NAME.test(alt)) score += 2;
    if (servicePage) score += 1;
    if (/wp-content\/uploads|\/uploads\/|\/images\/|\/img\/|\/media\/|\/gallery\//i.test(url)) score += 1;
    if (/-\d{2,3}x\d{2,3}\./.test(name)) score -= 2; // WordPress thumbnail variant
    const cur = seen.get(url);
    if (!cur || cur.score < score) seen.set(url, { url, score, page: pageUrl, alt: alt.slice(0, 120) });
  };

  // Social preview images are often the logo, so they only win when nothing better is on the page.
  add($('meta[property="og:image"]').attr("content") || null, 3, "og:image");
  add($('meta[name="twitter:image"]').attr("content") || null, 3, "twitter:image");
  $("img").each((_, el) => {
    const w = dims($(el).attr("width")) || dims($(el).css("width"));
    const h = dims($(el).attr("height")) || dims($(el).css("height"));
    if ((w && w < 320) || (h && h < 200)) return;
    const src = $(el).attr("data-src") || $(el).attr("data-lazy-src") || $(el).attr("src") || "";
    const srcset = $(el).attr("data-srcset") || $(el).attr("srcset") || "";
    const best = srcset ? largestFromSrcset(srcset) : null;
    const alt = $(el).attr("alt") || "";
    let base = 2;
    if (w >= 800 || h >= 500) base += 2;
    if ($(el).closest("header, nav, footer, aside").length) base -= 3;
    if ($(el).closest("[class*=hero], [class*=slider], [class*=slide], [class*=banner], [class*=gallery], [id*=hero], [id*=gallery]").length) base += 2;
    add(best || src, base, alt);
  });
  $("[style*=background]").each((_, el) => {
    const m = String($(el).attr("style") || "").match(/url\(["']?([^"')]+)["']?\)/i);
    if (!m) return;
    let base = 3;
    if ($(el).closest("header, nav, footer").length) base -= 3;
    add(m[1], base, "background");
  });
}

/** Read the real pixel size of the top candidates and let shape decide between them: a wide 1600px photo beats a 300px badge or a skinny banner. */
export async function rankByShape(list: Photo[]): Promise<Photo[]> {
  const sized = await Promise.all(list.map(async (p) => ({ p, bonus: shapeBonus(await probeImage(p.url)) })));
  return sized
    .filter((x) => x.bonus > -6)
    .map((x) => ({ ...x.p, score: x.p.score + x.bonus }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export async function collectPhotos(website: string, maxPages = 5): Promise<Photo[]> {
  return (await collectMedia(website, maxPages)).photos;
}

export async function collectMedia(website: string, maxPages = 12): Promise<{ photos: Photo[]; videos: Video[] }> {
  const start = website.startsWith("http") ? website : "https://" + website;
  const origin = new URL(start).origin;
  let home = await fetchHtml(start).catch(() => ({ status: 0, html: "", finalUrl: start }));
  const seen = new Map<string, Photo>();
  const vids = new Map<string, Video>();
  if (home.status === 200 && home.html) {
    harvestImages(home.html, home.finalUrl || start, seen);
    harvestVideos(home.html, home.finalUrl || start, vids);
  }
  // JavaScript-only sites carry their photos in the rendered DOM, not the HTML. Render before giving up.
  let rendered = false;
  if (seen.size < 2) {
    const r = await renderPage(start);
    if (r && !/performing security verification|verify you are not a bot|just a moment/i.test(r.html)) {
      home = { status: 200, html: r.html, finalUrl: r.finalUrl };
      harvestImages(r.html, r.finalUrl || start, seen);
      harvestVideos(r.html, r.finalUrl || start, vids);
      rendered = true;
    }
  }
  if (home.status !== 200 || !home.html) return { photos: [], videos: [] };
  const $ = load(home.html);
  const queue: string[] = [];
  const visited = new Set<string>([start.replace(/\/$/, "")]);
  $("a[href]").each((_, el) => {
    try {
      const u = new URL($(el).attr("href") || "", home.finalUrl || start);
      if (u.origin !== origin || SKIP.test(u.pathname + u.search + u.hash)) return;
      const clean = u.origin + u.pathname.replace(/\/$/, "");
      if (!visited.has(clean) && !queue.includes(clean)) (PAGE_FIRST.test(u.pathname + $(el).text()) ? queue.unshift(clean) : queue.push(clean));
    } catch {
      /* ignore */
    }
  });
  let pages = 1;
  while (queue.length && pages < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    await sleep(80);
    let res = await fetchHtml(url).catch(() => null);
    if (rendered && pages < 4) {
      const r = await renderPage(url, 12000);
      if (r) res = { status: 200, html: r.html, finalUrl: r.finalUrl };
    }
    if (!res || res.status !== 200 || !res.html) continue;
    harvestImages(res.html, res.finalUrl || url, seen);
    harvestVideos(res.html, res.finalUrl || url, vids);
    pages += 1;
  }
  return {
    photos: await rankByShape([...seen.values()].sort((a, b) => b.score - a.score).slice(0, 12)),
    videos: [...vids.values()].sort((a, b) => b.score - a.score).slice(0, 4),
  };
}
