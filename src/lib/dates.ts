export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function makeDates(count = 10): Date[] {
  const today = startOfToday();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The inverse of `dateKey`: "2026-09-20" as midnight local, or null when it is not a date.
 *
 * Split by hand rather than handed to `new Date`, because a bare "YYYY-MM-DD" is parsed as UTC and read back
 * as the day before anywhere west of Greenwich. The vendors' dates are their own wall calendar and carry no
 * zone, so a round trip through UTC is a day lost for every guest in the Americas, which is most of them.
 */
export function dateFromKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const out = new Date(y, mo - 1, d);
  // Rejects the days a month does not have: JavaScript rolls 31 February forward to 3 March without complaint.
  return out.getMonth() === mo - 1 && out.getDate() === d ? out : null;
}
