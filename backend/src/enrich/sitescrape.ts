import { lookup } from "node:dns/promises";
import { load } from "cheerio";
import { largestFromSrcset } from "./srcset.ts";
import { fetchHtml, sleep } from "../scrape/fetch.ts";
import { harvestHours } from "./hoursMarkup.ts";
import { normalizeReview, parseRating, selectReviews, sourceFromLabel, type AggregateRating, type RawReview, type Review, type ReviewSource } from "../sync/reviews.ts";

/**
 * Site reading without a database.
 *
 * This is the half of `structure.ts` that turns a website into structured content: it fetches the operator's
 * own pages and reads what they are organized around: navigation links, page titles, headings, price tables,
 * and returns services, prices, descriptions, add-ons, hours, waiver and booking links. Rule-based, no
 * language model, nothing guessed: every row carries the page it came from.
 *
 * It is split out for the same reason the photo crawl was: the parsing needs nothing but HTML, while only the
 * writing needs the 450 MB SQLite file, so keeping them together meant the structure crawl could run on one
 * laptop and therefore ran nowhere. `scripts/structure-queue.mts` writes the work list from the database,
 * `scripts/crawl-structure-ci.mts` runs this on a GitHub Actions runner, and `src/sync/structureSidecar.ts`
 * reads the results back at sync time. `structure.ts` keeps the writing half and calls `scrapeSite` for the
 * rest, so behaviour on a machine with the database is unchanged.
 *
 * Nothing in this file may import `db/client.ts`, `scrape/cpu.ts` or anything under `src/db`.
 * Politeness comes from `fetchHtml`, which honours robots.txt and identifies itself.
 */
/**
 * Service vocabulary, in three tiers.
 *
 * The catalog is no longer boats and skydives: it is 43,722 operators across golf, museums, camping, spas,
 * breweries, rinks, dojos, potteries and forty other kinds. A word list that only knew "jet ski" found zero
 * services on a swim school, so the list below names what each of those kinds actually sells.
 *
 * CORE  : an activity or product no other kind of page uses ("tee time", "escape room", "deep tissue"). Safe alone.
 * UNIT  : the thing a guest buys rather than the activity ("green fee", "day pass", "drop-in", "stick and puck").
 *         Also safe alone: navigation bars and legal pages do not use these phrases.
 * RISKY : real service words that are also ordinary English: "class" in "world class", "session" in "session
 *         cookies", "lane" in a street address, "flight" in "flight of stairs", "court" in "courthouse",
 *         "table" in "table of contents", "night" in "opening night", "entry" in "entry-level", "ticket" in
 *         "support ticket", "course" in "of course", "package" in "package delivery". A risky word only counts
 *         when a companion signal, a price, a duration, a per-unit rate, a booking verb, or a core service
 *         word, sits in the same text or in the context handed in by the caller (the price table around a
 *         heading, the href of a link, the paragraph under a heading). NEGATIVE deletes the known idioms first
 *         so no companion can rescue them.
 */
const CORE = new RegExp(
  [
    // Water: rentals, charters, cruises, dive and swim.
    "jet ?ski", "waverunner", "\\bpwc\\b", "kayak", "canoe", "paddle ?board", "\\bsup\\b", "pontoon",
    "boat (rental|tour|ride|trip)", "charter", "fishing", "\\bcruise", "\\bsail(ing|boat|s)?\\b", "sunset (cruise|sail|tour)",
    "dolphin", "manatee", "whale", "snorkel", "parasail", "banana boat", "flyboard", "wakeboard", "water ?ski",
    "yacht", "catamaran", "glass ?bottom", "airboat", "scuba", "\\bdiv(e|ing)\\b", "\\bsurf", "\\braft(ing)?\\b",
    "white ?water", "pedal ?boat", "paddle ?boat", "swim lesson", "learn ?to ?swim", "lap swim", "open swim",
    "water aerobics", "aqua ?(fit|robics)", "pool rental", "swim team", "lifeguard", "water ?slide", "lazy river",
    "wave pool", "splash pad", "cabana", "beach (chair|furniture|umbrella)",
    // Air.
    "skydiv", "tandem", "helicopter", "heli ?tour", "balloon", "hot ?air", "glider", "gliding", "paraglid",
    "hang ?glid", "discovery flight", "scenic flight", "flight (lesson|school|training)", "bungee", "zip ?line",
    "aerial (adventure|park|silks)",
    // Land and adrenaline.
    "\\bkart(ing)?\\b", "go[- ]?kart", "escape room", "\\baxe\\b", "hatchet", "paintball", "airsoft", "laser ?tag",
    "rage room", "smash room", "\\batv\\b", "\\butv\\b", "\\bjeep\\b", "segway", "\\bbikes?\\b", "e-?bike",
    "horse ?back", "trail ride", "pony ride", "riding lesson", "hayride", "carriage ride", "sleigh ride",
    "dog ?sled", "snowmobile", "snowshoe",
    // Golf, mini golf, disc golf.
    "tee ?time", "greens? ?fee", "(nine|18|9|eighteen) holes", "driving range", "bucket of balls", "range ball",
    "golf (lesson|clinic|cart|club|simulator|school|package)", "foot ?golf", "mini(ature)? ?golf", "putt ?putt",
    "disc golf", "frisbee golf",
    // Courts and fields.
    "pickle ?ball", "tennis (lesson|court|clinic|camp)", "squash court", "racquet ?ball", "badminton",
    "volleyball court", "basketball court", "batting cage", "field rental", "turf rental",
    // Ice and snow.
    "public skat", "open skat", "stick (and|&|n) ?puck", "freestyle ice", "learn ?to ?skate", "skate rental",
    "ice time", "rink rental", "curling", "broomball", "hockey (league|clinic|camp|school)", "figure skating",
    "lift ticket", "ski (lesson|rental|pass|school|and ride)", "snowboard", "cross ?country ski", "nordic",
    "gondola", "chair ?lift", "terrain park", "snow ?tub", "tubing hill", "\\btub(e|ing)\\b",
    // Play: bowling, arcade, trampoline, billiards, karaoke.
    "bowl(ing)?", "shoe rental", "cosmic bowl", "arcade", "game card", "play pass", "unlimited play", "\\btokens?\\b",
    "laser maze", "\\bvr\\b", "virtual reality", "trampoline", "open jump", "jump (time|pass)", "ninja (course|warrior)",
    "dodgeball", "foam pit", "soft play", "bounce house", "billiards", "pool table", "snooker", "\\bdarts\\b",
    "shuffleboard", "karaoke",
    // Ranges and targets.
    "shooting (range|lane|lesson|bay)", "gun rental", "firearm", "range time", "archery", "target practice",
    "clay shooting", "trap shooting", "skeet", "concealed carry",
    // Climbing, fitness, martial arts, dance.
    "climb(ing)?", "boulder(ing)?", "belay", "top ?rope", "harness rental", "personal train", "boot ?camp",
    "cross ?fit", "\\bhiit\\b", "spin class", "indoor cycling", "pilates", "\\bbarre\\b", "zumba", "group fitness",
    "open gym", "gymnastics", "tumbling", "cheer(leading)?", "parkour", "obstacle course", "yoga", "vinyasa",
    "hatha", "ashtanga", "meditation", "sound bath", "\\breiki\\b", "teacher training", "martial arts", "karate",
    "jiu ?jitsu", "\\bbjj\\b", "tae ?kwon ?do", "muay thai", "kick ?box", "\\bjudo\\b", "boxing", "\\bmma\\b",
    "self ?defense", "belt test", "sparring", "fencing", "dance (class|lesson)", "ballet", "hip ?hop", "salsa",
    "bachata", "tango", "ballroom", "swing dance", "wedding dance", "pole (dance|fitness)", "burlesque",
    // Spa and wellness.
    "massage", "deep tissue", "swedish", "hot stone", "prenatal", "facial", "microderm", "dermaplan",
    "chemical peel", "manicure", "pedicure", "\\bmani\\b", "\\bpedi\\b", "nail (service|art)", "gel nails",
    "waxing", "threading", "lash (extension|lift)", "brow (lamination|shaping|tint)", "body (wrap|scrub|treatment)",
    "reflexolog", "acupunctur", "chiropract", "cupping", "sauna", "steam room", "cold plunge", "ice bath",
    "contrast therapy", "float (tank|session|therapy)", "cryotherap", "halotherap", "salt room", "infrared",
    "hydrotherap", "mud bath", "hammam", "\\bbanya\\b", "spa (package|day|treatment)", "bridal package",
    // Drink: brewery, winery, distillery.
    "tasting", "tap ?room", "cellar door", "(brewery|winery|distillery|vineyard|barrel|cave) tour", "barrel tasting",
    "blending (class|session|experience)", "food pairing", "wine pairing", "cocktail class", "mixology",
    // Make: cooking, pottery, craft.
    "cooking class", "culinary", "baking class", "cake decorating", "knife skills", "chef'?s table", "private chef",
    "sushi class", "pasta (class|making)", "pottery", "wheel throwing", "hand ?building", "clay class", "glaze",
    "\\bkiln\\b", "studio time", "paint ?(and|n|&) ?sip", "paint your own", "canvas class", "candle (making|pouring)",
    "glass ?blow", "jewelry (class|making)", "woodworking", "sewing class", "quilting", "flower (crown|arranging)",
    "terrarium", "soap making", "leather ?work", "blacksmith", "welding class", "screen ?print", "improv class",
    "acting class", "drama class",
    // Culture: museum, zoo, aquarium, garden, theatre.
    "general admission", "guided tour", "docent", "audio (guide|tour)", "self[- ]guided tour", "planetarium",
    "\\bimax\\b", "exhibit", "gallery tour", "field trip", "school (group|program|tour)", "museum pass", "aquarium",
    "\\bzoo\\b", "safari", "petting zoo", "animal encounter", "behind[- ]the[- ]scenes tour", "botanical", "garden tour",
    "conservatory", "greenhouse", "farm tour", "corn maze", "pumpkin patch", "apple picking", "\\bu[- ]?pick\\b",
    "haunted house", "matinee", "showtime", "season (ticket|subscription)", "student rush", "comedy show",
    // Tours.
    "walking tour", "food tour", "ghost tour", "bus tour", "trolley tour", "city tour", "pub crawl", "bike tour",
    "segway tour", "sightseeing", "wine tour", "eco ?tour", "mangrove", "wildlife", "nature walk", "guided hike",
    // Camping.
    "camp ?site", "camp ?ground", "tent site", "tent pad", "\\brv (site|park|spot|hook)", "full hook ?up",
    "hook ?up", "\\bcabins?\\b", "\\byurts?\\b", "glamping", "primitive site", "group site", "day ?use",
    "pull[- ]?through", "back[- ]?in site", "bunk ?house", "tree ?house", "safari tent",
    // Venue and party rentals.
    "venue rental", "facility rental", "room rental", "party room", "private event", "birthday party",
    "party package", "corporate (event|outing)", "team building", "pavilion rental", "picnic shelter", "hall rental",
  ].join("|"),
  "i",
);

/** What a guest buys, rather than what they do. Distinctive enough to stand alone. */
const UNIT = new RegExp(
  [
    "day pass", "week pass", "month(ly)? pass", "annual pass", "season pass", "punch card", "class pack",
    "multi[- ]?pass", "drop[- ]?in", "open (gym|play|skate|jump|bowl|climb)", "private (lesson|session|party)",
    "group (lesson|rate|rates)", "semi[- ]private", "intro(ductory)? (class|lesson|session|offer|package)",
    "beginner (class|lesson|course)", "trial class", "\\blessons?\\b", "\\bclinics?\\b", "\\bworkshops?\\b",
    "summer camp", "day camp", "after ?school", "equipment rental", "gear rental", "\\brentals?\\b",
    "per (night|game|hour|person|day|lane|court|table)", "half ?day", "full ?day", "half ?hour", "\\bguided\\b",
  ].join("|"),
  "i",
);

/** Real service words that are also ordinary English. Need a companion signal, see the tier comment above. */
const RISKY = /\bclass(es)?\b|\bsessions?\b|\blanes?\b|\bcourts?\b|\btables?\b|\bnights?\b|\bflights?\b|\bentry\b|\btickets?\b|\bpart(y|ies)\b|\bmemberships?\b|\bpackages?\b|\badmissions?\b|\bcourses?\b|\btours?\b|\bprograms?\b/i;
/** Idioms that merely contain a risky word. Deleted before the risky test, so no companion can rescue them. */
const NEGATIVE = /world[- ]?class|first[- ]class|business class|class action|session (cookies?|storage|expire)|cookies?|flight of stairs|flight status|court ?(house|room)|food court|supreme court|table of contents|time ?table|entry[- ]level|no entry|data entry|third[- ]part(y|ies)|party of \d|(last|opening|good) ?night|tonight|overnight|support ticket|ticketing system|membership (agreement|terms)|of course|course of|virtual tour|tour de force|slide ?show|photo tour|video tour/gi;
/** A price, a duration, a per-unit rate or a booking verb: proof the risky word names something sold. */
const COMPANION =
  /\$\s?\d|\b\d{1,3}\s?(min(ute)?s?|hours?|hrs?|days?|nights?|weeks?)\b|\bper\s+(person|adult|child|hour|day|night|game|group|lane|court|table|session|class)\b|\b(book|booking|reserve|reservation|register|registration|sign ?up|schedule|enroll|availability|buy tickets?|purchase)\b|\b(price|pricing|rates?|fees?)\b/i;

/**
 * Is this text the name of something a guest can book and pay for at this business?
 * `ctx` is whatever the caller has nearby: the price table under a heading, a link's href, the paragraph
 * that follows, and only ever rescues a risky word; it can never make a non-service word into a service.
 */
export function serviceLike(text: string, ctx = ""): boolean {
  if (!text) return false;
  if (CORE.test(text) || UNIT.test(text)) return true;
  const stripped = text.replace(NEGATIVE, " ");
  if (!RISKY.test(stripped)) return false;
  return COMPANION.test(stripped) || COMPANION.test(ctx) || CORE.test(ctx) || UNIT.test(ctx);
}

/** Navigation, legal pages, merchandise and jobs. Checked after the word list, and it wins. */
const NOT_SERVICE =
  /blog|news|about|contact|faq|gallery|photo|review|testimonial|career|employment|hiring|\bjobs?\b|apply now|privacy|terms|policy|accessibility|sitemap|log ?in|sign ?in|my account|cart|checkout|wish ?list|gift|sale|shop|store|merch|apparel|t-?shirt|hoodie|sticker|\bmugs?\b|pro shop|home$|location|weather|\bmaps?\b|directions|parking|press|partner|affiliate|franchise|donate|sponsor|newsletter|email|subscribe|coupon|special|deal|covid|^\s*(upcoming |special )?events?\s*$|events? calendar|news (and|&) events|virtual tour/i;
/** Pages worth crawling first when a site has many. */
const CRAWL_FIRST =
  /rental|rent|tour|trip|price|pricing|rate|package|service|book|reserv|experience|adventure|charter|lesson|clinic|class|schedule|program|camp|admission|ticket|membership|spa|menu|tee|range|court|lane|trail|site|cabin|tasting|treatment|party|birthday|group|event|faq|policy|waiver|hour|about|activit|option|what-we-offer|things-to-do/i;
const CRAWL_SKIP = /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|zip|css|js)$|\/(wp-json|feed|tag|category|author|cart|checkout|login|account|wp-admin|wp-content|xmlrpc)\b|blog\/|\/news\/|\/page\/\d|\?|#/i;
const WAIVER = /waiver|release form|sign (the|your) (form|waiver)|smartwaiver|wherewolf|waiverforever/i;
const BOOK = /book now|reserve|reservation|book online|buy tickets|schedule|check availability|fareharbor|peek\.com|xola|rezdy|checkfront|bookeo|resova/i;
const HOURS = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*(-|to|–|through)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[:,]?\s*\d{1,2}(:\d{2})?\s*(am|pm)?\s*(-|to|–)\s*\d{1,2}(:\d{2})?\s*(am|pm)|\b(open|hours)\b[^.]{0,40}\d{1,2}(:\d{2})?\s*(am|pm)\s*(-|to|–)\s*\d{1,2}(:\d{2})?\s*(am|pm)/i;
const PRICE_NEAR = /\$\s?(\d{1,3}(?:,\d{3})+|\d{2,5})(?:\.\d{2})?(?:\s*(?:\/|per|an?|each)\s*(hour|hr|half.?hour|30 ?min|person|adult|child|kid|ski|boat|day|night|half.?day|trip|group|ride|flight|jump|room|lane|court|table|game|round|class|session|site)s?)?/i;

/**
 * Groups of service names that mean the same activity. The first regex match wins, so the order is
 * specific-before-generic: "Kids Karate Class" must reach martial arts before the generic class rule.
 * `consolidate()` drops anything with no entry here, so this list is also the last gate: a name that no
 * line below recognises never becomes a service.
 */
const CANON: [RegExp, string][] = [
  // Water
  [/jet ?ski|waverunner|pwc/i, "Jet ski rental"], [/paddle ?board|\bsup\b/i, "Paddleboard rental"],
  [/kayak|canoe/i, "Kayak rental"], [/pontoon/i, "Pontoon rental"], [/pedal ?boat|paddle ?boat/i, "Pedal boat rental"],
  [/\bdock\b|swim platform/i, "Floating dock rental"], [/boat rental|boat rent/i, "Boat rental"],
  [/parasail/i, "Parasailing"], [/flyboard/i, "Flyboarding"], [/snorkel/i, "Snorkel trip"],
  [/scuba|\bdiv(e|ing)\b/i, "Dive trip"], [/raft|white ?water/i, "Rafting trip"],
  [/dolphin|manatee|whale|eco ?tour|mangrove|wildlife|nature walk|guided hike/i, "Wildlife tour"],
  [/fishing|charter/i, "Fishing charter"],
  [/sunset|cruise|sail|catamaran|yacht|glass ?bottom|airboat|boat tour|harbou?r/i, "Boat tour"],
  [/surf|wakeboard|water ?ski/i, "Surf and wake"],
  [/swim lesson|learn ?to ?swim|swim (class|school|team)/i, "Swim lessons"],
  [/lap swim|open swim|water aerobics|aqua ?(fit|robics)|pool (rental|pass)/i, "Pool session"],
  [/water ?slide|lazy river|wave pool|splash pad|water ?park/i, "Waterpark admission"],
  [/beach (chair|furniture|umbrella)|cabana/i, "Beach furniture rental"],
  // Air
  [/skydiv|tandem jump/i, "Tandem skydive"], [/helicopter|heli ?tour/i, "Helicopter tour"],
  [/balloon|hot ?air/i, "Balloon flight"], [/paraglid|hang ?glid/i, "Paragliding flight"],
  [/glider|gliding|discovery flight|scenic flight|flight (lesson|school|training)/i, "Scenic flight"],
  [/bungee/i, "Bungee jump"], [/zip ?line|aerial (adventure|park)/i, "Zipline"],
  // Snow and ice (before the water "tubing" rule, so a hill is not a river)
  [/snow ?tub|tubing hill/i, "Snow tubing"],
  [/lift ticket|gondola|chair ?lift|terrain park/i, "Lift ticket"],
  [/ski (lesson|school)|snowboard lesson|learn ?to ?ski/i, "Ski lesson"],
  [/ski (rental|pass|and ride)|snowboard rental|cross ?country ski|nordic|snowshoe/i, "Ski rental"],
  [/public skat|open skat|freestyle ice|figure skat|learn ?to ?skate/i, "Public skating"],
  [/stick (and|&|n) ?puck|ice time|rink rental|hockey (league|clinic|camp|school)/i, "Ice time"],
  [/curling|broomball/i, "Curling"], [/skate rental/i, "Skate rental"],
  [/banana boat|\btub(e|ing)\b/i, "Banana boat and tubing"],
  // Golf
  [/tee ?time|greens? ?fee|(nine|18|9|eighteen) holes|round of golf/i, "Tee time"],
  [/driving range|bucket of balls|range ball/i, "Driving range"],
  [/golf (lesson|clinic|school)/i, "Golf lesson"], [/golf simulator/i, "Golf simulator"],
  [/golf (cart|club) rental/i, "Golf cart rental"],
  [/mini(ature)? ?golf|putt ?putt|foot ?golf/i, "Mini golf"], [/disc golf|frisbee golf/i, "Disc golf"],
  // Courts and fields
  [/pickle ?ball/i, "Pickleball court"], [/tennis/i, "Tennis court"],
  [/squash|racquet ?ball|badminton|volleyball court|basketball court|batting cage|field rental|turf rental|\bcourts?\b/i, "Court rental"],
  // Play
  [/bowl/i, "Bowling"], [/shoe rental/i, "Shoe rental"],
  [/arcade|game card|play pass|unlimited play|\btokens?\b|laser maze|\bvr\b|virtual reality/i, "Arcade play"],
  [/laser ?tag/i, "Laser tag"], [/escape room/i, "Escape room"], [/rage room|smash room/i, "Rage room"],
  [/trampoline|open jump|jump (time|pass)|ninja (course|warrior)|dodgeball|foam pit/i, "Jump session"],
  [/soft play|bounce house|play ?ground/i, "Play session"],
  [/billiards|pool table|snooker|\bdarts\b|shuffleboard/i, "Table rental"],
  [/karaoke/i, "Karaoke room"], [/\bkart|go[- ]?kart/i, "Karting"],
  [/\baxe\b|hatchet/i, "Axe throwing"], [/paintball|airsoft/i, "Paintball"],
  // Ranges
  [/archery|target practice/i, "Archery"],
  [/shooting|gun rental|firearm|range time|clay shooting|trap shooting|skeet|concealed carry/i, "Range time"],
  // Climbing, fitness, martial arts, dance, yoga
  [/climb|boulder|belay|top ?rope/i, "Climbing pass"],
  [/personal train/i, "Personal training"],
  [/yoga|vinyasa|hatha|ashtanga/i, "Yoga class"],
  [/meditation|sound bath|\breiki\b/i, "Meditation session"],
  [/teacher training/i, "Teacher training"],
  [/martial arts|karate|jiu ?jitsu|\bbjj\b|tae ?kwon ?do|muay thai|kick ?box|\bjudo\b|boxing|\bmma\b|self ?defense|belt test|sparring|fencing/i, "Martial arts class"],
  [/gymnastics|tumbling|cheer|parkour|obstacle course/i, "Gymnastics class"],
  [/dance|ballet|hip ?hop|salsa|bachata|tango|ballroom|swing|burlesque|pole (dance|fitness)/i, "Dance class"],
  [/boot ?camp|cross ?fit|\bhiit\b|spin class|indoor cycling|pilates|\bbarre\b|zumba|group fitness|open gym/i, "Fitness class"],
  // Spa and wellness
  [/massage|deep tissue|swedish|hot stone|reflexolog|cupping|acupunctur|chiropract/i, "Massage"],
  [/facial|microderm|dermaplan|chemical peel/i, "Facial"],
  [/manicure|pedicure|\bmani\b|\bpedi\b|nail (service|art)|gel nails/i, "Manicure and pedicure"],
  [/waxing|threading|lash (extension|lift)|brow (lamination|shaping|tint)/i, "Waxing and lashes"],
  [/body (wrap|scrub|treatment)|mud bath|hydrotherap/i, "Body treatment"],
  [/sauna|steam room|hammam|\bbanya\b|infrared|halotherap|salt room/i, "Sauna session"],
  [/cold plunge|ice bath|contrast therapy|cryotherap/i, "Cold plunge"],
  [/float (tank|session|therapy)/i, "Float session"],
  [/spa (package|day)|bridal package/i, "Spa package"],
  // Drink
  [/tasting|tap ?room|cellar door|barrel tasting|\bflights?\b/i, "Tasting"],
  [/(brewery|winery|distillery|vineyard|barrel|cave) tour/i, "Brewery tour"],
  [/blending|food pairing|wine pairing|cocktail class|mixology/i, "Blending and pairing"],
  // Make
  [/cooking class|culinary|baking|cake decorating|knife skills|chef'?s table|private chef|sushi class|pasta (class|making)/i, "Cooking class"],
  [/pottery|wheel throwing|hand ?building|clay|glaze|\bkiln\b/i, "Pottery class"],
  [/paint ?(and|n|&) ?sip|paint your own|canvas class/i, "Paint and sip"],
  [/candle|glass ?blow|jewelry|woodworking|sewing|quilting|flower (crown|arranging)|terrarium|soap making|leather ?work|blacksmith|welding|screen ?print/i, "Craft workshop"],
  [/studio time/i, "Studio time"],
  [/improv|acting class|drama class/i, "Acting class"],
  // Culture
  [/general admission|\badmission|museum pass|exhibit|planetarium|\bimax\b/i, "Admission"],
  [/aquarium|\bzoo\b|safari|petting zoo|animal encounter/i, "Zoo admission"],
  [/botanical|garden tour|conservatory|greenhouse|farm tour|corn maze|pumpkin patch|apple picking|\bu[- ]?pick\b/i, "Garden admission"],
  [/haunted house/i, "Haunted house"],
  [/matinee|showtime|season (ticket|subscription)|student rush|comedy show/i, "Show ticket"],
  [/field trip|school (group|program|tour)|docent|audio (guide|tour)|guided tour|self[- ]guided tour|gallery tour|behind[- ]the[- ]scenes tour/i, "Guided tour"],
  // Land rentals and rides
  [/horse ?back|trail ride|pony ride|riding lesson|carriage ride|hayride|sleigh ride/i, "Trail ride"],
  [/snowmobile|\batv\b|\butv\b|\bjeep\b|segway|dog ?sled/i, "Off-road tour"],
  [/e-?bike|\bbikes?\b/i, "Bike rental"],
  // Tours
  [/walking tour|food tour|ghost tour|bus tour|trolley tour|city tour|pub crawl|sightseeing|wine tour|\btours?\b/i, "Guided tour"],
  // Camping
  [/camp ?site|camp ?ground|tent (site|pad)|primitive site|group site|pull[- ]?through|back[- ]?in site/i, "Campsite"],
  [/\brv (site|park|spot|hook)|full hook ?up|hook ?up/i, "RV site"],
  [/\bcabins?\b|\byurts?\b|glamping|bunk ?house|tree ?house|safari tent/i, "Cabin stay"],
  [/day ?use/i, "Day use"],
  // Venue and party
  [/birthday|party (package|room)|private (event|party)|corporate (event|outing)|team building/i, "Party package"],
  [/venue rental|facility rental|room rental|pavilion rental|picnic shelter|hall rental/i, "Venue rental"],
  // Generic bookable units, last: only reached when nothing above named the activity.
  [/summer camp|day camp|after ?school|\bcamps?\b/i, "Camp"],
  [/private (lesson|session)|semi[- ]private|\blessons?\b/i, "Private lesson"],
  [/\bclinics?\b/i, "Clinic"],
  [/\bworkshops?\b/i, "Workshop"],
  [/drop[- ]?in|day pass|week pass|month(ly)? pass|annual pass|season pass|punch card|class pack|multi[- ]?pass/i, "Day pass"],
  [/\bmemberships?\b/i, "Membership"],
  [/\bclass(es)?\b|\bcourses?\b|\bprograms?\b/i, "Class"],
  [/\bsessions?\b/i, "Session"],
  [/\blanes?\b/i, "Lane rental"],
  [/\btables?\b/i, "Table rental"],
  [/\btickets?\b|\bentry\b/i, "Ticket"],
  [/\bnights?\b/i, "Overnight stay"],
  [/equipment rental|gear rental|\brentals?\b/i, "Rental"],
  [/\bpackages?\b/i, "Package"],
];

export function canon(name: string): string | null {
  for (const [re, label] of CANON) if (re.test(name)) return label;
  return null;
}

function normLabel(l: string): string {
  return l.toLowerCase().replace(/\bkids?\b/g, "child").replace(/\bchildren\b/g, "child").replace(/\bunder\b/g, "").replace(/\b(older|up|plus)\b/g, "").replace(/\b(and|&|the|a|an|per|each|only|rate|rates|price|prices)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/s\b/g, "").replace(/\s+/g, " ").trim();
}

/** "Adult", "Adults" and "Adult 13 & older" at the same price are one line. Keep the most specific label. */
function dedupeVariants(vs: Variant[]): Variant[] {
  const out: Variant[] = [];
  for (const v of vs) {
    const n = normLabel(v.label);
    const twin = out.find((o) => {
      const m = normLabel(o.label);
      if (m === n) return true;
      if (o.price !== v.price) return false;
      const a = m.split(" ")[0];
      const b = n.split(" ")[0];
      return a === b && (m.startsWith(n) || n.startsWith(m));
    });
    if (!twin) out.push(v);
    else if (v.label.length > twin.label.length && twin.price === v.price) twin.label = v.label;
  }
  return out;
}

/**
 * A service name has to read like something on a price list. The widened vocabulary reaches far more pages,
 * so these three shapes, a document, a sentence, a feature bullet, are what it would otherwise drag in:
 *   "2025-2026 Class Schedule", "Event Rental Info", "Trial Class Intake"  -> a page or a form, not a booking
 *   "Book your massage today!", "Come explore our trails"                  -> marketing copy, not a line item
 *   "Amenity: Pull-Through", "Includes 2 nights"                           -> a feature of something else
 */
export function bookableName(name: string): boolean {
  const n = name.trim();
  if (!n || n.split(/\s+/).length > 7) return false;
  if (/[.?!:\/]$/.test(n)) return false;
  // Image alt text ("Pilates by Simona Logo") and a heading that swallowed its own price ("Membership $89").
  if (/\$|\blogos?\b|\u00a9/i.test(n)) return false;
  // A document or a page, named by its last word.
  if (/\b(schedule|calendar|info|information|intake|form|forms|waiver|polic(y|ies)|faq|faqs|terms|hours|directions|map|newsletter|checklist|handbook|rules|release|releases|list|overview|update|updates|announcement|flyer|flier|brochure|poster|pdf|menu)$/i.test(n)) return false;
  // The heading over a price table ("Program Fees", "Court Fees", "Cost per Session") rather than a line in it.
  // A green fee or a day-pass rate names the thing itself, so a core activity word keeps the name.
  if (/\b(fees?|costs?|pricing|prices?|rates?)$/i.test(n) && !CORE.test(n)) return false;
  // A price-table caption read the other way round ("Cost per Session", "Rates and Fees").
  if (/^(costs?|prices?|pricing|rates?|fees?)\b/i.test(n)) return false;
  // A picture gallery or a 360 walkthrough dressed up as a tour.
  if (/slide ?show|virtual tour|photo tour|video tour/i.test(n)) return false;
  // An instruction to the reader rather than a thing sold.
  if (/^(book|call|visit|come|join|enjoy|explore|discover|find|see|get|sign|let|check|click|welcome|thank|meet|read|shop|order|start|try|ask)\b/i.test(n)) return false;
  // The venue itself, not something sold in it: "The Escape Bowling Center", "Rozenvain Ballet Studio".
  if (/\b(cent(er|re)|club|academy|company|alley|arena|complex|facility|studio|gym|museum|theatre|theater|brewery|winery|distillery|resort|lodge|park)$/i.test(n)) return false;
  // Programs a guest joins for free rather than books: ambassador, volunteer, loyalty, referral, donations.
  if (/\b(ambassador|volunteer|loyalty|rewards?|referral|fundrais\w*|scholarship|donations?|sponsorships?)\b/i.test(n)) return false;
  // "Learn more" is a button; "Learn to Skate" is the beginner programme every rink sells.
  if (/^learn (more|about|how|why)\b/i.test(n)) return false;
  // A feature or inclusion of some other line.
  if (/^(amenity|amenities|includes?|including|featur(e|es|ing)|note|please)\b/i.test(n)) return false;
  return true;
}

/** Collapse near-duplicates to one line per activity, keeping the shortest original name and any price seen. */
function consolidate(found: Map<string, Found>): Found[] {
  const groups = new Map<string, Found & { canon: string; descWords?: number }>();
  for (const f of found.values()) {
    if (/@|https?:|\.(com|net|org|ca)\b/i.test(f.name)) continue;
    if (!bookableName(f.name)) continue;
    const c = canon(f.name);
    if (!c) continue;
    const weak = f.price == null && !f.variants?.length && f.name.split(/\s+/).length < 2;
    if (weak) continue;
    if (/\b(rates?|prices?|pricing|packages?|options?|menu|services?)\b/i.test(f.name) && f.name.split(/\s+/).length <= 3) f.name = c;
    const cur = groups.get(c);
    if (!cur) {
      groups.set(c, { ...f, canon: c, descWords: f.desc ? f.name.split(/\s+/).length : undefined });
      continue;
    }
    if (f.name.length < cur.name.length && !/^(an?|the|your|our)\b|!$/i.test(f.name)) cur.name = f.name;
    if (cur.price == null && f.price != null) {
      cur.price = f.price;
      cur.unit = f.unit;
      cur.url = f.url;
    }
    if (!cur.detail && f.detail) cur.detail = f.detail;
    // Description: prefer the copy that came with the plainest alias ("Jet ski rental" over "jet ski dolphin tour"), then the longer one.
    if (f.desc && !/\(\d{3}\)|contact us|sales/i.test(f.desc)) {
      const fw = f.name.split(/\s+/).length;
      const cw = cur.descWords ?? 99;
      if (!cur.desc || fw < cw || (fw === cw && f.desc.length > cur.desc.length)) {
        cur.desc = f.desc;
        cur.descWords = fw;
      }
    }
    if (f.photo && (!cur.photo || (cur.photoWeak && !f.photoWeak) || (!f.photoWeak && f.name.length < cur.name.length))) {
      cur.photo = f.photo;
      cur.photoWeak = f.photoWeak;
    }
    if (f.variants?.length) {
      cur.variants = cur.variants || [];
      for (const v of f.variants) if (!cur.variants.some((x) => x.label.toLowerCase() === v.label.toLowerCase())) cur.variants.push(v);
    }
  }
  return [...groups.values()]
    .map((g) => {
      // A bare "Standard" line is only useful when it is the sole price.
      if (g.variants && g.variants.length > 1) g.variants = dedupeVariants(g.variants.filter((v) => v.label !== "Standard"));
      return { ...g, name: g.name.length > 34 ? g.canon : g.name.replace(/\s*&\s*more!?$/i, "") };
    })
    .slice(0, 14);
}

/** GoDaddy Website Builder edge (AWS Global Accelerator). Connect timeouts for our IP since the big crawl. */
const BLOCKED_HOSTS = new Set(["76.223.105.230", "13.248.243.5"]);

function clean(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[|•·–—]+/g, "-").replace(/\s*-\s*(from|starting at)\s*$/i, "").replace(/^\*+\s*/, "").trim();
}

/** Element text with a space between child elements, so "Boat Rental</b><span>2-Hour" does not fuse into one word. */
function spaced($: ReturnType<typeof load>, el: any): string {
  const parts: string[] = [];
  $(el)
    .contents()
    .each((_, n: any) => {
      if (n.type === "text") parts.push(n.data || "");
      else if (n.type === "tag" && n.name === "br") parts.push("\n");
      else if (n.type === "tag") parts.push(" " + spaced($, n) + " ");
    });
  return parts.join("");
}

function titleCase(s: string): string {
  return s.length > 3 && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}

type Variant = { label: string; price: number };
type Found = { name: string; detail: string | null; price: number | null; unit: string | null; url: string; variants?: Variant[]; desc?: string | null; photo?: string | null; photoWeak?: boolean };

const IMG_BAD = /logo|icon|sprite|badge|award|payment|visa|paypal|trip-?advisor|google-?review|reviews?\b|rating|yelp|facebook|instagram|arrow|button|btn|placeholder|spinner|pixel|avatar|map|flag|star|coupon|gift|calendar|phone|mail|social|header|branding|pattern|texture|blank|spacer|1x1|favicon|apple-touch|widget|weather|visible|hidden|overlay|\bbg\b|background|shape|divider|line\.|dot\.|loader|loading|\.(svg|gif|ico)(\?|$)/i;

/** Best photo near an element: inside its card, or the first real image after the heading. */
export function photoNear($: ReturnType<typeof load>, el: any, pageUrl: string, allowPageFallback = true): string | null {
  const pick = (imgs: any): string | null => {
    let best: string | null = null;
    imgs.each((_: number, img: any) => {
      if (best) return;
      const src = $(img).attr("data-src") || $(img).attr("data-lazy-src") || $(img).attr("src") || "";
      const srcset = $(img).attr("data-srcset") || $(img).attr("srcset") || "";
      const cand = srcset
        ? largestFromSrcset(srcset) || src
        : src;
      if (!cand) return;
      const w = Number(String($(img).attr("width") || "").replace(/[^0-9]/g, "")) || 0;
      if (w && w < 200) return;
      try {
        const abs = new URL(cand, pageUrl).toString();
        if (IMG_BAD.test(abs) || IMG_BAD.test($(img).attr("alt") || "")) return;
        best = abs;
      } catch {
        /* ignore */
      }
    });
    return best;
  };
  // 0. A picture inside the element itself, as with image links.
  const inside = pick($(el).find("img"));
  if (inside) return inside;
  // 1. The heading's own card or column.
  const card = $(el).closest("li, article, .card, [class*=card], [class*=item], [class*=service], [class*=product]");
  // WordPress wraps whole pages in <article>, so only trust a "card" that holds a handful of images.
  if (card.length && card.find("img").length <= 6) {
    const inCard = pick(card.find("img"));
    if (inCard) return inCard;
  }
  // 2. Walk up a few levels: a row that holds the heading in one column and the picture in another.
  let node = $(el).parent();
  for (let depth = 0; depth < 4 && node.length && !node.is("body"); depth++) {
    const imgs = node.find("img");
    if (imgs.length >= 1 && imgs.length <= 6) {
      const found = pick(imgs);
      if (found) return found;
    }
    if (imgs.length > 6) break;
    node = node.parent();
  }
  if (!allowPageFallback) return null;
  // 3. The page's first real content image, when the page itself is about this service.
  const main = $("main, article, [role=main], #content, .content, body").first();
  const rest = main.find("img").filter((_, img) => !$(img).closest("header, nav, footer, aside").length);
  return pick(rest.slice(0, 8));
}
type Addon = { name: string; price: number; url: string };

const ADDON_WORDS = /additional|extra|add[- ]?on|upgrade|rider|passenger|photo|video|gopro|camera|fuel|gas|cooler|insurance|damage|deposit|guide|lesson|delivery|late|tax|gratuity|tip|snorkel gear|wetsuit|dry bag|tube|towel/i;
const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d{1,5})";
const PRICE_CELL = new RegExp("^\\$\\s?" + NUM + "(?:\\.\\d{2})?(?:\\s*(?:\\+|and up|\\/|per)?.*)?$", "i");
const toNum = (t: string) => Number(t.replace(/,/g, ""));

function isAddon(label: string): boolean {
  return ADDON_WORDS.test(label);
}

/** Nearest service heading above an element: check preceding siblings at each ancestor level, then the page's main heading. */
function headingAbove($: ReturnType<typeof load>, el: any): string | null {
  // The element is the price table or price line this heading names, so its own text is the "price nearby"
  // companion that lets a risky heading ("Lanes", "Court Time", "Nightly") count as a service.
  const ctx = clean($(el).text()).slice(0, 400);
  let node = $(el);
  for (let depth = 0; depth < 8 && node.length; depth++) {
    const prev = node.prevAll("h1, h2, h3, h4, h5, h6").filter((_, h) => serviceLike(clean($(h).text()), ctx)).first();
    if (prev.length) return clean(prev.text());
    node = node.parent();
  }
  const page = $("h1, h2").filter((_, h) => serviceLike(clean($(h).text()), ctx)).first();
  if (page.length) return clean(page.text());
  const title = clean($("title").first().text()).split(/[|\-–]/)[0].trim();
  return serviceLike(title, ctx) ? title : null;
}

/** A rate-card row label that names a tier of something, never the thing itself: "Hourly", "4 hours", "Weekend", "Adult". */
const TIER = /^(hourly|daily|weekly|nightly|half.?day|full.?day|all.?day|weekdays?|weekends?|adults?|child(ren)?|kids?|seniors?|youth|students?|peak|off.?peak|standard|premium|basic|deluxe|\d+\s*(hours?|hrs?|hr|min(ute)?s?|days?|nights?|weeks?|people|persons?|riders?|guests?|pax|players?|laps?|games?|rounds?)|per\s+(hour|day|night|person|ride|game))\b/i;

/**
 * What the page as a whole sells, for rate cards that name only tiers. A jet-ski site's pricing page reads
 * "Weekdays · Hourly $130 · 4 hours $375" with no service heading anywhere: until 2026-09-14 those rows were
 * attached to a service called "Hourly", which the name filter then threw away, and the listing said no price.
 */
/** The caption over a rate card ("Rental rates", "Pricing", "Rates & Fees"): it names the list, not the thing sold. */
const PRICE_CAPTION = /^(our |the |current )?(rental |service |tour |class |lesson |charter |boat )?(rates?|prices?|pricing|fees?|costs?|rate card|price list)( (and|&) (rates?|fees?|prices?|costs?))?$/i;

function pageCanon($: ReturnType<typeof load>): string | null {
  const title = clean($("title").first().text());
  const h1 = clean($("h1").first().text());
  const desc = clean($('meta[name="description"]').attr("content") || "");
  return canon(title) || canon(h1) || canon(desc);
}

/** The short group heading over a rate-card block ("Weekdays", "Weekends", "Peak season"), which is not a service but qualifies the tier under it. */
function groupAbove($: ReturnType<typeof load>, el: any): string | null {
  let node = $(el);
  for (let depth = 0; depth < 4 && node.length; depth++) {
    const prev = node.prevAll("h2, h3, h4, h5").first();
    if (prev.length) {
      const t = clean(prev.text());
      return t.split(/\s+/).length <= 3 && !/\$/.test(t) && !serviceLike(t) ? t : null;
    }
    node = node.parent();
  }
  return null;
}

/** Read price tables and "label - $price" lists into variants and add-ons attached to the nearest service heading. */
export function harvestPrices($: ReturnType<typeof load>, url: string, out: Map<string, Found>, addons: Map<string, Addon>) {
  const fallback = pageCanon($);
  const attach = (heading: string | null, rawLabel: string, price: number, el?: any) => {
    // Above this it is almost always a boat, a board or a membership for sale, not a booking.
    if (price > 5000 || price < 5) return;
    // "Save $15", "$10 off", deposits and coupons are not things a guest books.
    if (/\b(save|off|discount|coupon|deposit|refund|fee|tax|gratuity|tip|late|cancel|gift ?cards?|gift certificates?|per (extra|additional))\b/i.test(rawLabel)) return;
    let label = rawLabel;
    if (isAddon(label)) {
      const k = label.toLowerCase();
      if (!addons.has(k)) addons.set(k, { name: titleCase(label), price, url });
      return;
    }
    const svc = heading && serviceLike(heading, "$" + price) ? heading : label;
    if (label.toLowerCase() === svc.toLowerCase()) label = "Standard";
    const key = svc.toLowerCase();
    const cur = out.get(key) || { name: titleCase(svc), detail: null, price: null, unit: null, url };
    cur.variants = cur.variants || [];
    if (el && (!cur.photo || cur.photoWeak)) {
      const near = photoNear($, el, url, false);
      if (near) {
        cur.photo = near;
        cur.photoWeak = false;
      }
    }
    if (!cur.variants.some((v) => v.label.toLowerCase() === label.toLowerCase())) cur.variants.push({ label, price });
    if (cur.price == null || price < cur.price) cur.price = price;
    cur.url = url;
    out.set(key, cur);
  };

  $("table").each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells = $(tr).find("th, td").map((_, c) => clean(spaced($, c))).get().filter((t) => t.length);
        if (cells.length) rows.push(cells);
      });
    if (!rows.length) return;
    const above = headingAbove($, table);
    const heading = !above || PRICE_CAPTION.test(above) ? fallback || above : above;
    // Layout C: a header row naming price columns ("Price/Hour", "Half Day") and rows of [service, ..., $a, $b].
    const header = rows[0];
    const priceCols = header.map((h, i) => (/price|rate|hour|hr|half|day|week|min|adult|child|person|session|trip/i.test(h) ? i : -1)).filter((i) => i >= 0);
    if (rows.length >= 2 && priceCols.length >= 2 && rows.slice(1).some((r) => r.filter((c) => PRICE_CELL.test(c)).length >= 2)) {
      for (const r of rows.slice(1)) {
        if (!r[0] || PRICE_CELL.test(r[0]) || r[0].length > 48) continue;
        // Map price cells to header columns by position from the right when the row is shorter than the header.
        const shift = header.length - r.length;
        r.forEach((cell, i) => {
          if (!PRICE_CELL.test(cell)) return;
          const col = header[i + shift] || header[i] || "";
          const label = clean(col.replace(/price\s*\/?\s*/i, "").replace(/\*/g, "")) || "Standard";
          attach(r[0], label, toNum(cell.match(PRICE_CELL)![1]), table);
        });
      }
      return;
    }
    // Layout A: a label row followed by a price row (columns are variants).
    let usedA = false;
    for (let i = 0; i + 1 < rows.length; i++) {
      const labels = rows[i];
      const prices = rows[i + 1];
      if (labels.length === prices.length && prices.every((c) => PRICE_CELL.test(c)) && !labels.some((c) => PRICE_CELL.test(c))) {
        labels.forEach((l, j) => attach(heading, l, toNum(prices[j].match(PRICE_CELL)![1]), table));
        usedA = true;
        i++;
      }
    }
    // Layout B: rows of [label, ..., price]. Skipped when the table was already read as columns.
    if (usedA) return;
    for (const r of rows) {
      if (r.length < 2) continue;
      const priceIdx = r.findIndex((c) => PRICE_CELL.test(c));
      if (priceIdx > 0 && !PRICE_CELL.test(r[0]) && r[0].length <= 48) attach(heading, r[0], toNum(r[priceIdx].match(PRICE_CELL)![1]), table);
    }
  });

  $("li, p, dt, dd, span, div, h3, h4, a").each((_, el) => {
    if ($(el).children().length > 6) return;
    // Only the innermost element that holds the price. Wrappers around several cards would blur services together.
    if ($(el).children().toArray().some((c) => $(c).text().includes("$") && $(c).children().length > 0)) return;
    const raw = spaced($, $(el).clone().children("ul, ol, table").remove().end());
    const lines = raw.split(/\n+/).map((l) => clean(l)).filter((l) => l.length >= 4 && l.length <= 140 && (l.match(/\$/g) || []).length === 1);
    if (lines.length > 6) return;
    for (const text of lines) {
    const dollar = text.indexOf("$");
    let before = clean(text.slice(0, dollar));
    for (let k = 0; k < 3; k++) before = before.replace(/[-–:.,\s]+$/, "").replace(/\s*\b(from|starting at|only|just|as low as|price|prices|rate|rates)$/i, "").trim();
    const after = text.slice(dollar).match(new RegExp("^\\$\\s?" + NUM));
    if (!after || before.length < 3 || before.length > 48) continue;
    const label = before;
    if (!serviceLike(label, text) && !/hour|hr|min|day|person|adult|child|kid|rider|ride|trip|flight|jump|game|lane|session|tour|package|standard|premium|private|group/i.test(label) && !isAddon(label)) continue;
    const heading = headingAbove($, el);
    if ((!heading || PRICE_CAPTION.test(heading)) && fallback && TIER.test(label) && !isAddon(label)) {
      const group = groupAbove($, el);
      attach(fallback, group ? group + " " + label : label, toNum(after[1]), el);
      continue;
    }
    attach(heading, label, toNum(after[1]), el);
    }
  });
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const EMAIL_SKIP = /example|sentry|wixpress|godaddy|squarespace|wordpress|w3\.org|schema\.org|domain\.com|email\.com|yourdomain|noreply|no-reply|donotreply|\.(png|jpg|jpeg|gif|svg|webp)$/i;

type SiteImage = { url: string; words: string };

/** Every real content image on the site, with its filename and alt text as searchable words. */
function collectImages($: ReturnType<typeof load>, pageUrl: string, into: SiteImage[]): void {
  $("img").each((_, img) => {
    if ($(img).closest("header, nav, footer").length) return;
    const src = $(img).attr("data-src") || $(img).attr("data-lazy-src") || $(img).attr("src") || "";
    if (!src) return;
    const w = Number(String($(img).attr("width") || "").replace(/[^0-9]/g, "")) || 0;
    if (w && w < 200) return;
    try {
      const abs = new URL(src, pageUrl).toString();
      const alt = $(img).attr("alt") || "";
      if (IMG_BAD.test(abs) || IMG_BAD.test(alt)) return;
      const file = abs.split("/").pop()!.split("?")[0].replace(/\.[a-z0-9]+$/i, "");
      if (!into.some((i) => i.url === abs)) into.push({ url: abs, words: (file + " " + alt).toLowerCase().replace(/[-_]+/g, " ") });
    } catch {
      /* ignore */
    }
  });
}

/** For a service with no picture next to it, find a site image whose filename or alt names the same thing. */
function photoByName(name: string, images: SiteImage[]): string | null {
  const words = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !/rental|rentals|tour|tours|hour|hours|day|adult|child|person/.test(w));
  if (!words.length) return null;
  let best: { url: string; score: number } | null = null;
  for (const img of images) {
    const score = words.filter((w) => img.words.includes(w)).length;
    if (score && (!best || score > best.score)) best = { url: img.url, score };
  }
  return best?.url || null;
}

function originOf(u: string): string {
  try {
    return new URL(u).origin + "/";
  } catch {
    return u;
  }
}

type HarvestMeta = {
  waiver?: string;
  book?: string;
  phone?: string;
  hours?: string;
  email?: string;
  desc?: string;
  bodies?: Map<string, string>;
  /** Every review read so far on this site, before dedupe and the cap. */
  reviews?: Review[];
  /** The operator's own AggregateRating with the most ratings behind it. */
  aggregate?: AggregateRating | null;
  /** Links named reviews, testimonials, guest book: read before other pages. */
  reviewPages?: Set<string>;
};

function harvest(html: string, url: string, out: Map<string, Found>, links: Set<string>, meta: HarvestMeta, addons: Map<string, Addon>, images?: SiteImage[]) {
  if (meta.reviews) {
    const got = harvestReviews(html, url);
    meta.reviews.push(...got.reviews);
    if (got.aggregate && (!meta.aggregate || got.aggregate.count > meta.aggregate.count)) meta.aggregate = got.aggregate;
  }
  const $ = load(html);
  const origin = new URL(url).origin;
  $("script, style, noscript, svg").remove();
  if (images) collectImages($, url, images);
  harvestPrices($, url, out, addons);

  $("a[href]").each((_, el) => {
    // Image links ("select a picture for prices") carry their name in the image's alt text.
    const imgIn = $(el).find("img").first();
    const text = clean($(el).text()) || (imgIn.length ? clean(imgIn.attr("alt") || imgIn.attr("title") || "") : "");
    const href = $(el).attr("href") || "";
    let abs: URL | null = null;
    try {
      abs = new URL(href, url);
    } catch {
      abs = null;
    }
    if (!meta.phone && /^tel:/i.test(href)) meta.phone = href.replace(/^tel:/i, "");
    if (!meta.email && /^mailto:/i.test(href)) {
      const m = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
      if (m.includes("@") && !EMAIL_SKIP.test(m)) meta.email = m;
    }
    if (!meta.waiver && (WAIVER.test(text) || WAIVER.test(href))) meta.waiver = abs?.toString() || href;
    if (!meta.book && (BOOK.test(text) || BOOK.test(href)) && abs) meta.book = abs.toString();
    if (!abs || abs.origin !== origin) return;
    if (CRAWL_SKIP.test(abs.pathname + abs.search + abs.hash)) return;
    links.add(abs.origin + abs.pathname.replace(/\/$/, ""));
    if (meta.reviewPages && (REVIEW_LINK.test(text) || REVIEW_LINK.test(abs.pathname.replace(/[-_/]+/g, " "))) && !/\/(?:reviews?|testimonials?)\/[^/]+\/./i.test(abs.pathname)) {
      meta.reviewPages.add(abs.origin + abs.pathname.replace(/\/$/, ""));
    }
    if (text.length >= 4 && text.length <= 60 && serviceLike(text, href) && !NOT_SERVICE.test(text)) {
      const key = text.toLowerCase();
      if (!out.has(key)) out.set(key, { name: titleCase(text), detail: null, price: null, unit: null, url, photo: photoNear($, el, url, false) });
    }
  });

  $("h1, h2, h3").each((_, el) => {
    const text = clean(spaced($, el));
    if (text.length < 4 || text.length > 70) return;
    // Read the copy under the heading first: it is the context that decides whether a risky heading
    // ("Classes", "Sessions", "Party") names something sold or is just a section label.
    const near = clean($(el).nextAll().slice(0, 3).text()).slice(0, 240);
    if (!serviceLike(text, near) || NOT_SERVICE.test(text)) return;
    if (/@|https?:|\.(com|net|org|ca)\b/i.test(text)) return;
    const key = text.toLowerCase();
    const m = near.match(PRICE_NEAR) || text.match(PRICE_NEAR);
    const cur = out.get(key) || { name: titleCase(text), detail: null, price: null, unit: null, url };
    if (!cur.photo) {
      const strong = photoNear($, el, url, false);
      if (strong) cur.photo = strong;
      else {
        const weak = photoNear($, el, url, true);
        if (weak) {
          cur.photo = weak;
          cur.photoWeak = true;
        }
      }
    }
    {
      // Best paragraph under this heading: describes the activity, not a sales pitch, no phone numbers.
      const candidates = $(el).nextAll("p, div").slice(0, 4).map((_, n) => clean($(n).text())).get().filter((d) => d.length >= 60);
      const score = (d: string) =>
        (serviceLike(d) ? 2 : 0) + (/\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}|contact us|call us|sales|membership|coupon|discount/i.test(d) ? -3 : 0) + (d.length > 140 ? 1 : 0);
      const best = candidates.sort((a, b) => score(b) - score(a))[0];
      if (best && score(best) > 0 && (!cur.desc || score(best) > score(cur.desc))) cur.desc = best.slice(0, 320).replace(/\s+\S*$/, "");
    }
    if (m && cur.price == null) {
      cur.price = toNum(m[1]);
      cur.unit = m[2] ? "/" + m[2].toLowerCase().replace(/s$/, "") : null;
      cur.url = url;
    }
    if (!cur.detail && near && !/\$/.test(near.slice(0, 5)) && !/reserve now|book now/i.test(near.slice(0, 20))) cur.detail = near.slice(0, 120).replace(/\s+\S*$/, "");
    out.set(key, cur);
  });

  // A service's own page (jet-ski-rentals, dolphin-tours) is the richest description of it. Keep its body copy.
  {
    const pathname = new URL(url).pathname.toLowerCase();
    const slugWords = new Set(pathname.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const h1 = clean($("h1").first().text()).toLowerCase();
    const generic = /about|contact|faq|gallery|photo|blog|news|review|testimonial|things-to-do|polic|terms|privacy|waiver|licen|test|career|team|staff|location|direction|weather|gift|shop|cart|checkout|sitemap/.test(pathname);
    if (slugWords.size && !generic) {
      const body = $("main p, article p, .entry-content p, .content p, section p, p")
        .map((_, n) => clean($(n).text()))
        .get()
        .filter((d) => d.length >= 80 && !/cookie|javascript|browser|copyright|all rights|\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}|call us|contact us|privacy|terms/i.test(d))
        .slice(0, 4)
        .join(" ");
      if (body.length >= 160 && meta.bodies) meta.bodies.set(url, body.slice(0, 700).replace(/\s+\S*$/, ""));
      if (body.length >= 160) {
        const STOP = /^(the|and|our|for|with|tour|tours|rental|rentals|trip|trips|ride|rides)$/;
        const wordsOf = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.test(w));
        const inSlug = (w: string) => slugWords.has(w) || slugWords.has(w + "s") || slugWords.has(w.replace(/s$/, ""));
        for (const cur of out.values()) {
          const words = wordsOf(cur.name);
          const hit = words.length > 0 && (words.every(inSlug) || (h1.length > 0 && words.every((w) => h1.includes(w))));
          if (!hit) continue;
          // /jet-ski-dolphin-tours/ belongs to neither "Jet Ski" nor "Dolphin Tours": a different service also fits the slug.
          // Aliases of the same service ("Jet ski rental" vs "Jet Ski Rentals Panama City Beach") overlap and do not count.
          const rival = [...out.values()].some((o) => {
            if (o === cur) return false;
            const ow = wordsOf(o.name);
            if (!ow.length || !ow.every(inSlug)) return false;
            const overlap = ow.some((w) => words.includes(w)) || words.some((w) => ow.includes(w));
            return !overlap;
          });
          if (rival) continue;
          if (!cur.desc || cur.desc.length < 200 || cur.desc.length < body.length / 2) cur.desc = body.slice(0, 700).replace(/\s+\S*$/, "");
          if (!cur.url || cur.url === originOf(url)) cur.url = url;
        }
      }
    }
  }

  if (!meta.desc) {
    const metaDesc = clean($('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || "");
    const para = $("main p, article p, section p, p").filter((_, n) => clean($(n).text()).length >= 90).first();
    const first = para.length ? clean(para.text()) : "";
    const pick = [metaDesc, first].filter((d) => d && !/cookie|javascript|browser|copyright|all rights|\(\d{3}\)|call us|contact us/i.test(d)).sort((a, b) => b.length - a.length)[0];
    if (pick) meta.desc = pick.slice(0, 420).replace(/\s+\S*$/, "");
  }
  if (!meta.email) {
    const found = (html.match(EMAIL_RE) || []).map((e) => e.toLowerCase()).filter((e) => !EMAIL_SKIP.test(e));
    const host = new URL(url).hostname.replace(/^www\./, "");
    const own = found.find((e) => e.endsWith("@" + host)) || found.find((e) => /info@|hello@|book|reserv|contact|sales|tours|charters/i.test(e)) || found[0];
    if (own) meta.email = own;
  }
  if (!meta.hours) {
    const lines = harvestHours(html);
    if (lines.length) meta.hours = lines.join(" | ");
  }
  if (!meta.hours) {
    const body = clean($("body").text());
    const h = body.match(HOURS);
    if (h) meta.hours = h[0].slice(0, 120);
  }
}

/* ---------------------------------------------------------------- reviews
 *
 * Customer reviews the operator publishes on its own pages, read on the same page visits as everything else:
 *   1. schema.org Review and AggregateRating, as JSON-LD or microdata;
 *   2. testimonial sections: review and testimonial cards, blockquote and cite, slider and carousel slides
 *      under a "What our guests say" heading, and paragraph-plus-signature testimonial pages;
 *   3. review widgets that print their reviews into the page (Trustindex, the Google Reviews plugins, Site Reviews,
 *      Strong Testimonials, Elementor and Divi testimonials, a pre-rendered Elfsight or EmbedSocial block). The
 *      platform the widget names becomes `source`; the widget is never followed to the platform.
 * Rules (what counts, what is rejected, rating sanity, dedupe, the best twelve) live in `sync/reviews.ts`.
 */

/** A link or path that leads to reviews. Those pages are read early, within the same page budget. */
export const REVIEW_LINK =
  /\b(?:reviews?|testimonials?|guest[- ]?book|guestbook|kind[- ]words|raves?|what[- ](?:people|guests|customers|clients|our[- ](?:guests|customers|clients|riders|students))[- ](?:are[- ])?say(?:ing)?)\b/i;
const REVIEW_HEADING =
  /^(?:(?:our |recent |latest |guest |customer |client |google |tripadvisor |5[- ]star )*(?:reviews?|testimonials?)\b|what (?:people|(?:our )?(?:guests|customers|clients|riders|students|divers|families|travell?ers)) (?:are |have been )?say(?:ing)?|kind words|happy (?:customers|guests|campers|clients)|guest ?book|hear from our|(?:don'?t|do not) (?:just )?take our word|(?:reviews?|love) from our|what our (?:guests|customers|clients) think)/i;
/** A class or id token that marks a review card or a testimonial. */
const CARD_TOKEN = /(?:review|testimonial|kind-?words)/i; // a quick screen; isCardEl decides
/** Words that name a part of a card, or chrome around cards, rather than a card ("ti-review-text-container", "review-count"). */
const PART_WORD =
  /^(?:text|content|body|message|comment|excerpt|description|quote|author|name|reviewer|date|time|meta|stars?|rating|ratings|score|header|footer|title|heading|headline|image|img|avatar|photo|pic|icon|logo|platform|source|count|summary|total|average|button|btn|link|nav|arrow|arrows|dots?|pagination|prev|next|intro|form|submit|write|badge|filter|sort|more|less|read|verified|profile|location|reply|response|cta|label|number|numbers|details|job|position|company|role|mark|marks|cite|designation|subtitle|caption|separator|divider|info|photo|thumb|thumbnail|video|media|input|ico)$/i;
const REPLY_TOKEN = /(?:^|[-_])(?:reply|replies|response|owner[-_]?(?:answer|reply|response)|business[-_]?response|ti-reply)(?:$|[-_])/i;
const FEED_SELECTOR = "[id^=cff], [class*=cff-], [class*=facebook-feed], [class*=fb-feed], [id*=sb_instagram], [class*=instagram-feed], [class*=twitter-feed], [class*=tiktok-feed]";
const SLIDE_SELECTOR =
  ".swiper-slide:not(.swiper-slide-duplicate), .slick-slide:not(.slick-cloned), .owl-item:not(.cloned), .carousel-item, .carousel-cell, .splide__slide:not(.is-clone), .glide__slide:not(.glide__slide--clone), .flickity-cell, .item, [class*=slide]:not([class*=slider]):not([class*=clone]):not([class*=slides])";

type Cheerio$ = ReturnType<typeof load>;

function tokensOf(el: any): string[] {
  const a = el?.attribs || {};
  return [...String(a.class || "").split(/\s+/), ...String(a.id || "").split(/\s+/)].filter(Boolean);
}

function isCardEl(el: any): boolean {
  return tokensOf(el).some((t) => {
    if (!CARD_TOKEN.test(t)) return false;
    const words = t.toLowerCase().split(/[-_]+/);
    const at = words.findIndex((w) => /^(?:customer|google|guest|client|user|site|tripadvisor|yelp|facebook|fb|product|star)?(?:reviews?|testimonials?)$/.test(w) || (w === "kind" && words.includes("words")));
    return at >= 0 && !words.slice(at + 1).some((w) => PART_WORD.test(w));
  });
}

const txt = ($: Cheerio$, el: any) => $(el).text().replace(/\s+/g, " ").trim();

/** Platform named by the card itself (a logo, a link, a label, its classes) or by the widget around it. */
function sourceNear($: Cheerio$, card: any): ReviewSource | null {
  const own = [
    tokensOf(card).join(" "),
    $(card).find("img").map((_, i) => (i.attribs?.src || "") + " " + (i.attribs?.alt || "") + " " + (i.attribs?.title || "")).get().join(" "),
    $(card).find("a[href]").map((_, a) => a.attribs?.href || "").get().filter((h) => /google\.[a-z.]+\/maps|g\.page|goo\.gl\/maps|tripadvisor\.|yelp\.|facebook\.com/i.test(h)).join(" "),
    $(card).find("[class*=platform], [class*=source], [class*=logo], [class*=icon], [class*=google], [class*=tripadvisor], [class*=yelp], [class*=facebook]").map((_, e) => tokensOf(e).join(" ") + " " + (e.attribs?.title || "") + " " + (e.attribs?.["aria-label"] || "")).get().join(" "),
  ].join(" ");
  const label = txt($, card).match(/\b(?:posted on|review(?:ed)? on|via|from|on)\s+(google|trip ?advisor|yelp|facebook|viator|airbnb|expedia|trustpilot)\b|\b(google|trip ?advisor|yelp|facebook) (?:review|guest|user)\b/i);
  const fromOwn = (label && sourceFromLabel(label[1] || label[2])) || sourceFromLabel(own.replace(/google-?(?:fonts?|analytics|tag|maps?-?api)/gi, ""));
  if (fromOwn) return fromOwn;
  // A widget container that names its platform: ti-widget data, "google-reviews", "wp-gr", "grw".
  let node = $(card).parent();
  for (let d = 0; d < 7 && node.length && !node.is("body"); d++) {
    const t = tokensOf(node[0]).join(" ") + " " + Object.entries(node[0].attribs || {}).filter(([k]) => /^data-/.test(k)).map(([, v]) => v).join(" ");
    if (/review|testimonial|widget|\bti-|grw|wp-gr|rplg|elfsight|eapps|embedsocial|trustmary/i.test(t)) {
      if (/\bwp-gr\b|\bgrw\b|wp-google|rplg/i.test(t)) return "google";
      const s = sourceFromLabel(t);
      if (s) return s;
    }
    node = node.parent();
  }
  return null;
}

function ratingNear($: Cheerio$, card: any): { value: unknown; best: unknown } | null {
  const c = $(card);
  const micro = c.find("[itemprop=ratingValue]").first();
  if (micro.length) return { value: micro.attr("content") || micro.text(), best: c.find("[itemprop=bestRating]").first().attr("content") || c.find("[itemprop=bestRating]").first().text() || undefined };
  const data = c.find("[data-rating], [data-score], [data-stars], [data-rateit-value]").addBack("[data-rating], [data-score], [data-stars]").first();
  if (data.length) {
    const v = data.attr("data-rating") || data.attr("data-score") || data.attr("data-stars") || data.attr("data-rateit-value");
    if (v && /^\d(?:\.\d+)?$/.test(v)) return { value: v, best: undefined };
  }
  const starBox = c.find("[class*=star], [class*=rating]").filter((_, e) => $(e).parentsUntil(card).filter("[class*=star], [class*=rating]").length === 0);
  for (const box of starBox.toArray()) {
    // A radio-button star widget: the checked input is the rating, and every label carries a "N out of 5" title.
    const radios = $(box).find("input[type=radio]");
    if (radios.length) {
      const on = radios.filter((_, e) => e.attribs?.checked != null || /checked/i.test(e.attribs?.class || "")).first();
      if (on.length && /^\d(?:\.\d)?$/.test(on.attr("value") || "")) return { value: on.attr("value"), best: undefined };
      continue;
    }
    const label = (box.attribs?.["aria-label"] || box.attribs?.title || "") + " " + $(box).find("[aria-label], [title]").map((_, e) => (e.attribs?.["aria-label"] || "") + " " + (e.attribs?.title || "")).get().join(" ");
    const m = label.match(/(\d(?:\.\d)?)\s*(?:out of|\/|of)\s*(\d{1,2})/i) || label.match(/(?:rated\s*)?(\d(?:\.\d)?)\s*stars?/i);
    if (m) return { value: m[1], best: m[2] };
    const cls = tokensOf(box).join(" ").match(/(?:stars?|rating)[-_](\d)(?:[-_]?(\d))?\b/i);
    if (cls) return { value: cls[2] ? cls[1] + "." + cls[2] : cls[1], best: undefined };
    const starLike = (e: any) => /star/i.test(tokensOf(e).join(" ") + " " + (e.attribs?.["data-icon"] || ""));
    const stars = $(box).find("[class*=star], i, svg, span").filter((_, e) => starLike(e) && !$(e).find("*").toArray().some(starLike));
    if (stars.length >= 1 && stars.length <= 5) {
      const tok = (e: any) => tokensOf(e);
      const isEmpty = (e: any) => tok(e).some((k) => /^(?:empty|off|e|far|inactive|outline|half|star-o|fa-star-o|fa-star-half-o)$|-(?:empty|off|outline|o|half|half-o)$/i.test(k));
      const isFull = (e: any) => !isEmpty(e) && tok(e).some((k) => /^(?:full|fill|filled|active|checked|selected|gold|on|f|fas|rated|is-active)$|-(?:full|fill|filled|on|active|checked)$/i.test(k));
      const full = stars.filter((_, e) => isFull(e));
      const empty = stars.filter((_, e) => isEmpty(e));
      if (full.length && full.length + empty.length === stars.length) return { value: full.length, best: undefined };
      if (!empty.length && stars.length === 5) return { value: 5, best: undefined };
    }
    const glyphs = $(box).text().replace(/\s+/g, "");
    const filled = (glyphs.match(/★|⭐/g) || []).length;
    const hollow = (glyphs.match(/☆/g) || []).length;
    if (filled >= 1 && filled + hollow <= 5 && /^[★⭐☆]+$/.test(glyphs)) return { value: filled, best: undefined };
  }
  // A star picture: alt="Five Stars", five-stars.webp, 4.5-star.png.
  for (const img of c.find("img").toArray()) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const alt = (img.attribs?.alt || img.attribs?.title || "").trim();
    const file = (img.attribs?.["data-src"] || img.attribs?.src || "").split("/").pop()?.split("?")[0] || "";
    const m = alt.match(/^(?:rated\s+)?(one|two|three|four|five|[1-5](?:\.\d)?)(?:\s*(?:out of|\/)\s*5)?[\s-]*stars?(?: rating)?$/i) || file.match(/(?:^|[-_])(one|two|three|four|five|[1-5](?:[._]\d)?)[-_]?stars?(?:[-_.])/i);
    if (m) return { value: words[m[1].toLowerCase()] ?? m[1].replace("_", "."), best: undefined };
  }
  const own = c.text().replace(/\s+/g, "");
  const run = own.match(/^[★⭐☆]{1,5}|[★⭐☆]{5}/);
  if (run && /★|⭐/.test(run[0])) return { value: (run[0].match(/★|⭐/g) || []).length, best: undefined };
  return null;
}

function dateNear($: Cheerio$, card: any): string | null {
  const c = $(card);
  const t = c.find("time[datetime]").first().attr("datetime") || c.find("[itemprop=datePublished]").first().attr("content") || c.find("[itemprop=datePublished]").first().text();
  if (t) return t.trim();
  const el = c.find("[class*=date], [class*=time], [class*=posted]").filter((_, e) => txt($, e).length <= 40).first();
  return el.length ? txt($, el) : null;
}

const AUTHOR_SELECTOR =
  "[itemprop=author], [class*=author], [class*=reviewer], [class*=-name], [class*=_name], [class*=name-], [class*=name_], .name, [class*=client], [class*=customer], [class*=person], cite, footer";

function authorNear($: Cheerio$, card: any): { text: string | null; el: any } {
  const c = $(card);
  const cands = c
    .find(AUTHOR_SELECTOR)
    .filter((_, e) => !/(?:img|image|avatar|photo|pic|icon|logo)/i.test(tokensOf(e).join(" ")))
    .toArray();
  for (const e of cands) {
    const nameEl = $(e).find("[itemprop=name]").first();
    const s = (nameEl.length ? txt($, nameEl) : txt($, e)) || (e.attribs?.content ?? "");
    if (s && s.length <= 70 && s.split(/\s+/).length <= 8) return { text: s, el: e };
  }
  const short = c.find("h3, h4, h5, h6, strong, b, .title").filter((_, e) => {
    const s = txt($, e);
    return s.length >= 2 && s.length <= 40 && s.split(/\s+/).length <= 4 && !/[.!?]$/.test(s) && /^[A-Z]/.test(s);
  }).first();
  return short.length ? { text: txt($, short), el: short[0] } : { text: null, el: null };
}

const TEXT_SELECTOR =
  "[itemprop=reviewBody], [class*=review-text], [class*=review_text], [class*=review-content], [class*=review-body], [class*=review-message], [class*=testimonial-text], [class*=testimonial-content], [class*=testimonial_content], [class*=testimonial-body], [class*=testimonial-quote], [class*=ti-review-content], [class*=wp-google-text], [class*=grw-review-text], [class*=testimonial__text], [class*=testimonial__content], [class*=et_pb_testimonial_description_inner], [class*=glsr-review-content], [class*=quote-text], [class*=-text], [class*=__text], [class*=content], [class*=excerpt], [class*=message], [class*=comment], blockquote, q";

function textNear($: Cheerio$, card: any, authorEl: any): string {
  const c = $(card);
  const specific = c.find(TEXT_SELECTOR).filter((_, e) => !(authorEl && ($(e).is(authorEl) || $(e).find(authorEl).length)) && txt($, e).length >= 30).toArray();
  if (specific.length) {
    // The most specific match: one that holds no other match with most of its text.
    const inner = specific.filter((e) => !specific.some((o) => o !== e && $(e).find(o).length && txt($, o).length >= txt($, e).length * 0.7));
    if (inner.length) return $(inner[0]).text();
  }
  const ps = c.find("p").filter((_, e) => !(authorEl && ($(e).is(authorEl) || $(e).find(authorEl).length)) && txt($, e).length >= 20).toArray();
  if (ps.length) return ps.map((p) => txt($, p)).join(" ");
  const clone = c.clone();
  clone.find(AUTHOR_SELECTOR + ", [class*=date], [class*=time], [class*=star], [class*=rating], h3, h4, h5, h6, button, a[class*=more]").remove();
  return clone.text();
}

function readCard($: Cheerio$, card: any, pageUrl: string, loose: boolean, fallbackSource: ReviewSource | null): RawReview | null {
  const a = authorNear($, card);
  if (!a.text) {
    // "- Priya S." on its own line under the words.
    const sig = $(card).find("span, div, p, em, i, small").filter((_, e) => !$(e).children().length && /^[-–—~]\s*[A-Z]/.test(txt($, e)) && txt($, e).length <= 60).last();
    if (sig.length) {
      a.text = txt($, sig);
      a.el = sig[0];
    }
  }
  const text = textNear($, card, a.el);
  if (!text || text.replace(/\s+/g, " ").trim().length < 30) return null;
  const r = ratingNear($, card);
  return { author: a.text, rating: r?.value, bestRating: r?.best, text, date: dateNear($, card), source: sourceNear($, card) || fallbackSource, sourceUrl: pageUrl, loose };
}

function jsonLdNodes($: Cheerio$): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    out.push(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, depth + 1);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text().trim().replace(/^<!--|-->$/g, "")), 0);
    } catch {
      /* broken JSON-LD is common; skip it */
    }
  });
  return out;
}

const typeIs = (o: Record<string, unknown>, re: RegExp) => [o["@type"]].flat().some((t) => typeof t === "string" && re.test(t));
const nameOf = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return nameOf(v[0]);
  if (typeof v === "object") return nameOf((v as Record<string, unknown>).name);
  return null;
};

/**
 * Reviews and the operator's own aggregate rating on one page. No fetches: the crawl hands in pages it already
 * read. Reviews come back cleaned and checked by `normalizeReview`, not yet deduped or capped across the site.
 */
export function harvestReviews(html: string, pageUrl: string): { reviews: Review[]; aggregate: AggregateRating | null } {
  const empty = { reviews: [] as Review[], aggregate: null };
  if (!/review|testimonial|blockquote|ratingvalue|what\s+(?:people|our|guests|customers|clients)|kind words|guest\s?book/i.test(html)) return empty;
  const $ = load(html);
  const raws: RawReview[] = [];
  let aggregate: AggregateRating | null = null;
  const takeAggregate = (value: unknown, best: unknown, countRaw: unknown) => {
    const rating = parseRating(value, best);
    const n = Number(String(countRaw ?? "").replace(/[^0-9]/g, ""));
    if (rating == null || !Number.isFinite(n) || n < 1) return;
    if (!aggregate || n > aggregate.count) aggregate = { rating, count: n, source: "site", sourceUrl: pageUrl };
  };

  // 1. JSON-LD.
  for (const o of jsonLdNodes($)) {
    if (typeIs(o, /Review$/) && (o.reviewBody || o.description)) {
      const rr = o.reviewRating as Record<string, unknown> | undefined;
      const publisher = nameOf(o.publisher);
      raws.push({ author: nameOf(o.author), rating: rr && typeof rr === "object" ? rr.ratingValue : rr, bestRating: rr && typeof rr === "object" ? rr.bestRating : undefined, text: String(o.reviewBody || o.description), date: typeof o.datePublished === "string" ? o.datePublished : null, source: sourceFromLabel(publisher) || "site", sourceUrl: pageUrl });
    }
    if (typeIs(o, /^AggregateRating$/)) takeAggregate(o.ratingValue, o.bestRating, o.reviewCount ?? o.ratingCount);
  }

  // Business replies and social feeds are the business talking, never a review.
  $("script, style, noscript, nav, " + FEED_SELECTOR).remove();
  // Carousels repeat their first and last slides as clones.
  $(".slick-cloned, .swiper-slide-duplicate, .owl-item.cloned, .splide__slide.is-clone, .glide__slide--clone, [aria-hidden=true][class*=clone]").remove();
  $("*").filter((_, e) => tokensOf(e).some((t) => REPLY_TOKEN.test(t))).remove();

  // 2. Microdata.
  const done = new Set<any>();
  $("[itemtype]").each((_, el) => {
    const type = el.attribs?.itemtype || "";
    if (/schema\.org\/AggregateRating\b/i.test(type)) {
      const c = $(el);
      takeAggregate(c.find("[itemprop=ratingValue]").attr("content") || c.find("[itemprop=ratingValue]").text(), c.find("[itemprop=bestRating]").attr("content"), c.find("[itemprop=reviewCount]").attr("content") || c.find("[itemprop=reviewCount]").text() || c.find("[itemprop=ratingCount]").attr("content") || c.find("[itemprop=ratingCount]").text());
      return;
    }
    if (!/schema\.org\/(?:User|Critic)?Review\/?$/i.test(type)) return;
    const c = $(el);
    const body = c.find("[itemprop=reviewBody], [itemprop=description]").first();
    const authorEl = c.find("[itemprop=author]").first();
    const authorName = authorEl.find("[itemprop=name]").first();
    const text = body.length ? body.text() : "";
    if (!text) return;
    done.add(el);
    const r = ratingNear($, el);
    raws.push({ author: authorName.length ? authorName.attr("content") || txt($, authorName) : authorEl.attr("content") || txt($, authorEl) || null, rating: r?.value, bestRating: r?.best, text, date: c.find("[itemprop=datePublished]").attr("content") || c.find("[itemprop=datePublished]").attr("datetime") || txt($, c.find("[itemprop=datePublished]")) || null, source: sourceNear($, el) || "site", sourceUrl: pageUrl });
  });
  const insideDone = (el: any) => done.has(el) || $(el).parents().toArray().some((p) => done.has(p));

  // 3. Cards: review and testimonial elements and widget items, innermost only.
  const cards = $("*").filter((_, e) => isCardEl(e) && !insideDone(e)).toArray();
  const cardSet = new Set(cards);
  const leaves = cards.filter((e) => !$(e).find("*").toArray().some((d) => cardSet.has(d) && txt($, d).length >= 30));
  const itemsIn = (container: any): any[] => {
    const slides = $(container).find(SLIDE_SELECTOR).toArray().filter((s) => txt($, s).length >= 30);
    const leafSlides = slides.filter((s) => !slides.some((o) => o !== s && $(s).find(o).length));
    if (leafSlides.length >= 2) return leafSlides;
    const quotes = $(container).find("blockquote, li, article").toArray().filter((s) => txt($, s).length >= 30);
    const leafQuotes = quotes.filter((s) => !quotes.some((o) => o !== s && $(s).find(o).length));
    if (leafQuotes.length >= 2) return leafQuotes;
    return [];
  };
  for (const card of leaves) {
    if (raws.length >= 60) break;
    const len = txt($, card).length;
    const items = itemsIn(card);
    const src = sourceNear($, card);
    if (items.length) {
      for (const it of items) {
        done.add(it);
        const r = readCard($, it, pageUrl, false, src);
        if (r) raws.push(r);
      }
    } else if (len <= 3000) {
      done.add(card);
      const r = readCard($, card, pageUrl, false, null);
      if (r) raws.push(r);
    }
  }

  // 4. A section under a reviews heading: its slides, quotes or list items.
  $("h1, h2, h3, h4, h5, h6, [class*=heading], [class*=title]").each((_, h) => {
    const label = txt($, h);
    if (!label || label.length > 70 || !REVIEW_HEADING.test(label)) return;
    let node = $(h).parent();
    for (let d = 0; d < 5 && node.length && !node.is("body"); d++) {
      const items = itemsIn(node[0]).filter((it) => !insideDone(it));
      if (items.length) {
        for (const it of items.slice(0, 20)) {
          done.add(it);
          const r = readCard($, it, pageUrl, true, null);
          if (r) raws.push(r);
        }
        return;
      }
      node = node.parent();
    }
  });

  // 5. Bare blockquotes anywhere, and on a testimonials page, paragraphs signed "- Name".
  $("blockquote").each((_, bq) => {
    if (insideDone(bq)) return;
    const cite = $(bq).find("cite, footer").first();
    const next = $(bq).next();
    const author = cite.length ? txt($, cite) : next.length && /^[-–—~]/.test(txt($, next)) && txt($, next).length <= 60 ? txt($, next) : null;
    const clone = $(bq).clone();
    clone.find("cite, footer").remove();
    raws.push({ author, text: clone.text(), sourceUrl: pageUrl, loose: true });
    done.add(bq);
  });
  let path = "";
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    /* keep empty */
  }
  if (REVIEW_LINK.test(path.replace(/[-_/]+/g, " "))) {
    $("main p, article p, .entry-content p, #content p, .content p, section p").each((_, p) => {
      if (insideDone(p) || raws.length >= 60) return;
      const t = txt($, p);
      if (t.length < 40 || t.length > 1500) return;
      const next = $(p).next();
      const nextText = next.length ? txt($, next) : "";
      const signed = /\s[-–—~]\s*[A-Z][\w.'’]*(?:\s+[A-Z][\w.'’]*){0,3}\s*$/.test(t);
      const author = /^[-–—~]\s*\S/.test(nextText) && nextText.length <= 60 ? nextText : null;
      if (!signed && !author) return;
      done.add(p);
      raws.push({ author, text: t, sourceUrl: pageUrl, loose: true });
    });
  }

  const reviews = raws.map((r) => normalizeReview(r)).filter((r): r is Review => !!r);
  return { reviews, aggregate };
}

/** One offering row, in the shape `offerings` stores: cents, not dollars, and the page it was read from. */
export type ScrapedService = {
  name: string;
  detail: string | null;
  duration: string | null;
  price_cents: number | null;
  price_unit: string | null;
  currency: string;
  source_url: string;
};

/** One `facts` row: service, service_desc, service_photo, addon, site_desc, waiver_url, booking_url, hours_text. */
export type ScrapedFact = { fact_key: string; fact_value: string; source_url: string };

export type ScrapeResult = {
  operatorId: string;
  domain: string;
  /** The URL the crawl started from, which is what every site-wide fact is attributed to. */
  start: string;
  pages: number;
  /** Consolidated services, one per activity; the same number `facts` has `service` rows for. */
  services: ScrapedService[];
  facts: ScrapedFact[];
  /** Contact details read off the site. Raw, unnormalized: the writer decides what to do with them. */
  contact: { phone?: string; email?: string; hours?: string };
  status: "ok" | "no_pages" | "error";
  error?: string;
  /** When this site was read, so a later crawl of the same operator can win over an older one. */
  at: string;
};

/**
 * Fetch an operator's site and read its structure. No database, no writes: everything it learned comes back
 * in the result. `STRUCTURE_MAX_PAGES` caps the crawl (40 by default); `STRUCTURE_DEBUG` prints what it found.
 */
export async function scrapeSite(op: { id: string; domain: string; website: string }): Promise<ScrapeResult> {
  const startUrl = op.website.startsWith("http") ? op.website : "https://" + op.website;
  const base: ScrapeResult = {
    operatorId: op.id,
    domain: op.domain,
    start: startUrl,
    pages: 0,
    services: [],
    facts: [],
    contact: {},
    status: "ok",
    at: new Date().toISOString(),
  };
  try {
    // Hosts that drop our connections after heavy crawling. Skip in milliseconds instead of waiting out a timeout.
    try {
      const { address } = await lookup(new URL(startUrl).hostname);
      if (BLOCKED_HOSTS.has(address)) return { ...base, status: "error", error: "host blocks crawler: " + address };
    } catch {
      return { ...base, status: "error", error: "dns lookup failed" };
    }
    let home;
    try {
      home = await fetchHtml(startUrl);
    } catch {
      // One retry after a pause covers the DNS hiccups that come with many parallel lookups.
      await sleep(1500);
      home = await fetchHtml(startUrl);
    }
    if (home.status !== 200 || !home.html) return { ...base, status: "no_pages" };
    const found = new Map<string, Found>();
    const links = new Set<string>();
    const addons = new Map<string, Addon>();
    const images: SiteImage[] = [];
    const meta: HarvestMeta = { bodies: new Map(), reviews: [], reviewPages: new Set() };
    harvest(home.html, home.finalUrl || startUrl, found, links, meta, addons, images);
    base.pages = 1;
    // Breadth-first over the site's own pages, likely service and pricing pages first. Deep on purpose:
    // every location, activity and pricing page on the site is context for the listing.
    const MAX_PAGES = Number(process.env.STRUCTURE_MAX_PAGES || 40);
    const seen = new Set<string>([startUrl.replace(/\/$/, ""), (home.finalUrl || startUrl).replace(/\/$/, "")]);
    const queue: string[] = [];
    const enqueue = (set: Set<string>) => {
      const fresh = [...set].filter((u) => !seen.has(u) && !queue.includes(u));
      // Up to three review or testimonial pages first, then likely service and pricing pages. Same page budget.
      const reviewFirst = new Set([...(meta.reviewPages || [])].filter((u) => !seen.has(u)).sort((a, b) => a.length - b.length).slice(0, 3));
      const rank = (u: string) => (reviewFirst.has(u) ? 2 : CRAWL_FIRST.test(u) ? 1 : 0);
      fresh.sort((a, b) => rank(b) - rank(a) || a.length - b.length);
      queue.push(...fresh);
    };
    enqueue(links);
    while (queue.length && base.pages < MAX_PAGES) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      await sleep(20);
      const res = await fetchHtml(url).catch(() => null);
      if (!res || res.status !== 200 || !res.html) continue;
      const more = new Set<string>();
      harvest(res.html, res.finalUrl || url, found, more, meta, addons, images);
      base.pages += 1;
      enqueue(more);
    }

    if (process.env.STRUCTURE_DEBUG) {
      for (const f of found.values()) console.error("FOUND", JSON.stringify({ name: f.name, photo: f.photo, weak: f.photoWeak, url: f.url, variants: f.variants?.length || 0 }));
    }

    const services = consolidate(found);
    // Services still without copy: the page whose slug carries every word of the name, shortest slug wins.
    for (const f of services) {
      if (f.desc && f.desc.length >= 200) continue;
      const words = f.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(the|and|our|for|with|tour|tours|rental|rentals|trip|trips|ride|rides)$/.test(w));
      if (!words.length) continue;
      const hits = [...(meta.bodies || new Map<string, string>()).entries()]
        .filter(([u]) => {
          const sw = new Set(new URL(u).pathname.toLowerCase().split(/[^a-z0-9]+/));
          return words.every((w) => sw.has(w) || sw.has(w + "s") || sw.has(w.replace(/s$/, "")));
        })
        .sort((a, b) => a[0].length - b[0].length);
      if (hits[0] && (!f.desc || hits[0][1].length > f.desc.length)) {
        f.desc = hits[0][1];
        if (!f.url || f.url === originOf(hits[0][0])) f.url = hits[0][0];
      }
    }
    for (const f of services) {
      if (!f.photo || f.photoWeak) {
        const byName = photoByName(f.name, images);
        if (byName) f.photo = byName;
      }
      if (f.variants?.length) {
        for (const v of f.variants.slice(0, 8)) {
          base.services.push({ name: f.name.slice(0, 80), detail: v.label.slice(0, 80), duration: null, price_cents: v.price * 100, price_unit: "each", currency: "USD", source_url: f.url });
        }
      } else {
        base.services.push({ name: f.name.slice(0, 80), detail: null, duration: null, price_cents: f.price == null ? null : f.price * 100, price_unit: f.unit || "each", currency: "USD", source_url: f.url });
      }
      base.facts.push({ fact_key: "service", fact_value: f.name.slice(0, 80), source_url: f.url });
      if (f.desc) base.facts.push({ fact_key: "service_desc", fact_value: JSON.stringify({ name: f.name.slice(0, 80), desc: f.desc }), source_url: f.url });
      if (f.photo) base.facts.push({ fact_key: "service_photo", fact_value: JSON.stringify({ name: f.name.slice(0, 80), url: f.photo }), source_url: f.url });
    }
    for (const a of [...addons.values()].slice(0, 8)) base.facts.push({ fact_key: "addon", fact_value: a.name.slice(0, 60) + " $" + a.price, source_url: a.url });
    if (meta.desc) base.facts.push({ fact_key: "site_desc", fact_value: meta.desc, source_url: startUrl });
    if (meta.waiver) base.facts.push({ fact_key: "waiver_url", fact_value: meta.waiver, source_url: startUrl });
    if (meta.book) base.facts.push({ fact_key: "booking_url", fact_value: meta.book, source_url: startUrl });
    if (meta.hours) base.facts.push({ fact_key: "hours_text", fact_value: meta.hours, source_url: startUrl });
    // One `review` fact per kept review, its value the Review model as JSON; see sync/reviews.ts.
    for (const r of selectReviews(meta.reviews || [])) base.facts.push({ fact_key: "review", fact_value: JSON.stringify(r), source_url: r.sourceUrl });
    // The operator's own schema.org AggregateRating. Only fills a listing's rating when discovery gave none (structure.ts).
    if (meta.aggregate) base.facts.push({ fact_key: "aggregate_rating", fact_value: JSON.stringify(meta.aggregate), source_url: meta.aggregate.sourceUrl });
    base.contact = { ...(meta.phone ? { phone: meta.phone } : {}), ...(meta.email ? { email: meta.email } : {}), ...(meta.hours ? { hours: meta.hours } : {}) };
    return base;
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause ? " [" + (cause.code || cause.message || "") + "]" : "";
    return { ...base, status: "error", error: ((e as Error).message + detail).slice(0, 200) };
  }
}

/** How many distinct services a scrape found, which is what the old `StructureResult.services` counted. */
export function serviceCount(r: ScrapeResult): number {
  return r.facts.filter((f) => f.fact_key === "service").length;
}
