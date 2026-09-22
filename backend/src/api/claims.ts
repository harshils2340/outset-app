import { Hono } from "hono";
import { ID, bodyText, clientIp, emailLimit, idsWith, jsonBody, rateLimit, signSession, verifySession, type Session } from "./auth.ts";
import { claimTokenV2, verifyClaimToken } from "../lib/claim.ts";
import { claimRule, emailMayClaim, maskEmail } from "../lib/claimIndex.ts";
import { sendMail } from "../lib/mail.ts";
import { renderEmail } from "../lib/emailTemplate.ts";
import { readJson } from "../lib/store.ts";
import { deleteProfile, unlinkListing } from "../lib/repo.ts";
import { logTestClaim, testClaimAllows } from "../lib/testClaim.ts";

/**
 * Claiming from the operator site. The owner finds their listing, types the address on their website (or one
 * at their domain), and the signed claim link goes to that inbox and nowhere else. Anyone else gets told which
 * address to use. The link itself is the same stateless one the outreach emails carry, so nothing has to be
 * remembered between the request and the click; the owner's name and phone ride along in the link.
 */

const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");
const SUPPORT = process.env.MAIL_REPLY_TO || "hello@onoutset.com";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const claims = new Hono();

/** What the claim screen shows before the owner types: which address the link can go to. */
claims.get("/claims/:id/rule", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const r = await claimRule(id);
  return c.json({ known: r.known, hasEmail: r.hasEmail, hint: r.hint, domains: r.domains });
});

/** The owner asks for their claim link. It goes only to the address on their site or one at their domain. */
claims.post("/claims/:id/request", rateLimit(10, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const body = await jsonBody<{ email: string; name: string; phone: string }>(c);
  const email = bodyText(body.email).trim().toLowerCase().slice(0, 200);
  const name = bodyText(body.name).trim().slice(0, 120);
  const phone = bodyText(body.phone).trim().slice(0, 40);
  if (!EMAIL.test(email)) return c.json({ error: "enter a valid email" }, 400);

  const { ok, rule } = await emailMayClaim(id, email);

  /* ---------- TEST BYPASS, testing only, off unless OUTSET_TEST_CLAIM_EMAILS names this address ----------
   * Kept as its own branch on purpose. The real check above runs first, unchanged, and its result is not
   * loosened. With the variable unset testClaimAllows() is false, so `bypass` is false and the rejection
   * below fires on exactly the inputs it fired on before. See backend/src/lib/testClaim.ts. */
  const bypass = !ok && testClaimAllows(email);
  if (bypass) logTestClaim("claim", email, id, clientIp(c));
  /* ---------- end TEST BYPASS ---------- */

  if (!ok && !bypass) {
    const reason = !rule.known ? "unknown" : rule.hasEmail || rule.domains.length ? "mismatch" : "none";
    console.log(`[claim] ${id}: ${reason} for ${maskEmail(email)} from ${clientIp(c)}`);
    return c.json({ ok: false, reason, hint: rule.hint, domains: rule.domains });
  }

  // The per-IP limit above does not protect one inbox: anyone who knows the address on an operator's site can
  // have a working claim link mailed there from every IP they can find, which floods the owner and sends the
  // sending domain to spam. Counted per address too, and said plainly, since "Send it again" is a real button.
  if (!emailLimit("claim:" + email, 5, 60 * 60 * 1000)) return c.json({ error: "we have already sent several links to that address in the past hour. Check your spam folder, or try again in an hour." }, 429);

  const item = await readJson<{ title?: string }>(`o/${id}.json`).catch(() => null);
  const title = item?.title || "your business";
  const owner = Buffer.from(JSON.stringify({ n: name, e: email, p: phone })).toString("base64url");
  const link = `${SITE}#claim=${id}&k=${claimTokenV2(id)}&o=${owner}`;
  const mail = renderEmail({
    eyebrow: "Your listing on Outset",
    heading: `Open the dashboard for ${title}`,
    intro: [`Hi ${name || "there"},`, `This link opens the Outset dashboard for ${title}. It is only for the owner, so please do not forward it.`],
    cta: { label: "Open my dashboard", url: link },
    after: ["It opens with no code. Check your prices and photos, set your hours, and switch bookings on when you are ready.", `If you did not ask for this, ignore this email and nothing changes. Questions: ${SUPPORT}`, "Harshil, Outset"],
  });
  // Plain text, like the outreach email this answers. The two land in the same business inbox minutes apart, and
  // a designed HTML reply to a plainly written note reads as a different, automated sender. The link is a bare
  // URL on its own line, which every mail client makes clickable. Guest-facing mail keeps its HTML.
  const r = await sendMail({ to: email, subject: `Your Outset claim link for ${title}`, text: mail.text, replyTo: process.env.MAIL_REPLY_TO || undefined });
  console.log(`[claim] ${id}: link for ${maskEmail(email)} from ${clientIp(c)} ${r.sent ? "sent " + r.id : "not sent (" + r.error + ")"}`);
  // TEST BYPASS: on a host with no mail transport at all there is no inbox to check, so hand the link back
  // to the allowlisted tester instead of only writing it to the log. Never for a normal claim, and never
  // on a host that can actually send (Resend or SMTP configured), where the link goes to the real inbox.
  const noMailTransport = !process.env.RESEND_API_KEY && !process.env.MAIL_SMTP_USER;
  if (bypass && noMailTransport) return c.json({ ok: true, sent: r.sent, to: maskEmail(email), bypass: true, link });
  return c.json({ ok: true, sent: r.sent, to: maskEmail(email), ...(bypass ? { bypass: true } : {}) });
});

/**
 * Trade a claim link for a session.
 *
 * Links minted now carry an expiry (see claimTokenV2). The static claimKey in the catalog cannot check
 * one, because that hash was baked at sync time and a v2 token changes with its expiry, so the app sends
 * the token here and this verifies it with the secret. What comes back is an ordinary session scoped to
 * the one listing, which every existing auth path already understands.
 *
 * A legacy static token is still accepted so links already sent keep working. Those never expire, which
 * is exactly why new ones do.
 */
claims.post("/claims/:id/exchange", rateLimit(30, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const body = await jsonBody<{ token: string }>(c);
  const check = verifyClaimToken(id, bodyText(body.token));
  if (!check.ok) {
    console.log(`[claim] ${id}: link rejected (${check.reason}) from ${clientIp(c)}`);
    // "expired" is worth telling the owner, so the screen can offer a fresh link instead of a dead end.
    return c.json({ ok: false, reason: check.reason }, check.reason === "expired" ? 410 : 401);
  }
  // Keep whatever the caller was already signed in to. A session is one token for every listing it may edit,
  // so handing back one scoped to this listing alone signed an operator out of their other shops the moment
  // they opened a second claim link: the dashboard still listed those shops, and every save answered 403.
  // The prior session is verified here, so nothing is added that the caller did not already hold.
  const prior = verifySession(c.req.header("x-session"));
  const session: Session = { ids: idsWith(prior, id), email: prior?.email || "", exp: Date.now() + 30 * 86400000 };
  return c.json({ ok: true, kind: check.kind, session: signSession(session), exp: session.exp });
});

/* ============================================================================================
 * TEST BYPASS ROUTES. Testing only. Both answer 404 unless OUTSET_TEST_CLAIM_EMAILS names the
 * address in the request, so with the variable unset they do not exist as far as callers can tell.
 * ============================================================================================ */

/** Does the test bypass cover this address on this host? Used to decide whether to show the test UI at all. */
claims.get("/claims/test-status", rateLimit(120, 60 * 60 * 1000), (c) => {
  const email = String(c.req.query("email") ?? "").trim().toLowerCase();
  // Never lists the allowlist, only confirms an address the caller already typed.
  return c.json({ active: testClaimAllows(email) });
});

/**
 * Enter a dashboard without a claim link, for testing only.
 *
 * A claim link carries a token checked against the claimKey the production sync baked into the catalog,
 * so a host without the production CLAIM_SECRET cannot mint a link that validates: the tester gets
 * "that claim link didn't check out" no matter how the link was requested. This route sidesteps the
 * token entirely and hands back the same signed session a verified sign-in would, scoped to this one
 * listing. The session is signed by THIS server, so it verifies here and nowhere else.
 *
 * Gated on exactly the same allowlist as the other two routes. With OUTSET_TEST_CLAIM_EMAILS unset,
 * testClaimAllows() is false for every input and this answers 404, the same as an unknown route.
 */
claims.post("/claims/:id/test-enter", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const body = await jsonBody<{ email: string }>(c);
  const email = bodyText(body.email).trim().toLowerCase().slice(0, 200);
  if (!testClaimAllows(email)) return c.json({ error: "not found" }, 404);
  logTestClaim("enter", email, id, clientIp(c));
  const session: Session = { ids: idsWith(verifySession(c.req.header("x-session")), id), email, exp: Date.now() + 30 * 86400000 };
  return c.json({ ok: true, session: signSession(session), exp: session.exp });
});

/**
 * Release a listing so it can be claimed again and the flow re-run. Deletes the stored profile and
 * unlinks the id from every email in the claim index, which is what "claimed" means on this side.
 * The operator's own device still has to clear its local copy; the app does that alongside this call.
 */
claims.post("/claims/:id/test-unclaim", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad id" }, 400);
  const body = await jsonBody<{ email: string }>(c);
  const email = bodyText(body.email).trim().toLowerCase().slice(0, 200);
  if (!testClaimAllows(email)) return c.json({ error: "not found" }, 404);
  logTestClaim("unclaim", email, id, clientIp(c));
  const removed = await deleteProfile(id).catch(() => false);
  const unlinked = await unlinkListing(id).catch(() => 0);
  console.warn(`TEST CLAIM BYPASS: ${id} released, profile ${removed ? "deleted" : "was not there"}, unlinked from ${unlinked} email(s)`);
  return c.json({ ok: true, removed, unlinked });
});
