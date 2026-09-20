import { useEffect, useState } from "react";
import { WORLDS } from "../data/categories";
import type { ArtKind, Unclaimed } from "../data/types";
import { API_URL } from "./api";
import { experienceById, getCatalog, rememberOverlay } from "./catalog";
import { nearestMetro } from "./here";
import { kmBetween } from "./places";
import { describeQuery } from "./search";

export type MapsPlace = {
  placeId: string;
  name: string;
  website: string;
  host: string;
  lat: number;
  lon: number;
  rating: number | null;
  reviews: number | null;
  city: string;
  region: string;
  phone: string | null;
};

function hostOf(src: string): string {
  return src.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
}

function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function catFor(art: ArtKind): Unclaimed["cat"] {
  for (const w of WORLDS) {
    const chip = w.chips.find((c) => c.art === art && c.cat !== "all");
    if (chip) return chip.cat as Unclaimed["cat"];
  }
  return "play";
}

/** Catalog row Google listed, or a thin Maps stub so the card still opens. */
export function listingFromMaps(h: MapsPlace, q: string): Unclaimed {
  const host = h.host.replace(/^www\./, "").toLowerCase();
  const name = fold(h.name);
  for (const u of getCatalog()) {
    if (host && hostOf(u.src) === host) return u;
    if (name && fold(u.title) === name && u.lat != null && u.lon != null && kmBetween(h, { lat: u.lat, lon: u.lon }) < 1.5) {
      return u;
    }
  }
  const known = experienceById("g-" + h.placeId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40));
  if (known) return known;
  const art = (describeQuery(q).arts[0] || "tour") as ArtKind;
  const id = "g-" + h.placeId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  const metro = nearestMetro(h.lat, h.lon, 400);
  const u: Unclaimed = {
    id,
    title: h.name,
    cat: catFor(art),
    art,
    area: [h.city, h.region].filter(Boolean).join(", ") || h.city,
    metroId: metro?.id || "",
    src: h.host,
    specs: [],
    options: [],
    includes: [],
    gap: "",
    lat: h.lat,
    lon: h.lon,
    rating: h.rating ?? undefined,
    reviews: h.reviews ?? undefined,
  };
  rememberOverlay(u);
  return u;
}

/** Catalog hits keep their order; Maps shops we do not already show are appended. */
export function mergeMapsHits(catalogHits: Unclaimed[], mapsHits: Unclaimed[]): Unclaimed[] {
  if (!mapsHits.length) return catalogHits;
  const seen = new Set(catalogHits.map((u) => u.id));
  const extra = mapsHits.filter((u) => !seen.has(u.id));
  return extra.length ? [...catalogHits, ...extra] : catalogHits;
}

/** Catalog rows Google also lists here, then shops Maps has that we never ingested. */
export async function nearbyListings(q: string, lat: number, lon: number): Promise<Unclaimed[]> {
  if (!API_URL || q.trim().length < 2) return [];
  try {
    const res = await fetch(
      `${API_URL}/nearby?q=${encodeURIComponent(q.trim())}&lat=${lat}&lon=${lon}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { places?: MapsPlace[] };
    const out: Unclaimed[] = [];
    const seen = new Set<string>();
    for (const h of body.places || []) {
      const hit = listingFromMaps(h, q);
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      out.push(hit);
    }
    return out;
  } catch {
    return [];
  }
}

/** Debounced Maps pack for a What query around a pin. Empty when the API has no Places key. */
export function useMapsNearby(q: string, lat: number | null, lon: number | null): Unclaimed[] {
  const [hits, setHits] = useState<Unclaimed[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void nearbyListings(query, lat, lon).then((list) => {
        if (!cancelled) setHits(list);
      });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, lat, lon]);
  return hits;
}
