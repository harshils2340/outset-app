import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Unclaimed } from "../../data/types";
import { contactFor, experienceById, fromPrice, getCatalog } from "../../lib/catalog";
import { money } from "../../lib/format";
import { claimedIds, defaultProfile, demoProfile, loadProfile, sampleBookings, saveProfile, type OperatorProfile } from "../../lib/operator";
import { searchByName } from "../../lib/search";
import { Photo } from "../art/Photo";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";
import { useApp } from "../../state/AppProvider";
import { OD_ICONS } from "./opContext";
import { claimRemote, fetchClaimRule, fetchRemoteProfile, hasApi, ownerFromHash, rememberClaimToken, requestClaimLink, requestSignInCode, verifySignInCode, type ClaimRule } from "../../lib/api";

/**
 * Claim and sign in. The owner searches by name, says who they are, and the signed claim link goes to the
 * address on the business's own website (or one at its domain). The API checks the address against what the
 * crawl found, so nobody else can claim the listing. The link (#claim=<id>&k=<token>) lands back here with the
 * business already picked and opens the dashboard with no code. With no API the demo code is shown on screen.
 */

type Step = "pick" | "details" | "code" | "sent";
const SUPPORT = "harshils2340@gmail.com";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function OpLogin({ claimId, claimToken, compact, onEnter, onBack }: { claimId: string | null; claimToken?: string | null; compact: boolean; onEnter: (p: OperatorProfile) => void; onBack: () => void }) {
  const { state: app } = useApp();
  // The claim link opens this screen before the catalog has loaded. Resolve the business again when it lands.
  const preset = useMemo(() => (claimId ? experienceById(claimId) : null), [claimId, app.catalogVersion]);
  const [picked, setPicked] = useState<Unclaimed | null>(preset);
  const [step, setStep] = useState<Step>(preset ? "details" : "pick");
  useEffect(() => {
    if (preset && !picked) {
      setPicked(preset);
      setStep("details");
    }
  }, [preset]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<"idle" | "checking" | "bad">(claimToken && claimId ? "checking" : "idle");
  const isApi = hasApi();

  // A signed claim link opens the dashboard directly. The listing file carries a hash of the emailed token;
  // the detail file can arrive a moment after the page, so keep checking for a few seconds.
  useEffect(() => {
    if (!claimToken || !claimId) return;
    let alive = true;
    let tries = 0;
    const tick = async () => {
      const u = experienceById(claimId);
      if (u?.claimKey) {
        const ok = (await sha256Hex(claimToken)) === u.claimKey;
        if (!alive) return;
        if (!ok) { setLinkState("bad"); return; }
        rememberClaimToken(u.id, claimToken);
        const existing = loadProfile(u.id);
        if (existing) { onEnter(existing); return; }
        // Another device may already hold this operator's edits.
        const remote = await fetchRemoteProfile(u.id);
        if (!alive) return;
        const saved = remote?.profile as OperatorProfile | undefined;
        if (saved && saved.v === 1 && saved.id === u.id) { saveProfile(saved); onEnter(saved); return; }
        // The name, email and phone typed on the claim screen ride along in the link, so any device gets them.
        const fromLink = ownerFromHash(window.location.hash);
        const p = defaultProfile(u, {
          name: remote?.owner?.name || fromLink?.name || "",
          email: remote?.owner?.email || fromLink?.email || contactFor(u)?.email || "",
          phone: remote?.owner?.phone || fromLink?.phone || "",
        });
        if (!isApi) p.bookings = sampleBookings(p);
        saveProfile(p);
        void claimRemote(u.id, claimToken, { name: p.ownerName, email: p.ownerEmail, phone: p.ownerPhone });
        onEnter(p);
        return;
      }
      if (++tries < 24 && alive) setTimeout(tick, 500);
      else if (alive) setLinkState("bad");
    };
    tick();
    return () => { alive = false; };
  }, [claimToken, claimId]);
  const mine = useMemo(() => Array.from(new Set(claimedIds())).map((id) => ({ id, p: loadProfile(id), u: experienceById(id) })).filter((x) => x.p && x.u && !(x.p.ownerEmail === "owner@example.com" && x.p.ownerName === "Demo owner")), []);
  const demoCode = useMemo(() => String(100000 + Math.floor(Math.random() * 900000)), []);
  const [sending, setSending] = useState(false);
  const [signinEmail, setSigninEmail] = useState("");
  const [mode, setMode] = useState<"claim" | "signin">("claim");
  const [sentOk, setSentOk] = useState(true);

  // Typing stays smooth: the list is computed from a query that may lag a keystroke behind when the thread is busy.
  const dq = useDeferredValue(q);
  const results = useMemo(() => (dq.trim().length < 2 ? [] : searchByName(getCatalog(), dq, 8)), [dq, app.catalogVersion]);

  // The claim token, the listing's claimKey and the API's claim rules are keyed by the crawled record's id.
  // A hand-verified seed keeps its own id and points at that record through `detail`.
  const claimTarget = picked ? picked.detail || picked.id : null;
  const [rule, setRule] = useState<ClaimRule | null>(null);
  useEffect(() => {
    setRule(null);
    if (!claimTarget || !isApi) return;
    let alive = true;
    void fetchClaimRule(claimTarget).then((r) => { if (alive) setRule(r); });
    return () => { alive = false; };
  }, [claimTarget]);

  const enterExisting = (id: string) => {
    const p = loadProfile(id);
    if (p) onEnter(p);
  };

  /** Returning operator: a code goes to the email that claimed the listing. */
  const startSignIn = async () => {
    setSending(true);
    setErr(null);
    const r = await requestSignInCode(signinEmail);
    setSending(false);
    if (!r.ok) { setErr(r.error || "Could not send a code. Try again."); return; }
    setStep("code");
  };

  const finishSignIn = async () => {
    setErr(null);
    const r = await verifySignInCode(signinEmail, code);
    if (!r.ok) { setErr(r.error || "That code does not match."); return; }
    if (!r.ids.length) { setErr("No listing is linked to that email yet. Use the claim link from your email."); return; }
    // Open the first listing this email owns; the profile comes from the API if this device has none.
    const id = r.ids[0];
    const existing = loadProfile(id);
    if (existing) { onEnter(existing); return; }
    const remote = await fetchRemoteProfile(id);
    const saved = remote?.profile as OperatorProfile | undefined;
    const u = experienceById(id);
    if (saved && saved.v === 1) { saveProfile(saved); onEnter(saved); return; }
    if (!u) { setErr("That listing is not loaded yet. Try again in a moment."); return; }
    const p = defaultProfile(u, { name: remote?.owner?.name || "", email: signinEmail, phone: remote?.owner?.phone || "" });
    saveProfile(p);
    onEnter(p);
  };

  /** New claim: the API emails the signed link, but only to an address it can tie to this business. */
  const requestLink = async () => {
    if (!claimTarget) return;
    setMode("claim");
    setSending(true);
    setErr(null);
    const r = await requestClaimLink(claimTarget, { name: name.trim(), email: email.trim(), phone: phone.trim() });
    setSending(false);
    if (r.ok) {
      setSentOk(r.sent);
      setStep("sent");
      return;
    }
    const at = r.domains?.length ? r.domains[0] : null;
    if (r.reason === "mismatch") {
      setErr(`That's not the address on your website${r.hint ? " (" + r.hint + ")" : ""}${at ? ", and it's not at " + at : ""}. Use that one, or write to ${SUPPORT} from your business address and we'll verify by hand.`);
    } else if (r.reason === "none" || r.reason === "unknown") {
      setErr(`We can't verify this listing by email yet. Write to ${SUPPORT} from your business address and we'll set it up by hand.`);
    } else {
      setErr(r.error ? "Could not send the link: " + r.error : "Could not send the link. Try again in a moment.");
    }
  };

  const finish = () => {
    if (mode === "signin") { void finishSignIn(); return; }
    if (!picked) return;
    if (isApi) {
      // Claims go through the emailed link; codes are only for returning operators.
      setErr("Use the claim link we emailed you. It opens your dashboard with no code.");
      return;
    }
    if (code.replace(/\D/g, "") !== demoCode) {
      setErr("That code doesn't match. Use the one shown above.");
      return;
    }
    const existing = loadProfile(picked.id);
    if (existing) {
      onEnter(existing);
      return;
    }
    // The listing picked at mount may be the slim browse record; the full detail file has usually landed by now.
    const full = experienceById(picked.id) || picked;
    const p = defaultProfile(full, { name: name.trim(), email: email.trim(), phone: phone.trim() });
    if (!isApi) p.bookings = sampleBookings(p);
    saveProfile(p);
    onEnter(p);
  };

  const demo = () => {
    const p = demoProfile();
    if (p) onEnter(p);
  };

  // What the claim screen promises before the owner types, from what the crawl found on their site.
  const ruleLine = (() => {
    if (!rule) return "We'll email your claim link to the address on your website. That's how we know it's you.";
    const at = rule.domains.length ? rule.domains.join(" or ") : null;
    if (rule.hasEmail) return `We'll email your claim link to the address on your website, ${rule.hint}${at ? ", or any address at " + at : ""}. That's how we know it's you.`;
    if (at) return `We'll email your claim link to an address at ${at}. That's how we know it's you.`;
    return `We don't have an email from your website yet. Write to ${SUPPORT} from your business address and we'll verify by hand.`;
  })();
  const noWay = !!rule && !rule.hasEmail && !rule.domains.length;
  const canRequest = !!name.trim() && EMAIL.test(email.trim()) && !sending && !noWay;

  const head = picked ? (
    <div className="odclaimhead">
      <span className="odthumb big"><Photo src={picked.cover} kind={picked.art} id={"c" + picked.id} alt="" /></span>
      <span className="meta">
        <small>Claiming</small>
        <b>{picked.title}</b>
        <small>{picked.area}</small>
      </span>
    </div>
  ) : null;

  return (
    <div className={"odlogin" + (compact ? " compact" : "")}>
      <div className="odlogin-side">
        <button type="button" className="odlogin-brand" onClick={onBack}>
          <Mark size={30} />
          <b>Outset</b>
          <span>for operators</span>
        </button>
        <h1>Your bookings, the way they come in.</h1>
        <p>Guests pick a time on your listing and pay. You accept or decline here, keep a calendar, and fix your menu. We already filled it in from your website.</p>
        <ul className="odlogin-points">
          <li><Markup html={OD_ICONS.check} /> Requests land in one feed with Accept and Decline</li>
          <li><Markup html={OD_ICONS.check} /> A calendar that fills itself, plus time off in one tap</li>
          <li><Markup html={OD_ICONS.check} /> Your prices and photos, copied from your site, editable in seconds</li>
          <li><Markup html={OD_ICONS.check} /> A 24/7 assistant that answers guests from your info only</li>
        </ul>
        <button type="button" className="odlink" onClick={onBack}>Back to the guest site</button>
      </div>

      <div className="odlogin-card">
        {step === "pick" ? (
          <>
            <h2>Find your business</h2>
            <p className="odmuted">Search by name. If we already built your listing, you'll claim it in under a minute.</p>
            <label className="odsearch">
              <Markup html={OD_ICONS.search} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business name, like Tampa Bay Jet Ski" />
            </label>
            {results.length ? (
              <div className="odresults">
                {results.map((u) => {
                  const c = contactFor(u);
                  const from = fromPrice(u);
                  return (
                    <button type="button" key={u.id} className="odresult" onClick={() => { setPicked(u); setStep("details"); setErr(null); }}>
                      <span className="odthumb"><Photo src={u.cover} kind={u.art} id={"l" + u.id} alt="" /></span>
                      <span className="meta">
                        <b>{u.title}</b>
                        <small>{c?.city ? [c.city, c.region].filter(Boolean).join(", ") : u.area}{from != null ? " · from " + money(from) : ""}</small>
                      </span>
                      <Markup html={OD_ICONS.chev} />
                    </button>
                  );
                })}
              </div>
            ) : q.trim().length >= 2 && dq === q ? (
              <p className="odmuted">No match yet. We add operators every day. Try another spelling or the name on your website.</p>
            ) : null}

            {mine.length ? (
              <div className="odmine">
                <h3>Signed in on this device</h3>
                {mine.map(({ id, u }) => (
                  <button type="button" key={id} className="odresult" onClick={() => enterExisting(id)}>
                    <span className="odthumb"><Photo src={u!.cover} kind={u!.art} id={"m" + id} alt="" /></span>
                    <span className="meta">
                      <b>{loadProfile(id)?.title || u!.title}</b>
                      <small>Open dashboard</small>
                    </span>
                    <Markup html={OD_ICONS.chev} />
                  </button>
                ))}
              </div>
            ) : null}

            <div className="odor"><span>already claimed?</span></div>
            <label className="odfield"><span>Sign in with the email on your listing</span><input type="email" value={signinEmail} onChange={(e) => setSigninEmail(e.target.value)} placeholder="you@business.com" onKeyDown={(e) => e.key === "Enter" && signinEmail.includes("@") && (setMode("signin"), void startSignIn())} /></label>
            {err && mode === "signin" ? <p className="oderr">{err}</p> : null}
            <button type="button" className="cta odwide" disabled={!signinEmail.includes("@") || sending || !isApi} onClick={() => { setMode("signin"); void startSignIn(); }}>{sending ? "Sending…" : "Email me a sign-in code"}</button>
            {!isApi ? <p className="odfine">Sign-in codes switch on once the API is connected.</p> : null}
            <div className="odor"><span>or</span></div>
            <button type="button" className="cta ghost odwide" onClick={demo}>See the demo dashboard</button>
          </>
        ) : null}

        {step === "details" && picked ? (
          <>
            <button type="button" className="odlink" onClick={() => { setStep("pick"); setErr(null); }}><Markup html={OD_ICONS.back} /> Different business</button>
            {head}
            {linkState === "checking" ? <p className="odmuted">Opening your dashboard…</p> : null}
            {linkState === "bad" ? <p className="oderr">That claim link didn't check out. Ask for a fresh one below, or sign in with your email.</p> : null}
            <h2>Who's the owner?</h2>
            <p className="odmuted">We'll send booking alerts here. Nothing goes out until you confirm.</p>
            <label className="odfield"><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></label>
            <label className="odfield"><span>Work email</span><input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(null); }} placeholder={rule?.domains.length ? "you@" + rule.domains[0] : "you@business.com"} onKeyDown={(e) => { if (e.key === "Enter" && isApi && canRequest) void requestLink(); }} /></label>
            <label className="odfield"><span>Mobile for text alerts</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" /></label>
            {isApi ? (
              <>
                <p className="odmuted">{ruleLine}</p>
                {err && mode === "claim" ? <p className="oderr">{err}</p> : null}
                <button type="button" className="cta odwide" disabled={!canRequest} onClick={() => void requestLink()}>{sending ? "Sending…" : "Email me my claim link"}</button>
              </>
            ) : (
              <button type="button" className="cta odwide" disabled={!name.trim() || !email.trim()} onClick={() => { setMode("claim"); setStep("code"); setErr(null); }}>Send verification code</button>
            )}
            <p className="odfine">By continuing you confirm you're authorised to manage this business on Outset.</p>
          </>
        ) : null}

        {step === "sent" && picked ? (
          <>
            <button type="button" className="odlink" onClick={() => { setStep("details"); setErr(null); }}><Markup html={OD_ICONS.back} /> Change the email</button>
            {head}
            <h2>Check your inbox</h2>
            {sentOk ? (
              <p className="odmuted">Your claim link is on its way to <b>{email.trim()}</b>. It opens your dashboard with no code. Give it a minute, and check spam if it's not there.</p>
            ) : (
              <p className="odmuted">Mail is not switched on for this API yet, so the link for <b>{email.trim()}</b> went to the server log instead of your inbox.</p>
            )}
            {err ? <p className="oderr">{err}</p> : null}
            <button type="button" className="cta ghost odwide" disabled={sending} onClick={() => void requestLink()}>{sending ? "Sending…" : "Send it again"}</button>
            <p className="odfine">Still nothing? Write to <a href={"mailto:" + SUPPORT}>{SUPPORT}</a> from your business address and we will sort it out by hand.</p>
          </>
        ) : null}

        {step === "code" && (picked || mode === "signin") ? (
          <>
            <button type="button" className="odlink" onClick={() => { setStep(mode === "signin" ? "pick" : "details"); setErr(null); }}><Markup html={OD_ICONS.back} /> Back</button>
            <h2>Enter the code</h2>
            {mode === "signin" ? (
              <p className="odmuted">We emailed a 6 digit code to {signinEmail}. It works for 10 minutes.</p>
            ) : (
              <>
                <p className="odmuted">Demo mode: the code would go to {phone.trim() || email.trim()}. Here it is:</p>
                <div className="oddemocode">{demoCode.slice(0, 3)} {demoCode.slice(3)}</div>
              </>
            )}
            <label className="odfield"><span>Verification code</span><input inputMode="numeric" autoFocus value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} placeholder="000 000" onKeyDown={(e) => e.key === "Enter" && finish()} /></label>
            {err ? <p className="oderr">{err}</p> : null}
            <button type="button" className="cta odwide" onClick={finish}>Open my dashboard</button>
          </>
        ) : null}
      </div>
    </div>
  );
}
