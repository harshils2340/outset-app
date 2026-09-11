import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { claimSecret } from "./claim.ts";
import { readJson, updateJson } from "./store.ts";

/**
 * Outreach opt-out. CAN-SPAM and CASL both need a working unsubscribe that we honor right away.
 * The email carries a signed token. The public file stores only hashes, never the address.
 */

const FILE = "mail/unsub.json";
const API = (process.env.API_URL || "https://outset-api.onrender.com").replace(/\/$/, "");
const SITE = (process.env.SITE_URL || "https://onoutset.com").replace(/\/$/, "");

export type UnsubFile = { hashes: Record<string, string> };

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
    // Render's disk is empty and ephemeral. The GitHub file is the real list.
  }
}

export async function recordUnsub(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const h = emailHash(e);
  const at = nowIso();
  rememberLocal(h, at);
  try {
    await updateJson<UnsubFile>(
      FILE,
      { hashes: {} },
      (cur) => ({ hashes: { ...(cur.hashes || {}), [h]: at } }),
      "Mail unsubscribe",
    );
  } catch (err) {
    console.error("unsub persist: " + (err as Error).message);
  }
}

/** Hashes we already have on this machine or in the public file. Does not call the API. */
export async function localUnsubHashes(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    db.exec("CREATE TABLE IF NOT EXISTS mail_unsub (email_hash TEXT PRIMARY KEY, at TEXT NOT NULL)");
    for (const r of db.prepare("SELECT email_hash FROM mail_unsub").all() as { email_hash: string }[]) set.add(r.email_hash);
  } catch {
    /* no local table */
  }
  const file = await readJson<UnsubFile>(FILE);
  if (file?.hashes) for (const h of Object.keys(file.hashes)) set.add(h);
  return set;
}

/** Local list plus whatever Render has recorded, so a send on the Mac honors clicks from the live site. */
export async function loadUnsubHashes(): Promise<Set<string>> {
  const set = await localUnsubHashes();
  try {
    const res = await fetch(API + "/mail/unsubscribed", { signal: AbortSignal.timeout(35000) });
    if (res.ok) {
      const j = (await res.json()) as { hashes?: string[] };
      for (const h of j.hashes || []) set.add(h);
    }
  } catch {
    /* offline send still uses the local file */
  }
  return set;
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
