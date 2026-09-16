import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Drives the claim, profile, sign-in and booking routes in-process against a scratch Postgres branch, the way the
 * live site does, and checks what lands in the tables. No mail goes out (no mail key), no card is charged, no
 * GitHub write happens (no token). Never point it at production: it deletes and rewrites the o-e2e-* listings.
 *
 *   E2E_DATABASE_URL=postgresql://... npx tsx scripts/store-e2e.mts
 */

if (!process.env.E2E_DATABASE_URL) {
  console.log("E2E_DATABASE_URL is not set; skipping the store e2e (point it at a scratch Neon branch).");
  process.exit(0);
}
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
process.env.CLAIM_SECRET = "e2e-claim-secret";
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-store-e2e-")), "scratch.db");
// The catalog files the routes read. Without this the store is the repository's own public/, which these
// checks have no business reading, and no listing file can be laid down for a check that needs one.
process.env.STORE_DIR = mkdtempSync(join(tmpdir(), "outset-store-e2e-public-"));
delete process.env.GITHUB_TOKEN;
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_SMTP_USER;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.OUTSET_TEST_CLAIM_EMAILS;

const { app } = await import("../src/api/routes.ts");
const { migratePg, query, closePg } = await import("../src/db/pg.ts");
const { claimToken, claimTokenV2 } = await import("../src/lib/claim.ts");
const { emailHash } = await import("../src/api/auth.ts");
await migratePg();
await query("delete from bookings where listing like 'o-e2e-%'");
await query("delete from profiles where id like 'o-e2e-%'");
await query("delete from profile_emails where listing like 'o-e2e-%'");

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log((ok ? "  pass  " : "  FAIL  ") + name + (ok || detail === undefined ? "" : "  -> " + JSON.stringify(detail).slice(0, 300)));
  if (!ok) failures++;
};
const json = async (path: string, init: RequestInit = {}) => {
  const res = await app.request(path, { ...init, headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...(init.headers || {}) } });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

const ID = "o-e2e-store-shop";
const OWNER = { name: "Sam Owner", email: "sam@e2e-store.example", phone: "8135550100" };

console.log("\n1. Claim through the emailed link (a current link is exchanged for a session first)");
let r = await json(`/claims/${ID}/exchange`, { method: "POST", body: JSON.stringify({ token: claimTokenV2(ID) }) });
check("link exchanged for a session", r.status === 200 && typeof r.body?.session === "string", r);
const linkSession = String(r.body?.session);
r = await json(`/claims/${ID}`, { method: "POST", headers: { "x-session": linkSession }, body: JSON.stringify({ owner: OWNER }) });
check("claim recorded and a session handed back", r.status === 200 && typeof r.body?.session === "string", r);
const session = String(r.body?.session);
const row = await query<{ id: string; owner_email: string; published: boolean; claimed_at: string }>("select id, owner_email, published, claimed_at from profiles where id = $1", [ID]);
check("profile row with the owner's email", row[0]?.owner_email === OWNER.email && row[0].published === true, row[0]);
const link = await query<{ listing: string }>("select listing from profile_emails where email_hash = $1", [emailHash(OWNER.email)]);
check("email linked to the listing for sign-in codes", link.length === 1 && link[0].listing === ID, link);

console.log("\n2. A second claim from another address (an older, static link) is recorded, not silently allowed");
r = await json(`/claims/${ID}`, { method: "POST", headers: { "x-claim-token": claimToken(ID) }, body: JSON.stringify({ owner: { ...OWNER, email: "someone-else@e2e-store.example" } }) });
check("answer names the first claimer", r.status === 200 && typeof r.body?.alreadyClaimed === "string", r.body);
const both = await query<{ n: string }>("select count(*)::text as n from profile_emails where listing = $1", [ID]);
check("both addresses can now sign in", both[0].n === "2", both);

console.log("\n3. The dashboard saves edits");
r = await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ profile: { v: 1, instantBook: false }, patch: { title: "E2E Store Shop", options: [{ name: "Tour", detail: "1 hour", price: 50 }] }, published: true, owner: OWNER }) });
check("edit saved", r.status === 200 && r.body?.ok === true, r);
r = await json(`/profiles/${ID}`);
check("guests see only the patch", r.status === 200 && (r.body?.patch as { title?: string })?.title === "E2E Store Shop" && r.body?.owner === undefined, r.body);
r = await json(`/profiles/${ID}`, { headers: { "x-session": session } });
check("the owner sees the whole record", r.status === 200 && (r.body?.owner as { email?: string })?.email === OWNER.email, r.body);
r = await json(`/listing-edits`);
const edits = (r.body?.edits as { id: string; patch: { title?: string }; published: boolean }[] | undefined) || [];
const mine = edits.find((e) => e.id === ID);
check("the nightly sync can read every listing's edits, owners left out", r.status === 200 && mine?.patch.title === "E2E Store Shop" && mine.published === true && !("owner" in (mine as object)), mine);

console.log("\n4. Sign-in by email code knows the listing");
r = await json(`/auth/request-code`, { method: "POST", body: JSON.stringify({ email: OWNER.email }) });
check("code request accepted", r.status === 200 && r.body?.ok === true, r);
for (let i = 1; i <= 6; i++) r = await json(`/auth/verify`, { method: "POST", body: JSON.stringify({ email: OWNER.email, code: "000000" }) });
check("a code typed wrong six times stops being guessable", r.status === 400 && /too many attempts/i.test(String(r.body?.error)), r.body);

console.log("\n4b. A claim link for a second shop keeps the operator signed in to the first");
{
  // An operator with two shops opens the claim link for the second one. Before this the session it handed
  // back was scoped to that shop alone, so the first stayed in the dashboard and every save of it was a 403.
  const SECOND = "o-e2e-store-shop-two";
  await query("delete from profiles where id = $1", [SECOND]);
  await query("delete from profile_emails where listing = $1", [SECOND]);
  r = await json(`/claims/${SECOND}/exchange`, { method: "POST", headers: { "x-session": session }, body: JSON.stringify({ token: claimTokenV2(SECOND) }) });
  const widened = String(r.body?.session);
  check("the second link is exchanged", r.status === 200 && !!widened, r);
  r = await json(`/profiles/${SECOND}`, { method: "PUT", headers: { "x-session": widened }, body: JSON.stringify({ profile: { v: 1 }, patch: { title: "Second Shop" }, published: true, owner: OWNER }) });
  check("the new session edits the second shop", r.status === 200, r);
  r = await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": widened }, body: JSON.stringify({ profile: { v: 1, instantBook: false }, patch: { title: "E2E Store Shop", options: [{ name: "Tour", detail: "1 hour", price: 50 }] }, published: true, owner: OWNER }) });
  check("and still edits the first", r.status === 200, r);
  // Nothing is widened that the caller did not already hold: a session for one shop is not a session for another.
  r = await json(`/profiles/${SECOND}`, { method: "PUT", headers: { "x-session": linkSession }, body: JSON.stringify({ profile: { v: 1 }, patch: {}, published: true }) });
  check("a session for one shop alone still cannot edit another", r.status === 403, r);
  await query("delete from profiles where id = $1", [SECOND]);
  await query("delete from profile_emails where listing = $1", [SECOND]);
}

console.log("\n5. A guest books (no card step)");
r = await json(`/bookings`, { method: "POST", body: JSON.stringify({ listing: ID, code: "E2E-S001", date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), slot: "11:00", qty: 2, service: "Tour", variant: "1 hour", addons: [], total: 100, guest: { name: "Guest One", phone: "4165550100", email: "guest@e2e-store.example" }, pay: false }) });
check("booking taken as a request", r.status === 200 && r.body?.status === "new", r);
r = await json(`/bookings`, { method: "POST", body: JSON.stringify({ listing: ID, code: "E2E-S001", date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), slot: "11:00", qty: 2, service: "Tour", variant: "1 hour", addons: [], total: 100, guest: { name: "Guest One", phone: "4165550100", email: "" }, pay: false }) });
check("same code again is refused", r.status === 409, r);
r = await json(`/bookings`, { method: "POST", body: JSON.stringify({ listing: ID, code: "E2E-S003", date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), slot: "11:00", qty: 1, service: "Tour", variant: "1 hour", addons: [], total: 50, guest: { name: "Guest Three", phone: "4165550102", email: "" }, pay: false }) });
check("a second party at the same time is refused", r.status === 409 && r.body?.code === "slot_taken", r);
r = await json(`/bookings/${ID}`, { headers: { "x-session": session } });
check("the dashboard lists it", r.status === 200 && Array.isArray(r.body?.bookings) && (r.body!.bookings as unknown[]).length === 1, r.body);
r = await json(`/bookings/${ID}`);
check("nobody else can list it", r.status === 403);

console.log("\n6. The operator decides");
r = await json(`/bookings/${ID}/E2E-S001`, { method: "PATCH", headers: { "x-session": session }, body: JSON.stringify({ status: "accepted", note: "See you at 11" }) });
check("accepted", r.status === 200 && (r.body?.booking as { status?: string })?.status === "accepted", r.body);
const b = await query<{ status: string; doc: { note?: string; decidedAt?: string } }>("select status, doc from bookings where code = $1", ["E2E-S001"]);
check("row status, note and decision time stored", b[0]?.status === "accepted" && b[0].doc.note === "See you at 11" && !!b[0].doc.decidedAt, b[0]);
r = await json(`/bookings/${ID}/NOPE`, { method: "PATCH", headers: { "x-session": session }, body: JSON.stringify({ status: "declined" }) });
check("unknown code is 404", r.status === 404);

console.log("\n7. Unpublished shop stops taking bookings");
await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: false }) });
r = await json(`/bookings`, { method: "POST", body: JSON.stringify({ listing: ID, code: "E2E-S002", date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), slot: "13:00", qty: 1, service: "Tour", variant: "1 hour", addons: [], total: 50, guest: { name: "Guest Two", phone: "4165550101", email: "" }, pay: false }) });
check("hidden listing refuses with 409", r.status === 409, r);

console.log("\n8. Bad input is answered, never crashed on");
{
  // `null` is valid JSON, so c.req.json() resolved to it and every route that read a field off the body
  // answered 500 to what is only a bad request.
  const nullBody = [
    ["POST", "/auth/request-code"],
    ["POST", "/auth/verify"],
    ["POST", `/claims/${ID}/request`],
    ["POST", `/claims/${ID}/exchange`],
    ["POST", `/claims/${ID}/test-enter`],
    ["PUT", `/profiles/${ID}`],
    ["PUT", `/payouts/${ID}/schedule`],
    ["PATCH", `/bookings/${ID}/E2E-S001`],
  ] as const;
  const codes: string[] = [];
  for (const [method, path] of nullBody) {
    const res = await json(path, { method, headers: { "x-session": session }, body: "null" });
    codes.push(`${path} ${res.status}`);
  }
  check("a body of null is a 4xx on every route that reads one", codes.every((s) => !/ 5\d\d$/.test(s)), codes);

  // `String(v)` throws on an object whose `toString` is not callable, and `{"toString": 1}` is ordinary JSON
  // that anyone can post. Every route that read a field that way answered 500: the claim request, the link
  // exchange, both sign-in routes, the profile write and the booking route.
  const hostile = { toString: 1 };
  const bodies: [string, string, unknown][] = [
    ["POST", "/auth/request-code", { email: hostile }],
    ["POST", "/auth/verify", { email: hostile, code: hostile }],
    ["POST", `/claims/${ID}/request`, { email: "a@x.com", name: hostile, phone: hostile }],
    ["POST", `/claims/${ID}/exchange`, { token: hostile }],
    ["POST", `/claims/${ID}/test-enter`, { email: hostile }],
    ["POST", `/claims/${ID}/test-unclaim`, { email: hostile }],
    ["PUT", `/profiles/${ID}`, { profile: { v: 1 }, patch: {}, owner: { name: hostile, email: hostile, phone: hostile } }],
    ["POST", "/bookings", { listing: hostile, code: hostile, date: hostile, slot: hostile, guest: { name: hostile } }],
  ];
  const odd: string[] = [];
  for (const [method, path, body] of bodies) {
    const res = await json(path, { method, headers: { "x-session": session }, body: JSON.stringify(body) });
    odd.push(`${path} ${res.status}`);
  }
  check("a field that cannot be turned into a string is a 4xx, not a 500", odd.every((s) => !/ 5\d\d$/.test(s)), odd);

  // An array is an object, so a patch of [1,2,3] was stored whole and then served to every guest who opened
  // the listing and to the nightly sync, which spread it over the catalog record as keys "0", "1" and "2".
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, patch: { title: "E2E Store Shop" } }) });
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, patch: [1, 2, 3] }) });
  r = await json(`/profiles/${ID}`);
  check("a patch that is an array is not stored over the operator's own", (r.body?.patch as { title?: string })?.title === "E2E Store Shop", r.body?.patch);

  // A booking code is checked in the path the same way POST /bookings checks it. A code carrying a NUL byte
  // reached Postgres and came back as `invalid byte sequence for encoding "UTF8"`: a 500 for a bad link.
  r = await json(`/bookings/${ID}/${encodeURIComponent("\0")}`, { method: "PATCH", headers: { "x-session": session }, body: JSON.stringify({ status: "accepted" }) });
  check("a booking code with a NUL byte is 404, not 500", r.status === 404, r);
  r = await json(`/bookings/paid/${ID}/${encodeURIComponent("\0")}`);
  check("the same code on the paid route is 404, not 500", r.status === 404, r);

  // The dashboard record is stored as the operator's device sent it, so the guest routes must survive any
  // shape in it. `services: "none"` took this listing's whole booking path down with a 500.
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, profile: { services: "none", blockedDates: 7, blockedSlots: "x", hours: "open" } }) });
  r = await json(`/bookings/open/${ID}?days=2`);
  check("a profile whose fields are not arrays still answers open slots", r.status === 200 && Array.isArray(r.body?.days), r);
  r = await json(`/bookings`, { method: "POST", body: JSON.stringify({ listing: ID, code: "E2E-S900", date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), slot: "09:00", qty: 1, service: "Tour", variant: "1 hour", addons: [], total: 50, guest: { name: "Guest Nine", phone: "4165550109", email: "" }, pay: false }) });
  check("and still answers a booking for it", r.status < 500, r);
}

console.log("\n9. A time with room left says how much, and the picker offers it to a party that fits");
{
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const shop = {
    hours: Array.from({ length: 7 }, () => ({ closed: false, open: "07:00", close: "19:00" })),
    slotMinutes: 60, leadHours: 2, windowDays: 60, blockedDates: [], blockedSlots: [],
    services: [{ name: "Tour", live: true, capacity: 4 }],
  };
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, profile: shop }) });
  const bookAt = (code: string, qty: number, total: number, slot = "09:00") =>
    json(`/bookings`, { method: "POST", body: JSON.stringify({ listing: ID, code, date: day, slot, qty, service: "Tour", variant: "1 hour", addons: [], total, guest: { name: "Party " + code, phone: "4165550110", email: "" }, pay: false }) });
  r = await bookAt("E2E-S910", 3, 150);
  check("three of four seats are taken", r.status === 200, r);
  const slotsFor = async (guests: number) => {
    const res = await json(`/bookings/open/${ID}?from=${day}&days=1&service=Tour&guests=${guests}`);
    return ((res.body?.days as { date: string; slots: string[] }[]) || [])[0]?.slots || [];
  };
  check("the time is still offered to one more guest", (await slotsFor(1)).includes("09:00"));
  // The picker used to offer it to everyone, so a couple picked it, were refused, reloaded and saw it again.
  check("and is not offered to a party of two", !(await slotsFor(2)).includes("09:00"));
  r = await bookAt("E2E-S911", 2, 100);
  check("a party of two is refused and told what is left", r.status === 409 && /only 1 spot left/i.test(String(r.body?.error)), r.body);
  r = await bookAt("E2E-S912", 9, 450, "15:00");
  check("a party of nine at an empty time is told the size that time holds", r.status === 409 && /holds 4 guests/i.test(String(r.body?.error)), r.body);
  r = await bookAt("E2E-S913", 1, 50);
  check("the last seat still books", r.status === 200, r);
  r = await bookAt("E2E-S914", 1, 50);
  check("and then the time is gone", r.status === 409 && /just booked/i.test(String(r.body?.error)), r.body);
  check("gone from the picker too", !(await slotsFor(1)).includes("09:00"));
}

console.log("\n10. A service the shop's menu does not price has no price");
{
  const day = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, patch: { title: "E2E Store Shop", options: [{ name: "Tour", detail: "1 hour", price: 50 }] }, profile: { hours: Array.from({ length: 7 }, () => ({ closed: false, open: "07:00", close: "19:00" })), slotMinutes: 60, leadHours: 2, services: [{ name: "Tour", live: true, capacity: 4 }] } }) });
  // The browser's number used to stand whenever the menu could not price the booking, so an invented service
  // reached the operator as "You receive $4,726.25" for something they do not sell.
  r = await json(`/bookings`, { method: "POST", body: JSON.stringify({ listing: ID, code: "E2E-S920", date: day, slot: "09:00", qty: 1, service: "Helicopter transfer", variant: "", addons: [], total: 5000, guest: { name: "Guest Ten", phone: "4165550111", email: "" }, pay: false }) });
  check("a service the menu does not sell is taken", r.status === 200, r);
  let doc = await query<{ doc: { total: number | null } }>("select doc from bookings where code = $1", ["E2E-S920"]);
  check("and stored with no price, not the browser's $5,000", doc[0]?.doc.total === null, doc[0]?.doc);
  r = await json(`/bookings`, { method: "POST", body: JSON.stringify({ listing: ID, code: "E2E-S921", date: day, slot: "11:00", qty: 2, service: "Tour", variant: "1 hour", addons: [], total: 1, guest: { name: "Guest Eleven", phone: "4165550112", email: "" }, pay: false }) });
  check("a service the menu does price is taken", r.status === 200, r);
  doc = await query<{ doc: { total: number | null; pricing?: { subtotal: number; fee: number } } }>("select doc from bookings where code = $1", ["E2E-S921"]);
  check("and priced from the menu, not the browser's $1", doc[0]?.doc.total === 105 && doc[0]?.doc.pricing?.subtotal === 100, doc[0]?.doc);
}

console.log("\n10b. A shop that took its whole menu down is not priced from the scraped file");
{
  const { mkdirSync, writeFileSync } = await import("node:fs");
  // The listing file the crawl left behind, which is what a guest saw before anyone claimed the business.
  mkdirSync(join(process.env.STORE_DIR!, "o"), { recursive: true });
  writeFileSync(join(process.env.STORE_DIR!, "o", `${ID}.json`), JSON.stringify({ title: "E2E Store Shop", area: "Tampa, FL", options: [{ name: "Tour", detail: "1 hour", price: 50 }], addons: [{ name: "Wetsuit", price: 30 }] }));
  const day = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const shop = { hours: Array.from({ length: 7 }, () => ({ closed: false, open: "07:00", close: "19:00" })), slotMinutes: 60, leadHours: 2, services: [{ name: "Tour", live: true, capacity: 4 }] };
  const book = (code: string, body: Record<string, unknown>) =>
    json(`/bookings`, { method: "POST", body: JSON.stringify({ listing: ID, code, date: day, slot: "09:00", qty: 1, addons: [], guest: { name: "Guest " + code, phone: "4165550113", email: "" }, ...body }) });
  const stored = async (code: string) => (await query<{ doc: { total: number | null } }>("select doc from bookings where code = $1", [code]))[0]?.doc;

  // With no patch at all there is nothing of the operator's to read, so the scraped file is all there is.
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, profile: shop }) });
  r = await book("E2E-S930", { service: "Tour", variant: "1 hour", total: 1 });
  check("with no menu of their own, the scraped file prices the booking", r.status === 200 && (await stored("E2E-S930"))?.total === 53, await stored("E2E-S930"));

  // The operator hid or deleted every service: the guest page offers nothing, and neither does the price.
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, patch: { title: "E2E Store Shop", options: [], addons: [] }, profile: shop }) });
  r = await book("E2E-S931", { service: "Tour", variant: "1 hour", total: 53, slot: "10:00" });
  check("an empty menu prices nothing, rather than falling back to the scraped file", r.status === 200 && (await stored("E2E-S931"))?.total === null, await stored("E2E-S931"));
  r = await book("E2E-S932", { service: "", variant: "", total: 53, slot: "11:00" });
  check("and a booking with no service named is not charged the one scraped price either", r.status === 200 && (await stored("E2E-S932"))?.total === null, await stored("E2E-S932"));

  // An add-on the operator removed is not charged for, even though the scraped file still lists it.
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, patch: { title: "E2E Store Shop", options: [{ name: "Tour", detail: "1 hour", price: 50 }], addons: [] }, profile: shop }) });
  r = await book("E2E-S933", { service: "Tour", variant: "1 hour", addons: ["Wetsuit"], total: 84, slot: "12:00" });
  check("an add-on taken off the menu is not added to the bill", r.status === 200 && (await stored("E2E-S933"))?.total === 53, await stored("E2E-S933"));

  // The patch is stored as the device sends it, so a menu can be any shape at all. A string has a length, so
  // it passed the "is there a menu" test and priceBooking then called .filter on it: every booking for that
  // shop answered 500. A malformed menu costs the shop its prices, not its bookings.
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, patch: { title: "E2E Store Shop", options: "oops" }, profile: shop }) });
  r = await book("E2E-S934", { service: "Tour", variant: "1 hour", total: 53, slot: "13:00" });
  check("a menu that is not an array still takes the booking, with no price", r.status === 200 && (await stored("E2E-S934"))?.total === null, r);
  await json(`/profiles/${ID}`, { method: "PUT", headers: { "x-session": session }, body: JSON.stringify({ published: true, patch: { title: "E2E Store Shop", options: [{ name: "Tour", detail: "1 hour", price: 50 }], addons: "oops" }, profile: shop }) });
  r = await book("E2E-S935", { service: "Tour", variant: "1 hour", addons: ["Wetsuit"], total: 84, slot: "14:00" });
  check("add-ons that are not an array price the experience alone", r.status === 200 && (await stored("E2E-S935"))?.total === 53, r);
}

console.log("\n11. Unsubscribe list lives in the documents table");
const { recordUnsub, localUnsubHashes } = await import("../src/lib/unsub.ts");
await recordUnsub("optout@e2e-store.example");
const hashes = await localUnsubHashes();
check("hash recorded and read back", hashes.has(emailHash("optout@e2e-store.example")));
await query("delete from documents where key = 'mail/unsub.json'");

/**
 * Releasing a listing has to outlive the browser that pressed the button. Settings' "Release this listing"
 * only cleared localStorage, so the profile row and the email link stayed: every guest kept being served the
 * operator's patch, the nightly sync kept baking it into the rails, and the owner signing back in got the
 * whole profile returned to them. Nothing the button promised actually happened.
 */
console.log("\n12. Releasing a listing clears it on the server, not only on the device");
{
  const before = await query<{ n: string }>("select count(*)::text as n from profile_emails where listing = $1", [ID]);
  check("the listing is claimed and linked to at least one email to start with", Number(before[0]?.n || 0) > 0, before);

  r = await json(`/profiles/${ID}`, { method: "DELETE" });
  check("a stranger cannot release someone's listing", r.status === 403, r);
  const still = await query<{ id: string }>("select id from profiles where id = $1", [ID]);
  check("and the profile is untouched by the attempt", still.length === 1, still);

  r = await json(`/profiles/${ID}`, { method: "DELETE", headers: { "x-session": session } });
  check("the owner's session releases it", r.status === 200 && r.body?.removed === true, r);

  const gone = await query<{ id: string }>("select id from profiles where id = $1", [ID]);
  check("the profile row is gone", gone.length === 0, gone);
  const unlinked = await query<{ n: string }>("select count(*)::text as n from profile_emails where listing = $1", [ID]);
  check("no email can sign in to it any more, so it does not come back on the next sign-in", unlinked[0]?.n === "0", unlinked);

  r = await json(`/profiles/${ID}`);
  check("a guest opening the listing gets no patch, so the crawled record is what they see", r.status === 404, r);

  const edits = ((await json("/listing-edits")).body?.edits as { id: string }[] | undefined) || [];
  check("the nightly sync no longer carries the released listing's edits", !edits.some((e) => e.id === ID), edits.length);

  // The guests who already booked still hold their codes, and the shop is still expected to turn up.
  const kept = await query<{ code: string }>("select code from bookings where listing = $1", [ID]);
  check("bookings already taken are left alone", kept.length > 0, kept.length);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll store checks passed");
await closePg();
process.exit(failures ? 1 : 0);
