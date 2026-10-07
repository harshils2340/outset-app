import { ImapFlow } from "imapflow";
import type { SmtpIdentity } from "../lib/mail.ts";

/**
 * An IMAP client for a sending mailbox, with its "error" event handled. imapflow emits "error" when Gmail closes
 * the socket, and an EventEmitter with no "error" listener throws it as an uncaught exception: on 7 October 2026
 * Gmail closed the reply sweep's connection to Harshil's inbox, the sweep's own try/catch logged it, and the
 * unhandled event then ended the whole run before a single email went out. Every IMAP client the outreach job
 * opens comes from here, so a dropped connection is a logged line and a failed step, never a dead run.
 */
export function mailboxClient(id: Pick<SmtpIdentity, "user" | "pass" | "host">): ImapFlow {
  const host = id.host === "smtp.gmail.com" || !id.host ? "imap.gmail.com" : id.host.replace(/^smtp\./, "imap.");
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: id.user, pass: id.pass }, logger: false });
  client.on("error", (e: Error) => console.error(`${id.user}: IMAP connection error: ${e.message.slice(0, 100)}`));
  return client;
}
