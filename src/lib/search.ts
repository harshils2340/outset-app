import { METROS, metroById, type Metro } from "../data/metros";
import type { ArtKind, Unclaimed } from "../data/types";

/** Words guests type that should still hit the listing. */
export const ART_ALIASES: Record<ArtKind, string[]> = {
  skydive: ["skydive", "skydiving", "tandem", "parachute", "jump"],
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
    if (words.some((w) => lq.includes(" " + w + " ") || (w.length >= 5 && lq.includes(w)))) out.push(art);
  }
  return out;
}

const FILLER = new Set(["rental", "rentals", "rent", "near", "me", "in", "the", "a", "and", "for", "best", "cheap", "tour", "tours"]);

export function listingScore(u: Unclaimed, q: string): number {
  const all = tokens(q);
  if (!all.length) return 0;
  const arts = queryArts(q);
  const hay = haystack(u);
  const compact = hay.replace(/[^a-z0-9]+/g, "");
  let score = 0;
  const title = u.title.toLowerCase();
  const tagText = [...(u.tags || []), ...u.options.map((o) => o.name)].join(" ").toLowerCase();
  // The activity the guest named is the strongest signal. A jet ski search must surface jet ski operators first.
  if (arts.length) {
    if (arts.includes(u.art)) score += 40;
    else if (arts.some((a) => (ART_ALIASES[a] || []).some((w) => tagText.includes(w)))) score += 24;
    else if (arts.some((a) => (ART_ALIASES[a] || []).some((w) => title.includes(w)))) score += 24;
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

export function searchMetros(q: string): Metro[] {
  const t = tokens(q);
  if (!t.length) return [];
  return METROS.filter((m) => {
    const hay = (m.name + " " + m.region + " " + m.id.replace(/-/g, " ")).toLowerCase();
    const compact = hay.replace(/[^a-z0-9]+/g, "");
    return t.every((tok) => tokenScore(hay, compact, tok) > 0);
  }).slice(0, 4);
}
