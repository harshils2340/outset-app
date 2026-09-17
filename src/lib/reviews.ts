/**
 * The operator's published reviews as a guest reads them.
 *
 * The crawl takes whatever sat around the quotes on the operator's own page, so along with the reviews it brings
 * the page's furniture: the comment form under them ("Your email address will not be published"), a banner
 * selling the thing ("JOIN OUR TOP-RATED CRUISES"), the site's own labels in the author slot ("Name *", a link to
 * their Instagram, a job title glued to a first name). None of that is a guest talking, and a card that prints it
 * reads as though we made it up. Every field here is shown only when it really is a review, a name, a date, a
 * source or a rating. Nothing is filled in: no name means no name.
 *
 * This lives in `src/lib` rather than beside the card that draws it so it can be held to the shipped catalog in a
 * test; `WebListing.tsx` imports CSS, which no test can load.
 */

export type ShownReview = { key: string; name: string | null; initial: string | null; when: string | null; source: string | null; stars: number | null; text: string };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SOURCES: [RegExp, string][] = [[/trip\s*advisor/i, "Tripadvisor"], [/google/i, "Google"], [/yelp/i, "Yelp"], [/facebook/i, "Facebook"], [/^peek/i, "Peek"], [/fareharbor/i, "FareHarbor"], [/viator/i, "Viator"], [/getyourguide/i, "GetYourGuide"]];
const sourceOf = (s: string) => SOURCES.find(([re]) => re.test(s))?.[1] || null;
/** A platform named as "google" or "tripadvisor" reads "Google", "Tripadvisor"; "site" (the operator's own) names none. */
const platformName = (s: string) => (/^(site|own|website)$/i.test(s.trim()) ? null : sourceOf(s) || (/^[a-z][a-z .-]{1,24}$/i.test(s.trim()) ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1) : null));
const GLOWING = /\b(amazing|awesome|great|best|fantastic|wonderful|recommend|loved?|excellent|perfect|fun|memorable|highlight|incredible|enjoyed|beautiful|thank)/i;
const SOUR = /\b(disappoint|terrible|worst|rude|never again|waste|awful|horrible|refund|not recommend|avoid|unprofessional|bad\b|poor\b)/i;
/**
 * Not a guest talking. The first group is the shop's own voice selling to a visitor; the second is the comment
 * form that sits under the reviews on a WordPress page, which is furniture, not a review. "BOOK ONLINE NOW" needs
 * no word boundary in front of it because the crawl glues it to the line above ("Everyday at 8 amBOOK ONLINE NOW!").
 */
const NOT_A_REVIEW = /\b(leave us a|read (?:all|more) reviews|verified reviews from|is trusted by|we offer|we set the standard|tired of|click here|join our|we will have you)\b|book\s+(?:online|now)\b|\bfollow (?:us|our)\b[^.!?]{0,20}\b(?:ig|instagram|facebook|fb|tiktok|socials?|page)\b|your email address will not be published|required fields are marked|save my name,? *email|\bpost comment\b|\bleave a (?:comment|reply)\b/i;
const NOT_A_NAME = /^(customer name|customer|anonymous|name|read more|testimonials?|reviews?|get in touch|google( reviews?| review)?|goggle|yelp!?|trip ?advisor|facebook|verified .*|guest|a guest|client|what|different|great|amazing|awesome|excellent|wonderful|fantastic|best|fun|highly recommend(ed)?|\d+(\.\d+)?)$/i;
/** A link, a handle or an address is the shop's, not the reviewer's: an Instagram URL is nobody's name. */
const NOT_A_PERSON = /https?:\/\/|www\.|@|\.(?:com|net|org|ca|co\.uk|io)\b/i;
/**
 * The site's own label, run onto the end of the name because the markup had no space in it: "Laura G.Rating: 5",
 * "Hayley GermanRating: 5", "Jake M.Manager", "AvaSoftware Engineer". Longer titles come first so the whole of one
 * is taken, not its last word.
 */
const LABEL_TAIL = /\s*(?:Rating|Reviews?|Verified(?: Buyer| Customer| Guest)?|Posted|Source)\b.*$|(?:Software Engineer|Product Manager|Marketing Manager|General Manager|Executive|Engineer|Designer|Developer|Consultant|Manager|Director|Founder|President|Owner|CEO|CTO|COO|CFO)\s*$/;

/** Dates are stored as ISO "2025-03-14" or "2025-03" and read "March 2025". Anything else is treated as no date. */
function reviewDate(raw: string): string | null {
  const iso = raw.trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!iso || +iso[2] < 1 || +iso[2] > 12) return null;
  return MONTH_NAMES[+iso[2] - 1] + " " + iso[1];
}

/**
 * The operator's published reviews as Airbnb review cards. The crawl picks up a site's labels along with the reviews
 * ("Customer Name", "TripAdvisor", "via Google", a headline before the quote), so each field is shown only when it
 * really is a name, a date, a source or a rating. Nothing is filled in: no name means no name, and a low star count
 * stored against plainly glowing words is a parsing slip, so its number is not shown.
 */
export function shownReviews(quotes: { author?: string; rating?: number; text: string; date?: string; source?: string }[] | undefined, business: string): ShownReview[] {
  const out: ShownReview[] = [];
  const seen = new Set<string>();
  for (const q of quotes || []) {
    let text = decodeText(q.text)
      .replace(/^(?:review)?ed on:\s*\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s*/i, "")
      .replace(/^recommends(?=[A-Z])/, "")
      .replace(/^[\s…."“”'‘’]+/, "")
      .replace(/[\s"“”]+$/, "")
      .replace(/\s*(?:Read more|See more|More)\s*$/i, "");
    // "Best part of our Siesta trip " The gracious...": a headline, then the quote.
    text = text.replace(/^(.{4,70}?[^\s])\s+["“”]\s+/, (_m, head: string) => (/[.!?]$/.test(head) ? head + " " : head + ". "));
    text = tidySentence(text);
    const key = text.toLowerCase().slice(0, 80);
    if (text.length < 25 || NOT_A_REVIEW.test(text) || seen.has(key)) continue;
    if (text.toLowerCase().startsWith(business.toLowerCase() + " is ")) continue;
    seen.add(key);
    // A trailing "*" is the comment form's required-field mark ("Name *"), not part of anyone's name.
    let author = q.author && !/[<>]/.test(q.author) ? decodeText(q.author).replace(/^name:\s*/i, "").replace(LABEL_TAIL, "").replace(/[\s/|,:;\-–*]+$/, "").trim() : "";
    let source = author ? sourceOf(author) : null;
    if (source && author.split(/\s+/).length <= 3 && NOT_A_NAME.test(author.replace(/\breviews?\b/i, "").trim() || author)) author = "";
    if (author && (NOT_A_NAME.test(author) || NOT_A_PERSON.test(author) || author.split(/\s+/).length > 3 || author.toLowerCase() === business.toLowerCase() || business.toLowerCase().includes(author.toLowerCase()) || /\b(guides?|adventure|tours?|experience|service|inc|llc|ltd)\b/i.test(author))) author = "";
    if (author && author === author.toUpperCase() && author.length > 3) author = author.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
    if (q.source) source = platformName(q.source);
    // Older files carried the platform in the date field ("via Google"); that is a source, and no date.
    else if (q.date && /^via\s/i.test(q.date)) source = source || sourceOf(q.date);
    const when = q.date ? reviewDate(q.date) : null;
    let stars = typeof q.rating === "number" && q.rating >= 1 && q.rating <= 5 ? Math.round(q.rating) : null;
    if (stars != null && stars <= 3 && GLOWING.test(text) && !SOUR.test(text)) stars = null;
    out.push({ key: key + out.length, name: author || null, initial: author ? (author.match(/[A-Za-z0-9]/)?.[0] || "").toUpperCase() || null : null, when, source, stars, text });
  }
  return out;
}

function decodeText(s: string): string {
  const el = typeof document !== "undefined" ? document.createElement("textarea") : null;
  if (!el) return s;
  el.innerHTML = s.replace(/<[^>]*>/g, " ");
  return el.value.replace(/\s+/g, " ").trim();
}

/** Review text keeps the guest's own voice: only spacing and a lowercase first letter are touched. */
function tidySentence(s: string): string {
  const t = s.replace(/\s+([,.;:!?)])(?=\s|$)/g, "$1").replace(/\s{2,}/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
