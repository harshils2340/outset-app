/**
 * A bare "N+" as a shop writes an age, and the many things those same two characters count instead.
 *
 * This lives on its own because two readers need the same rule and cannot import each other: `minAge` in
 * `listingDerive.ts`, which reads the floor a listing prints in its key facts, and `listingFacts` in
 * `catalog.ts`, which decides whether a published line belongs under "Who can go" at all. `listingDerive`
 * already imports `catalog`, so the shared rule goes in a third file, the way `groupSize.ts` already does for
 * the guest picker's ceiling.
 */

/**
 * A bare "21+" with no age word beside it, which is how a shop most often writes the rule ("Adults only 18+",
 * "This experience is 21+"). Those same two characters also count people, miles, nights, course units, a
 * phone's software version and a tennis rating, and the fallback below read every one of them as somebody's
 * age: 55 shipped listings printed "Ages N+" off a line that names no age at all. "Supported devices: iPhone
 * with iOS 15+" put "Ages 15+" on 22 self-guided tours, "Additional Cost For Groups Of 7+ Passengers" put
 * "Ages 7+" on 19 charters, "Groups of 4+ may be split into multiple helicopters" put "Ages 4+" on 5 flights,
 * and "Not recommended for travelers who cannot walk 3+ miles" put "Ages 3+" on a walking tour.
 *
 * So the number has to be counting years. It is not when the words right after it say what it counts, and it
 * is not when the words in front of it do. A decimal's tail is not a number of its own either: "USTA rating
 * 3.5+" was read as an age of 5. "N+ years" stays an age unless the years are of experience rather than of
 * life, which is the one phrase that uses the same word for something else: a shop counting its own years
 * writes them a dozen ways ("15+ years operating", "16+ years as a guide", "20+ years local knowledge"), and
 * the one thing none of them does is put the guest's own business after the word.
 */
const PLUS_COUNTS =
  /^\s*(?:tax|people|persons?|passengers?|players?|guests?|pax|travell?ers?|paddlers?|anglers?|miles?|mi|km|kms|kilomet(?:er|re)s?|feet|ft|foot|inch(?:es)?|lbs?|pounds?|kg|mph|kph|%|units?|credits?|nights?|days?|weeks?|months?|hours?|hrs?|min(?:ute)?s?|years?\s+(?:of\s+)?(?:[a-z][a-z-]*\s+){0,2}(?:experience|training|knowledge|expertise)|years?\s+(?:of\s+)?(?:boating|riding|teaching|guiding|fishing|operating|running|serving|combined|local|blending|in|on|as|and))\b/i;
/**
 * The shop counting its own stock rather than anybody's age: "20+ craft beers brewed on-site", "16+ taps at
 * each location", "17+ games". One word may sit between, because the shop describes the thing as well as
 * counting it, and that word is never a preposition, which is what follows a real age: "21+ with valid ID".
 */
const PLUS_THINGS =
  /^\s*(?:(?!(?:with|for|to|and|or|only|after|per|in|on|at|if|from|under|over|plus|valid|government)\b)[a-z][a-z-]*\s+)?(?:beers?|ales?|wines?|brews?|taps?|tickets?|bottles?|games?|lanes?|holes?|styles?|flavou?rs?|categories|pages?|bays?|acres?|studios?|vehicles?|magazines?|awards?|championships?|locations?|vendors?|classes|skis?)\b/i;
const PLUS_COUNTED = /(?:groups?|part(?:y|ies)|teams?|planning)\s+(?:of|for)\s*$|\b(?:ios|android|version|level|rating|grade|size)\s*$/i;

/** The first "N+" in a line that is counting years rather than anything else. */
export function barePlusAge(line: string): number | null {
  for (const m of line.matchAll(/(?<![\d.])(\d{1,2})\s*\+/g)) {
    const after = line.slice(m.index + m[0].length);
    const before = line.slice(0, m.index);
    if (PLUS_COUNTS.test(after) || PLUS_THINGS.test(after) || PLUS_COUNTED.test(before)) continue;
    return Number(m[1]);
  }
  return null;
}

/** Who the rule is about, when the shop names them in front of the number: "guests 21+", "an adult 19+". */
const PLUS_PERSON =
  "adults?|guests?|riders?|drivers?|operators?|renters?|passengers?|patrons?|visitors?|customers?|persons?|people|teens?|seniors?|students?|members?|parents?|guardians?|anyone|everyone|someone|somebody|those|individuals?|volunteers?|anglers?|jumpers?|paddlers?|males?|females?|spectators?";
/**
 * A line states an age with a bare "N+" when it also says whose age it is: the rule opens the line or a
 * clause of it ("18+ with valid photo ID required to drive"), a person word sits in front of the number
 * ("Alcohol served only to guests 21+"), or the sentence is about being that old ("Must be 21+ to attend").
 * Without one of those the number is sizing a group or a purchase, which is the shape every wrong reading
 * takes: "Field trips for groups 10+ require booking", "8+ tickets $1 off each", "10+ paying riders".
 */
const PLUS_AGE = new RegExp(
  "(?:^|[(;]\\s*)\\s*\\d{1,2}\\s*\\+" +
    "|\\b(?:must be|has to be|need(?:s)? to be|at least|aged?|ages?|be|is|are)\\s*(?:[a-z]+\\s+){0,2}\\d{1,2}\\s*\\+" +
    "|\\b(?:" +
    PLUS_PERSON +
    ")\\b\\s*(?:[a-z]+\\s+){0,2}\\d{1,2}\\s*\\+",
  "i",
);

/**
 * Whether a published line states an age through a bare "N+", which is the question "Who can go" asks of a
 * line that carries no age word at all.
 *
 * The column used to ask for `\d+\+` inside a `\b(...)\b`, and the trailing boundary made that alternative
 * read the wrong lines and only the wrong ones: "21+" and "18+" end at a space or a full stop, where there is
 * no word boundary after the "+", so every bare age rule missed the column and was printed as a selling
 * highlight instead. What did match was a number glued to a word, which is a fee or a speed and never an age:
 * "$50+tax", "$40+tax", "$300+taxes", "$65+GST" and "35+mph" were the seven lines the column carried.
 */
export function statesAPlusAge(line: string): boolean {
  const n = barePlusAge(line);
  return n != null && n >= 2 && n <= 21 && PLUS_AGE.test(line);
}
