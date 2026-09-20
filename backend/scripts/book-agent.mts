import { chromium, type Frame, type Page } from "playwright";
import { db } from "../src/db/client.ts";

/**
 * The booking agent: it opens an operator's own booking system and reads what is really available.
 *
 * Every local business runs a different one. Five businesses within twenty minutes of Waterloo use Bookeo,
 * Checkfront, Wix Bookings and a hand-rolled form between them, which is exactly why nobody has made local
 * experiences bookable in one place: there is no API to integrate, there are ten thousand of them.
 *
 * So the agent does what a person does. It finds the widget, waits for it, steps into whatever iframe it lives
 * in, picks a service, opens the calendar and reads the times back. Nothing about a particular vendor is
 * hard-coded beyond knowing what their widgets are called, so a business we have never seen still works.
 *
 *   npx tsx scripts/book-agent.mts <booking url>
 *   npx tsx scripts/book-agent.mts --domain=kwescape.ca      the booking link we hold for that operator
 *   npx tsx scripts/book-agent.mts --shot=out.png <url>      leave a screenshot of where it got to
 */

export const VENDORS: [RegExp, string][] = [
  [/fareharbor/i, "FareHarbor"], [/book\.peek|peek\.com/i, "Peek"], [/xola/i, "Xola"],
  [/bookeo/i, "Bookeo"], [/resova/i, "Resova"], [/checkfront/i, "Checkfront"],
  [/acuityscheduling|squarespace-scheduling/i, "Acuity"], [/calendly/i, "Calendly"],
  [/setmore/i, "Setmore"], [/mindbody/i, "Mindbody"], [/rezdy/i, "Rezdy"],
  [/tripworks/i, "TripWorks"], [/bookwhen/i, "Bookwhen"], [/wixapps|bookings-viewer|wix/i, "Wix Bookings"],
  [/square(up)?\.com\/appointments/i, "Square"],
];

const MONEY = /\$\s?\d{1,4}(?:[.,]\d{2})?/g;
const CLOCK = /\b(?:1[0-2]|0?[1-9])[:.][0-5]\d\s?(?:am|pm|AM|PM)\b/g;
const DATEISH = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?,?\s+\w*\s?\d{1,2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/g;

export type Read = { url: string; vendor: string | null; services: string[]; prices: string[]; times: string[]; dates: string[]; note: string };

const uniq = (a: string[]) => Array.from(new Set(a.map((s) => s.trim()).filter(Boolean)));

/** Text from every frame we are allowed to read, because the widget is almost never in the top document. */
async function allText(page: Page): Promise<string> {
  const out: string[] = [];
  for (const f of page.frames() as Frame[]) {
    try {
      out.push((await f.locator("body").innerText({ timeout: 3500 })).replace(/\s+/g, " "));
    } catch {
      /* cross-origin, or the frame went away mid-read */
    }
  }
  return out.join("  ");
}

/** The frame the booking widget is in: the deepest one whose URL or body looks like a booking system. */
async function widgetFrame(page: Page): Promise<Frame> {
  let best = page.mainFrame();
  let bestScore = 0;
  for (const f of page.frames() as Frame[]) {
    let score = 0;
    for (const [re] of VENDORS) if (re.test(f.url())) score += 3;
    try {
      const t = await f.locator("body").innerText({ timeout: 2500 });
      if (/select a date|choose a date|availability|book now|participants|how many/i.test(t)) score += 2;
      if (CLOCK.test(t)) score += 2;
    } catch {
      /* not readable */
    }
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/**
 * Widgets are nearly always lazy: the iframe exists but does not start loading until it is scrolled into view,
 * which a headless run never does on its own. KW Escape's Bookeo frame sat on its spinner forever until this
 * walked the page down past it.
 */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 350));
    }
    window.scrollTo(0, 0);
  }).catch(() => {});
  // And put any booking iframe itself in front of the viewport, for the ones that watch the frame not the page.
  const frameEl = page.locator("iframe").first();
  if (await frameEl.count()) await frameEl.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
}

/** Wait for a widget that loads itself after the page is "ready": they nearly all do. */
async function settle(page: Page, ms = 12000): Promise<void> {
  await scrollThrough(page);
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    await page.waitForTimeout(1500);
    const now = await allText(page);
    if (now.length > 200 && now === last) return; // stopped changing: the widget has drawn
    last = now;
  }
}

export async function readBooking(url: string, opts: { shot?: string } = {}): Promise<Read> {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  const vendors = new Set<string>();
  page.on("request", (r) => { for (const [re, v] of VENDORS) if (re.test(r.url())) vendors.add(v); });
  const note: string[] = [];
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page);

    // One click is usually all that stands between the page and the widget.
    const cta = page.locator("a,button").filter({ hasText: /^\s*(book|reserve|check availability|book now|book your|schedule)/i }).first();
    if (await cta.count()) {
      await cta.scrollIntoViewIfNeeded().catch(() => {});
      await cta.click({ timeout: 8000 }).catch(() => note.push("cta click refused"));
      await settle(page);
    }

    const frame = await widgetFrame(page);
    for (const [re, v] of VENDORS) if (re.test(frame.url())) vendors.add(v);

    // Pick the first real service, which is what opens the calendar on most vendors.
    const services = uniq(
      (await frame.locator("h1,h2,h3,h4,button,a,[role=button],.service,.product").allInnerTexts().catch(() => []))
        .map((t) => t.replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 3 && t.length < 60 && !/^\s*(home|faq|gifts|contact|privacy|menu)\s*$/i.test(t)),
    ).slice(0, 10);

    const choose = frame.locator("button,a,[role=button]").filter({ hasText: /book|select|choose|continue|next/i }).first();
    if (await choose.count()) {
      await choose.click({ timeout: 8000 }).catch(() => note.push("service click refused"));
      await settle(page, 9000);
    }

    const text = await allText(page);
    if (opts.shot) await page.screenshot({ path: opts.shot });
    return {
      url: page.url(),
      vendor: [...vendors][0] || null,
      services,
      prices: uniq(text.match(MONEY) || []).slice(0, 8),
      times: uniq(text.match(CLOCK) || []).slice(0, 12),
      dates: uniq(text.match(DATEISH) || []).slice(0, 8),
      note: note.join("; "),
    };
  } finally {
    await browser.close();
  }
}

const argv = process.argv.slice(2);
const domain = argv.find((a) => a.startsWith("--domain="))?.split("=")[1];
const shot = argv.find((a) => a.startsWith("--shot="))?.split("=")[1];
let target = argv.find((a) => !a.startsWith("--"));
if (!target && domain) {
  const row = db
    .prepare("SELECT fact_value FROM facts f JOIN operators o ON o.id = f.operator_id WHERE o.domain = ? AND f.fact_key = 'booking_url' LIMIT 1")
    .get(domain) as { fact_value: string } | undefined;
  target = row?.fact_value;
  if (!target) {
    console.error("no booking link stored for " + domain);
    process.exit(1);
  }
}
if (!target) {
  console.error("usage: book-agent.mts <booking url> | --domain=<operator domain>");
  process.exit(1);
}
const r = await readBooking(target, { shot });
console.log(`\n${r.url}`);
console.log(`  vendor  : ${r.vendor || "their own form"}`);
console.log(`  services: ${r.services.slice(0, 5).join(" | ") || "-"}`);
console.log(`  prices  : ${r.prices.join("  ") || "-"}`);
console.log(`  dates   : ${r.dates.join("  ") || "-"}`);
console.log(`  times   : ${r.times.join("  ") || "-"}`);
if (r.note) console.log(`  note    : ${r.note}`);
process.exit(0);
