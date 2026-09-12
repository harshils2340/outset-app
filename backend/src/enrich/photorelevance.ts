/**
 * Is this photo about what the operator sells, and does it read as a hero shot?
 *
 * `photoquality.ts` answers "is this a photograph at all" from the pixels. It cannot answer "a photograph of
 * what", so a raccoon close-up scored top of the pile and became the cover of a sunset cruise and fishing
 * charter in Clayton NY (o-1000islandexcursions-com, September 2026 listing audit). There is no vision model
 * here, so the subject is read from the words that travel with the photo: the file name, the alt text, the page
 * it was found on, and, for a booking-widget photo, the name of the item it illustrates.
 *
 * This is a cover-selection pass, not a filter. A raccoon is fair gallery content for a wildlife eco-tour, so a
 * demoted photo stays in the gallery and only loses the hero slot.
 */

/**
 * Photo words per art id, mirroring ART_ALIASES in `src/lib/search.ts` (the guest search vocabulary) with the
 * object words that show up in file names: the vessel, the venue, the gear. Keep the two in step when either grows.
 */
const ART_WORDS: Record<string, string[]> = {
  skydive: ["skydive", "skydiving", "skydiver", "parachute", "dropzone", "drop zone", "tandem", "freefall", "free fall", "jump", "jumper", "canopy", "wind tunnel", "exit", "altitude"],
  heli: ["helicopter", "heli", "chopper", "seaplane", "floatplane", "air tour", "flight", "cockpit", "rotor", "helipad"],
  balloon: ["balloon", "balloons", "hot air", "hotair", "basket", "envelope", "inflation", "sunrise flight", "lift off", "liftoff"],
  kart: ["kart", "karts", "karting", "go kart", "gokart", "racing", "race", "track", "helmet", "grid", "lap", "laps", "pit", "checkered"],
  escape: ["escape room", "escape", "puzzle", "clue", "clues", "mystery", "game room", "lock", "vault", "heist", "detective"],
  axe: ["axe", "axes", "hatchet", "throwing", "throw", "target", "bullseye", "lane", "lanes"],
  paintball: ["paintball", "airsoft", "gel blaster", "marker", "bunker", "field", "mask", "splat"],
  horse: ["horse", "horses", "horseback", "trail ride", "riding", "rider", "equestrian", "stable", "stables", "barn", "pony", "ranch", "saddle", "arena", "paddock"],
  jetski: ["jet ski", "jetski", "jetskis", "waverunner", "wave runner", "pwc", "sea doo", "seadoo", "personal watercraft", "ski", "riders", "wake", "spray"],
  pontoon: ["pontoon", "pontoons", "boat", "boats", "party boat", "deck boat", "tritoon", "dock", "helm", "cruising", "fleet"],
  fishing: ["fishing", "fisherman", "angler", "anglers", "charter", "charters", "inshore", "offshore", "deep sea", "fly fishing", "catch", "reel", "rod", "trolling", "tarpon", "snook", "redfish", "walleye", "bass", "musky", "salmon", "trout", "boat"],
  parasail: ["parasail", "parasailing", "para sail", "chute", "flight", "boat", "harness"],
  cruise: ["cruise", "cruises", "cruising", "sail", "sailing", "sailboat", "yacht", "catamaran", "ferry", "riverboat", "airboat", "harbor", "harbour", "sunset", "boat", "boats", "vessel", "deck", "dock", "marina", "skyline", "shoreline", "lighthouse", "bow", "helm"],
  kayak: ["kayak", "kayaks", "kayaking", "kayaker", "canoe", "canoes", "paddle", "paddling", "paddleboard", "paddle board", "sup", "rowing", "launch", "creek", "mangrove"],
  bowling: ["bowling", "bowl", "lane", "lanes", "pins", "strike", "ball", "alley", "scoreboard"],
  minigolf: ["mini golf", "minigolf", "putt putt", "miniature golf", "adventure golf", "putting", "putter", "hole", "course", "windmill"],
  arcade: ["arcade", "arcades", "game room", "games", "pinball", "barcade", "cabinet", "claw", "tokens", "virtual reality", "headset"],
  trampoline: ["trampoline", "trampolines", "jump park", "jumping", "bounce", "foam pit", "dodgeball", "airbag", "flip"],
  lasertag: ["laser tag", "lasertag", "laser", "vest", "arena", "blaster", "players"],
  icerink: ["ice skating", "ice rink", "skating", "skaters", "rink", "hockey", "skates", "zamboni", "figure skating"],
  waterpark: ["water park", "waterpark", "water slide", "slides", "splash", "lazy river", "wave pool", "tube", "pool"],
  themepark: ["theme park", "amusement park", "coaster", "rides", "midway", "ferris", "carousel", "boardwalk", "fairground"],
  zoo: ["zoo", "safari", "wildlife", "animal", "animals", "keeper", "habitat", "enclosure", "petting", "aviary", "giraffe", "lion", "tiger", "monkey", "elephant"],
  aquarium: ["aquarium", "sea life", "marine", "tank", "reef", "fish", "shark", "ray", "jellyfish", "penguin", "otter", "touch pool"],
  karaoke: ["karaoke", "ktv", "microphone", "mic", "singing", "stage", "private room", "booth"],
  climbing: ["climbing", "climber", "bouldering", "boulder", "rock climbing", "climb", "wall", "belay", "top rope", "holds", "route", "crag"],
  range: ["shooting range", "gun range", "shooting", "range", "clay", "clays", "skeet", "trap", "pistol", "rifle", "firearm", "targets", "bay", "lane"],
  archery: ["archery", "archer", "bow", "bows", "arrow", "arrows", "target", "targets", "quiver", "range"],
  golf: ["golf", "golfer", "tee", "tee time", "fairway", "green", "greens", "driving range", "golf course", "clubhouse", "bunker", "hole", "cart", "links"],
  zipline: ["zipline", "zip line", "ziplining", "canopy tour", "ropes course", "aerial park", "treetop", "platform", "harness", "adventure park"],
  ski: ["ski", "skiing", "skier", "snowboard", "snowboarding", "slope", "slopes", "lift", "chairlift", "gondola", "powder", "snow", "tubing", "terrain park", "mountain", "trail map"],
  bike: ["bike", "bikes", "bicycle", "ebike", "e bike", "cycling", "cyclist", "mountain bike", "mtb", "bike tour", "moped", "scooter", "trail", "riders"],
  snowmobile: ["snowmobile", "snowmobiling", "sled", "sleds", "snow", "trail", "riders", "powder"],
  rafting: ["rafting", "raft", "rafts", "whitewater", "white water", "rapids", "tubing", "float trip", "paddle", "guide", "river"],
  scuba: ["scuba", "diving", "diver", "divers", "dive", "snorkel", "snorkeling", "freediving", "open water", "padi", "reef", "wreck", "tanks", "underwater"],
  surf: ["surf", "surfing", "surfer", "surfboard", "board", "wave", "waves", "wakeboard", "kitesurf", "windsurf", "break", "lineup"],
  paragliding: ["paragliding", "paraglide", "paraglider", "hang gliding", "hang glider", "tandem", "wing", "launch", "flight", "thermal"],
  gliding: ["glider", "gliding", "sailplane", "soaring", "tow", "cockpit", "airfield", "flight"],
  brewery: ["brewery", "brewing", "beer", "beers", "taproom", "tap room", "brewhouse", "craft beer", "brewpub", "beer garden", "pint", "pints", "tasting", "flight", "tanks", "kegs", "patio", "bar"],
  winery: ["winery", "wine", "wines", "vineyard", "vines", "tasting", "tasting room", "cellar", "barrel", "barrels", "glass", "pour", "grapes", "harvest", "patio"],
  distillery: ["distillery", "whiskey", "whisky", "bourbon", "spirits", "gin", "rum", "tequila", "still", "stills", "barrel", "barrels", "tasting", "cocktail", "bar"],
  cooking: ["cooking", "cooking class", "culinary", "baking", "pasta", "sushi", "chef", "kitchen", "class", "students", "dough", "knife", "table"],
  spa: ["spa", "massage", "facial", "treatment", "therapy", "hot springs", "float", "sauna", "steam", "relax", "lounge", "robe", "table"],
  yoga: ["yoga", "pilates", "meditation", "breathwork", "hot yoga", "vinyasa", "mat", "mats", "studio", "class", "pose", "reformer"],
  dance: ["dance", "dancing", "dancers", "salsa", "ballroom", "dance class", "hip hop", "bachata", "swing", "tango", "zumba", "studio", "floor"],
  tour: ["tour", "tours", "tour guide", "guided", "walking tour", "ghost tour", "segway", "city tour", "sightseeing", "trolley", "bus tour", "group", "landmark", "downtown"],
  rage: ["rage room", "rage", "smash", "smash room", "break room", "demolition", "sledgehammer", "goggles"],
  theatre: ["theatre", "theater", "show", "shows", "comedy", "stage", "performance", "musical", "live music", "concert", "improv", "standup", "audience", "curtain", "seats"],
  museum: ["museum", "gallery", "exhibit", "exhibits", "collection", "science center", "planetarium", "artifact", "display", "visitors", "hall"],
  garden: ["garden", "gardens", "botanical", "botanic", "arboretum", "conservatory", "greenhouse", "blooms", "path", "grounds", "trees"],
  camping: ["camping", "campground", "glamping", "campsite", "cabin", "cabins", "rv", "yurt", "tent", "tents", "campfire", "site", "sites", "lodge"],
  tennis: ["tennis", "pickleball", "court", "courts", "squash", "badminton", "racquet", "racket", "padel", "net", "players"],
  swim: ["swim", "swimming", "pool", "pools", "swim lesson", "lessons", "aquatic", "lap", "lanes", "instructor", "splash"],
  martialarts: ["martial arts", "boxing", "kickboxing", "jiu jitsu", "bjj", "karate", "taekwondo", "muay thai", "mma", "judo", "krav maga", "fencing", "self defense", "wrestling", "grappling", "dojo", "mat", "gloves", "sparring", "belt"],
  gymnastics: ["gymnastics", "gymnast", "cheer", "tumbling", "parkour", "ninja", "open gym", "beam", "bars", "vault", "floor"],
  fitness: ["fitness", "crossfit", "barre", "spin", "cycling", "bootcamp", "hiit", "gym", "workout", "training", "weights", "class", "studio"],
  venue: ["venue", "event", "events", "party", "banquet", "event space", "party room", "hall", "reception", "tables", "setup", "birthday"],
  sailing: ["sailing", "sailboat", "sail", "sails", "yacht", "learn to sail", "regatta", "keelboat", "crew", "helm", "harbor", "marina", "boat"],
  discgolf: ["disc golf", "frisbee golf", "driving range", "topgolf", "golf simulator", "footgolf", "basket", "disc", "discs", "tee", "fairway", "bay"],
  billiards: ["billiards", "pool hall", "pool table", "darts", "shuffleboard", "ping pong", "table tennis", "snooker", "cue", "tables", "rack"],
  motorsport: ["motocross", "atv", "utv", "off road", "offroad", "dirt bike", "side by side", "dune buggy", "drag strip", "race track", "drift", "rally", "mud", "trail", "track", "riders", "helmet"],
  sauna: ["sauna", "bathhouse", "cold plunge", "banya", "hot springs", "thermal", "hammam", "steam room", "ice bath", "barrel", "benches", "lounge"],
  pottery: ["pottery", "ceramics", "paint and sip", "art class", "painting", "glassblowing", "candle", "sip and paint", "paint night", "wheel", "kiln", "clay", "studio", "canvas", "brush"],
};

/** The family a photo can still belong to when the exact art word is missing: the water, the sky, the track. */
const FAMILY_WORDS: Record<string, string[]> = {
  water: ["boat", "boats", "vessel", "dock", "docks", "marina", "water", "waterfront", "lake", "river", "ocean", "sea", "bay", "gulf", "harbor", "harbour", "beach", "island", "shore", "shoreline", "pier", "cove", "canal", "wave", "waves", "sail", "paddle", "launch", "deck", "onthewater"],
  // "aerial" is deliberately absent: it is a wide-shot word, scored once under SCENE, and an aerial survey photo
  // is not a helicopter tour.
  air: ["sky", "skies", "flight", "flying", "aircraft", "plane", "airfield", "airport", "landing", "takeoff", "altitude", "clouds", "above", "overhead"],
  motorsport: ["track", "race", "racing", "lap", "laps", "helmet", "engine", "garage", "pit", "circuit", "driver", "buggy", "trail", "mud", "dirt"],
  indoor: ["room", "rooms", "lobby", "lounge", "players", "game", "games", "session", "indoor", "venue"],
  outdoor: ["trail", "trails", "forest", "mountain", "mountains", "woods", "park", "field", "course", "ridge", "canyon", "desert", "snow", "camp", "outdoor", "outdoors", "nature"],
  play: ["family", "families", "kids", "party", "fun", "birthday", "games", "arcade", "lanes", "playing"],
  food: ["tasting", "glass", "glasses", "pour", "barrel", "cellar", "kitchen", "chef", "table", "tables", "bar", "patio", "vineyard", "brewhouse", "menu board", "cheers"],
  wellness: ["studio", "class", "classes", "mat", "massage", "treatment", "sauna", "pool", "wheel", "kiln", "instructor", "relax"],
};

/** Reads as a wide shot of the place, or as the shot the site itself leads with, which is what a hero slot wants. */
const SCENE = /\b(aerial|drone|panorama|panoramic|landscape|scenic|skyline|sunset|sunrise|overlook|vista|view|views|waterfront|wide|horizon|exterior|entrance|storefront|fleet|facility|grounds|hero|featured|feature image|homepage|home page|main image|splash)\b/;
/** Guests doing the thing, which is the next best hero after the scene itself. */
const PEOPLE_AT_IT = /\b(group|groups|guests|customers|family|families|friends|crew|riders|paddlers|anglers|players|party|kids|students|smiling|having fun)\b/;
/**
 * A single wild animal filling the frame. Legitimate gallery content for an eco-tour and a terrible hero for a
 * boat tour. Only counts against a photo whose words say nothing about what the operator sells.
 */
const WILD_SUBJECT = /\b(?:raccoon|racoon|woodpecker|chickadee|cardinal|blue ?jay|heron|egret|osprey|owl|hawk|falcon|eagle|loon|pelican|seagull|gull|sandpiper|songbird|bird|birding|birdwatching|waterfowl|deer|elk|moose|bison|bear|fox|coyote|bobcat|cougar|otter|beaver|muskrat|squirrel|chipmunk|rabbit|skunk|porcupine|turtle|tortoise|frog|toad|snake|lizard|gecko|iguana|butterfly|butterflies|dragonfly|bee|wasp|spider|insect|critter|wildlife|fauna|flora|mushroom|wildflower|eco ?tour|ecotour|nature ?walk)(?:e?s)?\b/;
/** A detail or a single face rather than a scene. */
const CLOSE_UP = /\b(close ?up|macro|portrait|selfie|headshot|detail shot|zoomed)\b/;
/**
 * One member of staff, posed. `BAD_NAME` in images.ts already drops "headshot" and "staff", so what reaches here
 * is the job title in a file name: "paul-eldridge-service-technician.jpg" won a jet ski shop's cover slot.
 */
const ONE_PERSON = /\b(technician|employee|employees|our team|meet the|bio|biography|owner|founder|co founder|manager|president|director|coach|coaches|receptionist|therapist)\b/;
/** A library photo of somebody else's boat. The file name usually keeps the library's name on it. */
const STOCK_SOURCE = /\b(stock ?photo|stock ?image|adobe ?stock|shutterstock|istock|istockphoto|getty ?images|unsplash|pexels|pixabay|depositphotos|dreamstime|123rf|freepik|canva|wallpaper)\b/;
/** Merchandise on a table: the gift shop, not the experience. "tee" stays out of this, it is a golf word. */
const MERCH_SHOT = /\b(shirt|shirts|tshirt|t shirt|hoodie|sweatshirt|hats|sticker|stickers|merch|apparel|mugs?|tumbler|koozie|folded|swag|gift ?card|keychain|decal)\b/;
/** Pages whose photos are the office, the owner and the paperwork, not the activity. */
const OFF_TOPIC_PAGE = /\/(about|about-us|our-story|history|team|staff|meet|contact|faq|policies|policy|privacy|terms|careers|jobs|employment|press|gift|gifts|shop|store|merch)(\/|$|\.|-)/i;
/** A business that sells animals as the attraction: the wild-animal demotion does not apply to it. */
const ANIMAL_BUSINESS = /\b(zoo|aquarium|safari|wildlife|dolphin|whale|manatee|gator|alligator|crocodile|birding|aviary|butterfly|petting|equestrian|stable|stables|ranch|falconry|sled dog|dog sled|alpaca|llama|horseback)\b/i;
const ANIMAL_ARTS = new Set(["zoo", "aquarium", "horse"]);

export type PhotoSubject = {
  url: string;
  /** The img alt attribute, when the harvest kept one. */
  alt?: string | null;
  /** The operator page the photo was found on. */
  page?: string | null;
  /** For a booking-widget photo, the name of the item it illustrates. */
  item?: string | null;
  /** The photo came from the operator's own booking widget, so it is a curated product shot. */
  curated?: boolean;
  /** How many other operator domains publish this exact image file. */
  reuse?: number;
};

export type CoverContext = {
  /** The business name, which is often the plainest statement of what it sells. */
  title: string;
  /** Art id from the guest taxonomy, for example "cruise" or "kart". */
  art: string;
  /** Family id, for example "water". */
  family: string;
};

const reCache = new Map<string, RegExp>();
/**
 * One regex for a word list. Short words are matched whole, because "ski" inside "whisky" and "tee" inside
 * "canteen" are not the activity. Words of five letters or more also match inside a run-together file name, since
 * "01funmuskyshot.jpg" and "sunsetcruise.jpg" carry no separators to break on.
 */
function wordsRe(key: string, list: string[]): RegExp {
  let re = reCache.get(key);
  if (!re) {
    const body = list
      .slice()
      .sort((a, b) => b.length - a.length)
      .map((w) => {
        const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, " ?");
        return w.length >= 5 && !w.includes(" ") ? esc : "\\b" + esc + "\\b";
      })
      .join("|");
    re = new RegExp("(?:" + body + ")", "g");
    reCache.set(key, re);
  }
  return re;
}

/** The last two path segments, the alt and the item name as one lower-case bag of words. */
export function photoWords(s: PhotoSubject): string {
  let path = s.url.split("?")[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the raw path */
  }
  const tail = path.split("/").slice(-2).join(" ").replace(/\.[a-z0-9]{2,5}$/i, "");
  const raw = tail + " " + (s.alt || "") + " " + (s.item || "");
  const text = raw
    // "DSC_sunsetCruise.jpg" is two words with no separator between them.
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    // WordPress size suffixes and cache-busting hashes are not words.
    .replace(/[-_]\d{2,4}x\d{2,4}\b/g, " ")
    .replace(/\b[0-9a-f]{8,}\b/g, " ")
    // "05Sunset.jpg", "1-Timmy-Tog.jpg": the counter in front of a name is not part of it.
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return " " + text + " ";
}

/** The path of the page a photo came from, with the host and the query gone. */
function pagePath(page: string): string {
  try {
    return new URL(page).pathname;
  } catch {
    return page.split("?")[0];
  }
}

function countHits(text: string, re: RegExp): number {
  re.lastIndex = 0;
  const seen = new Set<string>();
  let m = re.exec(text);
  while (m) {
    seen.add(m[0]);
    m = re.exec(text);
  }
  return seen.size;
}

function activityHits(text: string, ctx: CoverContext): number {
  const list = ART_WORDS[ctx.art];
  return list ? countHits(text, wordsRe("art:" + ctx.art, list)) : 0;
}

function familyHits(text: string, ctx: CoverContext): number {
  const list = FAMILY_WORDS[ctx.family];
  return list ? countHits(text, wordsRe("fam:" + ctx.family, list)) : 0;
}

/** Animals are the product here: a zoo, a stable, a dolphin cruise, or a gallery that is mostly wildlife. */
export function animalIsTheProduct(ctx: CoverContext, texts: string[]): boolean {
  if (ANIMAL_ARTS.has(ctx.art) || ANIMAL_BUSINESS.test(ctx.title)) return true;
  const wild = texts.filter((t) => WILD_SUBJECT.test(t)).length;
  return wild >= 3 && wild * 2 >= texts.length;
}

/**
 * How much this photo deserves the hero slot, as a bias to add to whatever score the harvest already gave it.
 * Positive means "this reads like the business"; negative means "a real photo, but not the one on the card".
 */
export function coverBias(s: PhotoSubject, ctx: CoverContext, animalProduct: boolean): number {
  const text = photoWords(s);
  const art = activityHits(text, ctx);
  const fam = art ? 0 : familyHits(text, ctx);
  let bias = 0;
  if (art >= 2) bias += 4;
  else if (art === 1) bias += 3;
  else if (fam >= 1) bias += 2;
  if (SCENE.test(text)) bias += 2;
  if (PEOPLE_AT_IT.test(text)) bias += 1;
  if (s.curated) bias += 1;
  // A wild animal and not one word about the activity: gallery material, not a cover. A photo whose words do name
  // the activity keeps its place, so "turtle-dive-trip" on a dive shop and "bear-lake-ski" on a hill are safe.
  if (!animalProduct && !art && WILD_SUBJECT.test(text)) bias -= fam ? 2 : 4;
  if (CLOSE_UP.test(text)) bias -= 3;
  if (ONE_PERSON.test(text)) bias -= 3;
  if (!art && MERCH_SHOT.test(text)) bias -= 4;
  if (STOCK_SOURCE.test(text)) bias -= 4;
  if (s.page && OFF_TOPIC_PAGE.test(pagePath(s.page))) bias -= 2;
  const reuse = s.reuse || 0;
  if (reuse >= 4) bias -= 6;
  else if (reuse >= 2) bias -= 3;
  return Math.max(-8, Math.min(7, bias));
}

/**
 * How far ahead a challenger has to be before it takes the hero slot off the photo that already holds it. Most
 * file names say nothing either way, and swapping two photos that both scored on noise is churn, not an
 * improvement. Two points is one clear signal: an activity word, a wide-scene word, or a demotion on the old one.
 */
const COVER_MARGIN = 2;

/**
 * Best cover first. Ties keep the order they came in, so a harvest score or the operator's own widget order still
 * decides between two photos the words cannot separate, and the photo that came in first keeps the hero slot
 * unless a challenger clears `COVER_MARGIN`. Nothing is dropped: the rest are the gallery.
 */
export function rankForCover<T extends PhotoSubject>(list: T[], ctx: CoverContext): T[] {
  if (list.length < 2) return list.slice();
  const texts = list.map(photoWords);
  const animalProduct = animalIsTheProduct(ctx, texts);
  const scored = list
    .map((p, i) => ({ p, i, bias: coverBias(p, ctx, animalProduct) }))
    .sort((a, b) => b.bias - a.bias || a.i - b.i);
  const incumbent = scored.find((x) => x.i === 0)!;
  if (scored[0].i !== 0 && scored[0].bias - incumbent.bias < COVER_MARGIN) {
    scored.splice(scored.indexOf(incumbent), 1);
    scored.unshift(incumbent);
  }
  return scored.map((x) => x.p);
}
