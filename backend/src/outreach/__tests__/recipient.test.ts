import { test } from "node:test";
import assert from "node:assert/strict";
import { wrongRecipient, type PoolContext, type RecipientRow } from "../recipient.ts";

/**
 * Real rows from the 7 October 2026 audit of the outreach pool, each blocked shape beside a kept one that looks
 * like it, so a rule that starts catching real businesses fails here first.
 */
const ctx: PoolContext = {
  shared: new Map([
    ["sangokurasake@gmail.com", ["Skeggy's Axe House", "Sango Kura"]],
    ["mausapetaluma@gmail.com", ["Martial Arts USA", "Petaluma Academy Martial Arts"]],
    ["lairktv@gmail.com", ["Space KTV Bar Lounge", "Lair KTV"]],
  ]),
  places: new Set(["saratogasprings", "portjefferson", "westroxbury", "whitecloud", "newbraunfels"]),
};
const row = (name: string, website: string, email: string, city: string | null = null): RecipientRow =>
  ({ operator_id: "x", name, website, email, city, domain: new URL(website).hostname.replace(/^www\./, "") });
const kind = (r: RecipientRow) => wrongRecipient(r, ctx)?.kind ?? null;

test("host page: the address is the host's", () => {
  assert.equal(kind(row("A Great Escape", "https://www.gardnervillage.com/a-great-escape", "marketing@gardnervillage.com", "West Jordan")), "host page");
  assert.equal(kind(row("Appalachian Brewing Company", "https://www.abcbrew.com/gettysburg", "abcinfo@abcbrew.com", "Gettysburg")), null);
  assert.equal(kind(row("Escape the Room", "https://escapetheroom.com/milwaukee", "mke@escapetheroom.com", "Milwaukee")), null, "every word generic, but the whole name is the domain");
  assert.equal(kind(row("EscapeworX", "https://www.bingemans.com/escapeworx", "escapeworx@bingemans.com", "Kitchener")), null, "its own inbox at the complex that runs it");
  assert.equal(kind(row("Adventure Outpost at the Waterfront", "https://www.stonemountainpark.com/activities/adventure-outpost", "adventureoutpost@stonemountainpark.com")), null);
  assert.equal(kind(row("Belle's Lounge", "https://www.valentinedistilling.com/belles-lounge", "rifino@valentinedistilling.com")), "host page");
});

test("other location: only when the listing's own page names its city and the address names another", () => {
  assert.equal(kind(row("Plunj", "https://www.plunj.co/locations/loveland", "saratogasprings@plunj.co", "Loveland")), "other location");
  assert.equal(kind(row("Water 2 Wine", "https://www.water2wine.com/austin/", "newbraunfels@water2wine.com", "Austin")), "other location");
  assert.equal(kind(row("One River School", "https://portjefferson.oneriverschool.com/", "portjefferson@oneriverschool.com", "Port Jefferson Station")), null);
  assert.equal(kind(row("Body Mind Systems", "http://www.bodymindsystems.com/", "westroxbury@bodymindsystems.com", "Boston")), null, "the page does not name a city");
  assert.equal(kind(row("Grass Valley Aikikai", "http://grassvalleyaikikai.com/", "whitecloud24601@gmail.com", "Grass Valley")), null, "a gmail is a person's, not a branch's");
});

test("another business: a shared address named for the other listing", () => {
  assert.equal(kind(row("Skeggy's Axe House", "https://www.skeggys.com/", "sangokurasake@gmail.com", "Easton")), "another business");
  assert.equal(kind(row("Martial Arts USA", "http://www.martialartsusapetaluma.com/", "mausapetaluma@gmail.com", "Petaluma")), null, "MAUSA is its initials");
  assert.equal(kind(row("Space KTV Bar Lounge", "http://www.lairktv.com/", "lairktv@gmail.com", "Philadelphia")), null, "its own domain names the address");
});

test("department inboxes, public facilities and head-office chains", () => {
  assert.equal(kind(row("The Weston Golf Club", "https://www.westongolfclub.com/", "webmaster@westongolfclub.com")), "department");
  assert.equal(kind(row("Landmark Lanes", "https://www.landmarklanes.com", "admin@landmarklanes.com")), null, "admin@ at a small shop is usually the owner");
  assert.equal(kind(row("Old Hidalgo Pumphouse", "https://cityofhidalgo.net/pumphouse.html", "pumphouse@cityofhidalgo.net")), "public");
  assert.equal(kind(row("Seaside RV Campground", "http://villageoftahsis.com/business/sample-business/", "seasiderv@gmail.com")), null, "a private business listed on a village site");
  assert.equal(kind(row("Andretti Indoor Karting & Games", "https://andrettikarting.com/glendale", "marketing@andrettikarting.com")), "chain");
  assert.equal(kind(row("Lucky Strike Lanes", "https://www.luckystrikelanesct.com", "luckystrikelanesct@gmail.com")), null, "an independent namesake");
});
