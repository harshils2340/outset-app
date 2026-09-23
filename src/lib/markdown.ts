/**
 * Markdown, and HTML, left in the words a guest reads.
 *
 * The enrichment pass keeps a page's text as the page wrote it, and a fair number of operators write their
 * arrival notes, policies and FAQ answers in markdown. Nothing between the crawl and the listing page took the
 * syntax back out, so 54 lines across the shipped catalog reached a guest with it still in: a boat rental told
 * them "FAQs [Read our full list of FAQs here.](https://www.rental.bigmmarina.com/faqs)", another gave its
 * check-in address as "Check in Location## [2200 Lakeshore Blvd, Lakeport CA, 95453](https://share.google/...)",
 * and a charter's arrival note read, in full, "Connect with Holoholo Charters [![TikTok](https://".
 *
 * The last of those is the other half of it: the crawl cuts a note at 400 characters, which lands inside a link
 * as often as anywhere else, so a guest was left with a bracket, a label and half a URL.
 *
 * A link is worth its words and an image is worth none, so that is what each becomes. Heading markers go.
 * Nothing else is touched, and in particular a bare bracket is left alone: 20 lines write a conversion in one
 * ("-15 F [-26 C]") and that is a parenthesis, not a link.
 */

/** `![alt](url)`, and the same cut off mid-URL by the crawl's 400-character cap. An image is not words. */
const IMAGE = /!\[[^\]]*\]\((?:[^)\s]*\)|[^)\s]*$)/g;

/** `[text](url)`, and the same cut off mid-URL. The words stay, the address goes. */
const LINK = /\[([^\]]*)\]\((?:[^)\s]*\)|[^)\s]*$)/g;

/** `##` at the start of a line or glued to the word before it, which is how the crawl flattens a heading. */
const HEADING = /(^|\s|\S)#{1,6}(?=\s|$)/g;

/**
 * A bracket the 400-character cut left open, with no `]` after it anywhere. "Connect with Holoholo Charters
 * [![TikTok](https://" keeps the image out by the rule above and would otherwise still end on a lone `[`.
 * A closed bracket is left alone, because 20 lines use one for a conversion ("-15 F [-26 C]").
 */
const DANGLING = /\s*\[[^\]]*$/;

/**
 * A run of two or more asterisks: markdown's bold, or the decoration a shop writes for the same reason. 123
 * shipped lines carry one, and both readings are syntax rather than words, so a guest read "**SPRING-SUMMER-FALL**
 * Enjoy a cool drink", "Complimentary **local** pick up" and "** PLEASE NOTE THAT THIS TOUR IS VERY WEATHER
 * DEPENDENT**". It leaves a space, because a run is as often between two words as around one: a market stall
 * writes "...IN PIONEER SQUARE******SPACE SIZES VARY***" and the two words are not one.
 *
 * A single asterisk is left alone. It is a bullet as often as an emphasis ("Included: * FREE PARKING LOT * 50
 * black Chiavari chairs"), and taking it out of that line runs the items together.
 */
const BOLD = /\*{2,}/g;

/** The words of a crawled line, with any markdown syntax taken back out. */
export function stripMarkdown(text: string): string {
  if (!text || !/[[\]#*]/.test(text)) return text;
  let out = text.replace(IMAGE, " ").replace(LINK, "$1").replace(BOLD, " ");
  // A heading marker glued to a word ("Location##") keeps the word; one standing alone leaves a single space.
  out = out.replace(HEADING, (_m, before: string) => (before && !/\s/.test(before) ? before : " "));
  return out.replace(DANGLING, "").replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/**
 * An HTML tag in the same words. Nothing here renders markup, so a tag reaches a guest as its own characters.
 *
 * Viator writes a cancellation policy as one paragraph with `<br>` between its refund tiers, so 60 shipped
 * partner listings read "you will receive a full refund.<br>If you cancel between 2 and 6 day(s)" on the
 * listing page, in the phone sheet and out of Otto's mouth. Six more listings carry what an operator's own
 * editor left in a service description: a Word paste's `<p class="MsoNormal">`, a WordPress date template, and
 * a pair of TinyMCE bookmark spans that are the whole of one camp's "In Program" description.
 *
 * A tag needs a letter after the bracket, so the arithmetic a shop writes is left alone: "under 5' <6 ft" and
 * "hulls <2 years old" are not markup. A tag that ends a line becomes a space and one inside a word becomes
 * nothing, which is the difference between "a full refund.<br>If you cancel" and "BOTOX<sup>®</sup>": eleven
 * review cards were signed "<strong>Gerald E." and would otherwise be signed " Gerald E.".
 */
const TAG = /<\/?([a-z][a-z0-9]*)(?:\s[^<>]*)?\/?>/gi;
/** The tags that are a line of their own, or the end of one. Everything else marks up words inside a line. */
const BLOCK = /^(?:br|p|div|li|ul|ol|dl|dd|dt|tr|td|th|table|thead|tbody|h[1-6]|section|article|aside|header|footer|blockquote|hr|pre)$/i;
/**
 * A tag the crawl lost the `>` from. Both ends of a line, and nothing in between, because the words that
 * follow an opening one are the line itself: six blurbs open "<p History of Aeolian Hall The Early Years" and
 * "<div Our campground has everything you need", and taking the bracket to the end of the string would leave a
 * shop with no description at all. So the front gives up the tag name alone, and the back only a remnant whose
 * words are attributes: one campground's service description ends "in <a href="%6$s"".
 */
const OPEN_TAG = /^<\/?[a-z][a-z0-9]*(?=\s|$)/i;
const DANGLING_TAG = /\s*<\/?[a-z][a-z0-9]*(?:\s+[a-z][a-z0-9-]*=(?:"[^"<>]*"?|'[^'<>]*'?|[^\s<>]+)){0,6}\s*$/i;

export function stripTags(text: string): string {
  if (!text || !text.includes("<")) return text;
  return text
    .replace(TAG, (_m, name: string) => (BLOCK.test(name) ? " " : ""))
    .replace(OPEN_TAG, "")
    .replace(DANGLING_TAG, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
