/**
 * The largest party an operator's own group lines state.
 *
 * This lived in `listingDerive.ts`, which reads `catalog.ts` for its other helpers. The guest picker's ceiling
 * is decided in `catalog.ts`, so the rule moved here, where both can read it without the two files importing
 * each other. `listingDerive` re-exports it, so every surface still imports it from where it always did.
 */

/** A count with an optional thousands separator: "3,000" is three thousand, never the "000" on its end. */
const HEAD = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
/** The words a group line counts people in. The same set the listing page has always read. */
const PEOPLE = String.raw`guests?|people|passengers|riders|max(?:imum)?`;
/** Words that introduce a ceiling: "seats 6", "holds up to 18", "capacity 30". */
const CEILING = /\b(?:up to|max|maximum|holds?|seats?|accommodates?|capacity|capacities|limited to|fits?|no more than)\b/i;
/** Words that introduce a floor, which is the number a group line most often states first. */
const FLOOR = /\b(?:min|minimum|at least|requires?|required|starting at|starts at|from|over)\b/i;

/**
 * The largest party the operator's own group lines state: "up to 6 guests", "Boat seats 6 passengers",
 * "minimum 6 guests, maximum 10", "Groups from 15 to 5,000 guests". Null when they state no ceiling at all,
 * which is an honest gap and better than a number nobody wrote.
 *
 * The listing page took the first "<number> <people>" on the line and called it the maximum, which went wrong
 * on 57 listings in the shipped catalog. Nine printed "Up to 0 guests", because a thousands separator left the
 * tail behind: "Group events for 10 to 3,000 guests" matched "000 guests". On 47 the number was a floor the
 * line had just stated, and "Helicopter tours require minimum 2 passengers" reading "Up to 2 guests" sends a
 * family of four away from a flight that would have taken them; where the same line went on to name a ceiling
 * ("minimum 6 guests, maximum 10") the smaller of the two was the one shown.
 *
 * Which line is read, and which count on it, is otherwise unchanged: a line that states only a floor now gives
 * the listing page nothing rather than a wrong number.
 */
export function groupCap(lines: string[] | undefined): number | null {
  // "6 guests", "1500 guests", "12 max". The upper end of a range is the number the people word sits beside.
  const counted = new RegExp(String.raw`(${HEAD})\s*(?:${PEOPLE})\b`, "gi");
  // The ceiling a line states without repeating the count after it: "maximum 10", "up to 25".
  const led = new RegExp(String.raw`\b(?:max(?:imum)?|up to|no more than)\b(?:\s*(?:of|is|:))?\s*(${HEAD})\b`, "gi");
  // A party of no one is not a fact, and six figures is a city rather than a booking.
  const size = (t: string): number | null => {
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) && n >= 1 && n <= 99999 ? n : null;
  };
  for (const raw of lines || []) {
    const line = raw.replace(/\s+/g, " ");
    let floorOnly = false;
    for (const m of line.matchAll(counted)) {
      const before = line.slice(0, m.index);
      // "10 to 3,000 guests": the floor word belongs to the bottom of the range, not to this number.
      const topOfRange = /\d[\d,]*\s*(?:-|–|—|to|or)\s*$/.test(before);
      // Only a floor word near the number speaks for it. "Balloons range from pilot plus 2 to pilot plus 6
      // passengers" states a ceiling of 6; the "from" at the far end of the line is about a different count.
      const clause = (before.split(/[.;,]/).pop() || "").slice(-24);
      if (!topOfRange && FLOOR.test(clause) && !CEILING.test(clause)) {
        floorOnly = true;
        continue;
      }
      const n = size(m[1]);
      if (n != null) return n;
    }
    // Every count this line stated was a floor, so a ceiling it names without a count of its own is the answer.
    if (floorOnly) {
      for (const m of line.matchAll(led)) {
        const n = size(m[1]);
        if (n != null) return n;
      }
    }
  }
  return null;
}
