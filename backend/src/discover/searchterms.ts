import { CATEGORIES } from "../taxonomy/catalog.ts";

/**
 * What a guest types into Google Maps, one to three phrasings per category, each mapped to the category id
 * the row is filed under. `searchapi.ts` runs every term against every city, so the cache key is the term
 * itself: the first eight are the exact strings the original water and air run used, and renaming any of them
 * would throw away 1,492 cached pages under data/searchapi.
 *
 * Google's own business type still beats the term (see TYPE_TO_CATEGORY in searchapi.ts): "cooking school"
 * returns culinary schools and the odd restaurant, and the type decides which one it was.
 */
export type SearchTerm = { q: string; categoryId: string };

const t = (categoryId: string, ...qs: string[]): SearchTerm[] => qs.map((q) => ({ q, categoryId }));

export const SEARCH_TERMS: SearchTerm[] = [
  // Water
  ...t("jetski", "jet ski rental"),
  ...t("kayak", "kayak rental", "kayak tours"),
  ...t("paddleboard", "paddleboard rental"),
  ...t("pontoon", "pontoon boat rental", "boat rental"),
  ...t("fishing", "inshore fishing charter", "fishing charter"),
  ...t("cruise", "sunset cruise", "boat tours"),
  ...t("rafting", "whitewater rafting", "river tubing"),
  ...t("scuba", "scuba diving", "dive shop", "snorkeling tours"),
  ...t("surf", "surf lessons", "surf school"),
  ...t("swim", "swim lessons", "swimming pool"),
  ...t("sailing", "sailing lessons", "sailing charter"),
  // Air
  ...t("skydive", "tandem skydive", "skydiving"),
  ...t("heli", "helicopter tour"),
  ...t("balloon", "hot air balloon ride"),
  ...t("parasail", "parasail", "parasailing"),
  ...t("paragliding", "tandem paragliding", "paragliding"),
  ...t("gliding", "glider ride", "glider flights"),
  // Motorsport
  ...t("kart", "indoor go karting", "go kart track"),
  ...t("motorsport", "atv tours", "off road tours", "race track experience"),
  // Indoor
  ...t("escape", "escape room"),
  ...t("axe", "axe throwing"),
  ...t("climbing", "climbing gym", "rock climbing gym", "bouldering gym"),
  ...t("rage", "rage room", "smash room"),
  // Outdoor
  ...t("paintball", "paintball field", "paintball"),
  ...t("horse", "horseback riding", "trail rides"),
  ...t("range", "shooting range", "gun range"),
  ...t("archery", "archery range"),
  ...t("golf", "golf course", "golf club"),
  ...t("zipline", "zipline", "zip line adventure park"),
  ...t("ski", "ski resort", "ski lessons"),
  ...t("bike", "bike rental", "e-bike rental"),
  ...t("snowmobile", "snowmobile tour", "snowmobile rental"),
  ...t("tour", "food tour", "walking tour", "sightseeing tours"),
  ...t("garden", "botanical garden"),
  ...t("camping", "glamping", "campground"),
  ...t("tennis", "pickleball courts", "tennis courts", "tennis club"),
  ...t("discgolf", "driving range", "disc golf course"),
  // Play
  ...t("bowling", "bowling alley"),
  ...t("minigolf", "mini golf", "miniature golf"),
  ...t("arcade", "arcade", "family entertainment center"),
  ...t("trampoline", "trampoline park"),
  ...t("lasertag", "laser tag"),
  ...t("icerink", "ice skating rink"),
  ...t("waterpark", "water park"),
  ...t("themepark", "amusement park", "theme park"),
  ...t("zoo", "zoo", "wildlife park"),
  ...t("aquarium", "aquarium"),
  ...t("karaoke", "karaoke rooms", "karaoke bar"),
  ...t("theatre", "comedy club", "theater"),
  ...t("museum", "museum", "art gallery"),
  ...t("gymnastics", "gymnastics open gym", "gymnastics center"),
  ...t("venue", "party venue", "event venue"),
  ...t("billiards", "pool hall", "billiards"),
  /**
   * Added 18 September 2026, after Silverdale Gun Club in West Lincoln, Ontario turned out to be missing from
   * Outset and from OpenStreetMap alike. Each of these is a phrasing guests use on Google that no term above
   * reaches, and each one maps to a category the catalog already has: a club rather than a "range", the indoor
   * and simulator forms of a sport, and the places filed under a word we never asked for. About $0.23 a term.
   */
  ...t("range", "gun club"),
  ...t("skydive", "indoor skydiving"),
  ...t("golf", "golf simulator"),
  ...t("arcade", "vr arcade"),
  ...t("zipline", "ropes course"),
  ...t("spa", "hot springs"),
  ...t("zoo", "petting zoo"),
  ...t("icerink", "curling club"),
  // Food and drink
  ...t("brewery", "brewery", "brewery tour"),
  ...t("winery", "winery", "wine tasting"),
  ...t("distillery", "distillery", "distillery tour"),
  ...t("cooking", "cooking class", "cooking classes", "cooking school"),
  // Wellness and classes
  ...t("spa", "day spa", "spa"),
  ...t("sauna", "sauna bathhouse", "sauna"),
  ...t("yoga", "yoga studio", "yoga classes"),
  ...t("dance", "dance classes", "dance studio"),
  ...t("pottery", "pottery class", "pottery studio", "art classes"),
  ...t("martialarts", "martial arts school", "karate", "jiu jitsu"),
  ...t("fitness", "pilates studio", "fitness classes", "spin studio"),
];

/** Terms for the given category ids, or every term when none are given. Unknown ids are ignored. */
export function termsForCategories(ids?: string[], opts: { onePer?: boolean } = {}): SearchTerm[] {
  const list = ids?.length ? SEARCH_TERMS.filter((s) => ids.includes(s.categoryId)) : SEARCH_TERMS;
  if (!opts.onePer) return list;
  /**
   * The broadest phrasing per category and no more. A Maps page answers with twenty businesses whatever it was
   * asked, so when the budget is a fixed number of credits, covering every city with one phrasing each fills far
   * more of the catalog than covering a few cities three ways. The first phrasing listed is the broadest.
   */
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.categoryId) ? false : (seen.add(t.categoryId), true)));
}

/** Category ids in the taxonomy that no term covers. Empty is the invariant a test keeps. */
export function uncoveredCategories(): string[] {
  const covered = new Set(SEARCH_TERMS.map((s) => s.categoryId));
  return CATEGORIES.map((c) => c.id).filter((id) => !covered.has(id));
}
