import { METROS, metroById, type Metro } from "../data/metros";
import type { ArtKind, Unclaimed } from "../data/types";

/** Words guests type that should still hit the listing. */
export const ART_ALIASES: Record<ArtKind, string[]> = {
  skydive: ["skydive", "skydiving", "parachute", "dropzone"],
  heli: ["helicopter", "heli", "chopper", "seaplane"],
  balloon: ["balloon", "hot air", "sunrise flight"],
  kart: ["kart", "karting", "go kart", "gokart", "racing"],
  escape: ["escape", "escape room", "puzzle"],
  axe: ["axe", "ax", "axe throwing"],
  paintball: ["paintball"],
  horse: ["horse", "horseback", "trail ride", "riding"],
  jetski: ["jet ski", "jetski", "waverunner", "wave runner", "pwc"],
  pontoon: ["pontoon", "boat rental"],
  fishing: ["fishing", "charter", "inshore"],
  parasail: ["parasail", "parasailing"],
  cruise: ["cruise", "sail", "sailing", "ferry", "harbor", "harbour", "whale"],
  kayak: ["kayak", "kayaking", "canoe", "paddle", "paddleboard", "sup", "rowing"],
  bowling: ["bowling", "bowl", "lanes"],
  minigolf: ["mini golf", "minigolf", "putt putt", "putt-putt", "miniature golf"],
  arcade: ["arcade", "arcades", "game room", "pinball"],
  trampoline: ["trampoline", "trampoline park", "jump park", "bounce"],
  lasertag: ["laser tag", "lasertag"],
  icerink: ["ice skating", "ice rink", "skating rink", "skating"],
  waterpark: ["water park", "waterpark", "water slides", "splash"],
  themepark: ["theme park", "amusement park", "roller coaster", "rides"],
  zoo: ["zoo", "safari", "wildlife park", "animal park"],
  aquarium: ["aquarium", "sea life"],
  karaoke: ["karaoke", "ktv", "private room"],
  climbing: ["climbing", "bouldering", "rock climbing", "climb"],
  range: ["shooting range", "gun range", "shooting", "range", "clay", "skeet", "trap"],
  archery: ["archery", "bow", "arrows"],
  golf: ["golf", "tee time", "tee times", "driving range", "golf course"],
  zipline: ["zipline", "zip line", "ziplining", "canopy tour", "ropes course", "aerial park"],
  ski: ["ski", "skiing", "snowboard", "snowboarding", "ski resort", "lift ticket", "ski lesson", "tubing"],
  bike: ["bike", "bicycle", "e-bike", "ebike", "cycling", "bike rental"],
  snowmobile: ["snowmobile", "snowmobiling", "sled"],
  rafting: ["rafting", "whitewater", "white water", "raft", "tubing"],
  scuba: ["scuba", "diving", "dive", "snorkel", "snorkeling"],
  surf: ["surf", "surfing", "surf lesson", "surfboard", "wakeboard", "kitesurf"],
  paragliding: ["paragliding", "paraglide", "hang gliding", "hang glide", "tandem flight"],
  gliding: ["glider", "gliding", "sailplane", "soaring"],
  brewery: ["brewery", "breweries", "beer", "taproom", "brew tour", "craft beer"],
  winery: ["winery", "wineries", "wine", "vineyard", "tasting", "wine tasting"],
  distillery: ["distillery", "distilleries", "whiskey", "bourbon", "spirits", "gin"],
  cooking: ["cooking", "cooking class", "culinary", "baking", "pasta making", "sushi class"],
  spa: ["spa", "massage", "sauna", "facial", "hot springs", "float"],
  yoga: ["yoga", "pilates", "meditation", "breathwork"],
  dance: ["dance", "dancing", "salsa", "ballroom", "dance class", "hip hop"],
  tour: ["tour", "tours", "food tour", "walking tour", "ghost tour", "bike tour", "segway", "city tour", "brewery tour"],
  rage: ["rage room", "rage", "smash room", "break room"],
  pottery: ["pottery", "ceramics", "paint and sip", "art class", "painting", "glassblowing", "candle making"],
};

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 9;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const cur = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function tokenScore(hay: string, compact: string, token: string): number {
  if (hay.includes(token)) return token.length >= 4 ? 8 : 6;
  if (compact.includes(token)) return 5;
  let best = 0;
  for (const w of hay.split(" ")) {
    if (!w) continue;
    if (w.startsWith(token)) best = Math.max(best, 6);
    else if (token.length >= 3 && w.length >= 3 && token.startsWith(w)) best = Math.max(best, 4);
    else if (token.length >= 4 && w.length >= 4 && editDistance(w, token) <= 1) best = Math.max(best, 5);
  }
  return best;
}

function haystack(u: Unclaimed): string {
  const metro = metroById(u.metroId);
  return [
    u.title,
    u.area,
    u.src,
    u.art,
    u.cat,
    metro?.name,
    metro?.region,
    ...(ART_ALIASES[u.art] || []),
    ...u.specs,
    ...u.options.map((o) => o.name),
    ...(u.tags || []),
    u.blurb || "",
  ]
    .join(" ")
    .toLowerCase();
}

/** Words in the query that name an activity. "jet ski rentals" -> jetski. */
export function queryArts(q: string): ArtKind[] {
  const lq = " " + q.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  const out: ArtKind[] = [];
  for (const [art, words] of Object.entries(ART_ALIASES) as [ArtKind, string[]][]) {
    // Whole words only, plural tolerated. "throwing" must not light up "rowing", "tandem kayak" must not mean skydive.
    if (words.some((w) => lq.includes(" " + w + " ") || lq.includes(" " + w + "s ") || lq.includes(" " + w + "es "))) out.push(art);
  }
  return out;
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
  { re: /\b(birthday|bday|party|celebrat)/i, label: "Birthday ideas", arts: ["rage", "kart", "escape", "axe", "trampoline", "lasertag", "bowling", "arcade", "minigolf", "karaoke", "paintball", "waterpark", "pontoon", "cruise", "jetski", "parasail"], group: true },
  { re: /\b(bachelor|bachelorette|stag|hen|guys? trip|girls? trip|boys? trip)\b/i, label: "Bachelor and bachelorette", arts: ["pontoon", "jetski", "kart", "axe", "brewery", "distillery", "winery", "range", "karaoke", "paintball", "cruise", "skydive", "parasail", "spa"], group: true },
  { re: /\b(team|corporate|coworkers?|office|company outing|work event|team building)\b/i, label: "Team outings", arts: ["escape", "rage", "tour", "axe", "kart", "bowling", "cooking", "brewery", "archery", "range", "climbing", "lasertag", "paintball", "pontoon", "cruise"], group: true },
  { re: /\b(kids?|children|child|family|families|toddler|teen(ager)?s?)\b/i, label: "Family friendly", arts: ["zoo", "aquarium", "trampoline", "minigolf", "bowling", "waterpark", "themepark", "icerink", "arcade", "lasertag", "horse", "kayak", "pontoon", "cruise", "escape", "kart", "parasail", "balloon"], kids: true },
  { re: /\b(date night|night out|date|romantic|couples?|anniversary|proposal|honeymoon|valentine)/i, label: "Date ideas", arts: ["winery", "tour", "cooking", "cruise", "balloon", "pottery", "dance", "minigolf", "icerink", "spa", "brewery", "distillery", "karaoke", "bowling", "heli", "kayak", "horse"] },
  { re: /\b(adrenaline|thrill|extreme|adventure|adventurous|crazy|wild|scary|dare)/i, label: "Adrenaline", arts: ["skydive", "zipline", "rafting", "paragliding", "jetski", "parasail", "kart", "range", "climbing", "paintball", "heli"] },
  { re: /\b(calm|relax|relaxing|chill|peaceful|quiet|scenic|nature|wildlife|dolphin|manatee|sunset|sunrise)/i, label: "Calm and scenic", arts: ["kayak", "balloon", "winery", "spa", "yoga", "gliding", "cruise", "horse"] },
  { re: /\b(rain|rainy|indoor|indoors|inside|bad weather|too hot|air ?con)/i, label: "Rainy day", arts: ["bowling", "arcade", "escape", "axe", "kart", "climbing", "trampoline", "lasertag", "karaoke", "aquarium", "spa", "cooking", "pottery", "icerink"] },
  { re: /\b(water|beach|lake|ocean|bay|river|on the water)\b/i, label: "On the water", arts: ["jetski", "kayak", "pontoon", "fishing", "cruise", "parasail"] },
  { re: /\b(sky|air|fly|flying|view from above|aerial)\b/i, label: "Up in the air", arts: ["skydive", "heli", "balloon", "parasail"] },
  { re: /\b(drinks?|beer|wine|tasting|brew|cocktail|whiskey|bourbon|foodie|eat|taste)\b/i, label: "Food and drink", arts: ["brewery", "winery", "distillery", "cooking"] },
  { re: /\b(class|classes|lesson|lessons|learn|workshop|course)\b/i, label: "Classes and lessons", arts: ["cooking", "pottery", "dance", "yoga", "surf", "archery", "climbing"] },
  { re: /\b(snow|winter|ski|skiing|cold|sled|slopes)\b/i, label: "Winter", arts: ["ski", "snowmobile", "icerink", "spa"] },
  { re: /\b(girls? day|spa day|self.?care|pamper|treat yourself|unwind|de-?stress|wellness)\b/i, label: "Unwind", arts: ["spa", "yoga", "winery", "pottery", "balloon"] },
  { re: /\b(things to do|what to do|activities|fun|stuff to do|weekend|tonight|today|ideas?)\b/i, label: "Things to do", arts: [] },
];

export function parseIntent(q: string): Intent {
  const lq = " " + q.toLowerCase().replace(/[^a-z0-9$]+/g, " ") + " ";
  const out: Intent = { label: null, arts: [], maxPrice: null, kids: false, group: false, words: [] };
  const price = lq.match(/(?:under|below|less than|max|up to|<)\s*\$?\s*(\d{2,4})\b/) || lq.match(/\$\s*(\d{2,4})\b/);
  if (price) {
    out.maxPrice = Number(price[1]);
    out.words.push(...price[0].trim().split(/\s+/));
  }
  for (const it of INTENTS) {
    const m = lq.match(it.re);
    if (!m) continue;
    if (!out.label) out.label = it.label;
    for (const a of it.arts) if (!out.arts.includes(a)) out.arts.push(a);
    if (it.kids) out.kids = true;
    if (it.group) out.group = true;
    out.words.push(...m[0].trim().split(/\s+/));
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

const FILLER = new Set(["rental", "rentals", "rent", "near", "me", "in", "the", "a", "an", "and", "for", "with", "best", "cheap", "tour", "tours", "ideas", "idea", "stuff", "things", "to", "do", "of", "on", "at", "good", "great", "top", "nearby", "around", "here", "my", "our", "we", "i", "some", "any", "night", "day"]);

const wordIn = (hay: string, w: string) => new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(s|es)?($|[^a-z0-9])", "i").test(hay);

export function listingScore(u: Unclaimed, q: string): number {
  const intent = parseIntent(q);
  const intentWords = new Set(intent.words.map((w) => w.replace(/[^a-z0-9]/g, "")));
  const all = tokens(q).filter((t) => !intentWords.has(t) && !FILLER.has(t));
  const explicitArts = queryArts(q);
  const arts = explicitArts.length ? explicitArts : intent.arts;
  if (intent.maxPrice != null) {
    const from = u.options.map((o) => o.price).filter((n): n is number => n != null);
    if (!from.length || Math.min(...from) > intent.maxPrice) return 0;
  }
  if (intent.kids && !kidFriendly(u)) return 0;
  if (!all.length) {
    // Pure intent, no other words: rank by fit and by how strong the listing is.
    let base = arts.length ? (arts.includes(u.art) ? 30 + (arts.length - arts.indexOf(u.art)) : 0) : 20;
    if (!base) return 0;
    if (u.cover) base += 4;
    if (u.rating && u.reviews) base += Math.min(8, Math.log10(u.reviews + 1) * 3) + (u.rating - 4) * 4;
    if (u.options.some((o) => o.price != null)) base += 3;
    if (intent.group && /group|party|private|up to \d+|people/i.test([...u.specs, ...(u.tags || [])].join(" "))) base += 4;
    return base;
  }
  const hay = haystack(u);
  const compact = hay.replace(/[^a-z0-9]+/g, "");
  let score = 0;
  const title = u.title.toLowerCase();
  const tagText = [...(u.tags || []), ...u.options.map((o) => o.name)].join(" ").toLowerCase();
  // The activity the guest named is the strongest signal. A jet ski search must surface jet ski operators first.
  if (arts.length) {
    if (arts.includes(u.art)) score += explicitArts.length ? 40 : 30;
    else if (arts.some((a) => (ART_ALIASES[a] || []).some((w) => w.length >= 4 && wordIn(tagText, w)))) score += 24;
    else if (arts.some((a) => (ART_ALIASES[a] || []).some((w) => w.length >= 4 && wordIn(title, w)))) score += 24;
    // The guest named the activity. A listing that is not that activity and never mentions it is not a result.
    else if (explicitArts.length) return 0;
  }
  // Every meaningful word must land somewhere. Filler like "rental" or "near me" is free.
  const must = all.filter((tok) => !FILLER.has(tok));
  for (const tok of must.length ? must : all) {
    const hit = tokenScore(hay, compact, tok);
    if (!hit && !arts.length) return 0;
    score += hit;
    if (title.includes(tok) || title.split(" ").some((w) => w.startsWith(tok))) score += 8;
  }
  if (arts.length && score < 24) return 0;
  if (u.rating && u.reviews) score += Math.min(6, Math.log10(u.reviews + 1) * 2);
  return score;
}

export function searchListings(pool: Unclaimed[], q: string): Unclaimed[] {
  if (!q.trim()) return pool.slice();
  return pool
    .map((u) => ({ u, s: listingScore(u, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.u.title.localeCompare(b.u.title))
    .map((x) => x.u);
}

/**
 * A place typed into the What box. "axe throwing denver" names Denver, so the search should run there,
 * not in whatever Where is set to. Longest metro name wins; the matched words come back so callers can strip them.
 */
export function metroInQuery(q: string): { metro: Metro; words: string[] } | null {
  const lq = " " + q.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  let best: { metro: Metro; words: string[] } | null = null;
  for (const m of METROS) {
    const full = m.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const first = full.split(" ")[0];
    const cands = [full, ...(first.length >= 5 && first !== full ? [first] : []), m.id.replace(/-/g, " ")];
    for (const c of cands) {
      if (!c || !lq.includes(" " + c + " ")) continue;
      const words = c.split(" ");
      if (!best || words.length > best.words.length) best = { metro: m, words };
    }
  }
  return best;
}

export function searchMetros(q: string): Metro[] {
  const t = tokens(q);
  if (!t.length) return [];
  return METROS.filter((m) => {
    const hay = (m.name + " " + m.region + " " + m.id.replace(/-/g, " ")).toLowerCase();
    const compact = hay.replace(/[^a-z0-9]+/g, "");
    return t.every((tok) => tokenScore(hay, compact, tok) > 0);
  }).slice(0, 4);
}
