import { ImapFlow } from "imapflow";
import { mailboxClient } from "./imap.ts";
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
  const out = await placementMatrix([{ key: "only", samples }], opts);
  return out.get("only") || [];
}

/**
 * The same test for several candidate copies at once: every candidate goes from every sending mailbox to the next
 * one, one wait covers them all, and the results come back per candidate. This is what lets the daily run fall
 * back to a copy Gmail still puts in Primary instead of holding the batch (scripts/otto-cloud.mts).
 */
export async function placementMatrix(
  candidates: { key: string; samples: { subject: string; text: string; html?: string }[] }[],
  opts: { waitMs?: number; replyTo?: string } = {},
): Promise<Map<string, PlacementResult[]>> {
  const ids = smtpIdentities();
  const out = new Map<string, PlacementResult[]>(candidates.map((c) => [c.key, []]));
  if (ids.length < 2) return out;
  const sent: { key: string; tag: string; from: SmtpIdentity; to: SmtpIdentity; subject: string }[] = [];
  for (const c of candidates) {
    if (!c.samples.length) continue;
    for (let i = 0; i < ids.length; i++) {
      const from = ids[i], to = ids[(i + 1) % ids.length], s = c.samples[i % c.samples.length];
      const tag = "pt" + Math.random().toString(36).slice(2, 9);
      const res = await sendMail({ to: to.user, subject: s.subject + " " + tag, text: s.text, html: s.html, replyTo: opts.replyTo, commercial: true, via: from.user });
      if (res.sent) sent.push({ key: c.key, tag, from, to, subject: s.subject });
      else console.error(`placement: ${from.user} could not send its test: ${res.error}`);
    }
  }
  await new Promise((r) => setTimeout(r, opts.waitMs ?? 100_000));
  for (const to of ids) {
    const mine = sent.filter((s) => s.to.user === to.user);
    if (!mine.length) continue;
    const c = mailboxClient(to);
    try {
      await c.connect();
      const trash = await trashFolder(c);
      const lock = await c.getMailboxLock("[Gmail]/All Mail");
      try {
        for (const s of mine) {
          let placement: Placement = "unknown";
          for (const [q, label] of TABS) {
            const hit = (await c.search({ gmraw: `subject:${s.tag} ${q}` } as never, { uid: true })) || [];
            if (hit.length) { placement = label; break; }
          }
          out.get(s.key)!.push({ from: s.from.user, to: to.user, placement, subject: s.subject });
          const all = (await c.search({ gmraw: `subject:${s.tag} in:anywhere` } as never, { uid: true })) || [];
          if (all.length) await binTestCopies(c, all, trash);
        }
      } finally {
        lock.release();
      }
    } catch (e) {
      console.error(`placement: could not read ${to.user}: ${(e as Error).message.slice(0, 120)}`);
      for (const s of mine) out.get(s.key)!.push({ from: s.from.user, to: to.user, placement: "unknown", subject: s.subject });
    } finally {
      await c.logout().catch(() => undefined);
    }
  }
  return out;
}

/**
 * The test copies go to Gmail's Trash, read. Until 6 October 2026 they were "deleted" from All Mail, which Gmail
 * does not honour for a message that still carries the Inbox label: every test copy stayed in the receiving
 * inbox, five a run per inbox, and Harshil's Primary filled with "Missed calls at ... pt3x9..." mail.
 */
async function binTestCopies(c: ImapFlow, uids: number[], trash: string): Promise<void> {
  await c.messageFlagsAdd(uids, ["\\Seen"], { uid: true }).catch(() => undefined);
  await c.messageMove(uids, trash, { uid: true });
}

/** Gmail's Trash folder by its special use: "[Gmail]/Trash" in English, "[Gmail]/Bin" in British English. */
export async function trashFolder(c: ImapFlow): Promise<string> {
  const boxes = await c.list().catch(() => []);
  return boxes.find((b) => b.specialUse === "\\Trash")?.path || "[Gmail]/Trash";
}

/**
 * Whether Gmail answered at all. Every result is "unknown" when nothing could be measured: an inbox whose
 * IMAP would not open, a test send that never left, or fewer than two sending mailboxes, in which case no
 * test is sent in the first place. That is not a verdict, and the rule at the top of this file is that only
 * an explicit Promotions or Spam verdict may hold a batch, so a caller has to be able to tell the two apart.
 */
export function placementRead(results: PlacementResult[]): boolean {
  return results.some((r) => r.placement !== "unknown");
}

/** Hold the batch only on a clear verdict: at least two explicit Promotions/Spam, and no more Primary than that. */
export function placementVerdict(results: PlacementResult[]): { hold: boolean; summary: string } {
  const n = (p: Placement) => results.filter((r) => r.placement === p).length;
  const bad = n("promotions") + n("spam");
  const summary = `primary ${n("primary")}, promotions ${n("promotions")}, spam ${n("spam")}, updates ${n("updates")}, unknown ${n("unknown")}`;
  return { hold: bad >= 2 && bad >= n("primary"), summary };
}

/**
 * Which rung of the copy ladder to send with, in ladder order. Strict first: Primary in at least two inboxes and
 * nowhere in Promotions or Spam. Failing that, the first rung that still reached Primary in two inboxes with no
 * Spam. Null when nothing qualifies, which holds the batch.
 */
export function pickRung(rungs: { key: string; results: PlacementResult[] }[]): { key: string; summary: string; strict: boolean } | null {
  const tally = (rs: PlacementResult[]) => {
    const n = (p: Placement) => rs.filter((r) => r.placement === p).length;
    return { primary: n("primary"), bad: n("promotions") + n("spam"), spam: n("spam"), summary: placementVerdict(rs).summary };
  };
  for (const r of rungs) {
    const t = tally(r.results);
    if (t.primary >= 2 && t.bad === 0) return { key: r.key, summary: t.summary, strict: true };
  }
  for (const r of rungs) {
    const t = tally(r.results);
    if (t.primary >= 2 && t.spam === 0) return { key: r.key, summary: t.summary, strict: false };
  }
  return null;
}
