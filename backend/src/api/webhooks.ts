import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { rateLimit } from "./auth.ts";
import { recordUnsub, type SuppressReason } from "../lib/unsub.ts";
import { recordOutreachEvent } from "../lib/outreachLog.ts";

/**
 * Delivery feedback from Resend.
 *
 * Outreach goes to addresses scraped from operators' own sites, so some of them are dead and some owners
 * will mark it as spam. Both have to stop the next send: a sender that keeps mailing hard bounces and
 * ignores complaints loses its domain reputation, and then the claim emails stop reaching anyone at all.
 * Every event here ends in the same suppression list `sendOutreach` already consults before each send.
 *
 * Point a Resend webhook at POST /webhooks/resend and put its signing secret in RESEND_WEBHOOK_SECRET.
 * Without that variable the route refuses everything: an unauthenticated endpoint that can suppress
 * addresses would let anyone quietly stop our mail to a competitor.
 */

export const webhooks = new Hono();

const TOLERANCE_MS = 5 * 60 * 1000;

/** Resend signs with Svix: HMAC-SHA256 over "<id>.<timestamp>.<body>", secret base64 after "whsec_". */
function verifySvix(raw: string, id: string, ts: string, header: string, secret: string): boolean {
  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) return false;
  // An attacker who captures one delivered webhook must not be able to replay it later.
  if (Math.abs(Date.now() - seconds * 1000) > TOLERANCE_MS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const want = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  const wantBuf = Buffer.from(want);

  // The header carries one or more space separated "v1,<signature>" pairs while a secret is rotating.
  for (const part of header.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const got = Buffer.from(sig);
    if (got.length === wantBuf.length && timingSafeEqual(got, wantBuf)) return true;
  }
  return false;
}

type ResendEvent = {
  type?: string;
  data?: {
    to?: string[] | string;
    email?: string;
    bounce?: { type?: string; subType?: string };
  };
};

/** Soft bounces are a full mailbox or a bad day. Only a permanent failure should retire an address. */
function reasonFor(ev: ResendEvent): SuppressReason | null {
  if (ev.type === "email.complained") return "complaint";
  if (ev.type !== "email.bounced") return null;
  const kind = (ev.data?.bounce?.type || "").toLowerCase();
  // Resend reports Permanent, Transient or Undetermined. Retire only the first.
  return kind === "permanent" ? "bounce" : null;
}

function addressesIn(ev: ResendEvent): string[] {
  const to = ev.data?.to ?? ev.data?.email;
  const list = Array.isArray(to) ? to : to ? [to] : [];
  return list.map((s) => String(s).trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

webhooks.post("/webhooks/resend", rateLimit(600, 60 * 60 * 1000), async (c) => {
  const secret = (process.env.RESEND_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    console.error("[webhook] RESEND_WEBHOOK_SECRET is not set, refusing the event");
    return c.json({ error: "not configured" }, 503);
  }

  // The signature covers the exact bytes sent, so read the body as text and parse it ourselves.
  const raw = await c.req.text();
  const id = c.req.header("svix-id") || "";
  const ts = c.req.header("svix-timestamp") || "";
  const sig = c.req.header("svix-signature") || "";
  if (!id || !ts || !sig || !verifySvix(raw, id, ts, sig, secret)) {
    console.error("[webhook] bad signature from " + (c.req.header("x-forwarded-for") || "unknown"));
    return c.json({ error: "bad signature" }, 401);
  }

  let ev: ResendEvent;
  try {
    ev = JSON.parse(raw) as ResendEvent;
  } catch {
    return c.json({ error: "bad json" }, 400);
  }

  const reason = reasonFor(ev);
  if (!reason) return c.json({ ok: true, suppressed: 0 });

  const addresses = addressesIn(ev);
  for (const address of addresses) {
    await recordUnsub(address, reason);
    // Counted as well as suppressed: the suppression list says "do not mail this again", the log says how many
    // of the emails that went out came back, which is the number that says whether outreach is working.
    if (reason !== "unsubscribe") await recordOutreachEvent(address, reason);
    // Loud on purpose: a rising count here is the early warning that sending is going wrong.
    console.warn(`[mail:${reason}] suppressed ${address}`);
  }
  return c.json({ ok: true, suppressed: addresses.length });
});
