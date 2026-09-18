import { test } from "node:test";
import assert from "node:assert/strict";
import { draftCopy, type PageFacts } from "../drafts.ts";

/**
 * The claim email tells an operator what their page already has and then puts the link to it on the next
 * line, so every item in that sentence is checked in one click. "your hours" was in it unconditionally, and
 * 44,312 of the 59,162 listings we ship publish no hours.
 */

const op = {
  id: "op-1", domain: "seabreezejetski.com", name: "Sea Breeze Jet Ski Rentals", email: "info@seabreezejetski.com",
  city: "Clearwater", region: "FL", metro_id: "tampa", website: "https://seabreezejetski.com", completeness: 72,
  origin: "osm", calendar_vendor: null,
};
const empty: PageFacts = { priced: [], services: 0, photos: false, hours: false, rules: false, menuFromWidget: false };
const body = (f: Partial<PageFacts>) => draftCopy(op, {} as never, { ...empty, ...f }, "info@seabreezejetski.com").body;
const intro = (f: Partial<PageFacts>) => body(f).split("\n").find((l) => l.startsWith("I built a page")) as string;

test("the page's things are listed, and only the ones it has", () => {
  assert.equal(
    intro({ priced: ["1 Hour", "2 Hour"], services: 2, photos: true, hours: true, rules: true }),
    "I built a page for Sea Breeze Jet Ski Rentals from your website. It has your 2 services with prices, your photos, your hours and your cancellation policy. I didn't make anything up. Have a look:",
  );
});

test("a shop that publishes no hours is not told its hours are on the page", () => {
  const s = intro({ priced: ["1 Hour", "2 Hour"], services: 2, photos: true });
  assert.ok(!s.includes("hours"), s);
  assert.ok(s.includes("your 2 services with prices and your photos"), s);
});

test("a menu with no prices is called a menu, not a menu with prices", () => {
  assert.ok(intro({ services: 3 }).includes("It has your 3 services. I"));
  assert.ok(intro({ services: 1 }).includes("It has your 1 service. I"));
  assert.ok(intro({ priced: ["Half day"], services: 4 }).includes("It has your 1 service with prices. I"));
});

/** One thing used to read "It has  and your hours.", because the list always had a last item to add. */
test("a page with one thing on it reads as a sentence", () => {
  assert.ok(intro({ photos: true }).includes("It has your photos. I didn't"), intro({ photos: true }));
  assert.ok(!intro({ photos: true }).includes("  "), "no gap where the missing items were");
});

test("a page with nothing on it says so rather than claiming things", () => {
  const s = intro({});
  assert.ok(s.includes("gave me very little"), s);
  assert.ok(!s.includes("It has"), s);
  assert.ok(s.includes("Nothing on it is invented"), s);
});

test("the plain text and the html say the same sentence", () => {
  const c = draftCopy(op, {} as never, { ...empty, photos: true, hours: true }, "info@seabreezejetski.com");
  assert.ok(c.html.includes("It has your photos and your hours."));
  assert.ok(c.body.includes("It has your photos and your hours."));
});

test("the mail still carries the claim link, the take-it-down link and a way to stop", () => {
  const b = body({ photos: true });
  assert.ok(b.includes("#claim=o-seabreezejetski-com&k=v2."), b);
  assert.ok(b.includes("#remove=o-seabreezejetski-com"), b);
  assert.ok(b.includes("/unsubscribe.html?t="), b);
});
