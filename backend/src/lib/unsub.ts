import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { pgConfigured } from "../db/pg.ts";
import { claimSecret } from "./claim.ts";
import { getDoc, updateDoc } from "./repo.ts";

/**
 * Outreach opt-out. CAN-SPAM and CASL both need a working unsubscribe that we honor right away.
 * The email carries a signed token. The list stores only hashes, never the address: in Postgres on the API host,
 * and in the local SQLite as a copy for a laptop sending outreach.
 */

const FILE = "mail/unsub.json";
const API = (process.env.API_URL || "https://outset-api.onrender.com").replace(/\/$/, "");
const SITE = (process.env.SITE_URL || "https://onoutset.com").replace(/\/$/, "");

/**
 * `hashes` is the suppression list every send checks: hash -> when. `reasons` says why, so a hard bounce
 * can be told from someone who opted out. Readers only ever take the keys of `hashes`, so adding this
 * map does not disturb an older file or an older reader.
 */
export type UnsubFile = { hashes: Record<string, string>; reasons?: Record<string, SuppressReason> };

export type SuppressReason = "unsubscribe" | "bounce" | "complaint";

export function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export function unsubToken(email: string): string {
  const e = email.trim().toLowerCase();
  const payload = Buffer.from(e).toString("base64url");
  const sig = createHmac("sha256", claimSecret()).update("unsub:" + e).digest("base64url").slice(0, 22);
  return payload + "." + sig;
}

export function parseUnsubToken(token: string): string | null {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig || sig.length > 64) return null;
  let email = "";
  try {
    email = Buffer.from(payload, "base64url").toString("utf8").trim().toLowerCase();
  } catch {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return null;
  const want = createHmac("sha256", claimSecret()).update("unsub:" + email).digest("base64url").slice(0, 22);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  return email;
}

/** Visible link in the email body. Lands on the static page, which tells the API. */
export function unsubPageUrl(email: string): string {
  return SITE + "/unsubscribe.html?t=" + unsubToken(email);
}

/** HTTPS endpoint Gmail one-click POSTs to. Must be the API, not GitHub Pages. */
export function unsubApiUrl(email: string): string {
  return API + "/unsubscribe?t=" + unsubToken(email);
}

export function mailPostal(): string {
  return (process.env.MAIL_POSTAL || "").trim();
}

function rememberLocal(hash: string, at: string): void {
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS mail_unsub (email_hash TEXT PRIMARY KEY, at TEXT NOT NULL)",
    );
    db.prepare("INSERT OR IGNORE INTO mail_unsub (email_hash, at) VALUES (?, ?)").run(hash, at);
  } catch {
    // Render's disk is empty and ephemeral. Postgres is the real list.
  }
}

/**
 * Stop mailing an address, for any of the three reasons that must stop it: they asked, it hard bounced,
 * or they marked us as spam. All three land in one list because the send path only needs one question
 * answered, "may I mail this address", and the reason is kept for reporting.
 */
export async function recordUnsub(email: string, reason: SuppressReason = "unsubscribe"): Promise<void> {
  const e = email.trim().toLowerCase();
  const h = emailHash(e);
  const at = nowIso();
  rememberLocal(h, at);
  try {
    await updateDoc<UnsubFile>(FILE, { hashes: {} }, (cur) => ({
      hashes: { ...(cur.hashes || {}), [h]: at },
      reasons: { ...(cur.reasons || {}), [h]: reason },
    }));
  } catch (err) {
    console.error("unsub persist: " + (err as Error).message);
  }
}

/**
 * Where a suppression list came from, because an empty list and a list nobody could read look identical and
 * mean opposite things. The real list lives in Postgres: the SQLite table only holds what this machine itself
 * recorded, which on a laptop that has never served the unsubscribe route is nothing at all.
 */
export type Suppression = { hashes: Set<string>; fromDb: boolean; fromApi: boolean; error?: string };

/** Hashes on this machine plus Postgres when this process can reach it. Does not call the API. */
export async function localSuppression(): Promise<Suppression> {
  const hashes = new Set<string>();
  try {
    db.exec("CREATE TABLE IF NOT EXISTS mail_unsub (email_hash TEXT PRIMARY KEY, at TEXT NOT NULL)");
    for (const r of db.prepare("SELECT email_hash FROM mail_unsub").all() as { email_hash: string }[]) hashes.add(r.email_hash);
  } catch {
    /* no local table */
  }
  if (!pgConfigured()) return { hashes, fromDb: false, fromApi: false, error: "DATABASE_URL is not set" };
  try {
    const file = await getDoc<UnsubFile>(FILE);
    if (file?.hashes) for (const h of Object.keys(file.hashes)) hashes.add(h);
    return { hashes, fromDb: true, fromApi: false };
  } catch (err) {
    return { hashes, fromDb: false, fromApi: false, error: (err as Error).message };
  }
}

export async function localUnsubHashes(): Promise<Set<string>> {
  return (await localSuppression()).hashes;
}

/**
 * Local list plus whatever Render has recorded, so a send on the Mac honors clicks from the live site.
 * Says whether either of those two answered: a send that cannot read the list must not go out, because the
 * list is the only thing standing between an opt-out and another email.
 */
export async function loadSuppression(): Promise<Suppression> {
  const local = await localSuppression();
  let error = local.error;
  try {
    const res = await fetch(API + "/mail/unsubscribed", { signal: AbortSignal.timeout(35000) });
    if (res.ok) {
      const j = (await res.json()) as { hashes?: string[] };
      for (const h of j.hashes || []) local.hashes.add(h);
      return { ...local, fromApi: true };
    }
    error = "GET " + API + "/mail/unsubscribed answered " + res.status;
  } catch (e) {
    error = (e as Error).message;
  }
  return { ...local, fromApi: false, error };
}

/** Footer required on commercial outreach. Does not repeat if the draft already has the link. */
export function withOutreachFooter(body: string, email: string): string {
  const page = unsubPageUrl(email);
  if (body.includes("/unsubscribe")) return body;
  const postal = mailPostal();
  const lines = [body.replace(/\s+$/, ""), "", "Don't want emails from Outset? Unsubscribe here and we will stop:", page];
  if (postal) lines.push("", postal);
  return lines.join("\n");
}
