import { ART_LABEL } from "../data/art";
import { CATS, VIRTUAL_CATS, inCat } from "../data/categories";
import { METROS, METRO_ALIASES, metroById, metroCoords, type Metro } from "../data/metros";
import { CA_REGIONS, REGION_NAME, regionOfArea } from "../data/regions";
import { ART_ALIASES, INTENT_PHRASES } from "../data/synonyms";
import type { ArtKind, CategoryId, Unclaimed } from "../data/types";
import { milesBetween } from "./geo";

/**
 * Guest search for Explore and the desktop home.
 *
 * Everything runs off one inverted index built once per catalog (55,000 operators), so a keystroke touches a
 * few thousand postings instead of every record. Ranking is a fixed order of evidence: the operator's own name,
 * then the activity the guest named, then the words that landed, then the city. Nothing here invents a listing,
 * a price or a rating: every number shown comes from the catalog.
 */

/* ---------- synonyms ---------- */

// The synonym table lives in src/data/synonyms.ts; it is re-exported here for the screens that already import it.
export { ART_ALIASES, WHAT_INTENTS } from "../data/synonyms";

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
 * The indexed word is only the front of the typed token: "heli" under a guest typing "helicopter". Worth a
 * little, and worth nothing at all against a spelling the guest never typed, where the front of the token is
 * simply the other word of the pair.
 */
const REL_HALF = 5;

/** The indexed word is the typed token, letter for letter. */
const REL_EXACT = 10;

/**
 * How strongly one typed token matches one indexed word, 0 for no match. The order is the ranking order:
 * the same word, the same stem, the word the guest is part way through typing, then a typo, then a fragment.
 */
function relate(word: string, wordStem: string, tok: string, tokStem: string): number {
  if (word === tok) return REL_EXACT;
  if (wordStem === tokStem) return 9;
  if (word.startsWith(tok)) return tok.length >= 3 ? 8 : 7;
  if (tok.length >= 4 && wordStem.startsWith(tokStem)) return 8;
  // "helicopter" should reach a listing filed under "heli", but "skydiving" must not reach every "Sky" in a name.
  if (word.length >= 4 && tok.startsWith(word)) return REL_HALF;
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
  /** Listings whose own area or metro is, letter for letter, a word the guest spent naming where they are. */
  atPlace: Uint8Array;
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
    atPlace: new Uint8Array(n),
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

/** Rating and photo weight, read off the record rather than out of the hot loop. */
function qualOf(u: Unclaimed): number {
  return u.rating && u.reviews ? Math.min(6, Math.log10(u.reviews + 1) * 2) : 0;
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
    qual: qualOf(u),
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
 * Point the folded entries at the records the new pool holds.
 *
 * `rebuild()` in catalog.ts hands out a new array, with new objects for the listings it changed, whenever an
 * operator saves an edit or a lite record is swapped for its own detail file. The ids and their order do not
 * move, so the postings still address the right listings, but every entry also kept the object it folded and
 * that object is what a search handed back. A guest searching after an operator dropped their price got the
 * record from before the edit: the old price on the card, the old photos, and a "under $50" search that
 * filtered on a price nobody charges any more. The detail swap did the same thing the other way, handing back
 * the slim copy of a listing whose full record had already arrived.
 *
 * Only the entries whose record actually changed are touched, which is one or two of 59,000 on an edit. The
 * word postings are not rebuilt, so a listing renamed in the dashboard is still reachable by the name it was
 * folded under until the catalog itself reloads; the entry's own name fields follow the edit, so the operator
 * name picker finds it under the new one.
 */
function repoint(idx: Index, pool: Unclaimed[]): void {
  for (let i = 0; i < idx.entries.length; i++) {
    const u = pool[i];
    const e = idx.entries[i];
    if (e.u === u) continue;
    e.u = u;
    e.from = startingPrice(u);
    e.qual = qualOf(u);
    // Both are answered from published text the operator can edit, so they are asked again rather than kept.
    e.kid = -1;
    e.grp = -1;
    const title = norm(u.title);
    if (title !== e.title) {
      e.title = title;
      e.words = title ? title.split(" ") : [];
      e.stem = stemPhrase(title);
      e.compact = e.words.join("");
    }
  }
  idx.pool = pool;
}

/**
 * Fold more of the catalog into the index, stopping after `ms` of work. Returns true once it is complete.
 * The search surfaces call this from idle time so the first keystroke does not pay for 55,000 listings.
 */
export function warmSearch(pool: Unclaimed[], ms = 12): boolean {
  /**
   * The index is positional: entries, and the scratch arrays sized to the pool, are addressed by the pool's own
   * indices. So it only has to be thrown away when the ids or their order change, not whenever the array is a
   * new object. rebuild() in catalog.ts hands out a new array on every listing open, hover prefetch and
   * operator override, and keying on identity meant a 59,000 entry index was discarded and re-folded on the
   * next keystroke: 387ms of blocked main thread measured here, several times that on a phone. Walking the ids
   * to check costs well under a millisecond by comparison.
   *
   * When the ids match, the listings that changed are repointed in place rather than re-folded, so the index
   * keeps its postings and still reads the records the rest of the app is holding.
   */
  const samePool =
    !!index && index.pool.length === pool.length && index.pool.every((u, i) => u.id === pool[i].id);
  if (!index || !samePool) index = newIndex(pool);
  else if (index.pool !== pool) repoint(index, pool);
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
/**
 * The spellings one alias answers to: itself, its plurals, and its -ing form ("kayak" reaches "kayaks" and
 * "kayaking", "axe throw" reaches "axe throwing"). Irregular forms ("swimming", "canoeing") are listed outright.
 */
function aliasForms(w: string): string[] {
  const ing = w.endsWith("e") ? w.slice(0, -1) + "ing" : w + "ing";
  return [w, w + "s", w + "es", ing];
}

type AliasForm = { art: ArtKind; form: string; words: number; rank: number };
let aliasFormsCache: AliasForm[] | null = null;
function allAliasForms(): AliasForm[] {
  if (aliasFormsCache) return aliasFormsCache;
  const out: AliasForm[] = [];
  for (const [art, words] of Object.entries(ART_ALIASES) as [ArtKind, string[]][]) {
    for (let rank = 0; rank < words.length; rank++) {
      const w = norm(words[rank]);
      if (!w) continue;
      const n = w.split(" ").length;
      for (const form of aliasForms(w)) out.push({ art, form, words: n, rank });
    }
  }
  aliasFormsCache = out;
  return out;
}

function aliasHits(lq: string): { kept: AliasHit[]; dropped: AliasHit[] } {
  const found: AliasHit[] = [];
  for (const { art, form, words, rank } of allAliasForms()) {
    const needle = " " + form + " ";
    let at = lq.indexOf(needle);
    while (at >= 0) {
      found.push({ art, start: at + 1, end: at + 1 + form.length, words, rank });
      at = lq.indexOf(needle, at + 1);
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
  const lq = " " + norm(q) + " ";
  const kept = aliasHits(lq).kept;
  // A word inside a place name is not an activity: "Fort Myers" is not a fort to visit.
  const place = metroInQuery(q);
  if (place) {
    const at = lq.indexOf(" " + place.words.join(" ") + " ");
    if (at >= 0) {
      const start = at + 1;
      const end = at + 1 + place.words.join(" ").length;
      return kept.filter((h) => !(start <= h.start && h.end <= end)).sort((a, b) => a.start - b.start);
    }
  }
  return kept.sort((a, b) => a.start - b.start);
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
  for (const it of INTENT_PHRASES) {
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

const FILLER = new Set(["rental", "rentals", "rent", "near", "me", "in", "the", "a", "an", "and", "for", "with", "best", "cheap", "tour", "tours", "ideas", "idea", "stuff", "things", "to", "do", "of", "on", "at", "good", "great", "top", "nearby", "around", "here", "my", "our", "we", "i", "some", "any", "night", "day", "tonight", "today", "now", "this", "weekend", "open", "place", "places", "spot", "spots", "options", "local", "close", "closest", "nearest", "budget", "affordable", "inexpensive", "something", "somewhere", "anything", "anywhere", "want", "looking", "find", "go", "get", "book"]);


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
/**
 * One spelling of one thing the guest asked for. `glued` marks the spelling the guest did not type, the two
 * tokens run together, which is matched more strictly: see `REL_HALF`.
 */
type Form = { w: string; glued: boolean };
type Term = { forms: Form[]; req: boolean };

const typed = (w: string): Form => ({ w, glued: false });
const glued = (w: string): Form => ({ w, glued: true });

/**
 * Query tokens, with the two ways a guest splits a word differently from the operator folded in:
 * "jetski" typed for "Jet Ski", and "jet ski" typed for "Jetski". Either spelling satisfies the term.
 */
function queryTerms(idx: Index, p: ParsedQuery): Term[] {
  const toks = p.all;
  const out: Term[] = [];
  const term = (forms: Form[], src: string[]) => out.push({ forms, req: src.some((t) => !p.aliasWords.has(t)) });
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // "jet ski" may be one word in the catalog, so the joined spelling answers both halves.
    const next = toks[i + 1];
    if (next && idx.vocab.has(t + next)) {
      term([typed(t), glued(t + next)], [t]);
      term([typed(next), glued(t + next)], [next]);
      i++;
      continue;
    }
    // "wakeboarding" may be two words in the catalog, and then both halves have to land. Only a word the
    // catalog has no near spelling for is worth pulling apart, or "jetsky" becomes "jet" plus "sky".
    if (t.length >= 8 && !hasNear(idx, t)) {
      let split = false;
      for (let c = 4; c <= t.length - 4 && !split; c++) {
        if (idx.vocab.has(t.slice(0, c)) && idx.vocab.has(t.slice(c))) {
          term([typed(t.slice(0, c))], [t]);
          term([typed(t.slice(c))], [t]);
          split = true;
        }
      }
      if (split) continue;
    }
    term([typed(t)], [t]);
  }
  return out;
}

/** One pattern per kind: every alias of four letters or more, as whole words, with the plural allowed. */
const aliasRe = new Map<ArtKind, RegExp | null>();
function aliasPattern(art: ArtKind): RegExp | null {
  let re = aliasRe.get(art);
  if (re === undefined) {
    const words = (ART_ALIASES[art] || []).map(norm).filter((w) => w.length >= 4);
    re = words.length ? new RegExp("(^|[^a-z0-9])(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(s|es)?($|[^a-z0-9])", "i") : null;
    aliasRe.set(art, re);
  }
  return re;
}

/** Aliases of the named activities that turn up in this listing's own name or its service menu. */
function aliasIn(text: string, arts: ArtKind[]): boolean {
  for (const a of arts) {
    const re = aliasPattern(a);
    if (re && re.test(text)) return true;
  }
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
  const { pts, hits, reqHits, atPlace, cur } = idx;
  pts.fill(0);
  hits.fill(0);
  reqHits.fill(0);
  atPlace.fill(0);
  const terms = queryTerms(idx, p);
  let needReq = 0;
  for (const term of terms) {
    if (term.req) needReq++;
    cur.fill(0);
    for (const form of term.forms) {
      for (const m of matchWords(idx, form.w)) {
        /**
         * A word that is merely the front of the glued spelling is the guest's *other* word, not this one.
         * "fort myers" glues to "fortmyers", and every Fort Smith, Fort Garry and Fort Benning in the catalog
         * answered the "myers" half through it: a guest asking for golf in Fort Myers opened on a course at
         * Fort Benning, Georgia, and one asking for a brewery in Fort Lauderdale opened on Fort Hill, in
         * Massachusetts. The glued spelling still answers both halves when the catalog really does carry it
         * ("Jetski Miami" for "jet ski"), which is the whole point of gluing them.
         */
        if (form.glued && m.rel === REL_HALF) continue;
        const w = m.rel;
        for (const post of m.v.post) {
          const e = post >>> 4;
          const s = w * MASK_WEIGHT[post & 15];
          if (s > cur[e]) cur[e] = s;
          // The word is spelled exactly this way in the listing's own area or metro, and the guest did not
          // spend it naming the activity: they named this listing's town. See the bonus below.
          if (term.req && w === REL_EXACT && post & F_PLACE) atPlace[e] = 1;
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
    /**
     * Being where the guest is looking.
     *
     * Only the 47 metros carried this, so a guest who named any other town got nothing for it and a shop
     * whose *name* looked like the town outranked the shops actually in it: "spa mesa" opened on Mysa
     * Wellness Spa in Brooklyn, "brewery bellingham" on The Bell in Scona in Edmonton, "bowling milwaukee"
     * on Milwaukie Bowl in Oregon, and "horse sarasota" on The Dark Horse Mercantile in Saratoga Springs.
     * A town spelled exactly the way the guest spelled it now counts too, for less than a metro, because
     * towns share names across states and a metro is the place the guest actually picked.
     */
    if (p.metro && e.metroId === p.metro.id) s += 20;
    else if (atPlace[i]) s += 12;
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
/** A state or province, with its listing count and the middle of its listings for distance sorting. */
export type RegionHit = { code: string; name: string; country: string; count: number; lat: number; lon: number };

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
  /** States and provinces the guest typed, misspellings included ("floruda"). */
  regions: RegionHit[];
  /**
   * The category tab the kind the guest named belongs to, counted as browse in the guest's place. Offered when
   * the kind itself has nothing there: "no pottery in Tampa, but Classes in Tampa has 41".
   */
  family: FamilyHit | null;
  /** True when nothing matched and the lists above are the nearest things the catalog does have. */
  nearMiss: boolean;
};

export type FamilyHit = { cat: CategoryId; name: string; count: number };

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
  const empty: Suggestions = { results: [], otherCats: 0, activities: [], elsewhere: [], operators: [], places: [], regions: [], family: null, nearMiss: false };
  if (!q.trim()) return empty;
  const idx = getIndex(pool);
  const p = parseQuery(q);
  const scored = sortScored(rank(pool, q, scope));
  const cat = scope?.cat;
  const narrow = !!cat && cat !== "all";
  // A named kind is a search, not a browse. Wellness All plus "escape rooms" used to return 0 because the
  // tab hid indoor listings, then offered "22 in other categories" as the way out. The guest already said
  // the kind. The tab is for when What is empty.
  const inTab = narrow && !p.hardArts.length ? scored.filter((x) => inCat(x.e.u, cat)) : scored;

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

  const regions = searchRegions(pool, q);
  // "Florida" names no city, so the cities offered under it are that state's, not whatever brushed the word.
  const nearby = regions.length ? METROS.filter((m) => m.region === regions[0].code) : searchMetros(q, 3);

  /**
   * How many listings this very query has in a city, inside the guest's own tab, because that is the page a
   * city row opens.
   *
   * Counting the city itself, every listing in it of every kind, is what offered a guest searching tennis in
   * Tampa "Nashville · 313" and opened an empty page on it: Nashville answers "tennis" because Tennessee
   * does, and it has 313 listings and no tennis. The empty state was already counted this way; the found
   * state, which is what the guest sees once a filter clears the grid under it, was not.
   *
   * Ranked once, without the guest's place, and only when there is a city worth counting for. A guest who is
   * already looking everywhere has that ranking in hand, so only a narrowed search pays for it.
   */
  const wide = !scope?.keep && (!scope?.metroId || scope.metroId === "all");
  let byCity: Map<string, number> | null = null;
  const cityCounts = (): Map<string, number> => {
    if (!byCity) {
      byCity = new Map();
      for (const x of wide ? scored : rank(pool, q, undefined)) if (!narrow || inCat(x.e.u, cat!)) byCity.set(x.e.metroId, (byCity.get(x.e.metroId) || 0) + 1);
    }
    return byCity;
  };
  const metroCount = (m: Metro) => ({ metro: m, count: cityCounts().get(m.id) || 0 });
  const withListings = nearby.length ? nearby.map(metroCount).filter((x) => x.count > 0) : [];
  const places = regions.length ? withListings.sort((a, b) => b.count - a.count).slice(0, 4) : withListings;

  const results = inTab.map((x) => x.e.u);
  const otherCats = scored.length - inTab.length;
  if (results.length) {
    return { results, otherCats, activities, elsewhere: [], operators: results.slice(0, limit), places, regions, family: null, nearMiss: false };
  }

  // Nothing landed. Offer what the catalog really does have, in the order a guest would want it: the same
  // search in the tabs they are not looking at, then the kind they asked for wherever it exists, then the
  // nearest thing to what they typed.
  //
  // Every count below is the size of the page its own button opens, under the guest's own category tab and
  // the place their click leaves them in. Counting the city, or the kind, in the abstract is what put
  // "Skydive · 7" and "Orlando · 1,511" under an empty Water tab and opened another empty page on both, and
  // offered "Honolulu · 189" to a guest already looking at Honolulu. A row whose page would be empty is not
  // shown at all; the "in other categories" way out covers the case where the tab is the only thing in the way.
  const here: SearchScope = { metroId: scope?.metroId, cat, keep: scope?.keep };
  const spill = new Map<ArtKind, number>();
  for (const x of scored) spill.set(x.e.art, (spill.get(x.e.art) || 0) + 1);
  const named = [...p.hardArts, ...p.softArts];
  const guess = named.length ? named : softArtsFor(p.all.length ? p.all : tokens(q), []);
  const kinds: ArtKind[] = [];
  for (const a of [...spill.keys(), ...guess]) if (!kinds.includes(a)) kinds.push(a);
  const nearArts: ActivityHit[] = kinds
    .map((a) => activityHit(a, countIn(idx, a, here)))
    .filter((a) => a.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  // The kind exists, this place does not have one. Clicking clears Where and keeps the tab, so count it that way.
  const elsewhere = nearArts.length
    ? []
    : guess.map((a) => activityHit(a, countIn(idx, a, { cat }))).filter((a) => a.count > 0).slice(0, limit);
  // Cities: how many results this very query has there, inside the tab, because that is the page the row opens.
  // Only worth asking when the place is what is narrowing the search; a city the guest is already in is no way out.
  const placed = !!scope?.keep || (!!scope?.metroId && scope.metroId !== "all");
  const cityHits = placed ? cityCounts() : new Map<string, number>();
  // The cities the guest named come first, biggest first. Then every other city that has it, nearest to the
  // guest's own city first, so a Tampa guest is sent to Orlando before Seattle even when Seattle has more.
  const from = scope?.metroId && scope.metroId !== "all" ? metroCoords(scope.metroId) : null;
  const away = (m: Metro) => {
    const at = metroCoords(m.id);
    return from && at ? milesBetween(from, at) : Infinity;
  };
  const cities: PlaceHit[] = [];
  for (const m of regions.length ? METROS.filter((mm) => mm.region === regions[0].code) : [...searchMetros(q, 3), ...nearMetros(q)]) {
    const count = cityHits.get(m.id) || 0;
    if (!count || m.id === scope?.metroId || cities.some((w) => w.metro.id === m.id)) continue;
    cities.push({ metro: m, count });
  }
  cities.sort((a, b) => b.count - a.count);
  const rest: PlaceHit[] = [];
  for (const m of METROS) {
    const count = cityHits.get(m.id) || 0;
    if (!count || m.id === scope?.metroId || cities.some((w) => w.metro.id === m.id)) continue;
    rest.push({ metro: m, count });
  }
  rest.sort(from ? (a, b) => away(a.metro) - away(b.metro) || b.count - a.count : (a, b) => b.count - a.count);
  const ways = [...cities, ...rest];
  return {
    results: [],
    otherCats,
    activities: nearArts,
    elsewhere,
    operators: [],
    places: ways.slice(0, regions.length ? 4 : 3),
    regions,
    family: guess.length ? familyHit(idx, guess[0], here) : null,
    nearMiss: true,
  };
}

/** The tab a kind sits under: its virtual tab (Classes, Culture) when it has one, else the tab most of its listings carry. */
function familyOf(idx: Index, art: ArtKind): CategoryId | null {
  for (const [cat, arts] of Object.entries(VIRTUAL_CATS) as [CategoryId, ArtKind[]][]) if (arts.includes(art)) return cat;
  const tally = new Map<CategoryId, number>();
  for (const i of idx.byArt.get(art) || []) {
    const c = idx.entries[i].u.cat;
    tally.set(c, (tally.get(c) || 0) + 1);
  }
  let best: CategoryId | null = null;
  let n = 0;
  for (const [c, k] of tally) if (k > n) (best = c), (n = k);
  return best;
}

/**
 * The kind's own tab as a way out, with the number of photographed listings browsing that tab shows in the
 * guest's place. Nothing is offered when that page would be empty too.
 */
function familyHit(idx: Index, art: ArtKind, scope: SearchScope): FamilyHit | null {
  const cat = familyOf(idx, art);
  if (!cat) return null;
  const place: SearchScope = { metroId: scope.metroId, keep: scope.keep };
  let count = 0;
  for (const e of idx.entries) if (e.u.cover && inScope(e.u, place) && inCat(e.u, cat)) count++;
  if (!count) return null;
  return { cat, name: CATS.find((c) => c.id === cat)?.name || cat, count };
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
  if (!best) return null;
  // "cooking classes in tampa", "escape room near miami": the preposition belongs to the place, so moving the
  // city to Where leaves "cooking classes" behind rather than "cooking classes in".
  for (const prep of PLACE_PREPOSITIONS) {
    if (lq.includes(" " + prep + " " + best.words.join(" ") + " ")) return { metro: best.metro, words: [...prep.split(" "), ...best.words] };
  }
  return best;
}

/** The words a guest puts in front of a city, longest first so "close to" wins over "to". */
const PLACE_PREPOSITIONS = ["close to", "near to", "around", "near", "in", "at", "to"];

/**
 * The query with the words that named a place taken out, so "kayak tampa" leaves "kayak" behind once Tampa has
 * moved to Where.
 *
 * `metroInQuery` returns those words normalised, accents and all folded away, so the comparison has to fold the
 * same way. Stripping the punctuation by hand instead turned "montréal" into "montral", which matched nothing:
 * a guest who typed their own city's name kept it in the What box as a keyword, so Montreal and Quebec City
 * answered with a flat grid headed "“Montréal” in Montreal" instead of the city's rows.
 */
export function stripPlaceWords(text: string, words: readonly string[]): string {
  const drop = new Set(words);
  return text.split(/\s+/).filter((w) => !drop.has(norm(w))).join(" ").trim();
}

/** Cities matching what the guest typed, including a half-typed or misspelled name ("vancou", "montral"). */
export function searchMetros(q: string, limit = 4): Metro[] {
  const toks = tokens(q).filter((t) => !FILLER.has(t));
  if (!toks.length) return [];
  const out: { m: Metro; s: number }[] = [];
  for (const m of METROS) {
    const hay = [...namesFor(m), norm(m.region)];
    // A nickname made of several words only counts as the whole phrase. Denver's is "front range", and letting
    // its words stand alone made "gun range", "driving range" and "archery range" all suggest Denver.
    const phrases = new Set((METRO_ALIASES[m.id] || []).map(norm).filter((a) => a.includes(" ")));
    const words = Array.from(new Set(hay.filter((h) => !phrases.has(h)).flatMap((h) => h.split(" "))));
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

type RegionStat = { count: number; lat: number; lon: number };
const regionStats = new WeakMap<Unclaimed[], Map<string, RegionStat>>();
function statsFor(pool: Unclaimed[]): Map<string, RegionStat> {
  let m = regionStats.get(pool);
  if (m) return m;
  m = new Map();
  for (const u of pool) {
    const code = regionOfArea(u.area);
    if (!code) continue;
    const r = m.get(code) || { count: 0, lat: 0, lon: 0 };
    // Running mean of the coordinates, so "nearest first" inside a state measures from its middle.
    if (typeof u.lat === "number" && typeof u.lon === "number") {
      const n = r.count + 1;
      r.lat += (u.lat - r.lat) / n;
      r.lon += (u.lon - r.lon) / n;
    }
    r.count++;
    m.set(code, r);
  }
  regionStats.set(pool, m);
  return m;
}

/**
 * States and provinces matching the whole query: a prefix ("flor"), or the name one or two typos off
 * ("floruda", "californa"). Only whole names count; two-letter codes clash with words like "in", "me" and "or".
 */
export function searchRegions(pool: Unclaimed[], q: string, limit = 2): RegionHit[] {
  const t = tokens(q).filter((w) => !FILLER.has(w)).join(" ");
  if (t.length < 3) return [];
  const stats = statsFor(pool);
  const out: { hit: RegionHit; d: number }[] = [];
  for (const [code, name] of Object.entries(REGION_NAME)) {
    const n = norm(name);
    let d = 9;
    if (n.startsWith(t)) d = 0;
    else {
      d = editDistance(n, t);
      if (t.length >= 4 && t.length < n.length) d = Math.min(d, editDistance(n.slice(0, t.length), t));
    }
    if (d > slack(t)) continue;
    const st = stats.get(code);
    if (!st?.count) continue;
    out.push({ hit: { code, name, country: CA_REGIONS.has(code) ? "Canada" : "United States", count: st.count, lat: st.lat, lon: st.lon }, d });
  }
  return out.sort((a, b) => a.d - b.d || b.hit.count - a.hit.count).slice(0, limit).map((x) => x.hit);
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

/* ---------- the What box ---------- */

/**
 * What a query names, for headings and the What box: the kinds of activity it spells out, whether those kinds are
 * all it says ("jet ski rentals" is the jet ski kind, "jet ski joe's" is a business), and the occasion behind it.
 * Reads the same parse the ranking uses, so a heading never disagrees with the grid under it.
 */
export function describeQuery(q: string): { arts: ArtKind[]; kinds: ArtKind[]; onlyKind: boolean; onlyIntent: boolean; intent: Intent } {
  const p = parseQuery(q);
  return {
    arts: p.hardArts,
    /** Every kind the results will be drawn from: the ones named, else the ones a typo or prefix reached, else the occasion's. */
    kinds: p.arts,
    onlyKind: p.hardArts.length > 0 && p.all.every((t) => p.aliasWords.has(t)),
    onlyIntent: !!p.intent.label && !p.all.length,
    intent: p.intent,
  };
}
