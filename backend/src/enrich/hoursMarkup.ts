/**
 * Deterministic opening-hours harvester. Reads JSON-LD openingHoursSpecification / openingHours,
 * microdata itemprop="openingHours", and "Hours:" style text on a page, and emits normalized lines
 * ("Mon-Fri 9:00 AM - 5:00 PM", "Sat 10:00 AM - 4:00 PM", "Sun Closed") that src/sync/hours.ts encodeWeek parses.
 */
import { load } from "cheerio";
import { DAY_RE, TIME_RE } from "../sync/hours.ts";

type Slot = [number, number] | "closed";
type Week = (Slot | undefined)[]; // index 0 = Sunday

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INDEX: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
const DAY_TOKEN = String.raw`(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?`;
const DAY_EXPR = String.raw`(?:daily|every ?day|7 days(?: a week)?|weekends?|weekdays?|${DAY_TOKEN}(?:\s*(?:-|–|—|to|through|thru|&|and|\/|,)\s*${DAY_TOKEN})*)`;
const TIME_SRC = TIME_RE.source;
// Day expression, optional separator, then a time range or "closed".
const ENTRY_RE = new RegExp(String.raw`\b(${DAY_EXPR})\s*[:\-–—]?\s*(?:(${TIME_SRC})|(closed))`, "gi");
// "9am-5pm Mon-Fri" and "9am - 5pm daily".
const ENTRY_TIME_FIRST_RE = new RegExp(String.raw`(${TIME_SRC})\s*[,;]?\s*(?:on\s+)?\b(${DAY_EXPR})\b`, "gi");
const ANCHOR_RE = /\b(opening hours|business hours|hours of operation|store hours|our hours|hours|open|we'?re open|we are open)\b/gi;
// Ranges encodeWeek's DAY_RE understands. Anything else is written one day per line.
const KNOWN_RANGES = new Set(["Mon-Fri", "Mon-Sat", "Mon-Sun", "Tue-Sun", "Wed-Sun", "Thu-Sun", "Fri-Sun", "Sat-Sun"]);

function parseDays(expr: string): number[] | null {
  const s = expr.trim();
  for (const [re, days] of DAY_RE) {
    const m = re.exec(s);
    if (m && m[0].length >= s.length - 2) return days; // whole expression matched a known phrase
  }
  const tokens = s.toLowerCase().match(/(sun|mon|tue|wed|thu|fri|sat)[a-z]*|-|–|—|\bto\b|\bthrough\b|\bthru\b|&|\band\b|\/|,/g);
  if (!tokens) return null;
  const out = new Set<number>();
  let prev: number | null = null;
  let range = false;
  for (const t of tokens) {
    const d = DAY_INDEX[t.slice(0, 2)];
    if (d === undefined) {
      if (/^(-|–|—|to|through|thru)$/.test(t)) range = prev !== null;
      continue;
    }
    if (range && prev !== null) {
      let i = prev;
      for (let n = 0; n < 7; n++) {
        i = (i + 1) % 7;
        out.add(i);
        if (i === d) break;
      }
      range = false;
    } else out.add(d);
    prev = d;
  }
  return out.size ? [...out] : null;
}

function toMins(h: number, m: number, ap: string | undefined): number {
  let hh = h;
  const a = (ap || "").replace(/\./g, "").toLowerCase();
  if (a === "pm" && hh < 12) hh += 12;
  if (a === "am" && hh === 12) hh = 0;
  return hh * 60 + m;
}

/** Parses a "9am-5pm" style range (via TIME_RE) into minutes, inferring am/pm when one side omits it. */
function parseRange(text: string): [number, number] | null {
  const t = TIME_RE.exec(text);
  if (!t) return null;
  let open = toMins(Number(t[1]), Number(t[2] || 0), t[3]);
  let close = toMins(Number(t[4]), Number(t[5] || 0), t[6]);
  if (!t[3] && t[6] && open > close && open >= 12 * 60 && Number(t[1]) < 12) open -= 12 * 60; // "10-5pm": 10 is am
  if (!t[6] && !t[3]) {
    if (close <= open) close += 12 * 60;
  } else if (!t[6] && close <= open) close += 12 * 60;
  if (close <= open) close += 24 * 60;
  if (close - open < 30 || close - open > 24 * 60) return null;
  return [open, close];
}

/** "09:00", "09:00:00", "9:00 AM", "17:00" from JSON-LD or microdata to minutes. */
function parseClock(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2] || 0);
  if (h > 24 || mm > 59) return null;
  return toMins(h === 24 ? 0 : h, mm, m[3]);
}

function setDays(week: Week, days: number[], slot: Slot, overwrite = false) {
  for (const d of days) if (overwrite || week[d] === undefined) week[d] = slot;
}

function fmt(m: number): string {
  const total = m % (24 * 60);
  const h24 = Math.floor(total / 60);
  const mm = total % 60;
  const ap = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
}

function slotText(s: Slot): string {
  return s === "closed" ? "Closed" : `${fmt(s[0])} - ${fmt(s[1])}`;
}

function sameSlot(a: Slot | undefined, b: Slot | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a === "closed" || b === "closed") return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/** Week to lines, Monday first, consecutive equal days collapsed only into ranges encodeWeek can read. */
function weekToLines(week: Week): string[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const lines: string[] = [];
  let i = 0;
  while (i < order.length) {
    const slot = week[order[i]];
    if (slot === undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < order.length && sameSlot(week[order[j + 1]], slot)) j++;
    const label = j > i ? `${DAY_NAMES[order[i]]}-${DAY_NAMES[order[j]]}` : DAY_NAMES[order[i]];
    if (j === i || KNOWN_RANGES.has(label)) lines.push(`${label} ${slotText(slot)}`);
    else for (let k = i; k <= j; k++) lines.push(`${DAY_NAMES[order[k]]} ${slotText(slot)}`);
    i = j + 1;
  }
  return lines;
}

function hasTimes(week: Week): boolean {
  return week.some((s) => s !== undefined && s !== "closed");
}

/* ---------- schema.org strings: "Mo-Fr 09:00-17:00", "Mo,We,Fr 10:00-16:00", "Sa-Su" ---------- */

const SCHEMA_DAY = /\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g;
const SCHEMA_STR_RE = /\b((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s*(\d{1,2}:\d{2})?\s*-?\s*(\d{1,2}:\d{2})?/;

function schemaDays(expr: string): number[] {
  const out = new Set<number>();
  const parts = expr.split(",");
  for (const p of parts) {
    const ds = p.match(SCHEMA_DAY) || [];
    if (ds.length === 2 && /-/.test(p)) {
      let i = DAY_INDEX[ds[0].toLowerCase()];
      const end = DAY_INDEX[ds[1].toLowerCase()];
      out.add(i);
      for (let n = 0; n < 7 && i !== end; n++) {
        i = (i + 1) % 7;
        out.add(i);
      }
    } else for (const d of ds) out.add(DAY_INDEX[d.toLowerCase()]);
  }
  return [...out];
}

function applyOpeningHoursString(week: Week, raw: string) {
  const s = raw.replace(/\s+/g, " ").trim();
  const m = SCHEMA_STR_RE.exec(s);
  if (m && /^(Mo|Tu|We|Th|Fr|Sa|Su)\b/.test(s)) {
    const days = schemaDays(m[1]);
    if (!days.length) return;
    if (m[2] && m[3]) {
      const open = parseClock(m[2]);
      let close = parseClock(m[3]);
      if (open === null || close === null) return;
      if (open === 0 && close === 0) return setDays(week, days, "closed");
      if (close <= open) close += 24 * 60;
      if (close - open >= 30) setDays(week, days, [open, close]);
    } else if (/closed/i.test(s)) setDays(week, days, "closed");
    else setDays(week, days, [0, 24 * 60]); // "Mo-Su" alone means open all day
    return;
  }
  // Free-text variant ("Monday 9am-5pm", "Mon-Fri: 9:00 AM - 5:00 PM").
  applyText(week, s, true);
}

function applyText(week: Week, text: string, overwrite: boolean) {
  ENTRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = ENTRY_RE.exec(text))) {
    const days = parseDays(m[1]);
    if (!days) continue;
    if (m[2]) {
      const r = parseRange(m[2]);
      if (r) {
        setDays(week, days, r, overwrite);
        found = true;
      }
    } else if (m[3]) {
      setDays(week, days, "closed", overwrite);
      found = true;
    }
  }
  if (found) return;
  ENTRY_TIME_FIRST_RE.lastIndex = 0;
  while ((m = ENTRY_TIME_FIRST_RE.exec(text))) {
    const days = parseDays(m[2]);
    const r = parseRange(m[1]);
    if (days && r) setDays(week, days, r, overwrite);
  }
}

/* ---------- JSON-LD ---------- */

function specDays(v: unknown): number[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const out: number[] = [];
  for (const item of list) {
    const name = typeof item === "string" ? item : item && typeof item === "object" ? String((item as { name?: string; "@id"?: string }).name || (item as { "@id"?: string })["@id"] || "") : "";
    const key = name.replace(/^.*\//, "").toLowerCase().slice(0, 2);
    if (key === "pu") out.push(...[0, 1, 2, 3, 4, 5, 6]); // PublicHolidays: ignore
    else if (DAY_INDEX[key] !== undefined) out.push(DAY_INDEX[key]);
  }
  return out;
}

function applySpecs(week: Week, specs: unknown) {
  const list = Array.isArray(specs) ? specs : [specs];
  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    const o = s as { dayOfWeek?: unknown; opens?: unknown; closes?: unknown; validFrom?: unknown; validThrough?: unknown };
    if (o.validThrough && typeof o.validThrough === "string" && /^\d{4}-\d{2}-\d{2}/.test(o.validThrough)) {
      if (new Date(o.validThrough).getTime() < Date.now() - 86400000) continue; // expired seasonal spec
    }
    const days = specDays(o.dayOfWeek);
    if (!days.length) continue;
    const open = parseClock(o.opens);
    let close = parseClock(o.closes);
    if (open === null || close === null) {
      if (o.opens === undefined && o.closes === undefined) setDays(week, days, "closed");
      continue;
    }
    if (open === 0 && close === 0) {
      setDays(week, days, "closed");
      continue;
    }
    if (close <= open) close += 24 * 60;
    if (close - open >= 30 && close - open <= 24 * 60) setDays(week, days, [open, close]);
  }
}

function walkJsonLd(node: unknown, week: Week, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return;
  if (Array.isArray(node)) {
    for (const n of node) walkJsonLd(n, week, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  if (o.openingHoursSpecification) applySpecs(week, o.openingHoursSpecification);
  if (o.openingHours) {
    const list = Array.isArray(o.openingHours) ? o.openingHours : [o.openingHours];
    for (const s of list) if (typeof s === "string") applyOpeningHoursString(week, s);
  }
  for (const k of Object.keys(o)) {
    if (k === "openingHoursSpecification" || k === "openingHours") continue;
    const v = o[k];
    if (v && typeof v === "object") walkJsonLd(v, week, depth + 1);
  }
}

function jsonLdBlocks($: ReturnType<typeof load>): unknown[] {
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites emit several objects separated by commas or trailing commas; try wrapping.
      try {
        out.push(JSON.parse(`[${raw.replace(/,\s*$/, "")}]`));
      } catch {
        /* skip */
      }
    }
  });
  return out;
}

/* ---------- visible text ---------- */

function visibleText($: ReturnType<typeof load>): string {
  $("script, style, noscript, svg, template").remove();
  $("br").replaceWith("\n");
  $("p, div, li, tr, td, th, h1, h2, h3, h4, h5, h6, dt, dd, section, article, header, footer, table").each((_, el) => {
    $(el).append("\n");
  });
  return $("body").text().replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function textHours(text: string): Week {
  const week: Week = [];
  const flat = text.replace(/\n/g, " · ");
  ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = ANCHOR_RE.exec(flat)) && scanned < 40) {
    scanned++;
    const window = flat.slice(m.index, m.index + 700);
    const w: Week = [];
    applyText(w, window, false);
    if (hasTimes(w)) {
      for (let d = 0; d < 7; d++) if (week[d] === undefined && w[d] !== undefined) week[d] = w[d];
    }
    if (week.filter((x) => x !== undefined).length === 7) break;
  }
  return week;
}

/**
 * Returns normalized hour lines for a page, or [] when nothing trustworthy was found.
 * Order of trust: JSON-LD, then microdata, then "Hours" text.
 */
export function harvestHours(html: string): string[] {
  if (!html || html.length < 50) return [];
  const $ = load(html);

  const week: Week = [];
  for (const block of jsonLdBlocks($)) walkJsonLd(block, week);
  if (hasTimes(week)) return weekToLines(week);

  const micro: Week = [];
  $('[itemprop="openingHours"]').each((_, el) => {
    const v = ($(el).attr("content") || $(el).attr("datetime") || $(el).text() || "").trim();
    if (v) applyOpeningHoursString(micro, v);
  });
  if (hasTimes(micro)) return weekToLines(micro);

  const text = visibleText($);
  const fromText = textHours(text);
  if (hasTimes(fromText)) return weekToLines(fromText);
  return [];
}
