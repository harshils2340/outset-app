import { useEffect, useMemo, useState } from "react";
import type { Unclaimed } from "../../data/types";
import { contactFor, experienceById, fromPrice, getCatalog } from "../../lib/catalog";
import { money } from "../../lib/format";
import { claimedIds, defaultProfile, demoProfile, loadProfile, sampleBookings, saveProfile, type OperatorProfile } from "../../lib/operator";
import { searchListings } from "../../lib/search";
import { Photo } from "../art/Photo";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";
import { OD_ICONS } from "./opContext";

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
  const preset = useMemo(() => (claimId ? experienceById(claimId) : null), [claimId]);
  const [picked, setPicked] = useState<Unclaimed | null>(preset);
  const [step, setStep] = useState<Step>(preset ? "details" : "pick");
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
        const existing = loadProfile(u.id);
        if (existing) { onEnter(existing); return; }
        const p = defaultProfile(u, { name: "", email: contactFor(u)?.email || "", phone: "" });
        p.bookings = sampleBookings(p);
        saveProfile(p);
        onEnter(p);
        return;
      }
      if (++tries < 24 && alive) setTimeout(tick, 500);
      else if (alive) setLinkState("bad");
    };
    tick();
    return () => { alive = false; };
  }, [claimToken, claimId]);
  const mine = useMemo(() => claimedIds().map((id) => ({ id, p: loadProfile(id), u: experienceById(id) })).filter((x) => x.p && x.u), []);
  const demoCode = useMemo(() => String(100000 + Math.floor(Math.random() * 900000)), []);

  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    return searchListings(getCatalog(), q).slice(0, 8);
  }, [q]);

  const enterExisting = (id: string) => {
    const p = loadProfile(id);
    if (p) onEnter(p);
  };

  const finish = () => {
    if (!picked) return;
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
    p.bookings = sampleBookings(p);
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

            <div className="odor"><span>or</span></div>
            <button type="button" className="cta ghost odwide" onClick={demo}>Back to the demo dashboard</button>
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
            <button type="button" className="cta odwide" disabled={!name.trim() || !email.trim()} onClick={() => { setStep("code"); setErr(null); }}>Send verification code</button>
            <p className="odfine">By continuing you confirm you're authorised to manage this business on Outset.</p>
          </>
        ) : null}

        {step === "code" && picked ? (
          <>
            <button type="button" className="odlink" onClick={() => { setStep("details"); setErr(null); }}><Markup html={OD_ICONS.back} /> Back</button>
            <h2>Enter the code</h2>
            <p className="odmuted">We'd text {phone.trim() || email.trim()} a 6 digit code. Texting isn't switched on yet, so here it is:</p>
            <div className="oddemocode">{demoCode.slice(0, 3)} {demoCode.slice(3)}</div>
            <label className="odfield"><span>Verification code</span><input inputMode="numeric" autoFocus value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} placeholder="000 000" onKeyDown={(e) => e.key === "Enter" && finish()} /></label>
            {err ? <p className="oderr">{err}</p> : null}
            <button type="button" className="cta odwide" onClick={finish}>Open my dashboard</button>
          </>
        ) : null}
      </div>
    </div>
  );
}
