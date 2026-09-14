/**
 * Does a listing's own text support the kind of activity it is filed under?
 *
 * Discovery ran map searches like "jet ski rental" and filed every result under the query's kind unless a
 * stronger rule claimed it, and the name-based fallback defaulted to jet ski. So on 14 September 2026, 41% of
 * jet ski listings never mentioned a jet ski, a waverunner or a PWC anywhere: surf shops, dive shops, marinas,
 * tubing, a Polaris Slingshot car rental and a bike-and-ski shop sat in "Popular Jet Ski Rentals".
 *
 * Absence of a word is weak evidence: most listings have not been crawled yet and carry only a name, and "K1
 * Speed" is a kart track without saying "kart". So a listing is moved only when its text clearly says it is
 * something else. When nothing supports its kind and nothing else is clear, it keeps its kind but is marked
 * unconfirmed, and rails rank it after listings whose kind is confirmed.
 */

/** Words that confirm a kind. Brand names that are the kind count ("Escapology", "K1 Speed", "iFLY"). */
export const KIND_EVIDENCE: Record<string, RegExp> = {
  jetski: /jet ?skis?|wave ?runners?|sea-?doo|\bpwc\b|personal watercraft|jetski/i,
  pontoon: /pontoon|boat rentals?|rent(al)? a boat|rent ?boats?|boat rent|boat hire|deck boat|tritoon|bowrider|center console|party barge|boat club|freedom boat/i,
  parasail: /parasail/i,
  kayak: /kayak|canoe/i,
  paddleboard: /paddle ?board|\bsup\b|stand[- ]?up paddle/i,
  fishing: /fishing|fish charter|angler|inshore|offshore|tarpon|snook|redfish|grouper|deep sea|fly fish|guide service/i,
  cruise: /cruises?\b|cruisin|tiki ?(boat|cruise)s?|dolphin|sunset sail|catamaran|boat tours?|eco[- ]?tours?|harbou?r (tour|excursion)|boat excursion|whale watch|river ?boat|yacht (charter|tour|rental|cruise)s?|schooner|sightseeing boat|riverboat|paddlewheel|airboat/i,
  sailing: /sail(ing|boat)?\b|regatta/i,
  scuba: /scuba|\bdiv(e|ing)\b|snorkel|padi\b/i,
  surf: /\bsurf/i,
  rafting: /\braft(ing|s)?\b|\btubing\b|river float(s|ing)?\b|whitewater|white water/i,
  skydive: /skydiv|tandem jump|freefall|drop ?zone|parachut|\bifly\b/i,
  // The helicopter rail is also where scenic flights in small planes and seaplanes belong: it is the aerial sightseeing rail.
  heli: /helicopter|\bheli\b|air tours?|scenic flights?|flightseeing|seaplane|floatplane|biplane|air adventures?|aviation tours?/i,
  balloon: /balloon/i,
  paragliding: /paraglid|hang ?glid|powered paragl/i,
  gliding: /\bglid(er|ing)\b|soaring/i,
  // A "raceway" at a family fun centre is go-karts; a speedway on its own is motorsport.
  kart: /kart(s|ing)?\b|go-?carts?|gocart|\bk1 ?speed|indoor (karting|racing)|lil'? ?indy|golf (&|and) raceway|family raceway|fun (park|center|centre) raceway/i,
  motorsport: /slingshot|\batvs?\b|\butvs?\b|dune buggy|off-?road|race ?car|driving experience|supercar|exotic car|track day|jeep tour|polaris|speedway|raceway|drag (strip|race|racing)|race track|motor ?sports?/i,
  escape: /escape (room|game)s?|escapology|escape\b|puzzle room|breakout|room escape|mystery room|exit game/i,
  axe: /\baxe|axxe|hatchet|lumberj/i,
  paintball: /paintball|airsoft/i,
  horse: /horse|trail ride|equestrian|\bpony|stables?\b|ranch rides?|riding lessons?/i,
  bike: /bike (rental|tour|shop|park)s?|bicycle (rental|tour)s?|\be-?bikes?\b|cycling tours?|mountain bike (rental|tour|park)s?|bmx (track|park)/i,
  tour: /\btours?\b|walking tour|food tour|ghost tour|sightseeing|excursion/i,
};

/** Kinds a jet ski listing is most often really, checked before the generic ones. */
const SPECIFIC_FIRST = ["motorsport", "bike", "scuba", "surf", "rafting", "parasail", "kayak", "paddleboard", "sailing", "fishing", "cruise", "pontoon", "jetski", "kart", "escape", "axe", "paintball", "horse", "skydive", "heli", "balloon", "paragliding", "gliding", "tour"];

const POLICED = new Set(["jetski", "pontoon", "parasail", "kayak", "paddleboard", "fishing", "cruise", "skydive", "heli", "balloon", "kart", "escape", "axe", "paintball", "horse"]);

export type ArtVerdict = { art: string; confirmed: boolean; movedFrom?: string };

/**
 * Settle a listing's kind from its own name and text. `name` counts double: "Hood River WaterPlay Surf School"
 * is a surf school whatever the offerings page mentions in passing.
 */
export function reconcileArt(current: string, name: string, text: string): ArtVerdict {
  const own = KIND_EVIDENCE[current];
  // Only the kinds map-search discovery filed by query are policed. The rest (museums, golf, spas, and the
  // move targets below) keep whatever discovery gave them.
  if (!own || !POLICED.has(current)) return { art: current, confirmed: true };
  const all = name + " \n " + text;
  if (own.test(all)) return { art: current, confirmed: true };
  // Something else, clearly: named in the business name, or mentioned at least twice in its text.
  let best: { art: string; score: number } | null = null;
  for (const art of SPECIFIC_FIRST) {
    if (art === current) continue;
    const re = KIND_EVIDENCE[art];
    const inName = re.test(name) ? 2 : 0;
    const hits = (text.match(new RegExp(re.source, "gi")) || []).length;
    const score = inName + Math.min(hits, 3);
    if (score >= 2 && (!best || score > best.score)) best = { art, score };
  }
  if (best) return { art: best.art, confirmed: true, movedFrom: current };
  return { art: current, confirmed: false };
}
