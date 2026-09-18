/**
 * No auto-deploys overnight. Between 4am and 10am Eastern the overnight sessions push commit after commit, and
 * each push used to build the site and the API on Render, which is how the month's free build minutes ran out
 * in one night. During the window auto-deploy is switched off on both services; at the end of it auto-deploy
 * comes back and one deploy per service carries the night's commits out together, and only when main has moved
 * since the last live build, so a quiet night costs nothing.
 *
 * Needs RENDER_API_KEY (a Render account API key, Account Settings > API Keys) on the API service. Without it,
 * or with RENDER_DEPLOY_WINDOW=off, nothing here runs. Service ids are the two production services.
 */

const RENDER = "https://api.render.com/v1";
const SERVICES = (process.env.RENDER_DEPLOY_SERVICES || "srv-dak3eu6q1p3s73cfn74g,srv-dahg3c2fngtc739bgq70").split(",").map((s) => s.trim()).filter(Boolean);
const REPO = process.env.GITHUB_REPO || "harshils2340/outset-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";
/** Window in Eastern local time, 24-hour: from WINDOW_START inclusive to WINDOW_END exclusive. */
const WINDOW_START = Number(process.env.RENDER_DEPLOY_WINDOW_START || 4);
const WINDOW_END = Number(process.env.RENDER_DEPLOY_WINDOW_END || 10);
const CHECK_MS = 10 * 60 * 1000;

function easternHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", hour: "numeric", hour12: false }).format(now));
}

export function inQuietWindow(now = new Date()): boolean {
  const h = easternHour(now);
  return h >= WINDOW_START && h < WINDOW_END;
}

async function render<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const key = (process.env.RENDER_API_KEY || "").trim();
  if (!key) return null;
  try {
    const res = await fetch(RENDER + path, { ...init, headers: { authorization: "Bearer " + key, "content-type": "application/json", accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn("[deploy-window] " + (init.method || "GET") + " " + path + " -> " + res.status);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.warn("[deploy-window] " + path + ": " + (e as Error).message);
    return null;
  }
}

async function autoDeploy(id: string): Promise<"yes" | "no" | null> {
  const s = await render<{ autoDeploy?: "yes" | "no" }>("/services/" + id);
  return s?.autoDeploy ?? null;
}

async function setAutoDeploy(id: string, on: boolean): Promise<boolean> {
  return !!(await render("/services/" + id, { method: "PATCH", body: JSON.stringify({ autoDeploy: on ? "yes" : "no" }) }));
}

/** The commit the service is serving now: its most recent live deploy. */
async function liveCommit(id: string): Promise<string | null> {
  const list = await render<{ deploy: { status: string; commit?: { id?: string } } }[]>("/services/" + id + "/deploys?limit=10");
  const live = (list || []).map((x) => x.deploy).find((d) => d.status === "live");
  return live?.commit?.id || null;
}

async function mainHead(): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/repos/" + REPO + "/commits/" + BRANCH, { headers: { accept: "application/vnd.github+json", "user-agent": "outset-api" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return ((await res.json()) as { sha?: string }).sha || null;
  } catch {
    return null;
  }
}

/** One pass: switch auto-deploy to match the window, and when the window ends, deploy what the night pushed. */
export async function applyDeployWindow(now = new Date()): Promise<void> {
  if (!(process.env.RENDER_API_KEY || "").trim() || (process.env.RENDER_DEPLOY_WINDOW || "").toLowerCase() === "off") return;
  const quiet = inQuietWindow(now);
  const head = quiet ? null : await mainHead();
  for (const id of SERVICES) {
    const cur = await autoDeploy(id);
    if (cur === null) continue;
    if (quiet && cur === "yes") {
      if (await setAutoDeploy(id, false)) console.log("[deploy-window] " + id + ": auto-deploy off for the night");
      continue;
    }
    if (!quiet && cur === "no") {
      if (!(await setAutoDeploy(id, true))) continue;
      console.log("[deploy-window] " + id + ": auto-deploy back on");
      const live = await liveCommit(id);
      if (head && live && head !== live) {
        const d = await render<{ id?: string }>("/services/" + id + "/deploys", { method: "POST", body: JSON.stringify({}) });
        console.log("[deploy-window] " + id + ": deploying " + head.slice(0, 7) + " over " + live.slice(0, 7) + (d?.id ? " (" + d.id + ")" : " (request failed)"));
      } else console.log("[deploy-window] " + id + ": nothing new since " + (live || "?").slice(0, 7));
    }
  }
}

/** Runs on boot and every ten minutes. An instance asleep at the boundary catches up on its next wake. */
export function startDeployWindow(): void {
  if (!(process.env.RENDER_API_KEY || "").trim()) {
    console.log("[deploy-window] RENDER_API_KEY is not set; auto-deploy stays on around the clock");
    return;
  }
  console.log("[deploy-window] armed: no auto-deploys " + WINDOW_START + ":00 to " + WINDOW_END + ":00 Eastern, one catch-up deploy after; " + (inQuietWindow() ? "inside" : "outside") + " the window now");
  void applyDeployWindow();
  const t = setInterval(() => void applyDeployWindow(), CHECK_MS);
  t.unref();
}
