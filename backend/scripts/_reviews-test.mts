import { harvestReviews } from "../src/enrich/sitescrape.ts";
import { selectReviews, parseReviewDate, cleanAuthor, type Review } from "../src/sync/reviews.ts";
import { quotesFromFacts } from "../src/sync/quotes.ts";

/**
 * Offline checks for review harvesting and the review rules. No network, no database.
 *   npx tsx scripts/_reviews-test.mts
 */

const URL_ = "https://example-charters.com/reviews";
const NOW = new Date();

type Expect = {
  count?: number;
  min?: number;
  first?: Partial<Review>;
  none?: RegExp;
  some?: (rs: Review[]) => boolean;
  aggregate?: { rating: number; count: number } | null;
};

const LONG = "We had the best time on the sunset cruise. Captain Mike was friendly and knew every dolphin by name!";

const FIXTURES: [string, string, Expect][] = [
  [
    "jsonld: Review objects with author, rating, date",
    `<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Example Charters","review":[{"@type":"Review","author":{"@type":"Person","name":"Jenna R."},"reviewRating":{"@type":"Rating","ratingValue":"5","bestRating":"5"},"datePublished":"2025-06-14","reviewBody":"Our family had an amazing time snorkeling. The crew kept the kids safe and showed us a sea turtle."},{"@type":"Review","author":"Tom P.","reviewRating":{"ratingValue":4},"reviewBody":"Great boat and friendly crew. A little choppy on the way out but they handled it well."}]}</script>`,
    { count: 2, first: { author: "Jenna R.", rating: 5, date: "2025-06-14", source: "site" } },
  ],
  [
    "jsonld: @graph with AggregateRating",
    `<script type="application/ld+json">{"@graph":[{"@type":"TouristAttraction","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.9","reviewCount":"312"}},{"@type":"Review","author":{"name":"Luis M."},"reviewRating":{"ratingValue":"10","bestRating":"10"},"reviewBody":"Best fishing trip I have taken in Florida. We limited out on snapper by ten in the morning."}]}</script>`,
    { count: 1, first: { author: "Luis M.", rating: 5 }, aggregate: { rating: 4.9, count: 312 } },
  ],
  [
    "microdata: itemscope Review",
    `<div itemscope itemtype="http://schema.org/Review"><span itemprop="author" itemscope itemtype="http://schema.org/Person"><span itemprop="name">Karen W.</span></span><div itemprop="reviewRating" itemscope itemtype="http://schema.org/Rating"><meta itemprop="ratingValue" content="5"></div><meta itemprop="datePublished" content="2024-09-02"><p itemprop="reviewBody">I was nervous about parasailing but the crew made it so easy. The views of the island were unforgettable.</p></div>`,
    { count: 1, first: { author: "Karen W.", rating: 5, date: "2024-09-02" } },
  ],
  [
    "microdata: AggregateRating only",
    `<div itemscope itemtype="https://schema.org/AggregateRating"><span itemprop="ratingValue">4.7</span> from <span itemprop="reviewCount">88</span> reviews</div>`,
    { count: 0, aggregate: { rating: 4.7, count: 88 } },
  ],
  [
    "testimonial slider under a heading (slick, with cloned slides)",
    `<section class="home-section"><h2>What Our Guests Say</h2><div class="slider"><div class="slick-track">
      <div class="slick-slide slick-cloned"><p>"The kayak tour through the mangroves was peaceful and our guide knew every bird we saw."</p><span>- Priya S.</span></div>
      <div class="slick-slide"><p>"The kayak tour through the mangroves was peaceful and our guide knew every bird we saw."</p><span>- Priya S.</span></div>
      <div class="slick-slide"><p>"We booked the private tour for my mom's birthday and it was perfect from start to finish!"</p><span>- Dan K.</span></div>
    </div></div></section>`,
    { count: 2, some: (rs) => rs.some((r) => r.author === "Priya S.") && rs.some((r) => r.author === "Dan K.") },
  ],
  [
    "testimonial cards (Elementor testimonial widget)",
    `<div class="elementor-widget-testimonial"><div class="elementor-testimonial-wrapper"><div class="elementor-testimonial-content">My husband and I did the helicopter tour and it was the highlight of our trip to Maui. Worth every minute.</div><div class="elementor-testimonial-meta"><div class="elementor-testimonial-details"><div class="elementor-testimonial-name">Angela T.</div><div class="elementor-testimonial-job">Denver, CO</div></div></div></div></div>`,
    { count: 1, first: { author: "Angela T.", rating: null } },
  ],
  [
    "Elfsight-style Google reviews widget, pre-rendered",
    `<div class="elfsight-app-3b1c eapps-google-reviews"><div class="es-review-container"><div class="es-review-author-name">Marcus Lee</div><div class="es-review-rating" aria-label="Rated 5 out of 5"></div><div class="es-review-date">March 3, 2025</div><div class="es-review-text">Captain Rob found us a pod of dolphins within twenty minutes. The boat was spotless and the crew was great with our kids.</div><img class="es-review-source-icon" src="/icons/google.svg" alt="Google"></div></div>`,
    { count: 1, first: { author: "Marcus Lee", rating: 5, date: "2025-03-03", source: "google" } },
  ],
  [
    "Trustindex-style widget with filled and empty stars",
    `<div class="ti-widget" data-layout-id="4" data-set-id="light-background"><div class="ti-reviews-container"><div class="ti-review-item"><div class="ti-review-header"><div class="ti-platform-icon"><img src="https://cdn.trustindex.io/assets/platform/Google/icon.svg" alt="Google"></div><div class="ti-profile-details"><div class="ti-name">Heather Morales</div><div class="ti-date">2024-11-20</div></div></div><span class="ti-stars"><span class="ti-star f"></span><span class="ti-star f"></span><span class="ti-star f"></span><span class="ti-star f"></span><span class="ti-star e"></span></span><div class="ti-review-content"><div class="ti-review-text-container">Fun jet ski tour and the guide stopped for photos at the sandbar. Check-in took a while which is why four stars.</div><span class="ti-read-more">Read more</span></div></div></div></div>`,
    { count: 1, first: { author: "Heather Morales", rating: 4, date: "2024-11-20", source: "google" } },
  ],
  [
    "Google Reviews plugin (wp-gr) markup",
    `<div class="wp-gr wpac"><div class="wp-google-review"><div class="wp-google-right"><a class="wp-google-name" href="https://www.google.com/maps/contrib/1">Samantha Ortiz</a><div class="wp-google-time" data-time="1718000000">06/28/2024</div><div class="wp-google-feedback"><span class="wp-google-stars"><span class="wp-stars"><span class="wp-star"></span><span class="wp-star"></span><span class="wp-star"></span><span class="wp-star"></span><span class="wp-star"></span></span></span><span class="wp-google-text">Our zipline guides were hilarious and made everyone feel safe. The last line over the canyon is incredible.</span></div></div></div></div>`,
    { count: 1, first: { author: "Samantha Ortiz", rating: 5, date: "2024-06-28", source: "google" } },
  ],
  [
    "TripAdvisor-labelled testimonial card",
    `<div class="testimonial"><div class="testimonial-quote">We saw three whales breaching right next to the boat. The naturalist on board explained everything.</div><div class="testimonial-author">Mary H. | Tripadvisor</div></div>`,
    { count: 1, first: { author: "Mary H.", source: "tripadvisor" } },
  ],
  [
    "blockquote with cite",
    `<blockquote><p>I have done a lot of dive trips and this crew was the most organized I have seen. The reef was full of life.</p><cite>Greg D.</cite></blockquote>`,
    { count: 1, first: { author: "Greg D." } },
  ],
  [
    "testimonials page: paragraphs signed with a dash",
    `<main><h1>Testimonials</h1><p>My daughter loved her first riding lesson and cannot stop talking about the ponies. - Rachel B.</p><p>Our group of eight had a blast on the trail ride, and the horses were gentle and well cared for.</p><p>– Kevin and Laura</p><p>Nothing here is a review: this paragraph just explains how lessons are scheduled for new riders each week.</p></main>`,
    { count: 2, some: (rs) => rs.some((r) => r.author === "Rachel B.") && rs.some((r) => r.author === "Kevin and Laura") },
  ],
  [
    "business reply element must be dropped",
    `<div class="review-item"><div class="review-author">Bill S.</div><div class="review-text">The boat left twenty minutes late and nobody told us why, but the snorkeling itself was good.</div><div class="review-reply"><strong>Response from the owner</strong><p>Thank you for your feedback Bill, we are sorry about the delay and have added a second captain.</p></div></div>`,
    { count: 1, none: /thank you for your feedback|second captain/i, first: { author: "Bill S." } },
  ],
  [
    "business reply inline in the text must be cut",
    `<div class="testimonial-item"><p class="testimonial-text">Loved the sunset sail, the crew poured champagne and played great music the whole way. Response from the owner: Thanks so much Julie, come back soon!</p><span class="testimonial-name">Julie P.</span></div>`,
    { count: 1, none: /thanks so much julie|response from/i },
  ],
  [
    "a card that is only the business thanking a reviewer is rejected",
    `<div class="review"><p class="review-content">Thank you for choosing us for your anniversary cruise, we loved having you on board!</p><span class="review-name">Captain Joe</span></div>`,
    { count: 0 },
  ],
  [
    "marketing copy in a testimonial section is rejected",
    `<section id="testimonials"><h2>Reviews</h2><div class="testimonial"><p class="testimonial-text">We offer the best fishing charters in the Keys. Our team of licensed captains will make your day. Book now!</p></div><div class="testimonial"><p class="testimonial-text">Family owned and operated since 1987, call us today to reserve your spot on the water.</p></div></section>`,
    { count: 0 },
  ],
  [
    "Facebook feed posts are the business talking, not reviews",
    `<div id="cff" class="cff-wrapper"><div class="cff-item"><p class="cff-post-text">September fishing got off to a pretty good start! We do have a boat open this Sunday and Monday morning. See MoreSee Less</p></div></div><div class="review"><p>September fishing got off to a pretty good start! We do have a boat open this Sunday. Hope everyone has a great weekend!</p></div>`,
    { count: 0 },
  ],
  [
    "contradictory rating: 1 star on a glowing review becomes null",
    `<script type="application/ld+json">{"@type":"Review","author":{"name":"Olivia N."},"reviewRating":{"ratingValue":1},"reviewBody":"Absolutely amazing experience! The guides were knowledgeable and friendly, highly recommend this tour to anyone."}</script>`,
    { count: 1, first: { author: "Olivia N.", rating: null } },
  ],
  [
    "contradictory rating: 5 stars on a clear complaint becomes null",
    `<div class="review-card"><div class="review-rating" data-rating="5"></div><p class="review-text">Terrible trip. The captain was rude, the boat was dirty, and they refused a refund when they cancelled on us.</p><span class="review-author">Mark V.</span></div>`,
    { count: 1, first: { author: "Mark V.", rating: null } },
  ],
  [
    "duplicate: same review as JSON-LD and as a card on the page",
    `<script type="application/ld+json">{"@type":"Review","author":{"name":"Chris A."},"reviewRating":{"ratingValue":5},"reviewBody":"The airboat ride was a blast and we saw at least a dozen alligators up close. Our captain was hilarious."}</script><div class="testimonial"><p class="testimonial-text">The airboat ride was a blast and we saw at least a dozen alligators up close. Our captain was hilarious...</p><span class="testimonial-name">Chris A.</span></div>`,
    { min: 1, some: (rs) => selectReviews(rs).length === 1 && selectReviews(rs)[0].rating === 5 },
  ],
  [
    "chrome stripped: stars, read more, posted on, too-short text rejected",
    `<div class="reviews-list"><div class="review-item"><span class="review-stars">★★★★★</span><div class="review-body">★★★★★ Posted on Google We rented two paddleboards for the afternoon and the water was crystal clear. Read more</div><div class="review-name">Nina F.</div></div><div class="review-item"><div class="review-body">Great!!</div><div class="review-name">Ed</div></div></div>`,
    { count: 1, first: { author: "Nina F.", rating: 5, text: "We rented two paddleboards for the afternoon and the water was crystal clear.", source: "google" } },
  ],
  [
    "relative date is not a date; author glued heading is not an author",
    `<div class="review"><div class="review-author">Google review</div><div class="review-date">2 months ago</div><div class="review-text">Our escape room host gave just the right hints and the puzzles were clever. We escaped with a minute left!</div></div>`,
    { count: 1, first: { author: null, date: null, source: "google" } },
  ],
  [
    "radio-button stars (Beaver Builder UABB): the checked input is the rating, not the first label",
    `<div class="uabb-testimonial"><div class="uabb-testimonial-author-description"><p>We saw humpbacks and a pod of orcas on the same trip, and the captain explained everything we were seeing.</p></div><div class="uabb-testimonial-author"><h5 class="uabb-testimonial-author-name">Rita G</h5><div class="uabb-rating"><input class="uabb-rating__input" type="radio" value="5"><label title="5 out of 5 stars"></label><input class="uabb-rating__input uabb-checked" type="radio" value="4"><label title="4 out of 5 stars"></label></div></div></div>`,
    { count: 1, first: { author: "Rita G", rating: 4 } },
  ],
  [
    "star picture alt text is a stated rating",
    `<div class="ltt-reviews-container"><div class="ltt-review"><p class="ltt-review-name">AJ Sinclair</p><p class="ltt-review-stars"><img src="/img/five-stars.webp" alt="Five Stars"></p><p class="ltt-review-text">Very informative tour of the colorful history of South Beach, with great bar stops along the way.</p></div></div>`,
    { count: 1, first: { author: "AJ Sinclair", rating: 5 } },
  ],
  [
    "not reviews: 'previews' classes and an endorsement caption under a cite",
    `<div class="previews-carousel"><div class="locs-loc"><p class="locs-loc-text">A heavy shadow hangs over the Betsy Hotel, and visitors still hear phantom boots marching through the hallways.</p></div></div><div class="elementor-testimonial"><div class="elementor-testimonial__footer"><cite class="elementor-testimonial__cite"><span class="elementor-testimonial__name">Lisa Helps</span><span class="elementor-testimonial__title">Mayor, City of Victoria, September 2022</span></cite></div></div>`,
    { count: 0 },
  ],
  [
    "no reviews: an ordinary service page",
    `<main><h1>Jet Ski Rentals</h1><p>One hour rental $125. Two hour rental $199. Life jackets included.</p><a href="/reviews">Read our reviews</a></main>`,
    { count: 0 },
  ],
];

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "\n      " + detail}`);
};

for (const [name, html, exp] of FIXTURES) {
  const { reviews, aggregate } = harvestReviews(html, URL_);
  const problems: string[] = [];
  if (exp.count != null && reviews.length !== exp.count) problems.push(`count ${reviews.length} != ${exp.count}`);
  if (exp.min != null && reviews.length < exp.min) problems.push(`count ${reviews.length} < ${exp.min}`);
  if (exp.first) {
    const r = reviews[0];
    if (!r) problems.push("no first review");
    else for (const [k, v] of Object.entries(exp.first)) if ((r as Record<string, unknown>)[k] !== v) problems.push(`${k}: ${JSON.stringify((r as Record<string, unknown>)[k])} != ${JSON.stringify(v)}`);
  }
  if (exp.none && reviews.some((r) => exp.none!.test(r.text))) problems.push("forbidden text kept");
  if (exp.some && !exp.some(reviews)) problems.push("condition failed");
  if (exp.aggregate !== undefined) {
    const a = aggregate ? { rating: aggregate.rating, count: aggregate.count } : null;
    if (JSON.stringify(a) !== JSON.stringify(exp.aggregate)) problems.push(`aggregate ${JSON.stringify(a)} != ${JSON.stringify(exp.aggregate)}`);
  }
  check(name, problems.length === 0, problems.join("; ") + "\n      got " + JSON.stringify(reviews));
}

// Rules outside HTML.
check("date: 'via Google' is not a date", parseReviewDate("via Google") === null, String(parseReviewDate("via Google")));
check("date: 'Jul 2018' -> 2018-07", parseReviewDate("Jul 2018") === "2018-07", String(parseReviewDate("Jul 2018")));
check("date: ambiguous 07/05/2018 -> null", parseReviewDate("07/05/2018") === null, String(parseReviewDate("07/05/2018")));
check("date: future is rejected", parseReviewDate(`${NOW.getFullYear() + 2}-01-01`) === null, "");
check("author: 'Wendy B. • Tripadvisor review'", JSON.stringify(cleanAuthor("Wendy B. • Tripadvisor review")) === JSON.stringify({ author: "Wendy B.", source: "tripadvisor" }), JSON.stringify(cleanAuthor("Wendy B. • Tripadvisor review")));

// Stored facts in both shapes, through the sync's quote builder.
const old = [
  JSON.stringify({ a: "Nicole D. • TripAdvisor", r: 5, t: "My family had a wonderful time on the Alabama! The Captain and crew were so hospitable.", d: null, s: "schema" }),
  JSON.stringify({ a: "Liz S. | Yelp", r: 1, t: "Such a fun and amazing afternoon, highly recommend the sunset sail to everyone!", d: "via Yelp", s: "site" }),
  JSON.stringify({ a: null, r: null, t: "September fishing got off to a pretty good start! We do have a boat open this Sunday and Monday morning. Hope everyone has a great Labor Day weekend! Thanks- RT ... See MoreSee Less", d: null, s: "site" }),
  JSON.stringify({ a: null, r: null, t: "Seth Luna2 months agoGood prices and the staff walked us through every step of the rental.", d: null, s: "site" }),
];
const fresh = { value: JSON.stringify({ author: "Nicole D.", rating: null, text: "My family had a wonderful time on the Alabama! The Captain and crew were so hospitable.", date: "2025-05-01", source: "site", sourceUrl: "https://x.com/" }), sourceUrl: "https://x.com/" };
const quotes = quotesFromFacts([...old, fresh]);
console.log("\nquotesFromFacts:", JSON.stringify(quotes, null, 1));
check("old + new shapes: 3 kept, feed post dropped, duplicate merged", quotes.length === 3, `got ${quotes.length}`);
check("old shape: platform from author becomes source", quotes.some((q) => q.author === "Nicole D." && q.source === "tripadvisor" && q.rating === 5 && q.date === "2025-05-01"), "");
check("old shape: contradictory 1 star nulled, 'via Yelp' not a date", quotes.some((q) => q.author === "Liz S." && q.rating === undefined && q.date === undefined && q.source === "yelp"), "");
check("old shape: glued name split, relative date dropped", quotes.some((q) => q.author === "Seth Luna" && q.text.startsWith("Good prices") && !q.date), "");
const many = Array.from({ length: 20 }, (_, i) => JSON.stringify({ author: i % 2 ? "Guest " + String.fromCharCode(65 + i) + "." : null, rating: 5, text: `Review number ${i} about a lovely paddle through the bay with our friendly guide ${"x".repeat(i)}.`, date: null, source: "site", sourceUrl: URL_ }));
const capped = quotesFromFacts(many);
check("cap: at most 12, named reviews first", capped.length === 12 && capped.slice(0, 10).every((q) => q.author), `got ${capped.length}`);
void LONG;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
