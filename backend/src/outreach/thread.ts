import { ImapFlow } from "imapflow";
import { mailboxClient } from "./imap.ts";
import { smtpIdentities } from "../lib/mail.ts";

/**
 * The first email's Message-ID and subject, read from the Sent folder of the mailbox that sent it, so the
 * follow-up (draftOttoBump) goes out as a reply to it: one thread in the owner's inbox, the first note right
 * under the nudge, rather than a second cold email. One IMAP connection per mailbox for the whole run, reopened
 * when Gmail has dropped it: sends are paced minutes apart, and on 6 October 2026 a connection left idle about 20
 * minutes threw "Connection not available" out of getMailboxLock and ended the run after 18 of 105 sends.
 */
export type SentThread = { messageId: string; subject: string };

/** The newest of the messages found, by date. Pure, for the tests. */
export function newestThread(found: { messageId?: string; subject?: string; date?: Date }[]): SentThread | null {
  const best = found
    .filter((m) => m.messageId && m.subject)
    .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))[0];
  return best ? { messageId: best.messageId!, subject: best.subject! } : null;
}

type Box = { client: Pick<ImapFlow, "getMailboxLock" | "search" | "fetch" | "logout">; folder: string };

export class SentThreads {
  private open = new Map<string, Promise<Box | null>>();

  /** `opener` is for the tests: a stand-in for the IMAP login. */
  constructor(private opener: (mailbox: string) => Promise<Box | null> = (m) => SentThreads.login(m)) {}

  private connect(mailbox: string): Promise<Box | null> {
    let p = this.open.get(mailbox);
    if (!p) {
      p = this.opener(mailbox);
      this.open.set(mailbox, p);
    }
    return p;
  }

  /** Forget a dead connection so the next call logs in again. */
  private async drop(mailbox: string): Promise<void> {
    const box = await this.open.get(mailbox)?.catch(() => null);
    this.open.delete(mailbox);
    await box?.client.logout().catch(() => undefined);
  }

  private static async login(mailbox: string): Promise<Box | null> {
    const id = smtpIdentities().find((i) => i.user.toLowerCase() === mailbox.toLowerCase());
    if (!id) return null;
    const client = mailboxClient(id);
    try {
      await client.connect();
      const boxes = await client.list();
      const sent = boxes.find((b) => b.specialUse === "\\Sent")?.path || "[Gmail]/Sent Mail";
      return { client, folder: sent };
    } catch (e) {
      console.error(`${mailbox}: could not open Sent for threading: ${(e as Error).message.slice(0, 120)}`);
      await client.logout().catch(() => undefined);
      return null;
    }
  }

  /** The last email this mailbox sent `to` on or after `since` (a day's slack for time zones), or null. */
  async find(mailbox: string, to: string, since: Date): Promise<SentThread | null> {
    // Never throws: a follow-up with no thread still goes out as a plain "Re:", and the run goes on.
    for (let attempt = 0; attempt < 2; attempt++) {
      const box = await this.connect(mailbox).catch(() => null);
      if (!box) {
        this.open.delete(mailbox); // a failed login is retried on the next follow-up, not cached for the run
        return null;
      }
      let lock: { release(): void };
      try {
        lock = await box.client.getMailboxLock(box.folder);
      } catch (e) {
        console.error(`${mailbox}: Sent connection lost (${(e as Error).message.slice(0, 80)}), ${attempt ? "giving up on this thread" : "reconnecting"}`);
        await this.drop(mailbox);
        continue;
      }
      return this.search(box, lock, mailbox, to, since);
    }
    return null;
  }

  private async search(box: Box, lock: { release(): void }, mailbox: string, to: string, since: Date): Promise<SentThread | null> {
    try {
      const uids = (await box.client.search({ to, since: new Date(since.getTime() - 86_400_000) }, { uid: true })) || [];
      if (!uids.length) return null;
      const found: { messageId?: string; subject?: string; date?: Date }[] = [];
      for await (const m of box.client.fetch(uids, { uid: true, envelope: true }, { uid: true }))
        found.push({ messageId: m.envelope?.messageId, subject: m.envelope?.subject, date: m.envelope?.date ? new Date(m.envelope.date) : undefined });
      return newestThread(found);
    } catch (e) {
      console.error(`${mailbox}: could not search Sent for ${to}: ${(e as Error).message.slice(0, 120)}`);
      return null;
    } finally {
      lock.release();
    }
  }

  async close(): Promise<void> {
    for (const p of this.open.values()) {
      const box = await p.catch(() => null);
      await box?.client.logout().catch(() => undefined);
    }
    this.open.clear();
  }
}
