import { strict as assert } from "node:assert";
import test from "node:test";
import { CONCIERGE_PAGE } from "../conciergePage.ts";

/**
 * The concierge page is the one screen this service serves to a person rather than to the app, and it is one
 * string with no build step, so nothing else looks at it. Two house rules are worth holding it to.
 *
 * Every name it draws came off somebody else's website: the business name as our crawl read it, the town, the
 * trip name and the ticket label straight out of the shop's booking system. Concatenated into innerHTML, a
 * business called "<img onerror=...>" runs its own script in a guest's browser, which is the hole the static
 * listing pages were carrying until this week.
 */

/** Lines that end in a `+` carry on into the next one; markup here is built across four of them at a time. */
function statements(source: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of source.split("\n")) {
    buf += line.trim();
    if (/\+$/.test(buf)) continue;
    out.push(buf);
    buf = "";
  }
  if (buf) out.push(buf);
  return out;
}

/** What the shop, the town or the vendor wrote. Numbers we worked out ourselves are not in this list. */
const FROM_ELSEWHERE = "(?:name|item|city|phone|priceLabel|time|categoryLabel|when|rating|unit|loosened|party|maxPerPerson)";
const GLUED_IN = new RegExp(`\\+\\s*[a-z]+\\.${FROM_ELSEWHERE}\\b|\\b[a-z]+\\.${FROM_ELSEWHERE}\\s*\\+`);

test("nothing read off somebody else's site is glued into markup unescaped", () => {
  assert.ok(/const esc = s =>/.test(CONCIERGE_PAGE), "the page should carry an escaper");
  const offences = statements(CONCIERGE_PAGE)
    .filter((s) => /innerHTML|step\(/.test(s))
    // esc(...) is the whole point; what is left after taking those out is what goes in raw.
    .map((s) => s.replace(/esc\([^()]*\)/g, "SAFE"))
    .filter((s) => GLUED_IN.test(s));
  assert.deepEqual(offences, []);
});

test("the escaper closes a tag, an attribute and an entity", () => {
  // Run the page's own escaper rather than a copy of it, so the copy cannot drift from what is served.
  const line = CONCIERGE_PAGE.split("\n").find((l) => l.startsWith("const esc = "));
  assert.ok(line, "the escaper should be one line the page defines at the top");
  const esc = new Function(line + "\nreturn esc;")() as (s: unknown) => string;
  assert.equal(esc('<img src=x onerror="go()">'), "&lt;img src=x onerror=&quot;go()&quot;&gt;");
  assert.equal(esc("Smith & Sons"), "Smith &amp; Sons");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(4.7), "4.7");
});

test("the page keeps the house rule on dashes", () => {
  const lines = CONCIERGE_PAGE.split("\n").filter((l) => l.includes("—"));
  assert.deepEqual(lines, [], "an em dash reaches a guest from here");
});
