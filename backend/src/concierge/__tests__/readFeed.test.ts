import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFeed } from "../readFeed.ts";
import { READER_VENDORS, readerFor, type ReaderVendor } from "../readable.ts";

/**
 * Which reader `readFeed` actually calls.
 *
 * `liveFor.test.ts` already checks that every vendor the router can name has a `case` in this switch, by
 * reading the source. That cannot see whether the branch calls the right reader: `case "peek": return
 * resovaLive(...)` passes it, and a Peek shop would then be told there is no feed to read while its times
 * sat there. One wrong line in a twelve-way dispatch is a whole vendor's worth of shops going quiet, and
 * nothing here had ever driven it.
 *
 * So each vendor's link goes through `readFeed` with the network stubbed, and the host the reader asks for
 * says which reader ran.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * A link of each vendor's own shape, every one of which that vendor's `*Ref` parser accepts, against the
 * host its reader goes to. Rezdy is the exception and says so below.
 */
const LINKS: Record<Exclude<ReaderVendor, "rezdy">, [url: string, host: RegExp]> = {
  fareharbor: ["https://fareharbor.com/embeds/book/zoomtours/?full-items=yes", /(^|\.)fareharbor\.com$/],
  resova: ["https://escapology-orlando.resova.us/booking", /(^|\.)resova\./],
  peek: ["https://book.peek.com/s/abc12345-1111-2222-3333-444455556666/ABCDE", /(^|\.)peek\.com$/],
  checkfront: ["https://adventureroomscanada.checkfront.com/reserve/", /(^|\.)checkfront\.com$/],
  xola: ["https://checkout.xola.com/#buttons/5a1b2c3d4e5f60718293a4b5", /(^|\.)xola\.(com|app)$/],
  tripworks: ["https://bookings.tripworks.com/shop/abcdef", /(^|\.)tripworks\.com$/],
  square: ["https://book.squareup.com/appointments/abc123/location/LZZZ/services", /(^|\.)squareup\.com$/],
  acuity: ["https://app.acuityscheduling.com/schedule.php?owner=12345678", /(^|\.)acuityscheduling\.com$/],
  foreup: ["https://foreupsoftware.com/index.php/booking/20012/3456", /(^|\.)foreupsoftware\.com$/],
  areservation: ["https://www.areservation.com/event/sunsetcruises/", /(^|\.)areservation\.com$/],
  fishingreservations: ["https://captainbob.fishingreservations.net/trips/", /(^|\.)fishingreservations\.net$/],
};

/** Every host a read asked for, with the network answering nothing useful. */
async function hostsAskedBy(url: string): Promise<string[]> {
  const hosts: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    try {
      hosts.push(new URL(String(u)).hostname);
    } catch {
      hosts.push(String(u));
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await readFeed(url, { from: new Date(), days: 1, tz: "America/Toronto" });
  return [...new Set(hosts)];
}

for (const [vendor, [url, host]] of Object.entries(LINKS) as [ReaderVendor, [string, RegExp]][]) {
  test(`a ${vendor} link is routed to the ${vendor} reader`, async () => {
    assert.equal(readerFor(url), vendor, "the router does not call this link a " + vendor + " one");
    const hosts = await hostsAskedBy(url);
    assert.ok(hosts.length, "the reader asked for nothing at all");
    assert.ok(
      hosts.some((h) => host.test(h)),
      `a ${vendor} link reached ${hosts.join(", ")} instead`,
    );
  });
}

test("every vendor the router can name is driven here, or says why not", () => {
  /**
   * Rezdy is the one vendor whose reader does not go through `fetch`: Cloudflare blocks it on every
   * `*.rezdy.com` subdomain, so that reader hand-rolls an HTTP/2 session and there is no host for this test
   * to watch. Its price helpers and its window rule are tested directly in `rezdy.test.ts`, and its branch
   * in the dispatch is held by the source check in `liveFor.test.ts`.
   */
  const driven = new Set(Object.keys(LINKS));
  assert.deepEqual(READER_VENDORS.filter((v) => !driven.has(v)), ["rezdy"]);
});

test("a link no reader knows is answered plainly rather than handed to one", async () => {
  /**
   * FareHarbor used to be the fallback, so every hand-built booking page was given to a reader that answers
   * null for it anyway. Saying so lets the caller route the shop to the browser agent instead.
   */
  const hosts: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    hosts.push(String(u));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  assert.equal(await readFeed("https://kwescape.ca/booknow/", { from: new Date(), days: 1 }), null);
  assert.deepEqual(hosts, [], "an unreadable link was fetched by somebody");
});
