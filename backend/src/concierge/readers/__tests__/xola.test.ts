import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { xolaRef, xolaLive } from "../xola.ts";

/**
 * The ticket sheet a Xola shop publishes, and which row of it a guest is quoted.
 *
 * This reader shipped with no test of any kind, and the price sheet is the part of it a guest actually reads:
 * every filter in `ticketsOf` is a bug we have already shipped once, on a real shop, and the only thing
 * standing behind them was a comment. The vendor is stubbed, because what matters here is what we do with
 * the answer rather than whether Xola replies.
 */

const BUTTON = "a".repeat(24);
const SELLER = "b".repeat(24);
const LINK = `https://checkout.xola.com/index.html#buttons/${BUTTON}`;

type Item = { name?: string | null; unitType?: string | null; visibility?: string | null; prices?: { price?: { min?: number | null } } };

/** Tomorrow, so that "a slot that has already started is not availability" never decides a test. */
const tomorrow = () => {
  const d = new Date(Date.now() + 86400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** One Xola, answering from a table instead of the network. */
function stubXola(exp: { name: string; priceType?: string; price?: number | null; items: Item[] }): void {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (u.includes(`/buttons/${BUTTON}`)) return json({ type: "checkout", seller: { id: SELLER }, items: [{ experience: { id: "e1" } }] });
    if (u.includes(`/sellers/${SELLER}`)) return json({ name: "conTRAPtions Escape Rooms", timezoneName: null });
    if (u.includes("/experiences?seller=")) {
      return json({
        data: [{
          id: "e1",
          name: exp.name,
          status: "published",
          visible: true,
          priceType: exp.priceType ?? "person",
          price: exp.price ?? null,
          catalog: { items: exp.items },
        }],
      });
    }
    if (u.includes("/availability")) return json({ [tomorrow()]: { "1400": 6 } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("a link names its button, its seller, or nothing we can read", () => {
  assert.deepEqual(xolaRef(LINK), { button: BUTTON, seller: null });
  assert.deepEqual(xolaRef(`https://x2-checkout.xola.app/flows/x?button=${BUTTON}&openExternal=true`), { button: BUTTON, seller: null });
  assert.deepEqual(xolaRef(`https://checkout.xola.com/index.html#seller/${SELLER}`), { button: null, seller: SELLER });
  assert.equal(xolaRef("https://fareharbor.com/embeds/book/someshop/"), null);
});

test("a room priced by the size of the team is quoted at its cheapest team price", async () => {
  /**
   * The bug this test exists for. Every escape room on Xola prices by how many are playing, and this file
   * kept its own copy of the concession rule with no capacity guard in it, so "2-4 Players" and "5-8
   * Players" both read as children's fares. With every real tier excluded the headline fell back to the
   * whole sheet, which is how the one row an adult cannot buy became the price on the card: $20, a child's
   * ticket, under a room that sells to grown-ups at $30.
   */
  stubXola({
    name: "The Vault",
    items: [
      { name: "2-4 Players", unitType: "demographic", prices: { price: { min: 35 } } },
      { name: "5-8 Players", unitType: "demographic", prices: { price: { min: 30 } } },
      { name: "Child (5-12)", unitType: "demographic", prices: { price: { min: 20 } } },
    ],
  });
  const read = await xolaLive(LINK);
  assert.equal(read?.departures.length, 1);
  assert.equal(read?.departures[0].fromPrice, 30);
  assert.equal(read?.departures[0].priceLabel, "5-8 Players");
  // Every real figure still travels with the departure, child fare included. Only the headline is chosen.
  assert.deepEqual(read?.departures[0].rates.map((r) => r.price).sort((a, b) => a - b), [20, 30, 35]);
});

test("an age written in numbers is still kept out of the headline", async () => {
  // Channel Islands Outfitters, the sheet the numeric age rule was written for.
  stubXola({
    name: "Sea Cave Kayaking",
    items: [
      { name: "Adults 18+", unitType: "demographic", prices: { price: { min: 285 } } },
      { name: "Wise Ones 65+", unitType: "demographic", prices: { price: { min: 275 } } },
      { name: "Little Ones 5-17", unitType: "demographic", prices: { price: { min: 255 } } },
    ],
  });
  const read = await xolaLive(LINK);
  assert.equal(read?.departures[0].fromPrice, 285);
  assert.equal(read?.departures[0].priceLabel, "Adults 18+");
});

test("a towel is not a way in, and neither is a rate sold through an agent", async () => {
  stubXola({
    name: "Dolphin Cruise",
    items: [
      { name: "Insured Ticket(s)", unitType: "merchandise", prices: { price: { min: 2.6 } } },
      { name: "Wholesale Adult", unitType: "demographic", visibility: "private", prices: { price: { min: 18 } } },
      { name: "Adult", unitType: "demographic", visibility: "public", prices: { price: { min: 42 } } },
    ],
  });
  const read = await xolaLive(LINK);
  assert.equal(read?.departures[0].fromPrice, 42);
  assert.deepEqual(read?.departures[0].rates.map((r) => r.label), ["Adult"]);
});

test("a whole-boat charter has no head price, and says so rather than guessing one", async () => {
  // "Private Cycle Boat Charter, $599" is the boat. Quoted per head it is the "$32 to $250 a head" bug.
  stubXola({ name: "Private Cycle Boat Charter", priceType: "outing", price: 599, items: [] });
  const read = await xolaLive(LINK);
  assert.equal(read?.departures[0].fromPrice, null);
  assert.equal(read?.departures[0].priceLabel, null);
  assert.deepEqual(read?.departures[0].rates, [{ label: "Private Cycle Boat Charter (whole booking)", price: 599, minParty: null, maxParty: null }]);
});

test("a start with no seats left is not offered", async () => {
  stubXola({ name: "Sunset Sail", items: [{ name: "Adult", unitType: "demographic", prices: { price: { min: 55 } } }] });
  const day = tomorrow();
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (u.includes(`/buttons/${BUTTON}`)) return json({ seller: { id: SELLER }, items: [{ experience: { id: "e1" } }] });
    if (u.includes(`/sellers/${SELLER}`)) return json({ name: "Hamptiki", timezoneName: null });
    if (u.includes("/experiences?seller=")) {
      return json({ data: [{ id: "e1", name: "Sunset Sail", status: "published", visible: true, priceType: "person", catalog: { items: [] } }] });
    }
    if (u.includes("/availability")) return json({ [day]: { "1400": 0, "1700": 3 } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const read = await xolaLive(LINK);
  assert.deepEqual(read?.departures.map((d) => d.time), ["17:00"]);
});
