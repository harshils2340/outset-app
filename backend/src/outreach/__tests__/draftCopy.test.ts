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
const intro = (f: Partial<PageFacts>) => body(f).split("\n").find((l) => l.startsWith("I am Harshil")) as string;
const thin = (f: Partial<PageFacts>) => body(f).split("\n").find((l) => l.startsWith("Your site gave me"));

test("the page's things are listed, and only the ones it has", () => {
  assert.equal(
    intro({ priced: ["1 Hour", "2 Hour"], services: 2, photos: true, hours: true, rules: true }),
    "I am Harshil, the founder of Outset and a Computer Engineering student at Waterloo. I built an instant-booking page for Sea Breeze Jet Ski Rentals using services, your photos, your hours and your cancellation policy:",
  );
});

test("a shop that publishes no hours is not told its hours are on the page", () => {
  const s = intro({ priced: ["1 Hour", "2 Hour"], services: 2, photos: true });
  assert.ok(!s.includes("hours"), s);
  assert.ok(s.includes("using services and your photos"), s);
});

/** No count and no "with prices" claim, priced or not: a scrape can miscount, and a wrong number is the kind
 * of specific, checkable claim that makes an owner stop trusting the rest of the email. */
test("services never carries a count or a price claim", () => {
  assert.ok(intro({ services: 3 }).includes("using services:"));
  assert.ok(intro({ services: 1 }).includes("using services:"));
  assert.ok(intro({ priced: ["Half day"], services: 4 }).includes("using services:"));
  assert.ok(!/\d/.test(intro({ priced: ["Half day", "Full day"], services: 4 })), "no digit anywhere in the sentence");
});

/** One thing used to read "using  and your hours:", because the list always had a last item to add. */
test("a page with one thing on it reads as a sentence", () => {
  assert.ok(intro({ photos: true }).includes("using your photos:"), intro({ photos: true }));
  assert.ok(!intro({ photos: true }).includes("  "), "no gap where the missing items were");
});

test("a page with nothing on it says so rather than claiming things", () => {
  const s = thin({});
  assert.ok(s?.includes("gave me very little"), s);
  assert.ok(!intro({}).includes("using your"), intro({}));
  assert.ok(s?.includes("Nothing on it is invented"), s);
});

test("the plain text and the html say the same sentence", () => {
  const c = draftCopy(op, {} as never, { ...empty, photos: true, hours: true }, "info@seabreezejetski.com");
  assert.ok(c.html.includes("using your photos and your hours:"));
  assert.ok(c.body.includes("using your photos and your hours:"));
});

test("the mail still carries the claim link, the take-it-down link and a way to stop", () => {
  const b = body({ photos: true });
  assert.ok(b.includes("#claim=o-seabreezejetski-com&k=v2."), b);
  assert.ok(b.includes("#remove=o-seabreezejetski-com"), b);
  assert.ok(b.includes("/unsubscribe.html?t="), b);
});

test("the listing link is the clean /listing/ path, not the #o= hash", () => {
  const b = body({ photos: true });
  assert.ok(b.includes("https://onoutset.com/listing/o-seabreezejetski-com"), b);
  assert.ok(!b.includes("#o="), b);
});
