import type { OperatorContact, Unclaimed } from "../data/types";
import { experienceById, hydrateItem, mergeCatalog, setOperatorOverride } from "./catalog";
import { fetchRemoteProfile } from "./api";

type CatalogFile = { generatedAt: string; operators: Unclaimed[]; contacts: Record<string, OperatorContact> };

function looksLikeItem(x: unknown): x is Unclaimed {
  const u = x as Unclaimed;
  return !!u && typeof u.id === "string" && typeof u.title === "string" && typeof u.cat === "string" && Array.isArray(u.options);
}

/**
 * The full catalog is a big file over whatever connection the guest has, so this is generous. It is not
 * optional, though: with no deadline a stalled fetch never settles, so nothing ever says the catalog is done
 * and every screen that waits on that waits for the rest of the session.
 */
const CATALOG_TIMEOUT_MS = 45000;

async function fetchCatalog(name: string): Promise<CatalogFile | null> {
  try {
    const res = await fetch(import.meta.env.BASE_URL + name, { cache: "no-cache", signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as CatalogFile;
  } catch {
    return null;
  }
}

/**
 * Fetch the generated catalog in two steps: a small shard with the operators the home page shows first,
 * so the rails paint in well under a second, then the whole catalog for search and distance.
 * Hand-verified entries always win over generated ones with the same domain.
 */
export async function loadRemoteCatalog(onPhase?: (added: number, complete: boolean) => void): Promise<number> {
  // Both requests go out together. The full catalog used to wait for the lite shard to finish first, which put
  // a 300 kB round trip in front of a 5 MB one for no reason. The lite shard is still the first one acted on.
  const litePromise = fetchCatalog("catalog-lite.json");
  const fullPromise = fetchCatalog("catalog.json");
  const lite = await litePromise;
  let added = 0;
  if (lite) {
    added = mergeCatalog((lite.operators || []).filter(looksLikeItem), lite.contacts || {});
    onPhase?.(added, false);
  }
  const full = await fullPromise;
  if (!full) return added;
  added = mergeCatalog((full.operators || []).filter(looksLikeItem), full.contacts || {});
  onPhase?.(added, true);
  return added;
}

const inflight = new Map<string, Promise<boolean>>();

let onEdits: (() => void) | null = null;

/**
 * Told when a claimed operator's own edits land, which is always after the listing has already been drawn.
 *
 * The detail file and the operator's profile are two fetches, and only the first one is what `loadListing`
 * resolves on. The second used to be a detached promise that patched the in-memory catalog and told nobody, so
 * the page kept the record it had first paint: a guest opening a claimed listing by its link read the crawled
 * title, blurb, prices, hours and policies, and never the operator's. Awaiting it instead would put an API
 * round trip, up to the six second timeout, in front of every listing page, so it stays detached and says so.
 */
export function onListingEdits(fn: (() => void) | null): void {
  onEdits = fn;
}

/**
 * Fetch one operator's detail file and swap it into the catalog. Resolves true when the record changed.
 *
 * An id the catalog has never heard of is fetched too, and merged in on its own. That is what lets a shared
 * listing link open without the 5 MB catalog: the listing's own file is about 3 kB, and it is the only thing
 * that page needs.
 */
export function loadListing(id: string | null): Promise<boolean> {
  if (!id) return Promise.resolve(false);
  const cur = experienceById(id);
  // `lite` alone says whether the detail file is still needed; a seed starts lite too, and that is where
  // its claimKey comes from, so a claim link would spin forever without this fetch.
  if (cur && !cur.lite) return Promise.resolve(false);
  if (inflight.has(id)) return inflight.get(id)!;
  const path = cur?.detail || id;
  const p = fetch(import.meta.env.BASE_URL + "o/" + encodeURIComponent(path) + ".json", { cache: "no-cache" })
    .then(async (res) => {
      if (!res.ok) return false;
      const full = (await res.json()) as Unclaimed;
      if (!looksLikeItem(full)) return false;
      // Known already: patch the record in place. Never seen: add it, so the page can render from this alone.
      if (cur) hydrateItem(full, cur.id);
      else if (!mergeCatalog([full], {})) return false;
      const mine = cur?.id || full.id;
      // A claimed operator's own edits, saved through the API, sit on top of the crawled record.
      if (full.claimKey) void fetchRemoteProfile(path).then((r) => {
        if (!r || !r.patch) return;
        setOperatorOverride(mine, r.patch, r.published !== false);
        onEdits?.();
      });
      return true;
    })
    .catch(() => false)
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}
