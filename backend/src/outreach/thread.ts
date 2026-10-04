import { ImapFlow } from "imapflow";
import { smtpIdentities } from "../lib/mail.ts";

/**
 * The first email's Message-ID and subject, read from the Sent folder of the mailbox that sent it, so the
 * follow-up (draftOttoBump) goes out as a reply to it: one thread in the owner's inbox, the first note right
 * under the nudge, rather than a second cold email. One IMAP connection per mailbox for the whole run.
 */
export type SentThread = { messageId: string; subject: string };

/** The newest of the messages found, by date. Pure, for the tests. */
export function newestThread(found: { messageId?: string; subject?: string; date?: Date }[]): SentThread | null {
  const best = found
    .filter((m) => m.messageId && m.subject)
    .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))[0];
  return best ? { messageId: best.messageId!, subject: best.subject! } : null;
}

export class SentThreads {
  private open = new Map<string, Promise<{ client: ImapFlow; folder: string } | null>>();

  private connect(mailbox: string): Promise<{ client: ImapFlow; folder: string } | null> {
    let p = this.open.get(mailbox);
    if (!p) {
      p = (async () => {
        const id = smtpIdentities().find((i) => i.user.toLowerCase() === mailbox.toLowerCase());
        if (!id) return null;
        const host = id.host === "smtp.gmail.com" ? "imap.gmail.com" : id.host.replace(/^smtp\./, "imap.");
        const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: id.user, pass: id.pass }, logger: false });
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
      })();
      this.open.set(mailbox, p);
    }
    return p;
  }

  /** The last email this mailbox sent `to` on or after `since` (a day's slack for time zones), or null. */
  async find(mailbox: string, to: string, since: Date): Promise<SentThread | null> {
    const box = await this.connect(mailbox);
    if (!box) return null;
    const lock = await box.client.getMailboxLock(box.folder);
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
