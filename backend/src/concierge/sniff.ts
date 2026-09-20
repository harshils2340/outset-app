import { chromium, type Browser, type Route } from "playwright";

/**
 * Finding the availability endpoint behind a booking widget that has no API we know of.
 *
 * Sixteen vendors have readers, and between them they cover 1,458 of 11,046 booking links. The rest run
 * "their own thing" — a WordPress plugin, a Wix booking block, a hand-rolled React calendar — and the
 * instinct is that those are unreadable. They are not, and the reason is simple: a calendar that shows a
 * guest which times are free had to get that list from somewhere. There is always a request. It is just not
 * one we could guess from the URL.
 *
 * So we stop guessing and watch. Open the page in a headless browser, let the widget do whatever it does, and
 * record every request it makes whose answer looks like availability. Then throw the browser away and keep
 * the URL, because the second read of that shop is a plain fetch of an endpoint we now know — as cheap as
 * FareHarbor's, on a shop that never published an API.
 *
 * Discovery is slow and happens once per shop, on the Render worker. Reading is fast and happens while a
 * guest waits. That split is the whole idea.
 *
 * **Headless, always.** This runs on the founder's laptop during development and a visible Chrome window
 * stealing focus is not acceptable; it also renders identical pixels either way.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type Candidate = {
  /** The request the widget made. */
  url: string;
  method: string;
  /** A POST body, when the endpoint needs one to answer. */
  body: string | null;
  /** Content type as served, so a replay knows what it is parsing. */
  type: string;
  bytes: number;
  /** How much this looks like availability rather than analytics: higher is better. */
  score: number;
  /** Clock times found in the answer, as evidence that this is the right request. */
  times: string[];
  /** Prices found alongside them, when the same payload carries both. */
  prices: number[];
  why: string[];
};

export type SniffResult = {
  url: string;
  /** The best candidate, when one looked convincing. */
  best: Candidate | null;
  candidates: Candidate[];
  /** Times visible in the rendered page, whether or not a request was caught. */
  domTimes: string[];
  note: string | null;
};

/** Ad, analytics and asset traffic. Every page is full of it and none of it is availability. */
const NOISE = /google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|clarity\.ms|segment\.|sentry|intercom|cloudflareinsights|recaptcha|gstatic|fonts\.|youtube\.com|ytimg|vimeo|player\.|jquery|bootstrap|polyfill|gtm\.js|elfsight|trustpilot|yotpo|judge\.me|reviews?\.io|tawk\.to|crisp\.chat|zendesk|hubspot|mailchimp|klaviyo|parastorage|wixstatic|squarespace-cdn|shopifycdn|cdn\.jsdelivr|unpkg|\.(?:png|jpe?g|gif|svg|webp|woff2?|ttf|css|ico|mp4|webm)(?:\?|$)/i;

/** Words that mean "this request is about when something is free". */
const AVAIL_WORD = /avail|slot|time|calendar|schedul|session|booking|book|reserv|openings|inventory|events?|tickets?|dates?/i;

/**
 * Clock times in a payload, however it writes them. The strongest single signal: an analytics beacon does not
 * come back with a list of times, and an availability endpoint almost always does.
 */
function findTimes(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/g)) {
    out.add(String(Number(m[1])).padStart(2, "0") + ":" + m[2]);
  }
  for (const m of text.matchAll(/\b(1[0-2]|0?[1-9]):([0-5]\d)\s*([ap])\.?m\.?/gi)) {
    let h = Number(m[1]);
    if (/p/i.test(m[3]) && h < 12) h += 12;
    if (/a/i.test(m[3]) && h === 12) h = 0;
    out.add(String(h).padStart(2, "0") + ":" + m[2]);
  }
  return [...out].sort();
}

function findPrices(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?:\$|"price"\s*:\s*"?|"amount"\s*:\s*"?)(\d{1,4}(?:\.\d{2})?)/gi)) {
    const n = Number(m[1]);
    if (n >= 5 && n <= 2000) out.add(n);
  }
  return [...out].sort((a, b) => a - b).slice(0, 12);
}

function scoreOf(url: string, body: string, type: string): { score: number; why: string[]; times: string[]; prices: number[] } {
  const why: string[] = [];
  let score = 0;
  const times = findTimes(body);
  const prices = findPrices(body);

  if (/json/i.test(type)) { score += 2; why.push("json"); }
  if (AVAIL_WORD.test(url)) { score += 3; why.push("url says availability"); }
  /**
   * Several distinct times is the tell. One timestamp is a "created_at" on anything; six of them spread
   * across a day is a booking calendar and very little else.
   */
  /**
   * Times that look like a shop's day, not like timestamps.
   *
   * Any JSON carries clock-shaped noise — a `created_at`, a cache header, a duration. Granite Brewery's page
   * scored on "00:00 04:08 11:37 21:42 23:59", which is five timestamps and no calendar. A real booking
   * calendar falls inside trading hours and lands on neat minutes: on the hour, the half hour, or the sort of
   * five-minute stagger an escape room uses to keep rooms from colliding.
   */
  const slotish = times.filter((t) => {
    const [h, m] = t.split(":").map(Number);
    return h >= 7 && h <= 23 && m % 5 === 0;
  });
  if (slotish.length >= 3) { score += 4; why.push(slotish.length + " slot-shaped times"); }
  else if (slotish.length) { score += 1; why.push(slotish.length + " time"); }
  else if (times.length) why.push(times.length + " clock values, none slot-shaped");
  if (prices.length) { score += 2; why.push(prices.length + " prices"); }
  // A date parameter means the caller asked about a particular day, which is what a calendar does.
  if (/\b(date|day|start|from|month)=/i.test(url)) { score += 2; why.push("takes a date"); }
  if (/\bavailab/i.test(body)) { score += 2; why.push("body says available"); }
  /**
   * Reviews, chat and asset widgets are on nearly every page and several of them talk about times and money.
   * Elfsight's review feed scored an 8 for a helicopter operator on the strength of timestamps in customer
   * reviews. A payload that is mostly about ratings or reviews is not a calendar, whatever else is in it.
   */
  if (/"(?:rating|review|reviewer|testimonial)"/i.test(body) && !/\b(?:availab|timeslot|time_slot|booking)/i.test(body)) {
    score -= 6;
    why.push("reads like reviews, not availability");
  }
  if (body.length > 400) score += 1;
  /**
   * A minified library is not a booking calendar. YouTube's player bundle scored on "10:00 17:15" and two
   * dollar figures lifted out of its own source, which is exactly the shape of a false positive: a very large
   * script, on somebody else's domain, with a couple of clock-ish strings in it. Size and the absence of any
   * availability word are enough to tell them apart.
   */
  if (/javascript/i.test(type) && body.length > 50000 && !/\bavailab/i.test(body)) { score -= 6; why.push("looks like a library"); }
  return { score, why, times: slotish.length ? slotish : times, prices };
}

/**
 * Does this endpoint actually know what day it is?
 *
 * The strongest signal that a request is a calendar, and the one that cannot be faked by a payload that
 * merely contains clock values: ask it about two different days and see whether the answer changes. Bad Axe
 * Throwing's `/wp-json/badaxe/v1/location/list/` scored eleven on thirty times and two prices and is a list
 * of branch opening hours, identical every day of the year. A reviews feed, a locations list and a price
 * sheet all look like availability until you move the date.
 *
 * This is what makes the endpoint safe to replay later without a browser. An endpoint that does not vary is
 * not availability, whatever else is in it — and one with no date in it at all cannot be asked about a
 * particular day, which is the only question the concierge has. Both are refused.
 */
export async function varsByDate(url: string, method: string, body: string | null): Promise<boolean | null> {
  const sub = (s: string, iso: string) =>
    s.replace(/\d{4}-\d{2}-\d{2}/g, iso).replace(/\d{4}\/\d{2}\/\d{2}/g, iso.replace(/-/g, "/"));
  const day = (n: number) => {
    const d = new Date(Date.now() + n * 86400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // No date anywhere in the request: it cannot be asked about a different day, so this proves nothing.
  if (!/\d{4}[-/]\d{2}[-/]\d{2}/.test(url + (body ?? ""))) return null;

  const get = async (iso: string): Promise<string | null> => {
    try {
      const res = await fetch(sub(url, iso), {
        method,
        headers: { "user-agent": UA, accept: "application/json, text/plain, */*" },
        body: body ? sub(body, iso) : undefined,
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return null;
      return (await res.text()).slice(0, 200000);
    } catch {
      return null;
    }
  };
  // Two days a fortnight apart, both in the future, so a shop closed on one weekday does not decide it.
  const [a, b] = await Promise.all([get(day(2)), get(day(16))]);
  if (a == null || b == null) return null;
  const times = (t: string) => [...new Set(findTimes(t))].sort().join(",");
  return a !== b || times(a) !== times(b);
}

/**
 * Open one booking page, let it load, and keep whatever it asked for.
 *
 * The page is also nudged: many widgets do not fetch anything until somebody clicks "Book". So after the
 * initial load we click the most booking-looking control we can find and wait again, which is the difference
 * between seeing nothing and seeing the calendar request.
 */
export async function sniffBookingPage(url: string, opts: { browser?: Browser; timeoutMs?: number } = {}): Promise<SniffResult> {
  const own = !opts.browser;
  // Headless without exception: this must never open a window on somebody's desk.
  const browser = opts.browser ?? (await chromium.launch({ headless: true }));
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const seen: Candidate[] = [];
  const budget = opts.timeoutMs ?? 30000;

  // Images and fonts are never availability and they are most of the bytes.
  await page.route("**/*", (route: Route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "font" || t === "media") return route.abort();
    return route.continue();
  });

  page.on("response", async (res) => {
    try {
      const req = res.request();
      const u = res.url();
      if (NOISE.test(u)) return;
      const type = res.headers()["content-type"] || "";
      if (!/json|javascript|text/i.test(type)) return;
      if (!res.ok()) return;
      const body = (await res.text()).slice(0, 200000);
      if (body.length < 40) return;
      const { score, why, times, prices } = scoreOf(u, body, type);
      if (score < 5) return;
      seen.push({ url: u, method: req.method(), body: req.postData() ?? null, type, bytes: body.length, score, times, prices, why });
    } catch {
      /* a response that went away mid-read is not worth failing over */
    }
  });

  let note: string | null = null;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: budget });
    await page.waitForTimeout(3500);

    /**
     * Nudge the widget. A booking calendar that only appears after a click is the common case, and without
     * this the sniff sees the marketing page and nothing else.
     */
    const triggers = [
      "text=/^\\s*book now\\s*$/i", "text=/^\\s*book\\s*$/i", "text=/book (?:now|online|a )/i",
      "text=/check availability/i", "text=/reserve/i", "text=/select a date/i", "text=/get tickets/i",
      "[href*='book']", "[class*='book']", "button:has-text('Book')",
    ];
    for (const sel of triggers) {
      const el = page.locator(sel).first();
      if (await el.count().catch(() => 0)) {
        await el.click({ timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(3000);
        if (seen.length) break;
      }
    }
    /**
     * Then pick a date, which is when the availability request actually fires.
     *
     * Opening the widget gets you the marketing page and a calendar with nothing chosen. The XHR that asks
     * "what is free" almost always waits for a day to be selected, so a sniff that only clicks "Book" sees
     * the shop's opening hours, its price list, its locations — everything except the thing it came for.
     * That is why Bad Axe's `/location/list/` won: it was the only request that had been made.
     *
     * A future date, never today, because plenty of shops grey out the current day after their cutoff and a
     * disabled cell fires nothing.
     */
    const target = new Date(Date.now() + 3 * 86400_000);
    const dayNum = String(target.getDate());
    const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
    const dateTargets = [
      `[data-date="${iso}"]`,
      `[data-day="${iso}"]`,
      `td[data-date*="${iso}"]`,
      `[aria-label*="${target.toLocaleDateString("en-US", { month: "long", day: "numeric" })}"]`,
      // A calendar cell is usually just the number, and usually not a disabled one.
      `td:not([class*="disabled"]):not([class*="unavailable"]) >> text="${dayNum}"`,
      `button:not([disabled]):not([class*="disabled"]) >> text="${dayNum}"`,
      `[class*="day"]:not([class*="disabled"]) >> text="${dayNum}"`,
    ];
    for (const frame of [page, ...page.frames().filter((f) => f !== page.mainFrame())]) {
      for (const sel of dateTargets) {
        try {
          const el = (frame as typeof page).locator(sel).first();
          if (!(await el.count().catch(() => 0))) continue;
          await el.click({ timeout: 2500 });
          await page.waitForTimeout(3500);
          break;
        } catch {
          /* not a clickable cell; try the next shape */
        }
      }
    }

    // Widgets often live in an iframe; its requests are captured the same way, but it needs time to boot.
    if (!seen.length && page.frames().length > 1) await page.waitForTimeout(3000);
  } catch (e) {
    note = (e as Error).message.slice(0, 160);
  }

  // What a person would actually see on the page, as a fallback and as a cross-check on the endpoint.
  let domTimes: string[] = [];
  try {
    // Playwright's own reader rather than a function evaluated in the page: this is a Node project, so the
    // browser's globals are not in its type library and `document` here does not compile.
    const text = await page.innerText("body", { timeout: 2000 });
    domTimes = findTimes(text);
  } catch {
    /* page already gone */
  }

  await ctx.close().catch(() => {});
  if (own) await browser.close().catch(() => {});

  seen.sort((a, b) => b.score - a.score || b.times.length - a.times.length);
  // One entry per endpoint: a calendar polled for six days is one discovery, not six.
  const byUrl = new Map<string, Candidate>();
  for (const c of seen) {
    const key = c.method + " " + c.url.split("?")[0];
    if (!byUrl.has(key)) byUrl.set(key, c);
  }
  const candidates = [...byUrl.values()];
  return {
    url,
    best: candidates[0] ?? null,
    candidates,
    domTimes,
    note: note ?? (candidates.length ? null : domTimes.length ? "No request caught, but the page itself shows times." : "Nothing that looks like availability."),
  };
}
