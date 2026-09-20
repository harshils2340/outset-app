import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { apiOrigin, withApiOrigin, withApiPreconnect } from "../csp";

/**
 * The site's Content-Security-Policy is a meta tag in index.html, and its connect-src named the production API
 * host alone. Every build pointed anywhere else, the dev server, the nightly rehearsal, a preview deploy, had
 * every API call refused by the browser before it left the page: the claim screen showed no test bypass, no
 * operator edit reached the API, no booking was ever sent, and `src/lib/api.ts` reported all of it as "no API",
 * which is silent by design. These pin the build-time repair and the two Stripe hosts the payment form needs.
 */

const INDEX = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
/** The policy itself, not the comment above it that names the same directives. */
const policyOf = (html: string) => html.match(/http-equiv=["']Content-Security-Policy["'][^>]*?content="([^"]*)"/i)?.[1] || "";
const sourcesIn = (html: string, name: string) => (policyOf(html).match(new RegExp(name + " ([^;]+)"))?.[1] || "").trim().split(/\s+/);
const directive = (name: string) => sourcesIn(INDEX, name);

test("the shipped policy still names the production API, so a build with no VITE_API_URL works", () => {
  assert.ok(directive("connect-src").includes("https://outset-api.onrender.com"));
  assert.ok(directive("connect-src").includes("'self'"));
});

test("Stripe.js and the 3D Secure challenge frame are both allowed", () => {
  // Stripe.js is injected as a script tag and renders the embedded form in its own frame; a card that needs
  // 3D Secure gets its challenge from hooks.stripe.com, so a missing entry fails the payment, not the frame.
  assert.ok(directive("script-src").includes("https://js.stripe.com"));
  assert.ok(directive("frame-src").includes("https://js.stripe.com"));
  assert.ok(directive("frame-src").includes("https://hooks.stripe.com"));
  assert.ok(directive("connect-src").includes("https://api.stripe.com"));
});

test("a build against a local API can reach it, and nothing else about the page moves", () => {
  const out = withApiOrigin(INDEX, "http://localhost:8787");
  // The one and only edit is the added source. Without this, a replacement that dropped the attribute's closing
  // quote still read back correctly through a regex, and Vite refused to parse the page at all.
  assert.equal(out.replace(" http://localhost:8787", ""), INDEX);
  const list = sourcesIn(out, "connect-src");
  assert.ok(list.includes("http://localhost:8787"), "the local API origin is in connect-src");
  // Nothing the policy already allowed is lost.
  assert.ok(list.includes("'self'"));
  assert.ok(list.includes("https://outset-api.onrender.com"));
  assert.ok(list.includes("https://photon.komoot.io"));
  assert.ok(list.includes("https://api.stripe.com"));
});

test("a path on the API URL is reduced to its origin, which is what a CSP source is", () => {
  assert.equal(apiOrigin("https://api.example.com/v1/"), "https://api.example.com");
  assert.equal(apiOrigin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
});

test("nothing that is not an http origin reaches the policy", () => {
  for (const bad of ["", "   ", undefined, "not a url", "javascript:alert(1)", "file:///etc/passwd", "//evil.example"]) {
    assert.equal(apiOrigin(bad), "", `${String(bad)} is not an origin`);
    assert.equal(withApiOrigin(INDEX, bad), INDEX, `${String(bad)} leaves the policy alone`);
  }
});

test("the production origin is not added to itself twice", () => {
  assert.equal(withApiOrigin(INDEX, "https://outset-api.onrender.com"), INDEX);
});

test("a page with no policy at all is left as it is", () => {
  const plain = "<!doctype html><html><head><title>x</title></head><body></body></html>";
  assert.equal(withApiOrigin(plain, "http://localhost:8787"), plain);
});

test("only connect-src moves; the other directives are untouched", () => {
  const out = withApiOrigin(INDEX, "http://localhost:8787");
  for (const d of ["script-src", "frame-src", "style-src", "form-action", "default-src"]) {
    assert.deepEqual(sourcesIn(out, d), sourcesIn(INDEX, d), d);
  }
});

/**
 * The API's connection is opened while the page parses, because the first thing the app asks it is /where, and
 * /where is what decides which city the home opens on. The call itself is a header read and answers in
 * milliseconds; the handshake in front of it, cold, is three round trips the guest spends looking at the page.
 */
test("the shipped page opens the production API's connection before anything asks for it", () => {
  assert.match(INDEX, /<link rel="preconnect" href="https:\/\/outset-api\.onrender\.com" crossorigin \/>/);
});

test("the preconnect is anonymous, because every call to the API is", () => {
  // Nothing in src/lib/api.ts sets `credentials`, so each fetch is cross-origin with the default
  // `same-origin` and therefore sends none. A preconnect without `crossorigin` warms the credentialled pool
  // instead, which no call ever uses, and the first fetch pays for the handshake anyway.
  const tag = INDEX.match(/<link rel="preconnect" href="https:\/\/outset-api[^>]*>/)?.[0] || "";
  assert.ok(tag.includes("crossorigin"), tag);
});

test("a build against another API opens that one's connection too", () => {
  const out = withApiPreconnect(INDEX, "http://localhost:8787/");
  assert.ok(out.includes('<link rel="preconnect" href="http://localhost:8787" crossorigin />'));
  // The one and only edit is the added tag, as with connect-src above.
  assert.equal(out.replace('    <link rel="preconnect" href="http://localhost:8787" crossorigin />\n', ""), INDEX);
});

test("the production origin is not preconnected twice, and a page with no head is left alone", () => {
  assert.equal(withApiPreconnect(INDEX, "https://outset-api.onrender.com"), INDEX);
  assert.equal(withApiPreconnect("<p>no head here</p>", "http://localhost:8787"), "<p>no head here</p>");
});

test("nothing that is not an http origin is preconnected", () => {
  for (const bad of ["", "   ", undefined, "not a url", "javascript:alert(1)", "//evil.example"]) {
    assert.equal(withApiPreconnect(INDEX, bad), INDEX, `${String(bad)} leaves the page alone`);
  }
});
