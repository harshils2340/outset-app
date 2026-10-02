import { ImapFlow } from "imapflow";
import { sendMail, smtpIdentities, type SmtpIdentity } from "../lib/mail.ts";

/**
 * Does today's pitch land in Gmail's Primary tab? Sends the real email, rendered for real businesses, from
 * each sending mailbox to the next one, waits for delivery, asks Gmail over IMAP which tab it filed each one
 * under, then deletes the test copies. Harshil, 2 October 2026, after finding the 1 October copy had sat in
 * Promotions for 596 sends: "every other day check if the emails are going to spam or promotions".
 *
 * Gmail to Gmail between our own accounts is a proxy, not every recipient: Outlook and company mail filter
 * differently. It is the one placement anyone can measure for free, and it is exactly what caught the problem.
 *
 * A copy Gmail could not find yet (indexing lags on a busy inbox) is "unknown", never counted as a pass or a
 * failure. Only explicit Promotions or Spam verdicts can hold a batch.
 */
export type Placement = "primary" | "promotions" | "updates" | "spam" | "unknown";
export type PlacementResult = { from: string; to: string; placement: Placement; subject: string };

const TABS: [string, Placement][] = [["category:primary", "primary"], ["category:promotions", "promotions"], ["category:updates", "updates"], ["in:spam", "spam"]];

export async function placementTest(
  samples: { subject: string; text: string; html?: string }[],
  opts: { waitMs?: number; replyTo?: string } = {},
): Promise<PlacementResult[]> {
  const ids = smtpIdentities();
  if (ids.length < 2 || !samples.length) return [];
  const sent: { tag: string; from: SmtpIdentity; to: SmtpIdentity; subject: string }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const from = ids[i], to = ids[(i + 1) % ids.length], s = samples[i % samples.length];
    const tag = "pt" + Math.random().toString(36).slice(2, 9);
    const res = await sendMail({ to: to.user, subject: s.subject + " " + tag, text: s.text, html: s.html, replyTo: opts.replyTo, commercial: true, via: from.user });
    if (res.sent) sent.push({ tag, from, to, subject: s.subject });
    else console.error(`placement: ${from.user} could not send its test: ${res.error}`);
  }
  await new Promise((r) => setTimeout(r, opts.waitMs ?? 100_000));
  const out: PlacementResult[] = [];
  for (const to of ids) {
    const mine = sent.filter((s) => s.to.user === to.user);
    if (!mine.length) continue;
    const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: to.user, pass: to.pass }, logger: false });
    try {
      await c.connect();
      const lock = await c.getMailboxLock("[Gmail]/All Mail");
      try {
        for (const s of mine) {
          let placement: Placement = "unknown";
          for (const [q, label] of TABS) {
            const hit = (await c.search({ gmraw: `subject:${s.tag} ${q}` } as never, { uid: true })) || [];
            if (hit.length) { placement = label; break; }
          }
          out.push({ from: s.from.user, to: to.user, placement, subject: s.subject });
          const all = (await c.search({ gmraw: `subject:${s.tag} in:anywhere` } as never, { uid: true })) || [];
          if (all.length) await c.messageDelete(all, { uid: true });
        }
      } finally {
        lock.release();
      }
    } catch (e) {
      console.error(`placement: could not read ${to.user}: ${(e as Error).message.slice(0, 120)}`);
      for (const s of mine) out.push({ from: s.from.user, to: to.user, placement: "unknown", subject: s.subject });
    } finally {
      await c.logout().catch(() => undefined);
    }
  }
  return out;
}

/** Hold the batch only on a clear verdict: at least two explicit Promotions/Spam, and no more Primary than that. */
export function placementVerdict(results: PlacementResult[]): { hold: boolean; summary: string } {
  const n = (p: Placement) => results.filter((r) => r.placement === p).length;
  const bad = n("promotions") + n("spam");
  const summary = `primary ${n("primary")}, promotions ${n("promotions")}, spam ${n("spam")}, updates ${n("updates")}, unknown ${n("unknown")}`;
  return { hold: bad >= 2 && bad >= n("primary"), summary };
}
