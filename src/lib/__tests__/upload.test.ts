import assert from "node:assert/strict";
import test from "node:test";
import { dataUrlBytes } from "../api";

/**
 * How big a resized photo is before it is sent.
 *
 * The API refuses more than 1.8 MB of JPEG, and the browser is what makes the file: it resized to 1600px at
 * one fixed quality and sent whatever came out. A detailed photograph over that cap came back "image too
 * large; keep it under 1.8 MB", which is advice for a file the operator never had and cannot shrink. The
 * client measures the bytes now and drops quality, then size, until one pass fits. This is the measurement.
 */

const dataUrl = (bytes: number): string => "data:image/jpeg;base64," + Buffer.alloc(bytes, 0x41).toString("base64");

test("a data URL reports the bytes it carries, not the length of its base64", () => {
  for (const n of [1, 2, 3, 4, 5, 100, 999, 1_000_000]) {
    assert.equal(dataUrlBytes(dataUrl(n)), n, "at " + n + " bytes");
  }
});

test("the base64 of an image at the API's cap measures under it, so a good photo is not refused", () => {
  // 1.7 MB is the client's own ceiling; the API refuses at 1.8 MB. The gap is for the JSON around the bytes.
  assert.ok(dataUrlBytes(dataUrl(1_700_000)) <= 1_700_000);
  assert.ok(dataUrlBytes(dataUrl(1_799_000)) > 1_700_000, "a file the API would still take is retried smaller");
});

test("an empty or malformed data URL measures zero rather than throwing", () => {
  assert.equal(dataUrlBytes(""), 0);
  assert.equal(dataUrlBytes("data:image/jpeg;base64,"), 0);
});
