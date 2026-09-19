import assert from "node:assert/strict";
import test from "node:test";
import { ALL_METRO_ID } from "../../data/metros";
import type { CategoryId, Unclaimed } from "../../data/types";
import { searchListings } from "../search";

/**
 * Being in the town the guest named.
 *
 * A listing in the metro a guest names has always been lifted for it. Only the 47 metros counted, though, so
 * a guest who named any other town got nothing for being in it, and a business whose *name* merely looked
 * like the town outranked the businesses actually there. Over the shipped catalog "spa mesa" opened on Mysa
 * Wellness Spa in Brooklyn, "bowling milwaukee" on Milwaukie Bowl in Oregon, "brewery bellingham" on The Bell
 * in Scona in Edmonton, and "horse sarasota" on The Dark Horse Mercantile in Saratoga Springs. A typo in a
 * business name was worth more than a town spelled right.
 */

let n = 0;
function op(over: Partial<Unclaimed> & Pick<Unclaimed, "title" | "cat" | "art" | "metroId" | "area">): Unclaimed {
  n += 1;
  return {
    id: "o-town-" + n,
    src: "town" + n + ".com",
    specs: [],
    options: [],
    includes: [],
    gap: "",
    cover: "https://example.com/" + n + ".jpg",
    ...over,
  };
}

const everywhere = { metroId: ALL_METRO_ID, cat: "all" as CategoryId };
const titles = (pool: Unclaimed[], q: string) => searchListings(pool, q, everywhere).map((u) => u.title);

test("a spa in the town beats a spa whose name is one letter off it", () => {
  const pool: Unclaimed[] = [
    // "Mysa" is one edit from "Mesa", and it sits in the name, which is the field that scores highest.
    op({ title: "Mysa Wellness Spa", cat: "wellness", art: "spa", metroId: "nyc", area: "Brooklyn, NY" }),
    op({ title: "Harmony Spa", cat: "wellness", art: "spa", metroId: "phoenix", area: "Mesa, AZ" }),
  ];
  assert.equal(titles(pool, "spa mesa")[0], "Harmony Spa");
  // The lookalike is still an answer, just not the first one: a typo is still a typo a guest can make.
  assert.ok(titles(pool, "spa mesa").includes("Mysa Wellness Spa"));
});

test("a bowling alley in the town beats one in a town spelled nearly the same", () => {
  const pool: Unclaimed[] = [
    op({ title: "Milwaukie Bowl", cat: "play", art: "bowling", metroId: "portland", area: "Milwaukie, OR" }),
    op({ title: "Falcon Bowl", cat: "play", art: "bowling", metroId: "milwaukee", area: "Milwaukee, WI" }),
  ];
  assert.equal(titles(pool, "bowling milwaukee")[0], "Falcon Bowl");
});

test("the activity the guest named is not read as the town they are in", () => {
  // "Spa" is the word for the activity, so a shop in a town called Spa gets no credit for standing in it.
  const pool: Unclaimed[] = [
    op({ title: "Thermal Baths", cat: "wellness", art: "spa", metroId: "nyc", area: "Spa, NY" }),
    op({ title: "Mesa Day Spa", cat: "wellness", art: "spa", metroId: "phoenix", area: "Mesa, AZ" }),
  ];
  assert.equal(titles(pool, "spa mesa")[0], "Mesa Day Spa");
});

test("the metro a guest names still outranks a far-off town of the same name", () => {
  // Boston, New Hampshire is a real address in the catalog, an hour and a half from the city. The metro is
  // the place the guest means, so it stays ahead; the other Boston is still on the page.
  const pool: Unclaimed[] = [
    op({ title: "Granite Hill Museum", cat: "indoor", art: "museum", metroId: "portland", area: "Boston, NH" }),
    op({ title: "Cambridge Science Museum", cat: "indoor", art: "museum", metroId: "boston", area: "Cambridge, MA" }),
  ];
  assert.equal(titles(pool, "museum boston")[0], "Cambridge Science Museum");
  assert.ok(titles(pool, "museum boston").includes("Granite Hill Museum"));
});

/** The bonus only reorders. Nothing joins or leaves a result page because of it. */
test("being in the town lifts a listing, it never drops one", () => {
  const pool: Unclaimed[] = [
    op({ title: "Mysa Wellness Spa", cat: "wellness", art: "spa", metroId: "nyc", area: "Brooklyn, NY" }),
    op({ title: "Harmony Spa", cat: "wellness", art: "spa", metroId: "phoenix", area: "Mesa, AZ" }),
    op({ title: "Scottsdale Sauna House", cat: "wellness", art: "sauna", metroId: "phoenix", area: "Scottsdale, AZ" }),
  ];
  assert.equal(titles(pool, "spa mesa").length, 2);
});
