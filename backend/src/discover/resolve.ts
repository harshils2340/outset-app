import type { Place } from "./searchapi.ts";

/**
 * Matching a directory lead (a name and a town) to the one Google Maps result that is the same business.
 *
 * Pure, so the rule is testable without a key. The bar is deliberately high: a wrong match attaches a stranger's
 * website to a business, and every fact on the listing then comes from the wrong site. No match is the right
 * answer whenever the name or the place is in doubt.
 */

const STOP = new Set(["the", "and", "of", "llc", "inc", "co", "company", "charters", "charter", "fishing", "guide", "guides", "service", "services", "school", "studio", "studios", "class", "classes", "academy", "center", "centre", "group"]);

export function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Share of the lead's distinctive words that appear in the result's name, 0 to 1. */
export function nameOverlap(lead: string, found: string): number {
  const a = nameTokens(lead);
  if (!a.length) return 0;
  const b = new Set(nameTokens(found));
  return a.filter((w) => b.has(w)).length / a.length;
}

const SOCIAL_OR_DIRECTORY = /facebook\.com|instagram\.com|twitter\.com|x\.com|yelp\.com|tripadvisor\.|linktr\.ee|google\.com|bit\.ly|booking\.com|viator\.com|getyourguide|airbnb\.|fishingbooker|captainexperiences|coursehorse|cozymeal|classpass|mindbody|squareup\.com|fareharbor\.com|peek\.com|resova|bookeo/i;

export function usableWebsite(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    if (SOCIAL_OR_DIRECTORY.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export type Lead = { name: string; city: string | null; region: string | null };

/**
 * The one result that is this business, or null. A result qualifies when at least 0.6 of the lead's distinctive
 * name words appear in its title, its address names the lead's town or region, and it carries a usable website.
 * Two results that both qualify is ambiguity, and ambiguity is null.
 */
export function pickMatch(lead: Lead, places: Place[]): { place: Place; website: string; score: number } | null {
  const city = (lead.city || "").toLowerCase();
  const region = (lead.region || "").toUpperCase();
  const hits: { place: Place; website: string; score: number }[] = [];
  for (const p of places) {
    const website = usableWebsite(p.website);
    if (!website || !p.title) continue;
    const score = nameOverlap(lead.name, p.title);
    if (score < 0.6) continue;
    const addr = (p.address || "").toLowerCase();
    const inTown = !!city && addr.includes(city);
    const inRegion = !!region && new RegExp("\\b" + region + "\\b", "i").test(p.address || "");
    if (!inTown && !inRegion) continue;
    hits.push({ place: p, website, score: score + (inTown ? 0.2 : 0) });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score);
  if (hits.length > 1 && hits[1].score >= hits[0].score - 0.05) return null;
  return hits[0];
}
