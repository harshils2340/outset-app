import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { jpegGround } from "../api";

/**
 * What a transparent pixel becomes on the way to the API.
 *
 * The browser makes the file: it draws the operator's photo onto a fresh canvas and encodes that canvas as
 * JPEG. JPEG has no alpha channel and the canvas spec composites a transparent pixel onto solid black, so a
 * PNG with a transparent background came out of the upload with a black background, on the listing a guest
 * reads and in a public commit that is never rewritten. Proved in a real Chromium before this was written: a
 * transparent pixel read back (0, 2, 0) through the exact passes `uploadPhoto` runs.
 */

type Call = { op: string; args: unknown[] };

function stubCanvas(width: number, height: number, ctx = true) {
  const calls: Call[] = [];
  const context = {
    fillStyle: "",
    fillRect: (...args: unknown[]) => calls.push({ op: "fillRect", args }),
    drawImage: (...args: unknown[]) => calls.push({ op: "drawImage", args }),
  };
  const canvas = { width, height, getContext: () => (ctx ? context : null) };
  return { canvas: canvas as unknown as HTMLCanvasElement, context, calls };
}

test("the canvas is painted an opaque white before anything is drawn on it", () => {
  const { canvas, context, calls } = stubCanvas(1600, 900);
  const got = jpegGround(canvas);
  assert.ok(got, "a browser with a 2d context gets one back");
  assert.equal(calls.length, 1, "exactly one paint, before the caller's drawImage");
  assert.equal(calls[0].op, "fillRect");
  assert.deepEqual(calls[0].args, [0, 0, 1600, 900], "the whole canvas, not a corner of it");
  // Not "white", not "#fff8" and not a gradient: a named colour or an alpha would put us back on black.
  assert.match(context.fillStyle, /^#(?:fff|ffffff)$/i, "opaque white");
});

test("a browser with no 2d context is told apart from one that painted nothing", () => {
  const { canvas, calls } = stubCanvas(100, 100, false);
  assert.equal(jpegGround(canvas), null);
  assert.equal(calls.length, 0);
});

test("the upload path grounds the canvas rather than drawing straight onto a transparent one", () => {
  const src = readFileSync(new URL("../api.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function uploadPhoto"));
  const upload = body.slice(0, body.indexOf("\n}"));
  assert.match(upload, /const ctx = jpegGround\(canvas\)/, "the context comes from the grounded canvas");
  assert.doesNotMatch(upload, /canvas\.getContext\(/, "and never straight from getContext, which is transparent");
  assert.ok(upload.indexOf("jpegGround(canvas)") < upload.indexOf("ctx.drawImage("), "ground first, photo second");
});
