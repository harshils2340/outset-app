import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importFiles, KnownIndex, listCandidateFiles, mapCandidate, parseFileName } from "../../../scripts/import-discovered.mts";
import type { DirectoryCandidate } from "../directories.ts";

/**
 * How a directory lead reaches the operators table: only through directory-<id>.json, only with the
 * operator's own website, never from the -needs-website or -summary files beside it.
 */

const lead = (over: Partial<DirectoryCandidate> = {}): DirectoryCandidate => ({
  name: "10 Point Charters", website: "https://www.10pointcharters.com", domain: "10pointcharters.com",
  street: null, city: "Gloucester", region: "MA", postal: null, lat: 42.61, lon: -70.66, phone: null,
  kind: "fishing", source: "directory", directory: "captainexperiences",
  sourceUrl: "https://captainexperiences.com/guides/10-point-charters", activity: "fishing guide", ...over,
});

test("only directory-<id>.json is a candidate file; the leads and summary files beside it are not", () => {
  const dir = mkdtempSync(join(tmpdir(), "outset-directory-import-"));
  try {
    writeFileSync(join(dir, "directory-captainexperiences.json"), "[]");
    writeFileSync(join(dir, "directory-captainexperiences-needs-website.json"), "[]");
    writeFileSync(join(dir, "directory-captainexperiences-summary.json"), "{}");
    const { files, skipped } = listCandidateFiles(dir);
    assert.deepEqual(files.map((f) => [f.source, f.job]), [["directory", "directory"]]);
    assert.deepEqual(skipped.sort(), ["directory-captainexperiences-needs-website.json", "directory-captainexperiences-summary.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a lead with the operator's own website becomes a row with origin directory, filed under the nearest metro", () => {
  const meta = parseFileName("/x/directory-captainexperiences.json")!;
  const m = mapCandidate(lead(), meta);
  assert.ok("row" in m, JSON.stringify(m));
  const row = (m as { row: { origin: string; website: string | null; metro_id: string | null; category_id: string; extractor: string; country: string } }).row;
  assert.equal(row.origin, "directory");
  assert.equal(row.website, "https://www.10pointcharters.com");
  assert.equal(row.category_id, "fishing");
  assert.equal(row.country, "US");
  assert.equal(row.extractor, "discover-directory:captainexperiences");
  assert.equal(row.metro_id, "boston", "Gloucester is inside Boston's 160 km");
});

test("a lead with no website is not a listing, and one on another marketplace is not either", () => {
  const meta = parseFileName("/x/directory-captainexperiences.json")!;
  assert.deepEqual(mapCandidate(lead({ website: null, domain: "captainexperiences:10-point-charters" }), meta), { reject: "website required" });
  assert.deepEqual(mapCandidate(lead({ website: "https://fishingbooker.com/charters/view/1", domain: "fishingbooker.com" }), meta), { reject: "aggregator, directory or social host" });
});

test("a business the catalog already has by website host is recognised, not inserted twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "outset-directory-import-"));
  try {
    writeFileSync(join(dir, "directory-captainexperiences.json"), JSON.stringify([lead(), lead({ name: "Legasea Life LLC", website: "https://legasealife.com", domain: "legasealife.com", city: "Portland", region: "ME", lat: 43.66, lon: -70.25 })]));
    const known = new KnownIndex();
    known.remember({ domain: "10pointcharters.com", name: "10 Point Charters", website: "https://www.10pointcharters.com", phone: null, city: "Gloucester", lat: 42.61, lon: -70.66 });
    const { stats, rows } = importFiles(listCandidateFiles(dir).files, known);
    assert.equal(stats.read, 2);
    assert.equal(stats.inserted, 1);
    assert.deepEqual(rows.map((r) => r.domain), ["legasealife.com"]);
    assert.equal(stats.known.domain, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
