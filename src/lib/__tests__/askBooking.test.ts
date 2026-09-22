import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The form the agent takes a booking in, which is the one place in that thread a guest types anything but a
 * sentence. Driven in a real Chromium at 400px and 1280px, and pinned here so the three things that were
 * wrong with it cannot come back:
 *
 * 1. Its three fields were named by their placeholders alone, which is the only guest form in the app that
 *    is, and the mobile field asked a phone for a full QWERTY keyboard because it carried no `inputMode`.
 * 2. Book returned silently on a half-typed name or number. `missingFrom` now says which.
 * 3. A shop the catalog has never held gets a minted "cg-" id, the API has no listing file for one, and its
 *    404 ("no such listing") was read out in the agent's own voice after the guest had typed their details.
 *
 * The repo has no renderer, so this reads the file, the way `askWiring` and `conciergeStyles` do.
 */

const TSX = readFileSync(new URL("../../components/web/WebConcierge.tsx", import.meta.url), "utf8");
const form = TSX.slice(TSX.indexOf('className="cg-guest"'), TSX.indexOf("</form>", TSX.indexOf('className="cg-guest"')));

test("every field in the agent's booking form has a name a screen reader can read", () => {
  const inputs = [...form.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(inputs.length, 3, "the form takes a name, a mobile and an email");
  for (const tag of inputs) {
    const id = /id=\{guestId \+ "-([a-z]+)"\}/.exec(tag);
    assert.ok(id, "an input with no id, so no label can point at it: " + tag.slice(0, 80));
    assert.match(form, new RegExp('htmlFor=\\{guestId \\+ "-' + id[1] + '"\\}'), "no label for the " + id[1] + " field");
  }
});

test("a phone is offered its own keypad for a phone number, as everywhere else in the app", () => {
  assert.match(form, /placeholder="Mobile"[^>]*inputMode="tel"/, "the mobile field asks for a QWERTY keyboard");
  assert.match(form, /placeholder="Email"[^>]*inputMode="email"/, "the email field asks for a QWERTY keyboard");
});

test("Book can never be a press that does nothing", () => {
  assert.match(form, /missingFrom\(guestForm\)/, "the form no longer measures what is missing");
  assert.match(form, /setNeedMore\(/, "nothing is said when something is missing");
  assert.match(form, /role="alert"/, "what is missing is not announced");
  assert.doesNotMatch(form, /length < 2 \|\| /, "a second copy of the rule has grown back beside missingFrom");
});

test("a shop the catalog has never held is refused before the guest is asked for anything", () => {
  assert.match(TSX, /id\.startsWith\("cg-"\)/, "a minted stub id is sent to POST /bookings again");
  assert.match(TSX, /guestWords\(r\.error\)/, "the API's own error string is spoken in the agent's voice again");
});
