import { chromium, type Browser, type Frame, type Page, type Route } from "playwright";
import type { Departure, LiveRead } from "./live.ts";
import { isConcessionFare } from "../lib/fares.ts";
import { vendorOf } from "./vendors.ts";

/**
 * Reading a shop's availability by driving its own booking widget.
 *
 * This exists because of a measurement. Within sixty kilometres of Waterloo there are fifty booking links
 * and forty-nine of them are the shop's own page; near Toronto it is 198 of 220. A reader per vendor cannot
 * reach them — Peek is one business in Toronto and none in Waterloo — and recording the widget's own network
 * call does not work either: driving adventurerooms.ca fires seventy-two requests after a date is clicked and
 * not one carries a date, because the call lives inside the widget's own frame and session.
 *
 * So stop trying to intercept the data. Whatever a booking widget does internally, it has to **show** a human
 * which times are free, on screen, in text. That is the one thing every one of them has in common, and it is
 * the thing to read.
 *
 * ## How it decides it is looking at a calendar
 *
 * Text that looks like times is not enough: opening hours, a phone number and a price list all survive a
 * regex. The proof is the same one the endpoint sniffer uses, applied to the page instead: **pick one date,
 * read the times, pick another date, read them again.** A real calendar answers differently. A footer that
 * says "Open 9:00 - 17:00" does not. Nothing is reported unless the page moved.
 *
 * ## What it will not do
 *
 * It does not book, it does not fill in a name, it never submits a form, and it does not touch payment. It
 * opens a public page, clicks a date the way a visitor would, and reads what is printed. Prices are only
 * attached to a time when they sit in the same row of the rendered page; a price found elsewhere is reported
 * as the shop's range and never as the cost of a slot.
 *
 * ## Where it runs
 *
 * A browser per shop is expensive: ten to twenty seconds and a Chromium process. It is not on the path of a
 * guest's first answer. `plan.ts` replies immediately from what it can read cheaply and dispatches this for
 * the few shops worth asking, streaming each one in as it lands.
 *
 * **Headless, always.** It must never open a window on anybody's screen.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A clock value a shop would sell a slot at: inside trading hours, on a neat five minutes. */
function slotTimes(text: string): string[] {
  const out = new Set<string>();
  const add = (h: number, m: number) => {
    if (h < 7 || h > 23 || m % 5 !== 0) return;
    out.add(String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"));
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

/**
 * Times paired with the price printed beside them.
 *
 * Read row by row rather than from the page's whole text, because "7:00 PM" and "$44" being on the same
 * screen says nothing and being in the same row says a great deal. A row with two times in it is a range
 * ("6:00 PM - 7:45 PM") and its opening time is the one that is bookable.
 */
type Row = { time: string; price: number | null; label: string | null };

async function readRows(scope: Page | Frame): Promise<Row[]> {
  return scope
    .evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const st = getComputedStyle(el as HTMLElement);
        return st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity || "1") > 0.05;
      };
      const out: { text: string; disabled: boolean }[] = [];
      // Anything a person could click, plus list rows and cells, which is where these widgets put their slots.
      const sel = "button,a,li,td,tr,[role=button],[role=option],[class*=slot],[class*=time],[class*=session],[class*=availab]";
      for (const el of Array.from(document.querySelectorAll(sel)).slice(0, 4000)) {
        if (!isVisible(el)) continue;
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!t || t.length > 160) continue;
        const cls = (el.getAttribute("class") || "") + " " + (el.getAttribute("aria-disabled") || "");
        const disabled =
          (el as HTMLButtonElement).disabled === true ||
          /\b(disabled|sold ?out|unavailable|full|past|inactive)\b/i.test(cls + " " + t);
        out.push({ text: t, disabled });
      }
      return out;
    })
    .then((cells) => {
      const rows: Row[] = [];
      for (const c of cells) {
        if (c.disabled) continue;
        const times = slotTimes(c.text);
        if (!times.length) continue;
        // A row with a range in it is one bookable slot, starting at the earlier time.
        const time = times[0];
        const priceM = c.text.match(/\$\s?(\d{1,4}(?:\.\d{2})?)/);
        const price = priceM ? Number(priceM[1]) : null;
        const label = c.text.replace(/\$\s?\d[\d.,]*/g, "").replace(/\b\d{1,2}[:.]\d{2}\s*[ap]?\.?m?\.?/gi, "").replace(/[-–|·]+/g, " ").replace(/\s+/g, " ").trim();
        rows.push({
          time,
          price: price != null && price >= 5 && price <= 2000 && !isConcessionFare(label) ? price : null,
          label: label.length > 2 && label.length < 60 ? label : null,
        });
      }
      return rows;
    })
    .catch(() => [] as Row[]);
}

/** Every frame worth looking in: the page itself, plus any iframe big enough to be a widget. */
async function scopes(page: Page): Promise<(Page | Frame)[]> {
  const out: (Page | Frame)[] = [page];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const u = f.url();
      if (/google|facebook|youtube|doubleclick|recaptcha|tidio|tawk|hotjar/i.test(u)) continue;
      out.push(f);
    } catch {
      /* a frame that detached while we looked */
    }
  }
  return out;
}

/**
 * Click the cell for a given day, wherever the calendar is.
 *
 * Widgets render a date a dozen ways, so this tries the explicit ones first — a `data-date`, an aria-label
 * carrying the written date — and falls back to the bare day number inside something that looks like a
 * calendar and is not marked unavailable. Returns whether anything was actually clicked, because a date that
 * could not be chosen means the read that follows proves nothing.
 */
async function pickDate(page: Page, day: Date): Promise<boolean> {
  const iso = ymd(day);
  const n = String(day.getDate());
  const longName = day.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const shortName = day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const selectors = [
    `[data-date="${iso}"]`,
    `[data-day="${iso}"]`,
    `[data-value="${iso}"]`,
    /**
     * jQuery UI's datepicker, which is under Checkfront and a good share of the rest of the web, puts the
     * bare day number in `data-date` rather than a date: `<a data-date="22">22</a>`. Looking only for an ISO
     * string matched none of Adventure Rooms' sixty-one cells.
     */
    `a[data-date="${n}"]:not(.ui-state-disabled)`,
    `[data-date="${n}"]`,
    `[data-handler="selectDay"] :text-is("${n}")`,
    `.ui-datepicker-calendar a:text-is("${n}")`,
    `[aria-label*="${longName}"]`,
    `[aria-label*="${shortName}"]`,
    `td[class*="day"]:not([class*="disabled"]):not([class*="off"]):not([class*="unavail"]) :text-is("${n}")`,
    `[class*="calendar"] [class*="day"]:not([class*="disabled"]):not([class*="unavail"]) :text-is("${n}")`,
    `[class*="datepicker"] :text-is("${n}")`,
  ];
  for (const scope of await scopes(page)) {
    for (const sel of selectors) {
      try {
        const el = (scope as Page).locator(sel).first();
        if (!(await el.count().catch(() => 0))) continue;
        await el.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
        await el.click({ timeout: 2500 });
        await page.waitForTimeout(3000);
        return true;
      } catch {
        /* not clickable; next shape */
      }
    }
  }
  return false;
}

/**
 * Make the page load the thing we came for.
 *
 * Booking widgets sit below the fold and are nearly always lazy-loaded — WP Rocket, Elementor and every
 * Shopify theme do it — so the iframe stays `about:blank` until a human scrolls to it. A headless visit that
 * never scrolls sees two empty frames and concludes the shop publishes nothing, which is how Adventure Rooms,
 * KW Escape, Bad Axe and Riot Axe all reported "no times" while all four were selling online.
 */
async function wakeWidget(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.body.scrollHeight && y < 12000; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 220));
    }
    window.scrollTo(0, 0);
  }).catch(() => {});
  // Give the frames that just began loading a chance to become real documents.
  await page.waitForTimeout(2500);
  for (const f of page.frames()) {
    if (f.url() === "about:blank") await f.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);
}

/**
 * Choose something to book, because a calendar usually will not appear until you have.
 *
 * Nearly every booking flow is three steps: what, then when, then which time. Skipping to the date is why
 * this found nothing on four shops that were all selling online — Adventure Rooms' page says "Make your
 * Escape Room Bookings here" above a list of rooms, and the calendar iframe stays `about:blank` until one is
 * picked. The cheapest room is as good as any: we are reading the shop's calendar, not choosing for the guest.
 */
async function pickSomethingToBook(page: Page): Promise<boolean> {
  const candidates = [
    "[class*='product'] a", "[class*='item'] a[href*='book']", "[class*='room'] a",
    "[class*='experience'] a", "[class*='tour'] a", "a[href*='/book']", "a[href*='booking']",
    "[class*='card'] a", "button:has-text('Select')", "button:has-text('Choose')",
  ];
  for (const scope of await scopes(page)) {
    for (const sel of candidates) {
      try {
        const el = (scope as Page).locator(sel).first();
        if (!(await el.count().catch(() => 0))) continue;
        const txt = ((await el.innerText().catch(() => "")) || "").toLowerCase();
        // Not the gift shop, not the waiver, not the directions.
        if (/gift|voucher|waiver|contact|direction|about|faq|privacy|terms/.test(txt)) continue;
        await el.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
        await el.click({ timeout: 3000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(3000);
        return true;
      } catch {
        /* not this one */
      }
    }
  }
  return false;
}

/** Open whatever hides the booking widget behind a button. */
async function openWidget(page: Page): Promise<void> {
  const triggers = [
    "text=/^\\s*book now\\s*$/i",
    "text=/^\\s*book\\s*$/i",
    "text=/check availability/i",
    "text=/book (?:now|online|a )/i",
    "text=/reserve/i",
    "text=/get tickets/i",
    "button:has-text('Book')",
  ];
  for (const sel of triggers) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.count().catch(() => 0))) continue;
      await el.click({ timeout: 2500 });
      await page.waitForTimeout(3000);
      return;
    } catch {
      /* not this one */
    }
  }
}

export type AgentOptions = {
  browser?: Browser;
  /** The day the guest asked about. */
  date?: Date;
  /** How long to spend in total before giving up on this shop. */
  budgetMs?: number;
};

/**
 * Drive one shop's booking page and report what it is really selling on a given day.
 *
 * Returns an empty read rather than null when the page answered and had nothing: "they publish no times for
 * Saturday" is information. Returns null only when the page could not be opened at all.
 */
export async function agentLive(bookingUrl: string, opts: AgentOptions = {}): Promise<LiveRead | null> {
  const own = !opts.browser;
  // Headless without exception.
  const browser = opts.browser ?? (await chromium.launch({ headless: true }));
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const deadline = Date.now() + (opts.budgetMs ?? 25000);
  const host = (() => {
    try {
      return new URL(bookingUrl).hostname.replace(/^www\./, "");
    } catch {
      return bookingUrl;
    }
  })();

  // Images and fonts are most of the bytes and none of the answer.
  await page.route("**/*", (route: Route) => {
    const t = route.request().resourceType();
    return t === "image" || t === "font" || t === "media" ? route.abort() : route.continue();
  });

  let note: string | null = null;
  const out: Departure[] = [];
  try {
    /**
     * Drive the vendor's own hosted page, not the shop's embed of it.
     *
     * This is the difference between nothing and everything, and it took four shops and an hour to see. The
     * embed on adventurerooms.ca is an iframe that never loads without the right interaction and whose
     * calendar request lives in its own session. Their Checkfront hosted page, rebuilt from the account id
     * already sitting in that embed, answers with sixty-one date cells and a calendar. One is a booking
     * widget wrapped in somebody's WordPress theme; the other is the booking engine.
     *
     * `vendors.ts` has done this all along — sixteen vendors, how to read the account out of the embed and
     * how to rebuild the hosted URL from it. Nothing was using it here.
     */
    const v = await vendorOf(bookingUrl).catch(() => null);
    const target = v?.hostedUrl ?? bookingUrl;
    if (v?.hostedUrl) note = null;
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: Math.max(8000, deadline - Date.now()) });
    await page.waitForTimeout(2000);
    await wakeWidget(page);
    await openWidget(page);

    const wanted = opts.date ?? new Date();
    /**
     * Two days, and the second only to prove the first. If the same times come back for a day a fortnight
     * apart, the page is showing opening hours or a static list and we have learned nothing about
     * availability. This is the whole honesty gate.
     */
    const control = new Date(wanted.getTime() + 14 * 86400_000);

    const readFor = async (d: Date): Promise<Row[]> => {
      let clicked = await pickDate(page, d);
      if (!clicked) {
        // The widget may only have appeared after the trigger was clicked; wake it and look once more.
        await wakeWidget(page);
        clicked = await pickDate(page, d);
      }
      if (!clicked) {
        // Still no calendar: this flow wants a room or a tour chosen before it will show one.
        if (await pickSomethingToBook(page)) {
          await wakeWidget(page);
          await openWidget(page);
          clicked = await pickDate(page, d);
        }
      }
      if (!clicked) return [];
      const rows: Row[] = [];
      for (const scope of await scopes(page)) rows.push(...(await readRows(scope)));
      return rows;
    };

    const wantedRows = await readFor(wanted);
    if (!wantedRows.length) {
      note = "Their booking page did not show any times for that day.";
    } else if (Date.now() < deadline) {
      const controlRows = await readFor(control);
      const key = (r: Row[]) => [...new Set(r.map((x) => x.time))].sort().join(",");
      if (controlRows.length && key(controlRows) === key(wantedRows)) {
        note = "That page shows the same times whatever date is chosen, so it is not a live calendar.";
      } else {
        /** One departure per time, cheapest variant, which is the rule the rest of the reader follows. */
        const byTime = new Map<string, Row>();
        for (const r of wantedRows) {
          const seen = byTime.get(r.time);
          if (!seen || (r.price != null && (seen.price == null || r.price < seen.price))) byTime.set(r.time, r);
        }
        const date = ymd(wanted);
        const nowMin = date === ymd(new Date()) ? new Date().getHours() * 60 + new Date().getMinutes() : -1;
        for (const r of [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time))) {
          const mins = Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3));
          if (mins <= nowMin) continue;
          out.push({
            item: r.label || "Booking",
            date,
            time: r.time,
            fromPrice: r.price,
            priceLabel: r.price != null ? "on their booking page" : null,
            /** Unknown, so assumed excluded: under-quoting is the failure that matters. */
            taxIncluded: false,
            rates: r.price != null ? [{ label: r.label || "Ticket", price: r.price, minParty: null, maxParty: null }] : [],
            bookUrl: v?.hostedUrl ?? bookingUrl,
            seatsLeft: null,
          });
          if (out.length >= 8) break;
        }
      }
    }
  } catch (e) {
    note = (e as Error).message.slice(0, 120);
  } finally {
    await ctx.close().catch(() => {});
    if (own) await browser.close().catch(() => {});
  }

  return { business: host, vendor: "agent", departures: out, note: out.length ? null : note ?? "Nothing published for that day." };
}
