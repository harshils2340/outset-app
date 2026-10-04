/**
 * Whether a shop's own published words say a young child can come.
 *
 * `null` is the honest third answer: the site says nothing about it. That is not "yes", and the caller has to
 * decide what an unanswered listing is, because the search filter promises the guest "Only places whose
 * published rules allow younger kids".
 *
 * Both sides read this one rule. The browse catalog ships lite records, whose `specs`, `gap` and `extraNote`
 * are all emptied on purpose so the file stays small, and those three fields are the whole of what the rule
 * reads. So `npm run sync` runs it over the full record and carries the verdict forward as `kid`.
 */

/**
 * The shop says an adult, or close to one: a guest filtering for children must not be shown it.
 *
 * "Adult only" in the singular, with "an" in front of it, is the other sentence entirely: Shepler's ferry
 * writes "children under 5 travel free but must be accompanied by an adult", and the crawl glued the next line
 * ("Only trained service animals permitted") on to the end of it. So the one phrase that reads as a floor only
 * in the plural is refused the article that makes it an escort.
 */
const ADULTS_ONLY = /\b(18\+|18 and (up|over|older)|adults only|(?<!\ban )(?<!\ba )adult only|21\+|must be 18|minimum age(:| is)? ?(1[2-9]|2\d))/;
/** A stated age range starting in single digits, or the shop's own family words. */
const AGE_RANGE = /\bages? ?(\d|[1-9]) ?(\+|and up|to|-)/;
const FAMILY_WORD = /kid|child|family|all ages/;

/** The fields the rule reads, in the order it reads them. A lite record carries none of the first three. */
export function kidRuleText(u: { specs?: string[]; gap?: string; extraNote?: string; tags?: string[] }): string {
  return [...(u.specs || []), u.gap || "", u.extraNote || "", ...(u.tags || [])].join(" ").toLowerCase();
}

/**
 * The age of the grown-up a child has to bring, which is not a floor on the child.
 *
 * "Children (17 and under) must be accompanied and supervised by an adult (18+) at all times" is a shop saying
 * children are welcome, and the rule above read its "18+" as the shop saying the opposite: Legoland Discovery
 * Center, a tubing run whose own line is "every group must include at least one adult (18+) to supervise
 * minors", a climbing gym that asks for one adult per two children, and an action park whose under-18s come
 * with a parent were all refused to a guest filtering for younger kids. The signature a courier needs for a
 * wine delivery is the same mistake with a different grown-up. Twelve shipped listings read the other way
 * round once the clause is set aside, and six more fall back to their kind with nothing stated either way.
 *
 * So the clause is taken out of the text before the floor is read, rather than the listing being let through:
 * a shop that states an adult floor anywhere else still states one, which is what keeps a 21+ bar night and
 * "public cruises are 21+ or 18+ if accompanied by an adult" refused on the lines that are about the guest.
 */
const ESCORT = "\\b(?:accompan\\w+|supervis\\w+|chaperon\\w+|signature|signs?|signed|signing|to sign|present)\\b";
const GROWN_UP = "\\b(?:adults?|guardians?|parents?)\\b";
const ADULT_AGE = "\\(? ?(?:1[89]|2[01]) ?\\+? ?\\)?";
const ESCORT_AGE = new RegExp(
  `${ESCORT}[^.;]{0,48}?${GROWN_UP}[^.;]{0,14}?${ADULT_AGE}` + `|${GROWN_UP}[^.;]{0,14}?${ADULT_AGE}[^.;]{0,24}?${ESCORT}`,
  "g",
);

/** true: children are welcome. false: the shop states an adult floor. null: their site does not say. */
export function kidVerdict(text: string): boolean | null {
  const t = text.toLowerCase().replace(ESCORT_AGE, " ");
  if (ADULTS_ONLY.test(t)) return false;
  if (AGE_RANGE.test(t) || FAMILY_WORD.test(t)) return true;
  return null;
}
