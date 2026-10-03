// Visual check for the marketing pages, run headless (never a visible browser):
//   node scripts/ui-check.mjs [url ...]            default: the home, features and integrations pages on :5173
// At a desktop and a phone size it flags what a screenshot glance misses: text that fails contrast against what is
// really behind it, a button or link covered by another element, sideways overflow, images or files that did not
// load, and console errors. Exits 1 when anything is found. The reviews marquee is skipped (its owner keeps it as is).
import { chromium } from "../backend/node_modules/playwright/index.mjs";

const urls = process.argv.slice(2).length ? process.argv.slice(2)
  : ["http://localhost:5173/", "http://localhost:5173/features", "http://localhost:5173/integrations", "http://localhost:5173/pricing"];
const sizes = [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]];

const audit = () => {
  const SKIP = ".reviews, .print, .scene, svg, canvas, script, style";
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  const vw = document.documentElement.clientWidth;
  const issues = [];
  if (document.documentElement.scrollWidth > vw + 1) {
    const wide = [...document.querySelectorAll("body *")].filter((e) => !e.closest(".reviews") && getComputedStyle(e).position !== "fixed" && e.getBoundingClientRect().right > vw + 1).slice(0, 5).map(name);
    issues.push("sideways overflow: page is " + document.documentElement.scrollWidth + "px on a " + vw + "px screen (" + wide.join(", ") + ")");
  }
  for (const img of document.images) if (img.complete && img.naturalWidth === 0 && !img.closest(".reviews")) issues.push("image did not load: " + img.getAttribute("src"));
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(SKIP)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === "hidden" || +cs.opacity < 0.2 || el.closest("[hidden],[aria-hidden='true']")) continue;
    const fg = parse(cs.color); if (!fg || fg.a === 0) continue;
    const bg = bgOf(el); if (!bg) continue;
    const c = ratio(over(fg, bg), bg), size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (c < need) { const k = name(el) + "|" + Math.round(c * 10); if (!seen.has(k)) { seen.add(k); issues.push(`low contrast ${c.toFixed(2)}:1 (needs ${need}) on ${name(el)}: "${el.textContent.trim().slice(0, 40)}"`); } }
  }
  return issues;
};

const covered = async (page) => {
  const out = [];
  const n = await page.evaluate(() => document.querySelectorAll("a[href], button, [role=slider]").length);
  for (let i = 0; i < n; i++) {
    const res = await page.evaluate((i) => {
      const el = document.querySelectorAll("a[href], button, [role=slider]")[i];
      if (!el || el.closest(".reviews, [hidden]") || getComputedStyle(el).position === "fixed") return null;
      const r0 = el.getBoundingClientRect(); if (!r0.width || !r0.height) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
      const hit = document.elementFromPoint(x, y);
      if (!hit || el.contains(hit) || hit.contains(el)) return null;
      if (hit.closest(".pill")) return null; // the floating demo button, by design
      return (el.textContent.trim() || el.getAttribute("aria-label") || el.tagName).slice(0, 40) + " is covered by " + hit.tagName.toLowerCase() + (hit.className && typeof hit.className === "string" ? "." + hit.className.split(" ")[0] : "") + (hit.closest(".print") ? " (a pinned print)" : "");
    }, i);
    if (res) out.push(res);
  }
  return out;
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
let total = 0;
for (const url of urls) {
  for (const [label, opts] of sizes) {
    const page = await browser.newPage(opts);
    const errs = [];
    page.on("pageerror", (e) => errs.push("page error: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 140)); });
    page.on("response", (r) => { if (r.status() >= 400 && !/randomuser|favicon\.ico/.test(r.url())) errs.push("HTTP " + r.status() + ": " + r.url()); });
    const resp = await page.goto(url, { waitUntil: "load", timeout: 30000 }).catch((e) => ({ status: () => "failed: " + e.message }));
    if (!resp || resp.status() !== 200) { console.log(`\n${url} [${label}]\n  could not load (${resp && resp.status()})`); total++; await page.close(); continue; }
    await page.waitForTimeout(900);
    const issues = [...errs, ...(await page.evaluate(audit)), ...(await covered(page))];
    total += issues.length;
    console.log(`\n${url} [${label}]` + (issues.length ? "" : "  OK"));
    for (const i of issues) console.log("  - " + i);
    await page.close();
  }
}
await browser.close();
console.log(`\n${total} issue(s)`);
process.exit(total ? 1 : 0);
