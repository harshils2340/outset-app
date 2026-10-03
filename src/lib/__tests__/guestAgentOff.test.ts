import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { GUEST_AGENT } from "../flags";
import { AGENT_MODE_LIVE } from "../concierge";
import { OTTO_LIVE, ottoActive, ottoCanPay } from "../wallet";
import { inboxThreads } from "../../components/inbox/InboxView";

/**
 * Every agent surface a guest can see is switched off, behind one switch, and the code behind it stays.
 *
 * Asked for on 3 October 2026, about a listing page whose "Questions before you book?" block offered "Ask
 * Outset about The Tall Ship Kajama" and "Call the business": take it off, and hide every agent surface with it.
 * `GUEST_AGENT` in `lib/flags.ts` is that switch. This holds it off, holds each way in behind it, and holds
 * what a guest keeps when it is off: the shop's own number as tap-to-call, and the owner's "Manage this
 * listing" line, which is the claim funnel and not the agent.
 *
 * The repo has no renderer, so as in `askWiring.test.ts` the wiring is read off the files that do it. Each
 * guarded string is also required to still be there: the switch hides the agent, it does not delete it.
 */

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const FLAGS = src("../flags.ts");
const CONCIERGE = src("../concierge.ts");
const WALLET = src("../wallet.ts");
const APP = src("../../App.tsx");
const PROVIDER = src("../../state/AppProvider.tsx");
const HOME = src("../../components/web/WebHome.tsx");
const LISTING = src("../../components/web/WebListing.tsx");
const CONFIRM_WEB = src("../../components/web/WebConfirm.tsx");
const EXPLORE = src("../../components/explore/ExploreView.tsx");
const SHEETS = src("../../components/booking/Sheets.tsx");
const CONFIRM_PHONE = src("../../components/booking/ConfirmView.tsx");
const DETAIL = src("../../components/listing/DetailView.tsx");
const INBOX = src("../../components/inbox/InboxView.tsx");

/** Where each `guard ? (` begins its true arm and where the bracket that closes it sits. */
function arms(text: string, guard: string): [number, number][] {
  const open = guard + " ? (";
  const out: [number, number][] = [];
  for (let at = text.indexOf(open); at > -1; at = text.indexOf(open, at + open.length)) {
    let depth = 0;
    for (let i = at + open.length - 1; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) {
        out.push([at, i]);
        break;
      }
    }
  }
  return out;
}

function hits(text: string, needle: string): number[] {
  const out: number[] = [];
  for (let at = text.indexOf(needle); at > -1; at = text.indexOf(needle, at + needle.length)) out.push(at);
  return out;
}

/** Every place `needle` is written sits inside the true arm of `guard`, and there is at least one. */
function behind(text: string, file: string, guard: string, needle: string): void {
  const spans = arms(text, guard);
  const at = hits(text, needle);
  assert.ok(at.length > 0, `${file} no longer has ${needle}: the code behind the switch stays, or this reads the wrong thing`);
  for (const i of at) assert.ok(spans.some(([a, b]) => i > a && i < b), `${file}: ${needle} renders outside ${guard}`);
}

/** `needle` is written, and none of it sits inside a true arm of either agent guard. */
function inTheOpen(text: string, file: string, needle: string): void {
  const spans = [...arms(text, "GUEST_AGENT"), ...arms(text, "AGENT_MODE_LIVE")];
  const at = hits(text, needle);
  assert.ok(at.length > 0, `${file} no longer has ${needle}`);
  for (const i of at) assert.ok(!spans.some(([a, b]) => i > a && i < b), `${file}: ${needle} went behind the agent switch with the agent`);
}

test("the switch is off, and the two older agent flags answer to it", () => {
  assert.equal(GUEST_AGENT, false);
  assert.match(FLAGS, /export const GUEST_AGENT: boolean = false;/);
  assert.equal(AGENT_MODE_LIVE, false);
  assert.equal(OTTO_LIVE, false);
  // Node has no `import.meta.env`, so both would read false here whatever they said. The definitions are what
  // turn them off in a dev build, where the founder looks at the site.
  assert.match(CONCIERGE, /export const AGENT_MODE_LIVE = GUEST_AGENT && /);
  assert.match(WALLET, /export const OTTO_LIVE = GUEST_AGENT && /);
});

test("Ask Outset cannot open, from a control or from a #ask link, and nothing draws it", () => {
  assert.match(PROVIDER, /openAsk: \(seed\) => \{ if \(AGENT_MODE_LIVE\) dispatch\(\{ type: "openAsk"/);
  // A link opened cold: the boot reads #ask only behind the switch, and otherwise lands on the page under it.
  assert.match(PROVIDER, /const ask = AGENT_MODE_LIVE \? window\.location\.hash\.match\(\/\^#ask/);
  // A link arriving warm goes through openAsk, above. Whatever the state says, neither tree draws the agent.
  assert.match(APP, /const askOnSite = AGENT_MODE_LIVE && /);
  assert.match(APP, /\{AGENT_MODE_LIVE && asking != null \? <WebConcierge /);
  assert.match(APP, /asking=\{AGENT_MODE_LIVE && asking != null\}/);
  // Anything left calling it would close the guest's sheet and drop them into the phone frame for nothing.
  const toggle = APP.slice(APP.indexOf("const toggleAsk"), APP.indexOf("const askOnSite"));
  const stop = toggle.indexOf("if (!AGENT_MODE_LIVE) return;");
  assert.ok(stop > -1 && stop < toggle.indexOf("closeSheet()"), "toggleAsk moves the guest before checking the switch");
});

test("no control offers Ask Outset: the desktop header, the phone search row, the phone listing", () => {
  assert.match(HOME, /const modeSwitch = !AGENT_MODE_LIVE \? null : \(\s*<div className="ah-modes"/);
  behind(EXPLORE, "ExploreView.tsx", "AGENT_MODE_LIVE", 'className={"airask"');
  behind(SHEETS, "Sheets.tsx", "AGENT_MODE_LIVE", "Ask Outset instead");
  behind(SHEETS, "Sheets.tsx", "AGENT_MODE_LIVE", "<b>Ask Outset</b>");
  behind(SHEETS, "Sheets.tsx", "AGENT_MODE_LIVE", "Message Outset");
  behind(SHEETS, "Sheets.tsx", "AGENT_MODE_LIVE", '{callOpen ? "Choose who to call"');
});

test("the desktop listing drops the whole questions block and keeps the owner's line and the number", () => {
  for (const needle of ["<h3>Questions before you book?</h3>", "Ask Outset about {item.title}", "answers these themselves", ">Call the business</a>"]) {
    behind(LISTING, "WebListing.tsx", "GUEST_AGENT", needle);
  }
  // The owner's line is the claim funnel, so it renders with the switch off. It always skipped a partner's
  // product, where there is nothing for an owner to manage.
  inTheOpen(LISTING, "WebListing.tsx", "Manage this listing</button>");
  // The shop's number stays, as the tap-to-call row under "Where you'll be" that every listing already had.
  const where = LISTING.slice(LISTING.indexOf('id="al-location"'), LISTING.indexOf('id="al-business"'));
  assert.match(where, /<a className="alwhererow" href=\{callHref\}>/);
  assert.doesNotMatch(where, /GUEST_AGENT|AGENT_MODE_LIVE/, "the location section's number went behind the switch");
});

test("the phone listing's number rings the shop on the first tap", () => {
  // The picker it used to open chose between Ask Outset and a person. Off, only the person is left, so the
  // number is a plain tel: link rather than a picker with one thing in it.
  const row = SHEETS.slice(SHEETS.indexOf("{callHref && contact?.phone ? ("), SHEETS.indexOf("{AGENT_MODE_LIVE && callOpen && callHref ? ("));
  assert.ok(row.length > 0, "the phone row moved; read it again");
  assert.match(row, /\) : \(\s*<a className="crow" href=\{callHref\}/);
  assert.match(row, /<small>Tap to call<\/small>/);
});

test("operator chat stays closed: nothing opens it, the Inbox lists none of it, nothing promises it", () => {
  assert.match(PROVIDER, /openChat: \(id\) => \{ if \(GUEST_AGENT\) dispatch\(\{ type: "openChat", id \}\); \}/);
  // A guest who chatted before the switch keeps the thread on the device; the tab neither lists nor counts it.
  const stored = { "o-anything": [{ who: "them", t: "Hi, this is the shop's assistant.", at: "now" }] };
  assert.deepEqual(inboxThreads(stored, true), { rows: [], loading: false, total: 0 });
  assert.deepEqual(inboxThreads(stored, false), { rows: [], loading: false, total: 0 });
  // The empty Inbox no longer tells a guest to message the operator there.
  assert.match(INBOX, /GUEST_AGENT \? "Book a trip, then message the operator here\." : "Your bookings and check-in codes are under Trips\."/);
  // Nor do the instant-book screens offer it.
  behind(DETAIL, "DetailView.tsx", "GUEST_AGENT", "openChat(");
  behind(DETAIL, "DetailView.tsx", "GUEST_AGENT", "Agent replies in seconds");
  behind(CONFIRM_PHONE, "ConfirmView.tsx", "GUEST_AGENT", "Message operator");
  // And a thread nobody can see is not worth a call to the grounded model.
  assert.match(PROVIDER, /if \(!GUEST_AGENT\) return;\n\s*for \(const \[id, msgs\] of Object\.entries\(state\.chats\)\)/);
});

test("Otto does not pay from a saved card, and the confirmation stops pointing at Otto", () => {
  const wallet = { ready: true, brand: "visa", last4: "4242", maxDollars: 250, otto: true };
  assert.equal(ottoCanPay(wallet, 120), true, "the rule itself still says this wallet could pay");
  assert.equal(ottoActive(wallet, 120), false, "but nothing acts on it");
  assert.match(CONFIRM_WEB, /GUEST_AGENT \? "Questions\? Otto on the listing answers from the operator's own info\." : null/);
});
