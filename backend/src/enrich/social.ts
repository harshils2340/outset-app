import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { sleep, withDeadline } from "../scrape/fetch.ts";
import { spawnWorkers } from "../scrape/cpu.ts";

/**
 * Social video for listings, no API keys.
 * YouTube: resolve the operator's handle to a channel id from the public channel page, then read the channel's
 * public RSS feed for recent videos with view counts. TikTok: the public creator embed shows a profile's latest
 * videos, so we only need the handle. Instagram has no public listing without an API, so it stays a link.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type YtVideo = { id: string; title: string; views: number; published: string };

async function text(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(12000), redirect: "follow" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** "UCxxxx" from a handle, custom name, or channel id. */
export async function youtubeChannelId(handle: string): Promise<string | null> {
  const h = handle.replace(/^@/, "").trim();
  if (/^UC[\w-]{20,}$/.test(h)) return h;
  for (const url of ["https://www.youtube.com/@" + h, "https://www.youtube.com/c/" + h, "https://www.youtube.com/user/" + h]) {
    const html = await text(url);
    if (!html) continue;
    const m = html.match(/"channelId":"(UC[\w-]{20,})"/) || html.match(/<meta itemprop="identifier" content="(UC[\w-]{20,})"/) || html.match(/channel\/(UC[\w-]{20,})/);
    if (m) return m[1];
  }
  return null;
}

function parseViews(t: string): number {
  const m = t.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase() as "K" | "M" | "B"] || 1;
  return Math.round(n * mult);
}

/** Recent public videos from the channel's videos page (the RSS feed no longer serves), most viewed first. */
export async function youtubeVideos(channelId: string): Promise<YtVideo[]> {
  const html = await text("https://www.youtube.com/channel/" + channelId + "/videos");
  if (!html) return [];
  const out: YtVideo[] = [];
  const seen = new Set<string>();
  // YouTube's current markup ("lockupViewModel") and the older one ("videoRenderer").
  const re = /"contentId":"([\w-]{11})"|"videoRenderer":\{"videoId":"([\w-]{11})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 24) {
    const id = m[1] || m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const chunk = html.slice(m.index, m.index + 8000);
    const title =
      chunk.match(/"title":\{"content":"((?:[^"\\]|\\.)*)"/)?.[1] ||
      chunk.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/)?.[1] ||
      "";
    const viewsText = chunk.match(/"metadataParts":\[\{"text":\{"content":"([^"]*)"/)?.[1] || chunk.match(/"viewCountText":\{"simpleText":"([^"]*)"/)?.[1] || "0";
    const published = chunk.match(/"metadataParts":\[\{"text":\{"content":"[^"]*"\}\},\{"text":\{"content":"([^"]*)"/)?.[1] || chunk.match(/"publishedTimeText":\{"simpleText":"([^"]*)"/)?.[1] || "";
    const clean = title.replace(/\\"/g, '"').replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (clean && !/#shorts/i.test(clean)) out.push({ id, title: clean.slice(0, 120), views: parseViews(viewsText), published });
  }
  return out.sort((a, b) => b.views - a.views).slice(0, 4);
}

export async function socialForOperator(op: { id: string; domain: string }): Promise<{ youtube: number; tiktok: boolean }> {
  const facts = db.prepare("SELECT fact_key, fact_value FROM facts WHERE operator_id = ? AND fact_key IN ('social:youtube', 'social:tiktok')").all(op.id) as { fact_key: string; fact_value: string }[];
  const yt = facts.find((f) => f.fact_key === "social:youtube")?.fact_value;
  const tt = facts.find((f) => f.fact_key === "social:tiktok")?.fact_value;
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key IN ('yt_video', 'tiktok_profile')").run(op.id);
  const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')");
  let n = 0;
  if (yt) {
    const channel = await youtubeChannelId(yt);
    if (channel) {
      const vids = await youtubeVideos(channel);
      for (const v of vids) {
        ins.run(randomUUID(), op.id, "yt_video", JSON.stringify(v), "https://www.youtube.com/watch?v=" + v.id);
        n += 1;
      }
    }
  }
  if (tt) ins.run(randomUUID(), op.id, "tiktok_profile", tt.replace(/^@/, ""), "https://www.tiktok.com/@" + tt.replace(/^@/, ""));
  db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'social'").run(op.id);
  db.prepare(
    "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'social', 1, ?)",
  ).run(randomUUID(), op.id, "social:" + op.domain, nowIso(), n + " YouTube videos" + (tt ? ", TikTok profile" : ""));
  return { youtube: n, tiktok: !!tt };
}

export function pendingSocial(limit: number): { id: string; domain: string }[] {
  return db
    .prepare(
      `SELECT DISTINCT o.id, o.domain FROM operators o JOIN facts f ON f.operator_id = o.id
       WHERE f.fact_key IN ('social:youtube', 'social:tiktok')
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'social')
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string }[];
}

export async function socialPending(limit: number, concurrency = 4): Promise<{ operators: number; videos: number; tiktok: number }> {
  const queue = pendingSocial(limit);
  const out = { operators: 0, videos: 0, tiktok: 0 };
  let i = 0;
  const worker = async (w: number) => {
    await sleep(w * 500);
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const r = await withDeadline(socialForOperator(op), 60000, op.domain);
        out.operators += 1;
        out.videos += r.youtube;
        if (r.tiktok) out.tiktok += 1;
      } catch (e) {
        console.error(op.domain + ": " + (e as Error).message.slice(0, 100));
      }
      await sleep(400);
    }
  };
  await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), queue.length) }, (_, w) => worker(w)));
  return out;
}
