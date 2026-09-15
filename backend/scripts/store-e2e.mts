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

console.log("\n4. Sign-in by email code knows the listing");
r = await json(`/auth/request-code`, { method: "POST", body: JSON.stringify({ email: OWNER.email }) });
check("code request accepted", r.status === 200 && r.body?.ok === true, r);

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

console.log("\n8. Unsubscribe list lives in the documents table");
const { recordUnsub, localUnsubHashes } = await import("../src/lib/unsub.ts");
await recordUnsub("optout@e2e-store.example");
const hashes = await localUnsubHashes();
check("hash recorded and read back", hashes.has(emailHash("optout@e2e-store.example")));
await query("delete from documents where key = 'mail/unsub.json'");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll store checks passed");
await closePg();
process.exit(failures ? 1 : 0);
