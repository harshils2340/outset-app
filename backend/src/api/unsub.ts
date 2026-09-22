import { Hono } from "hono";
import { rateLimit } from "./auth.ts";
import { localSuppression, parseUnsubToken, recordUnsub } from "../lib/unsub.ts";

function page(title: string, msg: string, form = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.25rem; color: #111; line-height: 1.5; }
  a { color: #495940; }
  button { font: inherit; background: #495940; color: #fff; border: 0; border-radius: 8px; padding: 0.7rem 1.1rem; cursor: pointer; }
</style>
</head>
<body>
<p>${msg}</p>
${form}
<p><a href="https://onoutset.com/">Outset</a></p>
</body>
</html>`;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const unsub = new Hono();

async function apply(token: string | undefined): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = parseUnsubToken(token || "");
  if (!email) return { ok: false, error: "that unsubscribe link is not valid" };
  await recordUnsub(email);
  return { ok: true, email };
}

/**
 * Somebody opened the unsubscribe URL. It asks, and the button below does the work.
 *
 * Opening a link is not the same as asking for something, and this is the one link in our mail that used to
 * treat it as if it were. A mail client's own link-safety scanner (Outlook Safe Links, Gmail's, a corporate
 * gateway's) opens every URL in an incoming email before the recipient reads it, and one of them claimed a
 * real listing on 22 September 2026, which is why a claim link now asks too. Here the cost is quieter and
 * worse: the shop goes on the suppression list, no outreach ever reaches it again, and nobody, them or us,
 * ever learns why. The same load happens when a recipient clicks to see what the link says.
 *
 * One click still takes them off, which is all CAN-SPAM and CASL ask, and the POST below is untouched: Gmail
 * one-click and the site's own unsubscribe page both go through it.
 */
unsub.get("/unsubscribe", rateLimit(60, 60 * 60 * 1000), (c) => {
  const t = (c.req.query("t") || "").trim();
  const email = parseUnsubToken(t);
  if (!email) return c.html(page("Unsubscribe", "That link is not valid. Write to hello@onoutset.com and we will take you off the list."), 400);
  return c.html(
    page(
      "Unsubscribe",
      `Take <b>${escape(email)}</b> off the Outset list? We will not email this address again.`,
      `<form method="post" action="/unsubscribe?t=${encodeURIComponent(t)}"><button type="submit">Yes, unsubscribe me</button></form>`,
    ),
  );
});

/**
 * Gmail one-click, the site's own unsubscribe page, and the button on the page above. The first two read a
 * status and nothing else, so they keep the plain answer; a browser that submitted a form is shown a page.
 */
unsub.post("/unsubscribe", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const wantsPage = (c.req.header("accept") || "").includes("text/html");
  const r = await apply(c.req.query("t"));
  if (!r.ok) {
    if (wantsPage) return c.html(page("Unsubscribe", "That link is not valid. Write to hello@onoutset.com and we will take you off the list."), 400);
    return c.json({ error: r.error }, 400);
  }
  if (wantsPage) return c.html(page("Unsubscribed", "You are unsubscribed. We will not email this address again."));
  return c.text("OK", 200);
});

/**
 * Hashes only, so the Mac send job can skip people who opted out on Render.
 *
 * A database that cannot be read answers 503 rather than 200 with whatever this host happens to hold. The
 * list lives in Postgres; the local table is only what this process itself recorded, so a 200 carrying that
 * alone tells a sender "nobody has unsubscribed" and the next run mails every one of them again.
 */
unsub.get("/mail/unsubscribed", async (c) => {
  const list = await localSuppression();
  if (!list.fromDb) return c.json({ error: "suppression list unavailable" }, 503);
  return c.json({ hashes: [...list.hashes] });
});
