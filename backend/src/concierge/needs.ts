import type { Intent } from "./plan.ts";

/**
 * What you have to know before an answer is worth giving, and it is different for every activity.
 *
 * "Four of us" settles an escape room: the rooms are an hour, the price is per head, and there is nothing
 * else to decide. It settles almost nothing about a jet ski, where the same shop sells an hour at $108 and a
 * half day at $400 and the number that matters is how long, not how many. A fishing charter is four hours or
 * eight and the difference is $500. A spa is a thirty minute massage or a two hour one.
 *
 * So the agent cannot have one list of questions. Each activity has the one or two facts that actually move
 * the answer, in the order they move it most, and everything else is assumed and said out loud. The rules:
 *
 * - Ask only what this activity turns on. Never ask a spa how many jet skis.
 * - Never ask twice, and never ask what the guest already said.
 * - Ask beside an answer, not in front of one, unless nothing can be searched at all.
 *
 * The lists are deliberately short. Three questions is an intake form; one is a conversation.
 */

export type NeedId = "party" | "duration" | "when" | "budget";

export type Need = {
  id: NeedId;
  question: string;
  /** Each answer is a sentence the guest could have typed, so it goes back through the same reader. */
  choices: { label: string; add: string }[];
};

/**
 * Per activity, what matters most first.
 *
 * `party` is on nearly everything because price is usually per head, but it is not always the first thing:
 * for a rental the clock decides the price and the number of people only decides how many you hire.
 */
const BY_CATEGORY: Record<string, NeedId[]> = {
  // Rentals and charters: the clock is the price.
  jetski: ["duration", "party"],
  pontoon: ["duration", "party"],
  kayak: ["duration", "party"],
  paddleboard: ["duration", "party"],
  bike: ["duration", "party"],
  snowmobile: ["duration", "party"],
  sailing: ["duration", "party"],
  fishing: ["duration", "party"],
  cruise: ["duration", "party"],
  surf: ["duration", "party"],
  scuba: ["duration", "party"],
  rafting: ["duration", "party"],

  // Sessions sold by the head, in a fixed slot: who and when.
  escape: ["party", "when"],
  axe: ["party", "when"],
  lasertag: ["party", "when"],
  karaoke: ["party", "duration"],
  bowling: ["party", "when"],
  billiards: ["party", "duration"],
  kart: ["party", "when"],
  paintball: ["party", "when"],
  climbing: ["party", "when"],
  trampoline: ["party", "when"],
  arcade: ["party", "when"],
  rage: ["party", "when"],
  minigolf: ["party", "when"],

  // A treatment is bought by its length before anything else.
  spa: ["duration", "when"],
  sauna: ["duration", "when"],

  // A seat on a flight: how many, and which tour.
  heli: ["party", "when"],
  balloon: ["party", "when"],
  skydive: ["party", "when"],
  parasail: ["party", "when"],
  zipline: ["party", "when"],
  gliding: ["party", "when"],
  paragliding: ["party", "when"],

  // Classes and tastings: a seat, at a time.
  cooking: ["party", "when"],
  brewery: ["party", "when"],
  winery: ["party", "when"],
  distillery: ["party", "when"],
  pottery: ["party", "when"],
  dance: ["party", "when"],
  yoga: ["party", "when"],

  horse: ["duration", "party"],
  golf: ["party", "when"],
  tour: ["duration", "party"],
};

/** Everything else, and anything we have no activity for at all. */
const DEFAULT_NEEDS: NeedId[] = ["party", "when"];

/** The word a guest would use for this activity, for the question itself. */
function thing(intent: Intent): string {
  return (intent.categoryLabel || "it").toLowerCase();
}

/**
 * How long, phrased for the activity. A jet ski is hours, a charter is half a day, a massage is minutes, and
 * offering the wrong ladder makes the agent look like it does not know what it is selling.
 */
function durationNeed(intent: Intent): Need {
  const c = intent.categoryId ?? "";
  if (c === "spa" || c === "sauna") {
    return {
      id: "duration",
      question: "How long were you thinking?",
      choices: [
        { label: "30 minutes", add: "30 minute" },
        { label: "An hour", add: "60 minute" },
        { label: "90 minutes or more", add: "90 minute" },
      ],
    };
  }
  if (c === "fishing" || c === "cruise" || c === "sailing") {
    return {
      id: "duration",
      question: "Half a day or a full one?",
      choices: [
        { label: "A couple of hours", add: "2 hour" },
        { label: "Half day", add: "half day 4 hour" },
        { label: "Full day", add: "full day 8 hour" },
      ],
    };
  }
  return {
    id: "duration",
    question: "How long do you want the " + thing(intent) + " for?",
    choices: [
      { label: "An hour", add: "1 hour" },
      { label: "Two hours", add: "2 hour" },
      { label: "Half a day", add: "half day 4 hour" },
    ],
  };
}

function partyNeed(intent: Intent): Need {
  return {
    id: "party",
    question: "How many of you?",
    choices: [
      { label: "Just 2", add: "for 2 people" },
      { label: "4", add: "for 4 people" },
      { label: "6", add: "for 6 people" },
      { label: "More than 8", add: "for 10 people" },
    ],
  };
}

function whenNeed(): Need {
  return {
    id: "when",
    question: "When are you thinking?",
    choices: [
      { label: "Tonight", add: "tonight" },
      { label: "Tomorrow", add: "tomorrow" },
      { label: "This weekend", add: "this weekend" },
    ],
  };
}

function budgetNeed(): Need {
  return {
    id: "budget",
    question: "Any budget in mind?",
    choices: [
      { label: "Keep it cheap", add: "under $40 a head" },
      { label: "Mid-range", add: "under $80 a head" },
      { label: "Doesn't matter", add: "any price" },
    ],
  };
}

/** Has the guest already settled this, one way or another? */
export function known(intent: Intent, id: NeedId): boolean {
  // `assumed` carries "two of you" exactly when nobody counted heads, so its absence is the guest saying so.
  if (id === "party") return !(intent.assumed || []).some((a) => a.includes("two of you"));
  if (id === "when") return intent.when !== "any" || intent.atMinute != null;
  if (id === "budget") return intent.maxPerPerson != null;
  if (id === "duration") return /\b(\d{1,2}\s*(?:hour|hr|min)|half day|full day|all day|overnight)\b/i.test(intent.text);
  return false;
}

/**
 * The single most useful thing left to ask about this activity, or nothing.
 *
 * One at a time, in the order this activity cares about, skipping anything already settled or already put to
 * them. Returning null is the common and correct case: most sentences carry enough.
 */
export function nextNeed(intent: Intent): Need | null {
  const order = (intent.categoryId && BY_CATEGORY[intent.categoryId]) || DEFAULT_NEEDS;
  const asked = new Set(intent.asked || []);
  for (const id of order) {
    if (asked.has("need:" + id) || known(intent, id)) continue;
    if (id === "duration") return durationNeed(intent);
    if (id === "party") return partyNeed(intent);
    if (id === "when") return whenNeed();
    if (id === "budget") return budgetNeed();
  }
  return null;
}
