import { useEffect, useMemo, useState } from "react";
import type { Unclaimed } from "../../data/types";
import { contactFor, experienceById, fromPrice, getCatalog } from "../../lib/catalog";
import { money } from "../../lib/format";
import { claimedIds, defaultProfile, demoProfile, loadProfile, sampleBookings, saveProfile, type OperatorProfile } from "../../lib/operator";
import { searchListings } from "../../lib/search";
import { Photo } from "../art/Photo";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";
import { useApp } from "../../state/AppProvider";
import { OD_ICONS } from "./opContext";
import { claimRemote, fetchRemoteProfile, hasApi, rememberClaimToken, requestSignInCode, verifySignInCode } from "../../lib/api";

/**
 * Claim and sign in. A claim link (#claim=<id>) lands here with the business already picked.
 * The verification code is shown on screen because nothing is sent yet: no SMS, no email.
 */

type Step = "pick" | "details" | "code";

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
        const p = defaultProfile(u, { name: remote?.owner?.name || "", email: remote?.owner?.email || contactFor(u)?.email || "", phone: remote?.owner?.phone || "" });
        if (!hasApi()) p.bookings = sampleBookings(p);
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

  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    return searchListings(getCatalog(), q).slice(0, 8);
  }, [q]);

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

  const finish = () => {
    if (mode === "signin") { void finishSignIn(); return; }
    if (!picked) return;
    if (hasApi()) {
      // Claims without the email link need the emailed code, which only exists for already-claimed listings.
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
    if (!hasApi()) p.bookings = sampleBookings(p);
    saveProfile(p);
    onEnter(p);
  };

  const demo = () => {
    const p = demoProfile();
    if (p) onEnter(p);
  };

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
                    <button type="button" key={u.id} className="odresult" onClick={() => { setPicked(u); setStep("details"); }}>
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
            ) : q.trim().length >= 2 ? (
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
            <button type="button" className="cta odwide" disabled={!signinEmail.includes("@") || sending || !hasApi()} onClick={() => { setMode("signin"); void startSignIn(); }}>{sending ? "Sending…" : "Email me a sign-in code"}</button>
            {!hasApi() ? <p className="odfine">Sign-in codes switch on once the API is connected.</p> : null}
            <div className="odor"><span>or</span></div>
            <button type="button" className="cta ghost odwide" onClick={demo}>See the demo dashboard</button>
          </>
        ) : null}

        {step === "details" && picked ? (
          <>
            <button type="button" className="odlink" onClick={() => { setStep("pick"); setErr(null); }}><Markup html={OD_ICONS.back} /> Different business</button>
            <div className="odclaimhead">
              <span className="odthumb big"><Photo src={picked.cover} kind={picked.art} id={"c" + picked.id} alt="" /></span>
              <span className="meta">
                <small>Claiming</small>
                <b>{picked.title}</b>
                <small>{picked.area}</small>
              </span>
            </div>
            {linkState === "checking" ? <p className="odmuted">Opening your dashboard…</p> : null}
            {linkState === "bad" ? <p className="oderr">That claim link didn't check out. Use the link from your email, or sign in below.</p> : null}
            <h2>Who's the owner?</h2>
            <p className="odmuted">We'll send booking alerts here. Nothing goes out until you confirm.</p>
            <label className="odfield"><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></label>
            <label className="odfield"><span>Work email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" /></label>
            <label className="odfield"><span>Mobile for text alerts</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" /></label>
            {hasApi() ? (
              <p className="odmuted">To claim this listing, use the link in the email we sent to the address on its website. It opens your dashboard with no code. Did not get one? Write to harshils2340@gmail.com and we will resend it.</p>
            ) : (
              <button type="button" className="cta odwide" disabled={!name.trim() || !email.trim()} onClick={() => { setMode("claim"); setStep("code"); setErr(null); }}>Send verification code</button>
            )}
            <p className="odfine">By continuing you confirm you're authorised to manage this business on Outset.</p>
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
