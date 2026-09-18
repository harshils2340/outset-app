/**
 * Plain English for the words a first-time guest does not know. A listing's services are copied from the operator's
 * own site, which is written for regulars: "Full hookup 50 amp", "Bareboat", "Greens fee", "Auto-belay". Each entry
 * here is one short sentence a guest can read under the service name. Nothing in it describes a particular operator;
 * it only says what the word means, so it can never put a false promise on a listing.
 *
 * Entries are grouped by the kind of activity, because the same word means different things in different places
 * ("tandem" is two people on one parasail, but one guest strapped to an instructor in skydiving). A listing reads its
 * own groups first and then the shared general list. A few terms are unambiguous anywhere ("greens fee", "BYOB") and
 * are marked `any`, so a golf term still explains itself on a resort whose kind is "venue".
 */

export type Explained = { term: string; meaning: string };

type Entry = { term: string; re: RegExp; meaning: string; any?: boolean; only?: string[]; not?: string[] };

/** [display term, pattern (word-bounded, case-insensitive unless it is a RegExp), meaning, flags] */
type Row = [string, string | RegExp, string, ({ any?: boolean; only?: string[]; not?: string[] })?];

const rows = (list: Row[]): Entry[] =>
  list.map(([term, pat, meaning, flags]) => ({
    term,
    re: typeof pat === "string" ? new RegExp("(?<![A-Za-z0-9])(?:" + pat + ")(?![A-Za-z0-9])", "i") : pat,
    meaning,
    ...(flags || {}),
  }));

const GOLF = rows([
  ["Greens fee", "greens? fees?", "The price to play the course, usually not including a cart.", { any: true }],
  ["Cart fee", "cart fees?", "The charge for riding a shared golf cart between holes."],
  ["Tee time", "tee[- ]?times?", "A reserved start time for your group on the first hole.", { any: true }],
  ["Shotgun start", "shotgun (?:start|format|tournaments?)", "Every group starts at the same moment, each on a different hole.", { any: true }],
  ["9 holes", "(?:9|nine)[- ]holes?", "Half a round of golf, usually about two hours."],
  ["18 holes", "(?:18|eighteen)[- ]holes?", "A full round of golf, usually four to five hours."],
  ["Twilight rate", "twilight(?: rates?| golf| green fees?| play)?", "A lower price for starting late in the day, when you may not finish before dark."],
  ["Range bucket", "(?:range )?buckets?(?: of balls)?|(?:small|medium|large|jumbo) bucket", "A basket of practice balls to hit at the driving range."],
  ["Driving range", "driving range", "An open practice area for hitting balls, not a full course."],
  ["Walking rate", "walking (?:rate|round|golf)|walk(?:ing)? only", "The price for carrying or pushing your own bag, with no cart."],
  ["Replay rate", "replay(?: rate| round)?", "A lower price for a second round on the same day."],
  ["Par 3", "par[- ]?3(?: course)?", "A short course where most holes can be reached in one shot."],
  ["Pull cart", "(?:pull|push) carts?", "A hand trolley for your golf bag when you walk the course."],
  ["Scramble", "scramble", "A team format where everyone plays on from the best shot each time."],
  ["Handicap", "handicaps?", "A number that shows a golfer's skill, used to even out scores."],
  ["Golf simulator", "(?:golf )?simulators?|sim bays?", "An indoor screen that tracks your shots on a virtual course.", { only: ["golf", "venue", "bowling", "arcade", "billiards"] }],
  ["FootGolf", "foot ?golf", "Kicking a soccer ball into oversized holes on a golf course.", { any: true }],
  ["Rack rate", "rack rates?", "The full, undiscounted price."],
]);

const CAMPING = rows([
  ["Full hookup", "full[- ]?hook[- ]?ups?|fhu", "The site connects your RV to power, water and sewer.", { any: true }],
  ["Partial hookup", "partial[- ]?hook[- ]?ups?|(?<!without |no |w\\/o )water (?:&|and) electric(?:ity)?|w\\/e sites?", "The site has power and water, but no sewer connection."],
  ["Hookup", "hook[- ]?ups?", "A connection at the site for an RV's power, water or sewer."],
  ["50 amp", "50[- ]?amps?", "A heavy RV power connection for big rigs running two air conditioners.", { any: true }],
  ["30 amp", "30[- ]?amps?", "A standard RV power connection, enough for one air conditioner.", { any: true }],
  ["20 amp", "20[- ]?amps?", "A household-style outlet, enough for lights and small devices."],
  ["Dry camping", "dry camping|boondocking", "Camping with no power, water or sewer at the site.", { any: true }],
  ["Primitive site", "primitive(?: camp)?(?: sites?| camping| campsites?)?", "A basic site with no hookups, often just flat ground and a fire ring."],
  ["Pull-through", "pull[- ]?(?:through|thru)s?", "An RV site you drive straight through, so there is no backing in.", { any: true }],
  ["Back-in site", "back[- ]?in(?: sites?)?", "An RV site you reverse into."],
  ["Dump station", "dump stations?|sani[- ]?dump", "A place to empty an RV's wastewater tanks.", { any: true }],
  ["Tent pad", "tent pads?", "A levelled patch of ground set aside for pitching a tent."],
  ["Walk-in site", "walk[- ]?in (?:sites?|campsites?|tent sites?)", "A tent site you carry your gear to from a nearby parking area."],
  ["Glamping", "glamping", "Camping in a furnished tent or cabin with a real bed.", { any: true }],
  ["Yurt", "yurts?", "A round, tent-like cabin with a wooden floor."],
  ["Fire ring", "fire rings?|fire pits?", "A metal ring or stone circle for a campfire."],
  ["Seasonal site", "seasonal (?:sites?|camping|campsites?)", "A site rented for the whole camping season, not by the night."],
  ["Overflow site", "overflow(?: sites?| camping)?", "Extra space used when the regular sites are full, usually with no hookups."],
  ["Shore power", "shore power", "A power connection on the dock for a boat or RV.", { any: true }],
]);

const BOAT = rows([
  ["Bareboat", "bare[- ]?boat", "You rent the boat without a captain and skipper it yourself.", { any: true }],
  ["Captained", "captained|with (?:a )?captain|captain included", "The boat comes with a licensed captain who drives it for you."],
  ["Skipper", "skippers?", "The person in charge of driving the boat."],
  ["Inshore", "inshore", "Fishing in calm bays and near the coast, usually in sight of land.", { any: true }],
  ["Nearshore", "near[- ]?shore", "Fishing a few miles off the beach, between inshore and offshore.", { any: true }],
  ["Offshore", "offshore", "Fishing far out in open ocean for bigger fish, often a longer, rougher ride.", { any: true }],
  ["Deep sea", "deep[- ]sea", "Fishing well offshore in deep open water.", { any: true }],
  ["Half day", "half[- ]day", "A shorter trip, usually about four hours."],
  ["Three-quarter day", "3\\/4[- ]day|three[- ]quarter[- ]day", "A trip of about six hours."],
  ["Full day", "full[- ]day", "A long trip, usually around eight hours."],
  ["Catch and release", "catch (?:and|&|n) release|catch-and-release", "Fish are unhooked and let go rather than kept.", { any: true }],
  ["Licence included", "licen[cs]es? included|includes? (?:a |your |fishing )?licen[cs]es?|licen[cs]e provided", "The fishing permit you would normally buy is covered in the price.", { any: true }],
  ["Fishing licence", "fishing licen[cs]es?", "A permit the state or province requires before you fish.", { any: true }],
  ["Fuel surcharge", "fuel (?:surcharge|charge|fee)s?", "An extra charge added to cover the cost of fuel.", { any: true }],
  ["Fuel not included", "plus fuel|fuel (?:is )?(?:not included|extra)|\\+ ?fuel", "You pay for the fuel you use on top of the rental price.", { any: true }],
  ["PFD", /(?<![A-Za-z])PFDs?(?![A-Za-z])/, "A life jacket.", { any: true }],
  ["USCG", /(?<![A-Za-z])USCG(?![A-Za-z])|coast guard (?:licensed|certified|inspected)/i, "The US Coast Guard, which licenses captains and inspects boats.", { any: true }],
  ["Six-pack charter", "six[- ]pack(?: charter| license| licensed)?|6[- ]pack(?: charter| license| licensed)", "A charter whose captain is licensed to carry up to six passengers."],
  ["Party boat", "party boats?|head boats?", "A large shared fishing boat where you pay for one spot per person."],
  ["Split charter", "split charters?|shared charters?", "You share the boat with other guests and split the cost."],
  ["Private charter", "private charters?", "The whole boat is booked for your group alone.", { any: true }],
  ["Tackle", "tackle", "Rods, reels, hooks and lures."],
  ["Live bait", "live bait", "Live fish or shrimp used to attract bigger fish."],
  ["Trolling", "trolling", "Fishing with lines pulled slowly behind a moving boat."],
  ["Bottom fishing", "bottom fishing", "Fishing with weighted lines dropped to the sea floor.", { any: true }],
  ["Fly fishing", "fly[- ]fishing", "Casting a light, feathered lure with a special rod, usually in rivers.", { any: true }],
  ["Wade trip", "wade (?:trips?|fishing)|wading trips?", "Fishing while standing in the water rather than from a boat.", { any: true }],
  ["Float trip", "float trips?", "Drifting downriver in a small boat to fish or sightsee.", { any: true }],
  ["Center console", "cent(?:er|re)[- ]consoles?", "An open fishing boat with the steering in the middle.", { any: true }],
  ["Pontoon", "pontoons?", "A flat, steady boat on two floats, good for relaxed groups.", { any: true, not: ["pontoon"] }],
  ["Tritoon", "tri[- ]?toons?", "A pontoon boat on three floats, a little faster and steadier.", { any: true }],
  ["Bowrider", "bow[- ]?riders?", "A speedboat with open seating in the front.", { any: true }],
  ["Deck boat", "deck boats?", "A wide boat with lots of open seating, between a pontoon and a speedboat.", { any: true }],
  ["Boat slip", "(?:wet )?slips?", "A parking space for a boat in the water at a dock.", { only: ["pontoon", "fishing", "cruise", "sailing", "jetski", "kayak", "camping"] }],
  ["Dry storage", "dry (?:storage|stack|rack)", "Keeping a boat out of the water on a rack.", { any: true }],
  ["Horsepower", "\\d{2,3} ?hp|horsepower", "How powerful the boat's engine is; more means faster.", { only: ["pontoon", "fishing", "jetski", "cruise", "kayak", "camping"] }],
  ["Liveaboard", "live[- ]?aboards?", "A trip where you sleep on the boat for several nights.", { any: true }],
  ["Skippered sail", "skippered", "A skipper sails the boat while you relax or help out.", { any: true }],
  ["ASA course", /(?<![A-Za-z])ASA ?\d{3}(?![0-9])/, "An American Sailing Association course; the number is the level.", { any: true }],
]);

const WATER = rows([
  ["Tandem parasail", "tandem parasail(?:ing)?|parasail(?:ing)? tandem|tandem (?:flight|fly|flyers?)", "Two people fly together, side by side under one parasail.", { any: true }],
  ["Triple parasail", "triple parasail(?:ing)?|triple (?:flight|fly|flyers?)", "Three people fly together under one parasail.", { any: true }],
  ["Tandem", "tandem", "Two people fly together, side by side under one parasail.", { only: ["parasail"] }],
  ["Line length", "\\d{3,4} ?(?:ft\\.?|feet|foot|') ?(?:of )?(?:line|rope|flights?|parasail|altitude)", "How much tow rope is let out, which sets how high you fly.", { only: ["parasail", "jetski", "cruise", "pontoon", "kayak", "surf"] }],
  ["Dip", "dips?|toe dip|dunk", "The boat slows so your feet touch the water before you rise again.", { only: ["parasail"] }],
  ["Dry landing", "dry (?:landing|take[- ]?off)", "You take off and land on the boat deck without getting wet.", { any: true }],
  ["SUP", /(?<![A-Za-z])SUPs?(?![A-Za-z])|stand[- ]?up paddle ?board(?:ing)?/, "A stand-up paddleboard: a large board you stand on and paddle.", { any: true }],
  ["Wetsuit", "wet ?suits?", "A snug rubber suit that keeps you warm in cool water.", { any: true }],
  ["Snorkel set", "snorkel (?:sets?|gear|equipment|packages?)|mask,? (?:snorkel|fins)", "A mask, breathing tube and fins for looking underwater from the surface.", { any: true }],
  ["Self-guided", "self[- ]guided", "You go on your own with a map or directions, no guide.", { any: true }],
  ["Guided", "guided", "A guide leads the group and shows you the way.", { only: ["kayak", "surf", "scuba", "bike", "snowmobile", "jetski", "rafting", "climbing"] }],
  ["Sit-on-top kayak", "sit[- ]on[- ]tops?", "An open kayak you sit on rather than inside, easy to climb back onto.", { any: true }],
  ["Sit-in kayak", "sit[- ]ins?(?: kayaks?)?", "A kayak you sit inside; drier, but harder to get out of.", { any: true }],
  ["Tandem kayak", "tandem (?:kayaks?|canoes?|sit[- ]on[- ]tops?)|double kayaks?", "A kayak built for two paddlers.", { any: true }],
  ["PWC", /(?<![A-Za-z])PWCs?(?![A-Za-z])|personal watercraft/, "Personal watercraft: another name for a jet ski.", { any: true }],
  ["WaveRunner", "wave ?runners?", "Yamaha's name for a jet ski.", { any: true }],
  ["Sea-Doo", "sea[- ]?doos?", "Another brand name for a jet ski.", { any: true }],
  ["Flyboard", "fly ?boards?(?:ing)?", "You stand on a board lifted into the air by jets of water.", { any: true }],
  ["Hoverboard", "hover ?boards?", "A water-jet board you ride just above the surface, like a flyboard for carving.", { only: ["jetski", "parasail"] }],
  ["Banana boat", "banana (?:boats?|rides?)", "A long inflatable seating several riders, towed behind a boat.", { any: true }],
  ["Tubing", "tub(?:e|es|ing)", "Riding a big inflatable ring, either towed by a boat or floating down a river."],
  // A roman numeral grade is a river and nothing else; a digit needs the river said out loud, because
  // "Boxing Class 4-Pack" is a card of four classes and was being explained as powerful rapids.
  ["Class II rapids", "class (?:ii(?: rapids| whitewater| water)?|2(?: rapids| whitewater| water))", "Easy rapids with small waves, fine for beginners.", { any: true }],
  ["Class III rapids", "class (?:iii(?: rapids| whitewater| water)?|3(?: rapids| whitewater| water))", "Moderate rapids with bigger waves that take some paddling.", { any: true }],
  ["Class IV rapids", "class (?:iv(?: rapids| whitewater| water)?|4(?: rapids| whitewater| water))", "Powerful rapids for fit, confident rafters.", { any: true }],
  ["Discover Scuba", "discover scuba(?: diving)?|try scuba|intro(?:ductory)? (?:to )?scuba|resort course", "A first try at scuba with an instructor, no certification needed.", { any: true }],
  ["PADI", /(?<![A-Za-z])PADI(?![A-Za-z])/, "The largest scuba training body; its card shows you are certified.", { any: true }],
  ["Open Water certification", "open water(?: diver)?(?: certification| course)?", "The first full scuba certificate, for diving to 18 m (60 ft) with a buddy.", { only: ["scuba"] }],
  ["Two-tank dive", "(?:two|2)[- ]tank(?: dives?| trips?)?", "A boat trip with two separate dives, one air tank each.", { any: true }],
  ["Refresher", "refresher(?: course| dive)?|scuba review|reactivate", "A short session to brush up if you have not dived for a while.", { only: ["scuba"] }],
  ["Certified divers", "certified divers?(?: only)?", "Only for guests who already hold a scuba certification card.", { any: true }],
  ["BCD", /(?<![A-Za-z])BCDs?(?![A-Za-z])/, "The inflatable vest divers wear to control floating and sinking.", { any: true }],
  ["Rash guard", "rash ?guards?", "A snug, quick-dry shirt that protects against sun and board rash.", { any: true }],
  ["Bodyboard", "body ?boards?|boogie ?boards?", "A short foam board you ride lying on your stomach.", { any: true }],
  ["Soft-top board", "soft[- ]?tops?", "A foam surfboard that is forgiving for beginners."],
  ["Glass-bottom boat", "glass[- ]?bottom(?: boats?)?", "A boat with windows in the floor for seeing underwater.", { any: true }],
  ["Cabana", "cabanas?", "A shaded private seating area you rent for the day.", { any: true }],
  ["Eco tour", "eco[- ]?tours?", "A guided trip focused on nature and wildlife.", { any: true }],
]);

const AIR = rows([
  ["Tandem skydive", "tandem (?:skydiv(?:e|es|ing)|jumps?|freefall)", "You jump strapped to an instructor who handles the parachute.", { any: true }],
  ["Tandem", "tandem", "You jump strapped to an instructor who handles the parachute.", { only: ["skydive"] }],
  ["AFF", /(?<![A-Za-z])AFF(?![A-Za-z])|accelerated free ?fall/, "Accelerated Freefall: the course where you learn to skydive on your own.", { any: true }],
  ["Jump altitude", "\\d{1,2},?\\d{3} ?(?:ft\\.?|feet|foot|')(?: jump| altitude| tandem| skydive)?|altitude", "How high the plane is when you jump; higher means a longer freefall.", { only: ["skydive"] }],
  ["Freefall", "free ?fall", "The part of a skydive before the parachute opens.", { only: ["skydive", "zipline", "paragliding"] }],
  ["Weight limit", "weight (?:limit|restriction|max(?:imum)?)s?|(?:max(?:imum)?|under) \\d{3} ?(?:lbs?|pounds)", "The heaviest guest they can safely fly, often including clothes.", { any: true }],
  ["Handcam", "hand ?cam(?: video)?", "A video filmed by a camera on your instructor's wrist.", { any: true }],
  ["Outside video", "outside (?:video|camera|videographer)(?: package)?", "A second skydiver jumps with you to film you from the front.", { any: true }],
  ["USPA", /(?<![A-Za-z])USPA(?![A-Za-z])/, "The US Parachute Association, which sets skydiving training standards.", { any: true }],
  ["Static line", "static[- ]line", "A first-jump method where a cord opens your parachute as you leave the plane.", { any: true }],
  ["Wind tunnel", "wind tunnel|indoor skydiv(?:e|ing)|body ?flight", "Floating on a column of air inside a vertical tunnel, no plane.", { any: true }],
  ["Tandem paragliding", "tandem paraglid(?:e|er|ing)|tandem (?:flight|flights)", "You fly strapped to a pilot under a paraglider wing.", { only: ["paragliding", "gliding"] }],
  ["Powered paragliding", "powered paraglid(?:e|er|ing)|paramotor(?:ing)?|ppg", "Paragliding with a small engine on the pilot's back.", { any: true }],
  ["Shared flight", "shared (?:flights?|balloon|basket|rides?)|standard flight", "You fly with other guests in the same basket or aircraft.", { any: true }],
  ["Private flight", "private (?:flights?|balloon|basket)", "Only your group is on board.", { any: true }],
  ["Doors-off", "doors[- ]off", "The helicopter flies with its doors removed for clearer photos.", { any: true }],
  ["Robinson R44", /(?<![A-Za-z])R44(?![0-9])/, "A four-seat helicopter, one of the most common tour models.", { any: true }],
  ["Discovery flight", "discovery flights?|intro(?:ductory)? flights?", "A first flying lesson where you take the controls with an instructor.", { any: true }],
  ["Glider", "gliders?|sailplanes?|soaring flights?", "An aircraft with no engine that is towed up and rides rising air.", { only: ["gliding", "paragliding"] }],
  ["Canopy tour", "canopy tours?", "A course of ziplines strung between trees or towers.", { any: true }],
  ["Sky ride", "sky ?rides?", "A ride along a cable high above the ground, seated or strapped in.", { only: ["zipline"] }],
]);

const CLIMBING = rows([
  ["Belay", "belay(?:ing|er)?", "Holding the rope for a climber so a fall is caught."],
  ["Belay certification", "belay (?:certification|certified|check|test|class|lesson|orientation)", "A short check that you can safely hold the rope for someone.", { any: true }],
  ["Top rope", "top[- ]?rop(?:e|ing)", "Climbing with the rope already anchored above you, the easiest way to start.", { any: true }],
  ["Lead climbing", "lead (?:climbing|class|course|certification)", "Clipping the rope into anchors as you go up; for experienced climbers.", { any: true }],
  ["Auto-belay", "auto[- ]?belays?", "A device at the top of the wall that holds the rope for you.", { any: true }],
  ["Bouldering", "boulder(?:ing)?", "Climbing short walls without ropes, over thick crash mats."],
  ["Harness", "harness(?:es)?", "The strap-on seat that clips you to the rope."],
  ["Climbing shoes", "climbing shoes|shoe rental", "Tight, grippy shoes that help you stand on small holds."],
  ["Via ferrata", "via ferrata", "A climbing route with fixed steel cables and rungs to clip onto.", { any: true }],
  ["Rappelling", "rappel(?:ling)?|abseil(?:ing)?", "Lowering yourself down a rock face on a rope.", { any: true }],
]);

const CLASSES = rows([
  ["Drop-in", "drop[- ]?ins?", "Pay for a single class, with no membership or package.", { any: true }],
  ["Class pack", "(?:class|session|visit|lesson) (?:packs?|cards?|passes)|\\d+[- ](?:class|session|visit|lesson) (?:packs?|cards?|passes?)|punch (?:cards?|passes?)", "A prepaid bundle of visits, cheaper each than paying one at a time.", { any: true }],
  ["Intro offer", "intro(?:ductory)? (?:offer|special|pass|package|month|week|deal|rate)|new (?:student|client|member) (?:special|offer|pass)", "A lower price for your first visit or first few classes.", { any: true }],
  ["Membership", "memberships?", "A monthly or yearly plan that covers regular visits."],
  ["Unlimited", "unlimited(?: classes| monthly| month| membership)?", "As many classes as you like during the plan's period."],
  ["Registration fee", "(?:registration|enrol?ment|sign[- ]?up|initiation) fees?", "A one-time charge when you first join.", { any: true }],
  ["Private lesson", "private (?:lessons?|sessions?|classes?|instruction|coaching)", "One-on-one time with an instructor.", { any: true }],
  ["Semi-private", "semi[- ]?privates?", "A small lesson shared by two or three people.", { any: true }],
  ["Open gym", "open (?:gym|mat|studio|play)", "Time to use the space on your own, with no class running."],
  ["Hot yoga", "hot yoga|heated (?:yoga|class)", "Yoga in a heated room, often around 40 °C (105 °F).", { any: true }],
  ["Vinyasa", "vinyasa", "A flowing yoga style that links each move with a breath.", { any: true }],
  ["Hatha", "hatha", "A slower yoga style that holds each pose, good for beginners.", { any: true }],
  ["Yin yoga", "yin(?: yoga)?", "A slow yoga style with long, relaxed stretches.", { only: ["yoga", "fitness", "dance", "spa"] }],
  ["Barre", "barre", "A workout of small, repeated moves holding a ballet rail.", { only: ["yoga", "fitness", "dance", "spa", "sauna"] }],
  ["Reformer", "reformer(?: pilates)?", "A Pilates class on a sliding machine with springs for resistance.", { any: true }],
  ["HIIT", /(?<![A-Za-z])HIIT(?![A-Za-z])/, "High-intensity interval training: short bursts of hard effort with rests.", { any: true }],
  ["Yoga teacher training", /(?<![A-Za-z])YTT(?![A-Za-z])|\b(?:200|300|500)[- ]?(?:hour|hr)s? (?:yoga )?(?:teacher training|ytt|certification)/i, "A course that certifies you to teach yoga; 200 hours is the standard first level.", { any: true }],
  ["BJJ", /(?<![A-Za-z])BJJ(?![A-Za-z])|brazilian jiu[- ]?jitsu/i, "Brazilian jiu-jitsu, a grappling martial art done mostly on the ground.", { any: true }],
  ["MMA", /(?<![A-Za-z])MMA(?![A-Za-z])/, "Mixed martial arts, combining striking and grappling.", { any: true }],
  ["Trial class", "trial (?:class|lesson|session)s?|free trial", "A first class to try it out before committing.", { any: true }],
  ["Wheel throwing", "wheel[- ]?throw(?:ing|n)?|pottery wheel", "Shaping clay on a spinning pottery wheel.", { any: true }],
  ["Hand building", "hand[- ]?build(?:ing)?", "Shaping clay with your hands, without a wheel.", { any: true }],
  ["Firing", "firing(?: fees?)?|kiln", "Baking finished pottery in a kiln so it hardens; pieces are ready later, not the same day.", { only: ["pottery"] }],
  ["Glazing", "glaz(?:e|ing)", "Coating pottery with a glassy colour before its final firing.", { only: ["pottery"] }],
  ["Hands-on class", "hands[- ]on", "You cook or make it yourself rather than just watching.", { only: ["cooking", "pottery", "winery", "brewery", "distillery"] }],
  ["Demonstration class", "demo(?:nstration)? (?:class|style)", "The chef cooks while you watch and taste.", { any: true }],
  ["Pickleball", "pickle ?ball", "A paddle game like tennis on a small court, easy for beginners.", { any: true }],
  ["Court time", "court (?:time|rental|booking)s?", "A booked slot on a court for your own game.", { any: true }],
  ["Ball machine", "ball machines?", "A machine that feeds tennis balls so you can practise alone.", { any: true }],
  ["Clinic", "clinics?", "A group lesson focused on one skill.", { only: ["tennis", "golf", "climbing", "swim", "ski", "surf", "horse", "fitness", "martialarts", "gymnastics"] }],
  ["Tuition", "tuition", "The fee for a term or month of classes.", { only: ["dance", "martialarts", "gymnastics", "swim", "yoga", "fitness", "pottery", "cooking", "tennis", "horse"] }],
]);

const PLAY = rows([
  ["Lane rental", "lane (?:rental|rate)s?|per lane|hourly bowling|bowling by the hour", "Your group rents a whole bowling lane by the hour, not by the game.", { any: true }],
  ["Shoe rental", "shoe rentals?|rental shoes|skate rentals?", "Shoes or skates you borrow for the visit.", { any: true }],
  ["Per game", "per game|by the game", "You pay for each game each person plays.", { only: ["bowling", "billiards", "minigolf", "lasertag", "arcade", "axe"] }],
  ["Cosmic bowling", "cosmic(?: bowling)?|glow bowling|xtreme bowling|rock ?n ?bowl", "Bowling with black lights, glowing lanes and music.", { any: true }],
  ["Duckpin", "duck ?pins?", "A bowling game with small balls and short, squat pins.", { any: true }],
  ["Candlepin", "candle ?pins?", "A New England bowling game with thin pins and small balls.", { any: true }],
  ["Bumpers", "bumpers?(?: bowling)?", "Rails that block the gutters so kids' balls stay in the lane.", { only: ["bowling", "minigolf", "arcade"] }],
  ["Open jump", "open jumps?|general jump|jump time", "Free-play time on the trampolines, not a class or a party.", { any: true }],
  ["Grip socks", "(?:grip|jump|trampoline|sky|non[- ]?slip) socks?", "Non-slip socks the park requires on the trampolines.", { any: true }],
  ["Game card", "game cards?|play cards?|power cards?|fun cards?", "A reloadable card that holds credit for arcade games.", { any: true }],
  ["Redemption games", "redemption(?: games?| tickets?| prizes?)?", "Arcade games that pay out tickets you trade for prizes.", { only: ["arcade", "bowling", "minigolf", "lasertag", "kart", "trampoline", "themepark"] }],
  ["All-day pass", "all[- ]day (?:pass|wristband)s?|unlimited (?:play|wristband)s?|wristbands?", "A pass that lets you play or ride as much as you like that day."],
  ["Arrive and drive", "arrive (?:and|&|n) drive", "Karting where you just turn up and race in the track's karts.", { any: true }],
  ["Heat", "(?:per |race |one |\\d+ )heats?|heats? race", "One timed race session on the track.", { only: ["kart", "motorsport"] }],
  ["Grand Prix", "grand prix", "A race package with practice, qualifying and a final race.", { only: ["kart", "motorsport"] }],
  ["Racing licence", "(?:racing |annual )?licen[cs]e(?: fee)?", "A one-time or yearly track sign-up fee you pay before your first race.", { only: ["kart"] }],
  ["Game master", "game ?masters?", "The staff member who watches your escape room and gives hints.", { any: true }],
  ["Private room", "private (?:room|game|booking)s?", "Only your group plays; no strangers join.", { only: ["escape", "axe", "karaoke", "rage", "lasertag"] }],
  ["Field paint", "field paint|(?:case|bag|box|pail) of paint(?:balls?)?|paint (?:bag|case|box|pail)s?", "The paintballs you buy at the field; most fields do not allow your own.", { only: ["paintball"] }],
  ["Low-impact paintball", "low[- ]impact(?: paintball)?|\\.50 cal(?:iber)?", "Smaller, softer paintballs that sting less, good for kids.", { any: true }],
  ["Gellyball", "gel+y ?ball|gel ?blaster|splat ?ball", "A paintball-style game with soft water-gel beads that burst on contact.", { any: true }],
  ["Airsoft", "airsoft", "A shooting game using light plastic pellets instead of paint.", { any: true }],
  ["Range fee", "range (?:fee|time|rental)s?|lane fees?", "The charge to use a shooting lane, not including ammunition or targets.", { only: ["range", "archery"] }],
  ["Public skate", "public skat(?:e|ing)|open skat(?:e|ing)|family skate", "Open skating time for anyone, not lessons or hockey.", { any: true }],
  ["Stick and puck", "stick (?:and|&|n) puck", "Open ice time for practising hockey skills, no games.", { any: true }],
  ["VR", /(?<![A-Za-z0-9])VR(?![A-Za-z0-9])|virtual reality/i, "Virtual reality: a headset puts you inside the game.", { any: true }],
  ["Lift ticket", "lift tickets?|lift pass(?:es)?", "The pass that lets you ride the ski lifts for the day.", { only: ["ski", "snowmobile", "bike"] }],
  ["Terrain park", "terrain parks?", "An area of jumps and rails for skiers and snowboarders.", { any: true }],
]);

const SPA = rows([
  ["Add-on", "add[- ]?ons?", "An extra you can attach to a treatment for an additional charge.", { only: ["spa", "sauna", "yoga"] }],
  ["Enhancement", "enhancements?", "A small upgrade added to a treatment, like hot stones or scented oil.", { only: ["spa", "sauna"] }],
  ["Deep tissue", "deep[- ]tissue", "Firm massage that works on the deeper layers of muscle.", { any: true }],
  ["Swedish massage", "swedish[- ]massage", "A gentle, relaxing massage with long strokes.", { any: true }],
  ["Hot stone", "hot[- ]stones?", "Massage using warmed smooth stones on the muscles.", { any: true }],
  ["Cupping", "cupping", "Suction cups placed on the skin to loosen tight muscles.", { any: true }],
  ["Reflexology", "reflexology", "Pressure on points of the feet or hands, meant to relax the whole body.", { any: true }],
  ["HydraFacial", "hydra ?facials?", "A facial that cleans and hydrates the skin with a gentle suction tool.", { any: true }],
  ["Microdermabrasion", "microderm(?:abrasion)?", "A facial that gently buffs away dead skin.", { any: true }],
  ["Dermaplaning", "dermaplan(?:e|ing)", "A facial where fine hair and dead skin are shaved away with a blade.", { any: true }],
  ["Infrared sauna", "infrared(?: sauna)?", "A sauna warmed by heat lamps, gentler than a traditional one.", { any: true }],
  ["Cold plunge", "cold plunges?|ice bath|plunge pool", "A short dip in very cold water, often after a sauna.", { any: true }],
  ["Contrast therapy", "contrast therapy|hot (?:and|&) cold", "Switching between a hot sauna and a cold plunge.", { any: true }],
  ["Float therapy", "float(?:ation)? (?:therapy|tank|pod|session)s?|sensory deprivation", "Floating in warm salt water in a quiet, dark pod.", { any: true }],
  ["Couples massage", "couples?'? (?:massage|treatment|package)s?", "Two people treated side by side in the same room.", { any: true }],
  ["Body wrap", "body wraps?", "A treatment where you are wrapped warm after a mask or lotion is applied.", { any: true }],
  ["Aromatherapy", "aromatherapy", "Scented plant oils added to a treatment.", { any: true }],
  ["CBD", /(?<![A-Za-z])CBD(?![A-Za-z])/, "An oil from hemp added to massage lotion; it does not make you high.", { any: true }],
  ["Esthetician", "a?esthetician", "A licensed skin-care specialist who does facials.", { any: true }],
  ["Day pass (spa)", "spa (?:day )?pass|thermal (?:circuit|experience)|bathhouse (?:pass|entry)", "Entry to the pools, saunas and lounges for the day, without a treatment.", { any: true }],
]);

const RIDE = rows([
  ["E-bike", "e-?bikes?|electric bikes?", "A bicycle with a small motor that helps as you pedal.", { any: true }],
  ["Segway", "segways?", "A two-wheeled standing scooter that balances itself.", { any: true }],
  ["UTV", /(?<![A-Za-z])UTVs?(?![A-Za-z])|side[- ]by[- ]sides?/i, "An off-road vehicle with side-by-side seats and a steering wheel.", { any: true }],
  ["ATV", /(?<![A-Za-z])ATVs?(?![A-Za-z])|quad bikes?/i, "A four-wheeled off-road quad you ride like a motorbike.", { any: true }],
  ["Trail ride", "trail rides?", "A guided horseback ride along trails, mostly at walking pace.", { any: true }],
  ["Western saddle", "western(?: saddle| riding)", "A deep, roomy saddle with a horn to hold, easier for beginners.", { only: ["horse"] }],
  ["English riding", "english(?: saddle| riding| lessons?)", "Riding in a small, flat saddle, the style used in jumping and dressage.", { only: ["horse"] }],
  ["Hand-led ride", "hand[- ]led|lead[- ]line", "A staff member walks beside the horse holding the lead rope.", { any: true }],
  ["Dog sledding", "dog ?sled(?:ding)?|mushing", "Riding a sled pulled by a team of dogs.", { any: true }],
]);

const GENERAL = rows([
  ["Deposit", "deposits?", "Part of the price paid up front to hold your booking."],
  ["Non-refundable", "non[- ]?refundable|no refunds?", "You do not get this money back if you cancel."],
  ["Gratuity", "gratuit(?:y|ies)|tips? (?:not )?included|crew tip", "A tip for the crew or staff; check whether it is already added."],
  ["Service fee", "service (?:fee|charge)s?|booking fees?|convenience fees?", "An extra charge added on top of the listed price."],
  ["Surcharge", "surcharges?", "An extra charge on top of the listed price."],
  ["BYOB", /(?<![A-Za-z])BYOB?(?![A-Za-z])|bring your own (?:beverages?|bottle|booze|drinks?)/i, "Bring your own drinks; alcohol is not sold, but you may bring some."],
  ["Waiver", "waivers?|release forms?", "A liability form every guest signs before taking part."],
  ["Rain check", "rain ?checks?", "If weather cancels your time, you get a credit to come back another day."],
  ["Minimum party size", "minimum (?:of )?\\d+ (?:people|persons|guests|players|riders|passengers)|\\d+ (?:people|person|guest|player|rider|passenger) minimum|min(?:imum)?\\.? (?:party|group) (?:size|of \\d+)", "The fewest people the booking must include."],
  ["Private", "private (?:tours?|trips?|cruises?|sails?|rides?|groups?|boats?|excursions?|experiences?|outings?)", "Only your group, with no other guests."],
  ["Shared", "shared (?:tours?|trips?|cruises?|sails?|rides?|boats?|experiences?)|public (?:tours?|trips?|cruises?|sails?|charters?|rides?)|join-?in|seat-?in-?coach", "You join other guests on the same trip."],
  ["General admission", "general admission", "Standard entry, without reserved seats or extras."],
  ["VIP", /(?<![A-Za-z])VIP(?![A-Za-z])/, "A premium option with extras, such as better seats or skipping the line."],
  ["Walk-in", "walk[- ]?ins?(?: welcome| only)?|walk[- ]?ups?", "Turn up without booking, if there is space."],
  ["First come, first served", "first[- ]come,? first[- ]serve?d?", "No reservations; spots go to whoever arrives first."],
  ["Blackout dates", "blackout(?: dates?| days?)?", "Days when a pass or deal cannot be used."],
  ["Off-peak", "off[- ]peak|non[- ]peak", "Quieter times with lower prices."],
  ["Peak", "peak (?:times?|season|hours?|rates?|pricing|days?)", "The busiest times, often priced higher."],
  ["Concession", "concessions?", "A reduced price for seniors, students or children."],
  ["Season pass", "season(?:al)? pass(?:es)?", "Unlimited visits for the whole season for one price."],
  ["Day pass", "day pass(?:es)?|day use|day[- ]use pass", "Entry for one day, coming and going as you like."],
  ["Non-member rate", "non[- ]?members?(?: rates?| prices?| pricing)?|guest fees?", "The price for guests without a membership."],
  ["Member rate", "members?(?: rates?| prices?| pricing| only)", "A lower price for people who hold a membership."],
  ["Flat rate", "flat (?:rate|fee)s?", "One fixed price, however long you stay or however many come."],
  ["Hotel pickup", "hotel (?:pick[- ]?ups?|transfers?)|pick[- ]?up (?:and|&) drop[- ]?off|round[- ]trip transport(?:ation)?", "Transport from your hotel to the start and back."],
  ["All-inclusive", "all[- ]inclusive", "Most extras are in the price; check what the listing includes."],
  ["ADA accessible", /(?<![A-Za-z])ADA(?![A-Za-z])(?: accessible| compliant)?|wheelchair accessible/, "Suitable for guests using a wheelchair or with limited mobility."],
  ["Minimum hours", "(?:\\d|two|three|four) ?(?:hour|hr)s? minimum|minimum (?:of )?(?:\\d|two|three|four) ?(?:hour|hr)s?", "The shortest time you can book."],
  ["Prepaid", "pre[- ]?paid", "Paid in full when you book, rather than on the day."],
]);

const GROUPS: Record<string, Entry[]> = { golf: GOLF, camping: CAMPING, boat: BOAT, water: WATER, air: AIR, climbing: CLIMBING, classes: CLASSES, play: PLAY, spa: SPA, ride: RIDE };

/** Which groups a listing's kind reads first. Unknown kinds read the general list and the `any` terms only. */
const KIND_GROUPS: Record<string, string[]> = {
  golf: ["golf"], minigolf: ["play"], discgolf: ["play", "golf"],
  camping: ["camping", "boat"],
  fishing: ["boat", "water"], pontoon: ["boat", "water"], cruise: ["boat", "water"], sailing: ["boat", "water"],
  jetski: ["water", "boat"], parasail: ["water", "boat"], kayak: ["water", "boat"], surf: ["water"], scuba: ["water", "boat"], rafting: ["water"], swim: ["water", "classes"], waterpark: ["water", "play"],
  skydive: ["air"], balloon: ["air"], heli: ["air"], paragliding: ["air"], gliding: ["air"], zipline: ["air", "climbing"],
  climbing: ["climbing", "classes"],
  yoga: ["classes", "spa"], dance: ["classes"], fitness: ["classes"], martialarts: ["classes"], gymnastics: ["classes"], pottery: ["classes"], cooking: ["classes"], tennis: ["classes"],
  bowling: ["play"], arcade: ["play"], trampoline: ["play"], lasertag: ["play"], kart: ["play"], escape: ["play"], axe: ["play"], paintball: ["play"], billiards: ["play"], karaoke: ["play"], range: ["play"], archery: ["play"], icerink: ["play"], rage: ["play"], themepark: ["play", "water"], motorsport: ["play", "ride"], ski: ["play", "classes"],
  spa: ["spa"], sauna: ["spa"],
  tour: ["ride", "water", "boat"], bike: ["ride"], horse: ["ride", "classes"], snowmobile: ["ride"],
  venue: ["play"], brewery: ["classes"], winery: ["classes"], distillery: ["classes"],
};

/** Every entry, for tests and counts. */
export function glossarySize(): number {
  return Object.values(GROUPS).reduce((n, g) => n + g.length, 0) + GENERAL.length;
}

/**
 * The jargon in a service name or variant label, explained. Kind-specific and longer matches win ("full hookup" over
 * "hookup", "tandem skydive" over "tandem"); a word is never explained twice, and overlapping matches are skipped.
 * At most `max` (two by default), so a menu never turns into a dictionary.
 */
export function explainTerms(text: string, kind: string, max = 2): Explained[] {
  if (!text || !text.trim()) return [];
  const own = (KIND_GROUPS[kind] || []).flatMap((g) => GROUPS[g] || []);
  const ownSet = new Set(own);
  const others = Object.values(GROUPS).flat().filter((e) => !ownSet.has(e));
  type Hit = { e: Entry; start: number; end: number; rank: number };
  const hits: Hit[] = [];
  const consider = (e: Entry, rank: number) => {
    if (e.only && !e.only.includes(kind)) return;
    if (e.not && e.not.includes(kind)) return;
    const m = e.re.exec(text);
    if (!m || !m[0].trim()) return;
    hits.push({ e, start: m.index, end: m.index + m[0].length, rank });
  };
  for (const e of own) consider(e, 2);
  for (const e of others) if (e.any || e.only?.includes(kind)) consider(e, 1);
  for (const e of GENERAL) consider(e, 0);
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || b.rank - a.rank || a.start - b.start);
  const out: Explained[] = [];
  const taken: [number, number][] = [];
  for (const h of hits) {
    if (out.length >= max) break;
    if (taken.some(([s, e]) => h.start < e && s < h.end)) continue;
    if (out.some((o) => o.term === h.e.term || o.meaning === h.e.meaning)) continue;
    // The text is nothing but a restatement of the meaning's own subject ("Private charter" under "Private charter" is fine;
    // a bare "Guided" label is not worth a sentence when it is the whole label).
    taken.push([h.start, h.end]);
    out.push({ term: h.e.term, meaning: h.e.meaning });
  }
  return out;
}
