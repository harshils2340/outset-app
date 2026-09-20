import { db } from "../db/client.ts";
import { CATEGORIES, METROS, inferCategory } from "../taxonomy/catalog.ts";
import { fareharborLive, feedIsWarm, type Departure } from "./live.ts";
import { isConcessionFare } from "../lib/fares.ts";
import { resovaLive } from "./resova.ts";
import { peekLive } from "./peek.ts";
import { checkfrontLive } from "./drivers/checkfront.ts";
import { xolaLive } from "./readers/xola.ts";
import { rezdyLive } from "./readers/rezdy.ts";
import { tripworksLive } from "./readers/tripworks.ts";
import { squareLive } from "./readers/square.ts";
import { acuityLive } from "./readers/acuity.ts";
import { foreupLive } from "./readers/foreup.ts";
import { isReadable, readerFor, unreadableSql } from "./readable.ts";
import { Trace } from "./session.ts";
import { recordDemand } from "./demand.ts";
import { nextNeed } from "./needs.ts";
import { resolveMany } from "./resolve.ts";

/**
 * One sentence in, real bookable options out.
 *
 * "escape room in kitchener tonight for 4" has four things in it: what, where, when and how many. None of them
 * arrive in fields, so they are read out of the sentence, matched against the catalog, and then the shortlist
 * is checked against each shop's own booking system so the times and prices we quote are theirs and current.
 *
 * Shops with a booking system we can read come first. A guest does not care which of the three fulfilment
 * routes their booking took, but they do care whether we can tell them a time, so the ones we can answer for
 * are the ones we offer.
 */

export type Intent = {
  text: string;
  categoryId: string | null;
  categoryLabel: string | null;
  city: string | null;
  region: string | null;
  /** Where they meant, as a point, so results are chosen by distance rather than by a matching city name. */
  point: { lat: number; lon: number } | null;
  party: number;
  when: "today" | "tonight" | "tomorrow" | "weekend" | "any";
  maxPerPerson: number | null;
  /** "$2,000 for the group". Kept beside the per-head figure because a group budget is not a ticket price. */
  maxTotal: number | null;
  /** "somewhere indoors", "rained out". Null when they did not care, which is most of the time. */
  cover: "indoor" | "outdoor" | null;
  /** A clock time they asked for, in minutes after midnight. 16:30 is 990. Null when they only said "tonight". */
  atMinute: number | null;
  /** A genre when they have not named an activity: "on the water", "puzzles and games". */
  genre: string | null;
  /**
   * Where the device says they are, when it is willing to say. Used when the sentence names nowhere, and to
   * settle which of several towns of the same name they meant without having to ask.
   */
  near?: { lat: number; lon: number } | null;
  /** True when the place came from the device rather than from something they typed, so the answer can say so. */
  placeFromDevice?: boolean;
  /** Questions already put to them, so the agent narrows instead of circling. */
  asked?: string[];
  /** Businesses already shown, for "show me something else". */
  seen?: string[];
  /** What they want done to the answer they already have, rather than a fresh search. */
  refine?: "other" | "cheaper" | "recheck" | "earlier" | "later" | null;
  /** The cheapest thing we last showed them, so "anything cheaper" has a number to beat. */
  lastCheapest?: number | null;
  /** Every place of that name we hold businesses for, when the sentence named one that is not unique. */
  places?: PlaceMatch[];
  /** Fields nobody said out loud, so the answer can admit what it guessed instead of pretending it was told. */
  assumed?: string[];
};

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, couple: 2 };

/** Every state and province, by the code the catalog stores. */
export const REGION_NAMES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** Names longest first, so "new york" is matched before "york" and "west virginia" before "virginia". */
const REGION_BY_NAME = Object.entries(REGION_NAMES)
  .map(([code, name]) => ({ code, name: name.toLowerCase() }))
  .sort((a, b) => b.name.length - a.name.length);

/**
 * The state or province a sentence names, if it names one.
 *
 * Names are matched case-insensitively anywhere. Two-letter codes are matched only when they are written as
 * codes — upper case, or straight after a comma — because half of them are ordinary English words. "in",
 * "or", "me", "hi", "ok", "no" and "de" would otherwise turn "kayaking in ohio" into Indiana.
 */
export function matchRegion(text: string): string | null {
  const t = text.toLowerCase();
  for (const r of REGION_BY_NAME) if (new RegExp("\\b" + r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(t)) return r.code;
  const code = text.match(/,\s*([A-Za-z]{2})\b/) || text.match(/\b([A-Z]{2})\b/);
  const up = code?.[1]?.toUpperCase();
  return up && REGION_NAMES[up] ? up : null;
}

/** Every place in the catalog whose name appears in the sentence, with how many businesses sit there. */
export type PlaceMatch = { city: string; region: string; n: number; lat: number; lon: number };

/**
 * Whether `phrase` appears in `haystack` as its own word, not merely as a run of the same letters inside a
 * longer one.
 *
 * `instr()` in the SQL above is a cheap superset filter, not the actual test: it said yes to Vail, Colorado,
 * for "any**avail**able at 3pm?", and a guest asking a plain follow-up about Waterloo escape rooms was silently
 * answered about kayaking near a ski town two provinces away. The same class of bug sat in the metro lookup
 * below (`t.includes(name)`), so both go through this one boundary check.
 */
function wordIn(haystack: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + esc + "\\b", "i").test(haystack);
}

/**
 * What, where, when and how many, out of a sentence a person actually typed.
 *
 * `prior` is what the agent already knew from earlier in the same conversation. A guest who is asked "where
 * are you?" answers "waterloo", and that one word is not a new request: it is the missing half of the one
 * before it. Without somewhere to put it, the agent asked a question, got an answer, and threw away the
 * question.
 */
export function readIntent(text: string, prior?: Intent | null, device?: { lat: number; lon: number } | null): Intent {
  const t = text.toLowerCase();

  /**
   * How many. "for 4", "4 of us", "party of six", "me and my dad" is two.
   *
   * Heads are added up rather than taken from one phrase: "2 adults and 3 kids" is a party of five, and it was
   * a party of two, which is the difference between an answer and a family turning up to a room booked for a
   * couple. Three digits, not two, because "20 people" was fine and "120 people" silently became twelve.
   */
  const N = "(\\d{1,3}|" + Object.keys(NUM_WORDS).join("|") + ")";
  const num = (w: string | undefined) => (w == null ? 0 : Number(w) || NUM_WORDS[w] || 0);
  let party = 2;
  const HEADWORD = "adults?|kids?|children|child|teens?|people|ppl|persons?|guests?|players?|pax|folks|guys|friends|of us";
  const heads = [...t.matchAll(new RegExp("\\b" + N + "\\s+(" + HEADWORD + ")\\b", "g"))]
    .reduce((sum, mm) => sum + num(mm[1]), 0);
  const m =
    t.match(new RegExp("\\bfor\\s+" + N + "\\b")) ||
    t.match(new RegExp("\\b" + N + "\\s+(?:" + HEADWORD + ")\\b")) ||
    t.match(new RegExp("\\bparty of\\s+" + N + "\\b")) ||
    t.match(new RegExp("\\bgroup of\\s+" + N + "\\b")) ||
    (heads ? ([""] as unknown as RegExpMatchArray) : null);
  if (heads > 1) party = heads;
  else if (m && m[1]) party = num(m[1]) || 2;
  else if (/\b(me and my|my partner and i|just us two|date night)\b/.test(t)) party = 2;
  if (party < 1 || party > 500) party = 2;

  /**
   * Budget. "under $30 a head" and "$2,000 for the group" are different numbers and were read as the same one:
   * an offsite with two thousand dollars for twenty people was being filtered as though every ticket had to
   * cost under two thousand dollars, which excludes nothing. A total is divided by the party to get the cap
   * that can actually be compared with a ticket price, and both are kept so the answer can say which it used.
   */
  const money = "\\$?\\s?([\\d,]{1,7})";
  const perHeadSaid = t.match(new RegExp("(?:under|below|less than|max(?:imum)?|up to|budget of|around)\\s*" + money + "\\s*(?:a|per|each|pp|\\/)\\s*(?:head|person|pax|ticket|each)?"))
    || t.match(new RegExp(money + "\\s*(?:a|per)\\s*(?:head|person|pax)"));
  /** A total is said either way round: "budget of $2,000", and just as often "we have a $2,000 budget". */
  const totalSaid =
    t.match(new RegExp(money + "\\s*(?:budget|total|all in|for (?:the )?(?:group|team|everyone|all of us|\\d+ people))")) ||
    t.match(new RegExp("(?:budget(?:\\s+of)?|under|below|less than|max(?:imum)?|up to|spend|within)\\s*(?:a\\s+)?" + money));
  const amount = (mm: RegExpMatchArray | null) => (mm ? Number(mm[1].replace(/,/g, "")) : null);

  // "Doesn't matter" is an answer to the budget question, and has to stop it being asked again.
  const noBudget = /\b(any price|no limit|doesn'?t matter|does not matter|whatever|no budget)\b/.test(t);
  let maxPerPerson = amount(perHeadSaid);
  let maxTotal: number | null = null;
  if (maxPerPerson == null) {
    const total = amount(totalSaid);
    /**
     * Which one they meant. Nobody budgets two thousand dollars for one ticket to an escape room and nobody
     * budgets thirty dollars for a team of twenty, so the size of the number against the size of the party is
     * the tell. A total only makes sense once there is a group to divide it by.
     */
    if (total != null && party > 1 && total > party * 25) {
      maxTotal = total;
      maxPerPerson = Math.floor(total / party);
    } else if (total != null) {
      maxPerPerson = total;
    }
  }

  /**
   * Under a roof or not. Asked for by name ("somewhere indoors"), and asked for sideways far more often:
   * a plan that was rained out, a toddler, a January evening. It is read off the category rather than the
   * `family` column, which groups escape rooms and bowling under "play" and so cannot answer the question.
   */
  /**
   * A clock time, when they named one. "escape room at 4:30pm" is a different request from "escape room
   * tonight": they have a dinner reservation at six, and a 4pm slot is useful while an 8pm one is not.
   *
   * Written every way people write it: "4:30pm", "430pm", "16:30", "half four", "at 7". A bare number is only
   * a time when the sentence points at one, because "for 4" is a party of four and "$40" is money.
   */
  /**
   * A range means when it starts. "Monday between 5-7pm" was reading 19:00, because the last time in the
   * sentence won, so every slot was ranked around the moment the offsite was due to finish. The opening time
   * of a range is taken first, before any single time is looked for.
   */
  const range =
    t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|\u2013|to|until|till)\s*\d{1,2}(?:[:.]\d{2})?\s*(am|pm)?/);
  const clock =
    range ||
    t.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/) ||
    t.match(/\b(\d{3,4})\s*(am|pm)\b/) ||
    t.match(/\b(?:at|around|by|from)\s+(\d{1,2})\s*(am|pm)\b/) ||
    t.match(/\b(\d{1,2})\s*(am|pm)\b/) ||
    // "at 7" with no am or pm. Only after "at" or "around": "for 4" is a party and "$40" is money.
    t.match(/\b(?:at|around)\s+(\d{1,2})\b(?!\s*(?:of us|people|persons|adults|guests|players|pax))/);
  /**
   * A part of the day is a time too. "Something tomorrow evening" was read as "tomorrow, any time", and then
   * the answer said so out loud — "assuming any time in the next fortnight" — to somebody who had just
   * named the evening. These are rough by nature, so they set a target to rank around, not a filter.
   */
  const PART_OF_DAY: [RegExp, number][] = [
    [/\b(?:early )?morning\b/, 10 * 60],
    [/\blunch(?:time)?\b|\bmidday\b|\bnoon\b/, 12 * 60],
    [/\bafternoon\b/, 14 * 60 + 30],
    [/\bevening\b|\bafter work\b|\bdinner\b/, 19 * 60],
    [/\bnight\b|\blate\b/, 20 * 60 + 30],
  ];

  let atMinute: number | null = null;
  if (clock) {
    let hh: number, mm: number, ap: string | undefined;
    if (clock === range) {
      hh = Number(range[1]);
      mm = Number(range[2] || 0);
      // "5-7pm" puts the meridiem only on the end; it governs both ends unless the start carries its own.
      ap = range[3] || range[4];
    } else if (clock[0].match(/[:.]/)) { hh = Number(clock[1]); mm = Number(clock[2]); ap = clock[3]; }
    else if (/^\d{3,4}$/.test(clock[1])) { hh = Number(clock[1].slice(0, -2)); mm = Number(clock[1].slice(-2)); ap = clock[2]; }
    else { hh = Number(clock[1]); mm = 0; ap = clock[2]; }
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    /**
     * No am or pm, and they are asking about an evening out. "escape room at 7" is seven in the evening; it is
     * not seven in the morning, when nothing in this catalog is open.
     */
    if (!ap && hh < 9) hh += 12;
    if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60) atMinute = hh * 60 + mm;
  }
  // An exact time they typed always beats a part of the day; "7pm tonight" is not "evening".
  if (atMinute == null) {
    for (const [re, mins] of PART_OF_DAY) if (re.test(t)) { atMinute = mins; break; }
  }

  const genre = readGenre(t);

  /**
   * What they want done to the answer they already have. A conversation does not stop at the first list:
   * "anything cheaper", "show me something else", "check again" are all refinements of the same request, and
   * treating them as brand new searches throws away everything the guest has already told us.
   */
  /**
   * "Instead" is a correction, not a refinement. "Actually I want axe throwing instead" must throw the escape
   * rooms away rather than search for escape rooms that are also axe throwing, and it must keep the town, the
   * party and the evening, which are all still true.
   */
  const instead = /\b(instead|actually|rather|scratch that|forget|no wait|change of plan)\b/.test(t);

  const refine: Intent["refine"] =
    /\b(?:something else|anything else|what else|who else|where else|any ?where else|other (?:options?|places?|ones?)|any other|more options?|show me more|others?|different|next)\b/.test(t) ? "other"
      : /\b(cheaper|less|lower|too (?:expensive|pricey|much)|budget)\b/.test(t) && !/\$/.test(t) ? "cheaper"
        : /\b(re-?check|check again|refresh|try again|anything now|updated?)\b/.test(t) ? "recheck"
          : /\b(earlier|sooner)\b/.test(t) ? "earlier"
            : /\b(later|after)\b/.test(t) ? "later"
              : null;

  const cover: Intent["cover"] = /\b(indoors?|inside|under cover|rained out|rain|raining|snowing|too cold|bad weather)\b/.test(t)
    ? "indoor"
    : /\b(outdoors?|outside|on the water|fresh air|in the sun)\b/.test(t)
      ? "outdoor"
      : null;

  /**
   * People mistype, and a mistyped word must not silently become a different request. A guest who wrote
   * "tomroorw evening with 4 ppl" was told "assuming two of you and any time in the next fortnight", which
   * contradicts, in one line, both things he had actually said. Key words are matched within two edits, which
   * catches the transpositions and doubled letters that are almost all real typing errors.
   */
  const sorted = (w: string) => [...w].sort().join("");
  const near = (word: string, max = 2): boolean => {
    if (t.includes(word)) return true;
    const wordSorted = sorted(word);
    for (const tok of t.split(/[^a-z]+/)) {
      if (!tok) continue;
      /**
       * Transposed letters are most of what real typing errors are, and they run up an edit distance fast:
       * "tomroorw" is four substitutions away from "tomorrow" but an exact anagram of it. Same length, same
       * first letter, same letters in any order — for a word this long that is a typo and nothing else.
       */
      if (tok.length === word.length && tok.length >= 5 && tok[0] === word[0] && sorted(tok) === wordSorted) return true;
      if (Math.abs(tok.length - word.length) > max) continue;
      // Levenshtein, small strings only, so the straightforward table is the right shape.
      const prev = Array.from({ length: word.length + 1 }, (_, i) => i);
      for (let i = 1; i <= tok.length; i += 1) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= word.length; j += 1) {
          const tmp = prev[j];
          prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (tok[i - 1] === word[j - 1] ? 0 : 1));
          diag = tmp;
        }
      }
      if (prev[word.length] <= max) return true;
    }
    return false;
  };

  // When.
  const when: Intent["when"] = /\btonight\b/.test(t)
    ? "tonight"
    : near("tomorrow")
      ? "tomorrow"
      : /\btoday\b|\bright now\b|\bthis (?:afternoon|evening|morning)\b/.test(t)
        ? "today"
        : near("weekend") || /\bsaturday\b|\bsunday\b/.test(t)
          ? "weekend"
          : "any";

  /**
   * Where, as a point rather than a word. "escape room in waterloo" used to match on city = 'Waterloo' and
   * find nothing, because the twelve escape rooms a Waterloo student would go to are filed under Kitchener and
   * Cambridge. A place name is turned into a coordinate, taken from the middle of the operators we already
   * hold there, and everything after that is measured in kilometres.
   *
   * Provinces and states are not cities: "skydiving in ontario" was matching a town called Ontario. They are
   * recognised separately and searched as a whole region.
   */
  let city: string | null = null;
  let region: string | null = null;
  let point: { lat: number; lon: number } | null = null;

  /**
   * Every state and province, not the two dozen somebody typed out first. The list was partial, which is only
   * a cosmetic gap until the agent needs to hand a guest a disambiguating choice: offering "Waterloo, IA" and
   * then not recognising Iowa when they tap it puts the same question on the screen forever.
   *
   * Longest name first so "new york" is not eaten by "york", and codes are read too, but only when they stand
   * alone in capitals or after a comma: a bare "in" is Indiana far less often than it is the word "in".
   */
  const found = matchRegion(text);
  if (found) region = found;

  /**
   * A province is not a town of the same name. "skydiving in ontario" found Ontario, California, and offered a
   * dropzone in Perris to somebody standing in Waterloo. The guard for that used to skip the town lookup
   * altogether whenever a region was named, which threw away the town in the way people actually write an
   * address: "escape room in kitchener ontario" searched the whole province by review count and answered with
   * Toronto, a hundred kilometres away. The town is read either way now; naming the region says which of the
   * towns of that name was meant, so Ontario, California, is still not an answer to a question about Ontario.
   */
  const regionWord = region ? REGION_NAMES[region]?.toLowerCase() ?? null : null;

  /**
   * Every match, not the biggest one. There are eleven Waterloos in this catalog and the old query took the
   * one with the most businesses, so "escape room in waterloo" answered Ontario to everybody, including the
   * fifty-five operators' worth of guests in Waterloo, Iowa. Which one they meant is not guessable from the
   * sentence, so the whole list comes back and the planner asks.
   */
  const allPlaces = (
    db
      .prepare(
        `SELECT city, region, COUNT(*) AS n, AVG(lat) AS lat, AVG(lon) AS lon FROM operators
          WHERE city IS NOT NULL AND length(city) >= 4 AND lat IS NOT NULL AND instr(?, lower(city)) > 0
          GROUP BY lower(city), region HAVING n >= 3 ORDER BY n DESC LIMIT 20`,
      )
      .all(t) as PlaceMatch[]
  ).filter((r) => wordIn(t, r.city));

  /**
   * A province is not a town of the same name, but it is also not a reason to forget the town. Dropping the
   * city lookup whenever a region was named fixed "skydiving in ontario" and broke "escape room in Waterloo,
   * Iowa", which then searched the whole state and put a result three hundred kilometres away at the top.
   * So only the town that *is* the region word is discarded, and when a region was named the towns are
   * narrowed to it: "Waterloo, Iowa" is one place, not eleven.
   */
  const placeRows = allPlaces
    .filter((r) => !(regionWord && r.city.toLowerCase() === regionWord))
    .filter((r) => !region || r.region === region);

  // When the sentence names several places, the one with the most businesses is the one it is about.
  const bestName = placeRows.length ? placeRows[0].city.toLowerCase() : null;
  const sameName = placeRows.filter((r) => r.city.toLowerCase() === bestName);

  /**
   * When the device knows where they are, the nearest town of that name is the one they meant.
   *
   * There are eleven Waterloos in this catalog. Taking the biggest is right about half the time and asking
   * costs a turn; somebody standing at 42.49, -92.34 who types "waterloo" means Iowa, and knowing that beats
   * both. Only towns already matched by name are considered, so this narrows an answer and can never invent
   * a different place.
   */
  const placeRow =
    device && sameName.length > 1
      ? [...sameName].sort((a, b) => {
          const kx = Math.cos((device.lat * Math.PI) / 180);
          const d = (r: PlaceMatch) => (r.lat - device.lat) ** 2 + ((r.lon - device.lon) * kx) ** 2;
          return d(a) - d(b);
        })[0]
      : sameName[0];

  if (placeRow) {
    city = placeRow.city;
    region = region || placeRow.region;
    point = { lat: placeRow.lat, lon: placeRow.lon };
  } else if (device) {
    /**
     * Nowhere was named, and the device knows where they are.
     *
     * "Near me" is the easiest question in the product and used to be among the hardest: the word "me" is not
     * a town, so the agent asked a guest where they were while holding their coordinates. The nearest town we
     * hold businesses for is named back to them in the answer, so a wrong guess costs one tap to correct, and
     * the search itself is centred on their actual position rather than that town's middle, because "near me"
     * ought to mean near them.
     */
    const spot = db
      .prepare(
        `SELECT city, region, COUNT(*) AS n, AVG(lat) AS lat, AVG(lon) AS lon FROM operators
          WHERE city IS NOT NULL AND lat IS NOT NULL AND abs(lat - ?) < 1.2 AND abs(lon - ?) < 1.8
          GROUP BY lower(city), region HAVING n >= 3
          /*
           * The town a person would name, not whichever centroid is nearest. Strict distance answered "East
           * York" for Toronto, "Dartmouth" for Halifax and "Coconut Grove" for Miami: a small suburb's middle
           * is often closer than a big city's. Dividing distance by the number of businesses lets a
           * substantially larger place a little further off win, which is how somebody would answer if asked
           * where they were.
           */
          ORDER BY ((AVG(lat) - ?) * (AVG(lat) - ?) + (AVG(lon) - ?) * (AVG(lon) - ?)) / (n * n) ASC LIMIT 1`,
      )
      .get(device.lat, device.lon, device.lat, device.lat, device.lon, device.lon) as PlaceMatch | undefined;
    if (spot) {
      city = spot.city;
      region = spot.region;
      point = { lat: device.lat, lon: device.lon };
    }
  } else {
    const metro = METROS.find((x) => wordIn(t, x.name.toLowerCase()) && (!region || x.region === region));
    if (metro) {
      city = metro.name;
      region = metro.region;
      point = { lat: metro.lat, lon: metro.lon };
    }
  }

  /**
   * What. `inferCategory` answers "jetski" when nothing matched, so a miss is indistinguishable from a hit
   * unless the words are checked first, and its patterns are the root words: "skydive", not "skydiving". A
   * guest typing "skydiving in ontario" was getting jet skis, then having them thrown away as a false positive,
   * and ending up with escape rooms. The sentence is tried as typed and with English's endings taken off.
   */
  const deInged = t
    .split(/\s+/)
    .map((w) => (w.length > 6 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 5 && w.endsWith("ing") ? w.slice(0, -3) + "e" : w))
    .join(" ");
  const forms = [t, deInged, t.replace(/\bskydiving\b/g, "skydive").replace(/\bziplining\b/g, "zipline")];
  let categoryId: string | null = null;
  let categoryLabel: string | null = null;
  for (const form of forms) {
    const c = inferCategory(form);
    // "jetski" is the fallback, so only believe it when the sentence really says so.
    if (c.id === "jetski" && !/jet ?ski|wave ?runner|\bpwc\b/.test(form)) continue;
    categoryId = c.id;
    categoryLabel = c.label;
    break;
  }

  /**
   * What this sentence said wins; what it did not mention is carried forward from the conversation so far. A
   * guest who says "escape room tonight", is asked where, and answers "waterloo" has not stopped wanting an
   * escape room tonight, and a guest who then says "make it four of us" has not stopped wanting Waterloo.
   *
   * Said-or-not is the test, never truthiness: party defaults to two, so a prior party of six would be
   * overwritten by every later sentence that happens not to count heads.
   */
  const saidParty = !!m || /\b(me and my|my partner and i|just us two|date night)\b/.test(t);
  const saidWhen = when !== "any";
  const saidPlace = !!(city || region);
  const assumed: string[] = [];

  const merged: Intent = {
    text,
    categoryId: categoryId ?? (instead && genre ? null : prior?.categoryId ?? null),
    categoryLabel: categoryId ? categoryLabel : (instead && genre ? null : prior?.categoryLabel ?? null),
    city: saidPlace ? city : (prior?.city ?? null),
    region: saidPlace ? region : (prior?.region ?? null),
    point: saidPlace ? point : (prior?.point ?? null),
    party: saidParty ? party : (prior?.party ?? 2),
    when: saidWhen ? when : (prior?.when ?? "any"),
    maxPerPerson: maxPerPerson ?? prior?.maxPerPerson ?? null,
    maxTotal: maxTotal ?? prior?.maxTotal ?? null,
    cover: cover ?? prior?.cover ?? null,
    atMinute: atMinute ?? prior?.atMinute ?? null,
    genre: genre ?? prior?.genre ?? null,
    /** The device position rides along, so a later turn can still settle "near me" or which Waterloo. */
    near: device ?? prior?.near ?? null,
    refine,
    lastCheapest: prior?.lastCheapest ?? null,
    asked: [...new Set([...(prior?.asked || []), ...(noBudget ? ["budget"] : [])])],
    seen: categoryId && prior?.categoryId && categoryId !== prior.categoryId ? [] : prior?.seen ? [...prior.seen] : [],
    places: saidPlace ? placeRows.filter((r) => r.city.toLowerCase() === bestName) : prior?.places,
  };

  // Said out loud rather than quietly applied, because a wrong guess a guest cannot see is a wrong answer.
  if (!saidParty && !prior?.party) assumed.push("two of you");
  if (!saidWhen && atMinute == null && (!prior || prior.when === "any")) assumed.push("any time in the next fortnight");
  merged.assumed = assumed;
  return merged;
}

/**
 * The one question worth asking about a place name.
 *
 * Eleven towns in this catalog are called Waterloo. Picking the biggest is right about half the time and
 * silently wrong the rest, and being silently wrong about *where* sends a guest a list of businesses a
 * thousand kilometres away with real prices next to them, which reads as confidence. Anything with a real
 * second contender is worth one question; a 105-to-3 split is not, so it is not asked about.
 */
export function placeAmbiguity(intent: Intent): PlaceMatch[] | null {
  const rows = intent.places || [];
  if (rows.length < 2) return null;
  const [top, second] = rows;
  if (second.n < 3 || second.n < top.n * 0.2) return null;
  return rows.filter((r) => r.n >= 3 && r.n >= top.n * 0.2).slice(0, 4);
}

export type Option = {
  name: string;
  domain: string;
  city: string | null;
  region: string | null;
  rating: number | null;
  reviews: number | null;
  category: string;
  bookingUrl: string;
  /** Empty until the shop's own system has been asked. */
  departures: Departure[];
  route: "feed" | "agent" | "phone";
  phone: string | null;
  /** True when nothing was free when they asked and these times are from a wider search. */
  widened?: boolean;
  /** Where the times came from, said plainly, because "their calendar" is the claim this product makes. */
  via?: string;
  /**
   * How far each offered departure sits from the time they asked for, in minutes, signed: -30 is half an hour
   * earlier. Parallel to `departures`. Empty when they named no time.
   */
  offsets?: number[];
  /**
   * What this shop sells and what it charges, from our own catalog, read off their site by the crawl. This is
   * the answer when their booking system has no feed to read: a guest asking for an escape room in Waterloo
   * should be told "Adventure Rooms, $28 a head" and that we will confirm the time, not shown a blank screen
   * because the shop happens to run Checkfront.
   */
  services: { name: string; price: number | null; unit: string | null; per: "person" | "group" }[];
};

/**
 * The least a thing can plausibly cost, by activity. A line below this is nearly always a fragment of a page
 * rather than a price. Set low enough that a genuinely cheap shop still gets through.
 */
const FLOOR_CENTS: Record<string, number> = {
  jetski: 4000, pontoon: 5000, cruise: 2000, fishing: 4000, sailing: 3000, rafting: 2000, scuba: 3000,
  heli: 5000, balloon: 10000, skydive: 10000, parasail: 4000, gliding: 5000, paragliding: 5000,
  kart: 1500, paintball: 1500, escape: 1500, axe: 1500, lasertag: 1000, climbing: 1000,
  bowling: 800, trampoline: 1000, minigolf: 700, arcade: 500, karaoke: 1000, rage: 1500,
  spa: 3000, sauna: 1500, cooking: 3000, horse: 3000, zipline: 3000, snowmobile: 5000,
  winery: 1000, distillery: 1000, kayak: 1500, paddleboard: 1500, bike: 1000,
};

/**
 * What the crawl read off this shop's own site: the menu a guest would see there.
 *
 * Filtered to the activity this row is about, because plenty of these businesses sell several. Bingemans in
 * Kitchener runs an escape room, an axe range, a waterpark and a campsite off one website, so the escape room
 * was being answered with "Axe Throwing, $99" and a canoe camp. Quoting one activity's price against another's
 * name is the same error as quoting a child fare as the headline: the number is real and the guest still
 * cannot buy what they were shown.
 */
function servicesFor(domain: string, categoryId?: string | null): Option["services"] {
  return db
    .prepare(
      `SELECT x.name, x.price_cents AS cents, x.price_unit AS unit
         FROM offerings x JOIN operators o ON o.id = x.operator_id
        WHERE o.domain = ? AND x.name IS NOT NULL
        ORDER BY (x.price_cents IS NULL), x.price_cents ASC LIMIT 24`,
    )
    .all(domain)
    .filter((r) => {
      /**
       * The cheapest row is often not the one a guest can buy. Shops list school rates, corporate days, gift
       * cards and private hire in the same menu, so "escape room in Waterloo" was answered with "School Trip
       * 24-50 students, $25 each" and a $250 private room quoted as a per-person price. None of those is what
       * somebody asking for a night out can turn up and buy.
       */
      const n = (r as { name: string }).name.toLowerCase();
      if (/school|student|corporate|team building|fundraiser|group of \d|\d{2,}\s*(?:students|people|guests)|gift (?:card|certificate)|voucher|membership|season pass|party package|waiver|deposit/.test(n)) return false;
      /**
       * Merchandise, fuel and paperwork are not the activity. A go-kart track sells headsocks at $4, a
       * charter sells a fishing log at $18 and a heliport sells avgas by the litre, and because the cheapest
       * line wins the headline those were the numbers on the screen: "Go-karting near you, from $4".
       */
      if (/\b(headsock|balaclava|sock|t-?shirt|hoodie|cap|hat|mug|sticker|keyring|key ?chain|poster|book|notebook|log ?book|dvd|photo ?print|magnet|patch|pin|towel|water bottle|snack|drink|soda|beer|merch|souvenir|fuel|avgas|petrol|diesel|parking|locker|insurance|damage waiver|glove|helmet rental|shoe rental|sock rental)\b/.test(n)) return false;
      /** Slips, berths, memberships and storage are a year of something, not an afternoon out. */
      if (/\b(annual|monthly|yearly|season|slip|berth|mooring|storage|dock (?:rental|fee)|per (?:month|year))\b/.test(n)) return false;
      // A line that is a sentence, or a nav label, is not a service.
      if (n.length > 60 || /^check out|^see |^click |^more |^other /.test(n)) return false;
      /**
       * A menu line that plainly names a different activity belongs to a different activity. Only a confident
       * read counts: `inferCategory` falls back to jet skis when nothing matched, so an unrecognised line like
       * "The Vault" is kept rather than thrown away for looking like nothing.
       */
      if (categoryId) {
        const guess = inferCategory(n);
        const confident = guess.id !== "jetski" || /jet ?ski|wave ?runner/.test(n);
        if (confident && guess.id !== categoryId) return false;
        /**
         * `inferCategory` only knows the sixty-four things we sell, so a multi-activity venue's other lines
         * slip through whenever they are named for something not in that list. Escape Manor sells darts, and
         * "Darts Reimagined, $10" was the single cheapest line on their menu, so a guest asking for a puzzle
         * and then for something cheaper was answered with one darts ticket and nothing else.
         */
        const OTHER = /\bdarts?\b|\bkaraoke\b|\bbowling\b|\bbilliards?\b|\bpool table\b|\bshuffleboard\b|\barcade\b|\bping ?pong\b|\bfoosball\b|\bgolf\b|\bcamping\b|\bcabana\b|\bcanoe\b|\bmassage\b|\bspa\b|\bsauna\b/i;
        if (OTHER.test(n) && !OTHER.test(categoryId)) {
          const label = (CATEGORIES.find((c) => c.id === categoryId)?.label || "").toLowerCase();
          // Unless it really is what this shop does: a bowling alley's "bowling" line must survive.
          if (!OTHER.test(label)) return false;
        }
      }
      const cents = (r as { cents: number | null }).cents;
      // Per head, a local activity is a few dollars to a few hundred. Anything past that is private hire.
      if (cents != null && (cents < 300 || cents > 40000)) return false;
      /**
       * And a floor per activity, because that general one is far too low to catch the real accidents. The
       * grader found "$4.50 Open Bowling" and "$3.00 Pontoon Boat 26 feet - 12pp/115Hp" offered as the price
       * of an evening: the first is one game on a weekday afternoon, the second was never a price at all.
       * Both clear 300 cents comfortably, and one absurd number makes the real ones beside it look invented.
       */
      if (cents != null && categoryId && FLOOR_CENTS[categoryId] != null && cents < FLOOR_CENTS[categoryId]) return false;
      return true;
    })
    .slice(0, 4)
    .map((r) => {
      const row = r as { name: string; cents: number | null; unit: string | null };
      const price = row.cents == null ? null : Math.round(row.cents) / 100;
      return { name: row.name, price, unit: row.unit, per: pricedPer(price, row.unit, categoryId, row.name) };
    });
}

/**
 * Whether a menu price is what one person pays or what the whole group pays.
 *
 * "Escape Rooms, $250" is not a $250 ticket. It is a private room for a team, and quoting it as a per-head
 * price put "$32 to $250 a head" on the screen for Kitchener, where the real spread is $32 to $37 and the
 * $250 is a different kind of thing entirely. That one row made the comparison — the line this product
 * exists for — read as nonsense.
 *
 * Two tells, in order of how much they can be trusted. The unit, when the crawl caught one: "/group",
 * "/room", "/boat" and "/trip" say it outright. Otherwise the price against what that activity normally
 * costs: an escape room's median is $38 across 571 offerings, so $250 is not somebody's expensive ticket, it
 * is the room. The threshold is a multiple of the category's own median rather than a fixed number, because
 * a $300 tandem skydive is an ordinary ticket and a $300 bowling lane is not.
 */
/** Names that describe hiring a thing rather than buying a seat in it. */
const GROUP_NAME = /\b(?:party room|private (?:room|hire|booking|event|session)|whole (?:room|venue|boat|lane)|room (?:rental|booking|hire)|venue (?:rental|hire)|lane (?:rental|hire)|buy ?out|buyout|exclusive use|per (?:group|room|boat|lane|table|court))\b/i;

function pricedPer(price: number | null, unit: string | null, categoryId?: string | null, name?: string | null): "person" | "group" {
  if (unit && /group|room|boat|trip|jet ?ski|vehicle|cabin|lane|table|court|party/i.test(unit)) return "group";
  /**
   * The unit is "each" on almost everything the crawl reads, so the name has to carry the weight. "Party Room
   * Booking, $100" was shown as "$100 per person" for a karaoke bar, which is four hundred dollars of error
   * for a group of four and exactly the sort of number that makes a guest stop believing the rest of the
   * screen.
   */
  if (name && GROUP_NAME.test(name)) return "group";
  if (price == null || !categoryId) return "person";
  const med = categoryMedian(categoryId);
  return med != null && price > med * 4 ? "group" : "person";
}

/**
 * The middle price of an activity, across every operator we hold. Computed once per process from the same
 * table the menus come from, so it moves with the catalog rather than with a number somebody typed in 2026.
 */
const MEDIANS = new Map<string, number | null>();
function categoryMedian(categoryId: string): number | null {
  if (MEDIANS.has(categoryId)) return MEDIANS.get(categoryId)!;
  const rows = db
    .prepare(
      `SELECT x.price_cents AS c FROM offerings x JOIN operators o ON o.id = x.operator_id
        WHERE o.category_id = ? AND x.price_cents BETWEEN 300 AND 40000 ORDER BY c`,
    )
    .all(categoryId) as { c: number }[];
  // Too few to have a middle worth trusting; better no rule than a rule built on four numbers.
  const med = rows.length < 20 ? null : rows[Math.floor(rows.length / 2)].c / 100;
  MEDIANS.set(categoryId, med);
  return med;
}

/**
 * The shape of a night out, for people who know what sort of thing they want and not what it is called.
 *
 * "Something fun in Toronto" is not a category and never will be, but it is most of what people actually type.
 * Asking "escape room, axe throwing, karting or bowling?" against sixty-four categories is a menu, not a
 * question; asking "active, on the water, or puzzles?" is a question a person can answer in one tap. The
 * groups are coarse on purpose and each one resolves back to the categories underneath it.
 */
export const GENRES: { id: string; label: string; categories: string[] }[] = [
  { id: "active", label: "Something active", categories: ["climbing", "trampoline", "lasertag", "paintball", "axe", "kart", "bowling", "rage", "martialarts", "gymnastics", "fitness", "tennis", "discgolf", "golf", "minigolf", "archery", "range", "bike", "swim", "motorsport"] },
  { id: "water", label: "On the water", categories: ["jetski", "kayak", "paddleboard", "pontoon", "fishing", "cruise", "sailing", "rafting", "surf", "scuba", "parasail", "waterpark"] },
  { id: "air", label: "In the air", categories: ["skydive", "heli", "balloon", "paragliding", "gliding", "zipline"] },
  { id: "puzzles", label: "Puzzles and games", categories: ["escape", "arcade", "billiards", "karaoke"] },
  { id: "food", label: "Food and drink", categories: ["brewery", "winery", "distillery", "cooking"] },
  { id: "calm", label: "Something calmer", categories: ["spa", "sauna", "yoga", "pottery", "garden", "museum", "theatre", "aquarium", "zoo", "dance", "tour"] },
  { id: "outdoors", label: "Outdoors", categories: ["horse", "ski", "snowmobile", "camping", "themepark", "zoo"] },
];

const GENRE_BY_ID = new Map(GENRES.map((g) => [g.id, g]));

/** A genre named outright, so "something on the water near Toronto" does not have to be asked about. */
function readGenre(t: string): string | null {
  if (/\bon the water|water ?sports?|boating\b/.test(t)) return "water";
  if (/\bin the air|flying|aerial\b/.test(t)) return "air";
  if (/\bpuzzle|brain|games?\b/.test(t)) return "puzzles";
  if (/\bfood|drinks?|dinner|tasting|brewery|eat\b/.test(t)) return "food";
  if (/\bcalm|relax|chill|quiet|low key|lowkey\b/.test(t)) return "calm";
  if (/\bactive|sporty|adrenaline|competitive\b/.test(t)) return "active";
  return null;
}

/**
 * Which genres actually have businesses near this point, biggest first.
 *
 * Offered rather than listed: a guest in Halifax should not be asked about skydiving when the nearest dropzone
 * is four hours away. The counts come from the same radius the search itself will use, so every option on the
 * screen is one that leads somewhere.
 */
export function genresNear(point: { lat: number; lon: number } | null, region: string | null, radiusKm = 40, cover: "indoor" | "outdoor" | null = null): { id: string; label: string; n: number }[] {
  const where: string[] = ["o.origin != 'demo'", "o.category_id IS NOT NULL"];
  const args: (string | number)[] = [];
  if (point) {
    const kx = Math.cos((point.lat * Math.PI) / 180);
    const deg = radiusKm / 111;
    where.push("o.lat IS NOT NULL AND abs(o.lat - ?) < ? AND abs(o.lon - ?) < ?");
    args.push(point.lat, deg, point.lon, deg / Math.max(kx, 0.2));
  } else if (region) {
    where.push("o.region = ?");
    args.push(region);
  }
  const rows = db
    .prepare(`SELECT o.category_id AS c, COUNT(*) AS n FROM operators o WHERE ${where.join(" AND ")} GROUP BY o.category_id`)
    .all(...args) as { c: string; n: number }[];
  const byCat = new Map(rows.map((r) => [r.c, r.n]));
  /**
   * A guest whose plan was rained out must not be offered "Outdoors". The roof they asked for narrows the
   * categories inside each genre as well as which genres are worth showing at all, so the counts stay true to
   * what they would actually get if they tapped it.
   */
  const allowed = cover === "indoor" ? new Set(INDOOR) : cover === "outdoor" ? new Set(OUTDOOR) : null;
  return GENRES.map((g) => {
    const cats = allowed ? g.categories.filter((c) => allowed.has(c)) : g.categories;
    return { id: g.id, label: g.label, n: cats.reduce((sum, c) => sum + (byCat.get(c) || 0), 0) };
  })
    .filter((g) => g.n >= 2)
    .sort((a, b) => b.n - a.n);
}

/**
 * Which activities have a roof over them.
 *
 * Read off the activity rather than the `family` column: that column sorts 423,000 businesses into wellness,
 * outdoor, play, food, water, motorsport, indoor and air, which is a useful shape for rails and a useless one
 * for "it is raining" — escape rooms, bowling and arcades are all filed under play, alongside minigolf.
 * A category either has a roof or it does not, and the ones that genuinely go both ways are in neither list,
 * so they are offered whichever way the question was asked rather than claimed for one.
 */
const INDOOR = [
  "escape", "bowling", "arcade", "trampoline", "lasertag", "climbing", "billiards", "karaoke", "spa", "sauna",
  "pottery", "cooking", "museum", "theatre", "aquarium", "icerink", "rage", "martialarts", "gymnastics",
  "fitness", "dance", "yoga", "waterpark", "brewery", "winery", "distillery", "range", "axe",
];
const OUTDOOR = [
  "jetski", "kayak", "paddleboard", "pontoon", "fishing", "cruise", "skydive", "heli", "balloon", "parasail",
  "horse", "zipline", "ski", "rafting", "surf", "scuba", "sailing", "camping", "garden", "discgolf", "golf",
  "paragliding", "gliding", "bike", "snowmobile", "zoo", "themepark", "minigolf", "tennis", "paintball",
];

/**
 * Whether a booking link really belongs to the business it is filed under.
 *
 * Sixteen per cent of the booking links in this catalog point at a host that is not the operator's own: 1,820
 * of 11,046. Most are harmless — Viator, Boatsetter and GoTab genuinely take these shops' bookings — but the
 * crawl also picked up a LinkedIn page, an MLB fixture list, and, for BreakOut Escapes in Cambridge, a rival
 * axe-throwing company's home page. A guest who taps "book this" and lands on a competitor is the worst thing
 * this product can do, so a link is dropped when it is plainly not a way to book this business.
 *
 * Two rules, both conservative, because dropping a real link costs a booking:
 *   - hosts that never take bookings at all: social networks, search, maps, review sites, news;
 *   - any host that is another operator's own domain in this catalog, which is a crawl that wandered.
 * Everything else is kept, including vendors and resellers we have never heard of.
 */
const NEVER_BOOKING = /^(?:www\.)?(?:linkedin|facebook|instagram|twitter|x|youtube|tiktok|pinterest|reddit|yelp|tripadvisor|mlb|nfl|nba|espn|wikipedia|google|bing|maps\.google)\.[a-z.]{2,7}$/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Domains in this catalog, so a link into a different operator's site can be recognised as one. */
let OTHER_DOMAINS: Set<string> | null = null;
function isAnotherOperator(host: string, ownDomain: string): boolean {
  if (!OTHER_DOMAINS) {
    OTHER_DOMAINS = new Set(
      (db.prepare("SELECT domain FROM operators WHERE domain NOT LIKE 'osm-%'").all() as { domain: string }[])
        .map((r) => r.domain.split("/")[0].replace(/^www\./, "").toLowerCase()),
    );
  }
  const own = ownDomain.split("/")[0].replace(/^www\./, "").toLowerCase();
  return host !== own && OTHER_DOMAINS.has(host);
}

/**
 * The booking vendors themselves, allowed before anything else is considered.
 *
 * Two rows in this catalog are keyed by a vendor's own domain rather than a shop's — "Schooner Adventure" is
 * filed under `fareharbor.com` and "Trapped Guelph" under `bookeo.com`, which is a crawl that followed the
 * widget instead of the site. That is a catalog bug of its own, and it very nearly became a much bigger one:
 * checking "is this host another operator" first made every FareHarbor link in the product look like a link to
 * a rival, and silently turned off live availability everywhere.
 */
const BOOKING_HOSTS = /(?:^|\.)(?:fareharbor|peek|xola|checkfront|bookeo|resova|rezdy|acuityscheduling|squareup|square|setmore|calendly|mindbodyonline|tripworks|bookwhen|eventbrite|regiondo|roller|zaui|simplybook|viator|getyourguide|boatsetter|gotab|opentable|resy|exploretock|hostedbookings|foreupsoftware)\.[a-z.]{2,7}$/i;

export function usableBookingUrl(url: string | null, ownDomain: string): string {
  if (!url) return "";
  const host = hostOf(url);
  if (!host) return "";
  if (BOOKING_HOSTS.test(host)) return url;
  if (NEVER_BOOKING.test(host)) return "";
  if (isAnotherOperator(host, ownDomain)) return "";
  return url;
}

/** The shortlist: businesses that match, best reviewed first, the ones we can quote times for first of all. */
export function candidates(intent: Intent, limit = 8, radiusKm = 40): Option[] {
  const where: string[] = ["o.origin != 'demo'", "o.name IS NOT NULL"];
  const args: (string | number)[] = [];
  if (intent.categoryId) {
    where.push("o.category_id = ?");
    args.push(intent.categoryId);
  } else if (intent.genre && GENRE_BY_ID.has(intent.genre)) {
    const roof = intent.cover === "indoor" ? new Set(INDOOR) : intent.cover === "outdoor" ? new Set(OUTDOOR) : null;
    const all = GENRE_BY_ID.get(intent.genre)!.categories;
    const ids = (roof ? all.filter((c) => roof.has(c)) : all);
    if (ids.length) {
      where.push("o.category_id IN (" + ids.map(() => "?").join(",") + ")");
      args.push(...ids);
    }
  } else if (intent.cover) {
    /**
     * Only when no activity was named. "indoor skydiving" is a real thing and a guest who asked for skydiving
     * has already said what they want; the roof question is for "our plan got rained out, what else is there".
     */
    const ids = intent.cover === "indoor" ? INDOOR : OUTDOOR;
    where.push("o.category_id IN (" + ids.map(() => "?").join(",") + ")");
    args.push(...ids);
  }
  /**
   * A degree of latitude is 111 km everywhere; a degree of longitude shrinks with the cosine of the latitude.
   * Comparing squared degrees with longitude scaled that way orders by real distance without a trig function
   * per row, which matters when the table has 418,000 of them.
   */
  let order = "o.review_count DESC NULLS LAST, o.rating DESC NULLS LAST";
  if (intent.point) {
    const { lat, lon } = intent.point;
    const kx = Math.cos((lat * Math.PI) / 180);
    const deg = radiusKm / 111;
    where.push("o.lat IS NOT NULL AND abs(o.lat - ?) < ? AND abs(o.lon - ?) < ?");
    args.push(lat, deg, lon, deg / Math.max(kx, 0.2));
    order = `((o.lat - ${lat}) * (o.lat - ${lat}) + (o.lon - ${lon}) * (o.lon - ${lon}) * ${(kx * kx).toFixed(4)}) ASC, o.review_count DESC NULLS LAST`;
  } else if (intent.region) {
    where.push("o.region = ?");
    args.push(intent.region);
  }

  /**
   * "Show me something else" means something else — on that turn, and only that turn.
   *
   * This excluded everything ever shown, on every subsequent turn, so `seen` grew 8, 13, 17 and the good
   * shops were banned forever. A guest who asked for escape rooms in Waterloo, then "any other places", then
   * "times between 3 and 5" got Escapology on the first answer and then never again: by the third turn the
   * only businesses left were the ones nobody had bothered to show, in Hamilton and Guelph, none of them
   * priced. The list has to keep accumulating, because a second "something else" must skip the first one's
   * answers too, but it may only bite when something else is what was actually asked for.
   */
  if (intent.refine === "other" && intent.seen?.length) {
    where.push("o.domain NOT IN (" + intent.seen.map(() => "?").join(",") + ")");
    args.push(...intent.seen);
  }

  const rows = db
    .prepare(
      `SELECT o.name, o.domain, o.city, o.region, o.rating, o.review_count, o.category_id, o.phone,
              (SELECT f.fact_value FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'booking_url'
                ORDER BY (${unreadableSql("f.fact_value")}) LIMIT 1) AS booking
         FROM operators o
        WHERE ${where.join(" AND ")}
        /*
         * A shop we can say a price for beats one we cannot.
         *
         * The order was: has a booking link, has a readable feed, then nearest. Nothing in it knew whether we
         * could quote a number, so "any other places near Waterloo" answered with five shops and not one
         * price between them, while priced businesses a few kilometres further out went unmentioned. A guest
         * cannot do anything with a list of names. Distance still decides between two shops we can both
         * quote, which is what it is good for.
         */
        ORDER BY (booking IS NULL),
                 (${unreadableSql("booking")}),
                 (NOT EXISTS (SELECT 1 FROM offerings x WHERE x.operator_id = o.id AND x.price_cents IS NOT NULL)),
                 ${order}
        LIMIT ?`,
    )
    .all(...args, limit) as {
    name: string; domain: string; city: string | null; region: string | null; rating: number | null;
    review_count: number | null; category_id: string; phone: string | null; booking: string | null;
  }[];

  return rows.map((r) => {
    const booking = usableBookingUrl(r.booking, r.domain);
    return {
      name: r.name,
      domain: r.domain,
      city: r.city,
      region: r.region,
      rating: r.rating,
      reviews: r.review_count,
      category: r.category_id,
      bookingUrl: booking,
      departures: [],
      services: servicesFor(r.domain, r.category_id),
      // Without a link we can use, this one is a phone call, whatever the crawl thought it had found.
      route: booking ? (isReadable(booking) ? "feed" : "agent") : r.phone ? "phone" : "agent",
      phone: r.phone,
    };
  });
}

/** The date a guest means. "tonight" is today; "weekend" is the next Saturday. */
export function windowFor(when: Intent["when"], now = new Date()): { from: Date; days: number } {
  if (when === "tomorrow") return { from: new Date(now.getTime() + 86400_000), days: 1 };
  if (when === "today" || when === "tonight") return { from: now, days: 1 };
  if (when === "weekend") {
    /**
     * Sunday is the weekend. Walking forward to the next Saturday from a Sunday morning skipped the day the
     * guest was standing in and answered with next week, six days out, without saying so.
     */
    if (now.getDay() === 0) return { from: now, days: 1 };
    const d = new Date(now);
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
    return { from: d, days: 2 };
  }
  return { from: now, days: 14 };
}

/**
 * The whole answer: read the sentence, shortlist the catalog, then ask the shops themselves. Only the ones with
 * a feed are asked here, because a browser agent takes half a minute a shop and a guest is waiting.
 */
export type FollowUp = {
  question: string;
  /**
   * The answers, ready to tap. A question with no answers attached is a form field: the guest has to work out
   * what shape of reply will be understood. Each choice carries the sentence it would send, so tapping one is
   * the same as typing it and goes through the same reader.
   */
  choices: { label: string; text: string }[];
  /** `place`, `activity`, `nothing`: why it had to ask, for the panel and for measuring which questions recur. */
  why: string;
};

export type Answer = {
  intent: Intent;
  options: Option[];
  /** A question to ask back, when the sentence did not carry enough to search on. */
  followUp: FollowUp | null;
  /** What it guessed because nobody said: "two of you", "any time in the next fortnight". */
  assumptions: string[];
  /**
   * Ways to narrow, offered beside an answer rather than instead of one.
   *
   * A question costs the guest a turn; a shortlist they can push back on costs nothing. "Help me plan a team
   * offsite with a $500 budget and 10 people for Monday between 5-7pm near me" carries party, budget, day,
   * time and place, and it was coming back as four chips and no businesses, because no single activity had
   * been named. That reads as the product not listening, and it was right to read it that way.
   */
  narrow: FollowUp | null;
  /** Said out loud when the search had to be loosened: a wider area, or any activity rather than the one named. */
  loosened: string | null;
  /** Cheapest and dearest of what was found, because comparing is the thing a search engine cannot do for you. */
  compare: { cheapest: number; dearest: number; count: number } | null;
};

/** The lowest price we can quote for an option, live or from its published menu. */
export function priceOf(o: Option): number | null {
  const live = o.departures.map((d) => d.fromPrice).filter((n): n is number => n != null);
  // Per head only. A whole-room price is a real number and comparing it with a ticket is comparing nothing.
  const menu = o.services.filter((s) => s.per === "person").map((s) => s.price).filter((n): n is number => n != null);
  const all = [...live, ...menu];
  return all.length ? Math.min(...all) : null;
}

/**
 * The whole answer, and the ways of not having one.
 *
 * A person asking a friend does not get silence when the friend has not understood: they get a question back,
 * or a near miss offered with an apology. So this either asks for the one thing it is missing, or it loosens
 * the search until it has something to show and says which rule it broke to get there.
 */
export async function plan(text: string, opts: { ask?: number; prior?: Intent | null; trace?: Trace; deadlineMs?: number; near?: { lat: number; lon: number } | null; resolve?: boolean; resolveMs?: number } = {}): Promise<Answer> {
  const tr = opts.trace ?? new Trace();
  const intent = readIntent(text, opts.prior, opts.near ?? opts.prior?.near ?? null);
  tr.step("read", [intent.categoryLabel || "anything", intent.city || intent.region || "anywhere", intent.party + " people", intent.when].join(" \u00b7 "),
    { detail: intent.maxPerPerson ? "under $" + intent.maxPerPerson + " a head" : undefined });
  if (opts.prior && (opts.prior.categoryId || opts.prior.city)) {
    tr.step("carry", "kept from earlier: " + [opts.prior.categoryLabel, opts.prior.city, opts.prior.when !== "any" ? opts.prior.when : null].filter(Boolean).join(", "));
  }
  for (const a of intent.assumed || []) tr.step("assume", a, { detail: "nobody said, so it is saying so" });

  const done = (a: Omit<Answer, "assumptions" | "narrow"> & { assumptions?: string[]; narrow?: FollowUp | null }): Answer => {
    const full = { ...a, narrow: a.narrow ?? null, assumptions: a.assumptions ?? intent.assumed ?? [] } as Answer;
    if (full.followUp) tr.step("question", full.followUp.question, { detail: full.followUp.why });
    return full;
  };

  /**
   * Place first, always, whether or not they said what they want.
   *
   * Nothing can be searched without it, and it is the only question whose answer changes every other one: the
   * genres worth offering and the prices worth asking about are both properties of a town. The old branch
   * asked "what sort of thing, and roughly where?" and offered three hard-coded Ontario examples, which for a
   * catalog spanning 52 states and provinces read as though the product only worked near Kitchener.
   */
  if (!intent.city && !intent.region) {
    /**
     * Asked with somewhere to point at. "Where are you?" with an empty box is the question a form asks; the
     * towns where this activity actually is are the ones worth offering, and they double as an answer to a
     * question nobody typed — "do you even have escape rooms near me" — before the guest has to find out
     * the hard way.
     */
    return done({
      intent, options: [], compare: null, loosened: null,
      followUp: {
        question: "Where are you? A town or city is enough.",
        why: "place",
        choices: busiestTowns(intent.categoryId).map((c) => ({
          label: c.city + ", " + c.region,
          text: text + " in " + c.city + " " + regionName(c.region),
        })),
      },
    });
  }

  /**
   * Which town of that name. Asked before anything is searched, because searching the wrong Waterloo and
   * asking afterwards wastes the guest's time and a dozen requests to businesses that were never relevant.
   */
  /**
   * A refinement acts on the answer they already have. Applied before anything is searched, because "anything
   * cheaper" has to change the search rather than be answered with the same list a second time.
   */
  if (intent.refine) {
    if (intent.refine === "other") {
      tr.step("refine", "something else: leaving out the " + (intent.seen?.length || 0) + " already shown", { detail: (intent.seen || []).join(", ") || undefined });
    } else if (intent.refine === "cheaper") {
      const was = intent.maxPerPerson;
      // No figure to halve means no budget was ever set; take the cheapest thing shown as the new ceiling.
      intent.maxPerPerson = was != null ? Math.max(5, Math.floor(was * 0.7)) : intent.lastCheapest != null ? Math.max(5, Math.floor(intent.lastCheapest)) : null;
      tr.step("refine", intent.maxPerPerson != null ? "cheaper: under $" + intent.maxPerPerson + " a head" : "cheaper: no figure to go on, sorting by price instead",
        { detail: was != null ? "was $" + was : "they never gave a budget" });
    } else if (intent.refine === "recheck") {
      intent.seen = [];
      tr.step("refine", "checking their calendars again", { detail: "nothing cached; the shops are asked afresh" });
    } else if (intent.refine === "earlier" || intent.refine === "later") {
      if (intent.atMinute != null) {
        intent.atMinute += intent.refine === "earlier" ? -90 : 90;
        tr.step("refine", intent.refine + ": now looking around " + String(Math.floor(intent.atMinute / 60)).padStart(2, "0") + ":" + String(intent.atMinute % 60).padStart(2, "0"));
      }
    }
  }

  /**
   * The narrowing questions, in the order that makes each one worth asking. Place first, because nothing can
   * be searched without it. Then what sort of thing, because "something fun in Toronto" spans five thousand
   * businesses and no ranking makes that a good answer. Then budget, and only when the prices nearby actually
   * spread far enough for the answer to change.
   *
   * At most one question per turn, and never the same one twice: `intent.asked` carries what has already been
   * put to them, so a guest who declines to name a budget is not asked again on the next sentence. Asking
   * twice is how a helpful question becomes a form.
   */
  const asked = new Set(intent.asked || []);
  /** Ways to narrow, filled in below and attached to the answer rather than returned instead of one. */
  let narrow: FollowUp | null = null;
  let loosened: string | null = null;

  /**
   * The one thing worth asking about THIS activity, offered beside the answer.
   *
   * A jet ski turns on how long and an escape room turns on how many, so one list of questions cannot serve
   * both: `needs.ts` holds what each activity actually depends on. It is offered, never gated, and asked once.
   */
  const need = intent.categoryId ? nextNeed(intent) : null;
  if (need) {
    intent.asked = [...asked, "need:" + need.id];
    tr.step("need", "a " + (intent.categoryLabel || "").toLowerCase() + " turns on " + need.id, { detail: "offered beside the answer, not in front of it" });
    narrow = {
      question: need.question,
      why: need.id,
      choices: need.choices.map((c) => ({ label: c.label, text: text + " " + c.add })),
    };
  }

  /**
   * The genres worth offering, built now and attached to the answer at the end rather than returned instead
   * of one. Nothing here stops the search.
   */
  if (!intent.categoryId && !intent.genre && !asked.has("genre")) {
    const genres = genresNear(intent.point, intent.region, 40, intent.cover);
    if (genres.length >= 2) {
      tr.step("narrow", "no activity named; answering broadly and offering " + genres.length + " ways to narrow", { detail: "a question costs a turn, a shortlist they can push back on costs none" });
      narrow = narrow ?? {
        question: "Want me to narrow it?",
        why: "genre",
        choices: genres.slice(0, 4).map((g) => ({ label: g.label, text: text + ", " + g.label.toLowerCase() })),
      };
    }
  }

  /**
   * More than one town of that name: answer for the likeliest and offer the others, rather than asking.
   *
   * This blocked, and at Hack the North — held in Waterloo, Ontario — eleven of sixteen things a person
   * standing at the venue would type came back as "There is more than one Waterloo. Which one?". Every one of
   * them meant the Waterloo they were standing in. Asking was the right instinct and the wrong shape: a place
   * we get wrong is recoverable in one tap, and a question in front of every local search is not.
   *
   * So the biggest one wins, it is said out loud, and the alternatives sit beside the answer as `narrow`. The
   * same rule as everywhere else: answer, then let them correct it.
   */
  /**
   * Said once, not on every turn. Naming the pick out loud ("Taking Waterloo, Ontario, there is more
   * than one") sat above every answer and read as the product talking to itself. The biggest still
   * wins; the other towns sit as chips if they want a different one.
   */
  const amb = asked.has("place-note") ? null : placeAmbiguity(intent);
  if (amb && amb.length > 1) {
    intent.asked = [...asked, "place-note"];
    const [chosen, ...others] = amb;
    tr.step("ambiguous", intent.city + " is " + amb.length + " places; taking " + chosen.region + " and offering the rest",
      { detail: amb.map((r) => r.region + " (" + r.n + ")").join(", ") });
    narrow = {
      question: "",
      why: "place",
      choices: others.map((r) => ({ label: r.city + ", " + r.region, text: text + " " + regionName(r.region) })),
    };
  }


  /**
   * The catalog's category is a guess too, and it is sometimes wrong about the one shop that matters.
   *
   * Parasail Toronto is filed under `cruise`. For months "parasailing in toronto" found it only because the
   * sentence reader had the same bug as the catalog and also said cruise; fixing the reader was right and it
   * immediately hid the only parasailing business in the city with a live feed, leaving one shop with nothing
   * bookable. So when a category shortlist comes back nearly empty, the shop's own name is asked as well:
   * a business called "Parasail Toronto" is a parasailing business whatever column it sits in.
   */

  if (intent.atMinute != null) {
    const hh = Math.floor(intent.atMinute / 60), mm = intent.atMinute % 60;
    tr.step("clock", "they want " + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0"), { detail: "times are ranked by how close they are to it" });
  }
  if (intent.cover) tr.step("cover", "under a roof only", { detail: intent.cover === "indoor" ? "they said indoors, or that it is raining" : "they said outdoors" });
  tr.step("catalog", "searching 40 km around " + (intent.city || intent.region), { detail: intent.categoryId || (intent.cover ? intent.cover + " activities" : "any activity") });
  let options = candidates(intent);
  if (intent.categoryId && options.length < 3 && intent.point) {
    const byName = namedLike(intent, 8 - options.length);
    const have = new Set(options.map((o) => o.domain));
    const extra = byName.filter((o) => !have.has(o.domain));
    if (extra.length) {
      tr.step("name", extra.length + " more found by their own name", { detail: "filed under another category, but named for what they do" });
      options = [...options, ...extra];
    }
  }
  tr.step("catalog", options.length + " businesses matched");

  // Nothing here: look further out before looking elsewhere, because people will travel for the right thing.
  if (!options.length && intent.point) {
    tr.step("loosen", "nothing within 40 km, trying 120");
    options = candidates(intent, 8, 120);
    if (options.length) loosened = "Nothing in " + (intent.city || "town") + " itself, so this is a wider search.";
  }
  // Still nothing: the activity is what is missing, not the place. Offer what the place does have.
  if (!options.length && intent.categoryId) {
    tr.step("loosen", "no " + (intent.categoryLabel || "").toLowerCase() + " at all, so: what else is near " + (intent.city || "them"));
    const anywhere: Intent = { ...intent, categoryId: null, categoryLabel: null };
    options = candidates(anywhere, 8, 60);
    if (options.length) {
      loosened = "No " + (intent.categoryLabel || "matches").toLowerCase() + " near " + (intent.city || "you") + ". Here is what else is around.";
    }
  }
  if (!options.length) {
    /**
     * Out of levers, so hand back the two that are left rather than a dead end. A guest told "I found nothing"
     * has no idea whether to change the place, the activity or the day, and will not ask a third time.
     */
    const near = nearbyTowns(intent);
    return done({
      intent, options: [], compare: null, loosened: null,
      followUp: {
        question: "I could not find " + (intent.categoryLabel ? intent.categoryLabel.toLowerCase() : "anything") + " near " + (intent.city || intent.region) + ". Want me to try somewhere else?",
        why: "nothing",
        choices: near.map((c) => ({ label: c.city + ", " + c.region, text: (intent.categoryLabel || "something fun") + " in " + c.city + " " + regionName(c.region) })),
      },
    });
  }

  /**
   * Budget, asked only when it would change the answer.
   *
   * A question about money is worth a turn when the places nearby are genuinely far apart on price and
   * pointless when they are not: asking "what's your budget?" about three escape rooms charging $32, $33 and
   * $34 wastes the guest's time and makes the agent look like a form. So it is asked when the spread is real
   * — the dearest at least double the cheapest, and at least $25 between them — and the options offered are
   * cut from the actual prices found, not from round numbers somebody imagined.
   */
  if (intent.maxPerPerson == null && !asked.has("budget")) {
    const known = options.map(priceOf).filter((n): n is number => n != null).sort((a, b) => a - b);
    if (known.length >= 3 && known[known.length - 1] >= known[0] * 2 && known[known.length - 1] - known[0] >= 25) {
      /**
       * Cut at the quarter and the middle of what is actually out there, rounded to a figure a person would
       * say. Offering the literal minimum is useless in both directions: "Under $10" when the cheapest thing
       * is $10 narrows to exactly one business, and it is usually one odd cheap line rather than a real
       * option. A budget choice has to leave something on either side of it.
       */
      const at = (q: number) => known[Math.min(known.length - 1, Math.floor(known.length * q))];
      const round5 = (n: number) => Math.max(5, Math.ceil(n / 5) * 5);
      const lo = round5(at(0.33));
      const mid = round5(at(0.7));
      // Two identical options are one option; if the spread collapses after rounding, do not ask at all.
      if (mid > lo) {
        tr.step("narrow", "prices run $" + known[0].toFixed(0) + " to $" + known[known.length - 1].toFixed(0) + "; offering a cap beside the answer", { detail: "not in front of it" });
        // Only when nothing better is already on offer: one row of chips, not two.
        narrow = narrow ?? {
          question: "These run $" + Math.floor(known[0]) + " to $" + Math.ceil(known[known.length - 1]) + " a head.",
          why: "budget",
          choices: [
            { label: "$" + lo + " or less", text: text + " under $" + lo + " a head" },
            { label: "Up to $" + mid, text: text + " under $" + mid + " a head" },
          ],
        };
      }
    }
  }

  const win = windowFor(intent.when);

  /**
   * A departure we could not price is not a departure that fits a budget.
   *
   * `fits` lets a null price through, which is right when nobody named a budget and wrong the moment somebody
   * does: an offsite capped at $50 a head was being shown four unpriced Niagara tours that really cost $105
   * to $434. They passed the filter by having no number to compare. So once a cap exists, unpriced departures
   * are dropped — but only while priced ones survive, because an honest "price on request" beats an empty
   * screen when it is all there is.
   */
  /**
   * The headline price must be one this party can actually buy.
   *
   * Parasail Toronto's cheapest rate is "Group Rate | 16-24 People" at $90.10, and it was being quoted to a
   * party of two, who cannot book it. Every rate carries its own party limits, so the cheapest is chosen from
   * the rates that admit this many people. It is the same mistake as quoting a child fare to two adults: the
   * number is real and they still cannot pay it.
   */
  const forParty = (d: Departure): Departure => {
    if (!d.rates.length) return d;
    const fitsParty = (r: Departure["rates"][number]) =>
      (r.minParty == null || intent.party >= r.minParty) && (r.maxParty == null || intent.party <= r.maxParty);
    /**
     * And not a concession. `live.ts` already excludes child, infant and senior fares when it picks a
     * headline, and re-picking here by party limits alone quietly undid that: a team offsite for ten adults
     * was quoted "$20.14 + tax · Infant", on the card and again in the comparison line above it. An age
     * limit is not a party limit, so the party filter cannot see it.
     *
     * It corrupts the budget too, in the opposite direction to the over-budget bug: a $20.14 infant fare
     * slips under a $50 cap that the adult fare on the same departure would fail, so the shop is kept as
     * affordable on a ticket nobody in the party can buy.
     */
    const buyable = d.rates.filter((r) => fitsParty(r) && !isConcessionFare(r.label));
    // Only when a concession is genuinely all this departure sells, which is a real thing for kids' sessions.
    const pool = buyable.length ? buyable : d.rates.filter(fitsParty);
    if (!pool.length) return d;
    const cheapest = pool.reduce((a, b) => (a.price <= b.price ? a : b));
    if (cheapest.price === d.fromPrice && cheapest.label === d.priceLabel) return d;
    return { ...d, fromPrice: cheapest.price, priceLabel: cheapest.label };
  };

  /**
   * What this shop's departures look like once a budget is in play.
   *
   * Filtering departure by departure got this exactly backwards. Zoom Tours sells four Niagara tours at $105
   * to $434; against a $50 cap the priced ones were removed and their unpriced siblings survived, because a
   * null price passes any filter. The shop then appeared in a $50 answer showing a live 15:00 slot with no
   * number beside it — which reads as "cheap enough, price to follow" about a business that is twice the
   * budget.
   *
   * So the question is asked of the shop, not the slot: if we know what it charges and everything it charges
   * is over the cap, it is over the cap, and none of its departures belong in this answer.
   */
  const withinBudget = (list: Departure[]): Departure[] => {
    if (intent.maxPerPerson == null) return list;
    const priced = list.filter((d) => d.fromPrice != null);
    if (!priced.length) return list; // nothing known either way; the menu filter downstream still applies
    const affordable = priced.filter((d) => d.fromPrice! <= intent.maxPerPerson!);
    // Knowing a shop is too dear is knowledge, and the answer should say so rather than go quiet.
    if (!affordable.length) overBudgetLive.push(Math.min(...priced.map((d) => d.fromPrice!)));
    return affordable;
  };
  const overBudgetLive: number[] = [];
  if (intent.maxTotal != null) {
    tr.step("budget", "$" + intent.maxTotal + " across " + intent.party + " is $" + intent.maxPerPerson + " a head",
      { detail: "a group budget is not a ticket price" });
  }

  /**
   * The shops are asked at the same time, not one after another. Each is a handful of round trips to its
   * booking provider, so asking three in turn took nineteen seconds with the machine idle for most of it.
   */
  /**
   * Find the booking system of the shops we are about to show, now.
   *
   * The catalog holds a booking link for 8,370 of 423,161 businesses, because finding one meant crawling the
   * shop's site and only 6.5% have ever been fetched. Pre-crawling the other 315,281 is weeks of worker time
   * spent mostly on shops nobody will ever ask about. A search returns eight businesses, and eight is
   * nothing: resolve those, and the rest of the catalog costs nothing until somebody asks.
   *
   * Once per shop, ever. Whatever is found is written down, so the second guest to ask about that town pays
   * none of it, and the ones nobody asks about are never fetched at all.
   */
  /**
   * Includes a shop already marked `agent` (a booking link we found once but had no reader for), not only one
   * with no link at all. `resolveBooking` itself is the guard against re-fetching the same page forever: it
   * skips straight back to the cached miss once `READER_GENERATION` has not moved past what found it, so this
   * costs nothing extra for the common case and only spends a fetch when the readers have genuinely gotten
   * wider since — which is exactly how adventurerooms.ca's Checkfront embed gets found on the next ask instead
   * of staying `agent` forever because the one crawl of its `/booknow/` page predates that detection.
   */
  const unresolved = options.filter((o) => (!o.bookingUrl || o.route === "agent") && o.route !== "feed");
  if (unresolved.length && (opts.resolve ?? true)) {
    const rows = db
      .prepare(`SELECT id, domain, website FROM operators WHERE domain IN (${unresolved.map(() => "?").join(",")})`)
      .all(...unresolved.map((o) => o.domain)) as { id: string; domain: string; website: string | null }[];
    const found = await resolveMany(rows, { budgetMs: opts.resolveMs ?? 7000, max: 6 });
    let gained = 0;
    for (const r of found.values()) {
      if (!r.bookingUrl) continue;
      const o = options.find((x) => x.domain === r.domain);
      if (!o) continue;
      o.bookingUrl = usableBookingUrl(r.bookingUrl, o.domain);
      if (o.bookingUrl) {
        o.route = isReadable(o.bookingUrl) ? "feed" : "agent";
        if (r.outcome === "found") gained += 1;
      }
    }
    if (gained) tr.step("resolve", gained + " booking system" + (gained === 1 ? "" : "s") + " found on their own sites just now", { detail: "never fetched before; kept for good" });
  }

  const feeds = options.filter((o) => o.route === "feed").slice(0, opts.ask ?? 3);
  for (const o of options) {
    if (feeds.includes(o)) continue;
    tr.step("skip", o.name, {
      who: o.name,
      /**
       * A shop with a booking page we cannot read is not a shop that takes bookings by phone. Bad Axe,
       * Lumberjacks and Riot Axe all sell online right now, with a date step, a guest count and a Pay button;
       * we simply have no reader for a hand-built form. Saying "we would call them" about a business whose
       * checkout is open is not a limitation being admitted, it is a false statement about them.
       */
      detail: o.route === "phone"
        ? "no booking page we could find: the phone agent would call " + (o.phone || "them")
        : "they book on their own page; we have no reader for it yet",
    });
  }
  /**
   * A deadline per shop, not just per request. Asking three booking systems at once is only as fast as the
   * slowest of them, and an offsite query took twenty-two seconds because one helicopter operator's calendar
   * was slow that minute. A guest waiting on a phone will not wait twenty-two seconds, and the two shops that
   * answered in one second had nothing to do with it. Whoever is late is simply not in this answer.
   */
  const warmDeadline = opts.deadlineMs ?? 5000;
  /**
   * A cold shop gets longer, because it needs longer and only once. Measured on Parasail Toronto: the first
   * read took 5.9 seconds and blew the deadline, and the next three took 1.7s, 0.4s and 0.25s. Spending the
   * extra seconds on the first read of a shop costs a guest nothing afterwards, and refusing to spend them
   * means the only read that ever fails is the one somebody is watching.
   */
  const coldDeadline = Math.max(warmDeadline, 12000);
  const inTime = <T,>(work: Promise<T>, who: string, warm: boolean): Promise<T | null> => {
    const ms = warm ? warmDeadline : coldDeadline;
    return Promise.race([work, new Promise<null>((res) => setTimeout(() => res(null), ms))]).then((v) => {
      if (v === null) tr.step("timeout", who + " did not answer in " + (ms / 1000) + "s", { who, detail: warm ? "left out rather than kept a guest waiting" : "first read of this shop, and still too slow" });
      return v as T | null;
    });
  };

  await Promise.all(
    feeds.map(async (o) => {
      tr.step("ask", o.name, { who: o.name, detail: "reading their booking system" });
      /**
       * Whichever feed this shop runs. They all answer in the same shape, so nothing downstream has to care.
       *
       * The vendor is decided by `readerFor`, the same call that decided this shop was a `feed` in the first
       * place, so a link can never be routed here and then fall through to a reader that does not know it.
       */
      const readFeed = (from: Date, days: number) => {
        switch (readerFor(o.bookingUrl)) {
          case "square":
            return squareLive(o.bookingUrl, { from, days });
          case "acuity":
            return acuityLive(o.bookingUrl, { from, days });
          case "tripworks":
            return tripworksLive(o.bookingUrl, { from, days });
          case "xola":
            return xolaLive(o.bookingUrl, { from, days });
          case "rezdy":
            return rezdyLive(o.bookingUrl, { from, days });
          case "checkfront":
            return checkfrontLive(o.bookingUrl, { date: from });
          case "peek":
            return peekLive(o.bookingUrl, { from, days });
          case "resova":
            return resovaLive(o.bookingUrl, { from, days, maxItems: 4 });
          case "foreup":
            return foreupLive(o.bookingUrl, { from, days });
          default:
            /**
             * Six items, not three. Zoom Tours sells four day tours and we priced three of them, so the
             * fourth came back "price on request" and sat on the screen next to a headline that had no
             * number to quote. The total sheet is shared across a company's items, 287557 for every one of
             * theirs, so the first item costs three calls and each one after it costs two.
             */
            return fareharborLive(o.bookingUrl, { from, days, maxItems: 6 });
        }
      };

      const warm = feedIsWarm(o.bookingUrl);
      if (!warm) tr.step("cold", o.name + ": first read, giving it longer", { who: o.name, detail: (coldDeadline / 1000) + "s instead of " + (warmDeadline / 1000) + "s" });
      const live = await inTime(readFeed(win.from, win.days), o.name, warm);
      if (live) o.departures = withinBudget(live.departures.map(forParty));
      if (!o.departures.length && win.days < 14) {
        tr.step("widen", o.name + ": nothing " + intent.when + ", looking a fortnight out", { who: o.name });
        const wider = await inTime(readFeed(new Date(), 14), o.name, true);
        if (wider?.departures.length) {
          o.departures = withinBudget(wider.departures.map(forParty));
          o.widened = true;
        }
      }
      if (live) o.via = live.vendor === "fareharbor" ? "their FareHarbor calendar" : live.vendor === "resova" ? "their Resova calendar" : live.vendor === "peek" ? "their Peek calendar" : live.vendor === "checkfront" ? "their Checkfront calendar" : live.vendor === "xola" ? "their Xola calendar" : live.vendor === "rezdy" ? "their Rezdy calendar" : live.vendor === "tripworks" ? "their TripWorks calendar" : live.vendor === "square" ? "their Square calendar" : live.vendor === "acuity" ? "their Acuity calendar" : "their " + live.vendor + " calendar";

      /**
       * Nearest the time they asked for, not earliest in the day.
       *
       * Somebody who says "escape room at 4:30" has a reason: dinner at six, a train at eight. The shop sells
       * 11:30, 13:45, 16:00, 18:00 and 20:15, and none of those is 16:30 — but 16:00 is half an hour out and
       * is obviously the answer, while 11:30 is not an answer at all. So the list is ordered by distance from
       * what they asked, and each one carries how far off it is, because an offer that quietly slides by four
       * hours is how a guest misses their dinner.
       */
      if (intent.atMinute != null && o.departures.length) {
        const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
        /**
         * The soonest day first, and within that day the closest time. Sorting on time alone looks right and
         * is not: with no day named the horizon is a fortnight, so a 16:00 slot next Wednesday would outrank
         * a 17:00 slot this afternoon for somebody who said "4:30". The day is the coarse answer and the
         * clock is the fine one, in that order.
         */
        o.departures.sort((a, b) =>
          a.date.localeCompare(b.date) ||
          Math.abs(mins(a.time) - intent.atMinute!) - Math.abs(mins(b.time) - intent.atMinute!));
        o.offsets = o.departures.map((d) => mins(d.time) - intent.atMinute!);
      }

      /**
       * With no time asked for, show the ones we can actually quote first. Ordering by the clock put "price
       * on request" at the top of a list whose whole purpose is comparing prices.
       */
      if (intent.atMinute == null && o.departures.length) {
        o.departures.sort((a, b) => Number(a.fromPrice == null) - Number(b.fromPrice == null) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
      }

      const best = o.departures[0];
      const off = o.offsets?.[0];
      tr.step("answer", o.name + ": " + (o.departures.length ? o.departures.length + " times, from " + (best?.fromPrice != null ? "$" + best.fromPrice.toFixed(2) + (best.taxIncluded ? "" : " + tax") : "price on request") : "nothing free"),
        { who: o.name, detail: [o.widened ? "outside the day they asked for" : null, off != null ? "nearest is " + best.time + ", " + describeOffset(off) : null, o.via].filter(Boolean).join(" \u00b7 ") || undefined });
    }),
  );

  /**
   * The budget, applied to everything and not only to live departures.
   *
   * It was read off the sentence, printed back to the guest, used to filter feed times, and then ignored by
   * every option priced from its own menu: "$2,000 for 20 people" came back with a $207.70 helicopter seat at
   * the top. A budget a guest can see being read and then broken is worse than one nobody mentioned, so
   * anything over the cap comes out and the answer says how many and by how much.
   */
  const cap = intent.maxPerPerson;
  let overBudget = 0;
  if (cap != null) {
    const affordable = options.filter((o) => {
      const p = priceOf(o);
      // An unpriced shop is not known to be over budget, and dropping it would hide the ones we would ring.
      if (p == null) return true;
      if (p <= cap) return true;
      overBudget += 1;
      return false;
    });
    if (affordable.length) {
      options = affordable;
      /**
       * And off the menus, not only out of the shortlist. A shop whose cheapest ticket is $95 belongs in a
       * $100 answer, but printing its $140 line underneath puts a number on screen that the budget the guest
       * just gave was supposed to have handled. Only lines they could actually buy are shown; if that would
       * empty a shop's menu, its cheapest line stays, because a card with no price at all says less.
       */
      for (const o of options) {
        const within = o.services.filter((x) => x.price == null || x.per === "group" || x.price <= cap);
        if (within.length) o.services = within;
      }
      if (overBudget) {
        tr.step("budget", overBudget + " over $" + cap + " a head, dropped", { detail: intent.maxTotal ? "$" + intent.maxTotal + " across " + intent.party : "they said a head" });
      }
    } else {
      /**
       * Everything is over budget. Say so and show them rather than an empty screen: a guest who knows the
       * cheapest thing nearby is $40 can decide to spend $40, and cannot decide anything about nothing.
       */
      const cheapest = Math.min(...options.map(priceOf).filter((n): n is number => n != null));
      loosened = "Nothing near " + (intent.city || "you") + " comes in under $" + cap + " a head. The cheapest is $" + cheapest.toFixed(2) + ", so here is what there is.";
      tr.step("budget", "nothing under $" + cap + "; showing the cheapest instead", { detail: "an empty screen is not an answer" });
    }
  }

  /**
   * Shops whose live prices we read and which all came in over the cap. Without this the answer went silent:
   * the feed said $105 to $434 against a $50 budget, every departure was correctly dropped, and the guest was
   * shown a list with no times and no explanation of where they went.
   */
  if (overBudgetLive.length && intent.maxPerPerson != null && !options.some((o) => o.departures.length)) {
    const cheapest = Math.min(...overBudgetLive);
    loosened = loosened ?? "Nothing with live times comes in under $" + intent.maxPerPerson + " a head" +
      (intent.maxTotal ? " (" + "$" + intent.maxTotal + " across " + intent.party + ")" : "") +
      ". The cheapest I can actually quote is $" + cheapest.toFixed(2) + ".";
    tr.step("budget", overBudgetLive.length + " shop(s) priced above the cap; cheapest quotable is $" + cheapest.toFixed(2));
  }

  /**
   * "Anything cheaper" has to come back with something cheaper, or say that there is nothing.
   *
   * A shop with no price is not evidence of being cheap, and the budget filter lets unpriced shops through on
   * the principle that we do not know they are too dear. Under this refinement that principle inverts: asked
   * for something cheaper than $25, the answer was four escape rooms with no price at all, which is strictly
   * less useful than the $25 it replaced.
   */
  if (intent.refine === "cheaper") {
    const priced = options.filter((o) => priceOf(o) != null);
    if (priced.length) {
      options = priced;
    } else {
      /**
       * Nothing cheaper exists that we can price. Saying so and then listing four shops with no prices under
       * it is two contradictory statements on one screen, and the shops it reaches for at that point are the
       * dregs of the radius — a cereal company and a children's gym turned up under "cheaper escape rooms".
       * So the cap comes off and the cheapest things we can actually quote are shown again, with the reason.
       */
      const floor = intent.lastCheapest;
      const noCap: Intent = { ...intent, maxPerPerson: null, seen: [] };
      const again = candidates(noCap).filter((o) => priceOf(o) != null).sort((a, b) => (priceOf(a) ?? 0) - (priceOf(b) ?? 0));
      options = again.slice(0, 6);
      loosened = floor != null
        ? "Nothing near " + (intent.city || "you") + " comes in cheaper than $" + floor.toFixed(2) + " that I can put a price on. These are the cheapest I can see."
        : "I have no prices for anything cheaper near " + (intent.city || "you") + ".";
      tr.step("refine", "nothing cheaper to be had; showing the cheapest priced options again", { detail: "rather than a list with no numbers on it" });
      intent.maxPerPerson = null;
    }
  }

  // What it costs, across everything we found. This is the answer to "why not just use Google".
  const prices = options.map(priceOf).filter((n): n is number => n != null);
  const compare = prices.length >= 2 ? { cheapest: Math.min(...prices), dearest: Math.max(...prices), count: prices.length } : null;
  if (compare) tr.step("compare", "$" + compare.cheapest.toFixed(2) + " to $" + compare.dearest.toFixed(2) + " a head across " + compare.count + " places");

  /**
   * What they were shown, kept for the next sentence. "Show me something else" needs to know what else means,
   * and "anything cheaper" needs a number to beat; neither is answerable from the sentence alone.
   */
  intent.seen = [...new Set([...(intent.seen || []), ...options.map((o) => o.domain)])].slice(-24);
  intent.lastCheapest = compare?.cheapest ?? prices[0] ?? intent.lastCheapest ?? null;

  /**
   * Tell the crawler what a real person just wanted. Every business here that we could not price or time is
   * the best crawl target in the catalog, and until now nothing wrote that down.
   */
  /**
   * A refinement that empties the screen is worse than the answer it replaced. "Anything cheaper" came back
   * with no businesses and no explanation, which reads as the product breaking rather than as there being
   * nothing cheaper. If a refinement leaves nothing, its constraint comes off and the answer says so.
   */
  /**
   * "Any other places" must not mean "the dregs".
   *
   * Excluding everything already shown is right, but near a town with only eight escape rooms it lands on
   * whatever is left, which is the shops nobody has crawled: "I found 5 places but nothing published". A
   * guest reads that as the product breaking. Once the excluded shops are gone, if nothing left can be
   * priced or timed, look further out instead — people will travel for the right thing, and a real business
   * forty minutes away beats five names with nothing attached.
   */
  if (intent.refine === "other" && options.length && !options.some((o) => priceOf(o) != null || o.departures.length)) {
    const wider = candidates(intent, 8, 120).filter((o) => priceOf(o) != null);
    if (wider.length) {
      options = wider;
      loosened = loosened ?? "That is everything nearby, so I have looked a bit further out.";
      tr.step("refine", "nothing left near " + (intent.city || "them") + " had a price; widened to 120 km");
    }
  }

  if (!options.length && intent.refine) {
    options = candidates({ ...intent, maxPerPerson: null, seen: [], refine: null });
    if (options.length) {
      loosened = loosened ?? (intent.refine === "other"
        ? "That is everything I can find near " + (intent.city || "you") + ". Here they are again."
        : "Nothing matched once I narrowed it, so this is the wider list.");
      tr.step("refine", "the refinement emptied the answer; widening rather than showing nothing");
    }
  }

  recordDemand(intent, options);
  const gaps = options.filter((o) => !o.departures.length && !o.services.some((x) => x.price != null)).length;
  if (gaps) tr.step("queue", gaps + " of these had nothing published: queued for the crawler", { detail: "the next crawl starts with what people asked for" });

  return done({ intent, options, followUp: null, loosened, compare, narrow });
}

/** "half an hour earlier", "bang on", so an offer says how far it moved rather than hoping nobody checks. */
export function describeOffset(min: number): string {
  if (min === 0) return "exactly when you asked";
  const a = Math.abs(min);
  const when = min < 0 ? "earlier" : "later";
  if (a < 60) return a + " min " + when;
  const h = Math.floor(a / 60), m = a % 60;
  return h + (m ? "h " + m + "m" : " hour" + (h === 1 ? "" : "s")) + " " + when;
}

/**
 * Businesses whose own name says what they do, for when the category column disagrees.
 *
 * Only used when the category shortlist is nearly empty, because a name match is weaker evidence than a read
 * of the shop's pages: plenty of businesses have "adventure" or "tours" in the name and sell something else
 * entirely. On a shortlist of one, weaker evidence beats none.
 */
function namedLike(intent: Intent, limit: number): Option[] {
  if (!intent.point || !intent.categoryId) return [];
  const cat = CATEGORIES.find((c) => c.id === intent.categoryId);
  if (!cat) return [];
  /** The words a shop would put in its own name: "axe throwing", "Axe throwing", "axe". */
  const words = [...new Set([cat.searchQuery, cat.label, cat.id].filter(Boolean).map((w) => String(w).toLowerCase()))]
    .flatMap((w) => [w, w.split(" ")[0]])
    .filter((w) => w.length >= 4);
  if (!words.length) return [];

  const { lat, lon } = intent.point;
  const kx = Math.cos((lat * Math.PI) / 180);
  const deg = 60 / 111;
  const like = words.map(() => "instr(lower(o.name), ?) > 0").join(" OR ");
  const rows = db
    .prepare(
      `SELECT o.name, o.domain, o.city, o.region, o.rating, o.review_count, o.category_id, o.phone,
              (SELECT f.fact_value FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'booking_url'
                ORDER BY (${unreadableSql("f.fact_value")}) LIMIT 1) AS booking
         FROM operators o
        WHERE o.origin != 'demo' AND o.name IS NOT NULL AND o.lat IS NOT NULL
          AND abs(o.lat - ?) < ? AND abs(o.lon - ?) < ? AND (${like})
        ORDER BY (booking IS NULL), o.review_count DESC NULLS LAST LIMIT ?`,
    )
    // The point comes first in the WHERE clause, so it binds first.
    .all(lat, deg, lon, deg / Math.max(kx, 0.2), ...words, limit) as {
    name: string; domain: string; city: string | null; region: string | null; rating: number | null;
    review_count: number | null; category_id: string; phone: string | null; booking: string | null;
  }[];

  return rows.map((r) => {
    const booking = usableBookingUrl(r.booking, r.domain);
    return {
      name: r.name, domain: r.domain, city: r.city, region: r.region, rating: r.rating, reviews: r.review_count,
      category: r.category_id, bookingUrl: booking, departures: [], services: servicesFor(r.domain, r.category_id),
      route: booking ? (isReadable(booking) ? "feed" : "agent") : r.phone ? "phone" : "agent",
      phone: r.phone,
    } as Option;
  });
}

/** Where this activity is thickest on the ground, for when the guest has not said where they are. */
function busiestTowns(categoryId: string | null): { city: string; region: string }[] {
  const args: (string | number)[] = [];
  let cat = "";
  if (categoryId) { cat = "AND o.category_id = ?"; args.push(categoryId); }
  return db
    .prepare(
      `SELECT o.city, o.region, COUNT(*) AS n FROM operators o
        WHERE o.city IS NOT NULL AND o.origin != 'demo' AND length(o.city) >= 4 ${cat}
        GROUP BY lower(o.city), o.region ORDER BY n DESC LIMIT 4`,
    )
    .all(...args) as { city: string; region: string }[];
}

/** The two nearest towns that actually have businesses, for when this one has none. */
function nearbyTowns(intent: Intent): { city: string; region: string }[] {
  if (!intent.point) return [];
  const { lat, lon } = intent.point;
  const kx = Math.cos((lat * Math.PI) / 180);
  const args: (string | number)[] = [];
  let cat = "";
  if (intent.categoryId) { cat = "AND o.category_id = ?"; args.push(intent.categoryId); }
  return db
    .prepare(
      `SELECT o.city, o.region, COUNT(*) AS n,
              MIN((o.lat - ${lat}) * (o.lat - ${lat}) + (o.lon - ${lon}) * (o.lon - ${lon}) * ${(kx * kx).toFixed(4)}) AS d
         FROM operators o
        WHERE o.city IS NOT NULL AND o.lat IS NOT NULL AND o.origin != 'demo' AND lower(o.city) != ? ${cat}
        GROUP BY lower(o.city), o.region HAVING n >= 2 ORDER BY d ASC LIMIT 3`,
    )
    .all(...args, (intent.city || "").toLowerCase()) as { city: string; region: string }[];
}

/** "ON" back into a word a guest would type, so a tapped choice reads like a sentence. */
export function regionName(code: string): string {
  return REGION_NAMES[code] || code;
}
