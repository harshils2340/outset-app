/**
 * The published address of a stored image. Shared by the catalog build and by the photo work list, because the
 * photo screen judges images by the address the site publishes, so anything that looks a verdict up has to ask
 * with the same address.
 */

/** Wix lazy-load placeholders are 34px blurred stubs. Ask for the full image instead; tiny variants from other hosts are dropped. */
export function fullSize(u: string): string | undefined {
  if (!u) return undefined;
  const wix = u.match(/^(https?:\/\/static\.wixstatic\.com\/media\/[^/]+?)(?:\/v1\/|$)/);
  if (wix) return wix[1] + "/v1/fill/w_1600,h_1000,al_c,q_85/" + wix[1].split("/media/")[1].replace(/%7E/gi, "~");
  if (/[?&/](w|width)[=_]\d{1,2}\b|[?&/](h|height)[=_]\d{1,2}\b|blur_\d|\/w_1?\d{2},h_\d{2}\b/.test(u)) return undefined;
  return u;
}

/** Verdicts the photo screen records for an image that must not be published. */
export const REJECTED_KIND = /^(?:graphic|map|document|dead)$/;
