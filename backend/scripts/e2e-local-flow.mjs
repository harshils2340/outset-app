/**
 * The browser half of the local end-to-end test. scripts/e2e-local.mts starts a local API and a local copy of
 * the site, then runs this against them in a headless browser: a guest opens the test listing, the operator
 * enters the dashboard through the test bypass, edits the listing, toggles Published, Accepting and Instant
 * Book, adds a service, changes the hours, and then a guest books, the operator accepts one request and
 * declines another.
 *
 * Nothing here talks to production. Every URL is localhost, the store is a temporary directory, and the API it
 * drives was started with no GitHub token, no data repository and no mail key.
 *
 * It is written as a step module for the CDP driver (scratchpad shot.mjs): `export default async (ctx) => {}`.
 * Run directly (`node e2e-local-flow.mjs <outDir>`) and it boots the same minimal driver itself, so the test
 * still works when that scratchpad file is gone.
 *
 * Results are written as JSON to E2E_OUT; e2e-local.mts prints the pass or fail lines from it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE || "http://localhost:5199";
const API = process.env.E2E_API || "http://localhost:8787";
const ID = process.env.E2E_ID || "";
const EMAIL = process.env.E2E_EMAIL || "harshils2340@gmail.com";
const STORE = process.env.E2E_STORE || "";
const API_LOG = process.env.E2E_APILOG || "";
const OUT = process.env.E2E_OUT || "";
const TITLE = process.env.E2E_TITLE || "Shah and Shah Services";
const NEW_TITLE = TITLE + " (edited by the harness)";
const NEW_ABOUT = "Edited by the local end-to-end harness. This sentence exists to prove an operator edit reaches the guest page.";
const NEW_SERVICE = "Harness kayak tour";
const NEW_PRICE = 42;

const results = [];
const record = (step, ok, note) => {
  results.push({ step, ok: ok === "warn" ? "warn" : !!ok, note: note ? String(note).slice(0, 400) : "" });
  console.log((ok === "warn" ? "  WARN  " : ok ? "  pass  " : "  FAIL  ") + step + (note ? "  -> " + String(note).slice(0, 300) : ""));
};

const store = (rel) => join(STORE, rel);
const readStore = (rel) => {
  try {
    return existsSync(store(rel)) ? JSON.parse(readFileSync(store(rel), "utf8")) : null;
  } catch {
    return null;
  }
};

/**
 * Profiles and bookings live in Postgres, not in STORE, so the truth behind a switch or a booking is read back
 * through the API with an operator session rather than off disk. STORE still holds the catalog files (o/*.json).
 * The session comes from the same test bypass the operator entered the dashboard with.
 */
let opSession = "";
async function session() {
  if (opSession) return opSession;
  const r = await fetch(`${API}/claims/${encodeURIComponent(ID)}/test-enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL }),
  }).catch(() => null);
  const j = r && r.ok ? await r.json() : null;
  opSession = j?.session || "";
  return opSession;
}
async function apiJson(path) {
  const s = await session();
  if (!s) return null;
  const r = await fetch(`${API}${path}`, { headers: { "x-session": s } }).catch(() => null);
  return r && r.ok ? await r.json() : null;
}
async function apiPatch(path, body) {
  const s = await session();
  if (!s) return null;
  const r = await fetch(`${API}${path}`, { method: "PATCH", headers: { "content-type": "application/json", "x-session": s }, body: JSON.stringify(body) }).catch(() => null);
  return r && r.ok ? await r.json() : null;
}
const apiLog = () => {
  try {
    return API_LOG && existsSync(API_LOG) ? readFileSync(API_LOG, "utf8") : "";
  } catch {
    return "";
  }
};
const bookings = async () => (await apiJson(`/bookings/${encodeURIComponent(ID)}`))?.bookings || [];
/**
 * The full stored record. The unauthenticated GET /profiles/:id answers with only what a guest may see
 * (id, published, patch, updatedAt), so switches that live in `profile` are read with the operator's session.
 */
const storedProfile = async () => (await apiJson(`/profiles/${encodeURIComponent(ID)}`)) || {};

/** The API's own view of the listing, which is what a second device or the guest page would read. */
async function remoteProfile() {
  const r = await fetch(`${API}/profiles/${encodeURIComponent(ID)}`).catch(() => null);
  return r && r.ok ? await r.json() : null;
}

/**
 * Stripe's hosted Checkout, in test mode only: card 4242 4242 4242 4242, any future date, any CVC. Stripe
 * renders the card fields in iframes, so the fields are filled by typing keys at the focused frame rather than
 * by setting values. Returns true once the browser is back on the local site.
 */
async function payOnStripe({ evaluate, send, sleep, shot }) {
  const type = async (chars) => {
    for (const ch of chars) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp" });
      await sleep(30);
    }
  };
  await sleep(4000);
  await shot("i1-stripe-checkout");
  // Focus the card number field, then tab through expiry, CVC and name.
  await evaluate(`(() => { const f=[...document.querySelectorAll("iframe")][0]; f?.focus(); return !!f; })()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab" }).catch(() => undefined);
  await type("4242424242424242");
  await type("1234");
  await type("123");
  await type("12345");
  await shot("i2-stripe-card-filled");
  await evaluate(`(() => { const b=[...document.querySelectorAll("button")].find(x=>/pay|subscribe/i.test(x.textContent||"")); if(b){b.click(); return "submitted";} return "no pay button"; })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const url = await evaluate("location.href");
    if (String(url).includes("localhost")) {
      await sleep(2500);
      await shot("i3-back-from-stripe");
      return true;
    }
  }
  await shot("i3-stripe-stuck");
  return false;
}

export default async function run(ctx) {
  try {
    if (process.env.E2E_MODE === "mail") {
      // Every email the API would have sent, rendered the way an inbox shows it (a 680px wide pane).
      const { readdirSync } = await import("node:fs");
      const dir = process.env.E2E_MAIL_DIR || "";
      const files = dir ? readdirSync(dir).filter((f) => f.endsWith(".html")).sort() : [];
      await ctx.send("Emulation.setDeviceMetricsOverride", { width: 680, height: 900, deviceScaleFactor: 1, mobile: false }).catch(() => undefined);
      for (const f of files) {
        await ctx.goto("file://" + join(dir, f));
        await ctx.sleep(300);
        await ctx.shot("mail-" + f.replace(/\.html$/, ""));
      }
      record("(m) every email rendered to a screenshot", files.length > 0, files.length + " emails");
      return;
    }
    if (process.env.E2E_MODE === "stripe") {
      await ctx.goto(process.env.E2E_CHECKOUT_URL || "");
      const ok = await payOnStripe(ctx);
      record("(i) the guest pays with 4242 4242 4242 4242 in Stripe test mode", ok, ok ? "returned to the local site" : "the hosted page did not complete");
      return;
    }
    await flow(ctx);
  } catch (e) {
    record("the flow stopped early", false, e && e.message);
  } finally {
    if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
  }
}

async function flow(ctx) {
  const { evaluate, shot, sleep, goto, log } = ctx;
  /* ---------- small helpers over the driver ---------- */

  const text = () => evaluate("document.body.innerText");
  const has = async (needle) => (await text()).includes(needle);
  const js = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`);

  /** Click the first element matching sel whose text contains `txt` (or the first one when txt is null). */
  const clickIn = (sel, txt = null) =>
    js(
      (s, t) => {
        const els = [...document.querySelectorAll(s)];
        const el = t ? els.find((e) => (e.textContent || "").toLowerCase().includes(t.toLowerCase())) : els[0];
        if (!el) return "MISSING " + s + (t ? " ~ " + t : "");
        el.scrollIntoView({ block: "center" });
        el.click();
        return "clicked " + (el.textContent || el.tagName).trim().slice(0, 50);
      },
      sel,
      txt,
    );

  /** Set a React-controlled input or textarea and fire the events React listens for. */
  const setValue = (sel, value, idx = 0) =>
    js(
      (s, v, i) => {
        const el = document.querySelectorAll(s)[i];
        if (!el) return "MISSING " + s;
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        return "set " + v;
      },
      sel,
      value,
      idx,
    );

  const setByPlaceholder = (placeholder, value) =>
    js(
      (ph, v) => {
        const el = [...document.querySelectorAll("input,textarea")].find((e) => (e.getAttribute("placeholder") || "").toLowerCase().includes(ph.toLowerCase()));
        if (!el) return "MISSING placeholder " + ph;
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return "typed into " + ph;
      },
      placeholder,
      value,
    );

  /** Wait until `check` (run in the page) is true, up to ms. */
  const until = async (fn, ms = 8000, every = 250) => {
    const end = Date.now() + ms;
    for (;;) {
      const ok = await js(fn).catch(() => false);
      if (ok) return true;
      if (Date.now() > end) return false;
      await sleep(every);
    }
  };

  /** Wait for something on the server side (the store, the API, the log). */
  const untilLocal = async (fn, ms = 12000, every = 300) => {
    const end = Date.now() + ms;
    for (;;) {
      if (await fn()) return true;
      if (Date.now() > end) return false;
      await sleep(every);
    }
  };

  /** Open a dashboard page from the sidebar ("Bookings", "Services", "Availability", "Listing", "Payouts"). */
  const openDashboardPage = async (label) => {
    const r = await js((l) => {
      // Every nav button starts with an icon wrapped in its own span, so the label is whichever span matches.
      const btn = [...document.querySelectorAll(".odnav .odgroupitems button")].find((b) => [...b.querySelectorAll("span")].some((s) => s.textContent.trim() === l));
      if (!btn) return "MISSING nav " + l;
      btn.click();
      return "opened " + l;
    }, label);
    if (String(r).startsWith("MISSING")) record("sidebar has a " + label + " page", false, r);
    log("nav: " + r);
    await sleep(900);
    return r;
  };

  /* ================= (a) a guest opens the test listing by its link ================= */

  await goto(`${BASE}/#o=${ID}`);
  await untilLocal(async () => String(await text()).includes(TITLE), 20000, 300);
  await sleep(1200);
  await shot("a-guest-listing");
  record("(a) guest opens the test listing by its link", await has(TITLE), (await text()).slice(0, 90).replace(/\s+/g, " "));

  /* ================= (b) the operator enters through the test claim bypass ================= */

  await goto(`${BASE}/operators#claim=${ID}`);
  await until(() => !!document.querySelector(".odlogin"), 15000);
  await sleep(1500);
  await setByPlaceholder("Full name", "Harness Owner");
  await setByPlaceholder("you@", EMAIL);
  await setByPlaceholder("(555) 555-5555", "8135550100");
  // The bypass button only renders once the API confirms the address is allowlisted (a 400ms debounce there).
  const bypassShown = await until(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Open the dashboard now")), 12000);
  await shot("b1-claim-screen");
  await clickIn("button", "Open the dashboard now");
  const inDash = await until(() => !!document.querySelector(".od .odbody"), 15000);
  await sleep(1500);
  await shot("b2-dashboard");
  record("(b) operator enters the dashboard through the test claim bypass", bypassShown && inDash, bypassShown ? "" : "the bypass button never appeared");

  /* ================= (c) edits, toggles, a service and hours ================= */

  // --- name and description ---
  await openDashboardPage("Listing");
  await until(() => !!document.querySelector('[data-jump="title"] input'), 8000);
  await setValue('[data-jump="title"] input', NEW_TITLE);
  await setValue('[data-jump="about"] textarea', NEW_ABOUT);
  await sleep(2500); // the dashboard debounces the save to the API by 1.2s
  const savedEdit = await untilLocal(async () => {
    const r = await remoteProfile();
    return r?.patch?.title === NEW_TITLE && String(r?.patch?.blurb || "").includes("end-to-end harness");
  });
  await shot("c1-listing-edited");
  record("(c1) business name and description saved to the API", savedEdit, savedEdit ? NEW_TITLE : JSON.stringify((await remoteProfile())?.patch?.title));

  // --- Published off, then on ---
  await clickIn(".odpublish .optoggle");
  await sleep(2500);
  const offOk = await untilLocal(async () => (await remoteProfile())?.published === false);
  await shot("c2-published-off");
  // The guest link still opens an unpublished listing on purpose (it drops out of browse, search and the
  // rails and stays reachable by its own link), but the page says it is hidden and shows no booking box.
  await goto(`${BASE}/#o=${ID}`);
  await sleep(2500);
  const stillOpens = (await has("This listing is hidden right now")) && !(await has("Pick a time"));
  await shot("c3-guest-while-unpublished");
  await goto(`${BASE}/operators`);
  await until(() => !!document.querySelector(".od .odbody"), 15000);
  await openDashboardPage("Listing");
  await clickIn(".odpublish .optoggle");
  await sleep(2500);
  const backOn = await untilLocal(async () => (await remoteProfile())?.published === true);
  record("(c2) Published off then on, guest link behaves as designed", offOk && stillOpens && backOn, offOk ? (stillOpens ? "hidden from lists, own link says it is hidden and takes no booking" : "guest page did not show the hidden notice, or still offered a booking") : "published flag did not reach the API");

  // --- Accepting off, then on ---
  await clickIn(".odtop .optoggle");
  await sleep(2500);
  const pausedSaved = await untilLocal(async () => (await storedProfile())?.profile?.accepting === false);
  await shot("c4-accepting-off");
  // Can a guest still book while the operator is paused? Ask the API the way the site does.
  const probeCode = "E2EPAUSE";
  const probe = await fetch(`${API}/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      listing: ID, code: probeCode, date: isoDays(3), slot: "10:00", qty: 1, service: "Sunset sail", variant: "Adult", total: 5,
      guest: { name: "Paused Probe", phone: "4165550111", email: "" },
    }),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const guestBlocked = !probe?.ok;
  await clickIn(".odtop .optoggle");
  await sleep(2000);
  const acceptingBack = await untilLocal(async () => (await storedProfile())?.profile?.accepting === true);
  record(
    "(c3) Accepting off then on",
    pausedSaved && acceptingBack && guestBlocked,
    guestBlocked ? "a paused shop refused the booking" : "the API took the booking while the shop was paused",
  );

  // --- Instant Book on, then off ---
  await openDashboardPage("Bookings");
  await until(() => !!document.querySelector(".odinstant .optoggle"), 8000);
  await clickIn(".odinstant .optoggle");
  await sleep(2500);
  const instantOn = await untilLocal(async () => (await storedProfile())?.profile?.instantBook === true);
  await shot("c5-instant-book-on");
  await clickIn(".odinstant .optoggle");
  await sleep(2500);
  const instantOff = await untilLocal(async () => (await storedProfile())?.profile?.instantBook === false);
  record("(c4) Instant Book on then off", instantOn && instantOff, instantOn ? "" : "instantBook never reached the API");

  // --- a new service with a price ---
  await openDashboardPage("Services");
  await until(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Add service")), 8000);
  await clickIn("button", "Add service");
  await sleep(800);
  await js((name) => {
    const open = document.querySelector(".odsvc.open");
    const input = open?.querySelector('.odfield input[value="New service"], .odfield input');
    if (!input) return "MISSING new service row";
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return "named";
  }, NEW_SERVICE);
  await sleep(400);
  await js((price) => {
    const open = document.querySelector(".odsvc.open");
    const input = open?.querySelector('.odvar input[type="number"]');
    if (!input) return "MISSING price input";
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(price));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return "priced";
  }, NEW_PRICE);
  await sleep(400);
  // A new service starts hidden; switch it live so guests see it.
  await js(() => {
    const open = document.querySelector(".odsvc.open");
    const btn = open?.querySelector(".opavail.off") || [...(open?.querySelectorAll("button") || [])].find((b) => b.textContent.trim() === "Hidden");
    if (!btn) return "already live";
    btn.click();
    return "made live";
  });
  await sleep(2600);
  const serviceSaved = await untilLocal(async () => {
    const r = await remoteProfile();
    return (r?.patch?.options || []).some((o) => o.name === NEW_SERVICE && o.price === NEW_PRICE);
  });
  await shot("c6-service-added");
  record("(c5) a service with a price saved to the API", serviceSaved, serviceSaved ? `${NEW_SERVICE} at $${NEW_PRICE}` : JSON.stringify(((await remoteProfile())?.patch?.options || []).slice(0, 3)));

  // --- hours ---
  await openDashboardPage("Availability");
  await until(() => !!document.querySelector(".odhour select"), 8000);
  const hoursBefore = JSON.stringify((await remoteProfile())?.patch?.hoursText || []);
  await setValue(".odhour select", "07:00");
  await sleep(2600);
  const hoursSaved = await untilLocal(async () => JSON.stringify((await remoteProfile())?.patch?.hoursText || []) !== hoursBefore);
  await shot("c7-hours-changed");
  record("(c6) opening hours saved to the API", hoursSaved, ((await remoteProfile())?.patch?.hoursText || [])[0] || "");

  /* ================= (d) every edit reached the guest page ================= */

  await goto(`${BASE}/#o=${ID}`);
  await until(() => document.body.innerText.includes("harness"), 15000);
  await sleep(1500);
  const page = await text();
  const onPage = {
    title: page.includes("edited by the harness"),
    about: page.includes("end-to-end harness"),
    service: page.includes(NEW_SERVICE),
    price: page.includes("$" + NEW_PRICE),
  };
  await shot("d-guest-sees-edits");
  record("(d) the guest page shows the new name, story, service and price", onPage.title && onPage.about && onPage.service && onPage.price, JSON.stringify(onPage));

  /* ================= (e) a guest books the sunset sail as a request ================= */

  const bookedOk = await js(() => {
    // Pick the Sunset sail option in the booking card.
    const btns = [...document.querySelectorAll(".alvariant")];
    const el = btns.find((b) => {
      const card = b.closest(".alservice, .alsvc, section, li, div");
      return (card?.textContent || "").toLowerCase().includes("sunset");
    }) || btns[0];
    if (!el) return "MISSING option buttons";
    el.scrollIntoView({ block: "center" });
    el.click();
    return "picked " + el.textContent.trim().slice(0, 40);
  });
  await sleep(600);
  await clickIn(".alboxcell", "Date");
  await sleep(800);
  const dayPicked = await js(() => {
    const d = [...document.querySelectorAll(".bkday.open")].filter((b) => b.getAttribute("aria-disabled") !== "true");
    const el = d[1] || d[0];
    if (!el) return "MISSING open day";
    el.click();
    return "day " + el.getAttribute("data-k");
  });
  await sleep(700);
  const slotPicked = await clickIn(".bkchip");
  await sleep(700);
  await setByPlaceholder("Your name", "Harness Guest");
  await setByPlaceholder("Mobile number", "4165550123");
  await setByPlaceholder("Email for your confirmation", "harness.guest@example.com");
  await sleep(500);
  await shot("e1-booking-filled");
  await clickIn(".alprimary");
  // With a Stripe test key the guest is sent to the hosted page first; they come back to #paid=<code>.
  if (process.env.E2E_STRIPE) {
    await sleep(3000);
    if (String(await evaluate("location.host")).includes("stripe.com")) await payOnStripe(ctx);
  }
  const landed = await untilLocal(async () => (await bookings()).some((b) => b.guest?.name === "Harness Guest"), 15000);
  await sleep(1200);
  await shot("e2-request-sent");
  const first = (await bookings()).find((b) => b.guest?.name === "Harness Guest");
  record("(e) the guest books the sunset sail as a request", landed && first?.status === "new", landed ? `${first.code} ${first.service} ${first.status} $${first.total}` : `option:${bookedOk} day:${dayPicked} slot:${slotPicked}`);

  /* ================= (e2) that time is gone: from the API, from the page, and a second guest is refused ================= */

  if (first) {
    // A time holds the service's capacity (the dashboard's per-service seat count, 8 by default). Fill what is
    // left at the booked time, then it must be gone everywhere and the next guest refused.
    const svc = ((await storedProfile())?.profile?.services || []).find((x) => String(x.name).toLowerCase() === String(first.service).toLowerCase());
    const capacity = Number(svc?.capacity) > 0 ? Number(svc.capacity) : 1;
    const left = Math.max(0, capacity - Number(first.qty || 1));
    const filler = left
      ? await fetch(`${API}/bookings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ listing: ID, code: "E2E-FILL", date: first.date, slot: first.slot, qty: left, service: first.service, variant: first.variant, total: null, guest: { name: "Filler Party", phone: "4165550778", email: "" } }),
        }).then((r) => r.json()).catch((e) => ({ error: String(e) }))
      : { ok: true, skipped: true };
    const open = await fetch(`${API}/bookings/open/${encodeURIComponent(ID)}?from=${first.date}&days=1&service=${encodeURIComponent(first.service)}`).then((r) => r.json()).catch(() => null);
    const stillListed = !!open?.days?.[0]?.slots?.includes(first.slot);
    // The page, reloaded: the picked day must not offer that start time any more.
    await goto(`${BASE}/#o=${ID}`);
    await until(() => document.body.innerText.includes("harness"), 15000);
    await sleep(2500);
    await js((k) => {
      const d = [...document.querySelectorAll(".bkday")].find((b) => b.getAttribute("data-k") === k);
      d?.click();
      return d ? "day" : "MISSING day";
    }, first.date);
    await sleep(800);
    const chipTimes = await js(() => [...document.querySelectorAll(".bkchip")].map((c) => c.textContent.trim()));
    const fmt12 = (t) => { const [h, m] = t.split(":").map(Number); return (h % 12 || 12) + ":" + String(m).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM"); };
    const onPage = Array.isArray(chipTimes) && chipTimes.some((t) => t.startsWith(fmt12(first.slot)));
    await shot("e3-slot-gone-from-picker");
    const again = await fetch(`${API}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listing: ID, code: "E2E-DUPE", date: first.date, slot: first.slot, qty: 1, service: first.service, variant: first.variant, total: first.total, guest: { name: "Second Guest", phone: "4165550777", email: "" } }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })).catch((e) => ({ status: 0, body: { error: String(e) } }));
    const refused = again.status === 409 && again.body?.code === "slot_taken";
    record("(e2) a full time disappears from the API and the picker, and the next guest is refused", !!filler?.ok && !stillListed && !onPage && refused, `capacity ${capacity}, filled ${left}: ${filler?.ok ? "ok" : filler?.error}; api lists it: ${stillListed}, page shows it: ${onPage}, next booking: HTTP ${again.status} ${again.body?.error || ""}`);
  }

  /* ================= (f) the founder alert and the guest email are in the API log ================= */

  const logNow = apiLog();
  const founderMail = /\[mail:dry\] to=harshils2340@gmail\.com subject=.*(CALL THE SHOP|Booking )/i.test(logNow);
  const guestMail = /\[mail:dry\] to=harness\.guest@example\.com subject="Request sent/i.test(logNow);
  record("(f) founder alert and guest confirmation printed to the API log", founderMail && guestMail, `founder:${founderMail} guest:${guestMail}`);

  /* ================= (g) the operator sees the request and accepts it ================= */

  await goto(`${BASE}/operators`);
  await until(() => !!document.querySelector(".od .odbody"), 15000);
  await openDashboardPage("Bookings");
  const rowShown = await until(() => document.body.innerText.includes("Harness Guest"), 20000);
  await shot("g1-request-in-dashboard");
  await js(() => {
    const row = [...document.querySelectorAll(".odbk")].find((r) => r.textContent.includes("Harness Guest"));
    const btn = [...(row?.querySelectorAll("button") || [])].find((b) => b.textContent.trim() === "Accept");
    if (!btn) return "MISSING accept";
    btn.click();
    return "accepted";
  });
  const acceptedOk = await untilLocal(async () => (await bookings()).find((b) => b.guest?.name === "Harness Guest")?.status === "accepted", 15000);
  await sleep(1200);
  await shot("g2-accepted");
  const acceptMail = /\[mail:dry\] to=harness\.guest@example\.com subject="Confirmed:/i.test(apiLog());
  record("(g) the operator accepts and the guest is emailed", rowShown && acceptedOk && acceptMail, `row:${rowShown} accepted:${acceptedOk} email:${acceptMail}`);

  /* ================= (h) a second booking is declined ================= */

  const code2 = "E2E-DECL";
  const second = await fetch(`${API}/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      listing: ID, code: code2, date: isoDays(5), slot: "11:00", qty: 2, service: "Snorkel trip", variant: "Standard", total: 16,
      guest: { name: "Harness Guest Two", phone: "4165550124", email: "harness.two@example.com" },
    }),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  await sleep(1500);
  await goto(`${BASE}/operators`);
  await until(() => !!document.querySelector(".od .odbody"), 15000);
  await openDashboardPage("Bookings");
  await until(() => document.body.innerText.includes("Harness Guest Two"), 20000);
  await js(() => {
    const row = [...document.querySelectorAll(".odbk")].find((r) => r.textContent.includes("Harness Guest Two"));
    const btn = [...(row?.querySelectorAll("button") || [])].find((b) => b.textContent.trim() === "Decline");
    if (!btn) return "MISSING decline";
    btn.click();
    return "declined";
  });
  const declinedOk = await untilLocal(async () => (await bookings()).find((b) => b.code === code2)?.status === "declined", 15000);
  await sleep(1200);
  await shot("h-declined");
  const declineMail = /\[mail:dry\] to=harness\.two@example\.com subject="Not available:/i.test(apiLog());
  record("(h) a second booking is declined and the guest is told", !!second?.ok && declinedOk && declineMail, `booked:${!!second?.ok} declined:${declinedOk} email:${declineMail}`);

  /* ================= (h2) Instant Book on: a booking confirms on its own and both sides hear "booked" ================= */

  await openDashboardPage("Bookings");
  await until(() => !!document.querySelector(".odinstant .optoggle"), 8000);
  await clickIn(".odinstant .optoggle");
  await sleep(2500);
  const instantReady = await untilLocal(async () => (await storedProfile())?.profile?.instantBook === true);
  const code3 = "E2E-INST";
  const third = instantReady ? await fetch(`${API}/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      listing: ID, code: code3, date: isoDays(6), slot: "13:00", qty: 2, service: "Sunset sail", variant: "Adult", total: 40,
      guest: { name: "Harness Guest Three", phone: "4165550125", email: "harness.three@example.com" },
    }),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) })) : null;
  await sleep(1500);
  const instantRow = (await bookings()).find((b) => b.code === code3);
  const instantMails = /\[mail:dry\] to=harness\.three@example\.com subject="You're booked:/i.test(apiLog()) && /\[mail:dry\] to=[^\n]* subject="New booking:/i.test(apiLog());
  await clickIn(".odinstant .optoggle");
  await sleep(2000);
  await untilLocal(async () => (await storedProfile())?.profile?.instantBook === false);
  record("(h2) with Instant Book on, a booking confirms itself and both emails say booked", instantReady && third?.status === "accepted" && instantRow?.status === "accepted" && instantMails, `api:${third?.status} stored:${instantRow?.status} emails:${instantMails}`);

  /* ================= (h3) the operator cancels a confirmed booking and the guest is told ================= */

  await goto(`${BASE}/operators`);
  await until(() => !!document.querySelector(".od .odbody"), 15000);
  await openDashboardPage("Bookings");
  await clickIn(".odtabs button, .odfilter button, button", "Upcoming");
  await sleep(800);
  const opened = await js(() => {
    const row = [...document.querySelectorAll(".odbk")].find((r) => r.textContent.includes("Harness Guest Three"));
    const btn = row?.querySelector(".odbkmain");
    if (!btn) return "MISSING row";
    btn.click();
    return "opened";
  });
  await sleep(900);
  const cancelled = await js(() => {
    const btn = [...document.querySelectorAll(".oddraweractions button")].find((b) => b.textContent.trim() === "Cancel booking");
    if (!btn) return "MISSING cancel";
    btn.click();
    return "cancelled";
  });
  const cancelSaved = await untilLocal(async () => (await bookings()).find((b) => b.code === code3)?.status === "cancelled", 15000);
  await sleep(1200);
  await shot("h3-cancelled");
  const cancelMail = /\[mail:dry\] to=harness\.three@example\.com subject="Cancelled:/i.test(apiLog());
  record("(h3) the operator cancels a confirmed booking and the guest is emailed", cancelSaved && cancelMail, `open:${opened} click:${cancelled} saved:${cancelSaved} email:${cancelMail}`);

  /* ================= payouts page, as the operator sees it ================= */

  await openDashboardPage("Payouts");
  await sleep(1500);
  await shot("i-payouts-page");
  record("(i0) the payouts page renders in the dashboard", await has("payout"), "");

  /* ================= (i1) the payouts tiles are the operator's money, not the guest's total =================
     With no Stripe account connected the page falls back to what this shop's own bookings add up to. Those
     tiles took 5% off the guest total, which counts the guest's service fee as the operator's money: a $19
     booking read "$18 earned" on this page while the booking email for the same trip said "You receive
     $17.10". The tile is the operator's price less Outset's 5% and nothing else. */
  const acceptedRow = (await bookings()).find((b) => b.guest?.name === "Harness Guest");
  let tile = "no booking to complete";
  let want = "";
  if (acceptedRow) {
    await apiPatch(`/bookings/${encodeURIComponent(ID)}/${acceptedRow.code}`, { status: "completed" });
    const sub = acceptedRow.pricing?.subtotal ?? acceptedRow.total ?? 0;
    want = "$" + Math.round(sub * 0.95).toLocaleString("en-US");
    await goto(`${BASE}/operators`);
    await until(() => !!document.querySelector(".od .odbody"), 15000);
    await openDashboardPage("Payouts");
    await sleep(1500);
    tile = await js(() => {
      const t = [...document.querySelectorAll(".odstats div")].find((d) => d.textContent.includes("Earned to date"));
      return t ? (t.querySelector("b")?.textContent || "").trim() : "MISSING tile";
    });
    await shot("i1-payouts-earned");
  }
  record(
    "(i1) the payouts tiles pay the operator's price less 5%, not 5% off the guest total",
    !!acceptedRow && tile === want,
    `tile:${tile} want:${want} guest total:${acceptedRow?.total} operator price:${acceptedRow?.pricing?.subtotal}`,
  );

  log("flow finished");
}

/** YYYY-MM-DD, n days from now. */
function isoDays(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------------------------------------
 * Standalone driver. The harness prefers the scratchpad shot.mjs when it is there; this is the same
 * minimal CDP driver so the test keeps working without it. Headless always: Harshil works on this Mac.
 * ---------------------------------------------------------------------------------------------- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const { spawn } = await import("node:child_process");
  const { mkdirSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const outDir = process.argv[2] || ".";
  const W = Number(process.env.W || 1440);
  const H = Number(process.env.H || 900);
  const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  mkdirSync(outDir, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--mute-audio", "--no-default-browser-check", `--remote-debugging-port=${port}`, "--no-first-run", "--no-sandbox", `--window-size=${W},${H}`, `--user-data-dir=/tmp/outset-e2e-prof-${port}`, "--hide-scrollbars", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) res(m[1]);
    });
    setTimeout(() => rej(new Error("chrome did not start: " + buf)), 15000);
  });
  void wsUrl;
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) logs.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    if (m.method === "Runtime.exceptionThrown") logs.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const goto = async (url) => {
    await send("Page.navigate", { url });
    await sleep(1500);
  };
  const shot = async (name, full = true) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
    const f = resolve(outDir, name + ".png");
    writeFileSync(f, Buffer.from(r.data, "base64"));
    console.log("shot", f);
    return f;
  };
  try {
    await run({ send, evaluate, shot, sleep, goto, W, H, log: console.log });
  } catch (e) {
    console.log("STEP ERROR", e.message);
    record("flow crashed", false, e.message);
    if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
  }
  console.log("CONSOLE:", logs.length ? logs.join("\n  ") : "none");
  ws.close();
  proc.kill();
}
