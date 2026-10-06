import assert from "node:assert/strict";
import test from "node:test";
import { isFlat } from "../media";

/**
 * What the flat screen measures a picture against.
 *
 * `probePhotos` drops a photo that is close to one colour, so a blank or a logo never reaches a guest's photo
 * grid. It measured the picture on a fresh canvas, and a fresh canvas is transparent: a transparent pixel
 * reads back black, so a picture with an alpha channel was scored against a background the page never shows.
 * Driven in a real Chromium before this was written, with the same 24x24 sample and the same bar of 14: a
 * near-white glyph on a transparent ground scores 118.9 that way and 4.8 against white. It was kept, and the
 * guest got the blank white tile this function exists to drop. Nothing else moves: a dark glyph on alpha is
 * kept either way (14.9, then 95), a flat opaque tile scores 0 both ways, and a photo with no alpha reads the
 * same either way.
 */

type Call = { op: string; args: unknown[] };

/** A canvas that records what is painted on it and hands back pixels of one colour. */
function stub(pixel: [number, number, number, number]) {
  const calls: Call[] = [];
  const ctx = {
    fillStyle: "",
    fillRect: (...args: unknown[]) => calls.push({ op: "fillRect", args }),
    drawImage: (...args: unknown[]) => calls.push({ op: "drawImage", args }),
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = pixel[0];
        data[i + 1] = pixel[1];
        data[i + 2] = pixel[2];
        data[i + 3] = pixel[3];
      }
      return { data };
    },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const prior = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: () => canvas };
  return { calls, ctx, canvas, restore: () => { (globalThis as { document?: unknown }).document = prior; } };
}

const img = {} as HTMLImageElement;

test("the sample is painted an opaque white before the picture is drawn on it", () => {
  const s = stub([255, 255, 255, 255]);
  try {
    isFlat(img);
  } finally {
    s.restore();
  }
  const painted = s.calls.findIndex((c) => c.op === "fillRect");
  const drawn = s.calls.findIndex((c) => c.op === "drawImage");
  assert.ok(painted >= 0, "a ground is painted at all");
  assert.ok(drawn >= 0, "and the picture still reaches the canvas");
  assert.ok(painted < drawn, "ground first, picture second: the other way round measures nothing");
  assert.deepEqual(s.calls[painted].args, [0, 0, 24, 24], "the whole sample, not a corner of it");
  assert.match(s.ctx.fillStyle, /^#(?:fff|ffffff)$/i, "opaque white, which is what the tile sits on");
});

test("one colour is still flat and a tainted canvas still tells us nothing", () => {
  const flat = stub([238, 238, 238, 255]);
  try {
    assert.equal(isFlat(img), true, "a near-one-colour sample is dropped as before");
  } finally {
    flat.restore();
  }
  const prior = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: () => ({ getContext: () => { throw new Error("tainted"); } }) };
  try {
    assert.equal(isFlat(img), false, "a canvas that cannot be read keeps the photo");
  } finally {
    (globalThis as { document?: unknown }).document = prior;
  }
});
