import { ART_LABEL } from "../data/art";
import { inCat } from "../data/categories";
import { METROS, METRO_ALIASES, metroById, type Metro } from "../data/metros";
import type { ArtKind, CategoryId, Unclaimed } from "../data/types";

/**
 * Guest search for Explore and the desktop home.
 *
 * Everything runs off one inverted index built once per catalog (55,000 operators), so a keystroke touches a
 * few thousand postings instead of every record. Ranking is a fixed order of evidence: the operator's own name,
 * then the activity the guest named, then the words that landed, then the city. Nothing here invents a listing,
 * a price or a rating: every number shown comes from the catalog.
 */

/* ---------- synonyms ---------- */

/** Words guests type that should still hit the listing. First entry is the canonical phrase for that kind. */
export const ART_ALIASES: Record<ArtKind, string[]> = {
  skydive: ["skydive", "skydiving", "parachute", "dropzone", "tandem jump", "freefall", "wind tunnel", "indoor skydiving"],
  heli: ["helicopter", "heli", "chopper", "seaplane", "helicopter tour", "air tour"],
  balloon: ["balloon", "hot air", "hot air balloon", "sunrise flight"],
  kart: ["kart", "karting", "go kart", "gokart", "racing", "indoor karting", "kart track"],
  escape: ["escape room", "escape", "puzzle", "escape game", "mystery room"],
  axe: ["axe throwing", "axe", "ax", "hatchet"],
  paintball: ["paintball", "airsoft", "gel blaster"],
  horse: ["horse", "horseback", "trail ride", "riding", "equestrian", "stables", "pony", "dude ranch"],
  jetski: ["jet ski", "jetski", "waverunner", "wave runner", "pwc", "sea doo", "seadoo", "personal watercraft"],
  pontoon: ["pontoon", "boat rental", "party boat", "deck boat", "tritoon", "boat hire"],
  fishing: ["fishing", "charter", "inshore", "offshore", "deep sea fishing", "fly fishing", "fishing guide", "bass fishing"],
  parasail: ["parasail", "parasailing", "para sail"],
  cruise: ["cruise", "sail", "sailing", "ferry", "harbor", "harbour", "whale", "sunset cruise", "dinner cruise", "boat tour", "catamaran", "dolphin tour", "airboat", "riverboat"],
  kayak: ["kayak", "kayaking", "canoe", "paddle", "paddleboard", "paddle board", "sup", "rowing", "stand up paddle"],
  bowling: ["bowling", "bowl", "lanes", "bowling alley"],
  minigolf: ["mini golf", "minigolf", "putt putt", "putt-putt", "miniature golf", "adventure golf"],
  arcade: ["arcade", "arcades", "game room", "pinball", "barcade", "virtual reality", "vr"],
  trampoline: ["trampoline", "trampoline park", "jump park", "bounce", "foam pit"],
  lasertag: ["laser tag", "lasertag", "laser quest"],
  icerink: ["ice skating", "ice rink", "skating rink", "skating", "hockey", "figure skating", "learn to skate"],
  waterpark: ["water park", "waterpark", "water slides", "splash", "lazy river", "wave pool"],
  themepark: ["theme park", "amusement park", "roller coaster", "rides", "boardwalk"],
  zoo: ["zoo", "safari", "wildlife park", "animal park", "petting zoo", "aviary"],
  aquarium: ["aquarium", "sea life", "marine life"],
  karaoke: ["karaoke", "ktv", "private room", "singing room"],
  climbing: ["climbing", "bouldering", "rock climbing", "climb", "rock gym", "belay", "top rope"],
  range: ["shooting range", "gun range", "shooting", "range", "clay", "skeet", "trap", "pistol", "firearm", "sporting clays"],
  archery: ["archery", "bow", "arrows", "archery tag"],
  golf: ["golf", "tee time", "tee times", "driving range", "golf course", "country club", "putting green", "18 holes"],
  zipline: ["zipline", "zip line", "ziplining", "canopy tour", "ropes course", "aerial park", "treetop", "adventure park"],
  ski: ["ski", "skiing", "snowboard", "snowboarding", "ski resort", "lift ticket", "ski lesson", "tubing", "snow tubing", "terrain park", "cross country skiing", "nordic"],
  bike: ["bike", "bicycle", "e-bike", "ebike", "cycling", "bike rental", "mountain bike", "mtb", "bike tour", "moped", "scooter rental"],
  snowmobile: ["snowmobile", "snowmobiling", "sled", "sledding"],
  rafting: ["rafting", "whitewater", "white water", "raft", "tubing", "float trip"],
  scuba: ["scuba", "diving", "dive", "snorkel", "snorkeling", "freediving", "open water", "padi", "dive shop"],
  surf: ["surf", "surfing", "surf lesson", "surfboard", "wakeboard", "kitesurf", "windsurf", "surf camp"],
  paragliding: ["paragliding", "paraglide", "hang gliding", "hang glide", "tandem flight"],
  gliding: ["glider", "gliding", "sailplane", "soaring"],
  brewery: ["brewery", "breweries", "beer", "taproom", "brew tour", "craft beer", "brewpub", "beer garden", "beer tasting"],
  winery: ["winery", "wineries", "wine", "vineyard", "tasting", "wine tasting", "wine tour", "cellar door"],
  distillery: ["distillery", "distilleries", "whiskey", "bourbon", "spirits", "gin", "rum", "tequila"],
  cooking: ["cooking", "cooking class", "culinary", "baking", "pasta making", "sushi class", "chef", "food class"],
  spa: ["spa", "massage", "facial", "hot springs", "float", "day spa", "massage therapy", "med spa", "salt room"],
  yoga: ["yoga", "pilates", "meditation", "breathwork", "hot yoga", "vinyasa"],
  dance: ["dance", "dancing", "salsa", "ballroom", "dance class", "hip hop", "bachata", "swing dance", "tango", "line dancing", "zumba"],
  tour: ["tour", "tours", "food tour", "walking tour", "ghost tour", "segway", "city tour", "sightseeing", "guided tour", "trolley tour", "bus tour", "haunted tour"],
  rage: ["rage room", "rage", "smash room", "break room", "demolition room"],
  theatre: ["theatre", "theater", "show", "shows", "comedy", "comedy club", "play", "musical", "live music", "concert", "improv", "stand up", "standup", "broadway", "opera", "symphony", "orchestra"],
  museum: ["museum", "gallery", "exhibit", "science center", "planetarium", "art museum", "history museum", "observatory"],
  garden: ["garden", "botanical", "botanic", "arboretum", "conservatory", "greenhouse"],
  camping: ["camping", "campground", "glamping", "campsite", "cabin", "cabins", "rv park", "yurt", "koa", "tent site"],
  tennis: ["tennis", "pickleball", "court", "courts", "squash", "badminton", "racquet", "padel"],
  swim: ["swim", "swimming", "pool", "swim lessons", "aquatic center", "lap swim", "swim school"],
  martialarts: ["martial arts", "boxing", "kickboxing", "jiu jitsu", "bjj", "karate", "taekwondo", "muay thai", "mma", "judo", "krav maga", "fencing", "self defense", "wrestling", "grappling"],
  gymnastics: ["gymnastics", "cheer", "tumbling", "parkour", "ninja", "ninja warrior", "open gym"],
  fitness: ["fitness", "crossfit", "barre", "spin", "cycling class", "bootcamp", "hiit", "gym class", "workout", "rowing studio"],
  venue: ["venue", "event venue", "party venue", "event space", "banquet", "party room", "private room", "birthday party venue", "function hall"],
  sailing: ["sailing", "sailing lessons", "sailing school", "sailboat", "learn to sail", "yacht charter", "yacht"],
  discgolf: ["disc golf", "frisbee golf", "driving range", "topgolf", "golf simulator", "footgolf", "disc golf course"],
  billiards: ["billiards", "pool hall", "pool table", "darts", "shuffleboard", "ping pong", "table tennis", "snooker"],
  motorsport: ["motocross", "atv", "utv", "off-road", "offroad", "dirt bike", "side by side", "dune buggy", "drag strip", "race track", "racing school", "drift", "rally", "mud park"],
  sauna: ["sauna", "bathhouse", "cold plunge", "banya", "hot springs", "thermal", "hammam", "steam room", "ice bath", "contrast therapy"],
  pottery: ["pottery", "ceramics", "paint and sip", "art class", "painting", "glassblowing", "candle making", "sip and paint", "paint night", "wheel throwing"],
};

/* ---------- text ---------- */

const HIGH = /[^\x00-\x7f]/;
const STRIP = /[^a-z0-9]+/g;

/** Lowercase, accent-free, punctuation as spaces. Titles are mostly ASCII, so the accent pass only runs when needed. */
function norm(s: string): string {
  let t = s.toLowerCase();
  if (HIGH.test(t)) t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return t.replace(STRIP, " ").trim();
}

function tokens(q: string): string[] {
  const n = norm(q);
  return n ? n.split(" ") : [];
}

/**
 * The endings English adds to the same activity word. Not a real stemmer: it only has to land kayak / kayaks /
 * kayaking and winery / wineries on one key. Prefix matching in `relate` covers the rest (skydiv, skydive, skydiving).
 */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("es") && /(s|x|z|ch|sh)$/.test(w.slice(0, -2))) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) {
    const s = w.slice(0, -3);
    return s.length > 3 && s[s.length - 1] === s[s.length - 2] ? s.slice(0, -1) : s;
  }
  return w;
}

const stemPhrase = (s: string) => s.split(" ").map(stem).join(" ");

// Two reusable rows: the fuzzy passes call this thousands of times per keystroke.
let edPrev = new Int32Array(64);
let edCur = new Int32Array(64);

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 9;
  const rows = a.length + 1;
  const cols = b.length + 1;
  if (cols > edPrev.length) {
    edPrev = new Int32Array(cols * 2);
    edCur = new Int32Array(cols * 2);
  }
  let prev = edPrev;
  let cur = edCur;
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j < cols; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      cur[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[b.length];
}

/** Typos a guest can make and still mean the word: one edit, two once the word is long enough to hide one. */
const slack = (t: string) => (t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0);

/**
 * How strongly one typed token matches one indexed word, 0 for no match. The order is the ranking order:
 * the same word, the same stem, the word the guest is part way through typing, then a typo, then a fragment.
 */
function relate(word: string, wordStem: string, tok: string, tokStem: string): number {
  if (word === tok) return 10;
  if (wordStem === tokStem) return 9;
  if (word.startsWith(tok)) return tok.length >= 3 ? 8 : 7;
  if (tok.length >= 4 && wordStem.startsWith(tokStem)) return 8;
  // "helicopter" should reach a listing filed under "heli", but "skydiving" must not reach every "Sky" in a name.
  if (word.length >= 4 && tok.startsWith(word)) return 5;
  const max = slack(tok);
  if (!max) return 0;
  if (Math.abs(word.length - tok.length) <= max) {
    // One slip is still the same word. Two is a guess, and ranks like one.
    const d = editDistance(word, tok);
    if (d <= max) return d === 1 ? 6 : 4;
  }
  if (word.length > tok.length && word.includes(tok)) return 4;
  return 0;
}

/* ---------- the index ---------- */

/** Where a word sits on a listing. A name hit is worth more than a word buried in a description. */
const F_TITLE = 1;
const F_PLACE = 2;
const F_TAG = 4;
const F_TEXT = 8;
const FIELD_WEIGHT = [3, 1.6, 1.35, 1];
/** Weight for a posting's field mask: the best field the word appears in wins. */
const MASK_WEIGHT = Array.from({ length: 16 }, (_, m) => {
  let best = 0;
  for (let b = 0; b < 4; b++) if (m & (1 << b)) best = Math.max(best, FIELD_WEIGHT[b]);
  return best;
});

type Entry = {
  u: Unclaimed;
  /** Normalised title, its stemmed form and its letters with the spaces taken out, for name matching. */
  title: string;
  stem: string;
  compact: string;
  words: string[];
  /** Host of the operator's own site, for the owner-facing name picker. */
  domain: string;
  art: ArtKind;
  metroId: string;
  from: number | null;
  /** Rating and photo weight, precomputed so the hot loop never reaches into the record. */
  qual: number;
  /** Lazily answered: published rules allow a young child, published text mentions groups. */
  kid: 0 | 1 | -1;
  grp: 0 | 1 | -1;
};

type Word = { w: string; s: string; post: number[] };

type Index = {
  pool: Unclaimed[];
  entries: Entry[];
  /** How many of the pool have been folded in. The build is chunked so it can run in idle time. */
  built: number;
  vocab: Map<string, Word>;
  /** Vocabulary bucketed by first letter: every prefix, stem and one-edit match starts there. */
  byFirst: Map<string, Word[]>;
  all: Word[];
  byArt: Map<ArtKind, number[]>;
  byMetro: Map<string, number[]>;
  /** Scratch rows reused across keystrokes. */
  pts: Float64Array;
  hits: Int32Array;
  reqHits: Int32Array;
  cur: Float64Array;
};

let index: Index | null = null;

function newIndex(pool: Unclaimed[]): Index {
  const n = pool.length;
  return {
    pool,
    entries: [],
    built: 0,
    vocab: new Map(),
    byFirst: new Map(),
    all: [],
    byArt: new Map(),
    byMetro: new Map(),
    pts: new Float64Array(n),
    hits: new Int32Array(n),
    reqHits: new Int32Array(n),
    cur: new Float64Array(n),
  };
}

/** Metro names are shared by thousands of operators, so normalise each one once. */
const metroWords = new Map<string, string[]>();
function wordsForMetro(id: string): string[] {
  let w = metroWords.get(id);
  if (!w) {
    const m = metroById(id);
    w = m ? tokens(m.name + " " + m.region) : [];
    metroWords.set(id, w);
  }
  return w;
}

function startingPrice(u: Unclaimed): number | null {
  const priced = u.options.map((o) => o.price).filter((n): n is number => n != null);
  return priced.length ? Math.min(...priced) : u.from ?? null;
}

function foldEntry(idx: Index, u: Unclaimed, i: number): void {
  const title = norm(u.title);
  const words = title ? title.split(" ") : [];
  const from = startingPrice(u);
  idx.entries.push({
    u,
    title,
    stem: stemPhrase(title),
    compact: words.join(""),
    words,
    domain: u.src.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase(),
    art: u.art,
    metroId: u.metroId,
    from,
    qual: u.rating && u.reviews ? Math.min(6, Math.log10(u.reviews + 1) * 2) : 0,
    kid: -1,
    grp: -1,
  });

  // One posting per word per listing, carrying every field the word showed up in.
  const seen = new Map<string, number>();
  const put = (text: string | undefined, field: number) => {
    if (!text) return;
    const t = norm(text);
    if (!t) return;
    for (const w of t.split(" ")) seen.set(w, (seen.get(w) || 0) | field);
  };
  for (const w of words) seen.set(w, (seen.get(w) || 0) | F_TITLE);
  put(u.area, F_PLACE);
  for (const w of wordsForMetro(u.metroId)) seen.set(w, (seen.get(w) || 0) | F_PLACE);
  for (const t of u.tags || []) put(t, F_TAG);
  for (const o of u.options) put(o.name, F_TAG);
  for (const s of u.services || []) put(s.name, F_TAG);
  put(u.src, F_TEXT);
  seen.set(u.art, (seen.get(u.art) || 0) | F_TEXT);
  seen.set(u.cat, (seen.get(u.cat) || 0) | F_TEXT);
  for (const s of u.specs) put(s, F_TEXT);
  put(u.blurb, F_TEXT);

  for (const [w, mask] of seen) {
    let v = idx.vocab.get(w);
    if (!v) {
      v = { w, s: stem(w), post: [] };
      idx.vocab.set(w, v);
      idx.all.push(v);
      const c = w[0];
      const list = idx.byFirst.get(c);
      if (list) list.push(v);
      else idx.byFirst.set(c, [v]);
    }
    v.post.push((i << 4) | mask);
  }

  const arts = idx.byArt.get(u.art);
  if (arts) arts.push(i);
  else idx.byArt.set(u.art, [i]);
  const metro = idx.byMetro.get(u.metroId);
  if (metro) metro.push(i);
  else idx.byMetro.set(u.metroId, [i]);
}

/**
 * Fold more of the catalog into the index, stopping after `ms` of work. Returns true once it is complete.
 * The search surfaces call this from idle time so the first keystroke does not pay for 55,000 listings.
 */
export function warmSearch(pool: Unclaimed[], ms = 12): boolean {
  if (!index || index.pool !== pool) index = newIndex(pool);
  const idx = index;
  if (idx.built >= pool.length) return true;
  const until = ms === Infinity ? Infinity : performance.now() + ms;
  while (idx.built < pool.length) {
    const stop = Math.min(pool.length, idx.built + 1000);
    while (idx.built < stop) {
      foldEntry(idx, pool[idx.built], idx.built);
      idx.built++;
    }
    if (performance.now() >= until) break;
  }
  return idx.built >= pool.length;
}

function getIndex(pool: Unclaimed[]): Index {
  warmSearch(pool, Infinity);
  return index!;
}

/* ---------- what the guest named ---------- */

type AliasHit = { art: ArtKind; start: number; end: number; words: number; rank: number };

/**
 * Every alias that appears in the query as whole words, longest first, with shorter aliases of a *different* art
 * dropped when they sit inside a longer one. "jet ski" is not a ski resort, "mini golf" is not a golf course,
 * "pool hall" is not a swimming pool. Same-art overlaps ("cooking class" and "cooking") both stay.
 */
function aliasHits(lq: string): { kept: AliasHit[]; dropped: AliasHit[] } {
  const found: AliasHit[] = [];
  for (const [art, words] of Object.entries(ART_ALIASES) as [ArtKind, string[]][]) {
    for (let rank = 0; rank < words.length; rank++) {
      const w = words[rank];
      for (const form of [w, w + "s", w + "es"]) {
        const needle = " " + form + " ";
        let at = lq.indexOf(needle);
        while (at >= 0) {
          found.push({ art, start: at + 1, end: at + 1 + form.length, words: w.split(" ").length, rank });
          at = lq.indexOf(needle, at + 1);
        }
      }
    }
  }
  found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: AliasHit[] = [];
  const dropped: AliasHit[] = [];
  for (const h of found) {
    const inside = kept.some((k) => k.art !== h.art && k.words > h.words && k.start <= h.start && h.end <= k.end);
    (inside ? dropped : kept).push(h);
  }
  return { kept, dropped };
}

function queryArtHits(q: string): AliasHit[] {
  return aliasHits(" " + norm(q) + " ").kept.sort((a, b) => a.start - b.start);
}

/** Every single-word alias, flattened once, so a typo or a half-typed word can still reach the activity. */
const ALIAS_WORDS: { art: ArtKind; w: string; s: string; rank: number }[] = [];
for (const [art, words] of Object.entries(ART_ALIASES) as [ArtKind, string[]][]) {
  for (let rank = 0; rank < words.length; rank++) {
    for (const part of norm(words[rank]).split(" ")) {
      if (part.length >= 3) ALIAS_WORDS.push({ art, w: part, s: stem(part), rank });
    }
  }
}

/**
 * Activities reached by a near miss rather than by the exact word: "skydiv" before the guest finishes typing,
 * "kyak" and "jetsky" when they do not. These never filter results out, they only lift the right kind.
 */
function softArtsFor(toks: string[], hard: ArtKind[]): ArtKind[] {
  const best = new Map<ArtKind, number>();
  for (const tok of toks) {
    if (tok.length < 4) continue;
    const ts = stem(tok);
    for (const a of ALIAS_WORDS) {
      if (hard.includes(a.art)) continue;
      const rel = relate(a.w, a.s, tok, ts);
      // An exact hit here would already have been caught as a phrase, so only prefixes and typos are new.
      if (rel < 6 || rel === 10) continue;
      const cur = best.get(a.art) || 0;
      if (rel > cur) best.set(a.art, rel);
    }
  }
  return Array.from(best.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((x) => x[0]);
}

/**
 * What a guest means, not what they typed. "birthday ideas tampa" is a set of activities plus a place,
 * "with kids" is an age filter, "under $50" is a price cap. Words used here are stripped from exact matching.
 */
export type Intent = {
  label: string | null;
  arts: ArtKind[];
  maxPrice: number | null;
  kids: boolean;
  group: boolean;
  words: string[];
};

const INTENTS: { re: RegExp; label: string; arts: ArtKind[]; kids?: boolean; group?: boolean }[] = [
  { re: /\b(birthday|bday|party|celebrat)/i, label: "Birthday ideas", arts: ["rage", "venue", "gymnastics", "kart", "escape", "axe", "trampoline", "lasertag", "bowling", "arcade", "minigolf", "karaoke", "paintball", "waterpark", "pontoon", "cruise", "jetski", "parasail"], group: true },
  { re: /\b(bachelor|bachelorette|stag|hen|guys? trip|girls? trip|boys? trip)\b/i, label: "Bachelor and bachelorette", arts: ["pontoon", "jetski", "kart", "axe", "brewery", "distillery", "winery", "range", "karaoke", "paintball", "cruise", "skydive", "parasail", "spa"], group: true },
  { re: /\b(team|corporate|coworkers?|office|company outing|work event|team building)\b/i, label: "Team outings", arts: ["escape", "rage", "tour", "axe", "kart", "bowling", "cooking", "brewery", "archery", "range", "climbing", "lasertag", "paintball", "pontoon", "cruise"], group: true },
  { re: /\b(kids?|children|child|family|families|toddler|teen(ager)?s?)\b/i, label: "Family friendly", arts: ["zoo", "museum", "garden", "swim", "gymnastics", "camping", "aquarium", "trampoline", "minigolf", "bowling", "waterpark", "themepark", "icerink", "arcade", "lasertag", "horse", "kayak", "pontoon", "cruise", "escape", "kart", "parasail", "balloon"], kids: true },
  { re: /\b(date night|night out|date|romantic|couples?|anniversary|proposal|honeymoon|valentine)/i, label: "Date ideas", arts: ["winery", "tour", "theatre", "sauna", "cooking", "cruise", "balloon", "pottery", "dance", "minigolf", "icerink", "spa", "brewery", "distillery", "karaoke", "bowling", "heli", "kayak", "horse"] },
  { re: /\b(adrenaline|thrill|extreme|adventure|adventurous|crazy|wild|scary|dare)/i, label: "Adrenaline", arts: ["skydive", "zipline", "rafting", "paragliding", "jetski", "parasail", "kart", "range", "climbing", "paintball", "heli"] },
  { re: /\b(calm|relax|relaxing|chill|peaceful|quiet|scenic|nature|wildlife|dolphin|manatee|sunset|sunrise)/i, label: "Calm and scenic", arts: ["kayak", "balloon", "winery", "spa", "yoga", "gliding", "cruise", "horse"] },
  { re: /\b(rain|rainy|indoor|indoors|inside|bad weather|too hot|air ?con)/i, label: "Rainy day", arts: ["bowling", "museum", "theatre", "billiards", "swim", "arcade", "escape", "axe", "kart", "climbing", "trampoline", "lasertag", "karaoke", "aquarium", "spa", "cooking", "pottery", "icerink"] },
  { re: /\b(water|beach|lake|ocean|bay|river|on the water)\b/i, label: "On the water", arts: ["jetski", "kayak", "pontoon", "fishing", "cruise", "parasail"] },
  { re: /\b(sky|air|fly|flying|view from above|aerial)\b/i, label: "Up in the air", arts: ["skydive", "heli", "balloon", "parasail"] },
  { re: /\b(drinks?|beer|wine|tasting|brew|cocktail|whiskey|bourbon|foodie|eat|taste)\b/i, label: "Food and drink", arts: ["brewery", "winery", "distillery", "cooking"] },
  { re: /\b(class|classes|lesson|lessons|learn|workshop|course)\b/i, label: "Classes and lessons", arts: ["cooking", "pottery", "dance", "yoga", "fitness", "martialarts", "gymnastics", "swim", "surf", "sailing", "scuba", "archery", "climbing", "tennis"] },
  { re: /\b(culture|cultural|arts? and culture|sightseeing|history|historic|exhibits?)\b/i, label: "Culture", arts: ["museum", "theatre", "garden", "zoo", "aquarium", "tour"] },
  { re: /\b(snow|winter|ski|skiing|cold|sled|slopes)\b/i, label: "Winter", arts: ["ski", "snowmobile", "icerink", "spa"] },
  { re: /\b(girls? day|spa day|self.?care|pamper|treat yourself|unwind|de-?stress|wellness)\b/i, label: "Unwind", arts: ["spa", "yoga", "winery", "pottery", "balloon"] },
  { re: /\b(things to do|what to do|activities|fun|stuff to do|weekend|tonight|today|ideas?)\b/i, label: "Things to do", arts: [] },
];

/** The whole query tokens that a regex match touches. "rainy" is stripped when the intent matched "rain". */
function wholeWords(lq: string, index: number, length: number): { words: string[]; start: number; end: number } {
  const start = lq.lastIndexOf(" ", index) + 1;
  const stop = lq.indexOf(" ", index + Math.max(1, length) - 1);
  const end = stop < 0 ? lq.length : stop;
  return { words: lq.slice(start, end).split(" ").filter(Boolean), start, end };
}

export function parseIntent(q: string): Intent {
  const lq = " " + q.toLowerCase().replace(/[^a-z0-9$]+/g, " ") + " ";
  const out: Intent = { label: null, arts: [], maxPrice: null, kids: false, group: false, words: [] };
  const price = lq.match(/(?:under|below|less than|max|up to|<)\s*\$?\s*(\d{2,4})\b/) || lq.match(/\$\s*(\d{2,4})\b/);
  if (price) {
    out.maxPrice = Number(price[1]);
    out.words.push(...price[0].trim().split(/\s+/));
  }
  // "ski" inside "jet ski" is not the winter intent: the longer alias owns that word. Nor is a place name one:
  // "Salt Lake City" is not on the water.
  const claimed: { start: number; end: number }[] = aliasHits(lq.replace(/\$/g, " ")).dropped;
  const place = metroInQuery(q);
  if (place) {
    const needle = " " + place.words.join(" ") + " ";
    const at = lq.replace(/\$/g, " ").indexOf(needle);
    if (at >= 0) claimed.push({ start: at + 1, end: at + needle.length - 1 });
  }
  for (const it of INTENTS) {
    const re = new RegExp(it.re.source, "gi");
    let fired = false;
    for (const m of lq.matchAll(re)) {
      const w = wholeWords(lq, m.index ?? 0, m[0].length);
      if (claimed.some((c) => c.start <= w.start && w.end <= c.end)) continue;
      fired = true;
      out.words.push(...w.words);
    }
    if (!fired) continue;
    if (!out.label) out.label = it.label;
    for (const a of it.arts) if (!out.arts.includes(a)) out.arts.push(a);
    if (it.kids) out.kids = true;
    if (it.group) out.group = true;
  }
  if (!out.label && out.maxPrice != null) out.label = "Under $" + out.maxPrice;
  else if (out.label && out.maxPrice != null) out.label += " under $" + out.maxPrice;
  return out;
}

/** Listings that a young child could join, judged only from what the operator published. */
export function kidFriendly(u: Unclaimed): boolean {
  const text = [...u.specs, u.gap, u.extraNote || "", ...(u.tags || [])].join(" ").toLowerCase();
  if (/\b(18\+|18 and (up|over|older)|adults? only|21\+|must be 18|minimum age(:| is)? ?(1[2-9]|2\d))/.test(text)) return false;
  if (/\bages? ?(\d|[1-9]) ?(\+|and up|to|-)/.test(text) || /kid|child|family|all ages/.test(text)) return true;
  return !["skydive", "paintball", "axe"].includes(u.art);
}

const FILLER = new Set(["rental", "rentals", "rent", "near", "me", "in", "the", "a", "an", "and", "for", "with", "best", "cheap", "tour", "tours", "ideas", "idea", "stuff", "things", "to", "do", "of", "on", "at", "good", "great", "top", "nearby", "around", "here", "my", "our", "we", "i", "some", "any", "night", "day", "tonight", "today", "now", "this", "weekend", "open", "place", "places", "spot", "spots", "options", "local", "close", "closest", "nearest", "budget", "affordable", "inexpensive"]);

const wordIn = (hay: string, w: string) => new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(s|es)?($|[^a-z0-9])", "i").test(hay);

/** Everything about the query that does not depend on the listing, parsed once and reused across the catalog. */
type ParsedQuery = {
  q: string;
  norm: string;
  stem: string;
  compact: string;
  intent: Intent;
  /** Free tokens: what is left once intent phrases and filler are taken out. */
  all: string[];
  /** Tokens the guest spent naming the activity. A jet ski operator need not repeat "jet ski" in its own text. */
  aliasWords: Set<string>;
  artHits: AliasHit[];
  /** Activities the guest named outright. These do filter: a jet ski search is not an escape room. */
  hardArts: ArtKind[];
  /** Activities reached through a prefix or a typo. These only lift, never filter. */
  softArts: ArtKind[];
  arts: ArtKind[];
  metro: Metro | null;
  cheap: boolean;
};

let parsedCache: ParsedQuery | null = null;

function parseQuery(q: string): ParsedQuery {
  if (parsedCache && parsedCache.q === q) return parsedCache;
  const intent = parseIntent(q);
  const intentWords = new Set(intent.words.map((w) => w.replace(/[^a-z0-9]/g, "")));
  const nq = norm(q);
  const toks = nq ? nq.split(" ") : [];
  const all = toks.filter((t) => !intentWords.has(t) && !FILLER.has(t));
  const artHits = queryArtHits(q);
  const hardArts = artHits.map((h) => h.art).filter((a, i, arr) => arr.indexOf(a) === i);
  const softArts = softArtsFor(all, hardArts);
  const arts = hardArts.length ? hardArts : softArts.length ? softArts : intent.arts;
  const lq = " " + nq + " ";
  const aliasWords = new Set<string>();
  for (const h of artHits) for (const w of lq.slice(h.start, h.end).split(" ")) if (w) aliasWords.add(w);
  parsedCache = {
    q,
    norm: nq,
    stem: stemPhrase(nq),
    compact: nq.replace(/ /g, ""),
    intent,
    all,
    aliasWords,
    artHits,
    hardArts,
    softArts,
    arts,
    metro: metroInQuery(q)?.metro ?? null,
    cheap: /\b(cheap|budget|affordable|inexpensive)\b/i.test(q),
  };
  return parsedCache;
}

/* ---------- matching ---------- */

type WordHit = { v: Word; rel: number };

/**
 * The vocabulary words one typed token can mean. The first-letter bucket holds every prefix, stem and one-edit
 * neighbour, so the usual case reads a few thousand words. Only a token that finds nothing there pays for the
 * full scan that catches a fragment in the middle of a word ("ski" inside "jetski").
 */
function matchWords(idx: Index, tok: string): WordHit[] {
  const ts = stem(tok);
  const out: WordHit[] = [];
  let best = 0;
  for (const v of idx.byFirst.get(tok[0]) || []) {
    const rel = relate(v.w, v.s, tok, ts);
    if (!rel) continue;
    out.push({ v, rel });
    if (rel > best) best = rel;
  }
  if (best >= 6 || tok.length < 4) return out;
  for (const v of idx.all) {
    if (v.w[0] === tok[0]) continue;
    const rel = relate(v.w, v.s, tok, ts);
    if (rel >= 4) out.push({ v, rel });
  }
  return out;
}

/** Whether the catalog has this word, or something close enough to be the same word typed badly. */
function hasNear(idx: Index, t: string): boolean {
  const ts = stem(t);
  for (const v of idx.byFirst.get(t[0]) || []) if (relate(v.w, v.s, t, ts) >= 6) return true;
  return false;
}

/**
 * One thing the guest asked for, and every spelling of it the catalog might use. A term is required unless the
 * guest spent it naming the activity: "denver" in "axe throwing denver" has to land somewhere, "axe" does not,
 * because the listing is already known to be an axe place.
 */
type Term = { forms: string[]; req: boolean };

/**
 * Query tokens, with the two ways a guest splits a word differently from the operator folded in:
 * "jetski" typed for "Jet Ski", and "jet ski" typed for "Jetski". Either spelling satisfies the term.
 */
function queryTerms(idx: Index, p: ParsedQuery): Term[] {
  const toks = p.all;
  const out: Term[] = [];
  const term = (forms: string[], src: string[]) => out.push({ forms, req: src.some((t) => !p.aliasWords.has(t)) });
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // "jet ski" may be one word in the catalog, so the joined spelling answers both halves.
    const next = toks[i + 1];
    if (next && idx.vocab.has(t + next)) {
      term([t, t + next], [t]);
      term([next, t + next], [next]);
      i++;
      continue;
    }
    // "wakeboarding" may be two words in the catalog, and then both halves have to land. Only a word the
    // catalog has no near spelling for is worth pulling apart, or "jetsky" becomes "jet" plus "sky".
    if (t.length >= 8 && !hasNear(idx, t)) {
      let split = false;
      for (let c = 4; c <= t.length - 4 && !split; c++) {
        if (idx.vocab.has(t.slice(0, c)) && idx.vocab.has(t.slice(c))) {
          term([t.slice(0, c)], [t]);
          term([t.slice(c)], [t]);
          split = true;
        }
      }
      if (split) continue;
    }
    term([t], [t]);
  }
  return out;
}

/** Aliases of the named activities that turn up in this listing's own name or its service menu. */
function aliasIn(text: string, arts: ArtKind[]): boolean {
  for (const a of arts) for (const w of ART_ALIASES[a] || []) if (w.length >= 4 && wordIn(text, w)) return true;
  return false;
}

/**
 * How well the listing's own name answers the query. This is the top of the ranking on purpose: a guest who
 * types "Topgolf" or "Ecomersion" wants that business, not every disc golf course or kayak launch.
 */
function nameScore(e: Entry, p: ParsedQuery): number {
  if (p.norm.length < 3) return 0;
  if (e.title === p.norm || e.stem === p.stem) return 220;
  if (e.title.startsWith(p.norm + " ") || e.stem.startsWith(p.stem + " ")) return 150;
  if ((" " + e.title + " ").includes(" " + p.norm + " ") || (" " + e.stem + " ").includes(" " + p.stem + " ")) return 110;
  if (e.compact.startsWith(p.compact)) return 100;
  if (p.all.length > 1 && p.all.every((t) => e.words.some((w) => w.startsWith(t)))) return 60;
  if (p.compact.length >= 5 && e.compact.includes(p.compact)) return 45;
  return 0;
}

function kidOk(e: Entry): boolean {
  if (e.kid === -1) e.kid = kidFriendly(e.u) ? 1 : 0;
  return e.kid === 1;
}

function groupOk(e: Entry): boolean {
  if (e.grp === -1) e.grp = /group|party|private|up to \d+|people/i.test([...e.u.specs, ...(e.u.tags || [])].join(" ")) ? 1 : 0;
  return e.grp === 1;
}

/** Where the guest is looking. The index is always the whole catalog, so scoping happens here. */
export type SearchScope = {
  /** A metro id, or "all" / undefined for everywhere. */
  metroId?: string;
  cat?: CategoryId;
  /** Anything the guest set that the index cannot know, such as the Where radius on desktop. */
  keep?: (u: Unclaimed) => boolean;
};

function inScope(u: Unclaimed, s: SearchScope | undefined): boolean {
  if (!s) return true;
  if (s.metroId && s.metroId !== "all" && u.metroId !== s.metroId) return false;
  if (s.keep && !s.keep(u)) return false;
  return true;
}

type Scored = { e: Entry; s: number };

/**
 * Score every listing that could answer the query. Candidates come from the index: the listings that carry
 * each typed word, plus every listing of an activity the guest named. Nothing else is touched.
 */
function rank(pool: Unclaimed[], q: string, scope?: SearchScope): Scored[] {
  const idx = getIndex(pool);
  const p = parseQuery(q);
  const n = idx.entries.length;
  const out: Scored[] = [];
  const wantsCheap = p.cheap;
  const maxPrice = p.intent.maxPrice;

  // A guest who only described an occasion ("date night", "rainy day with kids") is browsing, not searching.
  if (!p.all.length) {
    const ids = p.arts.length ? p.arts.flatMap((a) => idx.byArt.get(a) || []) : null;
    const scan = (i: number) => {
      const e = idx.entries[i];
      if (!inScope(e.u, scope)) return;
      if (maxPrice != null && (e.from == null || e.from > maxPrice)) return;
      if (p.intent.kids && !kidOk(e)) return;
      let s = p.arts.length ? 30 + (p.arts.length - p.arts.indexOf(e.art)) : 20;
      if (e.u.cover) s += 4;
      s += e.qual * 1.5 + (e.u.rating ? (e.u.rating - 4) * 4 : 0);
      if (e.from != null) s += 3;
      if (wantsCheap && e.from != null) s += e.from <= 40 ? 6 : e.from <= 75 ? 3 : 0;
      if (p.intent.group && groupOk(e)) s += 4;
      out.push({ e, s });
    };
    if (ids) for (const i of ids) scan(i);
    else for (let i = 0; i < n; i++) scan(i);
    return out;
  }

  // Word pass: for each thing the guest asked for, the best place it lands on each listing.
  const { pts, hits, reqHits, cur } = idx;
  pts.fill(0);
  hits.fill(0);
  reqHits.fill(0);
  const terms = queryTerms(idx, p);
  let needReq = 0;
  for (const term of terms) {
    if (term.req) needReq++;
    cur.fill(0);
    for (const form of term.forms) {
      for (const m of matchWords(idx, form)) {
        const w = m.rel;
        for (const post of m.v.post) {
          const e = post >>> 4;
          const s = w * MASK_WEIGHT[post & 15];
          if (s > cur[e]) cur[e] = s;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (cur[i] > 0) {
        pts[i] += cur[i];
        hits[i]++;
        if (term.req) reqHits[i]++;
      }
    }
  }

  const need = terms.length;
  const seen = new Uint8Array(n);
  const score = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    const e = idx.entries[i];
    if (!inScope(e.u, scope)) return;
    if (maxPrice != null && (e.from == null || e.from > maxPrice)) return;
    if (p.intent.kids && !kidOk(e)) return;

    let s = 0;
    const onArt = p.arts.includes(e.art);
    if (p.arts.length) {
      if (onArt) {
        s += p.hardArts.length ? 44 : 30;
        // "sauna" names the sauna kind first even though spas also list it; "golf" is a course before a simulator.
        if (p.artHits.some((h) => h.art === e.art && h.rank <= 1)) s += 8;
      } else if (aliasIn(e.title, p.arts)) s += 24;
      else if (!p.hardArts.length && aliasIn([...(e.u.tags || []), ...e.u.options.map((o) => o.name)].join(" "), p.arts)) s += 24;
      // The guest named the activity. A listing that is not it and never mentions it is not a result.
      else if (p.hardArts.length) return;
    }
    // A name match on a listing of the wrong kind still counts, just not as much: "Mini Golf World" is a fair
    // answer to "golf", it is not a better one than the golf courses.
    const name = nameScore(e, p);
    s += p.hardArts.length && !onArt ? name * 0.5 : name;
    s += pts[i];
    if (p.metro && e.metroId === p.metro.id) s += 20;
    if (p.arts.length && s < 24) return;
    s += e.qual + (e.u.cover ? 2 : 0) + (e.from != null ? 1 : 0);
    if (wantsCheap && e.from != null) s += e.from <= 40 ? 6 : e.from <= 75 ? 3 : 0;
    if (s > 0) out.push({ e, s });
  };

  // Everything the guest typed has to land somewhere, so "axe throwing denver" is axe throwing in Denver and
  // "date night miami" stays in Miami. A listing of an activity they named already answers the words they spent
  // naming it, so it only has to carry the rest.
  for (let i = 0; i < n; i++) if (hits[i] === need) score(i);
  if (p.arts.length && needReq < need) {
    for (const a of p.arts) for (const i of idx.byArt.get(a) || []) if (reqHits[i] === needReq) score(i);
  }
  return out;
}

function sortScored(list: Scored[]): Scored[] {
  return list.sort((a, b) => b.s - a.s || (a.e.title < b.e.title ? -1 : a.e.title > b.e.title ? 1 : 0));
}

/**
 * Ranked listings for a query. `pool` should be the whole catalog: scoping by city, category or distance goes
 * through `scope` so the index survives from one keystroke to the next.
 */
export function searchListings(pool: Unclaimed[], q: string, scope?: SearchScope): Unclaimed[] {
  const cat = scope?.cat;
  if (!q.trim()) {
    const base = scope ? pool.filter((u) => inScope(u, scope)) : pool.slice();
    return cat && cat !== "all" ? base.filter((u) => inCat(u, cat)) : base;
  }
  const scored = sortScored(rank(pool, q, scope));
  const items = scored.map((x) => x.e.u);
  return cat && cat !== "all" ? items.filter((u) => inCat(u, cat)) : items;
}

/* ---------- typeahead ---------- */

export type ActivityHit = { art: ArtKind; label: string; query: string; count: number };
export type PlaceHit = { metro: Metro; count: number };

export type Suggestions = {
  /** Ranked results inside the category tab, for the feed behind the dropdown. */
  results: Unclaimed[];
  /** The same query with the category tab ignored. Lets the UI offer a way out instead of an empty page. */
  otherCats: number;
  activities: ActivityHit[];
  /**
   * Kinds the guest named that the catalog has, but not inside the city they are looking at. The count is the
   * catalog-wide one, so the UI can offer a wider search instead of a dead end.
   */
  elsewhere: ActivityHit[];
  operators: Unclaimed[];
  places: PlaceHit[];
  /** True when nothing matched and the lists above are the nearest things the catalog does have. */
  nearMiss: boolean;
};

const activityHit = (art: ArtKind, count: number): ActivityHit => ({
  art,
  label: ART_LABEL[art] || art,
  query: ART_ALIASES[art]?.[0] || art,
  count,
});

/**
 * One pass that feeds both the dropdown and the feed: the matching listings, the kinds of activity they are,
 * and the cities behind them, each counted from the catalog rather than guessed.
 */
export function searchSuggest(pool: Unclaimed[], q: string, scope?: SearchScope, limit = 5): Suggestions {
  const empty: Suggestions = { results: [], otherCats: 0, activities: [], elsewhere: [], operators: [], places: [], nearMiss: false };
  if (!q.trim()) return empty;
  const idx = getIndex(pool);
  const p = parseQuery(q);
  const scored = sortScored(rank(pool, q, scope));
  const cat = scope?.cat;
  const narrow = !!cat && cat !== "all";
  const inTab = narrow ? scored.filter((x) => inCat(x.e.u, cat)) : scored;

  // Activity rows: the kinds the guest named first, then whatever the results actually are.
  const counts = new Map<ArtKind, number>();
  for (const x of inTab) counts.set(x.e.art, (counts.get(x.e.art) || 0) + 1);
  const arts: ArtKind[] = [];
  for (const a of [...p.hardArts, ...p.softArts]) if (counts.has(a) && !arts.includes(a)) arts.push(a);
  for (const [a] of Array.from(counts.entries()).sort((x, y) => y[1] - x[1])) {
    if (!arts.includes(a)) arts.push(a);
    if (arts.length >= limit) break;
  }
  const activities = arts.slice(0, limit).map((a) => activityHit(a, counts.get(a) || 0));

  const metroCount = (m: Metro) => ({ metro: m, count: (idx.byMetro.get(m.id) || []).length });
  const places = searchMetros(q, 3).map(metroCount);

  const results = inTab.map((x) => x.e.u);
  const otherCats = scored.length - inTab.length;
  if (results.length) {
    return { results, otherCats, activities, elsewhere: [], operators: results.slice(0, limit), places, nearMiss: false };
  }

  // Nothing landed. Offer what the catalog really does have, in the order a guest would want it: the same
  // search in the tabs they are not looking at, then the kind they asked for wherever it exists, then the
  // nearest thing to what they typed. Every count is a real count, so no row leads to an empty page.
  const spill = new Map<ArtKind, number>();
  for (const x of scored) spill.set(x.e.art, (spill.get(x.e.art) || 0) + 1);
  let nearArts: ActivityHit[] = Array.from(spill.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([a, n]) => activityHit(a, n));
  const named = [...p.hardArts, ...p.softArts];
  const guess = named.length ? named : softArtsFor(p.all.length ? p.all : tokens(q), []);
  if (!nearArts.length) {
    // Same city, any category: a kayak search inside the Air tab still has 14 kayak places to point at.
    const anyCat = { metroId: scope?.metroId, keep: scope?.keep };
    nearArts = guess.map((a) => activityHit(a, countIn(idx, a, anyCat))).filter((a) => a.count > 0).slice(0, limit);
  }
  // The kind exists, the city does not have one. Say so with its real reach rather than sending them nowhere.
  const elsewhere = nearArts.length
    ? []
    : guess.map((a) => activityHit(a, (idx.byArt.get(a) || []).length)).filter((a) => a.count > 0).slice(0, limit);
  const seenMetro = new Set(places.map((x) => x.metro.id));
  return {
    results: [],
    otherCats,
    activities: nearArts,
    elsewhere,
    operators: [],
    places: [...places, ...nearMetros(q).filter((m) => !seenMetro.has(m.id)).map(metroCount)].slice(0, 3),
    nearMiss: true,
  };
}

/** How many listings of one kind sit inside the guest's current city and category. */
function countIn(idx: Index, art: ArtKind, scope?: SearchScope): number {
  let n = 0;
  for (const i of idx.byArt.get(art) || []) {
    const u = idx.entries[i].u;
    if (inScope(u, scope) && (!scope?.cat || inCat(u, scope.cat))) n++;
  }
  return n;
}

/* ---------- places ---------- */

/** Every name a metro answers to, normalised once. */
const metroNames = new Map<string, string[]>();
function namesFor(m: Metro): string[] {
  let list = metroNames.get(m.id);
  if (!list) {
    const full = norm(m.name);
    const first = full.split(" ")[0];
    list = [full, m.id.replace(/-/g, " "), ...(METRO_ALIASES[m.id] || []).map(norm)];
    if (first.length >= 5 && first !== full) list.push(first);
    list = list.filter((c, i) => c && list!.indexOf(c) === i);
    metroNames.set(m.id, list);
  }
  return list;
}

/**
 * A place typed into the What box. "axe throwing denver" names Denver, so the search should run there,
 * not in whatever Where is set to. Longest metro name wins; the matched words come back so callers can strip them.
 */
export function metroInQuery(q: string): { metro: Metro; words: string[] } | null {
  const lq = " " + norm(q) + " ";
  let best: { metro: Metro; words: string[] } | null = null;
  for (const m of METROS) {
    for (const c of namesFor(m)) {
      if (!lq.includes(" " + c + " ")) continue;
      const words = c.split(" ");
      if (!best || words.length > best.words.length) best = { metro: m, words };
    }
  }
  return best;
}

/** Cities matching what the guest typed, including a half-typed or misspelled name ("vancou", "montral"). */
export function searchMetros(q: string, limit = 4): Metro[] {
  const toks = tokens(q).filter((t) => !FILLER.has(t));
  if (!toks.length) return [];
  const out: { m: Metro; s: number }[] = [];
  for (const m of METROS) {
    const hay = [...namesFor(m), norm(m.region)];
    const words = Array.from(new Set(hay.flatMap((h) => h.split(" "))));
    let total = 0;
    let landed = 0;
    for (const t of toks) {
      const ts = stem(t);
      let best = 0;
      for (const c of hay) if (c.startsWith(t)) best = Math.max(best, t.length >= 3 ? 10 : 8);
      for (const w of words) best = Math.max(best, relate(w, stem(w), t, ts));
      if (best >= 6) {
        landed++;
        total += best;
      }
    }
    // A city is a suggestion when its name was typed, not when a stray word brushed past it.
    if (landed) out.push({ m, s: total + landed * 10 });
  }
  return out.sort((a, b) => b.s - a.s || a.m.name.localeCompare(b.m.name)).slice(0, limit).map((x) => x.m);
}

/** Cities whose name is one typo away, for the "did you mean" line when a search finds nothing. */
function nearMetros(q: string, limit = 3): Metro[] {
  const toks = tokens(q).filter((t) => t.length >= 4 && !FILLER.has(t));
  if (!toks.length) return [];
  const out: { m: Metro; d: number }[] = [];
  for (const m of METROS) {
    let best = 9;
    for (const c of namesFor(m)) for (const t of toks) best = Math.min(best, editDistance(c, t));
    if (best <= slack(toks[0])) out.push({ m, d: best });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, limit).map((x) => x.m);
}

/* ---------- operator picker: business name search ---------- */

/**
 * The operator picker: an owner typing their own business name. Matches the name and the website domain only,
 * with no activity aliases, blurbs or intent parsing, so 55,000 operators answer in a few milliseconds per
 * keystroke. Hits are bucketed by score and only the top bucket or two get sorted, since a two-letter query
 * matches thousands. A fuzzy pass runs only when the strict one comes up short, so one typo still finds the shop.
 */
export function searchByName(pool: Unclaimed[], q: string, limit = 8): Unclaimed[] {
  const nq = norm(q);
  if (!nq) return [];
  const idx = getIndex(pool);
  const toks = nq.split(" ");
  const compactQ = nq.replace(/ /g, "");
  const spaced = " " + nq;
  const buckets = new Map<number, Entry[]>();
  let count = 0;
  const add = (e: Entry, s: number) => {
    const b = buckets.get(s);
    if (b) b.push(e);
    else buckets.set(s, [e]);
    count++;
  };
  for (const e of idx.entries) {
    let s = 0;
    if (e.title === nq) s = 100;
    else if (e.title.startsWith(nq)) s = 90;
    else if (e.title.includes(spaced)) s = 80;
    else if (e.compact.startsWith(compactQ)) s = 78;
    else if (toks.length > 1 && toks.every((t) => e.words.some((w) => w.startsWith(t)))) s = 70;
    else if (e.compact.includes(compactQ)) s = 55;
    else if (e.domain.includes(compactQ)) s = 50;
    if (!s) continue;
    add(e, s + (e.u.cover ? 2 : 0) + (e.qual ? 1 : 0));
  }
  const long = toks.filter((t) => t.length >= 4).sort((a, b) => b.length - a.length);
  if (count < limit && long.length) {
    const seen = new Set<Entry>();
    for (const b of buckets.values()) for (const e of b) seen.add(e);
    // Every name holding a word within one edit of the longest typed word, then the rest narrow it down.
    let cands = nearName(idx, long[0]);
    for (const t of toks) {
      if (t === long[0]) continue;
      const ok = t.length >= 4 ? nearName(idx, t) : null;
      cands = new Set(Array.from(cands).filter((e) => (ok ? ok.has(e) : e.words.some((w) => w.startsWith(t)))));
      if (!cands.size) break;
    }
    for (const e of cands) if (!seen.has(e)) add(e, 30 + (e.u.cover ? 2 : 0));
  }
  const scores = Array.from(buckets.keys()).sort((a, b) => b - a);
  const out: Unclaimed[] = [];
  for (const s of scores) {
    const b = buckets.get(s)!;
    if (b.length > 1) b.sort((a, c) => (a.title < c.title ? -1 : a.title > c.title ? 1 : a.u.area < c.u.area ? -1 : a.u.area > c.u.area ? 1 : 0));
    for (const e of b) {
      out.push(e.u);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Names holding a word near `t`, found through the word index rather than by scanning 55,000 names. The usual
 * pass reads one first-letter bucket; a name whose first letter is itself the typo falls back to the vocabulary.
 */
function nearName(idx: Index, t: string): Set<Entry> {
  const max = slack(t);
  const out = new Set<Entry>();
  const take = (v: Word) => {
    for (const post of v.post) if (post & F_TITLE) out.add(idx.entries[post >>> 4]);
  };
  for (const v of idx.byFirst.get(t[0]) || []) {
    if (v.w.startsWith(t) || editDistance(v.w, t) <= max) take(v);
  }
  if (out.size) return out;
  for (const v of idx.all) {
    if (v.w[0] !== t[0] && Math.abs(v.w.length - t.length) <= max && editDistance(v.w, t) <= max) take(v);
  }
  return out;
}
