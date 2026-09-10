/**
 * Published hour lines to a compact week: seven entries, Sunday first, each [openMinutes, closeMinutes],
 * [0, 0] for a stated closed day, null when the site says nothing for that day. Mirrors src/lib/openNow.ts.
 */
const DAY_RE: [RegExp, number[]][] = [
  [/\b(daily|every ?day|7 days|open daily)\b/i, [0, 1, 2, 3, 4, 5, 6]],
  [/\bmon(?:day)?\s*(?:-|–|to|through|thru)\s*fri(?:day)?\b/i, [1, 2, 3, 4, 5]],
  [/\bmon(?:day)?\s*(?:-|–|to|through|thru)\s*sat(?:urday)?\b/i, [1, 2, 3, 4, 5, 6]],
  [/\bmon(?:day)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 1, 2, 3, 4, 5, 6]],
  [/\btue(?:s|sday)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 2, 3, 4, 5, 6]],
  [/\bwed(?:nesday)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 3, 4, 5, 6]],
  [/\bthu(?:rs|rsday)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 4, 5, 6]],
  [/\bfri(?:day)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 5, 6]],
  [/\bsat(?:urday)?\s*(?:-|–|to|through|thru|&|and|\/)\s*sun(?:day)?\b/i, [0, 6]],
  [/\bweekends?\b/i, [0, 6]],
  [/\bweekdays?\b/i, [1, 2, 3, 4, 5]],
  [/\bsun(?:day)?s?\b/i, [0]],
  [/\bmon(?:day)?s?\b/i, [1]],
  [/\btue(?:s|sday)?s?\b/i, [2]],
  [/\bwed(?:nesday)?s?\b/i, [3]],
  [/\bthu(?:rs|rsday)?s?\b/i, [4]],
  [/\bfri(?:day)?s?\b/i, [5]],
  [/\bsat(?:urday)?s?\b/i, [6]],
];
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i;

function mins(h: number, m: number, ap: string | undefined, afternoonHint: boolean): number {
  let hh = h;
  const a = (ap || "").replace(/\./g, "").toLowerCase();
  if (a === "pm" && hh < 12) hh += 12;
  if (a === "am" && hh === 12) hh = 0;
  if (!a && afternoonHint && hh < 12 && hh <= 8) hh += 12;
  return hh * 60 + m;
}

export type WeekEnc = ([number, number] | null)[];

export function encodeWeek(lines: string[]): WeekEnc | null {
  const week: WeekEnc = [null, null, null, null, null, null, null];
  let any = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const closed = /\bclosed\b/i.test(line);
    const t = TIME_RE.exec(line);
    let days: number[] | null = null;
    for (const [re, d] of DAY_RE) {
      if (re.test(line)) {
        days = d;
        break;
      }
    }
    if (!days && t) days = [0, 1, 2, 3, 4, 5, 6];
    if (!days) continue;
    for (const d of days) {
      if (closed && !t) {
        week[d] = [0, 0];
        any = true;
      } else if (t) {
        const open = mins(Number(t[1]), Number(t[2] || 0), t[3], false);
        let close = mins(Number(t[4]), Number(t[5] || 0), t[6], true);
        if (!t[6] && !t[3] && close <= open) close += 12 * 60;
        if (close <= open) close += 24 * 60;
        if (close - open < 30 || close - open > 24 * 60) continue;
        week[d] = [open, close];
        any = true;
      }
    }
  }
  return any ? week : null;
}
