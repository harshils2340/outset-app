import { sendMail } from "../lib/mail.ts";
import { fmtDay, fmtMoney, fmtWhen, guests, renderEmail, type EmailLine, type EmailRow } from "../lib/emailTemplate.ts";
import { readJson } from "../lib/store.ts";
import { maskEmail } from "../lib/claimIndex.ts";
import { dialPhone } from "../../../src/lib/phone.ts";
import { streetOf } from "../../../src/lib/address.ts";
import { OPERATOR_FEE_RATE, currencyForArea, operatorShare, subtotalFromTotal } from "../payments/money.ts";
import type { StoredBooking } from "./bookings.ts";
import type { StoredProfile } from "./profiles.ts";

/**
 * Every email a booking sends, to the guest, the operator and the founder. One place, one voice, and the
 * numbers in each of them come from the same split: what the guest paid, the operator's price, the service
 * fee, and what the operator receives.
 */

const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");
const DASHBOARD = SITE + "operators";

type Detail = { title?: string; area?: string; checkin?: string; contact?: { phone?: string; street?: string; city?: string; region?: string } };

export type BookingContext = {
  title: string;
  currency: string;
  where: string;
  shopPhone: string;
  ownerEmail: string;
  listingUrl: string;
  arrival: string;
};

const clean = (s: unknown, max: number) => String(s ?? "").split("").filter((ch) => ch.charCodeAt(0) >= 32).join("").trim().slice(0, max);

/**
 * A shop phone worth printing in the "CALL THE SHOP" alert: the line as published, so an extension and a
 * second number reach the person reading it, but only when there is a number in it at all. Without this the
 * alert asked the founder to ring an unrendered template placeholder, or a winery's "1-800-GAMBLER".
 */
const phoneLine = (v: unknown) => {
  const text = clean(v, 40);
  return dialPhone(text) ? text : "";
};

/**
 * What the business says about arriving, or "" when they say nothing. The guest listing shows the same line and
 * drops the same sign-offs ("See you soon!"), which are a goodbye and not arrival information. Outset has no
 * arrival rule of its own, so with nothing here the email says nothing.
 */
const SIGN_OFF = /^(see you|thank|welcome|we look forward|have fun|enjoy)\b/i;

function arrivalLine(patch: { checkin?: string }, detail: Detail | null): string {
  const raw = clean(patch.checkin ?? detail?.checkin, 240);
  return raw && !SIGN_OFF.test(raw) ? raw : "";
}

/** The business as the emails should name and place it. */
export async function bookingContext(rec: StoredBooking, profile: StoredProfile | null, known?: Detail | null): Promise<BookingContext> {
  // The booking route has already read this file to price the booking. Reading it again cost a second GitHub
  // round trip on the one request a guest is actually waiting on.
  const detail = known !== undefined ? known : await readJson<Detail>(`o/${rec.listing}.json`).catch(() => null);
  const patch = (profile?.patch || {}) as { title?: string; address?: string; phone?: string; checkin?: string };
  const title = clean(patch.title, 120) || clean(detail?.title, 120) || rec.listing;
  const currency = rec.payment?.currency || currencyForArea(detail?.area, process.env.STRIPE_CURRENCY || "usd");
  // The same street the listing page prints: a town or a bare house number in that field is not an address,
  // and "Where: Sarasota, Sarasota" is what the guest's own confirmation said.
  const street = detail?.contact ? streetOf(detail.contact) : "";
  const where = clean(patch.address, 160) || [street, detail?.contact?.city].filter(Boolean).join(", ") || clean(detail?.area, 80);
  return { title, currency, where, shopPhone: phoneLine(patch.phone) || phoneLine(detail?.contact?.phone), ownerEmail: profile?.owner.email || "", listingUrl: `${SITE}#o=${rec.listing}`, arrival: arrivalLine(patch, detail) };
}

/** What the guest pays and what the operator gets, in dollars. */
export function moneyOf(rec: StoredBooking): { total: number; subtotal: number; fee: number; net: number } | null {
  if (rec.total == null || !(rec.total > 0)) return null;
  const subtotal = rec.pricing?.subtotal ?? rec.payment?.subtotal ?? subtotalFromTotal(rec.total);
  const fee = Math.max(0, Math.round((rec.total - subtotal) * 100) / 100);
  // The same cents the Stripe transfer is made in, so the email cannot promise a cent the transfer does not send.
  const net = operatorShare(Math.round(subtotal * 100)).operatorNet / 100;
  return { total: rec.total, subtotal, fee, net };
}

const what = (rec: StoredBooking, title: string) => `${rec.service || title}${rec.variant ? " (" + rec.variant + ")" : ""}`;

function bookingRows(rec: StoredBooking, ctx: BookingContext, opts: { guest?: boolean; where?: boolean } = {}): EmailRow[] {
  const rows: EmailRow[] = [
    { label: "What", value: what(rec, ctx.title) },
    { label: "When", value: fmtWhen(rec.date, rec.slot) },
    { label: "Guests", value: guests(rec.qty) },
  ];
  if (rec.addons.length) rows.push({ label: "Add-ons", value: rec.addons.join(", ") });
  if (opts.guest) rows.push({ label: "Guest", value: [rec.guest.name, rec.guest.phone, rec.guest.email].filter(Boolean).join(" · ") });
  if (opts.where !== false && ctx.where) rows.push({ label: "Where", value: ctx.where });
  rows.push({ label: "Code", value: rec.code });
  return rows;
}

/** The guest's price table: the operator's price, the service fee, the total. */
function guestLines(rec: StoredBooking, ctx: BookingContext): EmailLine[] | undefined {
  const m = moneyOf(rec);
  if (!m) return undefined;
  const lines: EmailLine[] = [{ label: what(rec, ctx.title), amount: fmtMoney(m.subtotal, ctx.currency) }];
  if (m.fee > 0) lines.push({ label: "Service fee", amount: fmtMoney(m.fee, ctx.currency) });
  lines.push({ label: "Total", amount: fmtMoney(m.total, ctx.currency), total: true });
  return lines;
}

/** The operator's price table: what the guest paid, Outset's fee, what the operator receives. */
function operatorLines(rec: StoredBooking, ctx: BookingContext): EmailLine[] | undefined {
  const m = moneyOf(rec);
  if (!m) return undefined;
  return [
    { label: "Your price", amount: fmtMoney(m.subtotal, ctx.currency) },
    { label: `Outset fee (${Math.round(OPERATOR_FEE_RATE * 100)}%)`, amount: "-" + fmtMoney(m.subtotal - m.net, ctx.currency) },
    { label: "You receive", amount: fmtMoney(m.net, ctx.currency), total: true },
  ];
}

const card = (rec: StoredBooking) => rec.payment?.state === "authorized" || rec.payment?.state === "captured";

/* ---------- when a booking is made ---------- */

export async function mailNewBooking(rec: StoredBooking, profile: StoredProfile | null, known?: Detail | null): Promise<void> {
  const ctx = await bookingContext(rec, profile, known);
  // Three separate people hear about one booking. Sending them one after another made the slowest of the three
  // the cost of all three.
  const outbox: Parameters<typeof sendMail>[0][] = [];
  const instant = rec.status === "accepted";
  const m = moneyOf(rec);
  const paid = card(rec) && m;

  if (ctx.ownerEmail) {
    const e = renderEmail({
      eyebrow: instant ? "New booking" : "Booking request",
      heading: instant ? `${rec.guest.name} booked ${what(rec, ctx.title)}` : `${rec.guest.name} asked to book ${what(rec, ctx.title)}`,
      intro: instant
        ? [`It is confirmed for ${fmtWhen(rec.date, rec.slot)}.` + (paid ? ` Their card was charged ${fmtMoney(m.total, ctx.currency)}; your share is sent on your next pay day after the trip.` : m ? " They pay you on the day." : "")]
        : [`They want ${fmtWhen(rec.date, rec.slot)}.` + (paid ? ` Their card is on hold for ${fmtMoney(m.total, ctx.currency)} and is charged when you accept.` : m ? " They pay you on the day." : "") + " Reply to this email to reach them directly."],
      rows: bookingRows(rec, ctx, { guest: true, where: false }),
      lines: operatorLines(rec, ctx),
      cta: instant ? { label: "Open your bookings", url: DASHBOARD } : { label: "Accept or decline", url: DASHBOARD },
      after: instant ? [] : ["A request waits for your answer; the guest is told the moment you decide."],
    });
    outbox.push({ to: ctx.ownerEmail, subject: (instant ? "New booking: " : "Booking request: ") + `${rec.guest.name}, ${fmtDay(rec.date)} ${rec.slot ? "at " + fmtWhen(rec.date, rec.slot).split(" at ")[1] : ""}`.trim(), ...e, replyTo: rec.guest.email || undefined });
  }

  // Every listing is unclaimed until its owner signs in, and an unclaimed listing has no owner address, so a
  // request to one reached nobody but the guest. The founder places those bookings by phone until the shop
  // claims, so every request comes to the founder, with the shop's number, and a claimed shop's are copied too.
  const alertTo = process.env.BOOKING_ALERT_EMAIL || process.env.MAIL_REPLY_TO || "";
  if (alertTo) {
    const claimed = !!ctx.ownerEmail;
    const e = renderEmail({
      eyebrow: claimed ? "Booking" : "Call the shop",
      heading: claimed ? `${ctx.title}: ${instant ? "booking" : "request"} ${rec.code}` : `Unclaimed: ${ctx.title} has a ${instant ? "booking" : "request"}`,
      intro: [
        claimed ? `The shop was emailed at ${ctx.ownerEmail}.` : "Nobody at the shop has been told. Call them and place it by phone.",
        paid ? `Card ${instant ? "charged" : "on hold"} for ${fmtMoney(m.total, ctx.currency)}.` : m ? `${fmtMoney(m.total, ctx.currency)}, paid on site.` : "No price on the option.",
      ],
      rows: [{ label: "Shop", value: ctx.title }, { label: "Shop phone", value: ctx.shopPhone || "no phone on file" }, ...bookingRows(rec, ctx, { guest: true })],
      cta: { label: "Open the listing", url: ctx.listingUrl },
    });
    outbox.push({ to: alertTo, subject: (claimed ? "Booking " : "CALL THE SHOP: booking ") + `${rec.code} for ${ctx.title}, ${fmtWhen(rec.date, rec.slot)}`, ...e, replyTo: rec.guest.email || undefined });
  }

  if (rec.guest.email) {
    const e = renderEmail({
      eyebrow: instant ? "Confirmed" : "Request sent",
      heading: instant ? `You're booked with ${ctx.title}` : `Your request is with ${ctx.title}`,
      intro: instant
        ? [`Your spot is confirmed for ${fmtWhen(rec.date, rec.slot)}.`, paid ? `Your card was charged ${fmtMoney(m.total, ctx.currency)}.` : m ? `You pay ${ctx.title} on the day.` : ""]
        // No operator promised an answer within the day. What we know is that the request reached them and
        // that this guest hears from us as soon as they answer.
        : [`Your request is with ${ctx.title}. You will get another email the moment they answer.`, paid ? `Your card is on hold for ${fmtMoney(m.total, ctx.currency)} and is only charged once they confirm.` : m ? `Nothing is charged now. You pay ${ctx.title} on the day.` : ""],
      rows: bookingRows(rec, ctx),
      lines: guestLines(rec, ctx),
      priceNote: paid ? (instant ? "Charged to your card." : "Held on your card, charged when the operator confirms.") : m ? "Paid to the business on the day." : undefined,
      cta: { label: "View the listing", url: ctx.listingUrl },
      after: instant && ctx.arrival ? [ctx.arrival] : [],
    });
    outbox.push({ to: rec.guest.email, subject: (instant ? "You're booked: " : "Request sent: ") + `${ctx.title}, ${fmtWhen(rec.date, rec.slot)}`, ...e });
  }
  // One failure must not stop the others: an operator with a dead address should not cost the guest their receipt.
  const sent = await Promise.allSettled(outbox.map((m) => sendMail(m)));
  sent.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[mail] ${rec.code} to ${maskEmail(outbox[i].to)}: ${String((r as PromiseRejectedResult).reason).slice(0, 160)}`);
  });
}

/* ---------- when the operator decides ---------- */

export async function mailDecision(rec: StoredBooking, profile: StoredProfile | null, status: "accepted" | "declined" | "cancelled", opts: { refunded?: boolean; released?: boolean } = {}): Promise<void> {
  if (!rec.guest.email) return;
  const ctx = await bookingContext(rec, profile);
  const m = moneyOf(rec);
  const charged = rec.payment?.state === "captured" && m;
  const when = fmtWhen(rec.date, rec.slot);
  const note = rec.note ? [`From ${ctx.title}: ${rec.note}`] : [];

  if (status === "accepted") {
    const e = renderEmail({
      eyebrow: "Confirmed",
      heading: `${ctx.title} confirmed your booking`,
      intro: [`See you ${when}.`, charged ? `Your card has been charged ${fmtMoney(m.total, ctx.currency)}.` : m ? (rec.payment?.state === "released" ? `The earlier hold on your card was released, so you pay ${ctx.title} on the day.` : `You pay ${ctx.title} on the day.`) : "", ...note].filter(Boolean),
      rows: bookingRows(rec, ctx),
      lines: guestLines(rec, ctx),
      priceNote: charged ? "Charged to your card." : m ? "Paid to the business on the day." : undefined,
      cta: { label: "View the listing", url: ctx.listingUrl },
      after: ctx.arrival ? [ctx.arrival] : [],
    });
    await sendMail({ to: rec.guest.email, subject: `Confirmed: ${ctx.title}, ${when}`, ...e });
    return;
  }

  if (status === "declined") {
    const e = renderEmail({
      eyebrow: "Not available",
      heading: `${ctx.title} can't take ${fmtDay(rec.date)}`,
      intro: [`Sorry, they cannot take your booking for ${when}.`, opts.released || rec.payment?.state === "released" ? "The hold on your card was released and nothing was charged." : m ? "Nothing was charged." : "", ...note].filter(Boolean),
      rows: bookingRows(rec, ctx, { where: false }),
      cta: { label: "Pick another time", url: ctx.listingUrl },
    });
    await sendMail({ to: rec.guest.email, subject: `Not available: ${ctx.title}, ${when}`, ...e });
    return;
  }

  const e = renderEmail({
    eyebrow: "Cancelled",
    heading: `${ctx.title} cancelled your booking`,
    intro: [`Your booking for ${when} was cancelled by the business.`, opts.refunded && m ? `A refund of ${fmtMoney(m.total, ctx.currency)} is on its way back to your card. It usually shows within 5 to 10 business days.` : opts.released ? "The hold on your card was released and nothing was charged." : m ? "Nothing was charged." : "", ...note].filter(Boolean),
    rows: bookingRows(rec, ctx, { where: false }),
    cta: { label: "Pick another time", url: ctx.listingUrl },
  });
  await sendMail({ to: rec.guest.email, subject: `Cancelled: ${ctx.title}, ${when}`, ...e });
}
