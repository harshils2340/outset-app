import { db } from "../db/client.ts";
import { METROS } from "../taxonomy/catalog.ts";
import { MAX_AGE_HOURS, detailFields, type DetailFields, type ViatorDetailSections } from "./viator.ts";

/**
 * Affiliate rows as catalog listings. Same shape every other listing has (so cards, search, rails, the listing
 * page and the static pages need nothing new to draw them), plus `affiliate`, which is what makes every
 * booking surface link out instead of booking here.
 *
 * What an affiliate listing never is: claimable (no claim key, no outreach, its id starts "a-" so no operator
 * code path matches it), Instant Book, a request, or something Otto answers for (`assistant: false`: the
 * partner's page has the answers, and their terms cover it, not ours).
 */

export type AffiliateRow = {
  id: string;
  source: "viator" | "tiqets" | "headout" | "klook" | "getyourguide";
  product_code: string;
  title: string;
  description: string | null;
  images: string;
  from_cents: number | null;
  currency: string | null;
  rating: number | null;
  review_count: number | null;
  duration: string | null;
  destination_name: string | null;
  metro_id: string | null;
  lat: number | null;
  lon: number | null;
  tags: string;
  booking_url: string;
  flags: string;
  raw?: string | null;
  fetched_at: string;
};

const LABEL: Record<AffiliateRow["source"], string> = { viator: "Viator", tiqets: "Tiqets", headout: "Headout", klook: "Klook", getyourguide: "GetYourGuide" };
const SRC: Record<AffiliateRow["source"], string> = { viator: "viator.com", tiqets: "tiqets.com", headout: "headout.com", klook: "klook.com", getyourguide: "getyourguide.com" };

/**
 * Which rail and which scene a partner product belongs on, read from its title. First match wins, so the
 * specific (a whale-watch cruise) is tested before the generic (a tour). Anything unmatched is a tour under
 * Culture, which is what most of a city's Viator page is.
 */
const KINDS: [RegExp, string, string][] = [
  [/\b(museum|gallery|exhibit)/i, "culture", "museum"],
  [/\b(zoo|safari park|wildlife park)/i, "outdoor", "zoo"],
  [/\baquarium/i, "indoor", "aquarium"],
  // Parks named without the words: Busch Gardens would otherwise file under gardens on the word alone.
  [/\b(theme park|amusement|universal studios|disney|six flags|legoland|busch gardens|seaworld|sea world|cedar point|knott'?s|hersheypark|dollywood|canada'?s wonderland|la ronde)/i, "play", "themepark"],
  [/\bwater ?park/i, "play", "waterpark"],
  [/\b(broadway|theat(re|er)|musical|cirque|comedy show|concert|live show|magic show)/i, "culture", "theatre"],
  [/\b(whale|dolphin|cruise|catamaran|sailing|sail\b|yacht|boat tour|boat trip|ferry|gondola)/i, "water", "cruise"],
  [/\b(kayak|canoe)/i, "water", "kayak"],
  [/\b(paddle ?board|\bsup\b)/i, "water", "paddleboard"],
  [/\b(snorkel|scuba|diving)/i, "water", "scuba"],
  [/\bsurf/i, "water", "surf"],
  [/\b(jet ?ski|waverunner)/i, "water", "jetski"],
  [/\bfishing/i, "water", "fishing"],
  [/\bparasail/i, "water", "parasail"],
  [/\b(raft|tubing)/i, "water", "rafting"],
  [/\b(helicopter|heli\b)/i, "air", "heli"],
  [/\bballoon/i, "air", "balloon"],
  [/\bskydiv/i, "air", "skydive"],
  [/\bparaglid/i, "air", "paragliding"],
  [/\bzip ?lin/i, "outdoor", "zipline"],
  [/\b(cooking class|cooking)/i, "food", "cooking"],
  [/\b(wine|winery|vineyard)/i, "food", "winery"],
  [/\b(brewery|beer|craft brew)/i, "food", "brewery"],
  [/\b(distiller|whisk(e)?y|bourbon|tequila)/i, "food", "distillery"],
  [/\b(food tour|tasting|culinary|pizza|taco|chocolate|dessert)/i, "food", "tour"],
  [/\b(spa|massage|hot spring|bathhouse)/i, "wellness", "spa"],
  [/\byoga/i, "wellness", "yoga"],
  [/\b(bike|cycling|e-bike|segway|scooter)/i, "outdoor", "bike"],
  [/\b(horse|horseback)/i, "outdoor", "horse"],
  [/\b(ski\b|skiing|snowboard)/i, "outdoor", "ski"],
  [/\bsnowmobil/i, "outdoor", "snowmobile"],
  [/\b(atv|utv|off-?road|dune buggy|side-by-side)/i, "motorsport", "motorsport"],
  [/\b(go-?kart|karting)/i, "motorsport", "kart"],
  [/\bescape room/i, "indoor", "escape"],
  [/\baxe throw/i, "indoor", "axe"],
  [/\bgolf/i, "outdoor", "golf"],
  [/\b(climb|via ferrata)/i, "outdoor", "climbing"],
  [/\b(garden|botanical|arboretum)/i, "outdoor", "garden"],
  [/\b(camp|glamp)/i, "outdoor", "camping"],
];

export function kindFor(title: string): { cat: string; art: string } {
  for (const [re, cat, art] of KINDS) if (re.test(title)) return { cat, art };
  return { cat: "culture", art: "tour" };
}

function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * A partner's exclusion in the words the listing page already reads. Both surfaces split `includes` on
 * "not included" and draw what they find struck through, the way Airbnb draws a missing amenity, so an
 * exclusion needs no field and no component of its own.
 */
export function notIncludedLine(text: string): string {
  return /\bnot included\b|\bexcluded\b|\bnot provided\b|\bdoes(?: not|n[’']t) include\b/i.test(text) ? text : text.replace(/[.\s]+$/, "") + " (not included)";
}

export function toAffiliateItem(r: AffiliateRow): Record<string, unknown> {
  const metro = METROS.find((m) => m.id === r.metro_id);
  const images = parseList(r.images);
  const flags = parseList(r.flags);
  const { cat, art } = kindFor(r.title);
  const fc = flags.includes("FREE_CANCELLATION") ? "Free cancellation" : undefined;
  // The detail pass (viator.ts detailViator) leaves the product's own sections under raw.detail, and a copy of
  // what it made of them under raw.detail.fields. The sections are read here rather than that copy, so a rule
  // put right in detailFields reaches a guest on the next sync instead of waiting for a fresh pass over the API.
  const detail = ((): Partial<DetailFields> => {
    try {
      const d = (JSON.parse(r.raw || "{}") as { detail?: ViatorDetailSections & { fields?: Partial<DetailFields> } }).detail;
      if (!d) return {};
      return d.inclusions || d.exclusions || d.additionalInfo || d.cancellationPolicy ? detailFields(d) : d.fields || {};
    } catch {
      return {};
    }
  })();
  const excludes = (detail.excludes || []).map(notIncludedLine);
  return {
    id: r.id,
    title: r.title,
    cat,
    art,
    area: [r.destination_name, metro?.region].filter(Boolean).join(", "),
    metroId: r.metro_id || undefined,
    src: SRC[r.source],
    rating: r.rating ?? undefined,
    reviews: r.review_count ?? undefined,
    lat: r.lat ?? undefined,
    lon: r.lon ?? undefined,
    specs: [],
    options: [],
    includes: [...(detail.includes || []), ...excludes],
    requirements: detail.requirements?.length ? detail.requirements : undefined,
    cancellation: detail.cancellation || undefined,
    gap: "",
    blurb: r.description || undefined,
    cover: images[0],
    photos: images,
    dur: r.duration || undefined,
    fc,
    from: r.from_cents != null ? r.from_cents / 100 : undefined,
    tags: [],
    assistant: false,
    affiliate: { source: r.source, label: LABEL[r.source], url: r.booking_url },
  };
}

/** Every affiliate row fresh enough to publish, best rated first. Stale rows stay in the table and off the site. */
export function affiliateCatalogItems(): Record<string, unknown>[] {
  const since = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT id, source, product_code, title, description, images, from_cents, currency, rating, review_count, duration,
              destination_name, metro_id, lat, lon, tags, booking_url, flags, raw, fetched_at
         FROM affiliate_products WHERE fetched_at >= ? AND metro_id IS NOT NULL
         ORDER BY review_count DESC NULLS LAST, rating DESC NULLS LAST`,
    )
    .all(since) as AffiliateRow[];
  return rows.map(toAffiliateItem);
}
