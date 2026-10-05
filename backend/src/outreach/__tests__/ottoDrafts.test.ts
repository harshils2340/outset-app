import { test } from "node:test";
import assert from "node:assert/strict";
import { BUMP_VERSION, COPY_VERSION, busyLine, draftOttoBump, draftOttoCopy, plainName, type OttoOp } from "../ottoDrafts.ts";
import { CATEGORIES } from "../../taxonomy/catalog.ts";
import { FAMILY_ORDER } from "../touches.ts";

const op: OttoOp = {
  id: "op-1", domain: "clockwiseescape.com", name: "Clockwise Escape Room Boise", email: "info@clockwiseescape.com",
  phone: "(208) 555-0100", city: "Boise", region: "ID", calendar_vendor: null,
};
const copy = (o: Partial<OttoOp> = {}) => draftOttoCopy({ ...op, ...o }, "info@clockwiseescape.com");

/**
 * The 2 October copy reached Gmail's Primary tab where the 1 October copy went to Promotions every time, and
 * what made the difference was length and tone. These pin the shape that earned Primary, so an edit that drifts
 * back toward a marketing email fails here before it fails in 100 inboxes.
 */
test("short: a question, the pain, what Otto does, one recording, an offer", () => {
  const c = copy();
  assert.equal(c.subject, "Missed calls at " + op.name);
  assert.ok(c.body.includes("When your game masters are running rooms or after you close, who picks up the phone at " + op.name + "?"), c.body);
  assert.ok(c.body.includes("the caller books the next room on their list"), c.body);
  assert.ok(c.body.includes("I built Outset to pick up those calls."), c.body);
  assert.ok(c.body.includes("answers only from your own info"), "grounded: never makes anything up");
  assert.ok(c.body.includes("Can I set it up for " + op.name + "?"), c.body);
  assert.ok(c.body.includes("you only keep it if it books you guests."), c.body);
  const beforeSignoff = c.body.split("\nHarshil\n")[0];
  assert.ok(beforeSignoff.split(/\s+/).length < 130, "the body before the sign-off stays a short note: " + beforeSignoff.split(/\s+/).length + " words");
  assert.equal(c.variant, COPY_VERSION);
});

test("the recording is the only link in the body, hyperlinked as a phrase in the html", () => {
  const c = copy();
  const otto = "https://onoutset.com/#call";
  assert.equal(c.body.split(otto).length - 1, 1, c.body);
  assert.ok(c.html.includes('<a href="' + otto + '">give it a listen</a>'), c.html);
  assert.equal((c.html.match(/<a /g) || []).length, 3, "recording, unsubscribe, take-down and nothing else");
  assert.ok(!/<img|<table|font-family/i.test(c.html), "no logo, no layout, no styling that reads as a newsletter");
});

test("the live-calendar claim is made only where Otto really reads the calendar", () => {
  assert.ok(copy({ calendar_vendor: "fareharbor" }).body.includes("checks what's actually open in FareHarbor and sends the caller the link to book that exact slot"));
  for (const v of [null, "calendly", "resova"]) {
    const b = copy({ calendar_vendor: v }).body;
    assert.ok(!b.includes("actually open"), `${v}: no calendar claim it cannot back`);
    assert.ok(b.includes("takes the booking down for you"), b);
  }
});

test("still carries the postal address, unsubscribe, reply-no opt-out and the take-down, and no em dash", () => {
  const c = copy();
  assert.ok(c.body.includes("/unsubscribe.html?t="), c.body);
  assert.ok(c.body.includes("#remove="), c.body);
  assert.ok(c.body.includes('Reply "no" and I won\'t email again'), c.body);
  assert.ok(!c.body.includes("—") && !c.html.includes("—"));
  assert.ok(!/!/.test(c.body), "no exclamation marks");
});

test("an operator the site names no owner for is greeted plainly, never with a guessed name", () => {
  assert.ok(copy().body.startsWith("Hi,\n"), copy().body.slice(0, 40));
  assert.ok(draftOttoCopy(op, "x@y.com", { greet: "Ron" }).body.startsWith("Hi Ron,\n"));
});

test("the first line is the owner's own day, by kind of business", () => {
  const at = (name: string, family: string | null) => busyLine({ name, domain: name.toLowerCase().replace(/\W/g, "") + ".com", family });
  assert.equal(at("Puzzle Vault", "indoor"), "your team is out on the floor");
  assert.equal(at("Puzzle Vault Escape Rooms", "indoor"), "your game masters are running rooms");
  assert.equal(at("On Track Karting", "motorsport"), "your crew is out on the track");
  assert.equal(at("Sea Breeze Jet Ski", "water"), "your crew is out on the water");
  assert.equal(at("Skydive Tampa", "air"), "your pilots are up flying");
  assert.equal(at("Bayside Bowl", "play"), "your front desk has a line at it");
  assert.equal(at("Barrio Brewing", "food"), "the room is full");
  assert.equal(at("Bayside Bowl", null), "your team is busy with guests");
  const kart = copy({ name: "On Track Karting", domain: "monzakarting.com", family: "motorsport" }).body;
  assert.ok(kart.includes("When your crew is out on the track or after you close, who picks up the phone at On Track Karting?"), kart);
  assert.ok(kart.includes("books with the next one that picks up"), "the escape-room line is for escape rooms");
});

test("the follow-up is two lines in the same thread, with the same ways out", () => {
  const b = draftOttoBump(op, "info@clockwiseescape.com", { greet: null, subject: "Missed calls at " + op.name });
  assert.equal(b.subject, "Re: Missed calls at " + op.name);
  assert.equal(draftOttoBump(op, "info@clockwiseescape.com", { subject: "Re: Missed calls at X" }).subject, "Re: Missed calls at X", "never Re: Re:");
  assert.ok(b.body.startsWith("Hi,\n\nFollowing up in case this got buried."), b.body);
  assert.ok(b.body.includes("free test line for " + op.name), b.body);
  assert.ok(b.body.includes("/unsubscribe.html?t=") && b.body.includes("#remove=") && b.body.includes('Reply "no"'), b.body);
  assert.ok(b.body.split("\nHarshil\n")[0].split(/\s+/).length < 50, "a nudge, not a second pitch");
  assert.equal((b.html.match(/<a /g) || []).length, 2, "unsubscribe and take-down, no other link");
  assert.equal(b.variant, BUMP_VERSION);
  assert.ok(!b.body.includes("—") && !b.html.includes("—"));
  assert.ok(draftOttoBump(op, "x@y.com", { greet: "Ron", subject: "s" }).body.startsWith("Hi Ron,\n"));
});

test("a plural name or a legal suffix never breaks the first line", () => {
  const rooms = copy({ name: "Alaska Escape Rooms", domain: "alaskaescaperooms.com" });
  assert.ok(rooms.body.includes("who picks up the phone at Alaska Escape Rooms?"), "no Rooms's");
  assert.ok(!/s's\b/.test(rooms.body), rooms.body);
  const llc = copy({ name: "House of Clues, LLC", domain: "houseofclues.com", family: "indoor" });
  assert.equal(llc.subject, "Missed calls at House of Clues");
  assert.ok(llc.body.includes("the phone at House of Clues?") && !llc.body.includes("LLC"), llc.body);
  assert.equal(plainName("Escape Works Inc."), "Escape Works");
  assert.equal(plainName("Inc"), "Inc", "a name that is only a suffix stays");
  assert.equal(plainName("Lincoln Escape"), "Lincoln Escape");
});

test("every family the catalog files a business under has a first line of its own", () => {
  const families = [...new Set(CATEGORIES.map((c) => c.family))].sort();
  const generic = families.filter((f) => busyLine({ name: "A Shop", domain: "ashop.com", family: f }) === "your team is busy with guests");
  assert.deepEqual(generic, [], "these families fall back to the line this function exists to replace");
  assert.deepEqual([...families], [...FAMILY_ORDER].sort(), "and the send order knows the same families the taxonomy does");
});

test("a shop whose own name ends in Co keeps it, because that is what is on its sign", () => {
  // 435 of the shipped names end in " Co" or " Co.", and the 1,013 ending in " Company" were never cut.
  assert.equal(plainName("Barrio Brewing Co"), "Barrio Brewing Co");
  assert.equal(plainName("Hanalei Surf Co."), "Hanalei Surf Co.");
  assert.equal(plainName("Trinity River Kayak Co."), "Trinity River Kayak Co.");
  assert.equal(plainName("Barrio Brewing Company"), "Barrio Brewing Company");
  // The seven written "& Co." or "and Co." were left with the connector hanging.
  assert.equal(plainName("Sikkema Jenkins & Co."), "Sikkema Jenkins & Co.");
  assert.equal(plainName("Mud and Co."), "Mud and Co.");
  const brewery = copy({ name: "Barrio Brewing Co", domain: "barriobrewing.com", family: "food" });
  assert.equal(brewery.subject, "Missed calls at Barrio Brewing Co");
  assert.ok(brewery.body.includes("When the room is full or after you close, who picks up the phone at Barrio Brewing Co?"), brewery.body);
  assert.ok(brewery.body.includes("Remove Barrio Brewing Co from Outset's listings"), brewery.body);
  // The registry suffixes still go.
  assert.equal(plainName("Seawolf Jetski Rental Corp"), "Seawolf Jetski Rental");
  assert.equal(plainName("Harbour Cruises Ltd"), "Harbour Cruises");
  assert.equal(plainName("Atlantic Tours Limited"), "Atlantic Tours");
  assert.equal(plainName("Fineline Fishing Charters L.L.C."), "Fineline Fishing Charters");
  assert.equal(plainName("Divers Incorporated"), "Divers");
});

test("the escape-room line is for escape rooms, not every business with escape in its name", () => {
  const spa = copy({ name: "Escape Day Spa", domain: "escapedayspa.com", family: "wellness" }).body;
  assert.ok(spa.includes("When you're with a client"), spa);
  assert.ok(!spa.includes("game masters") && !spa.includes("escape rooms"), spa);
  const charter = copy({ name: "Island Escape Charters", domain: "islandescape.com", family: "water" }).body;
  assert.ok(charter.includes("your crew is out on the water"), charter);
  assert.ok(copy({ name: "The Lockbox", domain: "thelockboxescaperoom.com", family: null }).body.includes("game masters"), "named so by its site");
  assert.ok(copy({ name: "Exit Strategy", domain: "exitstrategy.com", family: "indoor" }).body.includes("your team is out on the floor"));
});
