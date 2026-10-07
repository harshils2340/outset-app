import { test } from "node:test";
import assert from "node:assert/strict";
import { ARMS, BUMP_ASK_VERSION, BUMP_FORGOT_VERSION, BUMP_VERSION, COPY_LADDER, COPY_VERSION, FORGOT_VERSION, armOf, draftOttoBump, draftOttoCopy, plainName, type OttoOp } from "../ottoDrafts.ts";
import { readFileSync } from "node:fs";
import { pickRung, placementRead, type PlacementResult } from "../placement.ts";

const op: OttoOp = {
  id: "op-1", domain: "clockwiseescape.com", name: "Clockwise Escape Room Boise", email: "info@clockwiseescape.com",
  phone: "(208) 555-0100", city: "Boise", region: "ID", calendar_vendor: null,
};
const copy = (o: Partial<OttoOp> = {}, style?: "ask" | "full" | "nolink" | "min" | "forgot") => draftOttoCopy({ ...op, ...o }, "info@clockwiseescape.com", style ? { style } : undefined);

/**
 * The 2 October body reached Gmail's Primary tab; the 1 October and 5 October copies went to Promotions. On 5
 * October a side-by-side test pinned it on the opening and pitch wording, so these hold that body word for word.
 * An edit that changes it fails here before it fails in 100 inboxes; change them together, after a placement test.
 */
test("full: the 2 October note, word for word, with the 7 October booking-system line", () => {
  const c = copy();
  assert.equal(c.subject, "Missed calls at " + op.name);
  assert.ok(c.body.includes("When everyone at " + op.name + " is busy with guests or you've closed for the day, where do the calls go?"), c.body);
  assert.ok(c.body.includes("For most operators it's voicemail, and the caller hangs up and books with the next place that picks up."), c.body);
  assert.ok(c.body.includes("I built Outset, a 24/7 customer service line for your phone. It picks up those calls, connects directly with your booking or reservation system, and answers only from your own company info, prices and terms, so it never makes anything up, then takes the booking down for you. You get a summary of every call."), c.body);
  assert.ok(c.body.includes("Here's a 40-second recording of it on a real call: https://onoutset.com/otto"), c.body);
  assert.ok(c.body.includes("I'll set it up on your line for free, and you only keep it if it books you a guest. Worth a quick reply?"), c.body);
  assert.equal(c.variant, COPY_VERSION);
});

test("the ladder steps down: the recording goes, then everything but three sentences", () => {
  const full = copy(), nolink = copy({}, "nolink"), min = copy({}, "min");
  assert.ok(!nolink.body.includes("onoutset.com/otto") && nolink.body.includes("Worth a quick reply?"), nolink.body);
  const words = (b: string) => b.split("\nHarshil\n")[0].split(/\s+/).length;
  assert.ok(words(full.body) > words(nolink.body) && words(nolink.body) > words(min.body) && words(min.body) < 70, "each rung shorter");
  assert.ok(min.body.includes("I'll set it up for " + op.name + " for free. Worth a quick reply?"), min.body);
  assert.deepEqual(COPY_LADDER.map((r) => r.version), [COPY_VERSION + "-ask", COPY_VERSION, COPY_VERSION + "-nolink", COPY_VERSION + "-min"]);
  assert.deepEqual([copy({}, "ask"), full, nolink, min].map((c) => c.variant), COPY_LADDER.map((r) => r.version), "each send records its rung");
  for (const c of [full, nolink, min]) {
    assert.equal(c.subject, full.subject);
    assert.ok(c.body.includes("/unsubscribe.html?t=") && c.body.includes('Reply "no"'), c.body);
  }
});

test("the recording is the only link above the sign-off, hyperlinked as a phrase in the html", () => {
  const c = copy();
  assert.equal(c.body.split("https://onoutset.com/otto").length - 1, 1, c.body);
  assert.ok(c.html.includes('<a href="https://onoutset.com/otto">give it a listen</a>'), c.html);
  assert.equal((c.html.match(/<a /g) || []).length, 2, "recording and unsubscribe, nothing else");
  assert.equal((copy({}, "min").html.match(/<a /g) || []).length, 1, "min: unsubscribe only");
  assert.ok(!/<img|<table|font-family/i.test(c.html), "no logo, no layout, no styling that reads as a newsletter");
});

test("no take-down line in any email (Harshil, 5 October 2026)", () => {
  const b = draftOttoBump(op, "info@clockwiseescape.com", { subject: "Missed calls at X" });
  for (const c of [copy({}, "ask"), copy(), copy({}, "nolink"), copy({}, "min"), b]) {
    assert.ok(!/remove=|take it down|Take it down|from Outset's listings/i.test(c.body + c.html), c.body);
  }
});

test("the live-calendar claim is made only where Otto really reads the calendar", () => {
  const fh = copy({ calendar_vendor: "fareharbor" }).body;
  assert.ok(fh.includes("connects directly with your FareHarbor booking system") && fh.includes("tells the caller what's actually open and sends them the link to book that exact slot"), fh);
  assert.ok(copy({ calendar_vendor: "peek" }, "ask").body.includes("connects directly with your Peek booking system"));
  for (const v of [null, "calendly", "resova", "bookeo"]) {
    for (const style of ["full", "ask", "min"] as const) {
      const b = copy({ calendar_vendor: v }, style).body;
      assert.ok(!b.includes("actually open"), `${v}: no calendar claim it cannot back`);
      assert.ok(b.includes("connects directly with your booking or reservation system"), `${v} ${style}: the system is not named where Otto does not read it: ` + b);
    }
    assert.ok(copy({ calendar_vendor: v }).body.includes("takes the booking down for you"));
  }
});

test("postal address, unsubscribe and the reply-no opt-out stay; no em dash, no exclamation mark", () => {
  const c = copy();
  assert.ok(c.body.includes("/unsubscribe.html?t="), c.body);
  assert.ok(c.body.includes('Reply "no" and I won\'t email again'), c.body);
  assert.ok(!c.body.includes("—") && !c.html.includes("—"));
  assert.ok(!/!/.test(c.body), "no exclamation marks");
});

test("an operator the site names no owner for is greeted plainly, never with a guessed name", () => {
  assert.ok(copy().body.startsWith("Hi,\n"), copy().body.slice(0, 40));
  assert.ok(draftOttoCopy(op, "x@y.com", { greet: "Ron" }).body.startsWith("Hi Ron,\n"));
});

test("the follow-up is two lines in the same thread, with the same way out", () => {
  const b = draftOttoBump(op, "info@clockwiseescape.com", { greet: null, subject: "Missed calls at " + op.name });
  assert.equal(b.subject, "Re: Missed calls at " + op.name);
  assert.equal(draftOttoBump(op, "info@clockwiseescape.com", { subject: "Re: Missed calls at X" }).subject, "Re: Missed calls at X", "never Re: Re:");
  assert.ok(b.body.startsWith("Hi,\n\nFollowing up in case this got buried."), b.body);
  assert.ok(b.body.includes("free test line for " + op.name), b.body);
  assert.ok(b.body.includes("/unsubscribe.html?t=") && b.body.includes('Reply "no"'), b.body);
  assert.ok(b.body.split("\nHarshil\n")[0].split(/\s+/).length < 50, "a nudge, not a second pitch");
  assert.equal((b.html.match(/<a /g) || []).length, 1, "unsubscribe, no other link");
  assert.equal(b.variant, BUMP_VERSION);
  assert.ok(!b.body.includes("—") && !b.html.includes("—"));
  assert.ok(draftOttoBump(op, "x@y.com", { greet: "Ron", subject: "s" }).body.startsWith("Hi Ron,\n"));
});

test("a legal suffix never reaches the subject or the first line; a shop's own Co stays", () => {
  const llc = copy({ name: "House of Clues, LLC", domain: "houseofclues.com" });
  assert.equal(llc.subject, "Missed calls at House of Clues");
  assert.ok(llc.body.includes("When everyone at House of Clues is busy") && !llc.body.includes("LLC"), llc.body);
  assert.equal(plainName("Escape Works Inc."), "Escape Works");
  assert.equal(plainName("Inc"), "Inc", "a name that is only a suffix stays");
  // 435 of the shipped names end in " Co" or " Co.": that is the shop's sign, not an entity type.
  assert.equal(plainName("Barrio Brewing Co"), "Barrio Brewing Co");
  assert.equal(plainName("Hanalei Surf Co."), "Hanalei Surf Co.");
  assert.equal(plainName("Sikkema Jenkins & Co."), "Sikkema Jenkins & Co.");
  assert.equal(plainName("Mud and Co."), "Mud and Co.");
  assert.equal(plainName("Barrio Brewing Company"), "Barrio Brewing Company");
  assert.equal(plainName("Seawolf Jetski Rental Corp"), "Seawolf Jetski Rental");
  assert.equal(plainName("Harbour Cruises Ltd"), "Harbour Cruises");
  assert.equal(plainName("Atlantic Tours Limited"), "Atlantic Tours");
  assert.equal(plainName("Fineline Fishing Charters L.L.C."), "Fineline Fishing Charters");
  assert.equal(plainName("Divers Incorporated"), "Divers");
});

test("the daily run picks the first rung Gmail put in Primary, and holds only when none did", () => {
  const r = (...ps: PlacementResult["placement"][]): PlacementResult[] => ps.map((placement) => ({ from: "a", to: "b", placement, subject: "s" }));
  const pick = (...rs: PlacementResult[][]) => pickRung(rs.map((results, i) => ({ key: ["full", "nolink", "min"][i], results })))?.key ?? null;
  assert.equal(pick(r("primary", "primary", "primary"), r("primary", "primary", "primary")), "full");
  assert.equal(pick(r("promotions", "primary", "promotions"), r("primary", "primary", "unknown")), "nolink", "falls back past a Promotions verdict");
  assert.equal(pick(r("promotions", "primary", "primary"), r("promotions", "promotions", "primary")), "full", "two of three in Primary with no clean rung still sends");
  assert.equal(pick(r("primary", "primary", "spam"), r("promotions", "promotions", "promotions")), null, "Spam never sends");
  assert.equal(pick(r("promotions", "promotions", "primary"), r("promotions", "unknown", "unknown"), r("unknown", "unknown", "unknown")), null);
  assert.equal(pick(r("primary", "primary", "promotions"), r("primary", "primary", "primary")), "nolink", "a clean rung beats an earlier mixed one");
});

test("ask: no link at all, asks before sending the recording, and the stop is a reply", () => {
  const c = copy({}, "ask");
  assert.equal(c.subject, "Missed calls at " + op.name);
  assert.ok(!/https?:\/\//.test(c.body) && !c.html.includes("<a "), "not one link: " + c.body);
  assert.ok(c.body.includes("When everyone at " + op.name + " is busy with guests or you've closed for the day, where do the calls go?"), c.body);
  assert.ok(c.body.includes("Can I send you a 40-second recording of it on a real call?"), c.body);
  assert.ok(c.body.includes('PS. If you\'re not interested, just reply "stop" and I won\'t email you again.'), c.body);
  assert.ok(c.body.split("--")[0].split(/\s+/).length < 75, "a short note");
  assert.ok(!c.body.includes("—") && !/!/.test(c.body));
});

/**
 * Gmail answering nothing at all, which is not a Promotions verdict.
 *
 * `pickRung` wants Primary in two inboxes, and an unread test has none of it, so a test that could not be
 * measured took the same branch as a measured Promotions verdict: the batch was held and Harshil was told
 * "Gmail put every approved copy in Promotions/Spam", which nobody had measured. Every result reads
 * "unknown" when an inbox would not open over IMAP, when the test sends never left, and when fewer than two
 * sending mailboxes are configured, in which case `placementMatrix` sends no test at all and returns empty
 * lists: on a host left with one working app password that is every day from then on, with no mail going out
 * and the wrong reason given. placement.ts's own rule, in its own words, is that only an explicit Promotions
 * or Spam verdict may hold a batch.
 */
test("an unread placement test is told apart from a copy Gmail filed under Promotions", () => {
  const r = (...ps: PlacementResult["placement"][]): PlacementResult[] => ps.map((placement) => ({ from: "a", to: "b", placement, subject: "s" }));
  // What the two cases look like: neither picks a rung, and only one of them is a verdict.
  const unread = r("unknown", "unknown", "unknown");
  const promotions = r("promotions", "promotions", "promotions");
  assert.equal(pickRung([{ key: "full", results: unread }]), null);
  assert.equal(pickRung([{ key: "full", results: promotions }]), null);
  assert.equal(placementRead(unread), false, "nothing was measured");
  assert.equal(placementRead(promotions), true, "Gmail answered, and the answer was Promotions");
  // No test sent at all, which is what one sending mailbox gives.
  assert.equal(placementRead([]), false);
  // One tab read out of three is an answer: a single Spam verdict is the one that matters most.
  assert.equal(placementRead(r("unknown", "unknown", "spam")), true);
  assert.equal(placementRead(r("unknown", "primary", "unknown")), true);
  assert.equal(placementRead(r("unknown", "updates", "unknown")), true);
});

/** And the daily run acts on the difference: held on a verdict, sent on an unread test. */
test("the daily run holds on a verdict and sends the approved copy when it could not read one", () => {
  const src = readFileSync(new URL("../../../scripts/otto-cloud.mts", import.meta.url), "utf8");
  assert.match(src, /const measured = \[\.\.\.matrix\.values\(\)\]\.some\(placementRead\)/, "the run has to ask whether anything was measured");
  assert.match(src, /\} else if \(measured\) \{/, "only a measured verdict may take the holding branch");
  // The holding branch is the only one that stops the run, and it is the only one that claims Promotions.
  const branches = src.split("const measured =")[1];
  const held = branches.slice(branches.indexOf("} else if (measured) {"), branches.indexOf("} else {"));
  assert.match(held, /process\.exit\(0\)/, "a measured Promotions verdict still holds the batch");
  assert.match(held, /Promotions\/Spam/);
  // The unread branch alone, up to the close of the block the placement test sits in.
  const after = branches.slice(branches.indexOf("} else {"));
  const unread = after.slice(0, after.indexOf("\n}\n"));
  assert.doesNotMatch(unread, /process\.exit\(0\)/, "an unread test must not stop the day's outreach");
  assert.match(unread, /could not be read/, "and the alert has to say that is what happened");
});

test("A/B/C: each arm's first email and the follow-up that goes with it", () => {
  assert.deepEqual(ARMS, ["full", "ask", "forgot"]);
  const subject = "Missed calls at " + op.name;
  const to = "info@clockwiseescape.com";
  // C: the first email is the pitch without the recording; the next day's follow-up "forgot" it.
  const c1 = copy({}, "forgot");
  assert.equal(c1.variant, FORGOT_VERSION);
  assert.equal(c1.body, copy({}, "nolink").body, "the same body as the nolink rung, so its placement is nolink's");
  assert.ok(!c1.body.includes("onoutset.com/otto") && !/recording/i.test(c1.body), c1.body);
  const c2 = draftOttoBump(op, to, { subject, firstVariant: c1.variant });
  assert.equal(c2.variant, BUMP_FORGOT_VERSION);
  assert.ok(c2.body.includes("Shoot, forgot to put this in my last email. Here's a 40-second recording of it on a real call: https://onoutset.com/otto"), c2.body);
  assert.ok(c2.html.includes('<a href="https://onoutset.com/otto">give it a listen</a>'), c2.html);
  // B: the first email asks; the follow-up sends what it asked to send, and keeps the no-link sign-off.
  const b2 = draftOttoBump(op, to, { subject, firstVariant: copy({}, "ask").variant });
  assert.equal(b2.variant, BUMP_ASK_VERSION);
  assert.ok(b2.body.includes("Here's the recording in case it's quicker than replying: https://onoutset.com/otto. It's a real call, about 40 seconds."), b2.body);
  assert.ok(b2.body.includes("I can set one up for " + op.name + " for free so you can call it yourself."), b2.body);
  assert.ok(b2.body.includes('just reply "stop"') && !b2.body.includes("unsubscribe"), b2.body);
  assert.equal((b2.html.match(/<a /g) || []).length, 1, "the recording, nothing else");
  // A, and anything sent before the test: the free-test-line follow-up.
  assert.equal(draftOttoBump(op, to, { subject, firstVariant: COPY_VERSION }).variant, BUMP_VERSION);
  assert.equal(draftOttoBump(op, to, { subject, firstVariant: "2026-10-03" }).variant, BUMP_VERSION);
  assert.equal(draftOttoBump(op, to, { subject }).variant, BUMP_VERSION);
  for (const b of [b2, c2]) {
    assert.equal(b.subject, "Re: " + subject);
    assert.ok(!b.body.includes("—") && !/!/.test(b.body), b.body);
    assert.ok(b.body.split("--")[0].split("\nHarshil\n")[0].split(/\s+/).length < 50, "a short note");
  }
});

test("a first email's arm is read off its variant", () => {
  assert.equal(armOf(FORGOT_VERSION), "forgot");
  assert.equal(armOf(COPY_VERSION + "-ask"), "ask");
  assert.equal(armOf(COPY_VERSION), "full");
  assert.equal(armOf(COPY_VERSION + "-nolink"), "full", "a fallback rung follows up like the full pitch");
  assert.equal(armOf(null), "full");
});
