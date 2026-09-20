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
 * Rentals and charters lead with "when", not "party": a live booking calendar is the whole reason this
 * product exists, and nothing shows that off like asking what time somebody actually wants to go and then
 * ranking real times around it. `nextNeed` answers "when" for this group with `timeOfDayNeed` below (a real
 * clock question) instead of the generic `whenNeed` (a day of the week), and `known` holds it to a real hour.
 */
const RENTAL_CATS = new Set([
  "jetski", "pontoon", "kayak", "paddleboard", "bike", "snowmobile", "sailing", "fishing", "cruise", "surf", "scuba", "rafting",
]);

const BY_CATEGORY: Record<string, NeedId[]> = {
  jetski: ["when", "party"],
  pontoon: ["when", "party"],
  kayak: ["when", "party"],
  paddleboard: ["when", "party"],
  bike: ["when", "party"],
  snowmobile: ["when", "party"],
  sailing: ["when", "party"],
  fishing: ["when", "party"],
  cruise: ["when", "party"],
  surf: ["when", "party"],
  scuba: ["when", "party"],
  rafting: ["when", "party"],

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

/**
 * No buttons: a headcount is any number at all, and four preset choices cannot stand in for it. Party of 3, 5
 * or 11 tapped the nearest wrong button before, which is worse than asking plainly and letting the number they
 * actually type answer it.
 */
function partyNeed(): Need {
  return {
    id: "party",
    question: "How many of you?",
    choices: [],
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

/**
 * A real clock question, not a day of the week. Each choice's text carries an actual part-of-day word
 * (`plan.ts`'s own reader turns "morning", "afternoon" and "evening" into a clock minute), so tapping one does
 * not just narrow the day — it makes every live time on screen rank itself by distance from that hour, the
 * nearest one called out and the rest marked "+40m", "+1h20m". That live-ranking is the whole demonstration
 * that these are somebody's real calendars and not a list; asking about people first buried it two turns down.
 */
function timeOfDayNeed(intent: Intent): Need {
  return {
    id: "when",
    question: "What time do you want to " + (intent.categoryId === "fishing" || intent.categoryId === "cruise" || intent.categoryId === "sailing" ? "go out" : "go") + "?",
    choices: [
      { label: "Morning", add: "this morning" },
      { label: "Afternoon", add: "this afternoon" },
      { label: "Evening", add: "this evening" },
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
  if (id === "party") return !!intent.partyStated;
  if (id === "when") {
    // A rental's "when" is a clock question: "tomorrow" names a day but not an hour, and the whole point of
    // asking is to rank live times against one. Everywhere else a day is a real answer to "when".
    if (intent.categoryId && RENTAL_CATS.has(intent.categoryId)) return intent.atMinute != null;
    return intent.when !== "any" || intent.atMinute != null;
  }
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
    if (id === "party") return partyNeed();
    if (id === "when") return intent.categoryId && RENTAL_CATS.has(intent.categoryId) ? timeOfDayNeed(intent) : whenNeed();
    if (id === "budget") return budgetNeed();
  }
  return null;
}
