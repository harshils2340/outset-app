import { test } from "node:test";
import assert from "node:assert/strict";
import { draftCopy, type PageFacts } from "../drafts.ts";

/**
 * Ask first, build after (changed 23 September 2026). This email never claims a page exists for the
 * recipient - it offers to build one and links a different real listing to try editing, so nobody can
 * read it the way Capt. Dave's Dolphin & Whale Watching Safari read the old version: as proof that Outset
 * had already listed and could already sell their specific trips without asking.
 */

const op = {
  id: "op-1", domain: "seabreezejetski.com", name: "Sea Breeze Jet Ski Rentals", email: "info@seabreezejetski.com",
  city: "Clearwater", region: "FL", metro_id: "tampa", website: "https://seabreezejetski.com", completeness: 72,
  origin: "osm", calendar_vendor: null,
};
const empty: PageFacts = { priced: [], services: 0, photos: false, hours: false, rules: false, menuFromWidget: false };
const body = (f: Partial<PageFacts>) => draftCopy(op, {} as never, { ...empty, ...f }, "info@seabreezejetski.com").body;
const who = (f: Partial<PageFacts>) => body(f).split("\n").find((l) => l.startsWith("I'm Harshil")) as string;
const offer = (f: Partial<PageFacts>) => body(f).split("\n").find((l) => l.startsWith("We can build")) as string;

test("the lead says what Outset is and points to the real site before anything else", () => {
  const b = body({});
  assert.equal(who({}), "I'm Harshil, the founder of Outset, an instant-booking marketplace for local activities across the US and Canada.");
  assert.ok(b.includes("Take a look: https://onoutset.com/"), b);
});

test("never claims a page already exists - it's an offer to build one, not proof one was built", () => {
  const b = body({ priced: ["1 Hour"], services: 1, photos: true, hours: true, rules: true });
  assert.ok(!/I put together a page|I built (a|your) page/i.test(b), b);
  assert.ok(offer({}).startsWith("We can build Sea Breeze Jet Ski Rentals a complete page"), offer({}));
});

test("the offer names what was found, and only what has it", () => {
  assert.equal(
    offer({ priced: ["1 Hour", "2 Hour"], services: 2, photos: true, hours: true, rules: true }),
    "We can build Sea Breeze Jet Ski Rentals a complete page using services, your photos, your hours and your cancellation policy, all set up and ready to go, for free. We just need your OK to do it.",
  );
});

test("a shop that publishes no hours is not told its hours are on offer", () => {
  const s = offer({ priced: ["1 Hour", "2 Hour"], services: 2, photos: true });
  assert.ok(!s.includes("hours"), s);
  assert.ok(s.includes("using services and your photos"), s);
});

/** No count and no "with prices" claim, priced or not: a scrape can miscount, and a wrong specific number
 * is the kind of thing an owner notices and stops trusting the whole email over. */
test("services never carries a count or a price claim", () => {
  assert.ok(offer({ services: 3 }).includes("using services,"));
  assert.ok(offer({ services: 1 }).includes("using services,"));
  assert.ok(offer({ priced: ["Half day"], services: 4 }).includes("using services,"));
  assert.ok(!/\d/.test(offer({ priced: ["Half day", "Full day"], services: 4 })), "no digit anywhere in the sentence");
});

test("nothing found still makes a real offer, just without a specifics clause", () => {
  const s = offer({});
  assert.equal(s, "We can build Sea Breeze Jet Ski Rentals a complete page, all set up and ready to go, for free. We just need your OK to do it.");
  assert.ok(!s.includes("using"), s);
});

test("a real vendor gets its own honest line, not a generic one", () => {
  const withVendor = { ...op, calendar_vendor: "fareharbor" };
  const c = draftCopy(withVendor, {} as never, empty, "info@seabreezejetski.com");
  assert.ok(c.body.includes("You already use FareHarbor"), c.body);
  const withoutVendor = draftCopy(op, {} as never, empty, "info@seabreezejetski.com");
  assert.ok(!withoutVendor.body.includes("FareHarbor"), withoutVendor.body);
});

/** The demo link is always the same generic sandbox, never the recipient's own (not yet built) listing. */
test("the try-it link is the generic sandbox, not a link to the recipient's own business", () => {
  const b = body({});
  assert.ok(b.includes("https://onoutset.com/operators#demo"), b);
  assert.ok(!b.includes("https://onoutset.com/listing/"), "no per-operator listing link, because none was built");
});

test("the credibility number is real and current, not a fabricated stat", () => {
  const b = body({});
  const m = /joining about ([\d,]+) other real local businesses/.exec(b);
  assert.ok(m, b);
  assert.ok(Number(m![1].replace(/,/g, "")) >= 1000, "a real, three-digit-plus catalog count, not a placeholder");
});

test("the close asks for the easiest possible action, not a vague question", () => {
  const b = body({});
  assert.ok(b.includes('Just reply "yes" and I\'ll have it built and sent to you today.'), b);
});

/** Common Gmail/spam-filter trigger words and patterns: none of them belong in this email. */
test("the email avoids common spam-filter trigger words and patterns", () => {
  const c = draftCopy(op, {} as never, { ...empty, photos: true, hours: true, rules: true, priced: ["Half day"], services: 2 }, "info@seabreezejetski.com");
  for (const bad of ["guarantee", "act now", "click here", "100%", "risk-free", "no obligation", "$$$"]) {
    assert.ok(!c.body.toLowerCase().includes(bad), `body contains a spam trigger word: "${bad}"`);
  }
  assert.ok(!/!/.test(c.body), "no exclamation marks");
  assert.ok(!/\b[A-Z]{4,}\b/.test(c.body), "no shouty all-caps word");
});

test("no em dash anywhere, including the footer", () => {
  const c = draftCopy(op, {} as never, empty, "info@seabreezejetski.com");
  assert.ok(!c.body.includes("—"), c.body);
  assert.ok(!c.html.includes("—"), c.html);
});

test("the footer carries the branding: the logo image, the wordmark, and the tagline, never glued to Terms", () => {
  const c = draftCopy(op, {} as never, empty, "info@seabreezejetski.com");
  assert.ok(c.body.includes("Outset. Instant booking for local activities."), c.body);
  assert.ok(c.html.includes("<b style=\"color:#222;font-size:14px\">Outset.</b>"), c.html);
  assert.ok(c.html.includes("Instant booking for local activities."), c.html);
  assert.ok(!/Outset\.<\/b>\s*<a/.test(c.html) && !c.html.includes(">Outset.</b><a"), "the wordmark is never glued directly to the terms link");
  const img = /<img[^>]*>/.exec(c.html);
  assert.ok(img, "the html footer carries the actual logo image, not just the text wordmark");
  assert.ok(img![0].includes('alt="Outset"'), "the logo image has alt text");
  assert.ok(img![0].includes('width="28"') && img![0].includes('height="28"'), "the logo is a small mark, not a banner");
});

test("there is no claim link - nothing is offered as already built or already claimable", () => {
  const b = body({ photos: true });
  assert.ok(!b.includes("#claim="), b);
});

test("the mail still carries a take-it-down link and a way to stop, per the outreach folder's own rule", () => {
  const b = body({ photos: true });
  assert.ok(b.includes("#remove=o-seabreezejetski-com"), b);
  assert.ok(b.includes("/unsubscribe.html?t="), b);
});

/** Added 25 September 2026: the owner who would rather talk it through than reply "yes" gets Harshil's
 * calendar as a plain link in the text and a hyperlink in the html, once, and never at the expense of the
 * reply-"yes" close, which stays the easiest action. */
test("the mail carries Harshil's call link as a 'love to chat' hyperlink, once", () => {
  const c = draftCopy(op, {} as never, empty, "info@seabreezejetski.com");
  const cal = "https://cal.com/harshil-shah-7tkvs7/outset?overlayCalendar=true";
  assert.ok(c.body.includes("I'd love to chat:\n" + cal), c.body);
  assert.ok(c.html.includes('<a href="' + cal + '">I\'d love to chat</a>'), c.html);
  assert.equal(c.body.split(cal).length - 1, 1, "the call link appears exactly once in the text");
  assert.equal(c.html.split(cal).length - 1, 1, "the call link appears exactly once in the html");
  assert.ok(c.body.indexOf('Just reply "yes"') < c.body.indexOf(cal), "the reply-yes close still comes first");
});
