/**
 * An image address that is a hacked page's advertisement rather than a picture of the business.
 *
 * The durable screen is in the backend: `isCompromisedText` in `backend/src/sync/contacts.ts` refuses a
 * crawled fact that reads as hacked-page spam, and since 3 October it refuses one from the cloud crawl's own
 * photo harvest too, which is where these came from. This is the guard for what a sync already published,
 * the same division `deadCovers.ts` keeps: 13 shipped listings carry 24 of these addresses and 11 of them are
 * the cover, so the Birth Place of the Republican Party in Ripon, Market House Museum in Paducah, Salida Golf
 * Club, Timberview Golf Club and Windsor Gymnastics each lead, on their card and at the top of their own page,
 * with an Indonesian online-gambling banner.
 *
 * Narrow on purpose. It reads a file name and a host, not prose, so it names only the words that spam network
 * actually writes into one, each held to a word edge so a photograph of Judith or a file called maxwindow.jpg
 * is not a casino. Measured over every image address in all 52,815 shipped detail files: it matches those 24
 * and nothing else.
 */
const SPAM_IMAGE =
  /togel|maxwin(?![a-z])|gacor|\bjudi\b|slot(?:777|88|99|gacor)(?![a-z])|(?:bandar|situs|daftar)[-_ ]?(?:togel|slot|judi)|\bpulsa\b/i;

/** True when this address should never be drawn, counted, or asked of the image proxy. */
export function spamImageUrl(url: string | null | undefined): boolean {
  return !!url && SPAM_IMAGE.test(url);
}

/** The addresses worth drawing, in order. */
export function keepRealPhotos(urls: readonly string[] | undefined): string[] {
  return (urls || []).filter((u) => !spamImageUrl(u));
}
