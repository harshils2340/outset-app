/**
 * Markdown left in the words a guest reads.
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

/** The words of a crawled line, with any markdown syntax taken back out. */
export function stripMarkdown(text: string): string {
  if (!text || !/[[\]#]/.test(text)) return text;
  let out = text.replace(IMAGE, " ").replace(LINK, "$1");
  // A heading marker glued to a word ("Location##") keeps the word; one standing alone leaves a single space.
  out = out.replace(HEADING, (_m, before: string) => (before && !/\s/.test(before) ? before : " "));
  return out.replace(DANGLING, "").replace(/\s{2,}/g, " ").trim();
}
