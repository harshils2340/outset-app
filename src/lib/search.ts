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
  ]
    .join(" ")
    .toLowerCase();
}

export function listingScore(u: Unclaimed, q: string): number {
  const t = tokens(q);
  if (!t.length) return 0;
  const hay = haystack(u);
  const compact = hay.replace(/[^a-z0-9]+/g, "");
  let score = 0;
  const title = u.title.toLowerCase();
  for (const tok of t) {
    const hit = tokenScore(hay, compact, tok);
    if (!hit) return 0;
    score += hit;
    if (title.includes(tok) || title.split(" ").some((w) => w.startsWith(tok))) score += 8;
  }
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
