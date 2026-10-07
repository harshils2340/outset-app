import { Hono } from "hono";
import { rateLimit } from "./auth.ts";
import { SITE_EVENTS, recordSiteEvent, type SiteEvent } from "../outreach/clicks.ts";

/**
 * POST /t: the site's own beacon (public/otto.html) for the outreach funnel (src/outreach/clicks.ts). The body is
 * a small JSON string sent as text/plain by navigator.sendBeacon, so the browser sends it without a preflight.
 * Always 204: a page that cannot count must never fail for the person on it.
 */
const BOT = /bot|crawl|spider|slurp|preview|scanner|headless|lighthouse|python|curl|wget|java\/|go-http|safelinks|proofpoint|mimecast|barracuda/i;

export const track = new Hono();

track.post("/t", rateLimit(120, 60 * 60 * 1000), async (c) => {
  try {
    if (BOT.test(c.req.header("user-agent") || "")) return c.body(null, 204);
    const raw = (await c.req.text()).slice(0, 2000);
    const b = JSON.parse(raw || "{}") as { e?: string; r?: string; p?: string; ref?: string };
    if (!SITE_EVENTS.includes(b.e as SiteEvent)) return c.body(null, 204);
    const r = typeof b.r === "string" && /^[0-9a-f]{12}$/.test(b.r) ? b.r : null;
    const path = typeof b.p === "string" ? b.p.slice(0, 120) : null;
    const ref = typeof b.ref === "string" ? b.ref.slice(0, 200) : null;
    await recordSiteEvent({ event: b.e as SiteEvent, r, path, ref });
  } catch (e) {
    console.error("track: " + (e as Error).message.slice(0, 120));
  }
  return c.body(null, 204);
});
