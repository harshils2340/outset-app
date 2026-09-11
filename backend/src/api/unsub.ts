import { Hono } from "hono";
import { rateLimit } from "./auth.ts";
import { localUnsubHashes, parseUnsubToken, recordUnsub } from "../lib/unsub.ts";

function page(title: string, msg: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.25rem; color: #111; line-height: 1.5; }
  a { color: #E54D2C; }
</style>
</head>
<body>
<p>${msg}</p>
<p><a href="https://onoutset.com/">Outset</a></p>
</body>
</html>`;
}

export const unsub = new Hono();

async function apply(token: string | undefined): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = parseUnsubToken(token || "");
  if (!email) return { ok: false, error: "that unsubscribe link is not valid" };
  await recordUnsub(email);
  return { ok: true, email };
}

/** Gmail one-click and people who open the API URL directly. */
unsub.get("/unsubscribe", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const r = await apply(c.req.query("t"));
  if (!r.ok) return c.html(page("Unsubscribe", "That link is not valid. Write to hello@onoutset.com and we will take you off the list."), 400);
  return c.html(page("Unsubscribed", "You are unsubscribed. We will not email this address again."));
});

unsub.post("/unsubscribe", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const r = await apply(c.req.query("t"));
  if (!r.ok) return c.json({ error: r.error }, 400);
  return c.text("OK", 200);
});

/** Hashes only, so the Mac send job can skip people who opted out on Render. */
unsub.get("/mail/unsubscribed", async (c) => {
  const hashes = [...(await localUnsubHashes())];
  return c.json({ hashes });
});
