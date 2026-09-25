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

/** The shop says an adult, or close to one: a guest filtering for children must not be shown it. */
const ADULTS_ONLY = /\b(18\+|18 and (up|over|older)|adults? only|21\+|must be 18|minimum age(:| is)? ?(1[2-9]|2\d))/;
/** A stated age range starting in single digits, or the shop's own family words. */
const AGE_RANGE = /\bages? ?(\d|[1-9]) ?(\+|and up|to|-)/;
const FAMILY_WORD = /kid|child|family|all ages/;

/** The fields the rule reads, in the order it reads them. A lite record carries none of the first three. */
export function kidRuleText(u: { specs?: string[]; gap?: string; extraNote?: string; tags?: string[] }): string {
  return [...(u.specs || []), u.gap || "", u.extraNote || "", ...(u.tags || [])].join(" ").toLowerCase();
}

/** true: children are welcome. false: the shop states an adult floor. null: their site does not say. */
export function kidVerdict(text: string): boolean | null {
  const t = text.toLowerCase();
  if (ADULTS_ONLY.test(t)) return false;
  if (AGE_RANGE.test(t) || FAMILY_WORD.test(t)) return true;
  return null;
}
