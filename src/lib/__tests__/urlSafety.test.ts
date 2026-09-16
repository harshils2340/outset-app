import assert from "node:assert/strict";
import test from "node:test";
import { isHttpsUrlOnHost, isPublicHttpUrl, safeHttpUrl } from "../urlSafety";
import { siteUrl } from "../catalog";
import { thumb, srcSet } from "../images";
import { isSafeEmbedUrl, listingMedia } from "../media";

/**
 * Every URL sink the site renders (covers, photos, video embeds, operator website links, the wsrv.nl proxy,
 * checkoutUrl) starts as crawled, operator, or guest text. A javascript: href executes the moment a guest
 * clicks it, confirmed against a real browser during this review, so this locks that shut everywhere it was
 * open.
 */

test("only http and https survive, nothing else", () => {
  assert.ok(isPublicHttpUrl("https://example.com/photo.jpg"));
  assert.ok(isPublicHttpUrl("http://example.com"));
  assert.ok(!isPublicHttpUrl("javascript:alert(1)"));
  assert.ok(!isPublicHttpUrl("data:image/svg+xml,<svg onload=alert(1)>"));
  assert.ok(!isPublicHttpUrl("file:///etc/passwd"));
  assert.ok(!isPublicHttpUrl("blob:https://example.com/uuid"));
  assert.ok(!isPublicHttpUrl("vbscript:msgbox(1)"));
});

test("a protocol-relative string with no base is not a parseable absolute URL", () => {
  // "https:evil.com" is not a trick: the URL parser normalizes it to the same
  // "https://evil.com/" a plain absolute URL would give, so it is judged the same way.
  assert.ok(!isPublicHttpUrl("//evil.com/x"));
});

test("localhost and private ranges are refused even over https", () => {
  assert.ok(!isPublicHttpUrl("http://localhost/x"));
  assert.ok(!isPublicHttpUrl("http://127.0.0.1/x"));
  assert.ok(!isPublicHttpUrl("http://10.0.0.5/x"));
  assert.ok(!isPublicHttpUrl("http://192.168.1.1/x"));
  assert.ok(!isPublicHttpUrl("http://169.254.169.254/latest/meta-data"));
  assert.ok(!isPublicHttpUrl("http://[::1]/x"));
});

test("a real public https URL passes untouched", () => {
  assert.equal(safeHttpUrl("https://operator-site.example/tickets"), "https://operator-site.example/tickets");
  assert.equal(safeHttpUrl("javascript:alert(1)"), undefined);
  assert.equal(safeHttpUrl(""), undefined);
  assert.equal(safeHttpUrl(undefined), undefined);
});

test("a redirect that must stay on Stripe is checked against Stripe's own host, not just any https URL", () => {
  assert.ok(isHttpsUrlOnHost("https://checkout.stripe.com/c/pay/cs_test_abc", "checkout.stripe.com"));
  assert.ok(isHttpsUrlOnHost("https://connect.stripe.com/setup/e/acct_1/abc", "connect.stripe.com"));
  assert.ok(!isHttpsUrlOnHost("https://checkout.stripe.com.evil.com/phish", "checkout.stripe.com"));
  assert.ok(!isHttpsUrlOnHost("https://evil.com/checkout.stripe.com/", "checkout.stripe.com"));
  assert.ok(!isHttpsUrlOnHost("http://checkout.stripe.com/", "checkout.stripe.com"), "http, not https, must fail");
  assert.ok(!isHttpsUrlOnHost(undefined, "checkout.stripe.com"));
});

test("siteUrl builds an https link for a bare crawled domain", () => {
  assert.equal(siteUrl("example.com"), "https://example.com");
  assert.equal(siteUrl("https://example.com/book"), "https://example.com/book");
});

test("siteUrl refuses a protocol-relative src rather than resolving it to some other host", () => {
  assert.equal(siteUrl("//evil.com"), "");
});

test("siteUrl refuses a javascript: src", () => {
  assert.equal(siteUrl("javascript:alert(document.cookie)"), "");
});

test("the wsrv.nl proxy never receives a non-http(s) URL to re-serve", () => {
  assert.equal(thumb("data:image/svg+xml,<svg onload=alert(1)>"), undefined);
  assert.equal(thumb("javascript:alert(1)"), undefined);
  assert.equal(thumb("file:///etc/passwd"), undefined);
  assert.ok(thumb("https://operator-site.example/cover.jpg", "card")?.startsWith("https://wsrv.nl/?url="));
});

test("srcSet is empty rather than built from an unsafe URL", () => {
  assert.equal(srcSet("data:image/png;base64,xx"), undefined);
  assert.ok(srcSet("https://operator-site.example/cover.jpg", "card")?.includes("wsrv.nl"));
});

test("a video embed is only ever built for YouTube or Vimeo's own player host", () => {
  assert.ok(isSafeEmbedUrl("https://www.youtube.com/embed/abc123"));
  assert.ok(isSafeEmbedUrl("https://player.vimeo.com/video/12345"));
  assert.ok(!isSafeEmbedUrl("https://evil.com/embed/abc123"));
  assert.ok(!isSafeEmbedUrl("javascript:alert(1)"));
  assert.ok(!isSafeEmbedUrl("data:text/html,<script>alert(1)</script>"));
});

test("listingMedia drops a videoEmbed on a host that is not an allowed player, and falls back to photos", () => {
  const media = listingMedia({ cover: "https://operator-site.example/cover.jpg", photos: [], video: undefined, videoEmbed: "https://evil.com/frame" }, new Set());
  assert.ok(!media.some((m) => m.kind === "embed"));
  assert.ok(media.some((m) => m.kind === "photo"));
});

test("listingMedia keeps a real YouTube embed", () => {
  const media = listingMedia({ cover: undefined, photos: [], video: undefined, videoEmbed: "https://www.youtube.com/embed/abc123" }, new Set());
  assert.equal(media[0]?.kind, "embed");
});
