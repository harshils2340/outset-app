import { Hono } from "hono";
import { rateLimit } from "./auth.ts";

/**
 * Maps-ranked businesses around a pin. Public, like /where: the guest home asks this when Near me has a
 * query, so a karate search in Waterloo can return the dojos Google lists, not only OSM rows filed as Toronto.
 * Empty when the Places key is missing; never invents a shop.
 */
export const nearby = new Hono();

nearby.get("/nearby", rateLimit(180, 60 * 60 * 1000), async (c) => {
  const q = (c.req.query("q") || "").trim();
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (q.length < 2 || q.length > 80 || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return c.json({ places: [] });
  }
  c.header("cache-control", "private, max-age=300");
  const key = (process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!key) return c.json({ places: [] });
  try {
    const { nearbyTextSearch } = await import("../discover/places.ts");
    const places = await nearbyTextSearch({ key, q, lat, lon });
    return c.json({ places });
  } catch {
    return c.json({ places: [] });
  }
});
