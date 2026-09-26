import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeSvg } from "../sanitizeSvg";
import { ICONS } from "../../data/icons";
import { OD_ICONS } from "../../components/operator/opContext";
import { sceneInner } from "../../data/art";

/**
 * Markup.tsx and Art.tsx render this output through dangerouslySetInnerHTML. Every real call
 * site today passes a static icon or scene string, but the sink has no guardrail of its own,
 * so this tests the guardrail directly: hostile markup in, nothing executable out.
 */

test("an onerror image tag cannot survive", () => {
  const out = sanitizeSvg('<img src=x onerror=alert(1)>after');
  assert.ok(!/onerror/i.test(out));
  assert.ok(!/<img/i.test(out));
  assert.equal(out, "after");
});

test("a script tag is removed with its body, inside or outside an svg wrapper", () => {
  assert.equal(sanitizeSvg('<script>alert(1)</script>'), "");
  assert.equal(sanitizeSvg('<svg><script>alert(document.cookie)</script><circle r="1"/></svg>'), '<svg><circle r="1" /></svg>');
});

test("a javascript: link is dropped, tag and all, leaving only its text", () => {
  const out = sanitizeSvg('<a href="javascript:alert(1)">click</a>');
  assert.ok(!/javascript:/i.test(out));
  assert.ok(!/<a[\s>]/i.test(out));
  assert.equal(out, "click");
});

test("an SVG script payload cannot survive", () => {
  const out = sanitizeSvg('<svg><g><script type="text/javascript">fetch("//evil")</script></g></svg>');
  assert.ok(!/script/i.test(out));
  assert.ok(!/evil/i.test(out));
});

test("an HTML comment is dropped rather than passed through", () => {
  const out = sanitizeSvg('<svg><!-- <script>alert(1)</script> --><circle r="1"/></svg>');
  assert.ok(!/<!--/.test(out));
  assert.ok(!/script/i.test(out));
});

test("an event handler attribute is stripped even on an allowed tag", () => {
  const out = sanitizeSvg('<svg onload="alert(1)"><path d="M0 0" onclick="alert(2)"/></svg>');
  assert.ok(!/onload/i.test(out));
  assert.ok(!/onclick/i.test(out));
  assert.ok(!/alert/i.test(out));
});

test("a data: href on an image element does not survive", () => {
  const out = sanitizeSvg('<svg><image href="data:text/html,<script>alert(1)</script>"/></svg>');
  assert.ok(!/data:/i.test(out));
  assert.ok(!/<image/i.test(out));
});

test("a style attribute can only carry a bare numeric declaration", () => {
  const safe = sanitizeSvg('<path d="M0 0" style="stroke-width:2.2"/>');
  assert.ok(safe.includes('style="stroke-width:2.2"'));
  const unsafe = sanitizeSvg('<path d="M0 0" style="background:url(javascript:alert(1))"/>');
  assert.ok(!unsafe.includes("style="));
  assert.ok(!/javascript:/i.test(unsafe));
});

test("a foreignObject cannot smuggle a script into an otherwise plain svg", () => {
  const out = sanitizeSvg('<svg><foreignObject><script>alert(1)</script></foreignObject><rect width="1" height="1"/></svg>');
  assert.ok(!/script/i.test(out));
  assert.ok(!/foreignobject/i.test(out));
  assert.equal(out, '<svg><rect width="1" height="1" /></svg>');
});

test("plain shape markup with allowed attributes passes through unchanged in substance", () => {
  const src = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13 9.5 17.5 19 7"/></svg>';
  const out = sanitizeSvg(src);
  assert.ok(out.includes('viewBox="0 0 24 24"') || out.includes('viewbox="0 0 24 24"'));
  assert.ok(out.includes('d="M5 13 9.5 17.5 19 7"'));
});

function everyIcon() {
  return [...Object.values(ICONS), ...Object.values(OD_ICONS)];
}

test("every static icon survives sanitizing byte-identical apart from casing", () => {
  for (const raw of everyIcon()) {
    const out = sanitizeSvg(raw);
    assert.ok(out.length > 0, raw);
    assert.ok(!/on[a-z]+\s*=/i.test(out.replace(raw, "")), "sanitizer must not invent handlers");
  }
});

test("every scene the catalog can pick keeps its shapes and its gradient id", () => {
  // Tag/attribute names come back lowercased (linearGradient -> lineargradient). The HTML
  // parser's own SVG foreign-content table restores the camelCase on the way into the DOM,
  // so this checks shape survives rather than exact bytes.
  const kinds = ["skydive", "heli", "jetski", "kart", "paintball", "escape", "generic", "unknown-kind"];
  for (const kind of kinds) {
    const raw = sceneInner(kind, "abc-123");
    const out = sanitizeSvg(raw);
    const tagsIn = raw.match(/<[a-zA-Z][\w:-]*/g)?.length ?? 0;
    const tagsOut = out.match(/<[a-zA-Z][\w:-]*/g)?.length ?? 0;
    assert.equal(tagsOut, tagsIn, kind);
    assert.ok(out.includes('id="gabc123"'), kind);
    assert.ok(out.includes("fill=\"url(#gabc123)\""), kind);
  }
});

/**
 * The sanitizer writes every value back inside double quotes, whichever quote it arrived in. A value that
 * carries a double quote of its own therefore closed the attribute early, and what followed was read by the
 * browser as further attributes: the allowlist and the `on*` check had both already run, on a string that was
 * no longer a value by the time it reached the DOM.
 */
test("a single-quoted value cannot smuggle a handler out of its own quotes", () => {
  const out = sanitizeSvg(`<svg><path d='M0 0" onload="alert(1)'/></svg>`);
  assert.ok(!out.includes('onload="'), out);
  assert.ok(out.includes("&quot;"), "the quote is kept as text, not as the end of the attribute");
});

test("a single-quoted value cannot smuggle a style out of its own quotes", () => {
  const out = sanitizeSvg(`<svg><rect id='a" style="position:fixed;top:0;width:100vw;height:100vh'/></svg>`);
  assert.ok(!out.includes('style="'), out);
});

test("a value cannot close its own tag", () => {
  const out = sanitizeSvg(`<svg><rect width='1><script>alert(1)</script'/></svg>`);
  assert.ok(!/<script/i.test(out), out);
});

test("escaping leaves every shipped icon and scene exactly as it was", () => {
  const kinds = ["skydive", "heli", "jetski", "kart", "paintball", "escape", "generic"];
  for (const raw of [...everyIcon(), ...kinds.map((k) => sceneInner(k, "abc-123"))]) {
    const out = sanitizeSvg(raw);
    assert.ok(!/&quot;|&lt;|&gt;/.test(out), "no static art carries a quote or a bracket in a value: " + raw.slice(0, 60));
  }
});
