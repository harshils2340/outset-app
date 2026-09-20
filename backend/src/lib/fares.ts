/**
 * Which fares a guest can actually buy, and which are somebody else's price.
 *
 * A headline price has to be a price the person reading it could pay. Quoting "$20.14 · Infant" to somebody
 * arranging a ten-person offsite, or "$115.54 · Child" to an adult, is a lie of omission: they cannot buy
 * that ticket, and the number they were shown is not the number they would pay. It is also the cheapest row
 * in the list, so a naive "from" price picks it every single time.
 *
 * The rule lived in `src/concierge/live.ts`, where it was written for FareHarbor's customer types, and
 * nowhere else. `src/enrich/availability.ts`, which is what the guest listing page's own time-and-price
 * picker reads, had no concession handling at all and would quote an infant fare as the price of a slot.
 * Two readers of the same kind of data disagreeing about what a price means is how a guest sees one number
 * on the listing page and another at checkout, so the rule lives here now and both should use it.
 *
 * Age words only. Deliberately not "group", "private", "resident" or "member": those are real tickets an
 * ordinary guest may well be able to buy, and excluding them would push the headline price up and be its own
 * kind of lie.
 */
const CONCESSION = /\b(child|children|kid|kids|infant|baby|babies|toddler|youth|junior|student|senior|pensioner|veteran)\b/i;

export function isConcessionFare(label: string | null | undefined): boolean {
  return !!label && CONCESSION.test(label);
}

/**
 * The cheapest fare an ordinary adult could buy, from labelled fares.
 *
 * Falls back to the cheapest of everything when every fare is a concession, or when none of them is named:
 * plenty of booking systems publish prices with no labels at all, and a price with an unknown name is more
 * use to a guest than no price. Returns null when there is nothing priced.
 */
export function openFarePrice<T>(fares: T[], priceOf: (f: T) => number | null | undefined, labelOf: (f: T) => string | null | undefined): number | null {
  const priced = fares.filter((f) => {
    const p = priceOf(f);
    return typeof p === "number" && Number.isFinite(p) && p > 0;
  });
  if (!priced.length) return null;
  const open = priced.filter((f) => !isConcessionFare(labelOf(f)));
  const pool = open.length ? open : priced;
  return Math.min(...pool.map((f) => priceOf(f) as number));
}
