import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";

/**
 * A widget that names an ARIA role is promising a keyboard, and both of ours were promising one they did not
 * have.
 *
 * The guest booking box's service picker said `role="listbox"`. A screen reader hearing that switches out of
 * browse mode and hands every arrow press straight to the page, so Up and Down did nothing at all inside the
 * one control that decides what a guest is buying. Worse for everybody, not only for a screen reader: picking
 * a row unmounted the popup, and the focused row with it, which dropped focus on the body. A guest who had
 * tabbed to the picker was sent back to the top of the page to find the date box. The popup also claimed the
 * filter chips as list options, because the element carrying the role was the whole popup and the chips stick
 * to the top of it as it scrolls.
 *
 * The operator dashboard's Home strip said `role="tablist"` with no name, no arrow keys, and three tabs that
 * controlled nothing: there was no `role="tabpanel"` under them, so nothing tied "Today" to the list it draws.
 *
 * What ships now, and what this test holds: the listbox is the list itself and owns nothing but options; it
 * answers Up, Down, Home and End; it has one tab stop, which is the row already picked or, when a chip filter
 * has hidden that row, the first row still on screen; and every way out of it (Escape, or picking a row) hands
 * focus back to the button that opened it. Every tab strip in the app carries a name, roving tab stops and the
 * same arrow keys the guest home's category bar already had.
 *
 * Driven in a real Chromium against both, at 1280px and 400px, before this was written. The geometry of the
 * popup and of the dashboard feed is unchanged to the pixel: this is semantics and keys, not layout.
 */

const COMPONENTS = new URL("../../components/", import.meta.url);
const LISTING = readFileSync(new URL("../../components/web/WebListing.tsx", import.meta.url), "utf8");
const OPHOME = readFileSync(new URL("../../components/operator/OpHome.tsx", import.meta.url), "utf8");

/** Every .tsx under src/components, path and source. */
function components(): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = [];
  const walk = (dir: URL, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const at = new URL(name, dir);
      if (statSync(at).isDirectory()) walk(new URL(name + "/", dir), prefix + name + "/");
      else if (name.endsWith(".tsx")) out.push({ path: prefix + name, src: readFileSync(at, "utf8") });
    }
  };
  walk(COMPONENTS, "");
  return out;
}

/** The source with its comments gone, so a role named in prose is not read as a role declared on a tag. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

/** The opening tag that carries `role="<role>"`, for each element in the file that declares it. */
function tagsWithRole(src: string, role: string): string[] {
  const flat = code(src).replace(/=>/g, "==");
  const out: string[] = [];
  const re = new RegExp('role="' + role + '"', "g");
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    const start = flat.lastIndexOf("<", m.index);
    const end = flat.indexOf(">", m.index);
    if (start >= 0 && end > start) out.push(flat.slice(start, end + 1));
  }
  return out;
}

test("every tab strip in the app is named, walked by the arrow keys and has one tab stop", () => {
  let strips = 0;
  for (const { path, src } of components()) {
    for (const tag of tagsWithRole(src, "tablist")) {
      strips += 1;
      assert.match(tag, /aria-label(?:ledby)?=/, path + ": a tablist with no name is announced as an unlabelled group of tabs");
      assert.match(tag, /onKeyDown=/, path + ": a tablist has to answer the arrow keys, which is what announcing itself as one promises");
    }
    for (const tag of tagsWithRole(src, "tab")) {
      assert.match(tag, /tabIndex=/, path + ": a tab needs a roving tab stop, so the strip is one stop on the way through the page");
      assert.match(tag, /aria-selected=/, path + ": a tab has to say whether it is the selected one");
    }
  }
  assert.ok(strips >= 2, "expected the dashboard Home strip and the guest category bar at least; found " + strips);
});

test("the arrow keys a tab strip answers are the ones a tab strip is asked", () => {
  for (const { path, src } of components()) {
    if (!/role="tablist"/.test(src)) continue;
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      assert.ok(src.includes('"' + key + '"'), path + ": a tab strip that never names " + key);
    }
  }
});

test("the dashboard Home tabs control a panel that exists and is labelled by the open tab", () => {
  const panel = /<div id="([a-z-]+)" role="tabpanel" aria-labelledby=\{"([a-z-]+)" \+ tab\}/.exec(code(OPHOME));
  assert.ok(panel, "Home's feed needs one panel, named by whichever tab is open");
  const [, panelId, tabPrefix] = panel;
  const tabs = tagsWithRole(OPHOME, "tab");
  assert.equal(tabs.length, 3, "Needs action, Today and Next 7 days");
  for (const tag of tabs) {
    assert.match(tag, new RegExp('aria-controls="' + panelId + '"'), "each tab points at the panel it draws");
    const id = /id="([a-z-]+)"/.exec(tag);
    assert.ok(id, "a tab a panel can name needs an id of its own");
    assert.ok(id![1].startsWith(tabPrefix), "the panel builds its label from " + tabPrefix + ", so tab ids start with it: " + id![1]);
  }
});

test("the booking box's listbox owns options and nothing else", () => {
  assert.doesNotMatch(LISTING, /className="aloptpop"[^>]*role="listbox"/, "the popup also holds the filter chips, which are not options");
  const list = tagsWithRole(LISTING, "listbox");
  assert.equal(list.length, 1, "one listbox in the booking box");
  const id = /id="([a-z-]+)"/.exec(list[0]);
  assert.ok(id, "the button that opens the list has to be able to name it");
  assert.match(LISTING, new RegExp('aria-controls=\\{optOpen \\? "' + id![1] + '"'), "the trigger names the list it opens, while it is open");
  assert.match(list[0], /onKeyDown=/, "a listbox has to answer the arrow keys");
  // The chips are drawn before the listbox opens, so nothing inside it can be one.
  const inside = LISTING.slice(LISTING.indexOf(list[0]));
  assert.ok(!inside.slice(0, inside.indexOf("</div>")).includes("aloptchip"), "no chip inside the list itself");
});

test("the booking box's option rows have one tab stop between them, and it is never nothing", () => {
  const rows = tagsWithRole(LISTING, "option");
  assert.equal(rows.length, 1, "one row component, drawn per option");
  assert.match(rows[0], /tabIndex=\{r\.idx === optTabRow \? 0 : -1\}/, "roving tab stop on the row the guest is on");
  assert.match(rows[0], /aria-selected=\{r\.idx === optionIdx\}/, "the row already picked says so");
  // The fallback is the whole point: a chip filter can hide the picked row, and a list with no tab stop at all
  // cannot be reached by keyboard.
  assert.match(LISTING, /optRows\.some\(\(r\) => r\.idx === optionIdx\) \? optionIdx : optRows\[0\]\?\.idx/, "first row still on screen when the picked one is filtered away");
});

test("closing the service picker hands focus back to the button that opened it", () => {
  assert.match(LISTING, /const closeOpt = \(back: boolean\) => \{[\s\S]*?optBtnRef\.current\?\.focus\(\)/, "closeOpt puts focus back on the trigger");
  const rows = tagsWithRole(LISTING, "option");
  assert.match(rows[0], /closeOpt\(true\)/, "picking a row closes the list and hands focus back, instead of dropping it on the body");
  assert.match(LISTING, /e\.key === "Escape"[\s\S]{0,120}closeOpt\(/, "Escape closes it the same way");
  assert.match(LISTING, /rows\.find\(\(r\) => r\.getAttribute\("aria-selected"\) === "true"\) \|\| rows\[0\]\)\?\.focus\(/, "opening it moves focus onto the row already picked");
});
