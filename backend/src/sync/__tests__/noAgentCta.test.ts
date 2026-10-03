import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLandingPages, type Item } from "../pages.ts";
import { writeListingPages } from "../listingPages.ts";

/**
 * The static pages offer no agent.
 *
 * On 3 October 2026 every agent surface a guest can see was switched off in the app (`GUEST_AGENT`,
 * src/lib/flags.ts): Ask Outset, the listing's "Questions before you book?" block, the operator chat. These
 * pages were read for the same thing at the time and carried none of it, which is why neither generator has a
 * switch of its own. The pages a search engine sends a guest to are where an Ask button would come back without
 * anyone looking, so this holds them to it: a city page and a listing page, an operator's and a partner's,
 * carry no Ask link, no `#ask` route and no assistant or concierge, and still carry the two ways a guest does
 * act, the request on Outset and the partner's own booking link.
 */

function item(id: string, extra: Partial<Item> = {}): Item {
  return { id, title: id, art: "cooking", area: "Toronto, ON", metroId: "toronto", options: [{ name: "Class", detail: "", price: 60 }], ...extra } as Item;
}

const AGENT = /#ask\b|ask outset|ask about|assistant|concierge|agent mode|\bchat\b|\botto\b/i;

test("no static listing or city page offers an agent, and each still offers what a guest acts on", () => {
  const items: Item[] = [
    item("o-priced", { cover: "https://x/a.jpg", faq: [{ q: "Is parking free?", a: "Yes, behind the building." }] } as Partial<Item>),
    item("o-reviewed", { cover: "https://x/b.jpg", options: [], reviews: 40 } as Partial<Item>),
    item("o-third", { cover: "https://x/c.jpg" }),
    item("a-viator-t9", {
      cover: "https://media.tacdn.com/t9.jpg", options: [], from: 89, reviews: 3, art: "cruise", area: "Tampa, FL", metroId: "tampa",
      affiliate: { source: "viator", label: "Viator", url: "https://www.viator.com/tours/Tampa/z/d123-T9?pid=P1" },
    } as Partial<Item>),
  ];
  const dir = mkdtempSync(join(tmpdir(), "outset-no-agent-"));
  try {
    const landing = writeLandingPages(items, { publicDir: dir });
    writeListingPages(items, landing, { publicDir: dir });
    const listing = readdirSync(join(dir, "l")).filter((f) => f.endsWith(".html"));
    const city = readdirSync(join(dir, "p")).filter((f) => f.endsWith(".html"));
    assert.ok(listing.includes("o-priced.html") && listing.includes("a-viator-t9.html"), "the fixture stopped earning listing pages: " + listing.join(", "));
    assert.ok(city.includes("cooking-in-toronto.html"), "the fixture stopped earning a city page: " + city.join(", "));
    for (const [sub, files] of [["l", listing], ["p", city]] as const) {
      for (const f of files) {
        const html = readFileSync(join(dir, sub, f), "utf8");
        const m = AGENT.exec(html);
        assert.equal(m, null, `${sub}/${f} offers an agent: "${m ? html.slice(Math.max(0, m.index - 60), m.index + 60) : ""}"`);
      }
    }
    assert.match(readFileSync(join(dir, "l", "o-priced.html"), "utf8"), /Request a time on Outset/);
    assert.match(readFileSync(join(dir, "l", "a-viator-t9.html"), "utf8"), /Book on Viator<\/a>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
