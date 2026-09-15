import "../src/env.ts";
import { randomUUID } from "node:crypto";
import { db, nowIso } from "../src/db/client.ts";

/**
 * A fake listing for testing the whole operator and money path: claim, dashboard edits and toggles, a guest
 * booking, payment, accept or decline, and the payout schedule.
 *
 * DO NOT run this against the production database yet. The live API charges real cards (Stripe live mode), and
 * bookings are written to the public repository until DATA_REPO points at a private one. Use the local end-to-end
 * harness instead (scripts/e2e-local.mts), which runs the API against a temporary store and Stripe test mode.
 *
 * It is a real row in the database with origin 'test', so the catalog sync publishes it like any listing and every
 * code path is the production one. What makes it safe:
 *   - the sync marks it unlisted: it never appears in browse, search, rails, landing pages or the sitemap, and only
 *     its own link opens it;
 *   - outreach skips origin 'test', so no claim email is ever drafted or sent for it;
 *   - the email on file is the founder's, so the ordinary claim request sends the claim link to the founder and
 *     nobody else can claim it (its domain is a subdomain nobody receives mail on);
 *   - prices are a few dollars, so a real card test costs little and a decline releases the hold.
 *
 * Photos are Unsplash images, which their licence allows to be shown.
 *
 *   npx tsx scripts/test-listing.mts            create or refresh it
 *   npx tsx scripts/test-listing.mts --remove   delete it (then sync to unpublish)
 *   OUTSET_TEST_OWNER_EMAIL=you@example.com     claim it from a different inbox
 */

const DOMAIN = "outset-test.onoutset.com";
const SITE = "https://" + DOMAIN + "/";
const OWNER = (process.env.OUTSET_TEST_OWNER_EMAIL || "harshils2340@gmail.com").trim().toLowerCase();
const OPERATOR_ID = "test-operator-outset-sail";
const CATALOG_ID = "o-" + DOMAIN.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

db.exec("PRAGMA busy_timeout = 120000");

const wipe = () => {
  db.prepare("DELETE FROM offerings WHERE operator_id = ?").run(OPERATOR_ID);
  db.prepare("DELETE FROM facts WHERE operator_id = ?").run(OPERATOR_ID);
  db.prepare("DELETE FROM sources WHERE operator_id = ?").run(OPERATOR_ID);
  db.prepare("DELETE FROM operators WHERE id = ?").run(OPERATOR_ID);
};

if (process.argv.includes("--remove")) {
  db.exec("BEGIN IMMEDIATE");
  wipe();
  db.exec("COMMIT");
  console.log(`Removed the test listing ${CATALOG_ID}. Run a catalog sync to take it off the site.`);
  process.exit(0);
}

const photo = (id: string) => `https://images.unsplash.com/${id}?w=1600&q=80`;
const photos = [
  photo("photo-1526761122248-c31c93f8b2b9"), // sailing at sunset
  photo("photo-1473116763249-2faaef81ccda"), // beach at sunset
  photo("photo-1506953823976-52e1fdc0149a"), // palms on the beach
  photo("photo-1544551763-46a013bb70d5"), // snorkel reef and fish
  photo("photo-1520454974749-611b7248ffdb"), // palm tree sky
];

const now = nowIso();
db.exec("BEGIN IMMEDIATE");
wipe();
db.prepare(
  `INSERT INTO operators (id, domain, name, legal_name, website, phone, email, metro_id, city, region, country, family, category_id, icon_key,
     claim_status, booking_mode, origin, calendar_vendor, completeness, rating, review_count, created_at, updated_at, street, postal, hours, lat, lon, osm_ref)
   VALUES (?, ?, ?, NULL, ?, NULL, ?, 'tampa', 'Clearwater Beach', 'FL', 'US', 'water', 'cruise', 'cruise',
     'unclaimed', 'request', 'test', NULL, 5, NULL, NULL, ?, ?, '1 Test Dock (not a real business)', '33767', NULL, 27.9772, -82.8279, NULL)`,
).run(OPERATOR_ID, DOMAIN, "Outset Test Sail & Snorkel", SITE, OWNER, now, now);

const offering = db.prepare(
  "INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'site')",
);
// Small prices on purpose: a live card test costs a few dollars, and Stripe's minimum charge is 50 cents.
offering.run(randomUUID(), OPERATOR_ID, "Sunset sail", "Adult", "2 hours", 500, "person", SITE);
offering.run(randomUUID(), OPERATOR_ID, "Sunset sail", "Child (5 to 12)", "2 hours", 300, "person", SITE);
offering.run(randomUUID(), OPERATOR_ID, "Snorkel trip", "Standard", "3 hours", 800, "person", SITE);
offering.run(randomUUID(), OPERATOR_ID, "Private charter", "Up to 6 guests", "4 hours", 1500, "boat", SITE);

const fact = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')");
const f = (k: string, v: string) => fact.run(randomUUID(), OPERATOR_ID, k, v, SITE);
f("cover", photos[0]);
for (const p of photos) f("photo", p);
f("description", "This is a test listing used to check claiming, editing, booking, payment and payouts on Outset. It is not a real business, nothing here happens on the water, and it does not appear in search. A relaxed sunset sail and a snorkel trip off Clearwater Beach, with a private charter for small groups.");
f("hours_text", "Mon-Sun 9:00 AM - 7:00 PM");
f("cancellation", "Free cancellation up to 24 hours before your start time.");
f("includes", "Life jackets");
f("includes", "Snorkel gear on the snorkel trip");
f("includes", "Bottled water");
f("bring", "Sunscreen and a towel");
f("requirement", "Children under 12 must sail with an adult.");
f("meeting_point", "1 Test Dock, Clearwater Beach, FL. This is a test address.");
f("service_desc", JSON.stringify({ name: "Sunset sail", desc: "A two-hour sail timed for sunset. Test service." }));
f("service_desc", JSON.stringify({ name: "Snorkel trip", desc: "Three hours on the reef with gear included. Test service." }));
f("service_desc", JSON.stringify({ name: "Private charter", desc: "The whole boat for up to six guests. Test service." }));
f("faq", JSON.stringify({ q: "Is this a real business?", a: "No. It is a test listing for Outset's own checks." }));
f("promo", JSON.stringify({ text: "Half-price snorkel trips every Tuesday. Test deal.", days: [2] }));
db.exec("COMMIT");

console.log(`Test listing ready: ${CATALOG_ID}`);
console.log(`  After the next catalog sync and deploy it opens at https://onoutset.com/#o=${CATALOG_ID}`);
console.log(`  Claim it at https://onoutset.com/operators#claim=${CATALOG_ID} with ${OWNER} (search skips unlisted listings)`);
console.log("  It never appears in browse, search, rails, landing pages, the sitemap or outreach.");
