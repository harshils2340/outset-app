import type { Unclaimed } from "../data/types";

/**
 * The tiny hosted API that makes operator edits persistent. Everything here is optional: with no API
 * reachable, the app keeps working from browser storage and the static profile files in the site.
 */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || "").replace(/\/$/, "");

const TOKEN_PREFIX = "outset.claimtoken.";

export function rememberClaimToken(id: string, token: string): void {
  try { localStorage.setItem(TOKEN_PREFIX + id, token); } catch { /* ignore */ }
}
export function claimTokenFor(id: string): string | null {
  try { return localStorage.getItem(TOKEN_PREFIX + id); } catch { return null; }
}

export type RemoteProfile = { id: string; published: boolean; patch: Partial<Unclaimed>; updatedAt: string; profile?: unknown; owner?: { name: string; email: string; phone: string } };

/** The operator's saved state from the API (with token) or the static site (guest view). */
export async function fetchRemoteProfile(id: string): Promise<RemoteProfile | null> {
  const token = claimTokenFor(id);
  if (API_URL) {
    try {
      const res = await fetch(`${API_URL}/profiles/${encodeURIComponent(id)}`, { headers: token ? { "x-claim-token": token } : {}, signal: AbortSignal.timeout(6000) });
      if (res.ok) return (await res.json()) as RemoteProfile;
      if (res.status === 404) return null;
    } catch { /* fall through to the static copy */ }
  }
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}profiles/${encodeURIComponent(id)}.json`, { cache: "no-cache", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return (await res.json()) as RemoteProfile;
  } catch {
    return null;
  }
}

export async function claimRemote(id: string, token: string, owner: { name: string; email: string; phone: string }): Promise<boolean> {
  if (!API_URL) return false;
  try {
    const res = await fetch(`${API_URL}/claims/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json", "x-claim-token": token }, body: JSON.stringify({ owner }), signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch {
    return false;
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;
let queued: { id: string; body: unknown } | null = null;

/** Debounced: the dashboard saves on every keystroke, the API hears about it once a second. */
export function saveRemoteProfile(id: string, body: { profile: unknown; patch: Partial<Unclaimed>; published: boolean; owner: { name: string; email: string; phone: string } }): void {
  const token = claimTokenFor(id);
  if (!API_URL || !token) return;
  queued = { id, body };
  if (pending) clearTimeout(pending);
  pending = setTimeout(async () => {
    pending = null;
    const q = queued;
    queued = null;
    if (!q) return;
    try {
      await fetch(`${API_URL}/profiles/${encodeURIComponent(q.id)}`, { method: "PUT", headers: { "content-type": "application/json", "x-claim-token": token }, body: JSON.stringify(q.body), signal: AbortSignal.timeout(15000) });
    } catch { /* next save retries */ }
  }, 1200);
}
