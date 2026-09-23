/**
 * The menu the guest picks from and the menu the server charges from are one menu.
 *
 * The app runs `bookableMenu` over every record it loads, and that rule renames a row as well as dropping one:
 * a shop's own phone number comes off the name, and so does the bracket its price was printed inside.
 * `priceBooking` then matches the name the guest sent against the listing's menu, and the booking route used to
 * read the crawled file raw, so a renamed row matched nothing at all. The booking was stored with no price and
 * no card was charged: a $5,700 private charter at o-napaliriders-com, a $780 pontoon at o-boatelmers-com and a
 * $275 boat tour at o-customboattoursandrentals-com, each named after the shop's phone number in the file and
 * without it on the page.
 *
 * So the sweep at the end is the real guard: every priced row a guest can actually pick, on every shipped
 * listing, has to come back with a price from the same menu the route prices with.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { priceBooking } from "../money.ts";
import { bookableMenu } from "../../../../src/lib/menuRow.ts";

type Row = { name: string; detail?: string; price: number | null };

const serverMenu = (detail: { options?: Row[]; addons?: Row[] }) =>
  bookableMenu({ options: detail.options || [], addons: detail.addons || [] });

test("a row the app renamed is still the row the server prices", () => {
  // o-customboattoursandrentals-com, whose $275 tour is filed under the shop's own phone number.
  const raw: Row[] = [
    { name: "Lake George Boat Tour (518) 801-7208", detail: "", price: 275 },
    { name: "Blue 115", detail: "", price: 545 },
  ];
  const menu = serverMenu({ options: raw }).options;
  assert.equal(menu[0].name, "Lake George Boat Tour");
  assert.equal(priceBooking(menu, [], "Lake George Boat Tour", "", 1, [])?.subtotal, 275);
  // What it did before: the guest's name matched nothing in the raw file, and more than one row is priced, so
  // there was no single price to fall back on and the booking was stored with none.
  assert.equal(priceBooking(raw, [], "Lake George Boat Tour", "", 1, []), null);
});

test("an extra the app renamed is still charged", () => {
  // o-dallaspalmsvenue-com prints its add-on prices in brackets: "Prime Rib Au Jus (Additional $150)".
  const rawAdd: Row[] = [{ name: "Prime Rib Au Jus (Additional", detail: "", price: 150 }];
  const { options, addons } = serverMenu({ options: [{ name: "Venue hire", detail: "", price: 1000 }], addons: rawAdd });
  assert.equal(addons[0].name, "Prime Rib Au Jus");
  assert.equal(priceBooking(options, addons, "Venue hire", "", 1, ["Prime Rib Au Jus"])?.subtotal, 1150);
  // The raw list cannot find it, so the guest was shown +$150 and charged nothing for it.
  assert.equal(priceBooking(options, rawAdd, "Venue hire", "", 1, ["Prime Rib Au Jus"])?.subtotal, 1000);
});

test("an add-on that is half a sentence is not charged, because it is not offered", () => {
  // o-albertasportshalloffame-ca published "Lost or damaged bikes will incur a cost of $1,000".
  const rawAdd: Row[] = [{ name: "Lost or damaged bikes will incur a cost of", detail: "", price: 1000 }];
  const { options, addons } = serverMenu({ options: [{ name: "Bike rental", detail: "", price: 20 }], addons: rawAdd });
  assert.deepEqual(addons, []);
  assert.equal(priceBooking(options, addons, "Bike rental", "", 1, ["Lost or damaged bikes will incur a cost of"])?.subtotal, 20);
});

test("every priced row a guest can pick has a price the server agrees to", () => {
  const dir = new URL("../../../../public/o/", import.meta.url);
  const shipped = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const unpriceable: string[] = [];
  let listings = 0;
  let rows = 0;
  for (const f of shipped) {
    const item = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { id: string; options?: Row[]; addons?: Row[] };
    listings++;
    const menu = serverMenu(item);
    for (const o of menu.options) {
      if (o.price == null || !(o.price > 0)) continue;
      rows++;
      // One guest, the row's own name and label, exactly as the booking box sends them.
      const p = priceBooking(menu.options, menu.addons, o.name, o.detail || "", 1, []);
      if (!p || !(p.subtotal > 0)) unpriceable.push(item.id + ": " + JSON.stringify(o.name) + " $" + o.price);
    }
  }
  // The guard is that the whole catalog was read, not that it is any one sync's size: a floor written as the
  // size of the day goes red on the next sync that publishes fewer, which is what 50,000 did when the publish
  // gate took the catalog from 59,125 listings to 48,198 and left this sweep the only red test on main.
  assert.equal(listings, shipped.length, "every shipped listing was read");
  assert.ok(listings > 10000, "expected the shipped catalog, read " + listings);
  assert.ok(rows > 10000, "expected the shipped priced rows, read " + rows);
  assert.deepEqual(unpriceable.slice(0, 10), [], unpriceable.length + " priced rows the server cannot price, first: " + unpriceable[0]);
});

/**
 * `priceBooking` finds an extra by the guest's name for it, matched on letters and digits alone, so two extras
 * whose names differ only in punctuation are one extra to it and the first one's price is charged for both.
 * 18 shipped listings have such a pair ("Digital photo scan < 200 DPI" and "> 200 DPI" at o-armuseum-com, at $5
 * and $15). That is its own fault and not this one: what this sweep holds is that an extra a guest is shown is
 * charged at one of the prices the listing publishes for that name, never at nothing.
 */
test("every extra a guest can tick is added to the bill", () => {
  const dir = new URL("../../../../public/o/", import.meta.url);
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const lost: string[] = [];
  let extras = 0;
  let ambiguous = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const item = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { id: string; options?: Row[]; addons?: Row[] };
    const menu = serverMenu(item);
    if (!menu.addons.length) continue;
    const base = menu.options.find((o) => o.price != null && o.price > 0);
    if (!base) continue;
    for (const a of menu.addons) {
      if (a.price == null || !(a.price > 0)) continue;
      extras++;
      // The one the server will find for this name, which is the first row sharing it.
      const found = menu.addons.find((x) => key(x.name) === key(a.name))!;
      if (found !== a && found.price !== a.price) ambiguous++;
      const p = priceBooking(menu.options, menu.addons, base.name, base.detail || "", 1, [a.name]);
      if (!p || Math.abs(p.subtotal - (base.price! + (found.price || 0))) > 0.005) lost.push(item.id + ": " + JSON.stringify(a.name) + " $" + a.price);
    }
  }
  assert.ok(extras > 1000, "expected the shipped extras, read " + extras);
  assert.deepEqual(lost.slice(0, 10), [], lost.length + " extras a guest is shown and not charged for, first: " + lost[0]);
  // The ceiling on the separate fault above, so it cannot quietly grow while nobody is looking at it.
  assert.ok(ambiguous <= 20, "extras whose name the server cannot tell apart, got " + ambiguous);
});
