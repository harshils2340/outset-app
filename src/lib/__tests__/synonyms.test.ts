import assert from "node:assert/strict";
import test from "node:test";
import { ART_LABEL } from "../../data/art";
import { ART_ALIASES } from "../../data/synonyms";
import type { ArtKind } from "../../data/types";
import { describeQuery, metroInQuery, parseIntent } from "../search";

/**
 * What a guest types into the What box, the way they would type it into Google, and the kind of activity
 * it has to land on. Every kind in the taxonomy gets at least three phrasings: singular and plural, with
 * "class", "lesson", "rental", "tour" or "near me" on the end, and the spellings people get wrong.
 * A phrase that resolves to nothing is a dead end, so these run against the same parse the feed uses.
 */
const PHRASES: Record<ArtKind, string[]> = {
  skydive: ["skydiving", "skydiving near me", "tandem skydive", "sky diving", "indoor skydiving", "parachuting"],
  heli: ["helicopter tour", "helicopter rides", "heli tour near me", "scenic flight", "seaplane tour"],
  balloon: ["hot air balloon", "hot air balloon ride", "balloon rides near me", "ballooning"],
  kart: ["go karts", "go karting", "go cart", "karting near me", "indoor go karts", "kart racing"],
  escape: ["escape room", "escape rooms near me", "escape games", "puzzle room", "excape room"],
  axe: ["axe throwing", "ax throwing", "axe throwing near me", "hatchet throwing", "throwing axes"],
  paintball: ["paintball", "paint ball", "paintballing near me", "airsoft", "gel blaster"],
  horse: ["horseback riding", "horse riding near me", "trail rides", "riding lessons", "pony rides", "horses"],
  jetski: ["jet ski rental", "jet skis", "jetski rentals near me", "jet skiing", "waverunner rental", "jetsky"],
  pontoon: ["boat rental", "pontoon rental", "pontoon boat rentals near me", "rent a boat", "party boat"],
  fishing: ["fishing charter", "fishing charters near me", "deep sea fishing", "fishing trips", "fly fishing", "charter fishing"],
  parasail: ["parasailing", "parasail", "parasailing near me", "para sailing", "parasailing ride"],
  cruise: ["sunset cruise", "boat tour", "boat tours near me", "dinner cruise", "whale watching", "dolphin tour", "airboat ride", "sunset sail"],
  kayak: ["kayak", "kayaking", "kayak rentals near me", "kayak tour", "canoe rental", "kayaks", "paddling"],
  paddleboard: ["paddleboard", "paddle board rental", "paddleboarding near me", "sup rental", "stand up paddleboard", "sup"],
  bowling: ["bowling", "bowling alley", "bowling alleys near me", "bowling lanes", "cosmic bowling"],
  minigolf: ["mini golf", "minigolf", "mini golf near me", "putt putt", "miniature golf", "putt-putt"],
  arcade: ["arcade", "arcades near me", "arcade bar", "pinball", "vr arcade", "family fun center"],
  trampoline: ["trampoline park", "trampoline parks near me", "jump park", "trampolines", "bounce park"],
  lasertag: ["laser tag", "lasertag", "laser tag near me", "lazer tag", "laser tag arena"],
  icerink: ["ice skating", "ice rink", "ice skating near me", "skating rink", "roller skating", "hockey rink"],
  waterpark: ["water park", "waterpark", "water parks near me", "water slides", "splash pad", "lazy river"],
  themepark: ["theme park", "amusement park", "theme parks near me", "roller coasters", "amusement rides"],
  zoo: ["zoo", "zoos near me", "petting zoo", "wildlife park", "safari park", "animal sanctuary"],
  aquarium: ["aquarium", "aquariums near me", "sea life", "touch tank", "swim with dolphins"],
  karaoke: ["karaoke", "karaoke bar", "karaoke near me", "karaoke rooms", "private karaoke", "ktv"],
  climbing: ["rock climbing", "climbing gym", "bouldering near me", "indoor climbing", "climbing wall", "bouldering gym"],
  range: ["shooting range", "gun range", "gun ranges near me", "skeet shooting", "sporting clays", "indoor shooting range"],
  archery: ["archery", "archery range", "archery lessons near me", "bow and arrow", "archery tag"],
  golf: ["golf", "golf course", "golf courses near me", "tee times", "golf lessons", "public golf", "9 holes"],
  zipline: ["zipline", "zip line", "ziplining near me", "zip lining", "ropes course", "canopy tour", "aerial adventure park"],
  ski: ["skiing", "ski resort", "ski lessons near me", "snowboarding", "snowboard lessons", "snow tubing", "ski rental"],
  bike: ["bike rental", "bike rentals near me", "e bike rental", "bicycle rental", "mountain biking", "bike tour", "scooter rental"],
  snowmobile: ["snowmobile", "snowmobiling", "snowmobile rentals near me", "snowmobile tour", "dog sledding", "sleigh ride"],
  rafting: ["rafting", "white water rafting", "whitewater rafting near me", "river tubing", "float trip", "raft trip"],
  scuba: ["scuba diving", "scuba lessons", "scuba certification near me", "snorkeling", "snorkel tour", "snorkelling", "dive shop"],
  surf: ["surfing", "surf lessons", "surf lessons near me", "learn to surf", "wakeboarding", "surfboard rental", "kitesurfing"],
  paragliding: ["paragliding", "paraglide", "tandem paragliding near me", "hang gliding", "paramotor"],
  gliding: ["glider ride", "gliding", "glider rides near me", "sailplane", "soaring flight"],
  brewery: ["brewery", "breweries near me", "brewery tour", "craft beer", "taproom", "beer tasting", "cidery"],
  winery: ["wine tasting", "winery", "wineries near me", "vineyard tour", "wine tours", "tasting room"],
  distillery: ["distillery", "distillery tour", "distilleries near me", "whiskey tasting", "bourbon tour", "cocktail class", "mixology class"],
  cooking: ["cooking classes", "cooking class", "cooking lessons near me", "learn to cook", "baking class", "sushi making", "culinary class", "pasta making class"],
  spa: ["spa", "massage", "day spa near me", "couples massage", "facials", "spa day", "float tank", "hot tub"],
  yoga: ["yoga", "yoga classes", "yoga studio near me", "hot yoga", "pilates", "meditation class", "sound bath"],
  dance: ["dance classes", "dance lessons", "salsa lessons near me", "ballroom dancing", "hip hop dance", "ballet class", "zumba"],
  tour: ["walking tour", "food tour", "ghost tours near me", "city tour", "segway tour", "pub crawl", "guided hike", "scavenger hunt"],
  rage: ["rage room", "rage rooms near me", "smash room", "anger room", "break stuff"],
  theatre: ["theatre", "theater", "comedy show", "comedy clubs near me", "live music", "concerts", "musicals", "murder mystery dinner", "movie theater"],
  museum: ["museum", "museums near me", "art gallery", "science museum", "children's museum", "planetarium", "history museum"],
  garden: ["botanical garden", "gardens near me", "arboretum", "pumpkin patch", "apple picking", "lavender farm", "corn maze"],
  camping: ["camping", "campground", "campgrounds near me", "glamping", "cabin rentals", "rv park", "yurt"],
  tennis: ["tennis", "tennis courts", "tennis lessons near me", "pickleball", "pickleball courts", "racquetball", "padel"],
  swim: ["swimming pool", "swim lessons", "swimming lessons near me", "learn to swim", "public pool", "lap swim", "water aerobics"],
  martialarts: ["martial arts", "boxing gym", "jiu jitsu near me", "karate classes", "muay thai", "kickboxing class", "taekwondo", "self defense class"],
  gymnastics: ["gymnastics", "gymnastics classes", "tumbling near me", "cheer gym", "parkour", "ninja warrior gym", "trapeze class"],
  fitness: ["gym", "fitness classes", "crossfit near me", "spin class", "bootcamp", "personal trainer", "barre class", "hiit class"],
  venue: ["event venue", "party venues near me", "wedding venue", "banquet hall", "party room", "kids birthday party", "rent a hall"],
  sailing: ["sailing lessons", "learn to sail", "sailboat rental near me", "yacht charter", "sailing school", "catamaran charter"],
  discgolf: ["disc golf", "frisbee golf", "disc golf courses near me", "topgolf", "golf simulator", "driving range", "indoor golf"],
  billiards: ["pool hall", "billiards", "pool halls near me", "darts", "ping pong", "shuffleboard", "board game cafe", "trivia night"],
  motorsport: ["atv rental", "atv tours near me", "dirt bike", "motocross track", "utv rental", "off road tour", "race car driving", "drift experience", "dune buggy"],
  sauna: ["sauna", "saunas near me", "cold plunge", "bathhouse", "infrared sauna", "korean spa", "ice bath", "steam room"],
  pottery: ["pottery class", "pottery classes near me", "ceramics class", "paint and sip", "art class", "candle making", "glass blowing", "woodworking class", "sip and paint"],
};

const kinds = Object.keys(ART_ALIASES) as ArtKind[];

test("every kind in the taxonomy has a label and at least three ways to type it", () => {
  for (const art of kinds) {
    assert.ok(ART_LABEL[art], `${art} has no label`);
    assert.ok(ART_ALIASES[art].length >= 3, `${art} has fewer than three aliases`);
    assert.ok((PHRASES[art] || []).length >= 3, `${art} has fewer than three phrasings under test`);
  }
});

test("aliases are lowercase ASCII with no duplicates inside one kind", () => {
  for (const art of kinds) {
    const seen = new Set<string>();
    for (const w of ART_ALIASES[art]) {
      assert.equal(w, w.toLowerCase().trim(), `${art}: "${w}" is not lowercase and trimmed`);
      assert.ok(!/[^\x00-\x7f]/.test(w), `${art}: "${w}" is not ASCII`);
      assert.ok(!seen.has(w), `${art}: "${w}" is listed twice`);
      seen.add(w);
    }
  }
});

test("each phrasing a guest would type names its kind outright", () => {
  for (const art of kinds) {
    for (const q of PHRASES[art]) {
      const d = describeQuery(q);
      assert.ok(d.arts.includes(art), `"${q}" resolved to [${d.arts.join(", ")}], not ${art}`);
      // The words spent naming the activity are the whole query once "near me" and "class" are set aside, so the
      // What box can treat the query as that kind rather than as a business name.
      assert.ok(d.onlyKind, `"${q}" reads as a business name rather than the ${art} kind`);
    }
  }
});

test("the canonical phrase of every kind survives a plural, a place and 'near me'", () => {
  for (const art of kinds) {
    const canon = ART_ALIASES[art][0];
    for (const q of [canon, canon + " near me", "best " + canon + " in tampa", canon + " tampa"]) {
      const d = describeQuery(q);
      assert.ok(d.arts.includes(art), `"${q}" resolved to [${d.arts.join(", ")}], not ${art}`);
    }
    assert.equal(metroInQuery("best " + canon + " in tampa")?.metro.id, "tampa", `"${canon}" hid the city`);
  }
});

test("a longer phrase of another kind owns its words", () => {
  const only = (q: string, arts: ArtKind[]) => assert.deepEqual(describeQuery(q).arts, arts, q);
  only("jet ski rental", ["jetski"]);
  only("pool hall", ["billiards"]);
  only("climbing gym", ["climbing"]);
  only("boxing gym", ["martialarts"]);
  only("mini golf", ["minigolf"]);
  only("disc golf", ["discgolf"]);
  only("golf simulator", ["discgolf"]);
  only("swim with dolphins", ["aquarium"]);
  only("beer garden", ["brewery"]);
  only("snow tubing", ["ski"]);
  only("water skiing", ["surf"]);
  only("bike riding", ["bike"]);
  only("wine tour", ["winery"]);
  only("brewery tour", ["brewery"]);
  only("kayak tour", ["kayak"]);
  only("helicopter tour", ["heli"]);
  only("yacht charter", ["sailing"]);
  only("dive charter", ["scuba"]);
  only("ski boat rental", ["pontoon"]);
});

test("a typo or a half-typed word still reaches the kind, without filtering to it", () => {
  for (const [q, art] of [["kyak", "kayak"], ["skydiv", "skydive"], ["jetsky", "jetski"], ["karoke", "karaoke"], ["potery class", "pottery"], ["snorkling", "scuba"]] as [string, ArtKind][]) {
    const d = describeQuery(q);
    assert.ok(d.kinds.includes(art), `"${q}" reached [${d.kinds.join(", ")}], not ${art}`);
  }
});

test("a word inside a city's name is not an activity", () => {
  // "beach" is the water occasion and "ski" the winter one; neither is meant inside a city's name.
  assert.deepEqual(describeQuery("escape room virginia beach").arts, ["escape"]);
  assert.equal(parseIntent("escape room virginia beach").label, null);
  assert.deepEqual(describeQuery("axe throwing myrtle beach").arts, ["axe"]);
});

test("broad wants resolve to a set of kinds, or to the whole catalog, never to nothing", () => {
  const want = (q: string, label: string, some: ArtKind[] = []) => {
    const i = parseIntent(q);
    assert.equal(i.label, label, `"${q}" read as ${i.label}`);
    for (const a of some) assert.ok(i.arts.includes(a), `"${q}" does not offer ${a}`);
    assert.ok(describeQuery(q).onlyIntent, `"${q}" left words over to search as text`);
  };
  want("things to do", "Things to do");
  want("things to do near me", "Things to do");
  want("what to do this weekend", "Things to do");
  want("date night ideas", "Date ideas", ["winery", "cooking", "spa"]);
  want("date night", "Date ideas", ["theatre"]);
  want("kids activities", "Family friendly", ["zoo", "aquarium", "trampoline"]);
  want("things to do with kids", "Family friendly", ["museum"]);
  want("family fun", "Family friendly", ["bowling", "minigolf"]);
  want("team building", "Team outings", ["escape", "axe", "cooking"]);
  want("team building activities", "Team outings", ["kart"]);
  want("corporate outing", "Team outings", ["brewery"]);
  want("bachelorette", "Bachelor and bachelorette", ["pontoon", "winery", "spa"]);
  want("bachelorette party ideas", "Bachelor and bachelorette", ["karaoke"]);
  want("bachelor party", "Bachelor and bachelorette", ["kart", "range"]);
  want("birthday ideas", "Birthday ideas", ["escape", "bowling"]);
  want("rainy day", "Rainy day", ["museum", "arcade"]);
  want("outdoor activities", "Outdoors", ["kayak", "zipline", "golf"]);
  want("water sports", "On the water", ["jetski", "paddleboard"]);
  want("adrenaline", "Adrenaline", ["skydive", "motorsport"]);
  want("something relaxing", "Calm and scenic", ["spa", "kayak"]);
  want("classes", "Classes and lessons", ["cooking", "pottery", "dance"]);
  want("lessons near me", "Classes and lessons", ["swim", "surf"]);
  want("culture", "Culture", ["museum", "theatre"]);
  want("wellness", "Unwind", ["spa", "sauna", "yoga"]);
  assert.ok(parseIntent("kids activities").kids, "kids did not set the age filter");
  assert.ok(parseIntent("team building").group, "team building did not ask for group listings");
});

test("a broad want next to a named kind keeps the kind", () => {
  const d = describeQuery("cooking class date night");
  assert.deepEqual(d.arts, ["cooking"]);
  assert.equal(d.intent.label, "Date ideas");
  assert.deepEqual(describeQuery("kids swim lessons").arts, ["swim"]);
  assert.deepEqual(describeQuery("learn to cook").arts, ["cooking"]);
  assert.deepEqual(describeQuery("learn to sail").arts, ["sailing"]);
  assert.deepEqual(describeQuery("learn to surf").arts, ["surf"]);
});

test("a city typed into What carries its preposition with it, so What keeps only the activity", () => {
  const place = (q: string) => metroInQuery(q);
  assert.deepEqual(place("cooking classes in tampa")?.words, ["in", "tampa"]);
  assert.deepEqual(place("escape room near miami")?.words, ["near", "miami"]);
  assert.deepEqual(place("things to do around orlando")?.words, ["around", "orlando"]);
  assert.deepEqual(place("axe throwing close to denver")?.words, ["close", "to", "denver"]);
  assert.deepEqual(place("walking tour in new york city")?.words, ["in", "new", "york", "city"]);
  assert.deepEqual(place("tampa kayak")?.words, ["tampa"]);
  assert.deepEqual(place("kayak tampa bay")?.words, ["tampa", "bay"]);
  assert.equal(place("cooking classes near me"), null);
  // The activity is still read off the rest of the query.
  assert.deepEqual(describeQuery("cooking classes in tampa").arts, ["cooking"]);
  assert.deepEqual(describeQuery("escape room near miami").arts, ["escape"]);
});
