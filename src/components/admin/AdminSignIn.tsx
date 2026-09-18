import { useState } from "react";
import { requestSignInCode, verifySignInCode } from "../../lib/api";

/**
 * Sign-in for the private page. It is the operator sign-in's flow exactly: the API mails a six-digit code and
 * /auth/verify hands back a session, stored under the same key by verifySignInCode, so this browser stays
 * signed in for the session's thirty days and Harshil does not do this on every visit.
 *
 * The wording says nothing about metrics, admin or what is behind it. Somebody who guesses the URL sees a
 * sign-in box and learns nothing; without an admin session the metrics route answers 404 anyway.
 */
export function AdminSignIn({ onDone }: { onDone: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setErr(null);
    const r = await requestSignInCode(email.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not send a code. Try again."); return; }
    setStep("code");
  };

  const verify = async () => {
    setBusy(true);
    setErr(null);
    // An address with no claimed listing comes back with an empty `ids`, which is the normal case here: the
    // session is still real and signed, and that is all the metrics route checks. The operator screen treats
    // an empty list as a failure; this one must not.
    const r = await verifySignInCode(email.trim(), code.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.error || "That code does not match."); return; }
    onDone(email.trim().toLowerCase());
  };

  return (
    <div className="adgate">
      <form
        className="adgate-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          void (step === "email" ? send() : verify());
        }}
      >
        <h1>Sign in</h1>
        {step === "email" ? (
          <>
            <label htmlFor="adm-email">Email</label>
            <input id="adm-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
            <button type="submit" className="adbtn adbtn-go" disabled={busy || !email.trim()}>{busy ? "Sending…" : "Email me a code"}</button>
          </>
        ) : (
          <>
            <label htmlFor="adm-code">Six-digit code</label>
            <input id="adm-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" required />
            <button type="submit" className="adbtn adbtn-go" disabled={busy || code.trim().length < 6}>{busy ? "Checking…" : "Sign in"}</button>
            <button type="button" className="adbtn adbtn-plain" onClick={() => { setStep("email"); setCode(""); setErr(null); }}>Use a different address</button>
          </>
        )}
        {err ? <p className="aderr" role="alert">{err}</p> : null}
      </form>
    </div>
  );
}
