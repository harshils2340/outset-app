/**
 * The one seam nothing else tests: Stripe Connect onboarding, the "Set up payouts with Stripe" button.
 *
 * Every other test writes a stand-in account record (`acct_e2e_local`) straight into the profile and skips the
 * real call, so `POST /payouts/:id/connect` has never actually run against Stripe. This script makes exactly the
 * calls `backend/src/api/payouts.ts` makes, with the same parameters, so a green run means that button works and
 * the platform's Connect settings are right.
 *
 * It needs nothing but a Stripe TEST secret key. No database, no API, no site, no browser:
 *
 *   cd backend && STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/connect-e2e.mts
 *
 * It refuses to start on a live key. Everything it creates is a test-mode Express account, which it deletes
 * again at the end, so nothing is left behind on the platform.
 *
 * What it cannot do: fill in Stripe's hosted identity and bank form. That is a person clicking through
 * Stripe's own pages once. This script proves the account is created and the onboarding link opens, which is
 * everything on our side of that hand-off.
 */

const KEY = (process.env.STRIPE_TEST_SECRET_KEY || "").trim();
const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");
/** A listing id that looks like ours but belongs to nothing, so no real shop is touched. */
const LISTING = "o-connect-e2e-not-a-real-shop";

if (!KEY) {
  console.log("STRIPE_TEST_SECRET_KEY is not set. Get it from the Stripe Dashboard with Test mode switched on");
  console.log("(Developers, then API keys, the secret key starting sk_test_), then:");
  console.log("  cd backend && STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/connect-e2e.mts");
  process.exit(0);
}
for (const [name, v] of [["STRIPE_TEST_SECRET_KEY", KEY], ["STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY || ""]] as [string, string][]) {
  if (v.startsWith("sk_live")) {
    console.error(`\nRefusing to start: ${name} is a LIVE Stripe key. This script creates and deletes accounts; it must only ever run in test mode.\n`);
    process.exit(2);
  }
}
if (!KEY.startsWith("sk_test")) {
  console.error("\nRefusing to start: STRIPE_TEST_SECRET_KEY must start with sk_test_.\n");
  process.exit(2);
}

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, note: unknown = ""): void {
  const text = typeof note === "string" ? note : JSON.stringify(note);
  console.log((ok ? "  pass  " : "  FAIL  ") + label + (text ? "  -> " + text.slice(0, 220) : ""));
  ok ? passed++ : failed++;
}

function form(obj: Record<string, string | number | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
    .join("&");
}

/** Same shape as the helper in src/api/payouts.ts, so this exercises the real request. */
async function stripe<T>(path: string, body?: Record<string, string | number | undefined>, method?: "GET" | "POST" | "DELETE"): Promise<{ ok: boolean; status: number; data: T; error?: string }> {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { authorization: "Bearer " + KEY, "content-type": "application/x-www-form-urlencoded" },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  return { ok: res.ok, status: res.status, data, error: data.error?.message };
}

console.log("\nStripe Connect onboarding, in test mode only. Nothing real is touched.\n");

/* ---------------------------------------------------------------- 1. is Connect on at all? ---------------- */

console.log("1. The platform account");
const me = await stripe<{ id: string; country: string; charges_enabled: boolean; details_submitted: boolean }>("account");
check("the test key reaches the platform account", me.ok, me.ok ? `${me.data.id}, country ${me.data.country}` : me.error);
if (!me.ok) {
  console.log("\nThe key could not read the account, so nothing below can run.\n");
  process.exit(1);
}
const platformCountry = me.data.country;

/* ---------------------------------------------------------------- 2. the account the button creates -------- */

console.log("\n2. The Express account the Payouts button creates");
// A US shop on a Canadian platform is the case that needs cross-border payouts allowed, so try that first.
const wanted = platformCountry === "CA" ? "US" : "US";
const created = await stripe<{ id: string }>("accounts", {
  type: "express",
  country: wanted,
  email: "connect-e2e@onoutset.com",
  "business_profile[name]": "Connect E2E (not a real shop)",
  "business_profile[url]": SITE + "#o=" + LISTING,
  "capabilities[transfers][requested]": "true",
  // Stripe refuses transfers on its own for a US account, so the API asks for both. See src/api/payouts.ts.
  "capabilities[card_payments][requested]": "true",
  "metadata[listing]": LISTING,
});
check(
  `an Express account in ${wanted} is created from a ${platformCountry} platform`,
  created.ok,
  created.ok ? created.data.id : `HTTP ${created.status}: ${created.error}`,
);

if (!created.ok) {
  // This is the answer to the cross-border question, stated by Stripe rather than guessed at.
  console.log("\n" + "-".repeat(70));
  console.log("Stripe refused to create the account. That message is what to act on:");
  console.log("  " + created.error);
  console.log("\nIf it mentions cross-border payouts, or that the country is not supported, then a Canadian");
  console.log("platform cannot yet pay operators in " + wanted + " and that is a request to Stripe support.");
  console.log("If it mentions Connect not being enabled or terms not accepted, finish the Connect setup guide");
  console.log("in the Stripe dashboard first.");
  console.log("-".repeat(70) + "\n");
  console.log(`${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
const account = created.data.id;

// A shop in the platform's own country must work too, since the API picks the country from the listing.
if (platformCountry !== wanted) {
  const home = await stripe<{ id: string }>("accounts", {
    type: "express",
    country: platformCountry,
    email: "connect-e2e-home@onoutset.com",
    "business_profile[name]": "Connect E2E home (not a real shop)",
    "capabilities[transfers][requested]": "true",
    "capabilities[card_payments][requested]": "true",
    "metadata[listing]": LISTING,
  });
  check(`an Express account in the platform's own country (${platformCountry}) is created`, home.ok, home.ok ? home.data.id : home.error);
  if (home.ok) await stripe("accounts/" + home.data.id, undefined, "DELETE");
}

/* ---------------------------------------------------------------- 3. the hosted onboarding link ------------ */

console.log("\n3. The onboarding link the operator is sent to");
const link = await stripe<{ url: string; expires_at: number }>("account_links", {
  account,
  type: "account_onboarding",
  refresh_url: SITE + "operators#payouts",
  return_url: SITE + "operators#payouts",
});
check("an onboarding link is returned", link.ok && !!link.data.url, link.ok ? link.data.url.slice(0, 60) + "..." : link.error);
check("the link is on Stripe's own domain", !!link.data?.url?.startsWith("https://connect.stripe.com/"), link.data?.url?.split("/").slice(0, 3).join("/"));

/* ---------------------------------------------------------------- 4. the calls we make afterwards ---------- */

console.log("\n4. What the API does with the account afterwards");
// setAccountDailyPayouts: money reaching the operator's balance goes to their bank the next business day.
const daily = await stripe<{ settings: { payouts: { schedule: { interval: string } } } }>("accounts/" + account, {
  "settings[payouts][schedule][interval]": "daily",
});
check("the bank payout schedule is set to daily", daily.ok && daily.data?.settings?.payouts?.schedule?.interval === "daily", daily.ok ? daily.data.settings.payouts.schedule.interval : daily.error);

// The Payouts page reads these two flags back on every open. Fresh accounts are false until onboarding is done.
const read = await stripe<{ payouts_enabled: boolean; details_submitted: boolean; capabilities?: Record<string, string> }>("accounts/" + account);
check("the payouts flags read back", read.ok, read.ok ? `payouts_enabled ${read.data.payouts_enabled}, details_submitted ${read.data.details_submitted}` : read.error);
check(
  "a brand new account is not payouts-enabled, which is why the page says to finish onboarding",
  read.ok && read.data.payouts_enabled === false,
  read.ok ? String(read.data.payouts_enabled) : "",
);
check("the transfers capability was requested", read.ok && !!read.data.capabilities && "transfers" in read.data.capabilities, read.data?.capabilities);

/* ---------------------------------------------------------------- 5. clean up ------------------------------ */

console.log("\n5. Cleanup");
const gone = await stripe<{ deleted: boolean }>("accounts/" + account, undefined, "DELETE");
check("the test account is deleted, so nothing is left on the platform", gone.ok && gone.data?.deleted === true, gone.ok ? account : gone.error);

/* ---------------------------------------------------------------- summary ---------------------------------- */

console.log("\n" + "-".repeat(70));
console.log(`${passed} passed, ${failed} failed`);
if (!failed) {
  console.log("\nConnect is configured correctly. The Payouts button will create the account and open Stripe's");
  console.log("onboarding. The one step left is a person filling in Stripe's hosted identity and bank form,");
  console.log("which in test mode accepts its published dummy values.");
}
console.log();
process.exit(failed ? 1 : 0);
