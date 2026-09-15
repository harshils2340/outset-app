/**
 * One look for every email Outset sends: a short heading, a sentence or two, a details table, a price table
 * when money is involved, one button, and a quiet footer. Both halves come out of the same input, so the
 * plain-text copy (what a phone's notification shows) always says what the HTML says.
 *
 * Dates read as "Wednesday, September 16 at 2:00 PM", never "2026-09-16 at 14:00". Money carries its currency
 * ("$19.00 USD", "CA$25.00") so a Florida guest and a Tobermory guest each see the right dollars.
 */

export type EmailRow = { label: string; value: string };
export type EmailLine = { label: string; amount: string; total?: boolean };
export type EmailInput = {
  /** Small grey line above the heading, like "Booking request" or "Confirmed". */
  eyebrow?: string;
  heading: string;
  /** One or two sentences under the heading. Each string is its own paragraph. */
  intro: string[];
  rows?: EmailRow[];
  lines?: EmailLine[];
  /** A note under the price table, for "charged when the operator accepts". */
  priceNote?: string;
  cta?: { label: string; url: string };
  /** Short paragraphs after the button. */
  after?: string[];
  /** The line at the very bottom. Defaults to who sent it and why. */
  footer?: string;
};

const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");
const SUPPORT = process.env.MAIL_REPLY_TO || "hello@onoutset.com";

const FOREST = "#495940";
const INK = "#1f2a1c";
const SOFT = "#6b7466";
const LINE = "#e6e9e3";
const BG = "#f4f5f2";

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * "Wednesday, September 16" from "2026-09-16". A bad date comes back as it was rather than as "Invalid Date".
 *
 * A trip in another year carries its year, because bookings run up to a year ahead and "Sunday, January 3" in a
 * December email does not say which January.
 */
export function fmtDay(date: string, now = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!m) return date || "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return date;
  const year = d.getFullYear() === now.getFullYear() ? "" : `, ${d.getFullYear()}`;
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

/** "2:00 PM" from "14:00". */
export function fmtClock(slot: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(slot || "");
  if (!m) return slot || "";
  const h = Number(m[1]);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m[2]} ${ap}`;
}

/** "Wednesday, September 16 at 2:00 PM". */
export function fmtWhen(date: string, slot: string): string {
  return `${fmtDay(date)} at ${fmtClock(slot)}`;
}

export function guests(n: number): string {
  return `${n} guest${n === 1 ? "" : "s"}`;
}

/** Dollars with a currency the reader can tell apart: "$19.00 USD" or "CA$25.00". */
export function fmtMoney(dollars: number, currency = "usd"): string {
  const cur = (currency || "usd").toLowerCase();
  const n = Math.round(dollars * 100) / 100;
  const body = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cur === "cad") return `CA$${body}`;
  return `$${body} USD`;
}

/* ---------- rendering ---------- */

function textOf(e: EmailInput): string {
  const out: string[] = [];
  if (e.eyebrow) out.push(e.eyebrow.toUpperCase());
  out.push(e.heading, "");
  for (const p of e.intro) out.push(p, "");
  if (e.rows?.length) {
    for (const r of e.rows) out.push(`${r.label}: ${r.value}`);
    out.push("");
  }
  if (e.lines?.length) {
    for (const l of e.lines) out.push(`${l.label}: ${l.amount}`);
    if (e.priceNote) out.push(e.priceNote);
    out.push("");
  }
  if (e.cta) out.push(`${e.cta.label}: ${e.cta.url}`, "");
  for (const p of e.after || []) out.push(p, "");
  out.push(e.footer || `Outset, ${SITE}. Questions: ${SUPPORT}`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function htmlOf(e: EmailInput): string {
  const p = (s: string, extra = "") => `<p style="margin:0 0 14px;font-size:16px;line-height:24px;color:${INK};${extra}">${esc(s)}</p>`;
  const rows = e.rows?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:8px 0 18px;border-top:1px solid ${LINE};">${e.rows
        .map(
          (r) =>
            `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:13px;line-height:20px;color:${SOFT};width:34%;vertical-align:top;">${esc(r.label)}</td><td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:15px;line-height:22px;color:${INK};vertical-align:top;">${esc(r.value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const lines = e.lines?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 6px;background:${BG};border-radius:10px;">${e.lines
        .map(
          (l, i) =>
            `<tr><td style="padding:${i === 0 ? 14 : 6}px 16px ${l.total ? 14 : 6}px;font-size:${l.total ? 16 : 14}px;line-height:22px;color:${l.total ? INK : SOFT};${l.total ? `font-weight:700;border-top:1px solid ${LINE};padding-top:12px;` : ""}">${esc(l.label)}</td><td align="right" style="padding:${i === 0 ? 14 : 6}px 16px ${l.total ? 14 : 6}px;font-size:${l.total ? 16 : 14}px;line-height:22px;color:${INK};${l.total ? `font-weight:700;border-top:1px solid ${LINE};padding-top:12px;` : ""}white-space:nowrap;">${esc(l.amount)}</td></tr>`,
        )
        .join("")}</table>${e.priceNote ? `<p style="margin:6px 0 18px;font-size:13px;line-height:20px;color:${SOFT};">${esc(e.priceNote)}</p>` : `<div style="height:14px"></div>`}`
    : "";
  const cta = e.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;"><tr><td style="background:${FOREST};border-radius:10px;"><a href="${esc(e.cta.url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;">${esc(e.cta.label)}</a></td></tr></table>`
    : "";
  const after = (e.after || []).map((s) => p(s, `font-size:14px;line-height:22px;color:${SOFT};`)).join("");
  const footer = esc(e.footer || `Outset · ${SITE.replace(/^https?:\/\//, "").replace(/\/$/, "")} · Questions: ${SUPPORT}`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(e.heading)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BG};padding:28px 12px;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<tr><td style="padding:26px 28px 0;"><a href="${esc(SITE)}" style="text-decoration:none;font-size:18px;font-weight:800;letter-spacing:-0.01em;color:${FOREST};">Outset</a></td></tr>
<tr><td style="padding:22px 28px 8px;">
${e.eyebrow ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${SOFT};">${esc(e.eyebrow)}</p>` : ""}
<h1 style="margin:0 0 14px;font-size:24px;line-height:30px;font-weight:700;color:${INK};">${esc(e.heading)}</h1>
${e.intro.map((s) => p(s)).join("")}
${rows}${lines}${cta}${after}
</td></tr>
<tr><td style="padding:14px 28px 26px;border-top:1px solid ${LINE};font-size:12px;line-height:18px;color:${SOFT};">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function renderEmail(e: EmailInput): { text: string; html: string } {
  return { text: textOf(e), html: htmlOf(e) };
}
