import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Last-resort page fetch: render in headless Chromium and return the DOM after scripts ran.
 * Used only when a plain fetch comes back empty (Wix and Squarespace shells, JavaScript-only menus, bot stubs).
 * One browser per process, one tab per page, hard timeouts everywhere. Never used for sites that read fine.
 */

const CANDIDATES = [
  process.env.OUTSET_CHROME,
  homedir() + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  homedir() + "/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter((p): p is string => !!p);

export function chromePath(): string | null {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

let browser: { proc: ChildProcess; port: number } | null = null;
let starting: Promise<{ proc: ChildProcess; port: number } | null> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getBrowser(): Promise<{ proc: ChildProcess; port: number } | null> {
  if (browser && browser.proc.exitCode == null) return browser;
  if (starting) return starting;
  starting = (async () => {
    const bin = chromePath();
    if (!bin) return null;
    const port = 9400 + Math.floor(Math.random() * 400);
    const proc = spawn(bin, ["--headless=new", "--remote-debugging-port=" + port, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio", "--user-data-dir=/tmp/outset-render-" + port, "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
    proc.unref();
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
    proc.kill();
    return null;
  })();
  const b = await starting;
  starting = null;
  return b;
}

export function closeBrowser(): void {
  if (browser) browser.proc.kill();
  browser = null;
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
