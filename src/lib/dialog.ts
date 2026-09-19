/**
 * A modal dialog's focus ring, written as arithmetic so it can be read off a list rather than off a live page.
 *
 * Every dialog on the desktop site says `aria-modal="true"`, which is a promise that the page behind it is not
 * there: a keyboard has nowhere to go but the dialog and the way out of it. None of them kept it. One Tab out
 * of the listing's "Show more" landed on a link under the scrim that the guest could not see, and Tab out of
 * the photo lightbox walked the whole booking box.
 */

/** Everything inside a dialog a Tab can land on, in tab order. */
export const DIALOG_STOPS =
  'button:not([disabled]), iframe, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Which stop a Tab should move to, given how many the dialog has and which one holds focus. `here` is -1 when
 * focus has left the dialog, which is how it starts on a dialog that has just opened behind an autofocus.
 * null means the browser's own next stop is already inside, so leave it alone and keep the native order.
 */
export function tabWrap(count: number, here: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (here < 0) return shift ? count - 1 : 0;
  if (!shift && here >= count - 1) return 0;
  if (shift && here === 0) return count - 1;
  return null;
}
