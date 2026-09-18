/**
 * The number a guest taps to call the shop.
 *
 * A listing's phone is whatever the crawl read off the operator's own page: a `tel:` link, a schema.org
 * `telephone` field, or a run of digits in the body text. Plenty of sites publish something that is not one
 * number. The scrape's normaliser kept anything it could not read verbatim, so the shipped catalog carries 258
 * of them: 170 listings publish two or three numbers in one field ("+1-304-725-6399; +1-703-309-2130"), 36
 * carry a `tel:` link still percent-encoded ("(928)%20649-8463"), 46 end in an extension ("+1-360-393-4106x102",
 * "(713) 752-0314 ext. 301"), and the rest are not a number at all: an unrendered template placeholder
 * ("//{{bizInfo.contact.phoneLocal}}"), half a number ("+1 ("), twelve digits with no shape ("269204655747"),
 * and a winery whose published number is the gambling helpline, "1-800-GAMBLER".
 *
 * Every one of those reached a guest twice. The listing page printed it under "Call a person at the shop", and
 * the link under it was built by stripping everything but digits and a plus, so the extension was dialled onto
 * the end of the number, `%20` became the digits 2 and 0, and two numbers became one twenty-two digit one. The
 * guest rings a stranger, or nobody.
 *
 * So there is one reader, here, and both sides use it: the app to decide whether to offer a call at all, and
 * the backend to decide what to store and what to publish. It reads the first number in the field, drops an
 * extension rather than dialling it, and answers null when what the site published cannot be rung.
 */

/** Zero width and byte order marks, which a number copied out of a page carries. */
const INVISIBLE = /[​-‏⁠﻿]/g;

/**
 * The first run that could be a number: it starts on a digit or a plus and ends on a digit, so "ext. 301",
 * "x102" and a label in brackets after the number all fall outside it.
 */
const RUN = /\+?\d[\d\s(). -]{5,24}\d/;

/** A CMS that writes an overflowed integer where the phone should be. It reads as a valid area code otherwise. */
const INT_MAX = "2147483647";

/** What follows the number when a shop publishes a desk to ask for. Printed, never dialled onto the end. */
const EXTENSION = /^[\s.,-]*(?:ext|extension|x|poste|#)\.?\s*(\d{1,6})\s*$/i;

/** True for ten digits that a North American exchange could actually route: no area code or prefix starting 0 or 1. */
function isNanp(n: string): boolean {
  return n.length === 10 && !/^[01]/.test(n) && !/^[01]/.test(n.slice(3)) && n !== INT_MAX;
}

type Read = {
  /** E.164 for North America, the published country code otherwise. */
  dial: string;
  /** The published text of the number itself, with any label after it gone. */
  text: string;
  /** The desk to ask for once the call connects, when the shop named one. */
  ext: string;
};

/** The first number in the field, or null when there is none. */
function readPhone(raw: string | null | undefined): Read | null {
  if (!raw) return null;
  let s = String(raw).replace(INVISIBLE, " ");
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s).replace(INVISIBLE, " ");
    } catch {
      /* a stray percent is not an escape; read the text as it stands */
    }
  }
  // Two numbers in one field: the first is the one the site leads with.
  const head = s.split(/[;\n]/)[0];
  const run = RUN.exec(head);
  if (!run) return null;
  const text = run[0].trim();
  const ext = EXTENSION.exec(head.slice(run.index + run[0].length));
  const digits = text.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const found = (dial: string): Read => ({ dial, text, ext: ext ? ext[1] : "" });
  if (isNanp(national)) return found("+1" + national);
  // A country code the operator published themselves. Anything else is a number we cannot place, and guessing
  // +1 in front of it is how a guest ends up ringing a stranger. Letters are left unread on purpose: a keypad
  // could spell "(603) 257-BOAT" out, and it would spell "1-800-GAMBLER" out too, as a winery's own number.
  if (text.startsWith("+") && !digits.startsWith("1") && digits.length >= 8 && digits.length <= 15) return found("+" + digits);
  return null;
}

/**
 * The number as a guest's phone should dial it, or null when the field holds no number.
 * North American numbers come back as E.164 ("+18135550100"); a number published with its own country code
 * keeps it.
 */
export function dialPhone(raw: string | null | undefined): string | null {
  return readPhone(raw)?.dial ?? null;
}

function printed(read: Read): string {
  const n = read.dial.startsWith("+1") && read.dial.length === 12 ? read.dial.slice(2) : "";
  const shown = n ? "(" + n.slice(0, 3) + ") " + n.slice(3, 6) + "-" + n.slice(6) : read.text;
  return read.ext ? shown + " ext. " + read.ext : shown;
}

/** The number as a page should print it, or the text as published when it is not a number we can read. */
export function displayPhone(raw: string): string {
  const read = readPhone(raw);
  return read ? printed(read) : raw;
}

/** How to print the shop's number when there is one to call, and null when there is not. */
export function callablePhone(raw: string | null | undefined): string | null {
  const read = readPhone(raw);
  return read ? printed(read) : null;
}
