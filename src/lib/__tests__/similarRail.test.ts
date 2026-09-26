import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { pickSimilar } from "../similar";

/**
 * The "More like this" rail under a listing.
 *
 * It picks from two overlapping pools, the same metro and the same state or province, and a shop in this
 * metro is nearly always in this region too. When neither pool had four in it the rail used both, merged and
 * not deduped, so it drew the same business as two cards in a row. 483 shipped listings had one, and on 253
 * of them at least half the rail was repeats: Blitz Paintball in Dacono, Colorado, suggested Loveland Laser
 * Tag twice and nothing else. React warned about the repeated key on every one of them.
 */

let n = 0;
function op(over: Partial<Unclaimed> = {}): Unclaimed {
  n += 1;
  return {
    id: "o-sim-" + n,
    title: "Shop " + n,
    cat: "land",
    art: "paintball",
    metroId: "denver",
    area: "Dacono, CO",
    src: "sim" + n + ".example.com",
    blurb: "",
    gap: "",
    options: [],
    specs: [],
    includes: [],
    ...over,
  } as unknown as Unclaimed;
}

test("a shop in this metro and this region is offered once, not twice", () => {
  const me = op();
  const neighbour = op({ area: "Loveland, CO" });
  const { similar } = pickSimilar(me, [me, neighbour]);
  assert.deepEqual(similar.map((u) => u.id), [neighbour.id]);
});

test("the rail never carries the same id twice, however thin the metro", () => {
  const me = op();
  const pool = [me, op({ area: "Loveland, CO" }), op({ area: "Golden, CO" }), op({ metroId: "", area: "Pueblo, CO" })];
  const { similar } = pickSimilar(me, pool);
  assert.equal(new Set(similar.map((u) => u.id)).size, similar.length);
  assert.ok(!similar.some((u) => u.id === me.id), "and never the listing the guest is already on");
});

test("a metro with four of its own stays in the metro", () => {
  const me = op();
  const here = [op(), op(), op(), op()];
  const elsewhere = op({ metroId: "boulder", area: "Boulder, CO" });
  const { similar, similarNear } = pickSimilar(me, [me, ...here, elsewhere]);
  assert.equal(similarNear, true);
  assert.deepEqual(similar.map((u) => u.id).sort(), here.map((u) => u.id).sort());
});

test("a shop with no neighbour at all still gets a rail, and it is not called near", () => {
  const me = op({ metroId: "denver", area: "Dacono, CO" });
  const faraway = op({ metroId: "tampa", area: "Tampa, FL" });
  const { similar, similarNear } = pickSimilar(me, [me, faraway]);
  assert.deepEqual(similar.map((u) => u.id), [faraway.id]);
  assert.equal(similarNear, false);
});

test("only the same activity, and a shop with a photo leads", () => {
  const me = op();
  const other = op({ art: "kart" });
  const plain = op({ area: "Golden, CO" });
  const withCover = op({ area: "Golden, CO", cover: "https://example.com/p.jpg" });
  const { similar } = pickSimilar(me, [me, other, plain, withCover]);
  assert.ok(!similar.some((u) => u.id === other.id), "a karting track is not more of this paintball field");
  assert.equal(similar[0].id, withCover.id);
});

test("the catalog it was handed is left as it was", () => {
  const me = op();
  const a = op({ area: "Golden, CO", reviews: 2 });
  const b = op({ area: "Golden, CO", reviews: 90 });
  const catalog = [me, a, b];
  const order = catalog.map((u) => u.id);
  pickSimilar(me, catalog);
  assert.deepEqual(catalog.map((u) => u.id), order);
});

/**
 * A town that sits in no metro is not a shop with no neighbours. 1,260 shipped listings have an empty
 * `metroId`, so the both-pools branch, which asked for a neighbour in this metro before it would run, was
 * unreachable for them and the rail fell through to the whole catalog: Countdown Games in Lexington, KY drew
 * escape rooms in Texas while Emerge in La Grange, KY sat in the pool unread.
 */
test("a shop in no metro is offered its own state before the rest of the country", () => {
  const me = op({ metroId: "", area: "Lexington, KY" });
  const inState = op({ metroId: "", area: "La Grange, KY" });
  const farAway = [op({ metroId: "tampa", area: "Tampa, FL", reviews: 900, cover: "https://example.com/a.jpg" }), op({ metroId: "austin", area: "Austin, TX", reviews: 800, cover: "https://example.com/b.jpg" })];
  const { similar, similarNear } = pickSimilar(me, [me, inState, ...farAway]);
  assert.deepEqual(similar.map((u) => u.id), [inState.id], "one shop in Kentucky beats two better-reviewed ones two thousand miles off");
  assert.equal(similarNear, false, "and a state is not a metro, so the heading does not say near");
});

test("one or two in the state, with none in the metro, is still the state and not the country", () => {
  const me = op({ metroId: "denver", area: "Dacono, CO" });
  const inState = [op({ metroId: "", area: "Pueblo, CO" }), op({ metroId: "", area: "Durango, CO" })];
  const elsewhere = op({ metroId: "tampa", area: "Tampa, FL", reviews: 900 });
  const { similar } = pickSimilar(me, [me, ...inState, elsewhere]);
  assert.deepEqual(similar.map((u) => u.id).sort(), inState.map((u) => u.id).sort());
});

test("a shop with no neighbour in its metro or its state still reaches the whole catalog", () => {
  const me = op({ metroId: "", area: "Bethany Beach, DE" });
  const faraway = op({ metroId: "tampa", area: "Tampa, FL" });
  const { similar, similarNear } = pickSimilar(me, [me, faraway]);
  assert.deepEqual(similar.map((u) => u.id), [faraway.id]);
  assert.equal(similarNear, false);
});
