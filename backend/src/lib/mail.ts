/**
 * Transactional email through Resend. With no RESEND_API_KEY the message is logged and reported as unsent,
 * so every flow still completes; the key switches delivery on without a code change.
 */
const FROM = process.env.MAIL_FROM || "Outset <onboarding@resend.dev>";

export async function sendMail(msg: { to: string; subject: string; text: string; replyTo?: string }): Promise<{ sent: boolean; id?: string; error?: string }> {
  const to = msg.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { sent: false, error: "bad address" };
  if (!process.env.RESEND_API_KEY) {
    console.log(`[mail:dry] to=${to} subject=${JSON.stringify(msg.subject)}\n${msg.text}\n`);
    return { sent: false, error: "no mail key" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + process.env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject: msg.subject, text: msg.text, reply_to: msg.replyTo }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { sent: false, error: "resend " + res.status + " " + (await res.text()).slice(0, 200) };
    const j = (await res.json()) as { id?: string };
    return { sent: true, id: j.id };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}
