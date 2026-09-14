/**
 * Florida destinations and experience terms for database-free discovery (scripts/discover-florida-ci.mts).
 * Coordinates are town centres, used to give a web-search result without an address a metro and a city pin
 * for deduplication. Nothing here opens SQLite.
 */

export type Destination = { name: string; lat: number; lon: number };

export const FL_DESTINATIONS: Destination[] = [
  { name: "Miami", lat: 25.7617, lon: -80.1918 },
  { name: "Miami Beach", lat: 25.7907, lon: -80.13 },
  { name: "Fort Lauderdale", lat: 26.1224, lon: -80.1373 },
  { name: "West Palm Beach", lat: 26.7153, lon: -80.0534 },
  { name: "Naples", lat: 26.142, lon: -81.7948 },
  { name: "Fort Myers", lat: 26.6406, lon: -81.8723 },
  { name: "Sarasota", lat: 27.3364, lon: -82.5307 },
  { name: "Siesta Key", lat: 27.2676, lon: -82.5454 },
  { name: "St. Petersburg", lat: 27.7676, lon: -82.6403 },
  { name: "Clearwater", lat: 27.9659, lon: -82.8001 },
  { name: "Tampa", lat: 27.9506, lon: -82.4572 },
  { name: "Orlando", lat: 28.5383, lon: -81.3792 },
  { name: "Kissimmee", lat: 28.2919, lon: -81.4076 },
  { name: "Daytona Beach", lat: 29.2108, lon: -81.0228 },
  { name: "St. Augustine", lat: 29.9012, lon: -81.3124 },
  { name: "Jacksonville", lat: 30.3322, lon: -81.6557 },
  { name: "Gainesville", lat: 29.6516, lon: -82.3248 },
  { name: "Tallahassee", lat: 30.4383, lon: -84.2807 },
  { name: "Panama City Beach", lat: 30.1766, lon: -85.8055 },
  { name: "Destin", lat: 30.3935, lon: -86.4958 },
  { name: "Pensacola", lat: 30.4213, lon: -87.2169 },
  { name: "Key West", lat: 24.5551, lon: -81.78 },
  { name: "Key Largo", lat: 25.0865, lon: -80.4473 },
  { name: "Islamorada", lat: 24.9243, lon: -80.6278 },
  { name: "Marathon", lat: 24.7137, lon: -81.0904 },
  { name: "Cocoa Beach", lat: 28.3200, lon: -80.6076 },
  { name: "Melbourne", lat: 28.0836, lon: -80.6081 },
  { name: "Vero Beach", lat: 27.6386, lon: -80.3973 },
  { name: "Boca Raton", lat: 26.3683, lon: -80.1289 },
  { name: "Delray Beach", lat: 26.4615, lon: -80.0728 },
  // Added 14 September 2026 for the second free credit: coastal and nature towns that sell experiences, each more
  // than 20 km from a destination above so their searches do not overlap.
  { name: "Anna Maria Island", lat: 27.5314, lon: -82.7343 },
  { name: "Venice", lat: 27.0998, lon: -82.4543 },
  { name: "Punta Gorda", lat: 26.9298, lon: -82.0454 },
  { name: "Sanibel", lat: 26.4483, lon: -82.0223 },
  { name: "Marco Island", lat: 25.9412, lon: -81.7184 },
  { name: "Everglades City", lat: 25.8573, lon: -81.3867 },
  { name: "Homestead", lat: 25.4687, lon: -80.4776 },
  { name: "Big Pine Key", lat: 24.6699, lon: -81.3540 },
  { name: "Jupiter", lat: 26.9342, lon: -80.0942 },
  { name: "Stuart", lat: 27.1975, lon: -80.2528 },
  { name: "New Smyrna Beach", lat: 29.0258, lon: -80.9270 },
  { name: "Amelia Island", lat: 30.6696, lon: -81.4626 },
  { name: "Crystal River", lat: 28.9025, lon: -82.5926 },
  { name: "Tarpon Springs", lat: 28.1461, lon: -82.7568 },
  { name: "Santa Rosa Beach", lat: 30.3960, lon: -86.2288 },
  { name: "Apalachicola", lat: 29.7255, lon: -84.9830 },
  { name: "Ocala", lat: 29.1872, lon: -82.1401 },
  { name: "Clermont", lat: 28.5494, lon: -81.7729 },
];

/** Search term, the Outset category it lands in, a finer activity label, and words a relevant result must mention. */
export type ExperienceTerm = { term: string; kind: string; activity: string; must: RegExp };

export const FL_TERMS: ExperienceTerm[] = [
  { term: "cocktail class", kind: "cooking", activity: "cocktail-class", must: /cocktail|mixolog|bartend/i },
  { term: "mixology class", kind: "cooking", activity: "cocktail-class", must: /cocktail|mixolog|bartend/i },
  { term: "cooking class", kind: "cooking", activity: "cooking-class", must: /cook|culinar|chef|kitchen/i },
  { term: "paint and sip", kind: "pottery", activity: "paint-and-sip", must: /paint|canvas|sip/i },
  { term: "pottery class", kind: "pottery", activity: "pottery", must: /pottery|ceramic|clay|wheel/i },
  { term: "candle making class", kind: "pottery", activity: "candle-making", must: /candle/i },
  { term: "escape room", kind: "escape", activity: "escape-room", must: /escape/i },
  { term: "axe throwing", kind: "axe", activity: "axe-throwing", must: /\baxe|hatchet/i },
  { term: "food tour", kind: "tour", activity: "food-tour", must: /food|culinar|tasting|eat/i },
  { term: "ghost tour", kind: "tour", activity: "ghost-tour", must: /ghost|haunt|paranormal/i },
  { term: "walking tour", kind: "tour", activity: "walking-tour", must: /walking|tour/i },
  { term: "bike tour", kind: "tour", activity: "bike-tour", must: /bike|bicycl|cycling/i },
  { term: "airboat tour", kind: "cruise", activity: "airboat-tour", must: /airboat/i },
  { term: "dolphin tour", kind: "cruise", activity: "dolphin-tour", must: /dolphin/i },
  { term: "snorkel tour", kind: "scuba", activity: "snorkel-tour", must: /snorkel/i },
  { term: "sunset cruise", kind: "cruise", activity: "sunset-cruise", must: /sunset|cruise|sail|charter/i },
  { term: "kayak tour", kind: "kayak", activity: "kayak-tour", must: /kayak|canoe|paddle/i },
  { term: "paddleboard rental", kind: "paddleboard", activity: "paddleboard", must: /paddle|\bsup\b/i },
  { term: "jet ski rental", kind: "jetski", activity: "jet-ski", must: /jet ?ski|waverunner|watersport/i },
  { term: "boat rental", kind: "pontoon", activity: "boat-rental", must: /boat|pontoon/i },
  { term: "fishing charter", kind: "fishing", activity: "fishing-charter", must: /fish|charter|angl/i },
  { term: "parasailing", kind: "parasail", activity: "parasailing", must: /parasail/i },
  { term: "glass blowing class", kind: "pottery", activity: "glass-blowing", must: /glass/i },
  { term: "wine tasting", kind: "winery", activity: "wine-tasting", must: /wine|winery|vineyard/i },
  { term: "brewery tour", kind: "brewery", activity: "brewery-tour", must: /brew|beer/i },
  { term: "spa day", kind: "spa", activity: "spa", must: /spa|massage/i },
  { term: "couples massage", kind: "spa", activity: "massage", must: /massage|spa/i },
  { term: "date night class", kind: "cooking", activity: "date-night", must: /class|workshop|date night/i },
  { term: "rage room", kind: "rage", activity: "rage-room", must: /rage|smash|break/i },
  { term: "VR experience", kind: "arcade", activity: "vr", must: /\bvr\b|virtual reality/i },
  { term: "go karts", kind: "kart", activity: "go-karts", must: /kart/i },
  { term: "climbing gym", kind: "climbing", activity: "climbing-gym", must: /climb|boulder/i },
  { term: "trampoline park", kind: "trampoline", activity: "trampoline-park", must: /trampoline|jump/i },
  { term: "horseback riding", kind: "horse", activity: "horseback", must: /horse|equestrian|trail ride|stable|ranch/i },
  { term: "helicopter tour", kind: "heli", activity: "helicopter-tour", must: /helicopter/i },
  { term: "hot air balloon", kind: "balloon", activity: "hot-air-balloon", must: /balloon/i },
  { term: "skydiving", kind: "skydive", activity: "skydiving", must: /skydiv|tandem/i },
  { term: "zipline", kind: "zipline", activity: "zipline", must: /zip ?line|zip/i },
  // Florida-specific experiences the first grid missed.
  { term: "manatee tour", kind: "cruise", activity: "manatee-tour", must: /manatee/i },
  { term: "sandbar boat tour", kind: "cruise", activity: "sandbar-tour", must: /sandbar|sand bar|island hop/i },
  { term: "eco tour", kind: "tour", activity: "eco-tour", must: /eco|nature|wildlife|mangrove|everglades/i },
  { term: "surf lessons", kind: "surf", activity: "surf-lessons", must: /surf/i },
  { term: "scuba diving", kind: "scuba", activity: "scuba", must: /scuba|dive|diving/i },
  { term: "party boat", kind: "pontoon", activity: "party-boat", must: /party|tiki|booze|pontoon|cruise/i },
];

const toRad = (d: number) => (d * Math.PI) / 180;

export function kmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

/** Nearest listed destination within `maxKm`, for a map point without an addr:city. */
export function nearestDestination(lat: number, lon: number, maxKm = 40): Destination | null {
  let best: Destination | null = null;
  let bestKm = Infinity;
  for (const d of FL_DESTINATIONS) {
    const km = kmBetween(lat, lon, d.lat, d.lon);
    if (km < bestKm) {
      bestKm = km;
      best = d;
    }
  }
  return best && bestKm <= maxKm ? best : null;
}
