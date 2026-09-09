import type { OperatorContact, Unclaimed } from "../data/types";
import { experienceById, hydrateItem, mergeCatalog } from "./catalog";

type CatalogFile = { generatedAt: string; operators: Unclaimed[]; contacts: Record<string, OperatorContact> };

function looksLikeItem(x: unknown): x is Unclaimed {
  const u = x as Unclaimed;
  return !!u && typeof u.id === "string" && typeof u.title === "string" && typeof u.cat === "string" && Array.isArray(u.options);
}

/** Fetch the generated catalog. Hand-verified entries always win over generated ones with the same domain. */
export async function loadRemoteCatalog(): Promise<number> {
  try {
    const res = await fetch(import.meta.env.BASE_URL + "catalog.json", { cache: "no-cache" });
    if (!res.ok) return 0;
    const file = (await res.json()) as CatalogFile;
    const items = (file.operators || []).filter(looksLikeItem);
    return mergeCatalog(items, file.contacts || {});
  } catch {
    return 0;
  }
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
