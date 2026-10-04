/**
 * What a booking is called after it is made, held to the catalog the app ships.
 *
 * A booking stores the menu row's own name, because that string is what the row is matched on when the booking
 * is priced again, and `bookableMenu` has already taken the crawl's cruft out of it. The word pass that spells a
 * shorthand out, capitalises a lowercase opener and finishes a half-done title is a display rule and runs at
 * print time, so every surface that reads a booking back was printing the crawl's spelling while the booking box
 * it came from printed the tidied one: the three booking emails, the phone confirmation and the desktop
 * confirmation's fallback all did.
 *
 * 3,982 option names, 660 sub-lines and 543 add-ons across 2,524 shipped listings read differently for it, so a
 * guest who booked "Kayak & Stand-up Paddleboard Classes" got a confirmation for "Kayak & SUP Classes" and an
 * operator was told somebody wanted "surf boat". Every line below is a real one from `public/o`, named by the
 * listing it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { bookedName, tidyLength, tidyName } from "../../../../src/lib/listingDerive.ts";
import { bookableMenu } from "../../../../src/lib/menuRow.ts";

const dir = new URL("../../../../public/o/", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
type Row = { name: string; detail?: string; price: number | null };
type Detail = { id: string; title?: string; options?: Row[]; addons?: Row[] };
const details = (): Detail[] => readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Detail);

test("the row a guest picked is named in the email the way the page named it", () => {
  const shop = "Some Shop";
  assert.equal(bookedName("Kayak & SUP Classes", shop), "Kayak & Stand-up Paddleboard Classes"); // o-41n-com
  assert.equal(bookedName("425 HP Luxury Tritoon", shop), "425 Horsepower Luxury Tritoon"); // o-30apontoon-com
  assert.equal(bookedName("surf boat", shop), "Surf boat"); // o-406watersports-com
  assert.equal(bookedName("schedule a tour", shop), "Schedule a tour"); // o-34events-com
  assert.equal(bookedName("Whale Tail dish", shop), "Whale Tail Dish"); // o-205collaborative-org
  assert.equal(bookedName("Pontoon Boat rental with Captain", shop), "Pontoon Boat Rental with Captain"); // o-10dolphincruise-com
  assert.equal(bookedName("Unlimited Classes for 14 days", shop), "Unlimited Classes for 14 Days"); // o-360yogacharleston-com
});

test("an add-on is named the way the price breakdown beside it names one", () => {
  assert.equal(tidyName("- Two Passenger Private Flight"), "Two Passenger Private Flight"); // o-altitudeendeavors-com
  assert.equal(tidyName("each additional person"), "Each additional person"); // o-airboatineverglades-com
  assert.equal(tidyName("Guided hike to Le Morne Brabant"), "Guided Hike to Le Morne Brabant"); // o-1000treks-com
  assert.equal(tidyName("Group lesson : 45min"), "Group lesson: 45min"); // o-akoballet-com
});

test("the sub-line under the row reads as a length, the way the picker prints it", () => {
  assert.equal(tidyLength("1.5 hour"), "1.5 hours");
  assert.equal(tidyLength("2 hrs"), "2 hours");
  assert.equal(tidyLength("90 min"), "90 minutes");
});

/**
 * With no row picked a booking stores the business's own name. A business name is printed as the business wrote
 * it on the card, the hero and every other surface, so the display rule is not run over one: "425 HP Boat
 * Rentals" is a shop, not a row, and must not become "425 Horsepower Boat Rentals" in its own confirmation.
 */
test("a booking that names the business rather than a row is left as the business wrote it", () => {
  for (const title of ["425 HP Luxury Tritoon", "SUP Shack", "surf boat", "schedule a tour"]) {
    assert.equal(bookedName(title, title), title, title);
  }
  assert.equal(bookedName("", "Gulf Jet Skis"), "");
  assert.equal(bookedName(undefined, undefined), "");
  assert.equal(bookedName("  Sunset Cruise  ", "Gulf Jet Skis"), "Sunset Cruise");
});

/**
 * The scale of it, measured rather than asserted: the count only falls as the crawl cleans its own menus, so
 * what this guards is that the rule still reaches the rows it was written for and has not started rewriting a
 * catalog that was already clean. The menu is read through `bookableMenu` first, because that is the shape the
 * booking box offers and therefore the strings a booking can hold.
 */
test("the shipped menu rows a booking would have misnamed are the ones this was written for", () => {
  let rows = 0;
  let changed = 0;
  const listings = new Set<string>();
  for (const j of details()) {
    const menu = bookableMenu({ options: Array.isArray(j.options) ? j.options : [], addons: Array.isArray(j.addons) ? j.addons : [] });
    for (const o of [...(menu.options || []), ...(menu.addons || [])]) {
      const name = String(o?.name || "");
      if (!name) continue;
      rows++;
      if (bookedName(name, j.title) !== name) {
        changed++;
        listings.add(j.id);
      }
    }
  }
  assert.ok(rows > 50000, "the catalog stopped shipping a menu, got " + rows);
  assert.ok(changed >= 3000, "the rule stopped reaching the rows it was written for, got " + changed);
  assert.ok(changed < rows / 4, "the rule is rewriting rows that were already clean, got " + changed + " of " + rows);
  assert.ok(listings.size < 5000, "far more listings than the 2,524 measured, got " + listings.size);
});

test("every surface that reads a booking back names it through the one rule", () => {
  const mail = read("../bookingMail.ts");
  assert.match(mail, /bookedName\(rec\.service, title\)/, "the emails still name the row as the crawl found it");
  assert.match(mail, /tidyLength\(rec\.variant\)/, "the emails still name the sub-line as the crawl found it");
  assert.match(mail, /rec\.addons\.map\(\(a\) => tidyName\(a\)\)/, "the emails still list add-ons as the crawl found them");
  // Nothing prints a stored booking string straight into a sentence a person reads. Every line that reaches for
  // one reads it through a tidier, so a fourth email cannot quietly go back to the crawl's spelling.
  for (const line of mail.split("\n")) {
    if (!/\brec\.(service|variant|addons)\b/.test(line)) continue;
    assert.match(line, /bookedName\(|tidyLength\(|tidyName\(|rec\.addons\.length/, "a raw booking string is printed: " + line.trim());
  }

  for (const rel of ["../../../../src/components/web/WebConfirm.tsx", "../../../../src/components/booking/ConfirmView.tsx"]) {
    const src = read(rel);
    // The row these screens head is the one `bookedRow` hands back, which is the booking's own `service`
    // wherever it recorded one, so the rule is read off that row rather than off the field behind it. The
    // price lines below it stay on `tidyName`, because a row whose name is the shop's own still needs a
    // label there, and `bookedName` would leave the money with nothing beside it.
    assert.match(src, /bookedName\(/, rel + " still prints a raw service name");
    assert.doesNotMatch(src, /\{\s*(?:booking|b)\.service\s*\}/, rel + " still prints a raw service name");
    assert.doesNotMatch(src, /extras\.join\(/, rel + " still lists add-ons raw");
  }
});
