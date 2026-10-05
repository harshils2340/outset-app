import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { restart, restartHref } from "../crashRecovery";

/**
 * What a guest meets when a reader throws.
 *
 * Driven in a real Chromium against the dev server with a throw put into the listing page on purpose: with no
 * boundary `#root` held zero elements, which is a blank window with nothing on it to press, and React's own
 * warning in the console was "Consider adding an error boundary to your tree". With the boundary the same
 * throw draws one alert and the button on it lands the guest back on a working home.
 *
 * The component itself cannot be rendered here (the repo has no DOM and `renderToStaticMarkup` does not run
 * an error boundary at all, it rethrows), so the decisions it makes live in `crashRecovery.ts` and are driven
 * directly; the wiring that cannot be is read from source, the way claimLink.test.ts and blankDashboard.test.ts
 * read theirs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string): string => readFileSync(join(here, "..", "..", p), "utf8");

test("the way back drops the hash, because the hash is the screen that faulted", () => {
  assert.equal(restartHref("https://onoutset.com/activities#o=o-skydivecity-com"), "https://onoutset.com/activities");
  // A claim link and an Ask link are hashes too, and both name a screen a fault would come straight back on.
  assert.equal(restartHref("https://onoutset.com/activities#claim=o-x&k=v2.abc.def&o=Sam"), "https://onoutset.com/activities");
  assert.equal(restartHref("http://127.0.0.1:5173/activities#ask=escape%20room%20tonight"), "http://127.0.0.1:5173/activities");
  // A bare marker still leaves the page it was on.
  assert.equal(restartHref("https://onoutset.com/activities#"), "https://onoutset.com/activities");
});

test("a page that carries no hash is left exactly as it is, so the press is an ordinary reload", () => {
  assert.equal(restartHref("https://onoutset.com/activities"), "https://onoutset.com/activities");
  // The query is not the screen: a preview flag or a UTM tag has nothing to do with the fault and is kept.
  assert.equal(restartHref("https://onoutset.com/activities?preview=1"), "https://onoutset.com/activities?preview=1");
  assert.equal(restartHref("https://onoutset.com/activities?preview=1#o=o-x"), "https://onoutset.com/activities?preview=1");
});

test("the URL is changed before the reload, or the reload rebuilds the screen that just broke", () => {
  const calls: string[] = [];
  const win = {
    location: {
      href: "https://onoutset.com/activities#o=o-skydivecity-com",
      reload: () => calls.push("reload " + win.location.href),
    },
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => {
        // What the browser does: the document's URL is this one from here on, with nothing fetched.
        win.location.href = url;
        calls.push("replaceState " + url);
      },
    },
  };
  restart(win);
  assert.deepEqual(calls, [
    "replaceState https://onoutset.com/activities",
    "reload https://onoutset.com/activities",
  ]);
});

test("with no hash to drop, nothing is pushed into history and the page is only reloaded", () => {
  const calls: string[] = [];
  const win = {
    location: { href: "https://onoutset.com/activities", reload: () => calls.push("reload") },
    history: { replaceState: () => calls.push("replaceState") },
  };
  restart(win);
  assert.deepEqual(calls, ["reload"]);
});

test("the whole app is inside the boundary, which is what makes a throw anywhere in render survivable", () => {
  const provider = src("state/AppProvider.tsx");
  // main.tsx puts this provider around the whole app, so its children are every screen there is.
  assert.match(provider, /<ErrorBoundary where="the app">\{children\}<\/ErrorBoundary>/);
  assert.match(provider, /import \{ ErrorBoundary \} from "\.\.\/components\/layout\/ErrorBoundary"/);
});

test("the boundary catches, says so in the console, and offers one named way out", () => {
  const eb = src("components/layout/ErrorBoundary.tsx");
  // Both halves: the state change that swaps the tree out, and the hook that records what happened.
  assert.match(eb, /static getDerivedStateFromError\(\)/);
  assert.match(eb, /componentDidCatch\(/);
  assert.match(eb, /console\.error\(/);
  // Read out as an alert rather than as a quiet paragraph, and reachable as a button.
  assert.match(eb, /role="alert"/);
  assert.match(eb, /<button type="button"/);
  // The one navigation it makes goes through `restart`: assigning `location.href` or `location.replace` to a
  // URL that differs only in its fragment is a same-document navigation and leaves the broken tree up.
  assert.match(eb, /restart\(window\)/);
  assert.equal(/location\.href\s*=/.test(eb), false);
  assert.equal(/location\.replace\(/.test(eb), false);
});
