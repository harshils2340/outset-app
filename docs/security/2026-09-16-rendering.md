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

## Found, not fixed

(updated as the review continues)

## Needs Harshil

(updated as the review continues)
