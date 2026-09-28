import assert from "node:assert/strict";
import test from "node:test";

import { SESSIONS_PAGE } from "../sessionsPage.ts";

/**
 * `/sessions` is the founder's window over the agent's shoulder, and it builds its rows as HTML in the browser.
 * Two of those strings land inside an attribute, so its own `esc` has to cover quotes as well as `&<>`. Nothing
 * a guest types reaches one of the two today, which is why this is a guard rather than a fix.
 */

test("the page's own escaper covers quotes as well as the angle brackets", () => {
  const line = SESSIONS_PAGE.split("\n").find((l) => l.startsWith("const esc = "));
  assert.ok(line, "the page no longer defines esc on one line; check the escaping by hand");
  const esc = new Function("return " + line.replace(/^const esc = /, "").replace(/;\s*$/, ""))() as (s: unknown) => string;
  assert.equal(esc('a" onload="alert(1)'), "a&quot; onload=&quot;alert(1)");
  assert.equal(esc("a' onload='alert(1)"), "a&#39; onload=&#39;alert(1)");
  assert.equal(esc("<b>&</b>"), "&lt;b&gt;&amp;&lt;/b&gt;");
  assert.equal(esc(null), "");
});

test("every attribute the page builds by hand runs through it", () => {
  // If a new hand-built attribute lands here without esc, the test above stops covering the page.
  const built = [...SESSIONS_PAGE.matchAll(/=\\?"[^"'+]*'\+([a-z]+)\(/g)];
  assert.equal(built.length >= 2, true, "the hand-built attributes moved; check the escaping by hand");
  for (const m of built) assert.equal(m[1], "esc", "an attribute is built from " + m[1] + "() rather than esc()");
});
