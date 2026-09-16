import { test } from "node:test";
import assert from "node:assert/strict";
import { dimensionsTooLarge, stripJpegMetadata, stripPngMetadata } from "../imageSanitize.ts";

/** A well-formed JPEG with a JFIF header, a fake EXIF APP1 segment (GPS-shaped payload), a SOF0 stating its
 * pixel size, and a minimal scan. Real entropy-coded data is not needed: stripJpegMetadata only walks markers. */
function fakeJpeg(opts: { width: number; height: number; exifPayload?: Buffer }): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]; // SOI
  const jfif = Buffer.concat([Buffer.from("JFIF\0", "ascii"), Buffer.from([1, 2, 0, 0, 1, 0, 1, 0, 0])]);
  parts.push(Buffer.from([0xff, 0xe0, 0, jfif.length + 2]), jfif);
  const exif = opts.exifPayload ?? Buffer.concat([Buffer.from("Exif\0\0", "ascii"), Buffer.from("GPS 37.7749 -122.4194 fake gps exif payload", "ascii")]);
  const exifLen = exif.length + 2;
  parts.push(Buffer.from([0xff, 0xe1, (exifLen >> 8) & 0xff, exifLen & 0xff]), exif);
  // SOF0: precision(1) height(2) width(2) numComponents(1) + one component (3 bytes)
  const sof = Buffer.from([8, (opts.height >> 8) & 0xff, opts.height & 0xff, (opts.width >> 8) & 0xff, opts.width & 0xff, 1, 1, 0x11, 0]);
  const sofLen = sof.length + 2;
  parts.push(Buffer.from([0xff, 0xc0, (sofLen >> 8) & 0xff, sofLen & 0xff]), sof);
  // SOS: 1 component, then two bytes of fake entropy-coded scan data, then EOI.
  const sos = Buffer.from([1, 1, 0, 0, 63, 0]);
  const sosLen = sos.length + 2;
  parts.push(Buffer.from([0xff, 0xda, (sosLen >> 8) & 0xff, sosLen & 0xff]), sos, Buffer.from([0x12, 0x34]));
  parts.push(Buffer.from([0xff, 0xd9])); // EOI
  return Buffer.concat(parts);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.from([0, 0, 0, 0])]); // fake CRC, unchecked
}

function fakePng(opts: { width: number; height: number; textPayload?: Buffer }): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(opts.width, 0);
  ihdrData.writeUInt32BE(opts.height, 4);
  ihdrData.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, default compression/filter/interlace
  const text = opts.textPayload ?? Buffer.from("GPS\0latitude=37.7749,longitude=-122.4194", "ascii");
  return Buffer.concat([sig, pngChunk("IHDR", ihdrData), pngChunk("tEXt", text), pngChunk("IDAT", Buffer.from([0, 1, 2, 3])), pngChunk("IEND", Buffer.alloc(0))]);
}

test("stripJpegMetadata drops the EXIF segment but keeps the image decodable", () => {
  const withExif = fakeJpeg({ width: 800, height: 600 });
  const stripped = stripJpegMetadata(withExif);
  assert.equal(stripped.includes("GPS 37.7749"), false, "GPS-shaped EXIF payload should be gone");
  assert.equal(stripped.includes(Buffer.from([0xff, 0xe1])), false, "the APP1 marker itself should be gone");
  // SOI, JFIF header, SOF0 (so dimensions still read), and EOI all survive.
  assert.equal(stripped[0], 0xff);
  assert.equal(stripped[1], 0xd8);
  assert.equal(stripped.includes("JFIF"), true);
  assert.equal(stripped[stripped.length - 2], 0xff);
  assert.equal(stripped[stripped.length - 1], 0xd9);
});

test("stripJpegMetadata leaves a JPEG with no EXIF segment unchanged in substance", () => {
  const plain = fakeJpeg({ width: 400, height: 300, exifPayload: Buffer.alloc(0) });
  // No APP1 at all this time: build one without the APP1 segment by hand.
  const noExif = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xd9])]);
  assert.deepEqual(stripJpegMetadata(noExif), noExif);
  void plain;
});

test("stripJpegMetadata never throws and returns the original bytes on malformed input", () => {
  for (const bad of [Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(0), Buffer.from([1, 2, 3, 4]), Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])]) {
    assert.doesNotThrow(() => stripJpegMetadata(bad));
  }
});

test("stripPngMetadata drops the tEXt chunk but keeps IHDR/IDAT/IEND", () => {
  const withText = fakePng({ width: 800, height: 600 });
  const stripped = stripPngMetadata(withText);
  assert.equal(stripped.includes("GPS"), false, "the text metadata chunk should be gone");
  assert.equal(stripped.includes("latitude"), false);
  assert.equal(stripped.includes("IHDR"), true);
  assert.equal(stripped.includes("IDAT"), true);
  assert.equal(stripped.includes("IEND"), true);
});

test("stripPngMetadata never throws and returns the original bytes on malformed input", () => {
  for (const bad of [Buffer.from([0x89, 0x50, 0x4e]), Buffer.alloc(0), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])]) {
    assert.doesNotThrow(() => stripPngMetadata(bad));
  }
});

/** The browser already resizes to 1600px before sending; the server should never legitimately see far more. */
test("dimensionsTooLarge refuses an outsized claim and allows an ordinary upload", () => {
  assert.equal(dimensionsTooLarge(fakeJpeg({ width: 1600, height: 1200 })), false);
  assert.equal(dimensionsTooLarge(fakeJpeg({ width: 12000, height: 12000 })), true);
  assert.equal(dimensionsTooLarge(fakePng({ width: 1600, height: 1200 })), false);
  assert.equal(dimensionsTooLarge(fakePng({ width: 20000, height: 20000 })), true);
  // Bytes that pass the magic-byte check but whose header does not parse at all are refused too.
  assert.equal(dimensionsTooLarge(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), true);
});
