import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWidgetState, readSquare, squareRef } from "../vendors/square.ts";
import { loadExchanges, withReplay } from "./fixtures/replay.ts";

// fixtures/square: Eye Spy Escape Rooms, Abilene TX (widget rivga4vgg85qfq, location LN0J87F6T53R6), 15 September 2026.
// Two exchanges: book.squareup.com/robots.txt and the location root whose <meta name="widget"> carries the state.

test("squareRef reads widgets, minisites and Square Online sites, and ignores payment links", () => {
  assert.deepEqual(squareRef("https://squareup.com/appointments/book/rivga4vgg85qfq/LN0J87F6T53R6/services"), { kind: "widget", widgetId: "rivga4vgg85qfq", locationId: "LN0J87F6T53R6" });
  assert.deepEqual(squareRef("https://app.squareup.com/appointments/book/r47qxkld8croys/DZJDJDWPB5W58/start"), { kind: "widget", widgetId: "r47qxkld8croys", locationId: "DZJDJDWPB5W58" });
  assert.deepEqual(squareRef("https://book.squareup.com/appointments/sdvt9s3yk8d99k/location/LVFG30Y34514K/services/4KKGARHMP4BXD4A2BWE4HMD7"), { kind: "widget", widgetId: "sdvt9s3yk8d99k", locationId: "LVFG30Y34514K" });
  assert.deepEqual(squareRef("https://book.squareup.com/appointments/3f2504e0-4f89-11d3-9a0c-0305e82c3301/location/LN0J87F6T53R6"), { kind: "widget", widgetId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", locationId: "LN0J87F6T53R6" });
  assert.deepEqual(squareRef("https://squareup.com/appointments/book/0B3MPEAG89AR7/sunstate-helicopter-tours-scottsdale-az"), { kind: "minisite", locationId: "0B3MPEAG89AR7", slug: "sunstate-helicopter-tours-scottsdale-az" });
  assert.deepEqual(squareRef("https://square.site/book/LN0J87F6T53R6/eye-spy-abilene"), { kind: "minisite", locationId: "LN0J87F6T53R6", slug: "eye-spy-abilene" });
  assert.deepEqual(squareRef("https://eye-spy-escape.square.site/s/appointments"), { kind: "site", host: "eye-spy-escape.square.site" });
  assert.equal(squareRef("https://square.link/u/AbCdEf12"), null);
  assert.equal(squareRef("https://checkout.square.site/merchant/ML123/checkout/ABC"), null);
  assert.equal(squareRef("https://fareharbor.com/embeds/book/x/"), null);
});

test("parseWidgetState decodes the widget meta tag of the recorded page", () => {
  const page = loadExchanges("square").find((e) => /\/location\/LN0J87F6T53R6$/.test(e.key))!;
  const w = parseWidgetState(page.body);
  assert.ok(w);
  assert.equal(w.services!.length, 3);
  assert.equal(w.business?.currency_code, "USD");
  assert.equal(parseWidgetState("<html><head><title>x</title></head></html>"), null);
});

test("Square: Eye Spy reads three rooms priced per party size from the booking widget state", async () => {
  const ref = squareRef("https://squareup.com/appointments/book/rivga4vgg85qfq/LN0J87F6T53R6/services")!;
  const { result: r } = await withReplay("square", () => readSquare(ref));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "square");
  assert.equal(r.pages, 1);
  assert.equal(r.offerings.length, 19);
  assert.deepEqual([...new Set(r.offerings.map((o) => o.name))], ["FROTHY TOP BREWERY", "TOTALLY RECALLED", "DOC SAVAGE ROOM"]);

  const row = (name: string, detail: string | null) => {
    const o = r.offerings.find((x) => x.name === name && x.detail === detail);
    assert.ok(o, `missing ${name} / ${detail}`);
    return o;
  };
  // Variations: one row per party size, price in cents to dollars, duration from seconds, whole-group unit.
  const two = row("FROTHY TOP BREWERY", "2 people");
  assert.equal(two.price, 70);
  assert.equal(two.unit, "/group");
  assert.equal(two.duration, "1 hour");
  assert.equal(two.url, "https://squareup.com/appointments/book/rivga4vgg85qfq/LN0J87F6T53R6/start?service_id=AOCKR2TLIXLBRJOM6EULT5NV");
  assert.equal(two.photo, "https://items-images-production.s3.us-west-2.amazonaws.com/files/d51acde60a765002d47923a4b670597c6fa3b98f/original.jpeg");
  assert.match(two.desc || "", /^The original owners of Frothy Top Tavern/);
  assert.equal(row("FROTHY TOP BREWERY", "6 People").price, 174);
  assert.equal(r.offerings.filter((o) => o.name === "FROTHY TOP BREWERY").length, 5);
  assert.equal(row("TOTALLY RECALLED", "8 People").price, 232);
  assert.equal(row("DOC SAVAGE ROOM", "3 People").price, 87);
  assert.equal(r.offerings.filter((o) => o.name === "DOC SAVAGE ROOM").length, 7);
  // Later variations of a service carry no description or photo of their own.
  assert.equal(row("TOTALLY RECALLED", "3 People").desc, null);
  assert.equal(row("TOTALLY RECALLED", "3 People").photos.length, 0);

  assert.equal(r.company.currency, "USD");
  assert.equal(r.company.phone, "(937) 241-5238");
  assert.equal(r.company.email, "eyespyescape@gmail.com");
  assert.equal(r.company.street, "1401 S Danville Dr");
  assert.equal(r.company.city, "Abilene");
  assert.equal(r.company.region, "TX");
  assert.equal(r.company.postal, "79605-4711");
  assert.equal(r.company.cancellation, "Bookings can be canceled up to 24 hours before scheduled game time. If appointments are canceled after this, the guest will be charged in-full.");
  assert.deepEqual(r.policies, [r.company.cancellation]);
  assert.deepEqual(r.requirements, ["Call to schedule for groups of 6+ Call for players 10 years old and younger for discounted rates."]);
  assert.deepEqual(r.includes, []);
});
