import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingUrl, images, metroCities, type TiqetsProduct } from "../tiqets.ts";

test("each metro gets the Tiqets city of the same name in the same country, never a namesake abroad", () => {
  const map = metroCities([
    { id: "1", name: "Tampa", country_name: "United States" },
    { id: "2", name: "London", country_name: "United Kingdom" },
    { id: "3", name: "London", country_name: "Canada" },
    { id: "4", name: "Toronto", country_name: "Canada" },
  ]);
  assert.equal(map.get("tampa")?.id, "1");
  assert.equal(map.get("london")?.id, "3", "London, Ontario, not London, England");
  assert.equal(map.get("toronto")?.id, "4");
  assert.equal(map.get("miami"), undefined);
});

test("images take the large variant, https only; the booking link is the API's own affiliate url", () => {
  const p: TiqetsProduct = {
    id: "974823",
    title: "Louvre Museum Ticket",
    images: [{ small: "https://c/s.jpg", large: "https://c/l.jpg" }, { medium: "http://c/insecure.jpg" }],
    product_url: "https://www.tiqets.com/en/paris-c66746/louvre-museum-tickets-p974823/?partner=outset",
  };
  assert.deepEqual(images(p), ["https://c/l.jpg"]);
  assert.equal(bookingUrl(p), p.product_url);
  assert.equal(bookingUrl({ id: "x", product_url: "http://x" }), null);
});
