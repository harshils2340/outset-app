import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A photo the operator just uploaded lives in the repository minutes before the site has it, so the guest site
 * and the resizing proxy both answer 404 and the operator thinks the upload failed. GET /uploads/:id/:file
 * serves the same bytes in the meantime. With no GITHUB_TOKEN the route reads from public/ on disk, which is
 * what this exercises.
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../../../../public");
const LISTING = "o-uploads-unit-test";
const SHA = "a1b2c3d4e5f60718293a";
const dir = join(publicDir, "uploads", LISTING);
// The smallest thing that starts with the JPEG magic bytes; the route serves bytes, it does not decode them.
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02, 0x03]);

test("an uploaded photo is served from the store before the site has it", async (t) => {
  const had = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN; // read from disk, not from the repository
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SHA + ".jpg"), BYTES);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (had) process.env.GITHUB_TOKEN = had;
  });

  const { uploads } = await import("../uploads.ts");

  const ok = await uploads.request(`/uploads/${LISTING}/${SHA}.jpg`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  // The name is a hash of the bytes, so the answer never changes and the browser should keep it.
  assert.match(ok.headers.get("cache-control") || "", /immutable/);
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), BYTES);

  // A name that is not a content hash is refused before anything touches the disk.
  for (const bad of ["../../../secret.json", "index.html", "evil.jpg", SHA + ".gif"]) {
    const r = await uploads.request(`/uploads/${LISTING}/${encodeURIComponent(bad)}`);
    assert.equal(r.status, 404, bad);
  }
  // A listing id that is not one of ours is refused too.
  const badId = await uploads.request(`/uploads/${encodeURIComponent("../x")}/${SHA}.jpg`);
  assert.equal(badId.status, 404);

  // A hash we have never stored is a plain miss, not a crash.
  const miss = await uploads.request(`/uploads/${LISTING}/ffffffffffffffffffff.jpg`);
  assert.equal(miss.status, 404);
  assert.equal(existsSync(join(dir, "ffffffffffffffffffff.jpg")), false);
});
