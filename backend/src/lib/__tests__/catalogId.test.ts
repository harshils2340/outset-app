import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { idsForDomains, slugDomain } from "../catalogId.ts";

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, "../../../../public/catalog.json");

/**
 * One business, one listing id. Every surface keys off it: "#o=<id>", public/o/<id>.json, the claim index,
 * the claim link's signature, outreach emails and the static /l/<id> page.
 */

test("a domain with no rival keeps the id the catalog already publishes", () => {
  assert.equal(idsForDomains(["skydivecity.com"]).get("skydivecity.com"), "o-skydivecity-com");
  assert.equal(idsForDomains(["Sunset-Watersports.com"]).get("sunset-watersports.com"), "o-sunset-watersports-com");
  assert.equal(slugDomain("whiteknucklewatersports.com"), "whiteknucklewatersports-com");
});

test("two domains that fold to one slug get one id each, and the first keeps the plain one", () => {
  // The 23 September catalog shipped these two: Aqua-Tots in Westerville, Ohio and Aqua-Tots in Dallas, Texas.
  // Both asked for o-aqua-tots-com, so catalog.json carried two rows under it, the app's merge kept the first,
  // and the detail file and the claim index were written by the second: the Westerville card opened a page
  // headed "Dallas, TX" and only an address at the other shop's domain could claim it.
  const ids = idsForDomains(["aqua_tots.com", "aqua-tots.com"]);
  assert.equal(ids.get("aqua-tots.com"), "o-aqua-tots-com");
  assert.notEqual(ids.get("aqua_tots.com"), "o-aqua-tots-com");
  assert.match(ids.get("aqua_tots.com")!, /^o-aqua-tots-com-[0-9a-f]{6}$/);
});

test("two domains that agree on their first 48 characters are still two listings", () => {
  const a = "elysian-fields-equestrian-centre.mailchimpsites.com";
  const b = "elysian-fields-equestrian-centre.mailchimpsites.net";
  assert.equal(slugDomain(a), slugDomain(b));
  const ids = idsForDomains([a, b]);
  assert.notEqual(ids.get(a), ids.get(b));
  assert.equal(ids.get(a), "o-" + slugDomain(a));
});

test("the order the domains arrive in does not decide who gets which id", () => {
  const doms = ["b-shop.com", "b_shop.com", "b.shop.com", "a-shop.com"];
  const forward = idsForDomains(doms);
  const back = idsForDomains([...doms].reverse());
  for (const d of doms) assert.equal(forward.get(d), back.get(d), d);
  assert.equal(new Set([...forward.values()]).size, doms.length);
});

test("case and padding are the same domain, not two listings", () => {
  const ids = idsForDomains([" Aqua-Tots.com ", "aqua-tots.com"]);
  assert.equal(ids.size, 1);
  assert.equal(ids.get("aqua-tots.com"), "o-aqua-tots-com");
});

test("every domain in the shipped catalog gets its own id, and only a collision loser moves", () => {
  if (!existsSync(catalogPath)) return; // a checkout without the catalog committed
  const rows = (JSON.parse(readFileSync(catalogPath, "utf8")) as { operators: { id: string; src?: string; affiliate?: unknown }[] }).operators;
  // A partner's product is not an operator and its id is not made from a domain: they all name the partner's site.
  const own = rows.filter((r) => !r.affiliate && r.src);
  const ids = idsForDomains(own.map((r) => r.src!));
  assert.equal(new Set([...ids.values()]).size, ids.size, "two domains share an id");
  const moved = own.filter((r) => ids.get(r.src!.toLowerCase()) !== r.id);
  assert.ok(moved.length <= 1, "ids that moved: " + moved.map((r) => r.id + " (" + r.src + ")").join(", "));
});
