/**
 * The site is static, so its Content-Security-Policy lives in a meta tag in `index.html` and there is no server
 * to send a header instead. That tag named the production API host outright, which means a build pointed at any
 * other API could not reach it at all: Chromium refuses the fetch before it leaves the page, `fetch` rejects
 * with a `TypeError`, and every call in `src/lib/api.ts` degrades quietly the way it does with no API, so
 * nothing on screen says why. The dev server, a preview build and the nightly rehearsal are all in that case.
 *
 * So the origin a build was actually pointed at goes into `connect-src` beside the production one. This is a
 * build-time string edit and nothing imports it from the app, so it never reaches the bundle.
 */

/**
 * The origin of an API URL, or "" when there is no usable one. Only http(s) belongs in a CSP source list, and a
 * source is scheme and host only, never a path. Read by hand rather than with `URL`, because this module is
 * compiled by the app project and by the Vite config's own project, and only one of those has the DOM globals.
 */
export function apiOrigin(apiUrl: string | undefined): string {
  const m = /^(https?:)\/\/([a-z0-9.-]+(?::\d+)?)(?:[/?#]|$)/i.exec((apiUrl || "").trim());
  return m ? m[1].toLowerCase() + "//" + m[2].toLowerCase() : "";
}

/**
 * The policy meta tag and its `content`, so nothing else on the page can be mistaken for it: the comment above
 * the tag names these directives too, and a plain search for "connect-src" finds that first.
 */
const META = /(<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*?content=(["']))([\s\S]*?)\2/i;

/**
 * Adds `origin` to the `connect-src` of the CSP meta tag in `html`. A policy that already names it, an origin
 * that does not parse, and a page with no policy are all left exactly as they were.
 */
export function withApiOrigin(html: string, apiUrl: string | undefined): string {
  const origin = apiOrigin(apiUrl);
  if (!origin) return html;
  // The policy is written with single-quoted sources ('self') inside a double-quoted attribute, so the closing
  // quote is the one the attribute opened with and nothing else.
  return html.replace(META, (whole, open: string, quote: string, policy: string) => {
    const next = policy.replace(/connect-src ([^;]+)/, (directive, list: string) => {
      const sources = list.trim().split(/\s+/);
      return sources.includes(origin) ? directive : `connect-src ${sources.join(" ")} ${origin}`;
    });
    // `quote` closes the attribute again: the match ran up to it, so leaving it off wrote an unterminated
    // attribute and the whole page stopped parsing.
    return next === policy ? whole : open + next + quote;
  });
}

/**
 * Opens the connection to the API while the page is still parsing, so the first call does not pay for DNS, TCP
 * and TLS before it sends a byte.
 *
 * The call that matters is `/where`, which is how the home knows what city to open on. It is a header read on
 * the API's side and answers in milliseconds, but on a cold connection the handshake in front of it is three
 * round trips to Oregon, and the guest is looking at the page for all of them.
 *
 * `crossorigin` is required, not decoration: a preconnect without it warms the credentialled pool, and every
 * fetch in `src/lib/api.ts` is a plain cross-origin one with the default `credentials: "same-origin"`, so it is
 * anonymous and would open a second connection anyway. The production origin is already in `index.html`
 * alongside the one in `connect-src`; this is for a build pointed somewhere else, which is the same case
 * `withApiOrigin` exists for.
 */
export function withApiPreconnect(html: string, apiUrl: string | undefined): string {
  const origin = apiOrigin(apiUrl);
  if (!origin || html.includes(`rel="preconnect" href="${origin}"`)) return html;
  // Indented one step in from the closing tag, so the only difference between the page in the repository and
  // the page a build emits is the one line. A page with no head is left exactly as it is.
  return html.replace(/([ \t]*)<\/head>/, (close, pad: string) => `${pad}  <link rel="preconnect" href="${origin}" crossorigin />\n${close}`);
}
