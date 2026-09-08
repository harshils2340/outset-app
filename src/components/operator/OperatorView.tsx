import { useMemo, useState } from "react";
import { ICONS } from "../../data/icons";
import type { Unclaimed, UnclaimedService } from "../../data/types";
import { getCatalog, plainWords } from "../../lib/catalog";
import { fmtDate, fmtTime, money } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

/**
 * Operator side. The shape is the Uber Eats merchant app and Booksy: a switch for accepting bookings,
 * a feed of incoming requests with Accept and Decline, today's schedule, and a menu editor.
 * Demo-grade on purpose: state lives in this screen, nothing is sent anywhere yet.
 */

type Req = {
  id: string;
  guest: string;
  service: string;
  variant: string;
  price: number | null;
  qty: number;
  date: Date;
  slot: string;
  status: "new" | "accepted" | "declined";
  note?: string;
};

const NAMES = ["Maya R.", "Jordan P.", "Alex T.", "Sam K.", "Priya N.", "Chris D.", "Taylor M.", "Dev S."];
const NOTES = ["First time, a little nervous.", "Birthday trip for my brother.", "Can we start earlier if there's space?", "", "Two kids, ages 9 and 12.", ""];

function pickOperator(): Unclaimed | null {
  const all = getCatalog();
  const scored = all
    .filter((u) => u.services && u.services.length >= 2)
    .map((u) => ({ u, s: (u.cover ? 2 : 0) + (u.metroId === "tampa" ? 3 : 0) + (u.services?.length || 0) + Math.min(3, Math.log10((u.reviews || 0) + 1)) }))
    .sort((a, b) => b.s - a.s);
  return scored[0]?.u || all[0] || null;
}

function sampleRequests(op: Unclaimed, dates: Date[]): Req[] {
  const svcs = op.services || [];
  const out: Req[] = [];
  const slots = ["09:00", "11:00", "13:00", "15:00", "17:00"];
  let k = 0;
  for (const s of svcs.slice(0, 4)) {
    for (const v of s.variants.slice(0, k % 2 === 0 ? 2 : 1)) {
      out.push({
        id: "r" + k,
        guest: NAMES[k % NAMES.length],
        service: s.name,
        variant: v.label,
        price: v.price,
        qty: 1 + (k % 3),
        date: dates[k % 3],
        slot: slots[k % slots.length],
        status: k < 3 ? "new" : "accepted",
        note: NOTES[k % NOTES.length],
      });
      k += 1;
    }
  }
  return out;
}

export function OperatorView() {
  const { state, back, dates, openRequest } = useApp();
  const op = useMemo(() => pickOperator(), [state.catalogVersion]);
  const [online, setOnline] = useState(true);
  const [tab, setTab] = useState<"requests" | "today" | "menu">("requests");
  const [reqs, setReqs] = useState<Req[]>(() => (op ? sampleRequests(op, dates) : []));
  const [menu, setMenu] = useState<UnclaimedService[]>(() => (op?.services || []).map((s) => ({ ...s, variants: s.variants.map((v) => ({ ...v })) })));
  const [off, setOff] = useState<Set<string>>(new Set());
  if (!op) return null;

  const fresh = reqs.filter((r) => r.status === "new");
  const today = reqs.filter((r) => r.status === "accepted").sort((a, b) => a.date.getTime() - b.date.getTime() || a.slot.localeCompare(b.slot));
  const setStatus = (id: string, status: Req["status"]) => setReqs((cur) => cur.map((r) => (r.id === id ? { ...r, status } : r)));
  const revenue = today.reduce((n, r) => n + (r.price || 0) * r.qty, 0);

  return (
    <>
      <div className="ophead">
        <button onClick={back} style={{ color: "var(--ink-soft)" }}>
          <Markup html={ICONS.back} />
        </button>
        <span className="meta">
          <b>{op.title}</b>
          <small>{op.area}</small>
        </span>
        <button type="button" className={"optoggle" + (online ? " on" : "")} onClick={() => setOnline((v) => !v)} aria-pressed={online}>
          <span className="knob" />
          <span className="lbl">{online ? "Accepting" : "Paused"}</span>
        </button>
      </div>

      <div className="opstats">
        <div>
          <b>{fresh.length}</b>
          <small>New requests</small>
        </div>
        <div>
          <b>{today.length}</b>
          <small>Booked</small>
        </div>
        <div>
          <b>{money(revenue)}</b>
          <small>On the books</small>
        </div>
      </div>

      <div className="optabs">
        {(["requests", "today", "menu"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === "requests" ? "Requests" : t === "today" ? "Schedule" : "Menu"}
            {t === "requests" && fresh.length ? <em>{fresh.length}</em> : null}
          </button>
        ))}
      </div>

      {tab === "requests" ? (
        <div className="oplist">
          {!online ? <p className="opnote">You're paused. Guests see your listing but can't request a time until you switch back on.</p> : null}
          {fresh.length === 0 ? <p className="opnote">No new requests. New ones show up here the moment a guest taps Book.</p> : null}
          {fresh.map((r) => (
            <div className="opreq" key={r.id}>
              <div className="oprow">
                <span className="avatar">{r.guest.slice(0, 1)}</span>
                <span className="meta">
                  <b>{r.guest}</b>
                  <small>
                    {fmtDate(r.date)} · {fmtTime(r.slot)} · {r.qty} {r.qty === 1 ? "guest" : "guests"}
                  </small>
                </span>
                <span className="mono opprice">{r.price != null ? money(r.price * r.qty) : "Quote"}</span>
              </div>
              <p className="opsvc">
                {plainWords(r.service)} · {plainWords(r.variant)}
              </p>
              {r.note ? <p className="opguestnote">“{r.note}”</p> : null}
              <div className="opactions">
                <button type="button" className="cta ghost" onClick={() => setStatus(r.id, "declined")}>
                  Decline
                </button>
                <button type="button" className="cta" onClick={() => setStatus(r.id, "accepted")}>
                  Accept
                </button>
              </div>
            </div>
          ))}
          {reqs.some((r) => r.status === "declined") ? (
            <p className="opnote">Declined requests get an automatic message offering the next open time.</p>
          ) : null}
        </div>
      ) : null}

      {tab === "today" ? (
        <div className="oplist">
          {today.length === 0 ? <p className="opnote">Nothing booked yet. Accept a request and it lands here.</p> : null}
          {today.map((r, i) => {
            const newDay = i === 0 || today[i - 1].date.getDate() !== r.date.getDate();
            return (
              <div key={r.id}>
                {newDay ? <p className="opday">{fmtDate(r.date)}</p> : null}
                <div className="opslot">
                  <b className="mono">{fmtTime(r.slot)}</b>
                  <span className="meta">
                    <b>{r.guest} · {r.qty} {r.qty === 1 ? "guest" : "guests"}</b>
                    <small>{plainWords(r.service)} · {plainWords(r.variant)}</small>
                  </span>
                  <span className="mono opprice">{r.price != null ? money(r.price * r.qty) : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {tab === "menu" ? (
        <div className="oplist">
          <p className="opnote">This is what guests see. We copied it from your website. Fix a price here and it updates on your listing.</p>
          {menu.map((s, si) => (
            <div className="opmenu" key={s.name}>
              <div className="rowbetween">
                <b>{plainWords(s.name)}</b>
                <button type="button" className={"opavail" + (off.has(s.name) ? " off" : "")} onClick={() => setOff((cur) => { const n = new Set(cur); n.has(s.name) ? n.delete(s.name) : n.add(s.name); return n; })}>
                  {off.has(s.name) ? "Hidden" : "Live"}
                </button>
              </div>
              {s.desc ? <p className="opdesc">{plainWords(s.desc).slice(0, 140)}{s.desc.length > 140 ? "…" : ""}</p> : null}
              {s.variants.map((v, vi) => (
                <div className="opvar" key={v.optionIdx}>
                  <span>{plainWords(v.label)}</span>
                  <label className="opinput">
                    <span>$</span>
                    <input
                      type="number"
                      value={v.price ?? ""}
                      placeholder="Set"
                      onChange={(e) =>
                        setMenu((cur) =>
                          cur.map((m, i) => (i !== si ? m : { ...m, variants: m.variants.map((x, j) => (j !== vi ? x : { ...x, price: e.target.value === "" ? null : Number(e.target.value) })) })),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          ))}
          {op.addons?.length ? (
            <div className="opmenu">
              <b>Add-ons</b>
              {op.addons.map((a) => (
                <div className="opvar" key={a.name}>
                  <span>{a.name}</span>
                  <span className="mono">{a.price ? money(a.price) : "Free"}</span>
                </div>
              ))}
            </div>
          ) : null}
          <button type="button" className="cta ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => openRequest(op.id)}>
            Preview my listing
          </button>
        </div>
      ) : null}
      <div className="spacer" />
    </>
  );
}
