import { Hono } from "hono";
import { ID, mayEdit, rateLimit } from "./auth.ts";
import { readJson, updateJson } from "../lib/store.ts";
import { stripeEnabled } from "../lib/stripe.ts";
import type { StoredProfile } from "./profiles.ts";

/**
 * Operator payouts through Stripe Connect Express. The operator clicks once, Stripe collects identity and
 * bank details on its own hosted pages, and we only keep the account id and whether payouts are enabled.
 * With no Stripe key every route reports payouts as not switched on; nothing is faked.
 */

const KEY = () => process.env.STRIPE_SECRET_KEY || "";
const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");

function form(obj: Record<string, string | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
    .join("&");
}

async function stripe<T>(path: string, body?: Record<string, string | undefined>): Promise<T> {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer " + KEY(), "content-type": "application/x-www-form-urlencoded" },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error("stripe: " + (j.error?.message || res.status));
  return j;
}

type Payout = { account: string; enabled: boolean; detailsSubmitted: boolean; updatedAt: string };
type ProfileWithPayout = StoredProfile & { payout?: Payout };

export const payouts = new Hono();

payouts.get("/payouts/:id", async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id) || !mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  if (!stripeEnabled()) return c.json({ available: false });
  const rec = await readJson<ProfileWithPayout>(`profiles/${id}.json`);
  if (!rec?.payout) return c.json({ available: true, connected: false });
  // Refresh the flags from Stripe so a finished onboarding shows without a second click.
  try {
    const acct = await stripe<{ payouts_enabled: boolean; details_submitted: boolean }>("accounts/" + rec.payout.account);
    const payout: Payout = { ...rec.payout, enabled: acct.payouts_enabled, detailsSubmitted: acct.details_submitted, updatedAt: new Date().toISOString() };
    if (payout.enabled !== rec.payout.enabled || payout.detailsSubmitted !== rec.payout.detailsSubmitted)
      await updateJson<ProfileWithPayout>(`profiles/${id}.json`, rec, (cur) => ({ ...cur, payout }), `Payouts: ${id} status`);
    return c.json({ available: true, connected: true, enabled: payout.enabled, detailsSubmitted: payout.detailsSubmitted });
  } catch {
    return c.json({ available: true, connected: true, enabled: rec.payout.enabled, detailsSubmitted: rec.payout.detailsSubmitted });
  }
});

/** Creates the Express account on first click and returns a hosted onboarding link; later clicks resume it. */
payouts.post("/payouts/:id/connect", rateLimit(20, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id) || !mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  if (!stripeEnabled()) return c.json({ error: "payouts are not switched on yet" }, 503);
  const rec = await readJson<ProfileWithPayout>(`profiles/${id}.json`);
  if (!rec) return c.json({ error: "claim the listing first" }, 404);
  try {
    let account = rec.payout?.account;
    if (!account) {
      const a = await stripe<{ id: string }>("accounts", {
        type: "express",
        email: rec.owner.email || undefined,
        "business_profile[name]": String((rec.patch as { title?: string }).title || id).slice(0, 100),
        "business_profile[url]": SITE + "#o=" + id,
        "capabilities[transfers][requested]": "true",
        "metadata[listing]": id,
      });
      account = a.id;
      await updateJson<ProfileWithPayout>(`profiles/${id}.json`, rec, (cur) => ({ ...cur, payout: { account: a.id, enabled: false, detailsSubmitted: false, updatedAt: new Date().toISOString() } }), `Payouts: ${id} connected`);
    }
    const link = await stripe<{ url: string }>("account_links", {
      account,
      type: "account_onboarding",
      refresh_url: SITE + "operators#payouts",
      return_url: SITE + "operators#payouts",
    });
    return c.json({ url: link.url });
  } catch (e) {
    return c.json({ error: (e as Error).message.slice(0, 160) }, 502);
  }
});
