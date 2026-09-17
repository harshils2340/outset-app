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

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
/** Controls the harness reached for and did not find. See the note on `js` below. */
const missed = [];
/** The one reach allowed to come back empty: the sidebar probe already records its own miss. */
const EXPECTED_MISSES = ["MISSING nav "];
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
/**
 * Did the API write this message, to this person, about this?
 *
 * These five checks used to grep the API's own `[mail:dry]` line for the recipient's raw address. That line
 * masks the address now ("h...@gmail.com") so a log export cannot leak real inboxes, and every one of the five
 * stopped matching the day the masking landed: five emails the API had in fact written, reported as a product
 * that never sent them. The messages themselves are what to read, and MAIL_DUMP_DIR has them with a real
 * "To:" line, which the masked log cannot give: two of the harness's guests share a first letter and a domain.
 */
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mailbox = () => {
  const dir = process.env.E2E_MAIL_DIR || "";
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => readFileSync(join(dir, f), "utf8"));
  } catch {
    return [];
  }
};
const mailSent = (email, subject) => {
  const want = new RegExp(`^To: ${rx(String(email).toLowerCase())}\\nSubject: ${subject}`, "im");
  return mailbox().some((m) => want.test(m));
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
  /**
   * Every helper below answers "MISSING ..." when the control it reached for is not on the page, and every
   * caller but one threw that answer away. So a dashboard rework could rename a control and the step that
   * drives it would quietly do nothing: the rehearsal stayed green through the step itself and failed three
   * checks later with no hint why. Collected here and reported as its own check at the end of the flow.
   */
  const js = async (fn, ...args) => {
    const r = await evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`);
    if (String(r).startsWith("MISSING")) missed.push(String(r));
    return r;
  };

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
  /* The same listing in the phone frame, which is what a phone opens and what "Open the phone app" reaches on
     a desktop. It is a different screen with its own booking box, and it read neither switch, so a hidden shop
     was offered with a full picker and a Request button, and the guest only found out after choosing a
     service, a date, a time and a party and typing their name, mobile and email. */
  await goto(`${BASE}/`);
  await until(() => !!document.querySelector(".web"), 15000);
  await js(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Open the phone app");
    if (!b) return "MISSING open the phone app";
    b.click();
    return "opened the phone frame";
  });
  await sleep(1200);
  await js((id) => { window.location.hash = "#o=" + id; return "opened the listing"; }, ID);
  await until(() => !!document.querySelector("#screen .airlisting, #screen .reqpad"), 15000);
  await sleep(2000);
  const phoneSaysHidden = await has("This listing is hidden right now");
  const phoneOffersBooking = await js(() => [...document.querySelectorAll(".airreserve button")].some((b) => /^(Reserve|Request)$/.test((b.textContent || "").trim())));
  await shot("c3b-phone-while-unpublished");
  await goto(`${BASE}/operators`);
  await until(() => !!document.querySelector(".od .odbody"), 15000);
  await openDashboardPage("Listing");
  await clickIn(".odpublish .optoggle");
  await sleep(2500);
  const backOn = await untilLocal(async () => (await remoteProfile())?.published === true);
  record("(c2) Published off then on, guest link behaves as designed", offOk && stillOpens && backOn, offOk ? (stillOpens ? "hidden from lists, own link says it is hidden and takes no booking" : "guest page did not show the hidden notice, or still offered a booking") : "published flag did not reach the API");
  record(
    "(c2b) the same hidden listing in the phone app says so and offers no booking",
    phoneSaysHidden && phoneOffersBooking === false,
    `says hidden:${phoneSaysHidden} still offers a booking:${phoneOffersBooking}`,
  );

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
    // The price box is a text input that parses what is typed, not a browser number box: it has been
    // `type="text"` since the menu editor learned to read "$45" and "45,000" and to refuse "-20".
    const input = open?.querySelector('.odvar input[aria-label^="Price for"]');
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

  /* ================= (c7) the calendar: a blocked slot and a day off reach the guest =================
     The owner blocks time here and then trusts the page. The key the calendar writes ("YYYY-MM-DD|HH:MM") and
     the one scheduledSlots reads match by inspection, and nothing had ever driven the two together: a slot the
     calendar hides and the API still sells is a guest turning up on a day the owner gave themselves off. */

  /** The start times a guest is offered on one date, straight from the public picker route. */
  const guestSlots = async (date) => {
    const r = await fetch(`${API}/bookings/open/${encodeURIComponent(ID)}?from=${date}&days=1`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    return r?.days?.[0]?.slots || [];
  };

  await openDashboardPage("Calendar");
  await until(() => !!document.querySelector(".odcal .odcalcell"), 10000);
  // Next week, so every column is far enough out that the notice cannot be what hides a time from a guest.
  await js(() => {
    document.querySelector('.odcalnav button[aria-label="Next"]')?.click();
    return "next week";
  });
  await sleep(900);
  const cellKey = await js(() => {
    const fill = [...document.querySelectorAll(".odcalcell:not(.closed):not(.blocked) .odcalfill")][0];
    return fill ? fill.parentElement.getAttribute("data-k") || "" : "";
  });
  const [calDate, calSlot] = String(cellKey || "|").split("|");
  const slotOffered = (await guestSlots(calDate)).includes(calSlot);
  await js((k) => {
    const el = document.querySelector('.odcalcell[data-k="' + k + '"] .odcalfill');
    if (!el) return "MISSING cell " + k;
    el.click();
    return "blocked " + k;
  }, cellKey);
  await sleep(2600);
  const slotStored = await untilLocal(async () => ((await storedProfile())?.profile?.blockedSlots || []).includes(cellKey));
  const slotGone = await untilLocal(async () => !(await guestSlots(calDate)).includes(calSlot));
  await shot("c8-calendar-slot-blocked");
  record(
    "(c7) a slot blocked in the calendar is saved and stops being offered to guests",
    !!cellKey && slotOffered && slotStored && slotGone,
    `${cellKey} offered:${slotOffered} stored:${slotStored} gone:${slotGone}`,
  );

  // Reopening it puts the time back, so an owner who blocks the wrong cell can undo it.
  await js((k) => {
    const el = document.querySelector('.odcalcell[data-k="' + k + '"] .odcalfill');
    if (!el) return "MISSING cell " + k;
    el.click();
    return "reopened " + k;
  }, cellKey);
  await sleep(2600);
  const slotBack = await untilLocal(async () => (await guestSlots(calDate)).includes(calSlot));
  record("(c8) reopening that slot offers the time again", slotBack, `${cellKey} back:${slotBack}`);

  const dayKey = await js(() => {
    const b = [...document.querySelectorAll(".odcalday:not(.past):not(.closed)")].find((x) => !x.disabled);
    return b ? b.getAttribute("data-k") || "" : "";
  });
  const dayHadSlots = (await guestSlots(dayKey)).length;
  await js((k) => {
    const el = document.querySelector('.odcalday[data-k="' + k + '"]');
    if (!el) return "MISSING day " + k;
    el.click();
    return "day off " + k;
  }, dayKey);
  await sleep(2600);
  const dayStored = await untilLocal(async () => ((await storedProfile())?.profile?.blockedDates || []).includes(dayKey));
  const dayShut = await untilLocal(async () => (await guestSlots(dayKey)).length === 0);
  await shot("c9-calendar-day-off");
  record(
    "(c9) a day taken off in the calendar is saved and offers a guest no time at all",
    !!dayKey && dayHadSlots > 0 && dayStored && dayShut,
    `${dayKey} had:${dayHadSlots} stored:${dayStored} shut:${dayShut}`,
  );

  await js((k) => {
    const el = document.querySelector('.odcalday[data-k="' + k + '"]');
    if (!el) return "MISSING day " + k;
    el.click();
    return "reopened " + k;
  }, dayKey);
  await sleep(2600);
  const dayBack = await untilLocal(async () => (await guestSlots(dayKey)).length > 0);
  record("(c10) reopening that day offers its times again", dayBack, `${dayKey} back:${dayBack}`);

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
  await setByPlaceholder("your confirmation goes", "harness.guest@example.com");
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
    // The month grid lives inside the date and time popover, which a fresh page load starts closed. Reaching
    // straight for .bkday found nothing, so this check read an empty list of chips and called the time gone
    // whatever the page was really offering.
    await js(() => {
      const cell = [...document.querySelectorAll(".alboxcell")].find((c) => (c.textContent || "").includes("Date"));
      if (!cell) return "MISSING date cell";
      if (cell.getAttribute("aria-expanded") !== "true") cell.click();
      return "picker open";
    });
    await sleep(600);
    await js((k) => {
      const d = [...document.querySelectorAll(".bkday")].find((b) => b.getAttribute("data-k") === k);
      d?.click();
      return d ? "day" : "MISSING day " + k;
    }, first.date);
    await sleep(800);
    const chipTimes = await js(() => [...document.querySelectorAll(".bkchip")].map((c) => c.textContent.trim()));
    const fmt12 = (t) => { const [h, m] = t.split(":").map(Number); return (h % 12 || 12) + ":" + String(m).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM"); };
    // An empty picker is not proof the time is gone: it is proof nothing was read. Say so rather than pass.
    const readChips = Array.isArray(chipTimes) && chipTimes.length > 0;
    const onPage = Array.isArray(chipTimes) && chipTimes.some((t) => t.startsWith(fmt12(first.slot)));
    await shot("e3-slot-gone-from-picker");
    const again = await fetch(`${API}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listing: ID, code: "E2E-DUPE", date: first.date, slot: first.slot, qty: 1, service: first.service, variant: first.variant, total: first.total, guest: { name: "Second Guest", phone: "4165550777", email: "" } }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })).catch((e) => ({ status: 0, body: { error: String(e) } }));
    const refused = again.status === 409 && again.body?.code === "slot_taken";
    record("(e2) a full time disappears from the API and the picker, and the next guest is refused", !!filler?.ok && !stillListed && readChips && !onPage && refused, `capacity ${capacity}, filled ${left}: ${filler?.ok ? "ok" : filler?.error}; api lists it: ${stillListed}, picker read ${Array.isArray(chipTimes) ? chipTimes.length : 0} times, page shows it: ${onPage}, next booking: HTTP ${again.status} ${again.body?.error || ""}`);
  }

  /* ================= (f) the founder alert and the guest email were both written ================= */

  const founderMail = mailSent("harshils2340@gmail.com", "(.*CALL THE SHOP|Booking )");
  const guestMail = mailSent("harness.guest@example.com", "Request sent");
  // A mailbox that is empty because nothing was passed down is not two emails that were never written.
  record("(f) founder alert and guest confirmation were written", founderMail && guestMail, mailbox().length ? `founder:${founderMail} guest:${guestMail}` : "the harness was given no mail directory to read");

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
  const acceptMail = mailSent("harness.guest@example.com", "Confirmed:");
  record("(g) the operator accepts and the guest is emailed", rowShown && acceptedOk && acceptMail, `row:${rowShown} accepted:${acceptedOk} email:${acceptMail}`);

  /* ================= (g2) the dashboard's front page, and the money it promises =================
     Home is the page an owner opens every morning and the one page this rehearsal had never opened. Its two
     tiles summed each booking's total, which is what the guest paid: the operator's price plus the guest's
     service fee. A $116 sail read "$121 on the books" beside a booking email promising $110.20, and the
     Payouts page the tile links to gave a third number. The tile is the operator's price less Outset's 5%. */

  await openDashboardPage("Home");
  const homeShown = await until(() => !!document.querySelector(".odhome .ohfeed"), 15000);
  await shot("g3-home-front-page");
  const homeTiles = await js(() =>
    [...document.querySelectorAll(".ohpulse > button")].map((b) => {
      const pick = (sel) => {
        const el = b.querySelector(sel);
        return el ? el.textContent.trim() : "";
      };
      return { label: pick("small"), money: pick("b"), note: pick("span") };
    }),
  );
  {
    // The same window Home reads, on the same clock: today through the next seven days, confirmed only.
    const localKey = (n) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const onBooks = (await bookings()).filter((b) => b.status === "accepted" && b.date >= localKey(0) && b.date < localKey(7));
    // operatorShare in backend/src/payments/money.ts: the 5% is rounded once, in whole cents.
    const netCents = onBooks.reduce((n, b) => {
      const sub = Math.round(Number(b.pricing?.subtotal ?? 0) * 100);
      return n + (sub - Math.round(sub * 0.05));
    }, 0);
    const grossCents = onBooks.reduce((n, b) => n + Math.round(Number(b.total ?? 0) * 100), 0);
    const dollars = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
    const tile = Array.isArray(homeTiles) ? homeTiles[0] : null;
    const ok = !!tile && tile.money === dollars(netCents) && (netCents === grossCents || tile.money !== dollars(grossCents));
    // Nothing on the books is not proof of anything: a booking was accepted two steps ago, so it means the
    // harness booked outside the window this tile reads. Say so rather than pass on an empty page.
    const verdict = !homeShown ? false : netCents ? ok : "warn";
    record(
      "(g2) the dashboard's front page promises the operator their own money, not the guest's total",
      verdict,
      netCents
        ? `${onBooks.length} on the books: tile ${tile ? tile.money : "no tile"}, payout ${dollars(netCents)}, guest totals ${dollars(grossCents)}`
        : `nothing on the books, and Home shows ${Array.isArray(homeTiles) ? homeTiles.length : "unreadable"} money tiles`,
    );
  }

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
  const declineMail = mailSent("harness.two@example.com", "Not available:");
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
  const instantMails = mailSent("harness.three@example.com", "You're booked:") && mailbox().some((m) => /^Subject: New booking:/im.test(m));
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
  // Cancelling is two clicks: "Cancel booking" asks, "Yes, cancel it" does it. Clicking only the first one
  // left the booking confirmed and the guest un-emailed, which is exactly what the harness then reported.
  const asked = await js(() => {
    const btn = [...document.querySelectorAll(".oddraweractions button")].find((b) => b.textContent.trim() === "Cancel booking");
    if (!btn) return "MISSING cancel";
    btn.click();
    return "asked";
  });
  await sleep(400);
  const cancelled = await js(() => {
    const btn = [...document.querySelectorAll(".oddraweractions button")].find((b) => b.textContent.trim() === "Yes, cancel it");
    if (!btn) return "MISSING cancel confirm";
    btn.click();
    return "cancelled";
  });
  const cancelSaved = await untilLocal(async () => (await bookings()).find((b) => b.code === code3)?.status === "cancelled", 15000);
  await sleep(1200);
  await shot("h3-cancelled");
  const cancelMail = mailSent("harness.three@example.com", "Cancelled:");
  record("(h3) the operator cancels a confirmed booking and the guest is emailed", cancelSaved && cancelMail, `open:${opened} ask:${asked} click:${cancelled} saved:${cancelSaved} email:${cancelMail}`);

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
    // The tile keeps cents, the way money() and the booking email do: $18 less 5% is "$17.10", not "$17".
    const net = Math.round(sub * 0.95 * 100) / 100;
    want = "$" + net.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(net) ? 0 : 2, maximumFractionDigits: 2 });
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

  /* ================= (j) an operator whose session has run out =================
     A session lasts thirty days and nothing renews it, so every operator who claimed a month ago reaches
     this. The profile save is debounced and its answer used to be thrown away, so a 403 went unnoticed and
     the header went on reading "Saved", which is about this browser's storage: the owner fixed prices, hours
     and photos for as long as they liked and not one edit reached a guest. Run last, because it signs this
     browser out. */
  const STALE_TITLE = TITLE + " (typed after the session ran out)";
  await goto(`${BASE}/operators`);
  await until(() => !!document.querySelector(".od .odbody"), 15000);
  const beforeStale = (await remoteProfile())?.patch?.title;
  // Age the session the way thirty days would, and drop any claim token with it: what is left is a dashboard
  // that still opens from this device's own storage and can prove nothing to the API.
  await js(() => {
    const s = JSON.parse(localStorage.getItem("outset.session.v1") || "null");
    if (s) localStorage.setItem("outset.session.v1", JSON.stringify({ ...s, exp: Date.now() - 1000 }));
    for (const k of Object.keys(localStorage)) if (k.startsWith("outset.claimtoken.")) localStorage.removeItem(k);
    return s ? "aged" : "MISSING session";
  });
  await goto(`${BASE}/operators`);
  await until(() => !!document.querySelector(".od .odbody"), 15000);
  await openDashboardPage("Listing");
  await until(() => !!document.querySelector('[data-jump="title"] input'), 8000);
  await setValue('[data-jump="title"] input', STALE_TITLE);
  await sleep(3000);
  const toldThem = await has("Sign in again to publish your changes");
  const afterStale = (await remoteProfile())?.patch?.title;
  await shot("j-session-expired");
  record(
    "(j) an expired session says so instead of silently dropping every edit",
    toldThem && afterStale === beforeStale && afterStale !== STALE_TITLE,
    `notice shown:${toldThem} title at the API before:${beforeStale} after:${afterStale}`,
  );

  // The steps above only mean anything if the harness found what it clicked and typed into.
  const realMisses = missed.filter((m) => !EXPECTED_MISSES.some((e) => m.startsWith(e)));
  record(
    "(z) every control the harness reached for was on the page",
    realMisses.length === 0,
    realMisses.length ? realMisses.slice(0, 6).join("; ") : "nothing went missing",
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
