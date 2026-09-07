import type { Listing } from "../data/types";
import { fmtTime, money, plural } from "./format";

export type SlotSnap = { time: string; open: number };
export type DaySnap = { label: string; openSlots: number };

function pickPolicy(listing: Listing, keywords: string[]): string | null {
  const hit = listing.policy.find((p) => keywords.some((k) => p.toLowerCase().includes(k)));
  return hit ?? null;
}

function nearestOpen(slots: SlotSnap[]): SlotSnap | null {
  return slots.find((s) => s.open > 0) ?? null;
}

function saturdayHint(nextDays: DaySnap[]): string {
  const sat = nextDays.find((d) => d.label.startsWith("Sat"));
  if (!sat) return "I can check the next few days if you pick a date in Explore.";
  if (sat.openSlots === 0) return sat.label + " is booked out. Try a weekday if you can move it.";
  return sat.label + " has " + sat.openSlots + " of 6 slots still open.";
}

/** Operator booking agent. Answers only from listing facts, policy, and live inventory. */
export function agentReply(
  listing: Listing,
  question: string,
  ctx: { dateLabel: string; slots: SlotSnap[]; nextDays: DaySnap[] },
): string {
  const q = question.toLowerCase();
  const openNow = nearestOpen(ctx.slots);
  const sold = ctx.slots.filter((s) => s.open === 0).map((s) => fmtTime(s.time));

  if (/(weather|wind|flying|fly today|grounds|cancel|storm|lightning|chop|tide)/.test(q)) {
    const rule = pickPolicy(listing, [
      "wind",
      "weather",
      "lightning",
      "ceiling",
      "storm",
      "advisory",
      "scrub",
      "rain",
    ]);
    if (rule) return rule + " If we scrub, you keep the booking or take a free reschedule.";
    return "If weather grounds us, you get a free reschedule. I will not guess today's conditions beyond what is on the listing.";
  }

  if (/(how much|price|cost|fee|expensive|cheap|\$)/.test(q)) {
    const min =
      listing.unit === "hr"
        ? money(listing.price * listing.minHours) + " for the " + listing.minHours + " hour minimum, per " + listing.qtyUnit
        : listing.unit === "trip"
          ? money(listing.price) + " flat for the trip"
          : money(listing.price) + " per " + listing.qtyUnit;
    return (
      min +
      ". An 8% service fee is added at checkout. Add-ons are optional and listed on the experience page."
    );
  }

  if (/(include|what's in|whats in|bring|gear|helmet|pfd|bait|fuel)/.test(q)) {
    const extras = listing.addons.map((a) => a.name + " (" + (a.price ? money(a.price) : "free") + ")").join(", ");
    const first = listing.policy[0] || listing.blurb;
    return first + (extras ? " Optional add-ons: " + extras + "." : "");
  }

  if (/(weight|age|limit|under 18|kids|child|height)/.test(q)) {
    const fact = listing.facts.find((f) => /weight|age|height|min/i.test(f[0] + f[1]));
    const rule = pickPolicy(listing, ["weight", "age", "under", "minimum age", "height", "18"]);
    if (rule) return rule;
    if (fact) return fact[0] + " is " + fact[1] + ". I will not guess anything the operator did not publish.";
    return "That limit is not on this listing. I can have the owner confirm and hold a slot in the meantime.";
  }

  if (/(open|avail|slot|saturday|sunday|today|tomorrow|11|book|seat|ski|spot)/.test(q)) {
    if (/saturday|sat\b/.test(q)) return saturdayHint(ctx.nextDays);
    if (!openNow) {
      return (
        ctx.dateLabel +
        " is sold out" +
        (sold.length ? " at " + sold.join(", ") : "") +
        ". Flip the date strip to another day with a green count."
      );
    }
    const want3 = /3 |three/.test(q);
    const n = openNow.open;
    if (want3 && n < 3) {
      const later = ctx.slots.find((s) => s.open >= 3);
      if (later) {
        return (
          fmtTime(openNow.time) +
          " only has " +
          plural(n, listing.qtyUnit) +
          ". " +
          fmtTime(later.time) +
          " has " +
          plural(later.open, listing.qtyUnit) +
          " if you need three."
        );
      }
      return fmtTime(openNow.time) + " has " + plural(n, listing.qtyUnit) + " left. I do not have three together on " + ctx.dateLabel + ".";
    }
    return (
      ctx.dateLabel +
      " still has " +
      fmtTime(openNow.time) +
      " with " +
      plural(n, listing.qtyUnit) +
      " open. Grab it from the listing if you want it held."
    );
  }

  if (/(first.?timer|beginner|experience|scary|hard)/.test(q)) {
    const spec = listing.specs.find((s) => /no experience|beginner|ages/i.test(s));
    return (
      (spec ? spec + ". " : "") +
      listing.blurb.split(".")[0] +
      ". If you want a softer first run, say so and I will point at the right add-on or time."
    );
  }

  if (openNow) {
    return (
      listing.op +
      " here. " +
      ctx.dateLabel +
      " has " +
      fmtTime(openNow.time) +
      " open with " +
      plural(openNow.open, listing.qtyUnit) +
      ". Ask me about price, weather rules, or what to bring."
    );
  }
  return (
    listing.op +
    " here. " +
    ctx.dateLabel +
    " is booked out. Ask me about another day, price, or the house rules."
  );
}
