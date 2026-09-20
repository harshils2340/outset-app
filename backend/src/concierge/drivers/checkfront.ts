import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import type { Departure, LiveRead } from "../live.ts";
import { isConcessionFare } from "../../lib/fares.ts";

/**
 * Checkfront, driven the way a visitor drives it.
 *
 * The first of the per-vendor drivers, and the one that settled the argument about whether they are worth
 * writing. A generic agent guessing selectors found nothing on four shops in fifty seconds each; this finds
 * real times in a few, because it knows three things a guess cannot:
 *
 * 1. **Drive the hosted page, never the embed.** `adventurerooms.ca/booknow/` is an iframe that stays
 *    `about:blank` and whose calendar request lives in its own session. `adventureroomscanada.checkfront.com`
 *    is the same booking engine with nothing in the way. `vendors.ts` rebuilds that URL from the account id
 *    sitting in the embed.
 * 2. **A category comes before a calendar.** The hosted page opens on category cards with a "See Listings"
 *    button (`a.set_category_id`), and no date picker exists until one is chosen. This is what the generic
 *    agent could not work out.
 * 3. **jQuery UI puts the day number in `data-date`.** Not a date: `<a data-date="22">22</a>`. A selector
 *    looking for `2026-09-22` matches none of the sixty-one cells on the page.
 *
 * The shape here is the template for the others. A driver knows its vendor's three or four steps and nothing
 * about any particular shop, so one of these serves every business on that vendor.
 *
 * It reads. It does not book, fill in a name, or submit anything.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function checkfrontAccount(url: string): string | null {
  return url.match(/https?:\/\/([a-z0-9-]+)\.checkfront\.com/i)?.[1]?.toLowerCase() ?? null;
}

/** Slot-shaped clock values: inside trading hours, on a neat five minutes. */
function timesIn(text: string): string[] {
  const out = new Set<string>();
  const add = (h: number, m: number) => {
    if (h >= 7 && h <= 23 && m % 5 === 0) out.add(String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"));
  };
  for (const m of text.matchAll(/\b(1[0-2]|0?[1-9])[:.]([0-5]\d)\s*([ap])\.?\s?m\.?/gi)) {
    let h = Number(m[1]);
    if (/p/i.test(m[3]) && h < 12) h += 12;
    if (/a/i.test(m[3]) && h === 12) h = 0;
    add(h, Number(m[2]));
  }
  for (const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]\.?m)/gi)) add(Number(m[1]), Number(m[2]));
  return [...out].sort();
}

type Row = { time: string; price: number | null; label: string | null };

/** Everything on screen that carries a time, with whatever price and name sit in the same row. */
async function rowsOn(page: Page): Promise<Row[]> {
  const cells = await page
    .evaluate(() => {
      const vis = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 2 && r.height > 2 && getComputedStyle(el as HTMLElement).display !== "none";
      };
      const sel = "[class*=cf-],[class*=item],[class*=slot],[class*=session],[class*=avail],li,tr,button,a";
      const out: { text: string; off: boolean }[] = [];
      for (const el of Array.from(document.querySelectorAll(sel)).slice(0, 3000)) {
        if (!vis(el)) continue;
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 150) continue;
        const cls = el.getAttribute("class") || "";
        out.push({ text, off: /\b(sold ?out|unavailable|disabled|full|closed)\b/i.test(cls + " " + text) });
      }
      return out;
    })
    .catch(() => [] as { text: string; off: boolean }[]);

  const rows: Row[] = [];
  for (const c of cells) {
    if (c.off) continue;
    const ts = timesIn(c.text);
    if (!ts.length) continue;
    const pm = c.text.match(/\$\s?(\d{1,4}(?:\.\d{2})?)/);
    const price = pm ? Number(pm[1]) : null;
    const label = c.text
      .replace(/\$\s?[\d.,]+/g, "")
      .replace(/\b\d{1,2}[:.]\d{2}\s*[ap]?\.?m?\.?/gi, "")
      .replace(/[-–|·]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    rows.push({
      // A row showing "6:00 PM - 7:45 PM" is one slot, and it starts at the first of them.
      time: ts[0],
      price: price != null && price >= 5 && price <= 2000 && !isConcessionFare(label) ? price : null,
      label: label.length > 2 && label.length < 60 ? label : null,
    });
  }
  return rows;
}

/** Click the cell for this day. jQuery UI writes the bare day number, so that is what is matched. */
async function pickDay(page: Page, day: Date): Promise<boolean> {
  const n = String(day.getDate());
  for (const sel of [
    `a[data-date="${n}"]:not(.ui-state-disabled)`,
    `.ui-datepicker-calendar a:text-is("${n}")`,
    `[data-handler="selectDay"] a:text-is("${n}")`,
    `td:not(.ui-datepicker-unselectable) a:text-is("${n}")`,
  ]) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.count().catch(() => 0))) continue;
      await el.click({ timeout: 3000 });
      await page.waitForTimeout(3500);
      return true;
    } catch {
      /* next shape */
    }
  }
  return false;
}

export async function checkfrontLive(
  hostedUrl: string,
  opts: { browser?: Browser; date?: Date; budgetMs?: number } = {},
): Promise<LiveRead | null> {
  const account = checkfrontAccount(hostedUrl);
  if (!account) return null;
  const own = !opts.browser;
  // Headless without exception.
  const browser = opts.browser ?? (await chromium.launch({ headless: true }));
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  const until = Date.now() + (opts.budgetMs ?? 35000);
  const want = opts.date ?? new Date();
  const out: Departure[] = [];
  let note: string | null = null;

  try {
    await page.goto(`https://${account}.checkfront.com/reserve/`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2500);

    /**
     * A category first. The hosted page opens on cards, each with a "See Listings" button, and there is no
     * date picker at all until one is chosen. Categories are tried in turn because the first may be a gift
     * voucher or a location with nothing on that day.
     */
    const cats = page.locator("a.set_category_id, .set_category_id");
    const nCats = Math.min(await cats.count().catch(() => 0), 4);
    const attempts = nCats > 0 ? nCats : 1;

    for (let c = 0; c < attempts && !out.length && Date.now() < until; c += 1) {
      if (nCats > 0) {
        try {
          await cats.nth(c).click({ timeout: 4000 });
          await page.waitForTimeout(3000);
        } catch {
          continue;
        }
      }

      if (!(await pickDay(page, want))) continue;
      const wantRows = await rowsOn(page);
      if (!wantRows.length) continue;

      /**
       * Prove it is a calendar before believing it. A page that shows the same times for a day a fortnight
       * away is showing opening hours or a fixed schedule, and reporting that as availability is the failure
       * this whole layer exists to avoid.
       */
      const control = new Date(want.getTime() + 14 * 86400_000);
      let proven = true;
      if (Date.now() < until && (await pickDay(page, control))) {
        const ctrlRows = await rowsOn(page);
        const key = (r: Row[]) => [...new Set(r.map((x) => x.time))].sort().join(",");
        if (ctrlRows.length && key(ctrlRows) === key(wantRows)) proven = false;
        // Put the calendar back on the day the guest asked about.
        await pickDay(page, want);
      }
      if (!proven) {
        note = "That page shows the same times whatever date is chosen, so it is not a live calendar.";
        continue;
      }

      const byTime = new Map<string, Row>();
      for (const r of wantRows) {
        const seen = byTime.get(r.time);
        if (!seen || (r.price != null && (seen.price == null || r.price < seen.price))) byTime.set(r.time, r);
      }
      const date = ymd(want);
      const nowMin = date === ymd(new Date()) ? new Date().getHours() * 60 + new Date().getMinutes() : -1;
      for (const r of [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time))) {
        if (Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3)) <= nowMin) continue;
        out.push({
          item: r.label || "Booking",
          date,
          time: r.time,
          fromPrice: r.price,
          priceLabel: r.price != null ? "on their booking page" : null,
          /** Unknown, so assumed excluded: under-quoting is the failure that matters. */
          taxIncluded: false,
          rates: r.price != null ? [{ label: r.label || "Ticket", price: r.price, minParty: null, maxParty: null }] : [],
          bookUrl: `https://${account}.checkfront.com/reserve/`,
          seatsLeft: null,
        });
        if (out.length >= 8) break;
      }
    }
  } catch (e) {
    note = (e as Error).message.slice(0, 120);
  } finally {
    await ctx.close().catch(() => {});
    if (own) await browser.close().catch(() => {});
  }

  return {
    business: account,
    vendor: "agent",
    departures: out,
    note: out.length ? null : (note ?? "Nothing bookable on their page for that day."),
  };
}
