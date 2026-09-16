# Rendering and email security review, 16 September 2026

Scope: what the site renders and what the emails carry. Two other sessions covered the
crawler's trust rules and the API, keys, and workflows.

## Checked

- `src/components/Markup.tsx` and its roughly 90 call sites across `src/components/`: every
  call passes a hardcoded icon string from `src/data/icons.ts`, `opContext.tsx`'s `OD_ICONS`,
  or an inline literal SVG constant defined in the component itself. None pass crawled,
  operator, or guest text, a catalog field, or a review, booking note, or chat message.
- `src/components/art/Art.tsx`: `sceneInner(kind, id)` in `src/data/art.ts` looks `kind` up as
  an object key into a hardcoded scene table (never interpolated into the markup) and falls
  back to a generic scene when the key is not found; `id` is stripped to `[a-z0-9]` before it
  is used as a gradient id. Not exploitable through either argument.
- `src/components/web/WebListing.tsx`'s one direct `.innerHTML` use, in `decodeText`, is an
  HTML-entity decode through a detached `<textarea>` after all tags are stripped from the
  input; safe by construction.
- Full-repo grep for `dangerouslySetInnerHTML` and `.innerHTML`: exactly the three files above.
- Every URL sink the site writes into: `src`/`href`/iframe `src`/`window.location`, across
  `src/components/art/Photo.tsx`, `src/lib/images.ts`, `src/lib/media.ts`,
  `src/lib/catalog.ts` (`siteUrl`, `telHref`, `mapsHref`, `mapsDirHref`), the hash deep links
  and `checkoutUrl` handling in `src/state/AppProvider.tsx`, the Stripe Connect redirect in
  `src/components/operator/OpMore.tsx`, and the test-bypass link in
  `src/components/operator/OpLogin.tsx`. Verified against a real headless Chromium (the
  pre-installed Playwright browser, not just read off a spec) that a `javascript:` href
  executes on click, and that an unsandboxed `data:text/html` iframe executes its script and
  can call `top.location`, but that neither an `onload` attribute nor an embedded `<script>`
  in a `data:image/svg+xml` used as an `<img src>` runs, because SVG loaded through `<img>` is
  restricted to image context regardless of URL scheme; that result shaped which fixes below
  were priority fixes versus policy-compliance hardening.
- `telHref`, `mapsHref`, `mapsDirHref` in `catalog.ts`: already safe by construction (digits
  only into `tel:`, `encodeURIComponent` into a fixed `google.com/maps` host). No change.
- All 10 `target="_blank"` links already carry `rel="noreferrer"`, which browsers treat the
  same as `noopener` for `window.opener` isolation. No change.
- `src/lib/admin.ts`'s `adminWebsite` (the founder-only "open the real site" link) already
  parses with `URL`, validates the hostname shape, and rebuilds the link from that hostname:
  the pattern the other fixes below now follow. No change.
- `src/state/AppProvider.tsx`'s hash deep links (`#o=`, `#remove=`, `#paid=`, `#claim=&k=`):
  every capture group is regex-anchored to `[a-z0-9-]+` or similar and used only as a lookup
  key into `experienceById`/`loadListing`, never rendered or navigated to directly. Not
  exploitable. `src/lib/api.ts`'s `ownerFromHash` (the `&o=<base64url owner>` payload) is
  wrapped in try/catch, length-capped, and email-regex-checked before use; not itself an XSS
  vector, but see Needs Harshil below.

## Found and fixed

- `ef544c197` Markup.tsx and Art.tsx had no guardrail of their own: every current call site is
  safe, but nothing stopped a future call site from passing a catalog, operator, or guest
  field straight into `dangerouslySetInnerHTML`, which would be stored XSS on every page that
  renders it, the same class of bug that put gambling spam into listing text. Added
  `src/lib/sanitizeSvg.ts`, a strict allowlist over SVG shape tags and attributes (no event
  handlers, no `javascript:`/`data:` URLs, no `style` beyond a bare numeric declaration such as
  `stroke-width:2.2`), and wired it into both sinks. Added
  `src/lib/__tests__/sanitizeSvg.test.ts` with `<img onerror>`, `<script>`, a `javascript:`
  link, an SVG-wrapped script, a `foreignObject` script, and an HTML comment, and confirmed all
  90 existing icon and scene strings still render unchanged through the sanitizer.
- `db73a9ebe` `item.videoEmbed` (a crawled or operator field) rendered straight into an
  `<iframe>` with no host allowlist and no `sandbox` attribute, in both
  `src/components/web/WebListing.tsx` (the hero and the gallery lightbox) and
  `src/components/booking/Sheets.tsx`. Confirmed in a real browser that an unsandboxed
  `data:text/html` iframe with no allowlist executes its own script and can call
  `top.location`, meaning a single hostile embed URL (a hacked operator site, or a bad crawl)
  could redirect a guest off Outset entirely from a listing page. Added
  `isSafeEmbedUrl`/`EMBED_HOSTS` to `src/lib/media.ts`, restricting `videoEmbed` to
  YouTube/YouTube-nocookie/Vimeo's player host before `listingMedia` will surface it at all,
  and added `sandbox="allow-scripts allow-same-origin allow-presentation"` plus a stricter
  `referrerPolicy` to every embed `<iframe>`.
- `db73a9ebe` The "Get tickets" link (`contact?.website || item.src`) and the waiver link
  (`item.waiverUrl`) in `WebListing.tsx` and `Sheets.tsx` put a crawled or operator URL
  straight into an `href` with no scheme check. Confirmed in a real browser that a
  `javascript:` href runs the instant a guest clicks it. Both now go through the new
  `safeHttpUrl`, which renders nothing rather than a dangerous link.
- `db73a9ebe` Photo and video covers fell back to the operator's raw URL unchecked whenever the
  wsrv.nl proxy was skipped or had not been tried yet (`src/components/art/Photo.tsx`'s clip
  and fallback branches, and the gallery lightbox's own `<img>`/`<video>` in `WebListing.tsx`),
  and `images.ts`'s `thumb`/`srcSet` explicitly let a `data:` URL straight through as "already
  small enough" before handing anything else to the wsrv.nl proxy. Confirmed in a real browser
  that neither an `onload` attribute nor an embedded `<script>` on a `data:image/svg+xml` used
  as an `<img src>` executes, so this was not a live XSS path, but it is still not an http(s)
  URL to a public host, which the review's own policy requires regardless. All four now run
  through `isPublicHttpUrl`/`safeHttpUrl`, and `thumb`/`srcSet` return `undefined` (the scene
  illustration shows instead) for anything that is not.
- `db73a9ebe` `window.location.assign(r.checkoutUrl)` in `AppProvider.tsx` and the Stripe
  Connect redirect (`window.location.assign(r.url)`) in `OpMore.tsx` navigated the whole tab to
  whatever URL the API response carried, with no check. A `javascript:` value there would run
  immediately on assignment, not on a click, confirmed the same way as the href case above.
  Both now require `isHttpsUrlOnHost` against `checkout.stripe.com` and `connect.stripe.com`
  respectively before navigating; otherwise the app shows its own error instead of leaving the
  page.
- `db73a9ebe` `catalog.ts`'s `siteUrl` prepended `"https://"` to whatever the crawler found in
  `src`, so a leading `"//"` (`"//evil.com"`) silently became `"https:////evil.com"`, which a
  browser normalizes to a real, working link to `evil.com` labeled as the operator's own
  website. Now refused outright (returns `""`) rather than resolved, and the result is
  additionally checked with `isPublicHttpUrl` before use.
- `db73a9ebe` The test-bypass claim link in `OpLogin.tsx`'s `openBypassLink` (dev/testing only,
  requires `OUTSET_TEST_CLAIM_EMAILS` set on the API host) assigned `window.location.href`
  directly from the API's response with no check. Now requires `isPublicHttpUrl` first.
  Added `src/lib/__tests__/urlSafety.test.ts` covering all of the above.
- `bc209cdcc` `WebListing.tsx` and `Sheets.tsx` each read `localStorage["outset.guest"]` into a
  guest object and called `guest.name.trim()` right after, with no check on what `JSON.parse`
  actually returned. A stored `name`/`phone` that was not a string crashed the listing page or
  the booking sheet on mount. `storage.ts`'s `loadBookings`/`loadChats` only checked "is this an
  array" or "is this an object", not the shape of what was inside, so a booking with `qty` or
  `total` not a number, or a chat message with no valid role, still reached the trips list and
  the confirmation screen. `api.ts`'s `loadApiSession` cast its parsed JSON straight to
  `ApiSession`; a session whose `ids` was not a string array crashed `forgetClaim`'s
  `ids.filter()`. `prefs.ts`'s wishlist/day/party-size reads were a bare cast with no array or
  type check, so a corrupted `outset.saved` value crashed `toggleSaved`'s
  `.includes()`/`.filter()` on the next heart tap. All four now validate shape field by field
  before use, dropping only the row or field that does not fit rather than crashing the screen.
  Added `src/lib/__tests__/storageShape.test.ts` (a minimal in-memory `localStorage`, since Node
  has none, exercising the corrupted and wrong-shaped cases directly).
- `src/lib/operator.ts`'s `normalizeProfile` already did this well before this review: every
  field from a stored `OperatorProfile` is type-checked and defaulted (`str`/`num`/`bool`/
  `strList`/`objList` helpers), which is the pattern the fixes above now follow. No change.
- `src/components/operator/OpPreview.tsx`'s preview-panel prefs (`open`/`device`/`width`)
  already check `typeof` and compare against exact literals before use, so a stale value falls
  back cleanly with no crash. No change.

## Found, not fixed

(updated as the review continues)

## Needs Harshil

(updated as the review continues)
