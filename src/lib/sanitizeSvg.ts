/**
 * Markup.tsx and Art.tsx put a string straight into the DOM through dangerouslySetInnerHTML.
 * Every call site today passes a hardcoded icon or scene string from src/data, never crawled,
 * operator, or guest text, but the sink itself has no guardrail: one future call site that
 * passes a catalog field instead of a static icon would be stored XSS. This strips anything
 * that is not a plain SVG shape to an allowlist, so the sink cannot run code even if that
 * happens: no script, no style block, no event handler attribute, no javascript:/data: URL.
 */

const ALLOWED_TAGS = new Set([
  "svg", "defs", "g", "lineargradient", "radialgradient", "stop", "rect", "circle", "ellipse",
  "path", "line", "polygon", "polyline", "text", "tspan", "use", "clippath", "mask", "title",
]);

// script/style bodies, and anything that can embed a foreign document, must be dropped with
// their content; every other disallowed tag can just have its own markup removed.
const STRIP_WITH_CONTENT = new Set(["script", "style", "foreignobject", "iframe", "object", "noscript", "template"]);

const ALLOWED_ATTRS = new Set([
  "width", "height", "viewbox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "points",
  "offset", "stop-color", "opacity", "id", "class", "aria-hidden", "role", "preserveaspectratio",
  "transform", "clip-path", "gradienttransform", "gradientunits", "fill-rule", "xmlns",
]);

// The one style use in the icon set today is a static "stroke-width:2.2" override. Allow that
// narrow shape only: numbers and units, never a url(), a string, or an expression.
const SAFE_STYLE_VALUE = /^(?:[a-z-]+\s*:\s*-?[\d.]+(?:px|%)?\s*;?\s*)+$/i;

const UNSAFE_URL_PREFIX = /^\s*(javascript|data|vbscript):/i;

const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
const ATTR_RE = /([a-zA-Z_:][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function sanitizeSvg(html: string): string {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "");

  let out = "";
  let stripTag: string | null = null;
  let stripDepth = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(source))) {
    const [full, closing, rawName, rawAttrs] = m;
    const name = rawName.toLowerCase();
    const selfClosed = /\/\s*$/.test(rawAttrs);
    const between = source.slice(last, m.index);
    last = m.index + full.length;

    if (stripTag) {
      if (name === stripTag) {
        if (closing) { if (stripDepth === 0) stripTag = null; else stripDepth--; }
        else if (!selfClosed) stripDepth++;
      }
      continue;
    }

    out += between;

    if (!ALLOWED_TAGS.has(name)) {
      if (!closing && !selfClosed && STRIP_WITH_CONTENT.has(name)) { stripTag = name; stripDepth = 0; }
      continue;
    }

    if (closing) { out += `</${name}>`; continue; }

    let attrsOut = "";
    ATTR_RE.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = ATTR_RE.exec(rawAttrs))) {
      const attrName = am[1].toLowerCase();
      const value = am[3] !== undefined ? am[3] : am[4] ?? "";
      if (attrName.startsWith("on")) continue;
      if (attrName === "style") {
        if (SAFE_STYLE_VALUE.test(value.trim())) attrsOut += ` style="${value}"`;
        continue;
      }
      if (!ALLOWED_ATTRS.has(attrName)) continue;
      if (UNSAFE_URL_PREFIX.test(value.trim())) continue;
      attrsOut += ` ${attrName}="${value}"`;
    }
    out += `<${name}${attrsOut}${selfClosed ? " /" : ""}>`;
  }
  if (!stripTag) out += source.slice(last);
  return out;
}
