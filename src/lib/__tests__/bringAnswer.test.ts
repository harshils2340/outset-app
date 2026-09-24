import assert from "node:assert/strict";
import test from "node:test";
import { companyAnswer, type CompanyContext } from "../companyAgent";
import type { Unclaimed } from "../../data/types";

/**
 * "What should I bring?" is one of Otto's own chips, and the answer leads a list of things with the word
 * "Bring". A third of what shops publish under that heading is not a thing, though: it is the shop telling a
 * guest what to do, what it will let them carry in, or what they may not. Under the lead those read as
 * "Bring bring your own fishing poles" and, on 104 shipped lines, as the opposite of the shop's own rule:
 * "Bring no outside food or alcohol".
 *
 * So the lines that carry their own verb are read out as the shop's sentences, and only the things sit under
 * the lead. Same rule as the listing page's "Who can go" column, so the two surfaces cannot drift.
 */

function ask(bring: string[]): string {
  const ctx: CompanyContext = {
    item: {
      id: "u-b", title: "Bayou Fishing Charters", cat: "water", art: "fishing", area: "Tampa, FL",
      metroId: "tampa", src: "example.com", options: [{ name: "Half day", detail: "4 hours", price: 400 }],
      specs: [], includes: [], requirements: [], policies: [], bring,
    } as unknown as Unclaimed,
    contact: null,
    live: null,
  };
  return companyAnswer(ctx, "what should I bring?").text;
}

test("things a shop lists still read as one led list", () => {
  assert.equal(ask(["Sunscreen", "Towel", "Water"]), "Bring sunscreen, towel and water.");
});

test("a line that already says to bring it does not say it twice", () => {
  const said = ask(["Bring your own fishing poles"]);
  assert.equal(said, "Bring your own fishing poles.");
  assert.ok(!/bring\s+bring/i.test(said));
});

test("a shop's prohibition is never read out as a thing to bring", () => {
  const said = ask(["No outside food or alcohol"]);
  assert.equal(said, "No outside food or alcohol.");
  assert.ok(!/^Bring no\b/i.test(said));
});

test("the things lead and the shop's own sentence follows", () => {
  const said = ask(["Sunscreen", "Towel", "Guests may bring their own alcohol"]);
  assert.equal(said, "Bring sunscreen and towel. Guests may bring their own alcohol.");
});

test("a shop whose whole list is rules still answers with its rules", () => {
  const said = ask(["No outside food or alcohol", "Arrive 15 minutes early", "Closed-toe shoes required"]);
  assert.equal(said, "No outside food or alcohol. Arrive 15 minutes early.");
  assert.ok(!/haven'?t published|not sure/i.test(said));
});

test("no answer the catalog can produce reads as the opposite of what the shop wrote", () => {
  for (const line of [
    "No glass bottles unless protected",
    "Do not wear perfume, cologne, or strong smelling substances",
    "Dress in layers for early morning temperatures",
    "BYOB allowed with reservation for events",
    "Sunglasses recommended for daytime flights",
  ]) {
    const said = ask([line]);
    assert.ok(!/^Bring\s+(?:no|not|do not|bring|byob|dress|wear|arrive)\b/i.test(said), line + " came back as: " + said);
  }
});
