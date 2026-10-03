import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * "Every way it can fail ends at the same place: the plain route" is what this module says about its stream,
 * and one way did not: a socket that opened and then went quiet. Neither `fetch` nor `reader.read()` has a
 * deadline, so the read stayed pending for the rest of the session. The working card span, the trace stopped
 * where it was, the guest's only way out was Stop, and the plain route was never tried at all.
 *
 * Read from the source because `stream` is private to the module and `API_URL` is empty outside a Vite build,
 * so neither can be driven from here. What is checked is the shape the fix depends on: one controller both the
 * guest's Stop and the deadline can reach, a deadline that restarts on every chunk rather than capping the
 * whole answer, and an idle abort that reads as a failure to fall back from and not as the guest stopping.
 */

const SRC = readFileSync(new URL("../concierge.ts", import.meta.url), "utf8");
const STREAM = SRC.slice(SRC.indexOf("async function stream("), SRC.indexOf("async function plain("));

test("the stream has an idle deadline, and it is shorter than nothing", () => {
  const ms = Number(/STREAM_IDLE_MS = (\d+)/.exec(SRC)?.[1]);
  assert.ok(Number.isFinite(ms) && ms > 0, "an idle deadline in milliseconds");
  // Long enough that a slow shop is never mistaken for a wedge: the server polls its own step queue every 60 ms.
  assert.ok(ms >= 20000, `${ms} ms of silence is too little to call a wedge`);
});

test("the request is made on a controller the deadline can reach", () => {
  assert.match(STREAM, /signal: ctl\.signal,/, "not opts.signal, which only the guest's Stop touches");
  assert.match(STREAM, /opts\.signal\?\.addEventListener\("abort", bail\)/, "the guest's Stop still reaches it");
  assert.match(STREAM, /setTimeout\(bail, STREAM_IDLE_MS\)/);
});

test("the deadline restarts on every chunk, so a long answer is never cut off", () => {
  const loop = STREAM.slice(STREAM.indexOf("for (;;)"));
  const read = loop.indexOf("await reader.read()");
  const beat = loop.indexOf("heard()");
  assert.ok(read >= 0 && beat > read, "every chunk read pushes the deadline out again");
  assert.match(STREAM, /const heard = \(\) => \{[\s\S]*?clearTimeout\(idle\);[\s\S]*?setTimeout\(bail, STREAM_IDLE_MS\)/);
});

test("a deadline that fires falls back to the plain route; the guest's Stop does not", () => {
  const caught = STREAM.slice(STREAM.indexOf("} catch (e)"));
  const guestStop = caught.indexOf("opts.signal?.aborted");
  const fallBack = caught.indexOf("return null");
  assert.ok(guestStop >= 0 && fallBack > guestStop, "the guest's own abort is answered first and nothing else is");
  // `askConcierge` is what turns that null into the plain route, and it must not read our abort as a stop.
  const ask = SRC.slice(SRC.indexOf("export async function askConcierge"), SRC.indexOf("async function stream("));
  assert.match(ask, /if \(opts\.signal\?\.aborted\) return \{ ok: false, error: "" \};/);
  assert.match(ask, /return plain\(body, opts\.signal\);/);
});

test("the timer and the listener are let go whichever way the stream ends", () => {
  const fin = STREAM.slice(STREAM.indexOf("} finally {"));
  assert.match(fin, /clearTimeout\(idle\)/);
  assert.match(fin, /removeEventListener\("abort", bail\)/);
});
