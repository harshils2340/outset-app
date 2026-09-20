import test from "node:test";
import assert from "node:assert/strict";
import { proxied, renders } from "../coverlive.ts";

/**
 * What counts as a cover that loads.
 *
 * Browse promises a photograph, and the question "does this URL still show one" is the whole of what this
 * screen decides, so the answer has to mean what a guest's browser would get rather than what the origin
 * server claims. Everything goes through the same wsrv.nl proxy the app draws with, because that is the
 * thing that actually has to succeed: an origin that answers 200 to us and refuses the proxy is dead as far
 * as the page is concerned.
 */

const withFetch = async <T,>(answer: (url: string) => Response, fn: () => Promise<T>): Promise<T> => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) =>
    answer(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
};

const image = (bytes: number) => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/webp" } });

test("the check goes through the proxy the app itself draws with, not the origin", () => {
  const u = proxied("https://shop.example.com/boat.jpg");
  assert.ok(u.startsWith("https://wsrv.nl/?url="));
  // The scheme is stripped the way the app strips it, or the proxy is asked for a different resource than
  // the one the page will ask for and the answer stops meaning anything.
  assert.ok(u.includes(encodeURIComponent("shop.example.com/boat.jpg")));
  assert.ok(!u.includes(encodeURIComponent("https://")));
});

test("a real image counts as loading", async () => {
  assert.equal(await withFetch(() => image(40_000), () => renders("https://x.example/a.jpg")), true);
});

test("a 404 does not, however cheerfully the proxy phrases it", async () => {
  const notFound = new Response(JSON.stringify({ error: "404" }), { status: 404, headers: { "content-type": "application/json" } });
  assert.equal(await withFetch(() => notFound, () => renders("https://x.example/a.jpg")), false);
});

test("a 200 that is not an image does not count", async () => {
  // An origin that has been replaced by a parking page answers 200 with HTML, and the card would draw nothing.
  const html = new Response("<html>for sale</html>", { status: 200, headers: { "content-type": "text/html" } });
  assert.equal(await withFetch(() => html, () => renders("https://x.example/a.jpg")), false);
});

test("a 200 image of almost no bytes does not count either", async () => {
  // wsrv answers 200 with a near-empty body for some upstream failures. A photograph is never 100 bytes, and
  // taking this at face value would repoint a cover at something that draws as a blank tile.
  assert.equal(await withFetch(() => image(100), () => renders("https://x.example/a.jpg")), false);
});

test("a network failure is a dead cover, not an exception", async () => {
  const boom = () => { throw new Error("ECONNREFUSED"); };
  assert.equal(await withFetch(boom as never, () => renders("https://x.example/a.jpg")), false);
});
