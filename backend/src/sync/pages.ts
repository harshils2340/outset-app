import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { METROS } from "../taxonomy/catalog.ts";
import { GUIDES } from "../../../src/data/guides.ts";

/**
 * Programmatic landing pages: one static page per activity and metro, "Jet ski rentals in Tampa Bay".
 * Real operators, real menus and photos, a plain-language guide, and links into the app.
 * These exist for search engines and shared links; the app itself stays the product.
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../../../public");
const SITE = "https://harshils2340.github.io/outset-app/";

const KINDS: { art: string; label: string; plural: string; family: string }[] = [
  { art: "jetski", label: "Jet ski rentals", plural: "jet ski rentals", family: "water" },
  { art: "kayak", label: "Kayak and paddleboard rentals", plural: "kayak rentals", family: "water" },
  { art: "fishing", label: "Fishing charters", plural: "fishing charters", family: "water" },
  { art: "cruise", label: "Sunset cruises and sails", plural: "sunset cruises", family: "water" },
  { art: "pontoon", label: "Pontoon and boat rentals", plural: "boat rentals", family: "water" },
  { art: "parasail", label: "Parasailing", plural: "parasailing rides", family: "air" },
  { art: "skydive", label: "Tandem skydiving", plural: "skydives", family: "air" },
  { art: "heli", label: "Helicopter tours", plural: "helicopter tours", family: "air" },
  { art: "balloon", label: "Hot air balloon rides", plural: "balloon rides", family: "air" },
  { art: "kart", label: "Go-kart racing", plural: "karting tracks", family: "motorsport" },
  { art: "escape", label: "Escape rooms", plural: "escape rooms", family: "indoor" },
  { art: "axe", label: "Axe throwing", plural: "axe throwing venues", family: "indoor" },
  { art: "paintball", label: "Paintball", plural: "paintball fields", family: "outdoor" },
  { art: "horse", label: "Horseback riding", plural: "trail rides", family: "outdoor" },
  { art: "bowling", label: "Bowling alleys", plural: "bowling alleys", family: "play" },
  { art: "minigolf", label: "Mini golf", plural: "mini golf courses", family: "play" },
  { art: "arcade", label: "Arcades", plural: "arcades", family: "play" },
  { art: "trampoline", label: "Trampoline parks", plural: "trampoline parks", family: "play" },
  { art: "lasertag", label: "Laser tag", plural: "laser tag arenas", family: "play" },
  { art: "icerink", label: "Ice skating rinks", plural: "ice rinks", family: "play" },
  { art: "waterpark", label: "Water parks", plural: "water parks", family: "play" },
  { art: "themepark", label: "Theme parks", plural: "theme parks", family: "play" },
  { art: "zoo", label: "Zoos", plural: "zoos", family: "play" },
  { art: "aquarium", label: "Aquariums", plural: "aquariums", family: "play" },
  { art: "karaoke", label: "Karaoke rooms", plural: "karaoke rooms", family: "play" },
  { art: "climbing", label: "Climbing gyms", plural: "climbing gyms", family: "indoor" },
  { art: "range", label: "Shooting ranges", plural: "shooting ranges", family: "outdoor" },
  { art: "archery", label: "Archery", plural: "archery ranges", family: "outdoor" },
  { art: "golf", label: "Golf courses", plural: "golf courses", family: "outdoor" },
  { art: "zipline", label: "Ziplines", plural: "ziplines", family: "outdoor" },
  { art: "ski", label: "Ski resorts", plural: "ski areas", family: "outdoor" },
  { art: "bike", label: "Bike rentals", plural: "bike rentals", family: "outdoor" },
  { art: "snowmobile", label: "Snowmobile tours", plural: "snowmobile tours", family: "outdoor" },
  { art: "rafting", label: "Rafting", plural: "rafting trips", family: "water" },
  { art: "scuba", label: "Scuba and snorkel", plural: "dive shops", family: "water" },
  { art: "surf", label: "Surf lessons", plural: "surf schools", family: "water" },
  { art: "paragliding", label: "Paragliding", plural: "paragliding launches", family: "air" },
  { art: "gliding", label: "Glider flights", plural: "glider rides", family: "air" },
  { art: "brewery", label: "Breweries", plural: "breweries", family: "food" },
  { art: "winery", label: "Wineries", plural: "wineries", family: "food" },
  { art: "distillery", label: "Distilleries", plural: "distilleries", family: "food" },
  { art: "cooking", label: "Cooking classes", plural: "cooking classes", family: "food" },
  { art: "spa", label: "Spas", plural: "day spas", family: "wellness" },
  { art: "yoga", label: "Yoga studios", plural: "yoga studios", family: "wellness" },
  { art: "dance", label: "Dance classes", plural: "dance studios", family: "wellness" },
  { art: "pottery", label: "Pottery and art classes", plural: "art studios", family: "wellness" },
];

type Item = Record<string, unknown> & {
  id: string; title: string; art: string; area: string; metroId: string; rating?: number | null; reviews?: number | null; cover?: string;
  options: { name: string; detail?: string; price: number | null; per?: string }[];
  services?: { name: string; desc: string | null; variants: { label: string; price: number | null }[] }[];
  blurb?: string;
};

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => (Number.isInteger(n) ? "$" + n.toLocaleString("en-US") : "$" + n.toFixed(2));

const CSS = `
:root{color-scheme:light}body{margin:0;font-family:Inter,"Helvetica Neue",Arial,sans-serif;color:#222;background:#fff}
a{color:inherit}.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid #ebebeb}.top{display:flex;justify-content:space-between;align-items:center;height:64px}
.logo{font-weight:700;font-size:20px;color:#E54D2C;text-decoration:none}.cta{background:#E54D2C;color:#fff;text-decoration:none;border-radius:999px;padding:10px 16px;font-weight:600;font-size:14px}
h1{font-size:34px;letter-spacing:-.02em;margin:34px 0 8px}.lede{font-size:17px;color:#555;margin:0 0 24px;max-width:70ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:22px 16px}
.card{text-decoration:none;display:block}.art{aspect-ratio:1/1;border-radius:16px;overflow:hidden;background:#f3f3f3}.art img{width:100%;height:100%;object-fit:cover;display:block}
.card > b{display:block;margin-top:8px;font-size:15px}.meta b{font-weight:700}.card small{display:block;color:#717171;font-size:13px}.meta{display:flex;justify-content:space-between;font-size:13px;margin-top:4px}
.menu{margin:4px 0 0;padding:0;list-style:none;font-size:12.5px;color:#555}.menu li{display:flex;justify-content:space-between;gap:8px}
.guide{margin:44px 0;padding:24px;border:1px solid #ebebeb;border-radius:18px;background:#fafafa}.guide h2{margin:0 0 6px;font-size:20px}.guide ol{margin:10px 0 0 18px;padding:0;color:#444;line-height:1.5}
.faq{margin:10px 0 40px}.faq h3{font-size:16px;margin:16px 0 4px}.faq p{margin:0;color:#444;line-height:1.5}
.links{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 40px}.links a{border:1px solid #ddd;border-radius:999px;padding:7px 12px;font-size:13px;text-decoration:none;color:#222}
footer{border-top:1px solid #ebebeb;padding:20px 0 40px;color:#717171;font-size:13px}
`;

function page(kind: (typeof KINDS)[number], metro: (typeof METROS)[number] | null, items: Item[], allMetros: { id: string; name: string }[]): string {
  const where = metro ? `${metro.name}, ${metro.region}` : "the US and Canada";
  const title = `${kind.label} in ${where}`;
  const guide = GUIDES[kind.art as keyof typeof GUIDES];
  const priced = items.filter((i) => i.options.some((o) => o.price != null));
  const minPrice = priced.length ? Math.min(...priced.flatMap((i) => i.options.map((o) => o.price).filter((n): n is number => n != null))) : null;
  const cards = items
    .slice(0, 36)
    .map((i) => {
      const from = i.options.map((o) => o.price).filter((n): n is number => n != null);
      const menu = (i.services || [])
        .slice(0, 3)
        .map((s) => {
          const v = s.variants.find((x) => x.price != null);
          return `<li><span>${esc(s.name)}</span><span>${v && v.price != null ? esc(money(v.price)) : ""}</span></li>`;
        })
        .join("");
      return `<a class="card" href="${SITE}#o=${esc(i.id)}">
  <div class="art">${i.cover ? `<img src="${esc(i.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</div>
  <b>${esc(i.title)}</b><small>${esc(i.area)}</small>
  <div class="meta"><span>${from.length ? "From <b>" + esc(money(Math.min(...from))) + "</b>" : "Request to book"}</span>${i.rating ? `<span>★ ${Number(i.rating).toFixed(1)}${i.reviews ? " (" + Number(i.reviews).toLocaleString() + ")" : ""}</span>` : ""}</div>
  ${menu ? `<ul class="menu">${menu}</ul>` : ""}
</a>`;
    })
    .join("\n");
  const others = allMetros
    .filter((m) => !metro || m.id !== metro.id)
    .slice(0, 24)
    .map((m) => `<a href="${kind.art}-in-${m.id}.html">${esc(m.name)}</a>`)
    .join("");
  const kinds = KINDS.filter((k) => k.art !== kind.art)
    .map((k) => `<a href="${k.art}-in-${metro ? metro.id : "anywhere"}.html">${esc(k.label)}</a>`)
    .join("");
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    itemListElement: items.slice(0, 36).map((i, n) => ({ "@type": "ListItem", position: n + 1, name: i.title, url: `${SITE}#o=${i.id}` })),
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Outset</title>
<meta name="description" content="${esc(`${items.length} ${kind.plural} in ${where} with real prices, photos and instant booking. ${minPrice != null ? "From " + money(minPrice) + "." : ""} Book the jump. Skip the call.`)}">
<link rel="canonical" href="${SITE}p/${kind.art}-in-${metro ? metro.id : "anywhere"}.html">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>${CSS}</style></head><body>
<header><div class="wrap top"><a class="logo" href="${SITE}">Outset</a><a class="cta" href="${SITE}">Open Outset</a></div></header>
<main class="wrap">
<h1>${esc(title)}</h1>
<p class="lede">${esc(items.length)} ${esc(kind.plural)} ${metro ? "around " + esc(metro.name) : "across the US and Canada"} with menus and prices taken from each operator's own site${minPrice != null ? ", from " + esc(money(minPrice)) : ""}. Pick a time and book. No phone tag.</p>
<div class="grid">${cards}</div>
<section class="guide"><h2>What ${esc(guide ? kind.label.toLowerCase() : kind.label)} is actually like</h2><p>${esc(guide?.hook || "")}</p><ol>${(guide?.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p><b>Bring:</b> ${esc((guide?.bring || []).join(", "))}. <b>Good for:</b> ${esc(guide?.goodFor || "")}</p></section>
<section class="faq"><h3>How much does it cost?</h3><p>${minPrice != null ? `Published prices here start at ${esc(money(minPrice))}. Most operators list a few options by duration or group size; the exact menu is on each listing.` : "Prices vary by operator and duration. Each listing shows what the operator publishes."}</p>
<h3>Do I need to call to book?</h3><p>No. Pick a listing, choose a time and the number of guests, and book. The operator confirms on Outset.</p>
<h3>Where does this information come from?</h3><p>From each operator's own website and public listings. Operators can claim their page and correct anything.</p></section>
<h3>Other places</h3><div class="links">${others}</div>
<h3>Other activities${metro ? " in " + esc(metro.name) : ""}</h3><div class="links">${kinds}</div>
</main>
<footer><div class="wrap">Outset · Book the jump. Skip the call.</div></footer>
</body></html>`;
}

export function writeLandingPages(items: Item[]): { pages: number } {
  const dir = join(publicDir, "p");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".html")) unlinkSync(join(dir, f));
  const rank = (a: Item, b: Item) => (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || (b.reviews || 0) - (a.reviews || 0);
  const urls: string[] = [];
  let pages = 0;
  for (const kind of KINDS) {
    const all = items.filter((i) => i.art === kind.art).sort(rank);
    const metrosWith = METROS.filter((m) => all.some((i) => i.metroId === m.id));
    writeFileSync(join(dir, `${kind.art}-in-anywhere.html`), page(kind, null, all, metrosWith));
    urls.push(`${SITE}p/${kind.art}-in-anywhere.html`);
    pages += 1;
    for (const m of metrosWith) {
      const local = all.filter((i) => i.metroId === m.id);
      if (local.length < 2) continue;
      writeFileSync(join(dir, `${kind.art}-in-${m.id}.html`), page(kind, m, local, metrosWith));
      urls.push(`${SITE}p/${kind.art}-in-${m.id}.html`);
      pages += 1;
    }
  }
  const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Experiences by activity and city · Outset</title><style>${CSS}</style></head><body><header><div class="wrap top"><a class="logo" href="${SITE}">Outset</a></div></header><main class="wrap"><h1>Experiences by activity and city</h1><div class="links">${urls.map((u) => `<a href="${u}">${esc(u.split("/p/")[1].replace(".html", "").replace(/-in-/, " in ").replace(/-/g, " "))}</a>`).join("")}</div></main></body></html>`;
  writeFileSync(join(dir, "index.html"), index);
  writeFileSync(join(publicDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[SITE, `${SITE}p/index.html`, ...urls].map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`);
  writeFileSync(join(publicDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
  return { pages };
}
