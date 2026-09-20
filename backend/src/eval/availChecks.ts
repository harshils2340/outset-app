import type { Availability, Slot } from "../enrich/availability.ts";
import type { AvailCase, CaseVendor } from "./availCases.ts";
import type { Exchange } from "../enrich/__tests__/fixtures/replay.ts";

/**
 * What has to be true of any answer the availability reader gives, whatever vendor it came from.
 *
 * These are the free half of the suite. None of them needs a model, a network call or a human, and between
 * them they catch the kinds of wrong that actually ship: a time drawn in the wrong timezone, a marker row
 * offered as a departure, a sold out slot still on sale, a price of zero presented as free, a date outside the
 * window the guest asked about. Every one of them is a mistake somebody could make again tomorrow, and several
 * are mistakes the comments in availability.ts record having already been made once.
 *
 * Each check says what it is, and why a guest would care. A check with no answer to "so what would the guest
 * see?" does not belong here: this file is not a style guide for the reader, it is a list of ways the product
 * lies to somebody trying to book a jet ski.
 */

export type Finding = {
  check: string;
  /** "error" is a wrong answer shown to a guest. "warn" is suspicious and worth a human look. */
  level: "error" | "warn";
  detail: string;
};

export type CheckContext = {
  kase: AvailCase;
  answer: Availability;
  exchanges: Exchange[];
};

type Check = {
  id: string;
  /** What a guest suffers when this fails. Printed in the report beside the count. */
  why: string;
  run: (c: CheckContext) => Finding[];
};

const TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/**
 * The reader keeps at most this many slots per day (`shape()` in availability.ts slices to it). A day that
 * comes back exactly full was very likely truncated, so nothing here may treat what is missing from it as a
 * departure the reader failed to find: Hamptiki runs a tiki boat every half hour and legitimately fills the
 * cap on ten days out of fourteen. Recall is only measurable on the days that came back under it.
 */
export const SLOT_CAP = 40;

/** Dates where the reader returned a full day, and so cannot be judged for what it left out. */
export function cappedDates(a: { days: { date: string; slots: unknown[] }[] }): Set<string> {
  return new Set(a.days.filter((d) => d.slots.length >= SLOT_CAP).map((d) => d.date));
}

const allSlots = (a: Availability): { day: string; slot: Slot }[] =>
  a.days.flatMap((d) => d.slots.map((slot) => ({ day: d.date, slot })));

/** The dates the window covers, derived the same way the reader derives them, from `from` and `days` alone. */
function windowDates(from: string, days: number): string[] {
  const start = new Date(from + "T00:00:00Z");
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Every response body in the recording, joined, so a check can ask whether the vendor really said something. */
function rawText(exchanges: Exchange[]): string {
  return exchanges.map((e) => e.body).join("\n");
}

const HOSTS: Record<CaseVendor, RegExp> = {
  fareharbor: /^https:\/\/(?:[a-z0-9-]+\.)*fareharbor\.com\//i,
  peek: /^https:\/\/(?:[a-z0-9-]+\.)*peek\.com\//i,
  xola: /^https:\/\/(?:[a-z0-9-]+\.)*xola\.com\//i,
};

export const CHECKS: Check[] = [
  {
    id: "dead-is-empty",
    why: "A reader that says it has nothing must not also hand the page a list of times to draw.",
    run: ({ answer }) =>
      !answer.live && answer.days.length
        ? [{ check: "dead-is-empty", level: "error", detail: `live:false but ${answer.days.length} day(s) returned` }]
        : [],
  },
  {
    id: "live-but-empty",
    why:
      "A read that worked and found nothing is honest and common: plenty of shops are shut for a fortnight, " +
      "and saying so beats falling back to invented times. But a reader that has stopped understanding a feed " +
      "produces exactly this shape too, and says nothing about it. So it is worth a person's eye, not a failure.",
    run: ({ answer }) =>
      answer.live && !answer.days.some((d) => d.slots.length)
        ? [{ check: "live-but-empty", level: "warn", detail: "the vendor answered and nothing was bookable in the whole window" }]
        : [],
  },
  {
    id: "inside-window",
    why: "A date outside what the guest asked for is a day they cannot act on, shown as if they could.",
    run: ({ kase, answer }) => {
      const want = new Set(windowDates(kase.from, kase.days));
      return answer.days.filter((d) => !want.has(d.date)).map((d) => ({ check: "inside-window", level: "error" as const, detail: `day ${d.date} is outside ${kase.from} +${kase.days}d` }));
    },
  },
  {
    id: "days-ordered-and-unique",
    why: "A repeated or out of order date draws the same day twice in the picker.",
    run: ({ answer }) => {
      const out: Finding[] = [];
      const seen = new Set<string>();
      let last = "";
      for (const d of answer.days) {
        if (seen.has(d.date)) out.push({ check: "days-ordered-and-unique", level: "error", detail: `date ${d.date} appears twice` });
        if (last && d.date < last) out.push({ check: "days-ordered-and-unique", level: "error", detail: `date ${d.date} comes after ${last}` });
        seen.add(d.date);
        last = d.date;
      }
      return out;
    },
  },
  {
    id: "start-belongs-to-its-day",
    why: "A slot filed under the wrong date is offered on a day the operator is not running it.",
    run: ({ answer }) =>
      allSlots(answer)
        .filter(({ day, slot }) => {
          const m = TIME_RE.exec(slot.startsAt);
          return !m || m[1] !== day;
        })
        .map(({ day, slot }) => ({ check: "start-belongs-to-its-day", level: "error" as const, detail: `${slot.startsAt} filed under ${day}` })),
  },
  {
    id: "no-phantom-midnight",
    why: "Peek's open-date marker was drawn as a midnight departure, so the page offered a jet ski at 00:00.",
    run: ({ answer }) =>
      allSlots(answer)
        .filter(({ slot }) => /T00:00$/.test(slot.startsAt) && !slot.timeUnknown)
        .map(({ slot }) => ({ check: "no-phantom-midnight", level: "error" as const, detail: `${slot.startsAt} is midnight and not flagged timeUnknown` })),
  },
  {
    id: "marker-is-not-an-offer",
    why: "A row that only means 'this date is open' must not carry a price or a seat count, or it reads as bookable.",
    run: ({ answer }) => {
      const out: Finding[] = [];
      for (const d of answer.days) {
        const markers = d.slots.filter((s) => s.timeUnknown);
        if (markers.length && d.slots.length > markers.length) out.push({ check: "marker-is-not-an-offer", level: "error", detail: `${d.date} mixes ${markers.length} marker row(s) with ${d.slots.length - markers.length} real time(s)` });
        for (const m of markers) {
          if (m.priceCents != null || m.seatsLeft != null) out.push({ check: "marker-is-not-an-offer", level: "error", detail: `${d.date} marker carries price/seats` });
        }
      }
      return out;
    },
  },
  {
    id: "no-duplicate-slot",
    why: "The same departure listed twice makes a picker with two identical rows and no way to tell them apart.",
    run: ({ answer }) => {
      const out: Finding[] = [];
      for (const d of answer.days) {
        const seen = new Set<string>();
        for (const s of d.slots) {
          const k = s.startsAt + "|" + s.label + "|" + s.bookUrl;
          if (seen.has(k)) out.push({ check: "no-duplicate-slot", level: "error", detail: `${d.date} repeats ${s.startsAt} ${s.label}` });
          seen.add(k);
        }
      }
      return out;
    },
  },
  {
    id: "price-is-money",
    why: "A zero is the vendor saying 'ask us', and quoting $0.00 to a guest is worse than quoting nothing.",
    run: ({ answer }) =>
      allSlots(answer)
        .filter(({ slot }) => slot.priceCents != null && (!Number.isInteger(slot.priceCents) || slot.priceCents <= 0 || slot.priceCents > 5_000_000))
        .map(({ slot }) => ({ check: "price-is-money", level: "error" as const, detail: `${slot.startsAt} priceCents ${slot.priceCents}` })),
  },
  {
    id: "sold-out-is-not-offered",
    why: "A slot with no seats left, still on sale, sends a guest to a checkout that will refuse them.",
    run: ({ answer }) =>
      allSlots(answer)
        .filter(({ slot }) => slot.seatsLeft != null && (!Number.isInteger(slot.seatsLeft) || slot.seatsLeft <= 0))
        .map(({ slot }) => ({ check: "sold-out-is-not-offered", level: "error" as const, detail: `${slot.startsAt} seatsLeft ${slot.seatsLeft}` })),
  },
  {
    id: "book-url-is-the-vendor",
    why: "The link has to finish the booking. Anything not on the vendor's host is a dead end or worse.",
    run: ({ kase, answer }) =>
      allSlots(answer)
        .filter(({ slot }) => !HOSTS[kase.vendor].test(slot.bookUrl))
        .map(({ slot }) => ({ check: "book-url-is-the-vendor", level: "error" as const, detail: `${slot.startsAt} books at ${slot.bookUrl.slice(0, 80)}` })),
  },
  {
    id: "label-says-something",
    why: "The label is the whole of what a guest reads on the row. Empty is a blank line in the picker.",
    run: ({ answer }) =>
      allSlots(answer)
        .filter(({ slot }) => !slot.timeUnknown && !slot.label.trim())
        .map(({ slot }) => ({ check: "label-says-something", level: "error" as const, detail: `${slot.startsAt} has an empty label` })),
  },
  {
    id: "clock-is-the-operators",
    why:
      "The single most damaging bug available here: convert the vendor's local time to ours and every departure " +
      "moves by hours, silently and plausibly. So every hour and minute we print has to appear verbatim in what " +
      "the vendor actually sent. A shifted time is a guest at the dock at the wrong hour.",
    run: ({ answer, exchanges }) => {
      const raw = rawText(exchanges);
      const out: Finding[] = [];
      for (const { slot } of allSlots(answer)) {
        if (slot.timeUnknown) continue;
        const m = TIME_RE.exec(slot.startsAt);
        if (!m) continue;
        const [, , hh, mm] = m;
        // Every way the vendors write a time of day: "T09:30", "09:30", "9:30 AM", and Xola's HHMM integer.
        const h24 = Number(hh);
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
        const forms = [`${hh}:${mm}`, `${h12}:${mm}`, `"${String(h24)}${mm}"`, `${String(h24)}${mm}:`];
        if (!forms.some((f) => raw.includes(f))) {
          out.push({ check: "clock-is-the-operators", level: "error", detail: `${slot.startsAt}: no form of ${hh}:${mm} appears in what the vendor sent` });
        }
      }
      return out;
    },
  },
  {
    id: "partial-is-declared",
    why: "A window cut short by the call budget looks identical to a quiet shop unless the reader says so.",
    run: ({ kase, answer }) => {
      if (!answer.live || answer.partial) return [];
      const covered = new Set(answer.days.map((d) => d.date));
      const missing = windowDates(kase.from, kase.days).filter((d) => !covered.has(d));
      // Not an error: a shop genuinely shut for a fortnight has the same shape. It is a thing to look at.
      return missing.length === kase.days
        ? [{ check: "partial-is-declared", level: "warn", detail: `no day in the ${kase.days} day window was answered, and partial is not set` }]
        : [];
    },
  },
];

export function runChecks(c: CheckContext): Finding[] {
  return CHECKS.flatMap((check) => {
    try {
      return check.run(c);
    } catch (e) {
      return [{ check: check.id, level: "error" as const, detail: "the check itself threw: " + String(e) }];
    }
  });
}

/**
 * A second, deliberately separate reading of the same recording.
 *
 * Written from the vendor's payload rather than from the reader, and kept as dumb as the feed allows: no
 * budget, no cache, no item selection, no pagination cleverness. Where the two disagree, one of them is wrong,
 * and the disagreement is worth a person's attention even though neither side is authority.
 *
 * Be honest about what this proves. It catches transcription, filtering, dedup, budget and timezone mistakes,
 * which is most of what goes wrong. It cannot catch a misunderstanding both readings share, such as both of us
 * believing `is_bookable` means what we assume it means. That is what the model pass and a person opening the
 * shop's own booking page are for.
 */
export function crossRead(vendor: CaseVendor, exchanges: Exchange[], from: string, days: number): Set<string> {
  const want = new Set(windowDates(from, days));
  const starts = new Set<string>();
  const bodies = exchanges.filter((e) => e.status >= 200 && e.status < 300).map((e) => e.body);

  if (vendor === "fareharbor") {
    for (const b of bodies) {
      let j: unknown;
      try {
        j = JSON.parse(b);
      } catch {
        continue;
      }
      const weeks = (j as { calendar?: { weeks?: { days?: unknown[] }[] } })?.calendar?.weeks;
      for (const w of weeks || []) {
        for (const day of (w.days || []) as { availabilities?: Record<string, unknown>[] }[]) {
          for (const av of day.availabilities || []) {
            if (av.is_bookable === false || av.is_sold_out === true || av.is_unlisted === true || av.is_bookable_only_by_phone === true) continue;
            const at = typeof av.start_at === "string" ? av.start_at : "";
            // "2026-09-20T09:00:00-04:00" -> "2026-09-20T09:00". The offset is the shop's, and is dropped, not applied.
            const local = at.slice(0, 16);
            if (local.length === 16 && want.has(local.slice(0, 10))) starts.add(local);
          }
        }
      }
    }
  }

  if (vendor === "xola") {
    for (const b of bodies) {
      let j: unknown;
      try {
        j = JSON.parse(b);
      } catch {
        continue;
      }
      // { "<experienceId>": { "2026-09-20": { "930": 4, "1730": 0 } } }
      for (const byDate of Object.values((j || {}) as Record<string, unknown>)) {
        if (!byDate || typeof byDate !== "object") continue;
        for (const [date, times] of Object.entries(byDate as Record<string, unknown>)) {
          if (!want.has(date) || !times || typeof times !== "object") continue;
          for (const [hhmm, seats] of Object.entries(times as Record<string, unknown>)) {
            if (typeof seats === "number" && seats <= 0) continue;
            const n = Number(hhmm);
            if (!Number.isFinite(n) || n < 0 || n > 2359) continue;
            starts.add(`${date}T${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`);
          }
        }
      }
    }
  }

  if (vendor === "peek") {
    // Peek splits dates and times across two calls, and the times call names no date in its body, so the pair
    // cannot be rebuilt from bodies alone. The URL carries it, which is why the exchange keeps its url.
    for (const e of exchanges) {
      if (!e.url.includes("availability-times")) continue;
      const date = /(\d{4}-\d{2}-\d{2})/.exec(e.url)?.[1];
      if (!date || !want.has(date)) continue;
      let j: unknown;
      try {
        j = JSON.parse(e.body);
      } catch {
        continue;
      }
      for (const row of ((j as { data?: { attributes?: { time?: string; spots?: number } }[] })?.data || [])) {
        const t = row.attributes?.time || "";
        if (typeof row.attributes?.spots === "number" && row.attributes.spots <= 0) continue;
        const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(t.trim());
        if (!m) continue;
        let h = Number(m[1]) % 12;
        if (/pm/i.test(m[3] || "")) h += 12;
        if (!m[3]) h = Number(m[1]);
        starts.add(`${date}T${String(h).padStart(2, "0")}:${m[2]}`);
      }
    }
  }

  return starts;
}
