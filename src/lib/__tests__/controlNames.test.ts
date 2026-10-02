import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * A dashboard control says what it acts on, and a disabled one says why it is off.
 *
 * Driven in a real Chromium at 1280px and read through Chrome's own accessible-name computation, seven of the
 * nine dashboard pages handed an operator a row of identically named buttons: eleven "Move up", eleven "Move
 * down", eleven "Remove" and six "Add" across the five line editors and the gallery on Listing; three
 * "Accept" and three "Decline" on Home and on Bookings; two "Live" and a nameless "Remove option" on
 * Services. Each one is a different line, photo, guest or price, and nothing in the name said which. Several
 * were also disabled with no explanation, which reads as a broken control rather than a step not taken yet.
 *
 * The page already did this properly where somebody had thought about it: every drag handle reads "Reorder
 * Sunset cruise, position 2 of 4", and a price box reads "Price for 1 hour". This is the same rule everywhere
 * else. Source checks, because the app's suite runs without a browser.
 */

const read = (f: string) => readFileSync(new URL("../../components/operator/" + f, import.meta.url), "utf8");

test("the five line editors name their own list and line", () => {
  const src = read("OpListing.tsx");
  const list = src.slice(src.indexOf("function LineList"), src.indexOf("function FaqList"));
  assert.ok(list.length > 0, "LineList has moved; this check is reading nothing");
  for (const want of [
    /aria-label=\{"Move " \+ label \+ " line " \+ \(i \+ 1\) \+ " up"\}/,
    /aria-label=\{"Move " \+ label \+ " line " \+ \(i \+ 1\) \+ " down"\}/,
    /aria-label=\{"Remove " \+ label \+ " line " \+ \(i \+ 1\)\}/,
    /aria-label=\{"Edit " \+ label \+ " line " \+ \(i \+ 1\)\}/,
    /aria-label=\{"Add to " \+ label\}/,
  ]) assert.match(list, want);
  assert.doesNotMatch(list, /aria-label="Move up"|aria-label="Move down"|aria-label="Remove"/, "a bare label is back");
  // Every one of the five lists passes the heading it sits under, or `label` names nothing.
  const labels = src.match(/^\s+label="[^"]+"$/gm) || [];
  assert.equal(labels.length, 5, "a line editor is drawn without the list name its controls read");
});

test("the gallery names the photo each control belongs to", () => {
  const src = read("OpListing.tsx");
  for (const want of [
    /aria-label=\{"Move photo " \+ \(i \+ 1\) \+ " earlier"\}/,
    /aria-label=\{"Move photo " \+ \(i \+ 1\) \+ " later"\}/,
    /aria-label=\{"Remove photo " \+ \(i \+ 1\)\}/,
    /aria-label=\{"Make photo " \+ \(i \+ 1\) \+ " the cover"\}/,
  ]) assert.match(src, want);
  // A photo that will not load cannot be a cover, and the button now says so instead of just going grey.
  assert.match(src, /title=\{broken\.has\(src\) \? "This photo will not load/);
});

test("Accept and Decline name the guest they answer", () => {
  const src = read("OpBookings.tsx");
  const row = src.slice(src.indexOf("export function BookingRow"), src.indexOf("export function OpBookings"));
  assert.match(row, /aria-label=\{"Decline " \+ b\.guest \+/);
  assert.match(row, /aria-label=\{"Accept " \+ b\.guest \+/);
});

test("a price option's own row names it, and the last one says why it cannot go", () => {
  const src = read("OpServices.tsx");
  // The reason reaches the name a reader gets, not only the tooltip a pointer gets.
  assert.match(src, /aria-label=\{"Remove " \+ \(v\.label \|\| "this option"\) \+ \(canRemove \? "" : " \(a service keeps at least one price option\)"\)\}/);
  assert.match(src, /title=\{canRemove \? undefined : "A service keeps at least one price option\./);
  assert.match(src, /aria-label=\{"Name of option " \+ pos\}/);
  assert.doesNotMatch(src, /aria-label="Remove option"|aria-label="Option name"/);
  // The live switch and the open/close chevron name their service rather than repeating per row.
  assert.match(src, /aria-label=\{\(s\.live \? "Hide " : "Show "\) \+ \(s\.name\.trim\(\) \|\| "this service"\)/);
  assert.match(src, /aria-label=\{\(open \? "Close " : "Edit "\) \+ \(s\.name\.trim\(\) \|\| "this service"\)\}/);
});

test("the dashboard's remaining disabled buttons each carry a reason", () => {
  assert.match(read("OpHours.tsx"), /title=\{newOff \? "Add this day off" : "Pick a date first"\}/);
  assert.match(read("OpAssistant.tsx"), /title=\{text\.trim\(\) \? "Send this question" : "Type a question first"\}/);
  const listing = read("OpListing.tsx");
  assert.match(listing, /title=\{!hasApi\(\) \? "Uploading needs the Outset API/);
  assert.match(listing, /title=\{p\.photos\.length >= PHOTOS_MAX \? "Your gallery is full/);
});
