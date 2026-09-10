import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { db, nowIso } from "../db/client.ts";
import { fetchHtml, sleep, withDeadline } from "../scrape/fetch.ts";
import { renderPage } from "../scrape/render.ts";
import { probeImage, shapeBonus } from "./imagesize.ts";

/**
 * Photo harvest from each operator's own site. Breadth-first over their pages, collect real photos,
 * drop logos, icons, badges and stock UI, score what is left, and keep the best few with the top one as cover.
 * We store image URLs pointing at the operator's server. Nothing is copied to our storage.
 */

const BAD_NAME = /logo|icon|sprite|poster|flyer|giftcard|gift-card|gift_card|brochure|infographic|menu-board|price-?list|badge|award|seal|payment|visa|mastercard|paypal|amex|tripadvisor|yelp|facebook|instagram|twitter|youtube|tiktok|google|bbb|chamber|certif|arrow|button|btn|banner-ad|placeholder|loading|spinner|pixel|tracking|avatar|profile|headshot|staff|team|map|flag|check|star|rating|review|coupon|gift|card|menu-?icon|hamburger|close|play|calendar|clock|phone|mail|social|footer|header|branding|brand|pattern|texture|blank|spacer|1x1|transparent|favicon|apple-touch|thumb-?nail|widget|weather|covid|member|rates?\b|price|pricing|special|deal|promo|sale|desktop|mobile|screenshot|text|title|heading|quote|testimonial|partner|sponsor|affiliate|accessib|audioeye/i;
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
    if ((w && w < 400) || (h && h < 250)) return;
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
    return u.toString();
  } catch {
    return null;
  }
}

function largestFromSrcset(srcset: string): string | null {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(",")) {
    const [url, size] = part.trim().split(/\s+/);
    const w = size ? Number(size.replace(/w$|x$/, "")) * (size.endsWith("x") ? 1000 : 1) : 0;
    if (url && (!best || w > best.w)) best = { url, w };
  }
  return best?.url || null;
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

export async function photosForOperator(op: { id: string; domain: string; website: string }): Promise<number> {
  const { photos, videos } = await collectMedia(op.website);
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key IN ('photo', 'cover', 'video', 'video_embed')").run(op.id);
  db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'photos'").run(op.id);
  const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')");
  photos.forEach((p, i) => {
    ins.run(randomUUID(), op.id, i === 0 ? "cover" : "photo", p.url, p.page);
    if (i === 0) ins.run(randomUUID(), op.id, "photo", p.url, p.page);
  });
  // One moving cover: a file the card can autoplay, and separately the best embed for the listing page.
  const file = videos.find((v) => v.kind !== "embed");
  const embed = videos.find((v) => v.kind === "embed");
  if (file) ins.run(randomUUID(), op.id, "video", file.url, file.page);
  if (embed) ins.run(randomUUID(), op.id, "video_embed", embed.url, embed.page);
  db.prepare(
    "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'photos', 1, ?)",
  ).run(randomUUID(), op.id, op.website, nowIso(), photos.length + " photos" + (videos.length ? ", " + videos.length + " videos" : ", video checked") + " linked from the operator's own pages");
  return photos.length;
}

/** Operators already crawled for photos but never checked for video. Best-covered metros first. */
export function pendingVideos(limit: number): { id: string; domain: string; website: string }[] {
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL
         AND EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'photos' AND s.note NOT LIKE '%video%' AND s.note NOT LIKE '%checked%')
         AND EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

export function pendingPhotos(limit: number): { id: string; domain: string; website: string }[] {
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'photos')
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

/** Operators the photo crawl already visited and came back empty-handed. Worth a second pass through the browser. */
export function pendingPhotosEmpty(limit: number): { id: string; domain: string; website: string }[] {
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL
         AND EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'photos')
         AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

export async function photosPending(limit: number, concurrency = 8, mode: "photos" | "videos" | "empty" = "photos"): Promise<{ sites: number; withPhotos: number; photos: number }> {
  const queue = mode === "videos" ? pendingVideos(limit) : mode === "empty" ? pendingPhotosEmpty(limit) : pendingPhotos(limit);
  const out = { sites: 0, withPhotos: 0, photos: 0 };
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const n = await withDeadline(photosForOperator(op), mode === "photos" ? 60000 : 120000, op.domain);
        out.sites += 1;
        if (n) out.withPhotos += 1;
        out.photos += n;
      } catch (e) {
        out.sites += 1;
        console.error(op.domain + ": " + (e as Error).message.slice(0, 120));
      }
      if (out.sites % 100 === 0) console.log(`${out.sites}/${queue.length} sites, ${out.withPhotos} with photos, ${out.photos} photos`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
