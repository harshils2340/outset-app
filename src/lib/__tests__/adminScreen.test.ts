import assert from "node:assert/strict";
import test from "node:test";

import { adminScreen, type MetricsResult } from "../adminApi";

/**
 * Which screen /admin draws, which decides whether the one person the page is for can get into it.
 *
 * The page called this browser signed in whenever a session was in storage with an address on it, and the
 * operator dashboard saves one: POST /claims/:id hands back a session carrying whatever address was typed into
 * the claim form. So a browser that has claimed a shop looked signed in here, the route refused it, and the page
 * drew a bare "Not found" with nothing to press and no way back to the sign-in box.
 */

const notFound: MetricsResult = { ok: false, notFound: true };
const broken: MetricsResult = { ok: false, notFound: false, error: "The API answered 500." };
const fine = { ok: true, data: {} as never } as MetricsResult;

test("no session at all is the sign-in box", () => {
  assert.equal(adminScreen({ signedIn: false, tried: false, res: null }), "signin");
  assert.equal(adminScreen({ signedIn: false, tried: false, res: notFound }), "signin");
});

test("a session the route refuses, before any sign-in, offers the sign-in box", () => {
  assert.equal(adminScreen({ signedIn: true, tried: false, res: notFound }), "signin");
});

test("a session the route refuses after a sign-in is the real answer", () => {
  assert.equal(adminScreen({ signedIn: true, tried: true, res: notFound }), "notfound");
});

test("an admin session draws the page, and so does one still loading", () => {
  assert.equal(adminScreen({ signedIn: true, tried: false, res: null }), "page");
  assert.equal(adminScreen({ signedIn: true, tried: true, res: fine }), "page");
});

test("an API that failed for any other reason is not a closed door", () => {
  // The page has its own error banner for this; sending it to the sign-in box would hide a 500 behind a form.
  assert.equal(adminScreen({ signedIn: true, tried: false, res: broken }), "page");
  assert.equal(adminScreen({ signedIn: true, tried: true, res: broken }), "page");
});
