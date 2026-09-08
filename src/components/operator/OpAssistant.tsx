import { useMemo, useState } from "react";
import { contactFor, fmtHours, listingFacts } from "../../lib/catalog";
import { ASSISTANT_NAME, companyGreeting, companyReply, companySuggestions } from "../../lib/companyAgent";
import { fmtTime, money } from "../../lib/format";
import { DAY_SHORT } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";

/**
 * The assistant page: what Otto knows, what it refuses, and a test chat that runs the same code guests get.
 * Otto only answers from this operator's published facts, so the fix for a wrong answer is editing the listing.
 */
export function OpAssistant() {
  const { p, u, set, go } = useOp();
  const ctx = useMemo(() => ({ item: u, contact: contactFor(u) }), [u]);
  const [msgs, setMsgs] = useState<{ who: "me" | "them"; t: string }[]>(() => [{ who: "them", t: companyGreeting(ctx) }]);
  const [text, setText] = useState("");
  const facts = useMemo(() => listingFacts(u), [u]);
  const suggestions = useMemo(() => companySuggestions(ctx), [ctx]);

  const send = (q: string) => {
    const t = q.trim();
    if (!t) return;
    setMsgs((cur) => [...cur, { who: "me", t }, { who: "them", t: companyReply(ctx, t) }]);
    setText("");
  };

  const priced = p.services.filter((s) => s.live).flatMap((s) => s.variants.map((v) => ({ s, v })));

  return (
    <div className="odpage">
      <div className="odrow odpublish">
        <span className="meta">
          <b><Markup html={OD_ICONS.spark} /> {ASSISTANT_NAME} answers guests on your listing, day and night</b>
          <small>Prices, hours, what's included, age rules, how to reach you. Nothing you haven't published. Anything else, it hands to you.</small>
        </span>
        <button type="button" className={"optoggle" + (p.assistant ? " on" : "")} onClick={() => set({ assistant: !p.assistant })} aria-pressed={p.assistant}>
          <span className="knob" />
          <span className="lbl">{p.assistant ? "On" : "Off"}</span>
        </button>
      </div>

      <div className="odcols">
        <div className="odstack">
          <section className="odcard">
            <div className="odcardhead"><h3>What it knows</h3><button type="button" className="odlink" onClick={() => go("listing")}>Edit listing <Markup html={OD_ICONS.chev} /></button></div>
            <div className="odkb">
              <div>
                <small>Prices</small>
                {priced.length ? priced.slice(0, 6).map(({ s, v }) => <span key={v.id}>{s.name} · {v.label}: {v.price != null ? money(v.price) + " / " + v.per : "not set"}</span>) : <span className="odmuted">No live services yet.</span>}
                {priced.length > 6 ? <span className="odmuted">and {priced.length - 6} more</span> : null}
              </div>
              <div>
                <small>Hours</small>
                {p.hours.map((h, i) => <span key={i}>{DAY_SHORT[i]}: {h.closed ? "Closed" : fmtTime(h.open) + " to " + fmtTime(h.close)}</span>)}
                {ctx.contact?.hours.length ? ctx.contact.hours.slice(0, 2).map((l, i) => <span key={"c" + i} className="odmuted">Site says: {fmtHours(l)}</span>) : null}
              </div>
              <div>
                <small>Contact</small>
                <span>{p.phone || "No phone"}</span>
                <span>{p.address || "No address"}</span>
              </div>
              <div>
                <small>Rules and policies</small>
                {p.policy.map((l, i) => <span key={i}>{l}</span>)}
                {facts.who.map((f, i) => <span key={"w" + i}>{f.text}</span>)}
                {facts.waiver.map((f, i) => <span key={"v" + i}>{f.text}</span>)}
                {!p.policy.length && !facts.who.length && !facts.waiver.length ? <span className="odmuted">Nothing yet. Add a cancellation line under Listing.</span> : null}
              </div>
            </div>
          </section>
          <section className="odcard">
            <div className="odcardhead"><h3>What it won't do</h3></div>
            <ul className="odrules">
              <li>Guess a price, a policy or an open time you haven't set.</li>
              <li>Talk about weather, directions, reviews or other businesses.</li>
              <li>Promise anything on your behalf. It says it'll have you confirm.</li>
            </ul>
          </section>
        </div>

        <section className="odcard odchat">
          <div className="odcardhead"><h3>Try it</h3><small className="odmuted">Same answers guests get</small></div>
          <div className="odchatlog">
            {msgs.map((m, i) => <div key={i} className={"odmsg " + m.who}>{m.t}</div>)}
          </div>
          <div className="odchips">
            {suggestions.map((s) => <button type="button" key={s} onClick={() => send(s)}>{s}</button>)}
          </div>
          <form className="odchatin" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={"Ask " + ASSISTANT_NAME + " what a guest would"} />
            <button type="submit" className="cta small" disabled={!text.trim()}>Send</button>
          </form>
        </section>
      </div>
    </div>
  );
}
