import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify, computeStats, decodePng, isUsable, tinyUrl, type PhotoKind } from "../src/enrich/photoquality.ts";
import { scanPage } from "../src/enrich/pagescan.ts";

/**
 * Screens every photo already published on the site, from the pixels, and removes the ones that are not
 * photographs of the experience.
 *
 * Two passes, because one is not enough. At 32x32 a scanned booklet page that has a photo printed on it
 * still reads as a photograph; read again at 128x128, the paper around the photo and the lines of type give
 * it away. But a single marketing image with a price written across it is also paper and type, and that one
 * is the operator's own picture of the trip, so it stays. What gets removed is a *run* of printed pages,
 * which is what a scanned safety booklet looks like, plus anything the first pass already calls a logo, map
 * or text graphic. A printed page that is only the cover gets demoted behind a real photo rather than
 * deleted, so no listing loses its last picture.
 *
 * It reads and rewrites public/ only, so it needs no database and runs in GitHub Actions after a deploy,
 * never on a laptop. Verdicts are cached in public/photo-verdicts.json, so a rerun judges only new photos.
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../../public");
const verdictPath = join(publicDir, "photo-verdicts.json");

type Verdict = { kind: PhotoKind; page?: boolean };
type Verdicts = Record<string, Verdict>;
type Listing = { id?: string; cover?: string; photos?: string[]; [k: string]: unknown };

const arg = (name: string, fallback: number) => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? Number(a.split("=")[1]) : fallback;
};

function loadVerdicts(): Verdicts {
  try {
    const raw = JSON.parse(readFileSync(verdictPath, "utf8")) as Record<string, Verdict | PhotoKind>;
    const out: Verdicts = {};
    for (const [k, v] of Object.entries(raw)) out[k] = typeof v === "string" ? { kind: v } : v;
    return out;
  } catch {
    return {};
  }
}

async function pull(url: string, size?: number): Promise<{ width: number; height: number; rgba: Uint8Array } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(size ? tinyUrl(url, size) : tinyUrl(url), { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; OutsetBot/1.0)" } });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 403) {
        await new Promise((r) => setTimeout(r, 3000 + attempt * 4000));
        continue;
      }
      if (!res.ok) return null;
      return decodePng(new Uint8Array(await res.arrayBuffer()));
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

async function judge(url: string): Promise<Verdict> {
  const small = await pull(url);
  if (!small) return { kind: "unknown" };
  const kind = classify(computeStats(small.width, small.height, small.rgba)).kind;
  if (kind !== "photo") return { kind };
  const big = await pull(url, 128);
  return { kind, page: big ? scanPage(big.width, big.height, big.rgba).isPage : false };
}

async function main(): Promise<void> {
  const limit = arg("limit", 20000);
  const concurrency = arg("concurrency", 12);
  const verdicts = loadVerdicts();
  const oDir = join(publicDir, "o");
  const files = existsSync(oDir) ? readdirSync(oDir).filter((f) => f.endsWith(".json")) : [];

  const urls = new Set<string>();
  const listings = new Map<string, Listing>();
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(oDir, f), "utf8")) as Listing;
    listings.set(f, d);
    for (const u of [d.cover, ...(d.photos || [])]) if (u && /^https?:/.test(u)) urls.add(u);
  }
  const todo = Array.from(urls).filter((u) => !(u in verdicts)).slice(0, limit);
  console.log(`${files.length} listings, ${urls.size} distinct images, ${todo.length} to judge (${Object.keys(verdicts).length} already known)`);

  let i = 0;
  let judged = 0;
  const counts: Record<string, number> = {};
  const worker = async () => {
    while (i < todo.length) {
      const url = todo[i++];
      const v = await judge(url);
      verdicts[url] = v;
      const label = v.page ? "printed page" : v.kind;
      counts[label] = (counts[label] || 0) + 1;
      judged++;
      if (judged % 250 === 0) {
        console.log(`${judged}/${todo.length}`, JSON.stringify(counts));
        writeFileSync(verdictPath, JSON.stringify(verdicts));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) || 1 }, worker));
  writeFileSync(verdictPath, JSON.stringify(verdicts));
  console.log("judged", judged, JSON.stringify(counts));

  let changedFiles = 0;
  let droppedJunk = 0;
  let droppedPages = 0;
  let demotedCovers = 0;
  const junk = (u?: string) => !!u && !!verdicts[u] && verdicts[u].kind !== "unknown" && !isUsable(verdicts[u].kind);
  const page = (u?: string) => !!u && !!verdicts[u]?.page;

  for (const [f, d] of listings) {
    const all = d.photos || [];
    // A run of printed pages is a scanned booklet; one on its own is the operator's own marketing photo.
    const pageRun = all.filter(page).length >= 2;
    const photos = all.filter((u) => !junk(u) && !(pageRun && page(u)));
    const lostJunk = all.filter(junk).length;
    const lostPages = pageRun ? all.filter((u) => page(u) && !junk(u)).length : 0;

    let cover = d.cover;
    let demoted = 0;
    // Never leave a listing with nothing: a page-like cover steps aside only when a real photo can take over.
    const realPhoto = photos.find((u) => !page(u));
    if ((junk(cover) || page(cover)) && realPhoto && realPhoto !== cover) {
      cover = realPhoto;
      demoted = 1;
    } else if (junk(cover) && !realPhoto) {
      cover = photos[0];
      demoted = 1;
    }

    if (!lostJunk && !lostPages && !demoted) continue;
    changedFiles++;
    droppedJunk += lostJunk;
    droppedPages += lostPages;
    demotedCovers += demoted;
    const next: Listing = { ...d, photos };
    if (cover) next.cover = cover;
    else delete next.cover;
    writeFileSync(join(oDir, f), JSON.stringify(next));
  }

  // The browse catalog carries covers only; keep it in step so no card shows a booklet page.
  const catPath = join(publicDir, "catalog.json");
  if (existsSync(catPath)) {
    const cat = JSON.parse(readFileSync(catPath, "utf8")) as { operators: { id: string; cover?: string }[] };
    let catFixed = 0;
    for (const o of cat.operators) {
      const detail = listings.get(o.id + ".json");
      const wanted = (detail as Listing | undefined)?.cover;
      if (!junk(o.cover) && !page(o.cover)) continue;
      if (wanted && wanted !== o.cover) o.cover = wanted;
      else if (junk(o.cover)) delete o.cover;
      else continue;
      catFixed++;
    }
    if (catFixed) writeFileSync(catPath, JSON.stringify(cat));
    console.log("catalog covers fixed", catFixed);
  }
  console.log(`listings changed ${changedFiles}, junk dropped ${droppedJunk}, booklet pages dropped ${droppedPages}, covers demoted ${demotedCovers}`);
}

await main();
