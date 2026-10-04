import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * What the phone agent remembers when the site does not answer about a listing.
 *
 * The facts route reads the site's own `o/<id>.json` over HTTP and caches the answer for ten minutes, a miss
 * included. The site sits behind Cloudflare, so a 403 challenge, a 429 or a 408 are all the question not
 * getting through, and remembering one as "there is no such business" takes one blip and turns it into ten
 * minutes of the agent telling every caller it has never heard of the shop.
 */

process.env.SITE_URL = "https://onoutset.com/";
const { voice, remembersMiss, resetVoiceCacheForTests, voiceCacheSize } = await import("../voice.ts");

const shop = {
  id: "o-blip-com",
  title: "Blip Charters",
  area: "Tampa, FL",
  options: [{ name: "Half day", price: 500 }],
};

/** What the site answers next, one status per call, so a retry can be given a different answer. */
let answers: number[] = [];
let asked = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === `https://onoutset.com/o/${shop.id}.json`) {
    const status = answers[asked++] ?? 200;
    if (status === 200) return new Response(JSON.stringify(shop), { status, headers: { "content-type": "application/json" } });
    return new Response("no", { status });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

test("only the site's own 404 and 410 say a listing does not exist", () => {
  assert.equal(remembersMiss(404), true);
  assert.equal(remembersMiss(410), true);
  // A Cloudflare challenge, a rate limit, a timeout at the edge and a bad gateway are not about the listing.
  for (const status of [400, 401, 403, 408, 425, 429, 451, 500, 502, 503, 504]) assert.equal(remembersMiss(status), false, String(status));
});

test("a Cloudflare 403 about a real listing is not remembered as no such business", async () => {
  answers = [403, 200];
  asked = 0;
  const first = await voice.request(`http://localhost/voice/${shop.id}`);
  assert.equal(first.status, 404, "the blip itself answers honestly that nothing is known");
  const second = await voice.request(`http://localhost/voice/${shop.id}`);
  assert.equal(second.status, 200, "the next call asks again rather than repeating the blip for ten minutes");
  assert.equal(((await second.json()) as { business: { name: string } }).business.name, "Blip Charters");
  assert.equal(asked, 2, "the second call went back to the site");
});

test("a 429 is not remembered either, and the availability route stops refusing the shop with it", async () => {
  answers = [429, 200];
  asked = 0;
  const first = await voice.request(`http://localhost/voice/${shop.id}/availability`);
  // The availability route answers from the calendar, not the record, so it stays 200; what matters is that
  // the record was not remembered as missing, which the facts route right after it shows.
  assert.equal(first.status, 200);
  const second = await voice.request(`http://localhost/voice/${shop.id}`);
  assert.equal(second.status, 200, "the rate limit was not remembered as a missing listing");
});

test("a real 404 is remembered, so a caller asking for a shop that is not there costs one fetch", async () => {
  answers = [404, 404, 404];
  asked = 0;
  const id = "o-not-a-shop-com";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `https://onoutset.com/o/${id}.json`) {
      asked++;
      return new Response("no", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  assert.equal((await voice.request(`http://localhost/voice/${id}`)).status, 404);
  assert.equal((await voice.request(`http://localhost/voice/${id}`)).status, 404);
  assert.equal(asked, 1, "the site's own no is worth remembering");
});

test("the cache is capped, so ids callers walk cannot grow it for the life of the process", async () => {
  resetVoiceCacheForTests();
  globalThis.fetch = (async () => new Response("no", { status: 404 })) as typeof fetch;
  // Each request from its own caller, since the per-IP limit holds any one of them to 120 an hour and the
  // growth that matters is across callers and across the life of the process.
  for (let i = 0; i < 620; i++) {
    await voice.request(`http://localhost/voice/o-walked-${i}-com`, { headers: { "cf-connecting-ip": `203.0.113.${i % 254}` } });
  }
  assert.equal(voiceCacheSize(), 500, "the cap is reached and held, not cleared out from under the live entries");
});

test("asking about the same listing twice does not spend two of the cap's places", async () => {
  resetVoiceCacheForTests();
  globalThis.fetch = (async () => new Response("no", { status: 404 })) as typeof fetch;
  await voice.request("http://localhost/voice/o-same-com", { headers: { "cf-connecting-ip": "203.0.113.254" } });
  await voice.request("http://localhost/voice/o-same-com", { headers: { "cf-connecting-ip": "203.0.113.254" } });
  assert.equal(voiceCacheSize(), 1);
});
