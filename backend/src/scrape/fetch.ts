const UA = "OutsetBot/0.1 (+https://github.com/harshils2340/outset-app; public-profile-seeding)";

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
      accept: "text/html,application/xhtml+xml",
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
