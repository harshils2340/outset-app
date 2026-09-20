import { db } from "../src/db/client.ts";
import { plan, REGION_NAMES, type Answer, type Intent } from "../src/concierge/plan.ts";
import { CATEGORIES } from "../src/taxonomy/catalog.ts";

/**
 * A live grader: random conversations drawn from the catalog, typed the way people actually type, scored
 * against what a guest would notice.
 *
 * `convo.mts` runs five conversations somebody wrote by hand, which is useful and is also how you end up
 * tuning the product to five conversations. This picks its own: a real town, a category that really exists
 * near it, a phrasing at random, then two or three follow-ups at random. Nothing here was chosen because it
 * worked.
 *
 * The phrasings used to read "escape room in Kelowna British Columbia for 8 ppl tomorrow under $50 a head",
 * which nobody types. Real input is lower case, unpunctuated, misspelled, and led by the occasion rather
 * than the activity — "me and 3 friends wanna do something fun tonight in waterloo". A grader fed tidy
 * sentences measures how well the agent handles tidy sentences, which is not a question anybody has. So
 * every opener here is built out of the habits real typing has: run-ons, transpositions, txt-speak, buried
 * constraints, questions instead of commands, and corrections made mid-sentence.
 *
 * Because the generator knows what it meant, it can grade what was understood and not merely what came back
 * looking plausible. Each generated turn carries an `Expect`: the facts the sentence really does state. A
 * sentence that says "4 ppl" has said four, whatever it did to the spelling, and an agent that answers
 * "assuming two of you" has got it wrong in a way the guest reads instantly.
 *
 * Every turn is scored on the things that decide whether an answer is any good:
 *
 *   aligned   the businesses match what was asked for, where it was asked for
 *   asks      when the activity needs a fact the sentence did not carry, it asked for it
 *   priced    a turn that shows businesses shows what they cost
 *   sane      the prices could be what a person actually pays, not merchandise or a whole-room hire
 *   carried   a follow-up keeps the town, the activity and the party
 *   fast      an answer arrives before a guest gives up
 *   read      what the sentence plainly said came back in the intent: the party, the day, the budget, the place
 *   capped    nothing is offered above a budget the agent itself accepted
 *
 *   npx tsx scripts/grade.mts                 20 conversations, no shop contacted
 *   npx tsx scripts/grade.mts --n=10000       a sweep; it is only the catalog and the clock
 *   npx tsx scripts/grade.mts --seed=7        the same conversations again, to check a fix
 *   npx tsx scripts/grade.mts --dry           print the conversations and grade nothing
 *   npx tsx scripts/grade.mts --n=40 --ask=2  a spot check that really reads two shops a turn
 *   npx tsx scripts/grade.mts --jobs=4        processes; the default is 8
 *   npx tsx scripts/grade.mts --failures      every failure, not just the grouped counts
 *
 * Exits non-zero below the passing bar, so it can gate a deploy and can be run over and over while fixing.
 */

/**
 * The grader reads the catalog and must never write to it.
 *
 * `plan()` calls `recordDemand()`, which bumps `crawl_demand` and `search_demand` so the next crawl starts
 * with whatever real guests asked for and could not be quoted a price on. That is the right behaviour in
 * production and exactly wrong here: ten thousand invented conversations would put a quarter of a million
 * fake asks in front of the crawler and send it after businesses nobody ever asked about. Read-only turns
 * those writes into the no-op the demand writer already handles, and it removes the write lock, which is
 * what made eight processes on one SQLite file slower than one.
 *
 * The cache and mmap settings are a grader concern rather than a product one: the file is 1.1 GB, the
 * default page cache is 2 MB, and every shard was re-reading the same pages through the kernel.
 */
db.exec("PRAGMA query_only = true");
db.exec("PRAGMA mmap_size = 2147483648");
db.exec("PRAGMA cache_size = -131072");

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith("--" + k + "="))?.split("=")[1];
const N = Number(arg("n") || 20);
const SEED = Number(arg("seed") || Math.floor(Math.random() * 1e6));
const onlyFailures = args.includes("--failures");
/**
 * Print the conversations this seed produces and stop, without asking a single shop anything.
 *
 * The generator is the part of this file most likely to be wrong, and reading its output is the only way to
 * see that. It also settles the determinism question in two seconds rather than two minutes: the same seed
 * has to print the same sentences, and a run that asks real booking systems for real times can never be
 * diffed against itself, because the shops answer differently each time.
 */
const dryRun = args.includes("--dry");
const BAR = Number(arg("bar") || 80);

/**
 * How many of the shops on each shortlist are asked for real times, and it is none by default.
 *
 * Every live read is a request to somebody else's booking system. At two shops a turn, a run of two hundred
 * conversations is over a thousand requests to FareHarbor, Peek and Resova to test ourselves, and ten
 * thousand is indefensible. With `ask: 0` the catalog alone answers, which still exercises everything these
 * checks measure — the reader, the place, the search, the ranking, the menu prices, the assumptions, the
 * refinements and the carried context — because none of that lives in the feeds. `--ask=2` is for a spot
 * check of a few dozen, not for a sweep.
 */
const ASK = Number(arg("ask") ?? 0);
/**
 * Conversations at a time. Eight is about where a laptop stops gaining, and turns within one conversation
 * are still strictly in order: turn three is an answer to turns one and two.
 */
const JOBS = Number(arg("jobs") || 8);

/**
 * Which slice of the run this process is grading, as `--shard=2/8`. Set by the parent, never by a person.
 *
 * `plan()` is almost entirely synchronous SQLite, so promises in one process buy nothing: eight
 * conversations "at once" took exactly as long as eight in a row and pinned one core while the other ten sat
 * idle. Real parallelism needs real processes. Each child regenerates every conversation from the same seed
 * — generation is pure arithmetic and costs nothing — and grades only the indices that are its own, so the
 * sentences do not depend on how the work was divided and `--jobs` changes the wall clock and nothing else.
 */
const shardArg = arg("shard");
const [SHARD, SHARDS] = shardArg ? shardArg.split("/").map(Number) : [0, 1];
const isChild = shardArg != null;

const ESC = String.fromCharCode(27);
const R = ESC + "[0m", DIM = ESC + "[2m", RED = ESC + "[31m", GREEN = ESC + "[32m", AMBER = ESC + "[33m", BOLD = ESC + "[1m";

/** Deterministic randomness, so a run can be repeated exactly while a fix is being checked. */
let s = SEED >>> 0;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
/** A coin weighted however the caller wants it, so a habit can be common without being universal. */
const chance = (p: number) => rnd() < p;

/**
 * Said up front, because a no-network score and a live score are different numbers about different things
 * and the only thing worse than a low score is two that get compared to each other by mistake.
 */
if (!isChild) console.log(
  `${BOLD}grading ${N} random conversations${R}${DIM}  seed ${SEED} (pass --seed=${SEED} to repeat) \u00b7 ` +
    `${ASK ? "asking " + ASK + " shops a turn for live times" : "catalog only, no shop contacted"} \u00b7 ${JOBS} at a time${R}\n`,
);

type Town = { city: string; region: string; n: number; lat: number; lon: number };

/** The provinces and territories, so the sample can be balanced between the two countries on purpose. */
const CA_REGIONS = ["ON", "BC", "AB", "QC", "NS", "MB", "SK", "NB", "NL", "PE", "YT", "NT", "NU"];

/**
 * Towns with enough businesses to be worth asking about, drawn from the catalog itself.
 *
 * Taken as the top sixty of each country rather than the global top hundred and twenty. Ordering the whole
 * catalog by operator count gives 106 American towns and 14 Canadian ones — Florida alone outnumbers all of
 * Canada — so a run would have been an American test with a rounding error of Canada in it, and the two
 * countries do not behave the same: different booking vendors, different region codes, different spellings
 * of the same activity. Both halves still have to clear the same bar of 25 businesses, so balance is bought
 * by dropping dense American towns rather than by asking about places with nothing in them.
 *
 * The centroid comes back with them because half the failures worth catching are about place: a sentence
 * that named a town and a state, answered with businesses in a different one. Kilometres settle that; a
 * matching city name does not, since the escape rooms a Waterloo student uses are filed under Kitchener.
 */
const townsIn = (regions: string[], not: boolean, limit: number) =>
  db
    .prepare(
      `SELECT city, region, COUNT(*) n, AVG(lat) lat, AVG(lon) lon FROM operators
        WHERE origin != 'demo' AND city IS NOT NULL AND length(city) >= 4 AND lat IS NOT NULL
          AND region ${not ? "NOT IN" : "IN"} (${regions.map(() => "?").join(",")})
        GROUP BY lower(city), region HAVING n >= 25 ORDER BY n DESC LIMIT ?`,
    )
    .all(...regions, limit) as Town[];

/**
 * A town whose name is also a state's name makes a sentence that contradicts itself. The catalog holds a
 * "New York" filed under NJ and an "Ontario" filed under CA, and asking "camping in new york new jersey"
 * grades the agent on a request no human would make. The ambiguity between a province and a town of the same
 * name is a real bug and is tested by naming the province alone, not by naming both at once.
 */
const REGION_WORDS = new Set(Object.values(REGION_NAMES).map((w) => w.toLowerCase()));
const CODE_BY_NAME = new Map(Object.entries(REGION_NAMES).map(([code, name]) => [name.toLowerCase(), code]));
function notAStateName(t: Town): boolean {
  const city = t.city.toLowerCase();
  if (REGION_WORDS.has(city)) return false;
  /**
   * And a town whose own name carries a region that disagrees with the column it is filed under. The catalog
   * holds "Washington DC" under VA, which generates "in washington dc, VA" — a sentence with two different
   * places in it, so whatever the agent does with it is neither right nor wrong. "Quebec City, QC" and
   * "Oklahoma City, OK" agree with themselves and stay in. Codes are only read when the name writes them as
   * codes, or "La Ronge" would be filed in Louisiana.
   */
  for (const [name, code] of CODE_BY_NAME) {
    if (code !== t.region && new RegExp("\\b" + name + "\\b").test(city)) return false;
  }
  return !t.city.split(/[^A-Za-z]+/).some((w) => /^[A-Z]{2}$/.test(w) && w in REGION_NAMES && w !== t.region);
}

const CA_TOWNS = townsIn(CA_REGIONS, false, 70).filter(notAStateName).slice(0, 60);
const US_TOWNS = townsIn(CA_REGIONS, true, 70).filter(notAStateName).slice(0, 60);
/** Interleaved, so a short run of five conversations is still drawn from both countries rather than one. */
const TOWNS: Town[] = Array.from({ length: Math.max(CA_TOWNS.length, US_TOWNS.length) }, (_, i) => [CA_TOWNS[i], US_TOWNS[i]])
  .flat()
  .filter(Boolean);

/** What actually exists near that town, so a question is never about something nobody sells there. */
function categoriesIn(city: string, region: string): string[] {
  return (
    db
      .prepare(
        `SELECT category_id c, COUNT(*) n FROM operators
          WHERE origin != 'demo' AND lower(city) = lower(?) AND region = ? AND category_id IS NOT NULL
          GROUP BY category_id HAVING n >= 2 ORDER BY n DESC LIMIT 12`,
      )
      .all(city, region) as { c: string }[]
  ).map((r) => r.c);
}

/** Where a business we offered actually is, so "in Kelowna BC" can be checked against what came back. */
const whereIs = db.prepare(`SELECT lat, lon FROM operators WHERE domain = ? AND lat IS NOT NULL LIMIT 1`);
const placeOf = new Map<string, { lat: number; lon: number } | null>();
function pointOf(domain: string): { lat: number; lon: number } | null {
  if (!placeOf.has(domain)) placeOf.set(domain, (whereIs.get(domain) as { lat: number; lon: number } | undefined) ?? null);
  return placeOf.get(domain)!;
}
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dy = (a.lat - b.lat) * 111;
  const dx = (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dy * dy + dx * dx);
}

/**
 * Every state and province by name, not the seventeen somebody happened to type out. A hand-written list
 * meant "sudbury ON" was written as "sudbury on" and "brandon MB" as "brandon mb", so half of Canada and
 * most of the interior of the United States were being asked about by their two-letter code only — which is
 * the one form the reader is careful about, since half of those codes are ordinary English words.
 */
const REGION_WORD = REGION_NAMES;

/**
 * One typing error of the kind keyboards actually produce.
 *
 * Almost all real misspellings are a transposition, a doubled letter or a dropped one — "tomroorw",
 * "waterlooo", "excape" — rather than the random substitutions a naive fuzzer makes. Generating the wrong
 * kind of noise would test a matcher nobody needs. The first letter is left alone, because people get the
 * first letter right and the reader leans on that.
 */
function typo(word: string): string {
  if (word.length < 5) return word;
  const i = 1 + Math.floor(rnd() * (word.length - 2));
  const how = Math.floor(rnd() * 3);
  if (how === 0) return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
  if (how === 1) return word.slice(0, i) + word[i] + word.slice(i);
  return word.slice(0, i) + word.slice(i + 1);
}

/**
 * How people write each activity when they are not reading it off a menu.
 *
 * The catalog's labels are title-cased plurals ("Escape Rooms", "Jet Ski Rentals") and nobody types those.
 * These are the forms that turn up in a search box, misspellings included, because a mistyped activity is
 * the single most common way a request arrives and turning it into the wrong search is worse than not
 * understanding it at all.
 */
const SAID_AS: Record<string, string[]> = {
  escape: ["escape room", "escape rooms", "excape room", "escpae room", "escape the room"],
  axe: ["axe throwing", "ax throwing", "axe throwin", "throwing axes"],
  jetski: ["jetski", "jet ski", "jetskis", "jet skiing", "sea doo"],
  kayak: ["kayaking", "kayak", "kayakking", "kayak rental"],
  minigolf: ["mini golf", "minigolf", "mini putt", "putt putt"],
  kart: ["go karting", "go karts", "gokarts", "karting"],
  bowling: ["bowling", "bowlling", "go bowling"],
  climbing: ["rock climbing", "climbing", "bouldering"],
  skydive: ["skydiving", "sky diving", "skydive", "jump out of a plane"],
  zipline: ["ziplining", "zip lining", "zipline"],
  heli: ["helicopter ride", "helicopter tour", "heli tour"],
  spa: ["spa day", "spa", "massage"],
  cooking: ["cooking class", "cooking classes"],
  winery: ["wine tasting", "winery tour", "wine tour"],
  brewery: ["brewery tour", "brewery", "beer tasting"],
  paintball: ["paintball", "paintballing"],
  lasertag: ["laser tag", "lazer tag"],
  arcade: ["arcade", "arcades"],
  karaoke: ["karaoke", "karoke"],
  trampoline: ["trampoline park", "trampolines"],
  rafting: ["rafting", "white water rafting"],
  fishing: ["fishing charter", "fishing trip", "go fishing"],
  cruise: ["boat cruise", "boat tour", "harbour cruise"],
  balloon: ["hot air balloon", "balloon ride"],
  horse: ["horseback riding", "horse riding"],
  pottery: ["pottery class", "pottery"],
  sauna: ["sauna", "cold plunge"],
  surf: ["surf lesson", "surfing"],
  scuba: ["scuba diving", "diving"],
};

/** How the activity is written this time: a form somebody would type, and sometimes a fresh typo on top. */
function activityWord(catId: string, label: string): { text: string; typed: boolean } {
  const forms = SAID_AS[catId];
  const base = forms ? pick(forms) : label.toLowerCase();
  // One in six is mistyped, which is roughly the rate a search box sees and enough to expose a reader that
  // only matches exact words without swamping every other case with the same failure.
  if (chance(1 / 6)) {
    const words = base.split(" ");
    const j = words.findIndex((w) => w.length >= 5);
    if (j >= 0) return { text: words.map((w, i) => (i === j ? typo(w) : w)).join(" "), typed: true };
  }
  return { text: base, typed: false };
}

/** The facts a generated sentence genuinely states, so the grader can check what was understood. */
type Expect = {
  /** The activity they named, however they spelled it. */
  cat?: string;
  /** The town, with its region spelled out, so the answer can be measured in kilometres from it. */
  town?: Town;
  /** They named somewhere, but not unambiguously enough to say which one is right. */
  somePlace?: boolean;
  /** The town they meant, however they spelled it, so a failure quotes the word rather than "a town". */
  meant?: string;
  /** They named nowhere at all, which is the one thing worth blocking the answer for. */
  noPlace?: boolean;
  party?: number;
  when?: Intent["when"];
  /** A cap a head, in dollars. */
  perHead?: number;
  /** A budget for the whole group, which is not a ticket price. */
  total?: number;
  /** A clock time, in minutes after midnight, the way `Intent.atMinute` carries it. */
  atMinute?: number;
  cover?: "indoor" | "outdoor";
  /** They just told the agent to stop showing this category. */
  dropCat?: string;
};

type Turn = { say: string; why: string; expect: Expect };

/** "in kelowna bc", "kelowna", "near kelowna british columbia" — and whether it pinned the town down. */
function placePhrase(town: Town): { text: string; expect: Expect } {
  const word = REGION_WORD[town.region] ?? town.region;
  const city = town.city.toLowerCase();
  /**
   * A town named with its state or province is a fact the agent has no excuse to get wrong, so those turns
   * are graded on distance. A bare town name is not: eleven places here are called Waterloo, and picking a
   * different real one is a question to ask, not a lie to catch. So the bare forms only assert that some
   * place was understood.
   */
  if (chance(0.35)) return { text: pick([`in ${city} ${word.toLowerCase()}`, `${city} ${word.toLowerCase()}`, `in ${city}, ${town.region}`]), expect: { town, meant: city } };
  if (chance(0.25)) return { text: pick([`in ${city} ${town.region.toLowerCase()}`, `${city} ${town.region.toLowerCase()}`]), expect: { town, meant: city } };
  return { text: pick([`in ${city}`, `${city}`, `near ${city}`, `around ${city}`, `in ${typo(city)}`]), expect: { somePlace: true, meant: city } };
}

/** "for 6 of us", "8 ppl", "me and 3 friends" — a head count, and the number it really means. */
function partyPhrase(): { text: string; expect: Expect } {
  const n = pick([3, 4, 5, 6, 8, 10, 12]);
  return pick([
    { text: `for ${n} of us`, expect: { party: n } },
    { text: `${n} ppl`, expect: { party: n } },
    { text: `for ${n} people`, expect: { party: n } },
    { text: `me and ${n - 1} friends`, expect: { party: n } },
    { text: `group of ${n}`, expect: { party: n } },
    { text: `theres ${n} of us`, expect: { party: n } },
  ]);
}

/** "2nite", "tomroorw", "sat" — when, written the way it gets written on a phone. */
function whenPhrase(): { text: string; expect: Expect } {
  return pick([
    { text: "tonight", expect: { when: "tonight" as const } },
    { text: "2nite", expect: { when: "tonight" as const } },
    { text: "tomorrow", expect: { when: "tomorrow" as const } },
    { text: "tomroorw", expect: { when: "tomorrow" as const } },
    { text: "2morrow", expect: { when: "tomorrow" as const } },
    { text: "this weekend", expect: { when: "weekend" as const } },
    { text: "saturday", expect: { when: "weekend" as const } },
    { text: "sunday", expect: { when: "weekend" as const } },
  ]);
}

/** "under 40 bucks each", "$500 for the group" — money, and which of the two numbers it is. */
function budgetPhrase(party: number | undefined): { text: string; expect: Expect } {
  const head = pick([30, 40, 50, 60, 75]);
  if (party && party >= 4 && chance(0.4)) {
    const total = head * party;
    return { text: pick([`we have $${total} for the group`, `$${total} budget for all of us`]), expect: { total, perHead: head } };
  }
  return pick([
    { text: `under $${head} a head`, expect: { perHead: head } },
    { text: `under ${head} bucks each`, expect: { perHead: head } },
    { text: `max $${head} per person`, expect: { perHead: head } },
    { text: `nothing over $${head} each`, expect: { perHead: head } },
  ]);
}

/** "at 7", "around 730" — a clock time, which is a different request from a day. */
function timePhrase(): { text: string; expect: Expect } {
  return pick([
    { text: "at 7", expect: { atMinute: 19 * 60 } },
    { text: "around 730", expect: { atMinute: 19 * 60 + 30 } },
    { text: "at 4:30pm", expect: { atMinute: 16 * 60 + 30 } },
    { text: "around 8pm", expect: { atMinute: 20 * 60 } },
    { text: "at 2pm", expect: { atMinute: 14 * 60 } },
  ]);
}

/**
 * The occasions people lead with instead of an activity.
 *
 * "date night", "my kid's birthday", "team offsite" name no activity at all, and they are how most of these
 * requests really arrive: somebody knows the occasion long before they know what they want to do. The agent
 * is not expected to guess the activity from them — it is expected to answer anyway and offer the genres
 * beside the answer, which is what the `asks` check measures. The head counts and the roof, though, are
 * stated plainly and are graded.
 */
const OCCASIONS: { text: string; expect: Expect }[] = [
  { text: "date night", expect: { party: 2 } },
  { text: "first date ideas", expect: {} },
  { text: "our anniversary", expect: {} },
  { text: "bachelor party for 8 guys", expect: { party: 8 } },
  { text: "bachelorette weekend", expect: { when: "weekend" } },
  { text: "girls trip theres 5 of us", expect: { party: 5 } },
  { text: "my kids birthday party 10 kids", expect: { party: 10 } },
  { text: "team offsite for 12 people", expect: { party: 12 } },
  { text: "work christmas party for 20 people", expect: { party: 20 } },
  { text: "its raining and we need something indoors", expect: { cover: "indoor" } },
  { text: "rainy day with toddlers", expect: { cover: "indoor" } },
  { text: "my parents are visiting", expect: {} },
  { text: "something to do with 4 kids", expect: { party: 4 } },
  { text: "we want to be outdoors", expect: { cover: "outdoor" } },
];

/** What people type when they have not decided anything at all, which is most of the time. */
const VAGUE = ["idk something fun", "something chill", "we're bored", "anything fun", "whats there to do", "something different", "fun stuff"];

type Shape = { why: string; build: (town: Town, catId: string, label: string) => Turn };

/**
 * The shapes a first message actually arrives in.
 *
 * Each one exists because it is a habit real typing has and a way the reader can be wrong that the tidy
 * phrasings could never show. They are graded on what they state, not on being answered the way a tidy
 * sentence would be.
 */
const SHAPES: Shape[] = [
  {
    /** The baseline: lower case, no punctuation, everything present. The only tidy-ish case left. */
    why: "plain, lower case, no punctuation",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const place = placePhrase(town);
      const party = chance(0.6) ? partyPhrase() : null;
      const when = chance(0.6) ? whenPhrase() : null;
      return turn(
        [act.text, place.text, party?.text, when?.text],
        "plain" + (act.typed ? ", activity mistyped" : ""),
        [{ cat: catId }, place.expect, party?.expect, when?.expect],
      );
    },
  },
  {
    /**
     * Voice-to-text, which arrives as one unpunctuated breath with the constraints scattered through it.
     * The facts are all there; they are just not in the order a parser would choose, and "wanna do" sits
     * between the party and the activity.
     */
    why: "voice-to-text run-on, no punctuation anywhere",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const party = partyPhrase();
      const place = placePhrase(town);
      const when = whenPhrase();
      return turn(
        [pick(["hey so", "ok so", "so"]), party.text, pick(["wanna do", "want to do", "are looking to do", "were thinking"]), act.text, place.text, when.text],
        "voice-to-text run-on",
        [{ cat: catId }, party.expect, place.expect, when.expect],
      );
    },
  },
  {
    /**
     * A question, not a command. Half of what people type is phrased at the agent rather than at a search
     * box, and a reader that keys on the first noun finds "you" and "any".
     */
    why: "phrased as a question to a person",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const place = placePhrase(town);
      return turn(
        [pick(["do you know any good", "is there any", "whats a good", "any good", "can you find me"]), act.text, place.text, chance(0.5) ? pick(["for tonight", "for tomorrow"]) : null],
        "a question rather than a command",
        [{ cat: catId }, place.expect],
      );
    },
  },
  {
    /**
     * The constraint buried mid-sentence, which is where people put it: the money comes before the activity
     * and the day comes after the party. The old opener always put budget last, so a reader that only looked
     * at the tail would have scored perfectly.
     */
    why: "budget buried in the middle of the sentence",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const party = partyPhrase();
      const budget = budgetPhrase(party.expect.party);
      const place = placePhrase(town);
      const when = whenPhrase();
      return turn(
        ["something", budget.text, party.text, when.text, place.text, "maybe", act.text],
        "constraints before the activity",
        [{ cat: catId }, party.expect, budget.expect, place.expect, when.expect],
      );
    },
  },
  {
    /**
     * Txt-speak. "wat can we do 2nite 4 ppl" is not a joke input; it is what a phone keyboard produces at
     * eleven at night, and every one of those tokens is a fact the sentence states.
     */
    why: "txt-speak: 2nite, 4 ppl, wat",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const place = placePhrase(town);
      const n = pick([4, 6, 8]);
      const when = pick([
        { text: "2nite", expect: { when: "tonight" as const } },
        { text: "2morrow", expect: { when: "tomorrow" as const } },
      ]);
      return turn(
        [pick(["wat", "what"]), "can we do", when.text, place.text, `${n} ppl`, chance(0.5) ? act.text : null],
        "txt-speak",
        [chance(0.5) ? { cat: catId } : {}, place.expect, { party: n }, when.expect],
      );
    },
  },
  {
    /**
     * A correction made mid-sentence, which people make constantly and never go back to edit. The last thing
     * they said is the thing they meant; an agent that keeps the first one books the wrong night.
     */
    why: "corrects itself mid-sentence",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const place = placePhrase(town);
      return turn(
        [act.text, place.text, "tonight", pick(["actually no make it tomorrow", "wait no tomorrow instead", "actually tomorrow"])],
        "a correction mid-sentence",
        [{ cat: catId }, place.expect, { when: "tomorrow" }],
      );
    },
  },
  {
    /**
     * Occasion-led with no activity named, which is how most of these requests genuinely start. The agent
     * must answer and offer the genres beside the answer rather than asking which activity first.
     */
    why: "occasion-led, no activity named",
    build: (town) => {
      const occ = pick(OCCASIONS);
      const place = placePhrase(town);
      return turn([occ.text, place.text], "occasion-led", [occ.expect, place.expect]);
    },
  },
  {
    /** Occasion plus a day and a budget, still with no activity: the offsite brief that used to come back as four chips. */
    why: "occasion with real constraints and still no activity",
    build: (town) => {
      const occ = pick(OCCASIONS);
      const place = placePhrase(town);
      const when = whenPhrase();
      const budget = budgetPhrase(occ.expect.party);
      return turn([occ.text, place.text, when.text, budget.text], "occasion with constraints", [occ.expect, place.expect, when.expect, budget.expect]);
    },
  },
  {
    /** Two words pasted into a box. No verb, no preposition, and it is still a perfectly clear request. */
    why: "two words, no grammar",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const place = placePhrase(town);
      return turn([act.text, place.text], "two words", [{ cat: catId }, place.expect]);
    },
  },
  {
    /**
     * Nowhere named. "whats there to do here" and "near me" are the commonest openers of all, and the one
     * case where a blocking question is the right answer rather than a form.
     */
    why: "names no place at all",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      return turn(
        [pick([`${pick(VAGUE)}`, `do you know any good ${act.text}`, `${act.text}`]), pick(["near me", "here", "around here", "close by"])],
        "no place named",
        [{ noPlace: true }],
      );
    },
  },
  {
    /** Nothing but a mood. No activity, no day, no budget — and a town, so there is something to search. */
    why: "a mood and a town, nothing else",
    build: (town) => {
      const place = placePhrase(town);
      return turn([pick(VAGUE), place.text, chance(0.5) ? whenPhrase().text : null], "vague", [place.expect]);
    },
  },
  {
    /**
     * A clock time rather than a day. They have dinner at six, and an offer that quietly slides four hours
     * is how somebody misses it, so the time is graded as strictly as the party size.
     */
    why: "names a clock time, not a day",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const place = placePhrase(town);
      const time = timePhrase();
      const party = partyPhrase();
      return turn([act.text, place.text, time.text, party.text], "a clock time", [{ cat: catId }, place.expect, time.expect, party.expect]);
    },
  },
  {
    /**
     * A group budget stated as one number. "$500 for 10 of us" is fifty a head and was read as a $500 cap
     * per ticket, which excludes nothing and quietly turns a budget into no budget.
     */
    why: "whole-group budget, not a ticket price",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const place = placePhrase(town);
      const n = pick([6, 8, 10, 12, 20]);
      /**
       * Never $25 a head. A total only becomes a group budget when it is more than $25 a head, so a figure
       * that lands exactly on that line is testing a documented tie-break rather than whether the agent can
       * tell a group budget from a ticket price.
       */
      const head = pick([40, 50, 75]);
      return turn(
        [act.text, place.text, `for ${n} of us`, `we have $${n * head} total`],
        "a group budget",
        [{ cat: catId }, place.expect, { party: n, total: n * head, perHead: head }],
      );
    },
  },
  {
    /** Written with the weather in it, because a plan that got rained out is most of what an indoor search is. */
    why: "the reason, not the request",
    build: (town) => {
      const place = placePhrase(town);
      return turn(
        [pick(["its pouring rain", "we got rained out", "its freezing out"]), place.text, pick(["what can we do", "any ideas", "something indoors"]), chance(0.5) ? partyPhrase().text : null],
        "rained out",
        [place.expect, { cover: "indoor" }],
      );
    },
  },
  {
    /**
     * The whole thing in one long sentence with an "and" between every clause, which is what people write
     * when they are trying to be helpful. Every constraint is present and none of it is punctuated.
     */
    why: "everything at once, joined by and",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const place = placePhrase(town);
      const party = partyPhrase();
      const when = whenPhrase();
      const budget = budgetPhrase(party.expect.party);
      return turn(
        ["we want to do", act.text, place.text, "and there are", `${party.expect.party}`, "of us and its", when.text, "and", budget.text],
        "everything at once",
        [{ cat: catId }, place.expect, party.expect, when.expect, budget.expect],
      );
    },
  },
  {
    /** Capitalised the way a phone capitalises, with a trailing question mark and nothing else punctuated. */
    why: "phone auto-capitalisation and one stray question mark",
    build: (town, catId, label) => {
      const act = activityWord(catId, label);
      const place = placePhrase(town);
      const party = partyPhrase();
      const body = [act.text, place.text, party.text].join(" ");
      return turn([body.charAt(0).toUpperCase() + body.slice(1) + "?"], "phone capitalisation", [{ cat: catId }, place.expect, party.expect]);
    },
  },
];

/** Join the fragments into one sentence and merge everything it states into a single set of expectations. */
function turn(parts: (string | null | undefined)[], why: string, expects: (Expect | undefined)[]): Turn {
  const say = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return { say, why, expect: Object.assign({}, ...expects.filter(Boolean)) as Expect };
}

/**
 * What people say next.
 *
 * The old list was ten tidy phrases, all of them complete sentences and all of them on topic. Real
 * follow-ups are fragments — "cheaper", "tomorrow" — or a flat rejection, or a question about something the
 * shortlist never claimed to answer. The off-topic ones are here on purpose: "do they have parking" must not
 * throw away the town, the activity and the party, which is the failure a guest notices six turns in.
 */
const FOLLOWUPS: { say: (label: string) => string; why: string; expect?: Expect }[] = [
  { say: () => "any other places", why: "asks for more" },
  { say: () => "no not that", why: "a flat rejection with no reason given" },
  { say: () => "cheaper", why: "a bare fragment" },
  { say: () => "too expensive", why: "a complaint, not an instruction" },
  { say: () => "whats the cheapest", why: "a superlative, not a filter" },
  { say: () => "tomorrow", why: "a bare day with no verb", expect: { when: "tomorrow" } },
  { say: () => "what about sunday", why: "a day as a question", expect: { when: "weekend" } },
  { say: () => "do they have anything saturday", why: "a day buried in a question", expect: { when: "weekend" } },
  { say: () => "is there anything at 7", why: "a clock time as a question", expect: { atMinute: 19 * 60 } },
  { say: () => "what about for 10 people", why: "changes the party mid-conversation", expect: { party: 10 } },
  { say: () => "make it 6 people", why: "changes the party as an instruction", expect: { party: 6 } },
  { say: () => "can you do 2 people instead", why: "shrinks the party", expect: { party: 2 } },
  { say: () => "somewhere closer", why: "about distance, which nothing in the answer stated" },
  { say: () => "any earlier times", why: "shifts the clock" },
  { say: () => "something later", why: "shifts the clock the other way" },
  { say: () => "show me more", why: "asks for more" },
  { say: (label) => `actually forget ${label.toLowerCase()}`, why: "withdraws the activity outright", expect: { dropCat: "self" } },
  { say: () => "do they have parking", why: "off topic: nothing in the answer is about parking" },
  { say: () => "is it kid friendly", why: "off topic: a property we do not hold" },
  { say: () => "whats the address", why: "off topic: asks for a detail, not a new search" },
];


/** One graded observation. Kept as data rather than a printed line, so sixty thousand can be grouped. */
type Note = { check: Check; klass: string; ok: boolean; why: string; say: string; tag: string };
const checks = ["aligned", "asks", "priced", "sane", "carried", "fast", "read", "capped"] as const;
type Check = (typeof checks)[number];

/** A price a person could plausibly pay for this, rather than a hoodie or a whole-boat charter. */
function saneFor(cat: string, price: number): boolean {
  if (price < 8) return false;
  const roof: Record<string, number> = {
    escape: 120, axe: 120, bowling: 120, arcade: 90, karaoke: 200, minigolf: 80, trampoline: 90,
    kart: 250, climbing: 120, spa: 500, cooking: 300, brewery: 150, winery: 200,
    jetski: 700, kayak: 300, fishing: 2500, cruise: 1500, heli: 1500, skydive: 700, balloon: 800,
  };
  return price <= (roof[cat] ?? 1200);
}

/** The cheapest per-head figure we put on an option's card, live or from its menu. A room hire is not one. */
function perHeadOf(o: Answer["options"][number]): number | null {
  const all = [
    ...o.departures.map((d) => d.fromPrice).filter((n): n is number => n != null),
    ...o.services.filter((x) => x.per === "person" && x.price != null).map((x) => x.price as number),
  ];
  return all.length ? Math.min(...all) : null;
}

const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

/** A whole conversation, generated from the seed before anything is run, so scheduling cannot change it. */
type Convo = { town: Town; catId: string; turns: Turn[] };

/**
 * Every conversation this seed produces, built up front.
 *
 * Generation has to finish before the first `plan()` call. Conversations are graded in parallel, and if the
 * random stream were still being drawn from while they ran, the sentences would depend on which shop
 * answered first and `--seed=101` would stop meaning anything. That flag is the whole mechanism by which a
 * fix gets checked, so it is worth holding the array in memory.
 */
const convos: Convo[] = [];
for (let k = 0; k < N; k += 1) {
  const town = pick(TOWNS);
  const cats = categoriesIn(town.city, town.region);
  if (!cats.length) continue;
  const catId = pick(cats);
  const label = CATEGORIES.find((c) => c.id === catId)?.label ?? catId;
  const first = pick(SHAPES).build(town, catId, label);

  /**
   * Withdrawing the activity only makes sense when the opener named one. A guest who wrote "whats there to
   * do near detroit" cannot go on to say "actually forget camping", and grading the agent on a sentence
   * nobody would type measures nothing.
   */
  const canFollow = FOLLOWUPS.filter((f) => f.expect?.dropCat !== "self" || first.expect.cat);

  const turns: Turn[] = [first];
  for (let i = 0; i < 1 + Math.floor(rnd() * 2); i += 1) {
    const f = pick(canFollow);
    turns.push({
      say: f.say(label),
      why: f.why,
      expect: f.expect?.dropCat === "self" ? { dropCat: catId } : (f.expect ?? {}),
    });
  }
  convos.push({ town, catId, turns });
}

if (dryRun) {
  for (const c of convos) {
    console.log(`${DIM}${c.town.city}, ${c.town.region} · ${c.catId}${R}`);
    for (const t of c.turns) console.log(`  "${t.say}" ${DIM}(${t.why})${R}`);
  }
  console.log(`\n${DIM}  ${convos.length} conversations, ${convos.reduce((n, c) => n + c.turns.length, 0)} turns, nothing graded${R}`);
  process.exit(0);
}

/**
 * One conversation, start to finish, with its turns strictly in order.
 *
 * Turn three is an answer to turns one and two — "cheaper" means nothing without the list it is complaining
 * about — so nothing inside a conversation may overlap. Between conversations there is no such dependency,
 * and that is where the parallelism goes.
 */
async function grade(c: Convo): Promise<Note[]> {
  const out: Note[] = [];
  let prior: Intent | null = null;
  let firstIntent: Intent | null = null;

  for (const t of c.turns) {
    const say = t.say;
    const note = (check: Check, klass: string, ok: boolean, why: string) =>
      out.push({ check, klass, ok, why, say, tag: t.why });
    const t0 = Date.now();
    let a: Answer;
    try {
      /**
       * `resolve` is the other way plan() reaches the internet, and it is not governed by `ask`: it fetches
       * up to six of the shortlisted businesses' own websites looking for a booking link they have never
       * been crawled for. In production that is right — eight shops is nothing and the finding is kept for
       * good — but it happens on every turn, so a sweep would fetch tens of thousands of sites. It is tied
       * to `--ask` here so that `--ask=0` means what it says: nothing outside this machine is contacted.
       */
      a = await plan(say, { ask: ASK, resolve: ASK > 0, prior, deadlineMs: 9000 });
    } catch (err) {
      note("aligned", "threw", false, (err as Error).message.slice(0, 120));
      break;
    }
    const ms = Date.now() - t0;
    prior = a.intent;
    firstIntent ??= a.intent;
    const e = t.expect;

    note("fast", "slower than a guest waits", ms < 12000, `${ms}ms`);

    /**
     * What the sentence plainly said has to survive the reader. These are not judgement calls: "6 of us" is
     * six, "under $40 each" is forty, "2nite" is tonight, and an agent that answers "assuming two of you"
     * has contradicted the guest in its first line.
     */
    if (e.party != null) {
      note("read", "the head count", a.intent.party === e.party, `said ${e.party} in the sentence, read party of ${a.intent.party}`);
    }
    if (e.when) {
      note("read", "the day", a.intent.when === e.when, `said ${e.when} in the sentence, read "${a.intent.when}"`);
    }
    if (e.perHead != null) {
      // A group budget divided by the party lands a dollar or two off, so the figure only has to be close.
      const got = a.intent.maxPerPerson;
      note("read", "the budget a head", got != null && Math.abs(got - e.perHead) <= Math.max(2, e.perHead * 0.05),
        `budget works out at $${e.perHead} a head, read ${got == null ? "no budget at all" : "$" + got}`);
    }
    if (e.total != null) {
      note("read", "a group budget as a group budget", a.intent.maxTotal === e.total,
        `said $${e.total} for the group, read ${a.intent.maxTotal == null ? "nothing as a group total" : "$" + a.intent.maxTotal}`);
    }
    if (e.atMinute != null) {
      const got = a.intent.atMinute;
      note("read", "the clock time", got === e.atMinute, `asked for ${hhmm(e.atMinute)}, read ${got == null ? "no time at all" : hhmm(got)}`);
    }
    if (e.cover) {
      note("read", "indoors or out", a.intent.cover === e.cover, `the sentence says ${e.cover}, read ${a.intent.cover ?? "no preference"}`);
    }
    if (e.cat) {
      note("read", "the activity", a.intent.categoryId === e.cat, `asked for ${e.cat}, read ${a.intent.categoryId ?? "no activity at all"}`);
    }
    if (e.town || e.somePlace) {
      note("read", "the place", !!(a.intent.city || a.intent.region), `the sentence means ${e.meant ?? "a town"} and no place came out of it`);
    }
    if (e.dropCat) {
      note("read", "an activity they withdrew", a.intent.categoryId !== e.dropCat, `they said to forget ${e.dropCat} and it is still searching for ${e.dropCat}`);
    }

    if (a.followUp) {
      // A blocking question is only right when there is genuinely nowhere to search.
      note("asks", "blocked on a question it did not need to ask", !a.intent.city && !a.intent.region,
        `blocked with a question although it knew ${a.intent.city ?? a.intent.region}`);
      // And when they named nowhere, that question has to arrive with towns to tap rather than an empty box.
      if (e.noPlace) {
        note("asks", "a question with an empty box", a.followUp.why !== "place" || a.followUp.choices.length > 0, "asked where they are and offered nothing to tap");
      }
      continue;
    }
    if (e.noPlace) {
      note("asks", "answered without being told where", false, "named no place at all and it answered anyway, so the places it chose came from nowhere");
    }

    note("aligned", "nothing at all, and no question either", a.options.length > 0, "no businesses and no question");

    if (a.intent.categoryId && a.options.length) {
      const onTopic = a.options.filter((o) => o.category === a.intent.categoryId).length;
      note("aligned", "a different activity, silently", onTopic > 0 || !!a.loosened,
        `asked for ${a.intent.categoryId} and got ${[...new Set(a.options.map((o) => o.category))].join(", ")} with nothing said about it`);
    }

    /**
     * Where it was asked for, in kilometres. Only when the sentence named the town *and* its state or
     * province, because a bare "waterloo" is genuinely ambiguous and picking a different real one is a
     * question to ask rather than a mistake to catch. The median is taken rather than the nearest, so one
     * lucky row cannot cover for a shortlist that is otherwise in the wrong state.
     */
    const anchor = e.town;
    if (anchor && a.options.length) {
      const far = a.options.map((o) => pointOf(o.domain)).filter((p): p is { lat: number; lon: number } => !!p).map((p) => km(p, anchor));
      if (far.length) {
        const median = far.sort((x, y) => x - y)[Math.floor(far.length / 2)];
        // The search widens from 40 km to 120 and says so; anything past that is a different place entirely.
        note("aligned", "the wrong town", median <= (a.loosened ? 220 : 140),
          `asked in ${anchor.city} ${anchor.region} and the middle of the shortlist is ${median.toFixed(0)} km away`);
      }
    }

    if (a.options.length) {
      const priced = a.options.filter((o) => o.services.some((x) => x.price != null) || o.departures.some((d) => d.fromPrice != null));
      note("priced", "a shortlist with no prices on it", priced.length > 0, `${a.options.length} businesses, not one price`);

      const wild = a.options.flatMap((o) =>
        o.services
          .filter((x) => x.price != null && x.per === "person" && !saneFor(o.category, x.price))
          .map((x) => `${o.name}: $${x.price} "${x.name}" as a ${o.category} price`),
      );
      note("sane", "a price nobody pays for this", wild.length === 0, wild.slice(0, 2).join("; "));

      /**
       * A budget the agent accepted has to bite. It reads the cap, prints it back to the guest, and then a
       * $207.70 helicopter seat under "under $50 a head" is not a near miss, it is the answer ignoring the
       * one number the guest cared about. Only prices we actually show are counted, and only when the
       * search was not loosened, since loosening is said out loud.
       */
      if (a.intent.maxPerPerson != null && !a.loosened) {
        const cap = a.intent.maxPerPerson;
        const over = a.options
          .map((o) => ({ o, p: perHeadOf(o) }))
          .filter((x) => x.p != null && x.p > cap * 1.01)
          .map((x) => `${x.o.name} at $${x.p} a head`);
        note("capped", "over the budget it had just accepted", over.length === 0, `cap is $${cap} a head and it offered ${over.slice(0, 2).join(", ")}`);
      }
    }

    // Anything this activity needs and the sentence did not carry should be offered, not silently assumed.
    if (a.options.length && !a.narrow && (a.intent.assumed || []).length) {
      note("asks", "guessed without offering a way to correct it", false, `assumed ${(a.intent.assumed || []).join(" and ")} and offered no way to correct it`);
    } else if (a.options.length) {
      note("asks", "guessed without offering a way to correct it", true, "");
    }

    /**
     * A follow-up is half a sentence. Everything it does not mention is still true, and the guest will not
     * say it again. Losing the town is the loudest version; losing the activity or the party is the same
     * failure quieter, and "do they have parking" is the turn most likely to cause it.
     */
    if (firstIntent !== a.intent) {
      note("carried", "lost the town on a follow-up", !(firstIntent.city && !a.intent.city && !a.intent.region), `started in ${firstIntent.city} and lost the place`);
      if (firstIntent.categoryId && !e.dropCat) {
        note("carried", "lost the activity on a follow-up", a.intent.categoryId === firstIntent.categoryId || !!a.intent.genre,
          `started on ${firstIntent.categoryId} and left it with ${a.intent.categoryId ?? "no activity"}`);
      }
      if (e.party == null && firstIntent.party > 2) {
        note("carried", "lost the head count on a follow-up", a.intent.party === firstIntent.party,
          `they said ${firstIntent.party} of them and it went back to ${a.intent.party}`);
      }
    }
  }
  return out;
}

/**
 * Conversations run side by side; their turns do not.
 *
 * Turns within one conversation are strictly in order, because turn three is an answer to turns one and two.
 * Between conversations there is no dependency at all, so they are spread over as many processes as `--jobs`
 * asks for. Each result is filed under the index its conversation was generated at and they are merged in
 * that order, so the report never depends on which one finished first.
 */
const inFlight = ASK ? 4 : 1;

async function gradeSlice(): Promise<{ i: number; notes: Note[] }[]> {
  const mine = convos.map((c, i) => ({ c, i })).filter(({ i }) => i % SHARDS === SHARD);
  const out: { i: number; notes: Note[] }[] = new Array(mine.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(inFlight, mine.length)) }, async () => {
      for (;;) {
        const k = next;
        next += 1;
        if (k >= mine.length) return;
        out[k] = { i: mine[k].i, notes: await grade(mine[k].c) };
        // The parent counts these to show progress; a run that prints nothing for ten minutes looks hung.
        if (isChild) process.stdout.write(JSON.stringify(out[k]) + "\n");
      }
    }),
  );
  return out;
}

if (isChild) {
  await gradeSlice();
  process.exit(0);
}

const results: Note[][] = new Array(convos.length);
const startedAt = Date.now();
let finished = 0;
const tick = () => {
  finished += 1;
  if (convos.length >= 100 && finished % Math.ceil(convos.length / 20) === 0) {
    process.stderr.write(`${DIM}  ${finished}/${convos.length} conversations, ${((Date.now() - startedAt) / 1000).toFixed(0)}s${R}\n`);
  }
};

if (JOBS <= 1 || convos.length < 16) {
  for (const { i, notes } of await gradeSlice()) { results[i] = notes; tick(); }
} else {
  /**
   * The children are this same file, invoked the way this process was invoked, so whatever loader is in
   * play — tsx here — is in play for them too. They stream one JSON line per conversation as it finishes,
   * which doubles as the progress meter and keeps the parent from holding a ten-thousand-line buffer per
   * child until the very end.
   */
  const { spawn } = await import("node:child_process");
  /**
   * Starting a process costs about four seconds of module loading, so eight of them for twenty
   * conversations is slower than not bothering. At least eight conversations each before another is spawned.
   */
  const workers = Math.max(1, Math.min(JOBS, Math.ceil(convos.length / 8)));
  await Promise.all(
    Array.from({ length: workers }, (_, k) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [...process.execArgv, process.argv[1], ...args.filter((a) => !a.startsWith("--shard=")), `--shard=${k}/${workers}`],
          { stdio: ["ignore", "pipe", "inherit"] },
        );
        let buf = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          buf += chunk;
          let nl = buf.indexOf("\n");
          while (nl >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line.trim()) {
              const row = JSON.parse(line) as { i: number; notes: Note[] };
              results[row.i] = row.notes;
              tick();
            }
            nl = buf.indexOf("\n");
          }
        });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`shard ${k} exited ${code}`))));
      }),
    ),
  );
}

const notes = results.flatMap((r) => r ?? []);

/**
 * The spread, printed rather than assumed. A score from a sample nobody can see is the same shape of claim
 * as measuring one business and calling it evidence, and the pool it draws from is 60 Canadian towns and 60
 * American ones, so a run that happened to land in one province should say so out loud.
 */
const ca = convos.filter((x) => CA_REGIONS.includes(x.town.region)).length;
const regions = new Set(convos.map((x) => x.town.region));
console.log(
  `\n${BOLD}sampled${R}  ${new Set(convos.map((x) => x.town.city + x.town.region)).size} towns across ` +
    `${regions.size} states and provinces, ${ca} Canadian and ${convos.length - ca} US, ` +
    `${new Set(convos.map((x) => x.catId)).size} different activities, ` +
    `${convos.reduce((n, c) => n + c.turns.length, 0)} turns\n` +
    `  ${DIM}${[...regions].sort().join(" ")}${R}\n`,
);

console.log(`${BOLD}score${R}`);
let totalPass = 0, totalAll = 0;
for (const c of checks) {
  const mine = notes.filter((n) => n.check === c);
  if (!mine.length) continue;
  const pass = mine.filter((n) => n.ok).length;
  totalPass += pass;
  totalAll += mine.length;
  const pctN = (pass / mine.length) * 100;
  const colour = pctN >= 95 ? GREEN : pctN >= BAR ? AMBER : RED;
  console.log(`  ${c.padEnd(9)} ${colour}${pctN.toFixed(0).padStart(3)}%${R} ${DIM}${pass}/${mine.length}${R}`);
}
const overall = totalAll ? (totalPass / totalAll) * 100 : 0;
console.log(`  ${BOLD}overall   ${overall >= BAR ? GREEN : RED}${overall.toFixed(0)}%${R}${DIM}  ${totalPass}/${totalAll}${R}`);

const broke = notes.filter((n) => !n.ok);
if (broke.length) {
  /**
   * Grouped by what broke, not by what broke first.
   *
   * Ten thousand conversations produce thousands of failure lines and nobody reads them in order. Four
   * hundred sentences that all lost the head count are one bug and one afternoon; a list of four hundred
   * lines is neither. The counts answer "what is most broken", the examples say it in the guest's own
   * words, and the whole list is still there behind --failures for whoever is actually fixing one.
   */
  const groups = new Map<string, Note[]>();
  for (const n of broke) {
    const key = n.check + " | " + n.klass;
    const g = groups.get(key);
    if (g) g.push(n);
    else groups.set(key, [n]);
  }
  console.log(`\n${BOLD}what went wrong${R} ${DIM}(${broke.length} across ${groups.size} classes)${R}`);
  for (const [key, ns] of [...groups].sort((x, y) => y[1].length - x[1].length)) {
    const [check, klass] = key.split(" | ");
    console.log(`  ${RED}${check}${R} ${klass} ${DIM}×${ns.length}${R}`);
    for (const n of ns.slice(0, 3)) console.log(`      "${n.say}" ${DIM}(${n.tag})${R}\n        ${n.why}`);
  }
  if (onlyFailures) {
    console.log(`\n${BOLD}every failure${R} ${DIM}(${broke.length})${R}`);
    for (const n of broke) console.log(`  ${RED}${n.check}${R} ${n.klass}  "${n.say}" ${DIM}(${n.tag})${R}\n        ${n.why}`);
  } else {
    console.log(`\n  ${DIM}pass --failures for every one of them${R}`);
  }
}

process.exit(overall >= BAR ? 0 : 1);
