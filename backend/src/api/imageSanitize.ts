/**
 * What runs on an operator's uploaded photo bytes before they are committed to the public repository, after
 * the magic-byte check in uploads.ts already confirmed it is a real JPEG or PNG. Two more things a passing
 * magic byte does not rule out: a claimed pixel size big enough to be a decompression-style resource hog once
 * something tries to decode it (the browser already resizes to 1600px before sending; the server should never
 * legitimately see much more), and EXIF or text metadata the uploader's phone wrote in without them choosing
 * to (GPS coordinates chief among them) that would otherwise ride along into a public, permanent commit.
 */
import { parseImageSize } from "../enrich/imagesize.ts";

const MAX_DIMENSION = 4000;
const MAX_PIXELS = 16_000_000;

/** True for pixel dimensions no legitimate upload (client-resized to 1600px) should ever carry. */
export function dimensionsTooLarge(bytes: Buffer): boolean {
  const size = parseImageSize(bytes);
  if (!size) return true; // magic bytes matched but the header itself does not parse: not a real image, refuse
  if (size.width <= 0 || size.height <= 0) return true;
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) return true;
  return size.width * size.height > MAX_PIXELS;
}

/**
 * Drops JPEG APP1 (EXIF, XMP) and APP13 (Photoshop IRB / IPTC) segments; keeps every other segment, the scan
 * data, and the file's own byte order untouched. Bails out and returns the original bytes unchanged the
 * moment anything does not parse as a well-formed marker, rather than risk truncating or corrupting a real
 * photo: worst case a future upload keeps its metadata, it never comes back broken.
 */
export function stripJpegMetadata(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf;
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xd9) {
      out.push(buf.subarray(i, i + 2));
      return Buffer.concat(out);
    }
    const len = (buf[i + 2] << 8) | buf[i + 3];
    const segEnd = i + 2 + len;
    if (len < 2 || segEnd > buf.length) return buf;
    const isMetadata = marker === 0xe1 || marker === 0xed; // APP1: EXIF/XMP. APP13: Photoshop IRB/IPTC.
    if (!isMetadata) out.push(buf.subarray(i, segEnd));
    i = segEnd;
    if (marker === 0xda) {
      // Start of scan: everything after this is entropy-coded image data, not marker-structured. Copy as is.
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
  }
  return buf; // ran off the end of a segment table with no SOS or EOI: not well-formed, keep the original
}

/** Drops PNG tEXt/zTXt/iTXt/eXIf/tIME chunks; keeps every chunk that affects how the image decodes or renders. */
export function stripPngMetadata(buf: Buffer): Buffer {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return buf;
  const DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("ascii");
    const chunkEnd = i + 12 + len; // length(4) + type(4) + data(len) + crc(4)
    if (len < 0 || chunkEnd > buf.length) return buf;
    if (!DROP.has(type)) out.push(buf.subarray(i, chunkEnd));
    i = chunkEnd;
    if (type === "IEND") return Buffer.concat(out);
  }
  return buf;
}

export function stripImageMetadata(bytes: Buffer, kind: "jpeg" | "png"): Buffer {
  return kind === "jpeg" ? stripJpegMetadata(bytes) : stripPngMetadata(bytes);
}
