import type { OperatorContact, Unclaimed } from "../data/types";
import { mergeCatalog } from "./catalog";

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
