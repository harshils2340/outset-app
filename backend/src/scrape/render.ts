import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Last-resort page fetch: render in headless Chromium and return the DOM after scripts ran.
 * Used only when a plain fetch comes back empty (Wix and Squarespace shells, JavaScript-only menus, bot stubs).
 * One browser per process, one tab per page, hard timeouts everywhere. Never used for sites that read fine.
 *
 * The browser is a child of this Node process. Never unref it. Exit, Ctrl+C, and the next crawl all
 * kill every Chrome tagged with /tmp/outset-render- so leftovers cannot sit on the CPU.
 */

const PROFILE = "outset-render-";

/** Every browser Playwright has installed, newest build first. Covers `npx playwright install chromium` on Linux and macOS. */
function playwrightBrowsers(): string[] {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, homedir() + "/.cache/ms-playwright", homedir() + "/Library/Caches/ms-playwright"].filter((p): p is string => !!p && p !== "0");
  const out: string[] = [];
  for (const root of roots) {
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    // Headless shell first (smaller, what the crawl needs), then the full browser; higher build numbers first.
    const sorted = names
      .filter((n) => /^chromium(_headless_shell)?-\d+$/.test(n))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]) || (a.includes("headless") ? -1 : 1));
    for (const n of sorted) {
      const dir = join(root, n);
      let subs: string[] = [];
      try {
        subs = readdirSync(dir);
      } catch {
        continue;
      }
      for (const sub of subs) {
        // chrome-linux, chrome-headless-shell-linux, chrome-headless-shell-mac-arm64, chrome-mac-arm64 ...
        if (sub.startsWith("chrome-headless-shell")) out.push(join(dir, sub, "chrome-headless-shell"));
        else if (sub.startsWith("chrome-linux")) out.push(join(dir, sub, "chrome"));
        else if (sub.startsWith("chrome-mac")) out.push(join(dir, sub, "Chromium.app/Contents/MacOS/Chromium"));
      }
    }
  }
  return out;
}

const CANDIDATES = [
  process.env.OUTSET_CHROME,
  ...playwrightBrowsers(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter((p): p is string => !!p);

export function chromePath(): string | null {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

/** Linux containers (Render) have no user namespaces for the sandbox and a tiny /dev/shm; root refuses the sandbox outright. */
function platformFlags(): string[] {
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  return process.platform === "linux" || root ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-setuid-sandbox"] : [];
}

let browser: { proc: ChildProcess; port: number } | null = null;
let starting: Promise<{ proc: ChildProcess; port: number } | null> | null = null;
let hooked = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function killPid(pid: number): void {
  if (!pid || pid === process.pid) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

/** Kill leftover Outset headless Chrome only. Never Google Chrome, Cursor, or other apps. */
export function reapOrphanChrome(): number {
  let n = 0;
  try {
    const out = execFileSync("pgrep", ["-fl", PROFILE], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const pid = Number(line.trim().split(/\s+/)[0]);
      if (pid > 0 && pid !== process.pid) {
        killPid(pid);
        n += 1;
      }
    }
  } catch {
    /* pgrep exits 1 when nothing matches */
  }
  for (const root of [tmpdir(), "/tmp"]) {
    try {
      for (const name of readdirSync(root)) {
        if (!name.startsWith(PROFILE)) continue;
        rmSync(join(root, name), { recursive: true, force: true });
      }
    } catch {
      /* tmp busy */
    }
  }
  return n;
}

export function closeBrowser(): void {
  const proc = browser?.proc;
  browser = null;
  if (proc?.pid) killPid(proc.pid);
  reapOrphanChrome();
}

/** Call once per process. Reaps leftovers now, and again on exit or Ctrl+C. */
export function installChromeGuard(): void {
  if (hooked) return;
  hooked = true;
  reapOrphanChrome();
  const stop = () => closeBrowser();
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(143);
  });
  process.on("SIGHUP", () => {
    stop();
    process.exit(129);
  });
}

installChromeGuard();

async function getBrowser(): Promise<{ proc: ChildProcess; port: number } | null> {
  if (browser && browser.proc.exitCode == null) return browser;
  if (starting) return starting;
  starting = (async () => {
    const bin = chromePath();
    if (!bin) return null;
    const port = 9400 + Math.floor(Math.random() * 400);
    const dir = "/tmp/" + PROFILE + port;
    const proc = spawn(
      bin,
      ["--headless=new", ...platformFlags(), "--remote-debugging-port=" + port, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio", "--user-data-dir=" + dir, "--window-size=1280,900", "about:blank"],
      { stdio: "ignore" },
    );
    proc.on("exit", () => {
      if (browser?.proc === proc) browser = null;
    });
    for (let i = 0; i < 40; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (r.ok) {
          browser = { proc, port };
          return browser;
        }
      } catch {
        /* not up yet */
      }
      await sleep(250);
    }
    if (proc.pid) killPid(proc.pid);
    return null;
  })();
  const b = await starting;
  starting = null;
  return b;
}

type Msg = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> };

/** Rendered HTML and final URL, or null when the browser is missing or the page never settles. */
export async function renderPage(url: string, timeoutMs = 20000): Promise<{ html: string; finalUrl: string; status: number } | null> {
  const b = await getBrowser();
  if (!b) return null;
  let targetId = "";
  try {
    const t = (await (await fetch(`http://127.0.0.1:${b.port}/json/new?about:blank`, { method: "PUT" })).json()) as { id: string; webSocketDebuggerUrl: string };
    targetId = t.id;
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error("ws"));
    });
    let seq = 0;
    const pending = new Map<number, (m: Msg) => void>();
    let status = 0;
    let finalUrl = url;
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as Msg;
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)!(m);
        pending.delete(m.id);
      }
      if (m.method === "Network.responseReceived") {
        const p = m.params as { type?: string; response?: { status: number; url: string } };
        if (p.type === "Document" && p.response && !status) {
          status = p.response.status;
          finalUrl = p.response.url;
        }
      }
    };
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Msg>((res) => {
        seq += 1;
        pending.set(seq, res);
        ws.send(JSON.stringify({ id: seq, method, params }));
      });
    const deadline = Date.now() + timeoutMs;
    await send("Network.enable");
    await send("Page.enable");
    await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36" });
    await send("Page.navigate", { url });
    // Let scripts and lazy sections run. Stop early when the text stops growing.
    let last = -1;
    let stable = 0;
    while (Date.now() < deadline) {
      await sleep(700);
      const r = await send("Runtime.evaluate", { expression: "document.body ? document.body.innerText.length : 0", returnByValue: true });
      const n = Number((r.result as { result?: { value?: number } })?.result?.value ?? 0);
      if (n === last) stable += 1;
      else stable = 0;
      last = n;
      if (stable >= 3 && n > 200) break;
    }
    const r = await send("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true });
    const html = String((r.result as { result?: { value?: string } })?.result?.value ?? "");
    ws.close();
    return { html, finalUrl, status: status || 200 };
  } catch {
    return null;
  } finally {
    if (targetId) fetch(`http://127.0.0.1:${b.port}/json/close/${targetId}`).catch(() => undefined);
  }
}
