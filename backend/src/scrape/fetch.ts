/** Browser-like agent so ordinary sites serve real HTML. robots.txt is still honored below, and the From header says who we are. */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function robotsAllowed(origin: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/robots.txt", origin), {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return true;
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    let applies = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k)) {
        applies = v === "*" || v.toLowerCase().includes("outset");
      } else if (applies && /^disallow$/i.test(k)) {
        if (v && path.startsWith(v)) return false;
      }
    }
    return true;
  } catch {
    return true;
  }
}

export async function fetchHtml(url: string): Promise<{ status: number; html: string; finalUrl: string }> {
  const u = new URL(url);
  const allowed = await robotsAllowed(u.origin, u.pathname);
  if (!allowed) {
    return { status: 0, html: "", finalUrl: url };
  }
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      from: "harshils2340@gmail.com",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  const html = await res.text();
  return { status: res.status, html, finalUrl: res.url };
}

/** Hard deadline for any per-site job. Slow hosts must not stall a worker for the whole run. */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("deadline " + ms + "ms: " + label)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
