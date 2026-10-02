import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BAD_EMAIL_ASK, BAD_EMAIL_CTA, BAD_EMAIL_LINE, GUEST_EMAIL_MAX, guestEmailOk } from "../guestEmail";
import { guestWords } from "../concierge";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** The regex `POST /bookings` refuses an address by, read off the route itself rather than copied. */
const API_RULE = (() => {
  const route = src("../../../backend/src/api/bookings.ts");
  const line = route.split("\n").find((l) => l.includes('"bad email"'));
  assert.ok(line, "POST /bookings no longer refuses a bad email, so this rule has moved");
  const m = line!.match(/!(\/\^.*\$\/)\.test/);
  assert.ok(m, "could not read the email regex out of POST /bookings: " + line);
  return m![1];
})();

test("the client's rule is the API's own rule, not a stricter one", () => {
  assert.equal(API_RULE, "/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/");
  assert.ok(src("../guestEmail.ts").includes(API_RULE), "guestEmailOk has drifted from POST /bookings");
  // A client stricter than the server refuses a booking the server would have taken. "a@b.c" is the case:
  // `validOwnerEmail` next door asks for a two-letter TLD, which is a different promise.
  assert.equal(guestEmailOk("a@b.c"), true);
});

test("an empty box is fine, because nobody is made to leave an address", () => {
  for (const empty of ["", "   ", null, undefined]) assert.equal(guestEmailOk(empty), true, JSON.stringify(empty));
});

test("the five typos that used to lose the whole booking", () => {
  for (const typed of [
    "harshil@gmial",       // no TLD
    "harshil.gmail.com",   // no @
    "harshil@ gmail.com",  // a stray space
    "harshil@gmail,com",   // a comma for the dot
    "Harshil Shah",        // a name typed in the email box
  ]) {
    assert.equal(guestEmailOk(typed), false, JSON.stringify(typed) + " still reaches POST /bookings");
  }
  assert.equal(guestEmailOk("harshil@gmail.com"), true);
  assert.equal(guestEmailOk("  harshil@gmail.com  "), true, "a pasted address with spaces round it");
});

test("an address past the API's cap is refused here rather than cut down there", () => {
  assert.equal(GUEST_EMAIL_MAX, 200);
  assert.equal(guestEmailOk("a".repeat(190) + "@b.com"), true);
  assert.equal(guestEmailOk("a".repeat(200) + "@b.com"), false);
});

test("all three booking surfaces read the one rule", () => {
  for (const file of [
    "../../components/web/WebListing.tsx",
    "../../components/booking/Sheets.tsx",
    "../../components/web/WebConcierge.tsx",
  ]) {
    assert.match(src(file), /guestEmailOk\(/, file + " sends the guest's email to the API unread again");
  }
});

test("the reserve button on both booking surfaces says the address is what is wrong", () => {
  // The label used to say "Add your name and number" while the name and the number were both filled in.
  assert.match(src("../../components/web/WebListing.tsx"), /!emailOk \? BAD_EMAIL_CTA/);
  assert.match(src("../../components/booking/Sheets.tsx"), /!emailOk \? BAD_EMAIL_CTA/);
  assert.ok(BAD_EMAIL_CTA.length < 32, "a button label this long wraps the reserve box");
  for (const line of [BAD_EMAIL_LINE, BAD_EMAIL_ASK, BAD_EMAIL_CTA]) {
    assert.ok(!/[—–]/.test(line), "an em or en dash in guest copy: " + line);
  }
});

test("no API refusal code is printed to a guest, on any of the three surfaces", () => {
  // The two words a mistyped address used to put under the Reserve button, and the rest of the route's codes.
  for (const code of ["bad email", "duplicate code", "no such listing", "bad listing", "bad date", "bad time", "bad guest count", "bad code"]) {
    assert.equal(guestWords(code), "That time could not be booked. Check the details and try again.", code + " reached a guest");
  }
  // A sentence the route wrote for a person still reaches them, now finished with a full stop.
  assert.equal(guestWords("This listing is hidden right now"), "This listing is hidden right now.");
  assert.equal(guestWords("That time was just booked. Pick another time."), "That time was just booked. Pick another time.");
  const app = src("../../state/AppProvider.tsx");
  assert.match(app, /guestWords\(r\.error\)/, "confirmUnclaimed prints the API's own string again");
  assert.ok(!/r\.error \+ "\."/.test(app), "confirmUnclaimed still appends a full stop to a code");
  // A refusal with no words at all is the call failing, which is a connection and not a detail.
  assert.match(app, /Check your connection and try again/);
});
