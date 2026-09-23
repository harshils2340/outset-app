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
const who = (f: Partial<PageFacts>) => body(f).split("\n").find((l) => l.startsWith("I'm Harshil")) as string;
const built2 = (f: Partial<PageFacts>) => body(f).split("\n").find((l) => l.startsWith("I put together a page")) as string;
const thin = (f: Partial<PageFacts>) => body(f).split("\n").find((l) => l.startsWith("None of the info is made up"));

test("the lead says what Outset is before naming this operator", () => {
  assert.equal(who({}), "I'm Harshil. I run Outset, an instant-booking marketplace where guests find and book local activities across the US and Canada.");
});

test("the page's things are listed, and only the ones it has", () => {
  assert.equal(
    built2({ priced: ["1 Hour", "2 Hour"], services: 2, photos: true, hours: true, rules: true }),
    "I put together a page for Sea Breeze Jet Ski Rentals using services, your photos, your hours and your cancellation policy:",
  );
});

test("a shop that publishes no hours is not told its hours are on the page", () => {
  const s = built2({ priced: ["1 Hour", "2 Hour"], services: 2, photos: true });
  assert.ok(!s.includes("hours"), s);
  assert.ok(s.includes("using services and your photos"), s);
});

/** No count and no "with prices" claim, priced or not: a scrape can miscount or miss a price, and a wrong
 * specific number is the kind of thing an owner notices and stops trusting the whole email over. */
test("services never carries a count or a price claim", () => {
  assert.ok(built2({ services: 3 }).includes("using services:"));
  assert.ok(built2({ services: 1 }).includes("using services:"));
  assert.ok(built2({ priced: ["Half day"], services: 4 }).includes("using services:"));
  assert.ok(!/\d/.test(built2({ priced: ["Half day", "Full day"], services: 4 })), "no digit anywhere in the sentence");
});

/** One thing used to read "using  and your hours:", because the list always had a last item to add. */
test("a page with one thing on it reads as a sentence", () => {
  assert.ok(built2({ photos: true }).includes("using your photos:"), built2({ photos: true }));
  assert.ok(!built2({ photos: true }).includes("  "), "no gap where the missing items were");
});

test("a page with nothing on it says so rather than claiming things", () => {
  const s = thin({});
  assert.ok(s?.includes("None of the info is made up"), s);
  assert.equal(built2({}), "I put together a page for Sea Breeze Jet Ski Rentals, but your site didn't give me much to work with:");
});

test("the plain text and the html say the same sentence", () => {
  const c = draftCopy(op, {} as never, { ...empty, photos: true, hours: true }, "info@seabreezejetski.com");
  assert.ok(c.html.includes("using your photos and your hours:"));
  assert.ok(c.body.includes("using your photos and your hours:"));
});

/** Common Gmail/spam-filter trigger words and patterns: none of them belong in this email. */
test("the email avoids common spam-filter trigger words and patterns", () => {
  const c = draftCopy(op, {} as never, { ...empty, photos: true, hours: true, rules: true, priced: ["Half day"], services: 2 }, "info@seabreezejetski.com");
  for (const bad of ["free", "guarantee", "act now", "click here", "100%", "risk-free", "no obligation", "$$$"]) {
    assert.ok(!c.body.toLowerCase().includes(bad), `body contains a spam trigger word: "${bad}"`);
  }
  assert.ok(!/!/.test(c.body), "no exclamation marks");
  assert.ok(!/\b[A-Z]{4,}\b/.test(c.body), "no shouty all-caps word");
});

/** The listing preview comes right after the intro (show before asking for the click), the claim link comes
 * after that (the action once they've looked), and the legal/opt-out footer is last and visually separate. */
test("the preview comes before the claim link, both before the footer, and the footer carries the branding", () => {
  const c = draftCopy(op, {} as never, { ...empty, photos: true }, "info@seabreezejetski.com");
  const listingAt = c.body.indexOf("https://onoutset.com/listing/");
  const claimAt = c.body.indexOf("#claim=");
  const termsAt = c.body.indexOf("terms.html");
  const unsubAt = c.body.indexOf("/unsubscribe.html?t=");
  assert.ok(listingAt > 0 && listingAt < claimAt, "the listing preview comes before the claim link");
  assert.ok(claimAt > 0 && claimAt < termsAt, "claim link comes before the legal footer");
  assert.ok(termsAt < unsubAt, "terms comes before unsubscribe, both in the footer");
  assert.ok(c.body.includes("Outset — Instant booking for local activities."), "the wordmark and tagline are their own line in the plain text");
  assert.ok(c.html.includes("<b style=\"color:#222;font-size:14px\">Outset</b>"), "the html footer carries the Outset wordmark");
  assert.ok(c.html.includes("Instant booking for local activities."), "the html footer carries the tagline");
  // The wordmark and "Terms" used to be concatenated with no space or break between them ("OutsetTerms").
  assert.ok(!/Outset<\/b>\s*<a/.test(c.html) && !c.html.includes(">Outset</b><a"), "the wordmark is never glued directly to the terms link");
  const img = /<img[^>]*>/.exec(c.html);
  assert.ok(img, "the html footer carries the actual logo image, not just the text wordmark");
  assert.ok(img![0].includes('alt="Outset"'), "the logo image has alt text");
  assert.ok(img![0].includes('width="28"') && img![0].includes('height="28"'), "the logo is a small mark, not a banner");
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
