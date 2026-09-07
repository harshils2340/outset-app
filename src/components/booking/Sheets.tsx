import { useState } from "react";
import { fmtDate, fmtTime, money, unitLine } from "../../lib/format";
import { priceFor } from "../../lib/pricing";
import { useApp } from "../../state/AppProvider";

export function Sheets() {
  const { state, listing, reqTarget, dates, closeSheet, confirm, sendRequest } = useApp();
  const on = state.sheet !== null;

  return (
    <>
      <div className={"scrim" + (on ? " on" : "")} onClick={closeSheet} />
      <div className={"sheet" + (on ? " on" : "")}>
        <div className="grabber" />
        <div className="sheetbody">
          {state.sheet === "review" && listing && state.slot ? (
            <ReviewBody
              listing={listing}
              date={dates[state.dateIdx]}
              slot={state.slot}
              qty={state.qty}
              addons={state.addons}
              onBack={closeSheet}
              onConfirm={confirm}
            />
          ) : null}
          {state.sheet === "request" && reqTarget ? (
            <RequestBody
              title={reqTarget.title}
              area={reqTarget.area}
              onBack={closeSheet}
              onSend={(note) => sendRequest(note)}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function ReviewBody({
  listing,
  date,
  slot,
  qty,
  addons,
  onBack,
  onConfirm,
}: {
  listing: NonNullable<ReturnType<typeof useApp>["listing"]>;
  date: Date;
  slot: string;
  qty: number;
  addons: string[];
  onBack: () => void;
  onConfirm: () => void;
}) {
  const p = priceFor(listing, qty, addons);
  return (
    <>
      <p className="eyebrow">Confirm and pay</p>
      <h3>{listing.title}</h3>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "6px 0 0" }}>
        {fmtDate(date)} · {fmtTime(slot)} · {qty} {listing.qtyUnit}
        {qty > 1 ? "s" : ""}
      </p>
      <div className="lines">
        <div className="line">
          <span>{unitLine(listing, qty)}</span>
          <b>{money(p.base)}</b>
        </div>
        {p.add ? (
          <div className="line">
            <span>Add-ons</span>
            <b>{money(p.add)}</b>
          </div>
        ) : null}
        <div className="line">
          <span>Service fee</span>
          <b>{money(p.fee)}</b>
        </div>
        <div className="line total">
          <span>Total</span>
          <b>{money(p.total)}</b>
        </div>
      </div>
      <div className="acctcard" style={{ marginTop: 6 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span
            className="avatar"
            style={{ borderRadius: 7, width: 40, height: 26, fontSize: 10, letterSpacing: ".04em" }}
          >
            VISA
          </span>
          <span style={{ flex: 1 }}>
            <b style={{ fontSize: 13.5, display: "block" }}>Visa ···· 4291</b>
            <small style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
              Charged when the operator confirms, usually instantly
            </small>
          </span>
        </div>
      </div>
      <p className="note" style={{ textAlign: "left", padding: "12px 0 0" }}>
        Cancellation follows {listing.op}&apos;s policy above. A deposit or security hold may apply at check-in.
      </p>
      <div className="dock" style={{ position: "static", background: "none", padding: "14px 0 20px" }}>
        <button className="cta ghost" onClick={onBack}>
          Back
        </button>
        <button className="cta" onClick={onConfirm}>
          Confirm {money(p.total)}
        </button>
      </div>
    </>
  );
}

function RequestBody({
  title,
  area,
  onBack,
  onSend,
}: {
  title: string;
  area: string;
  onBack: () => void;
  onSend: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <>
      <p className="eyebrow">Not yet on Outset</p>
      <h3>{title}</h3>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "6px 0 0" }}>
        {area}. We don&apos;t have their real calendar yet. Tell us what you&apos;re after and we&apos;ll text them
        directly.
      </p>
      <div style={{ marginTop: 16 }}>
        <p className="eyebrow" style={{ marginBottom: 6 }}>
          What are you looking for
        </p>
        <textarea
          id="reqtext"
          rows={3}
          placeholder="e.g. 2 people, this Saturday afternoon"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{
            width: "100%",
            resize: "none",
            border: "1px solid var(--line-strong)",
            borderRadius: 12,
            background: "var(--surface-2)",
            padding: "11px 13px",
            fontSize: 13.5,
            fontFamily: "inherit",
            outline: "none",
          }}
        />
      </div>
      <p className="note" style={{ textAlign: "left", padding: "12px 0 0" }}>
        If they confirm, this becomes a real listing with real availability. That is how every business gets on Outset.
      </p>
      <div className="dock" style={{ position: "static", background: "none", padding: "14px 0 20px" }}>
        <button className="cta ghost" onClick={onBack}>
          Back
        </button>
        <button className="cta" onClick={() => onSend(note)}>
          Send request
        </button>
      </div>
    </>
  );
}
