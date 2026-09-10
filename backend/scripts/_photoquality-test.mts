import { readFileSync } from "node:fs";
import { probeQuality } from "../src/enrich/photoquality.ts";

/** Offline calibration: print kind and stats for a list of image URLs (one per line in the file given as argv[2]). */
const file = process.argv[2];
const urls = file
  ? readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  : ["https://whiteknucklewatersports.com/wp-content/uploads/2015/08/boaters_safety_guide1.jpg"];
// Eight at a time, the same as the cover screen, so the proxy is not flooded.
const rows: { url: string; v: Awaited<ReturnType<typeof probeQuality>> }[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < urls.length) {
      const url = urls[next++];
      rows.push({ url, v: await probeQuality(url) });
    }
  }),
);
rows.sort((a, b) => urls.indexOf(a.url) - urls.indexOf(b.url));
const tally: Record<string, number> = {};
for (const { url, v } of rows) {
  tally[v.kind] = (tally[v.kind] || 0) + 1;
  const s = v.stats;
  const st = s
    ? `col=${s.colours} white=${s.white.toFixed(2)} black=${s.black.toFixed(2)} sat=${s.saturation.toFixed(2)} edge=${s.edges.toFixed(2)} cf=${s.colourfulness.toFixed(1)} top4=${s.top4.toFixed(2)} a=${s.alpha.toFixed(2)}`
    : "-";
  console.log(`${v.kind.padEnd(7)} ${st.padEnd(95)} ${v.reason || ""}  ${url.slice(0, 110)}`);
}
console.log(tally);
