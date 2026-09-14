/**
 * Check for plain services, jargon explanations and consolidated deals (src/sync/plainServices.ts, glossary.ts,
 * dealText.ts). No network, no database, no writes.
 *
 *   npx tsx scripts/_plain-test.mts            fixed cases, then a 300-listing sample of public/o
 *   npx tsx scripts/_plain-test.mts --quiet    fixed cases only, failures only
 *
 * Part 1 runs every real example from the brief and more across kinds, printing before and after, and fails on any
 * mismatch. Part 2 reads 300 random published detail files, reruns the published services and promos through the
 * new code, prints 40 services and every deal that changed, and checks that nothing was invented: every number and
 * word in an output must come from its input, allowing only the plain words the expansions introduce.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { plainLabel, plainName, plainServices, STANDARD, type RawService } from "../src/sync/plainServices.ts";
import { explainTerms, glossarySize } from "../src/sync/glossary.ts";
import { consolidateDeals, daysOf, type RawPromo } from "../src/sync/dealText.ts";

const quiet = process.argv.includes("--quiet");
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, before: unknown, after: unknown, want?: unknown) => {
  if (ok) pass++;
  else fail++;
  if (!ok || !quiet) console.log((ok ? "  ok   " : "  FAIL ") + name.padEnd(12) + " " + JSON.stringify(before) + "  ->  " + JSON.stringify(after) + (ok ? "" : "   wanted " + JSON.stringify(want)));
};

/* ---------- 1. labels ---------- */

console.log("\n1. Variant labels (raw -> plain). null = an event timetable, dropped; \"\" = nothing usable, shown as Standard\n");
type L = [raw: string, service: string, kind: string, price: number | null, want: string | null];
const LABELS: L[] = [
  // The brief's real examples.
  ["Tent Site w/o water & electric =", "Campsite", "camping", 40, "Tent site without water & electric"],
  ["Second Tent (incl. 2 adults)", "Tent Sites", "camping", 25, "Second tent (includes 2 adults)"],
  ["6 × 1-Hour Sessions:", "Tennis Court Time", "tennis", 408, "6 one-hour sessions"],
  ["12 × 1-Hour Sessions:", "Tennis Court Time", "tennis", 780, "12 one-hour sessions"],
  ["10×10", "Rental", "venue", 100, "10 × 10 ft"],
  ["10×20", "Rental", "venue", 150, "10 × 20 ft"],
  ["Castle Bounce House 10×10", "Bounce House", "venue", 100, "Castle 10 × 10 ft"],
  ["bounce house 10×10 bounce house", "Bounce House", "venue", 100, "10 × 10 ft"],
  ["Bounce House Combo 2 in 1-13×71", "Water Slides", "venue", 500, "Bounce house combo 2-in-1, 13 × 71 ft"],
  ["NO SURCHARGE", "Fishing Derbies", "camping", 10, "No surcharge"],
  ["3-3.5 hours total tour time from check-in, 4-4.5 hours with ", "Hot Air Balloon Ride", "balloon", null, "3 to 3.5 hours total tour time from check-in"],
  ["May 8, 2026, 9 a.m. check-in, 10:30 a.m. shotgun start, ends", "Fore the Kids Charity Golf Tournament", "balloon", 750, null],
  // Abbreviations.
  ["Full Hook-Up w/ 50 amp", "RV Sites", "camping", 55, "Full hookup with 50 amp"],
  ["2 hr pp", "Kayak Tour", "kayak", 45, "2 hours per person"],
  ["Adult (12+yrs): $15", "Hours, Fees, Tours", "museum", 15, "Adult (12+ years)"],
  ["Greens fee excl. cart", "18 Holes", "golf", 60, "Greens fee not including cart"],
  ["4 hrs", "Pontoon Rental", "pontoon", 300, "4 hours"],
  ["90 mins", "Deep Tissue Massage", "spa", 140, "90 minutes"],
  ["Daytime (M-F) Curling Only", "Curling", "icerink", 530, "Daytime (Monday to Friday) Curling Only"],
  ["approx. 2 hours", "Dolphin Cruise", "cruise", 40, "About 2 hours"],
  // Numbers and lengths.
  ["1.5 hour", "Sunset Paddle", "kayak", 55, "1.5 hours"],
  ["1 hours", "Jet Ski", "jetski", 99, "1 hour"],
  ["2 Hours", "Jet Ski", "jetski", 180, "2 hours"],
  ["2 hr - 6 hr From 475 US dollars", "Sail Now!", "cruise", 475, "2 to 6 hours"],
  ["6 hr 795 US dollars", "Book A Charter", "fishing", 795, "6 hours"],
  ["5-day = $235", "School Year Day Camps", "museum", 235, "5 days"],
  ["20 minute plane ride plus freefall", "Tandem Skydive", "skydive", 235, "20-minute plane ride plus freefall"],
  ["4 x 90 min massages", "Massage Package", "spa", 400, "4 massages, 90 minutes each"],
  ["4x4 Jeep", "Tours", "tour", null, "4x4 Jeep"],
  ["10×20 Enclosed", "Wildlife tour", "camping", 155, "10 × 20 enclosed"],
  ["145′ x 56′ practice arena with seating for 30 spectators", "Small Ice Arena", "icerink", null, "145 × 56 ft practice arena with seating for 30 spectators"],
  // Repeated names, echoed prices, trailing junk and dangling words.
  ["Tennis Court Time", "Tennis Court Time", "tennis", 35, ""],
  ["Adult Admission", "Admission", "museum", 20, "Adult"],
  ["Monthly RV Full Hook Up is $600", "Shady Grove Campground", "camping", 600, "Monthly RV full hookup"],
  ["Bunkhouse Wombat (", "Pole Dance Parties", "fitness", 585, "Bunkhouse Wombat"],
  ["10-Day Pass (", "Package", "martialarts", 69, "10-day pass"],
  ["Seniors (65+)*", "All Exhibitions", "museum", 18, "Seniors (65+)"],
  ["Kids (under 12", "Ferry", "cruise", 10, "Kids (under 12)"],
  ["👤 Up to 6 adults", "View Cabins", "camping", 10, "Up to 6 adults"],
  ["Tickets are", "Tickets", "museum", null, ""],
  ["All rentals require a", "Full Rental", "museum", 300, ""],
  ["Kayaks can be purchased for", "Poconos Kayaking", "rafting", 400, ""],
  ["Full payment of session plus", "Tasting", "venue", 150, ""],
  ["The ticket price is", "Smokehouse Tasting", "museum", 60, ""],
  ["3 classes for", "Fitness class", "fitness", 45, "3 classes"],
  ["2 hour minimum", "Bartender Service", "brewery", 200, "2-hour minimum"],
  ["The Tempest: The Isle is Full of Noises", "Summer Camps", "theatre", 300, "The Tempest: The Isle is Full of Noises"],
  ["Ages 6 and up", "Climbing", "climbing", 25, "Ages 6 and up"],
  // Cut mid-sentence, and not labels at all.
  ["from February to April. Membership is", "Admission", "museum", 500, ""],
  ["Loading days... 1 hr 10 Canadian dollars CA", "Birthday Party", "camping", 10, ""],
  ["Approximately 45 minutes flight; total experience about 4 ho", "Sunrise Balloon Ride", "balloon", 199, "Approximately 45-minute flight"],
  ["8 hours groundschool, 5 hours flight training, plus skill te", "EASA Type Rating", "heli", 2680, "8 hours groundschool, 5-hour flight training"],
  ["January 8 to February 28, Fridays 6:30-9:30 PM, Weekends 8:3", "200-Hour YTT", "yoga", 3100, "January 8 to February 28, Fridays 6:30-9:30 PM"],
  ["Seasonal hours May 23-August 2, weekends only through Labor ", "Aquatics Park Access", "waterpark", null, "Seasonal hours May 23-August 2"],
  ["Oct 3 golf outing: 8am registration opens, 9am shotgun", "Charity Classic", "golf", 150, null],
  // Shouting, calm Title Case, names kept.
  ["TWILIGHT RATE AFTER 3PM", "Green Fees", "golf", 30, "Twilight rate after 3PM"],
  ["Private Charter On Lake Minnetonka", "Charters", "cruise", 900, "Private Charter On Lake Minnetonka"],
  ["Kiddie Fun Hour", "Kiddie Karts", "themepark", 20, "Kiddie Fun Hour"],
  ["3 Hours Unlimited Riding", "Kiddie Karts", "themepark", 29, "3 Hours Unlimited Riding"],
  ["Largest fleet of eleven to eighteen passenger surf boat rentals", "Boat Rentals", "jetski", null, "Largest fleet of eleven to eighteen passenger surf boat rentals"],
  ["Weekend Adult Ticket", "General Admission", "themepark", 35, "Weekend adult ticket"],
  ["Double Kayak", "Kayak Rentals", "kayak", 60, "Double kayak"],
  ["Kayak Rental Double", "Kayak Rental", "kayak", 60, "Double"],
  // Regressions found reading the catalog.
  ["Vintage bowling alley open during events and bowling hours", "Bowling", "bowling", null, "Vintage bowling alley open during events and bowling hours"],
  ["Two Nights or more", "Cabin Rental", "camping", 180, "Two nights or more"],
  ["Bike w/ Child Seat", "Four Day Bike Rental", "bike", 90, "Bike with Child Seat"],
  ["HPA TANK RENTAL", "Airsoft", "paintball", 15, "HPA tank rental"],
  ["General admission ticket for students with valid ID", "One Day Student Admission", "heli", 20, "General admission ticket for students with valid ID"],
  ["Custom fishing trips available", "Custom fishing trips", "fishing", null, "Custom fishing trips available"],
  ["3 to 3.5 hours total, 1 to 1.5 hours flight time", "Scheduled Flights", "balloon", 250, "3 to 3.5 hours total, 1 to 1.5 hours flight time"],
  ["Memberships start at", "Package", "museum", 25, "Memberships"],
  ["7 hour trip is", "Shark Fishing", "fishing", 1400, "7-hour trip"],
  ["2 Youth Classes for", "Package", "martialarts", 40, "2 youth classes"],
  ["Private programs are a minimum of", "Field Trips", "museum", 300, ""],
  ["Class Change Policy: Schedule changes incur a", "Pickleball Plays", "tennis", 10, ""],
  ["Before & After", "Summer Camp", "tennis", 60, "Before & After"],
  ["Tent site inc. water & electric", "Campsite", "camping", 50, "Tent site includes water & electric"],
  ["\u200b \u200b Nightly rate includes 2 adults", "Mini Yurt", "camping", 109, "Nightly rate includes 2 adults"],
  ["Salmon fishing / jet boat", "Fishing", "fishing", 200, "Salmon fishing / jet boat"],
  ["60–75 minute flight plus post-flight celebration", "Private Flights for Two", "balloon", 600, "60 to 75 minute flight plus post-flight celebration"],
  ["3/4 Day", "Fishing charter", "fishing", 900, "3/4 day"],
  ["Adults Aged 18+", "Exhibits", "museum", 20, "Adults Aged 18+"],
  ["Price Range Fishing Packages", "Fishing", "fishing", null, "Price Range Fishing Packages"],
  ["Price - Study Package………………………", "Package", "museum", 40, "Price - Study Package"],
];
for (const [raw, service, kind, price, want] of LABELS) {
  const got = plainLabel(raw, { service, kind, price });
  check(kind, got === want, raw, got, want);
}

console.log("\n2. Service names\n");
const NAMES: [string, string, string][] = [
  ["1. Escape Room", "escape", "Escape Room"],
  ["4 Hr Charter", "fishing", "4-Hour Charter"],
  ["Tent Site w/o Hookups =", "camping", "Tent Site without Hookups"],
  ["Long Island Lighthouses + Great Gatsby + Fall Foliage + ", "sailing", "Long Island Lighthouses + Great Gatsby + Fall Foliage"],
  ["Deluxe Party Package (incl. pizza", "bowling", "Deluxe Party Package (includes pizza)"],
  ["Single Kayak Rental - 1 Hour", "kayak", "Single Kayak Rental - 1 Hour"],
  ["1-Week Trial", "yoga", "1-Week Trial"],
  ["Private Dolphin Sightseeing Tour • This Island • Melbourne", "cruise", "Private Dolphin Sightseeing Tour • This Island • Melbourne"],
  ["Brewery 10 yr Anniversary Celebration", "brewery", "Brewery 10-Year Anniversary Celebration"],
];
for (const [raw, kind, want] of NAMES) {
  const got = plainName(raw, kind);
  check("name", got === want, raw, got, want);
}

/* ---------- 3. a whole service: explain and moreOptions ---------- */

console.log("\n3. Whole services: explanations and folding\n");
const bounce: RawService = {
  name: "Tent Rental",
  desc: null,
  variants: ["10x10", "10x20", "10x30", "20x20", "20x30", "20x40", "30x60", "40x80", "Setup fee"].map((label, i) => ({ label, price: 100 + i * 50, optionIdx: i })),
};
const b = plainServices([bounce], "venue")[0];
console.log("  " + b.variants.map((v) => v.label + (v.moreOptions ? " [more]" : "")).join(" | "));
check("fold", b.variants.filter((v) => !v.moreOptions).length === 4 && b.variants.slice(0, 3).map((v) => v.label).join("|") === "10 × 10 ft|10 × 20 ft|10 × 30 ft", bounce.variants.length + " tiers", b.variants.filter((v) => !v.moreOptions).map((v) => v.label));
check("index", b.variants.every((v) => bounce.variants[v.optionIdx].price === v.price), "optionIdx kept", "prices match their options");
const camp: RawService = { name: "RV Sites", desc: null, variants: [{ label: "Full Hookup 50 amp pull-through", price: 65, optionIdx: 0 }, { label: "Primitive site", price: 20, optionIdx: 1 }, { label: "Full hookup 30 amp", price: 55, optionIdx: 2 }] };
const c = plainServices([camp], "camping")[0];
console.log("  " + JSON.stringify(c.variants.map((v) => [v.label, (v.explain || []).map((e) => e.term)])));
check("explain", (c.variants[0].explain || []).length === 2 && !(c.variants[2].explain || []).some((e) => e.term === "Full hookup"), "each term once per service", c.variants.map((v) => (v.explain || []).map((e) => e.term)));
const descSvc: RawService = { name: "Skyline Sightseeing Tour", desc: null, variants: [{ label: "Guided helicopter flight over Boston's skyline and landmarks", price: null, optionIdx: 0 }] };
const d1 = plainServices([descSvc], "heli")[0];
check("desc", d1.desc === "Guided helicopter flight over Boston's skyline and landmarks." && d1.variants[0].label === STANDARD, descSvc.variants[0].label, { desc: d1.desc, label: d1.variants[0].label });
const eventOnly: RawService = { name: "Fore the Kids Charity Golf Tournament", desc: null, variants: [{ label: "May 8, 2026, 9 a.m. check-in, 10:30 a.m. shotgun start, ends", price: 750, optionIdx: 0 }] };
check("event", plainServices([eventOnly], "balloon").length === 0, eventOnly.name, "dropped");

console.log("\n4. Glossary (" + glossarySize() + " entries)\n");
const TERMS: [string, string, string[]][] = [
  ["Twilight Greens Fee w/ Cart", "golf", ["Greens fee", "Twilight rate"]],
  ["Shotgun Start Tournament", "golf", ["Shotgun start"]],
  ["Large Range Bucket", "golf", ["Range bucket"]],
  ["Full Hookup 50 amp Pull-Through", "camping", ["Pull-through", "Full hookup"]],
  ["Dry Camping", "camping", ["Dry camping"]],
  ["Bareboat Charter", "sailing", ["Bareboat"]],
  ["Half Day Inshore", "fishing", ["Inshore", "Half day"]],
  ["Catch & Release Offshore", "fishing", ["Catch and release", "Offshore"]],
  ["Tandem Parasail 800 ft line", "parasail", ["Tandem parasail", "Line length"]],
  ["SUP Rental", "kayak", ["SUP"]],
  ["Tandem Skydive", "skydive", ["Tandem skydive"]],
  ["AFF Level 1", "skydive", ["AFF"]],
  ["Auto-Belay Day Pass", "climbing", ["Auto-belay", "Day pass"]],
  ["Top Rope Belay Lesson", "climbing", ["Belay certification", "Top rope"]],
  ["Drop-In Class", "yoga", ["Drop-in"]],
  ["10-Class Pack", "yoga", ["Class pack"]],
  ["Lane Rental + Shoe Rental", "bowling", ["Lane rental", "Shoe rental"]],
  ["Open Jump with Grip Socks", "trampoline", ["Grip socks", "Open jump"]],
  ["Hot Stone Enhancement", "spa", ["Enhancement", "Hot stone"]],
  ["BYOB Private Cruise", "cruise", ["Private", "BYOB"]],
  ["Adult Ticket", "museum", []],
  ["Tent site without water & electric", "camping", []],
  ["Tent site with water & electric", "camping", ["Partial hookup"]],
];
for (const [text, kind, want] of TERMS) {
  const got = explainTerms(text, kind).map((e) => e.term);
  check(kind, got.length <= 2 && want.every((w) => got.includes(w)) && got.length === want.length, text, got, want);
}

/* ---------- 5. deals ---------- */

console.log("\n5. Deals\n");
const NOW = new Date("2026-09-14T12:00:00");
const dana: RawPromo[] = [
  { text: "Half-Price Tuesdays:", days: [2] },
  { text: "HALF PRICE TUESDAY IS BACK!", days: [2] },
  { text: "Half price off the usual adult fare on Tuesdays!", days: [2] },
  { text: "Enjoy half-price tickets on all 2-hour whale and dolphin watching trips every Tuesday. Discount applies to the adult fare, not including fees.", days: [2] },
  { text: "I highly recommend this company and if you are available on Tuesday's, it's half price!!!", days: [2] },
  { text: "Explore special offers and choose from one of our unique trips departing daily.", days: [] },
  { text: "Black Friday / Cyber Monday Special", days: [1, 5] },
];
const dd = consolidateDeals(dana, NOW);
console.log("  " + JSON.stringify(dd));
check("dana", dd.length === 1 && dd[0].title === "Half-price Tuesdays" && dd[0].days.join() === "2" && dd[0].detail.startsWith("Enjoy half-price tickets on all 2-hour") && !/recommend/i.test(dd[0].detail), dana.length + " fragments", dd);
const hot = consolidateDeals([{ text: "Special: $35 Off of Weekday Rides (M-TH)", days: [1, 2, 3, 4, 5] }, { text: "Extend your weekend and fly at a discount!", days: [0, 6] }, { text: "When you fly with us Monday-Thursday enjoy $35 per person off of your hot air balloon ride for everyone in your party with promo code WEEKDAYFUN.", days: [1, 2, 3, 4] }], NOW);
console.log("  " + JSON.stringify(hot));
check("hotair", hot.length === 1 && hot[0].days.join() === "1,2,3,4" && hot[0].code === "WEEKDAYFUN" && /\$35 off/.test(hot[0].title), "M-TH + WEEKDAYFUN", hot);
check("blackfri", consolidateDeals([{ text: "Black Friday / Cyber Monday Special", days: [1, 5] }, { text: "Black Friday Gift Certificates - Buy 2 Get One Free", days: [5] }], NOW).length === 0, "Black Friday", "dropped");
const mom = consolidateDeals([{ text: "Mother's Day Special – Sunday May 10th….Receive a FREE ticket for Mom with the purchase of a FULL Price Ticket.", days: [0] }], new Date("2027-04-01"));
check("dated", mom.length === 1 && mom[0].days.length === 0 && mom[0].date === "May 10", "Mother's Day, seen in April", mom);
check("pastdate", consolidateDeals([{ text: "Mother's Day Special – Sunday May 10th….Receive a FREE ticket for Mom with the purchase of a FULL Price Ticket.", days: [0] }], NOW).length === 0, "Mother's Day, seen in September", "dropped");
check("pricing", consolidateDeals([{ text: "Mon – Thu: 3 hours: $772", days: [1, 2, 3, 4] }, { text: "Saturday: $675", days: [6] }, { text: "ADD $50 for FRIDAY / SATURDAY / SUNDAY TRIPS", days: [0, 5, 6] }, { text: "Only $50 to secure your Saturday or Sunday jump", days: [0, 6] }], NOW).length === 0, "price table, surcharge, deposit", "dropped");
const koo = consolidateDeals([{ text: "Ten Percent Off Monday Special", days: [1] }, { text: "Book any snorkel tour for a Monday and receive a 10% discount off of our retail rates using code “MONDAY10”", days: [1] }], NOW);
check("koolina", koo.length === 1 && koo[0].title === "10% off on Mondays" && koo[0].code === "MONDAY10", "two fragments", koo);
const three = consolidateDeals([{ text: "Monday Bay Day – 50% OFF", days: [1] }, { text: "Enjoy 50% off bay cruises every Monday this summer using promo code BAYDAY50.", days: [1] }, { text: "Fall Bay Break – 20% OFF Midweek (Tues–Thurs)", days: [2, 3, 4] }, { text: "Enjoy the crisp air with 20% off rentals Tuesday – Thursday.", days: [2, 3, 4] }, { text: "Kids (15 and under) fish for free with each paid adult, weekdays only.", days: [1, 2, 3, 4, 5] }, { text: "$10 off sundays!", days: [0] }], NOW);
check("max3", three.length === 3, "4 offers", three.map((x) => x.title));
const DAYS: [string, number[] | null][] = [["M-TH", [1, 2, 3, 4]], ["Mon-Fri", [1, 2, 3, 4, 5]], ["Tuesday/Wednesday/Thursday", [2, 3, 4]], ["Fri & Sun", [0, 5]], ["watch the sun sink", null], ["weekends", [0, 6]], ["Weekday Rides (M-TH)", [1, 2, 3, 4]], ["Friday – Sunday", [0, 5, 6]]];
for (const [t, want] of DAYS) {
  const got = daysOf(t);
  check("days", JSON.stringify(got) === JSON.stringify(want), t, got, want);
}

console.log("\nFixed cases: " + pass + " passed, " + fail + " failed.");
if (quiet) process.exit(fail ? 1 : 0);

/* ---------- 6. the published catalog ---------- */

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../public/o");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
// A fixed shuffle, so the sample is random but the same on every run.
let seed = 20260914;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (n: number, from: string[]) => {
  const a = from.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
};
type Detail = { id: string; art: string; services?: RawService[]; promos?: RawPromo[] };
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Detail;
const sample = pick(300, files.filter((f) => {
  // Most detail files have no menu; sample among those that do, so 300 files means 300 menus to read.
  const raw = readFileSync(join(dir, f), "utf8");
  return raw.includes('"services":[{');
}));

/** Words the plain forms may introduce: expansions, units, number words, days, "ft". */
const ALLOWED = new Set("to with without includes not including about approximately per person people years year hours hour minutes minute days day nights night weeks week months month ft each one two three four five six seven eight nine ten eleven twelve monday tuesday wednesday thursday friday saturday sunday electric hookup hookups minimum in standard".split(" "));
const words = (t: string) => (t.toLowerCase().match(/[a-z]+/g) || []);
const nums = (t: string) => (t.match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n)));
let invented = 0;
/** Words a deal title is built from: the template, not a fact. Numbers, days and codes still have to come from the source. */
const TITLE_WORDS = new Set("on off special price buy get free for kids half weekday weekdays weekend weekends up and bring a friend th st nd rd".split(" "));
const inventCheck = (before: string, after: string, where: string, extra = new Set<string>()) => {
  const src = new Set([...words(before), ...words(before.replace(/\bw\/o\b/gi, "without").replace(/\bw\//gi, "with ").replace(/incl/gi, "includes").replace(/excl/gi, "not including"))]);
  const extraWords = words(after).filter((w) => !src.has(w) && !ALLOWED.has(w) && !extra.has(w) && ![...src].some((s) => s.startsWith(w) || w.startsWith(s)));
  const srcNums = new Set(nums(before));
  const extraNums = nums(after).filter((n) => !srcNums.has(n));
  if (extraWords.length || extraNums.length) {
    invented++;
    console.log("  INVENTED? " + where + ": " + JSON.stringify(before) + " -> " + JSON.stringify(after) + " extra " + JSON.stringify([...extraWords, ...extraNums]));
  }
};

let svcCount = 0;
let tierCount = 0;
let changedLabels = 0;
let folded = 0;
let explained = 0;
let dropped = 0;
const shown: string[] = [];
for (const f of sample) {
  const item = read(f);
  const before = item.services || [];
  const after = plainServices(before, item.art);
  svcCount += before.length;
  dropped += before.length - after.length;
  for (const s of after) {
    const orig = before.find((x) => x.variants.some((v) => v.optionIdx === s.variants[0].optionIdx))!;
    if (s.explain) explained += s.explain.length;
    inventCheck(orig.name, s.name, item.id + " name");
    for (const v of s.variants) {
      tierCount++;
      const ov = orig.variants.find((x) => x.optionIdx === v.optionIdx)!;
      if (ov.price !== v.price) {
        invented++;
        console.log("  PRICE CHANGED " + item.id + " " + ov.price + " -> " + v.price);
      }
      if (ov.label !== v.label) changedLabels++;
      if (v.moreOptions) folded++;
      if (v.explain) explained += v.explain.length;
      if (v.label !== STANDARD) inventCheck(ov.label, v.label, item.id + " label");
    }
    const perListing = shown.filter((x) => x.includes("] " + item.id + "\n")).length;
    if (shown.length < 40 && perListing < 2 && orig.variants.some((v, i) => v.label !== s.variants.find((x) => x.optionIdx === v.optionIdx)?.label || s.variants[i]?.explain || s.explain || s.variants[i]?.moreOptions)) {
      const lines = ["  [" + item.art + "] " + item.id, "    before: " + orig.name + " :: " + orig.variants.map((v) => v.label + (v.price != null ? " $" + v.price : "")).join(" | "), "    after:  " + s.name + " :: " + s.variants.map((v) => v.label + (v.price != null ? " $" + v.price : "") + (v.moreOptions ? " [more]" : "")).join(" | ")];
      const terms = [...(s.explain || []), ...s.variants.flatMap((v) => v.explain || [])];
      if (terms.length) lines.push("    explain: " + terms.map((e) => e.term + " = " + e.meaning).join(" / "));
      if (s.desc && !orig.desc) lines.push("    desc (moved from label): " + s.desc);
      shown.push(lines.join("\n"));
    }
  }
}
console.log("\n6. Sample of " + sample.length + " published listings with a menu: " + svcCount + " services, " + tierCount + " tiers kept, " + changedLabels + " labels changed, " + folded + " folded, " + explained + " terms explained, " + dropped + " services dropped (event timetables only).\n");
console.log(shown.join("\n"));

console.log("\n7. Every listing's deals, before and after (all " + files.length + " detail files scanned for promos)\n");
let dealListings = 0;
for (const f of files) {
  const raw = readFileSync(join(dir, f), "utf8");
  if (!raw.includes('"promos":[{')) continue;
  const item = JSON.parse(raw) as Detail;
  const promos = item.promos || [];
  dealListings++;
  const after = consolidateDeals(promos, NOW);
  console.log("  " + item.id);
  for (const p of promos) console.log("    - [" + p.days.join(",") + "] " + p.text);
  for (const d of after) {
    console.log("    + [" + d.days.join(",") + "] " + d.title + (d.code ? " (code " + d.code + ")" : "") + (d.detail ? " — " + d.detail : ""));
    const src = promos.map((p) => p.text).join(" ");
    inventCheck(src, d.title + " " + d.detail + " " + (d.code || ""), item.id + " deal", TITLE_WORDS);
  }
  if (!after.length) console.log("    + (no clear offer)");
}
console.log("\n" + dealListings + " listings with deals. Invention flags: " + invented + ". Fixed cases: " + pass + " passed, " + fail + " failed.");
process.exit(fail || invented ? 1 : 0);
