import type { OperatorContact, Unclaimed } from "../data/types";
import { experienceById, hydrateItem, mergeCatalog } from "./catalog";

type CatalogFile = { generatedAt: string; operators: Unclaimed[]; contacts: Record<string, OperatorContact> };

function looksLikeItem(x: unknown): x is Unclaimed {
  const u = x as Unclaimed;
  return !!u && typeof u.id === "string" && typeof u.title === "string" && typeof u.cat === "string" && Array.isArray(u.options);
}

async function fetchCatalog(name: string): Promise<CatalogFile | null> {
  try {
    const res = await fetch(import.meta.env.BASE_URL + name, { cache: "no-cache" });
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
  const lite = await fetchCatalog("catalog-lite.json");
  let added = 0;
  if (lite) {
    added = mergeCatalog((lite.operators || []).filter(looksLikeItem), lite.contacts || {});
    onPhase?.(added, false);
  }
  const full = await fetchCatalog("catalog.json");
  if (!full) return added;
  added = mergeCatalog((full.operators || []).filter(looksLikeItem), full.contacts || {});
  onPhase?.(added, true);
  return added;
}

const inflight = new Map<string, Promise<boolean>>();

/** Fetch one operator's detail file and swap it into the catalog. Resolves true when the record changed. */
export function loadListing(id: string | null): Promise<boolean> {
  if (!id) return Promise.resolve(false);
  const cur = experienceById(id);
  if (!cur || !cur.lite) return Promise.resolve(false);
  if (inflight.has(id)) return inflight.get(id)!;
  const p = fetch(import.meta.env.BASE_URL + "o/" + encodeURIComponent(cur.detail || id) + ".json", { cache: "no-cache" })
    .then(async (res) => {
      if (!res.ok) return false;
      const full = (await res.json()) as Unclaimed;
      if (!looksLikeItem(full)) return false;
      hydrateItem(full, id);
      return true;
    })
    .catch(() => false)
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}
