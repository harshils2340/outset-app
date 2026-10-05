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

/**
 * The repository path, which the test above cannot reach because it reads from disk. GitHub's contents API
 * serves a file over 1 MB as `"content": ""` with `"encoding": "none"` unless the raw media type is asked for,
 * and this route takes photos up to 1.8 MB, so the biggest uploads came back as "not found" in exactly the
 * minutes the route exists for. No network and no token: the fetch is a stub and the reader is called directly.
 */
test("a photo over 1 MB comes back from the repository rather than reading as not found", async () => {
  const { bytesFromGithub, readFromRepo } = await import("../uploads.ts");

  const big = Buffer.alloc(1_200_000, 0x7a);
  big.set([0xff, 0xd8, 0xff, 0xdb], 0);

  // What GitHub answers for a file over 1 MB when the JSON media type is asked for: a real 200 with no bytes.
  const overOneMb = new Response(JSON.stringify({ content: "", encoding: "none", size: big.length }), { headers: { "content-type": "application/json; charset=utf-8" } });
  assert.equal(await bytesFromGithub(overOneMb), null);

  // What it answers for the same file under the raw media type.
  const raw = new Response(new Uint8Array(big), { headers: { "content-type": "application/vnd.github.raw" } });
  assert.deepEqual(await bytesFromGithub(raw), big);

  // A small file served as JSON still reads, because only the accept header decides which arrives.
  const small = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x09]);
  const asJson = new Response(JSON.stringify({ content: small.toString("base64"), encoding: "base64" }), { headers: { "content-type": "application/json; charset=utf-8" } });
  assert.deepEqual(await bytesFromGithub(asJson), small);

  // And the read asks for raw, which is the half of the fix a shape test cannot see.
  const real = globalThis.fetch;
  let asked = "";
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    asked = String((init.headers as Record<string, string>)?.accept ?? "");
    return new Response(new Uint8Array(big), { headers: { "content-type": "application/octet-stream" } });
  }) as typeof fetch;
  try {
    assert.deepEqual(await readFromRepo("uploads/o-x/aaaaaaaaaaaaaaaaaaaa.jpg"), big);
    assert.equal(asked, "application/vnd.github.raw");
  } finally {
    globalThis.fetch = real;
  }
});
