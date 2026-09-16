import { useEffect, useRef, useState } from "react";
import { money } from "../../lib/format";
import {
  DURATION_PRESETS,
  MAX_CAPACITY,
  MAX_DURATION,
  MIN_DURATION,
  PER_UNITS,
  cleanCount,
  cleanPrice,
  duplicateServiceName,
  durationLabel,
  isPriced,
  liveVariants,
  perUnitLooksPerGuest,
  uid,
  upcomingBookingsFor,
  type OpAddon,
  type OpService,
  type OpVariant,
} from "../../lib/operator";
import { Photo } from "../art/Photo";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";
import { useReorder } from "./useReorder";

/** Text limits. Long enough for any real menu, short enough that a pasted web page cannot become a name. */
const NAME_MAX = 80;
const DESC_MAX = 1000;
const LABEL_MAX = 60;
const UNIT_MAX = 24;
const DETAIL_MAX = 120;

/**
 * A number box that takes only a number. A `type="number"` input let the browser decide: "-20" was saved as a
 * negative price, "1e12" as a trillion, a pasted "$45" or "45,000" was thrown away without a word, and
 * clearing the capacity box to type a new figure produced "112" because the empty box was reset to 1 before
 * the 12 arrived. This box keeps what is being typed as text, shows the operator the clean figure when they
 * leave it, and only ever hands the profile a clean value: the price parser strips the currency sign and
 * commas, drops a minus, rounds to cents and caps the amount; the count parser keeps whole numbers in range.
 */
function NumBox({ value, onCommit, parse, format = String, placeholder, ariaLabel, className, disabled }: {
  value: number | null;
  onCommit: (n: number | null) => void;
  parse: (raw: string) => number | null;
  /** How a clean value reads in the box once the operator leaves it: "95.50", not "95.5". */
  format?: (n: number) => string;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const shown = value == null ? "" : format(value);
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);
  // A change made elsewhere (a reload, an undo) shows up as long as the operator is not mid-keystroke.
  useEffect(() => {
    if (!focused) setDraft(shown);
  }, [shown, focused]);
  const commit = (raw: string) => {
    const n = parse(raw);
    if (n !== value) onCommit(n);
  };
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        // Keep the keystrokes so "5." can become "5.50"; the profile only ever gets the clean figure.
        const raw = e.target.value.slice(0, 14);
        setDraft(raw);
        commit(raw);
      }}
      onBlur={() => {
        setFocused(false);
        const n = parse(draft);
        setDraft(n == null ? "" : format(n));
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

const parsePrice = (raw: string) => cleanPrice(raw);
/** Cents read as cents: "95.50" in the box, the way the guest sees it, and whole dollars stay whole. */
const formatPrice = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const parseCapacity = (raw: string) => cleanCount(raw, 1, MAX_CAPACITY);
const parseMinutes = (raw: string) => cleanCount(raw, MIN_DURATION, MAX_DURATION);

/**
 * Menu editor. Uber Eats menu manager plus Booksy service list: every service has a description, a duration,
 * a capacity, a live switch and price options. Changes save on blur and show on the guest listing right away.
 */
/** Suggestions for the price unit. The box takes anything; these just save typing. */
function PerUnitSuggestions() {
  return <datalist id="odperunits">{PER_UNITS.map((u) => <option key={u} value={u} />)}</datalist>;
}

export function OpServices() {
  const { p, u, set, preview, toast, compact, jumpTo } = useOp();
  // The option a "set a price" jump should land on: the first one with no price, else the first option.
  const target = p.services.find((s) => s.variants.some((v) => v.price == null)) || p.services[0] || null;
  const targetVariant = target ? target.variants.find((v) => v.price == null) || target.variants[0] : null;
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (jumpTo && (jumpTo.field === "price" || jumpTo.field === "services") && target) setOpenId(target.id);
  }, [jumpTo?.n]);

  const patchService = (id: string, patch: Partial<OpService> | ((s: OpService) => OpService)) =>
    set((cur) => ({ ...cur, services: cur.services.map((s) => (s.id !== id ? s : typeof patch === "function" ? patch(s) : { ...s, ...patch })) }));

  const addService = () => {
    const s: OpService = { id: uid("s"), name: "New service", desc: "", live: false, durationMin: 60, capacity: 8, variants: [{ id: uid("v"), label: "Standard", price: null, per: "person", perGuest: true }] };
    set((cur) => ({ ...cur, services: [...cur.services, s] }));
    setOpenId(s.id);
  };
  // A deleted service can come back for a few seconds. Deleting is one click and used to be final: a slip
  // on the trash button took a service, its prices and its description off the guest page for good.
  const [removed, setRemoved] = useState<{ s: OpService; at: number } | null>(null);
  const undoTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);
  const removeService = (s: OpService) => {
    const upcoming = upcomingBookingsFor(p, s.name);
    if (upcoming.length && !window.confirm(`"${s.name || "This service"}" has ${upcoming.length} upcoming ${upcoming.length === 1 ? "booking" : "bookings"}. Those bookings stay, but guests can no longer book it. Delete it anyway?`)) return;
    const at = p.services.findIndex((x) => x.id === s.id);
    set((cur) => ({ ...cur, services: cur.services.filter((x) => x.id !== s.id) }));
    if (openId === s.id) setOpenId(null);
    setRemoved({ s, at });
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setRemoved(null), 8000);
  };
  const undoRemove = () => {
    if (!removed) return;
    const { s, at } = removed;
    set((cur) => {
      if (cur.services.some((x) => x.id === s.id)) return cur;
      const next = cur.services.slice();
      next.splice(Math.min(at, next.length), 0, s);
      return { ...cur, services: next };
    });
    setRemoved(null);
    window.clearTimeout(undoTimer.current);
    toast("Service restored");
  };
  const reorder = useReorder<OpService>({
    items: p.services,
    getId: (s) => s.id,
    getLabel: (s) => s.name || "Untitled service",
    onReorder: (next) => set((cur) => ({ ...cur, services: next })),
  });

  const patchAddon = (id: string, patch: Partial<OpAddon>) => set((cur) => ({ ...cur, addons: cur.addons.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const addonOrder = useReorder<OpAddon>({
    items: p.addons,
    getId: (a) => a.id,
    getLabel: (a) => a.name || "Untitled add-on",
    onReorder: (next) => set((cur) => ({ ...cur, addons: next })),
  });

  // The count on the menu is about the menu guests see: a service switched off is not a gap in it, and a zero
  // is not a price, because the money code reads a zero as none and tells the guest to pay on site.
  const unpriced = liveVariants(p).filter((v) => !isPriced(v)).length;

  return (
    <div className="odpage">
      <PerUnitSuggestions />
      <div className="odbar">
        <p className="odmuted">This is your menu as guests see it. We copied it from your website. {!p.services.length ? <b>Nothing to book yet. Add your first service.</b> : unpriced ? <b>{unpriced} {unpriced === 1 ? "option has" : "options have"} no price yet.</b> : "Every option has a price."}</p>
        <div className="odbtns">
          {compact ? <button type="button" className="odghost" onClick={preview}><Markup html={OD_ICONS.external} /> Preview listing</button> : null}
          <button type="button" className="cta small" onClick={addService}><Markup html={OD_ICONS.plus} /> Add service</button>
        </div>
      </div>

      <p className="odreorderhint">Drag a service by its handle to reorder it, or focus the handle and press Space, then the arrow keys.</p>
      <span role="status" aria-live="polite" className="odsr">{reorder.spoken}</span>
      {removed ? (
        <div className="odbanner soft odundo" role="status">
          <span>Removed <b>{removed.s.name || "Untitled service"}</b>.</span>
          <button type="button" className="odlink" onClick={undoRemove}>Undo</button>
        </div>
      ) : null}

      <div className="odsvclist" data-jump="services">
        {p.services.map((s, i) => {
          const open = openId === s.id;
          const from = s.variants.filter(isPriced).map((v) => v.price as number);
          const dup = duplicateServiceName(p, s);
          return (
            <div
              className={"odsvc" + (open ? " open" : "") + (s.live ? "" : " off") + (reorder.grabbed === s.id ? " held" : "") + (reorder.dragging === s.id ? " lifting" : "") + (reorder.over === s.id ? " over" : "")}
              key={s.id}
              {...reorder.dragProps(s.id)}
            >
              <div className="odsvchead">
                <span
                  className="odgrip"
                  aria-label={"Reorder " + (s.name || "Untitled service") + ", position " + (i + 1) + " of " + p.services.length}
                  {...reorder.gripProps(s.id)}
                >
                  <Markup html={OD_ICONS.grip} />
                </span>
                <button type="button" className="odsvctitle" onClick={() => setOpenId(open ? null : s.id)}>
                  <b>{s.name.trim() || "Untitled service"}</b>
                  <small>
                    {s.variants.length} {s.variants.length === 1 ? "option" : "options"} · {durationLabel(s.durationMin) || "no length"} · up to {s.capacity}
                    {from.length ? " · from " + money(Math.min(...from)) : " · no price"}
                    {dup ? " · same name as another service" : ""}
                  </small>
                </button>
                <div className="odsvctools">
                  <button type="button" className={"opavail" + (s.live ? "" : " off")} onClick={() => patchService(s.id, { live: !s.live })}>{s.live ? "Live" : "Hidden"}</button>
                  <button type="button" className="odiconbtn" onClick={() => setOpenId(open ? null : s.id)} aria-label={open ? "Close" : "Edit"}><Markup html={open ? OD_ICONS.chevUp : OD_ICONS.chevDown} /></button>
                </div>
              </div>
              {open ? (
                <div className="odsvcbody">
                  {!s.live ? (
                    <div className="odbanner soft">
                      <span><b>Hidden from guests.</b> Switch it on once the name and a price are set.</span>
                      <button type="button" className="odlink" onClick={() => patchService(s.id, { live: true })}>Make it live</button>
                    </div>
                  ) : null}
                  <div className="odgrid2">
                    <label className="odfield">
                      <span>Name</span>
                      <input value={s.name} maxLength={NAME_MAX} autoFocus={s.name === "New service"} onFocus={(e) => { if (e.target.value === "New service") e.target.select(); }} onChange={(e) => patchService(s.id, { name: e.target.value })} onBlur={(e) => { const t = e.target.value.trim(); if (t !== s.name) patchService(s.id, { name: t }); }} />
                      {!s.name.trim() ? <small className="odfine odwarn">A service needs a name before guests can see it.</small> : dup ? <small className="odfine odwarn">Another service has this name. Guests will see them as one; give each its own.</small> : null}
                    </label>
                    <div className="odgrid2 tight">
                      <DurationField min={s.durationMin} onChange={(m) => patchService(s.id, { durationMin: m })} />
                      <label className="odfield"><span>Max guests per slot</span><NumBox value={s.capacity} parse={parseCapacity} placeholder="8" ariaLabel="Max guests per slot" onCommit={(n) => patchService(s.id, { capacity: n ?? 1 })} /></label>
                    </div>
                  </div>
                  <label className="odfield">
                    <span>Description</span>
                    <textarea rows={3} value={s.desc} maxLength={DESC_MAX} onChange={(e) => patchService(s.id, { desc: e.target.value })} placeholder="What's included, where you meet, what to bring." />
                    {s.desc.length > DESC_MAX - 100 ? <small className="odfine">{DESC_MAX - s.desc.length} characters left</small> : null}
                  </label>

                  {p.photos.length ? (
                    <div className="odfield">
                      <span>Photo <small className="odmuted">(optional, from your gallery)</small></span>
                      <div className="odsvcphotos" role="radiogroup" aria-label="Photo for this service">
                        {p.photos.slice(0, 12).map((src) => (
                          <button type="button" key={src} role="radio" aria-checked={s.photo === src} className={"odsvcphoto" + (s.photo === src ? " on" : "")} onClick={() => patchService(s.id, { photo: s.photo === src ? undefined : src })} aria-label={s.photo === src ? "Photo in use, click to remove" : "Use this photo"}>
                            <Photo src={src} kind={u.art} id={"svc" + src.slice(-12)} alt="" size="thumb" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="odvarhead"><b>Price options</b><small>Guests pick one. Price is per the unit you choose. Drag the handle to reorder.</small></div>
                  <VariantList
                    variants={s.variants}
                    jumpId={targetVariant?.id}
                    onChange={(next) => patchService(s.id, (cur) => ({ ...cur, variants: next }))}
                  />
                  <div className="odbtns">
                    <button type="button" className="odghost" onClick={() => patchService(s.id, (cur) => ({ ...cur, variants: [...cur.variants, { id: uid("v"), label: "", price: null, per: cur.variants[0]?.per || "person", perGuest: cur.variants[0]?.perGuest ?? perUnitLooksPerGuest(cur.variants[0]?.per || "person") }] }))}><Markup html={OD_ICONS.plus} /> Add option</button>
                    <button type="button" className="odghost danger" onClick={() => removeService(s)}><Markup html={OD_ICONS.trash} /> Delete service</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {p.services.length === 0 ? (
          <div className="odempty">
            <b>No services yet</b>
            <p>Add what guests can book: a rental, a tour, a session. Each one gets its own price options.</p>
            <button type="button" className="cta small odemptycta" data-jump="price" onClick={addService}><Markup html={OD_ICONS.plus} /> Add your first service</button>
          </div>
        ) : null}
      </div>

      <section className="odcard">
        <div className="odcardhead">
          <h3>Add-ons</h3>
          <button type="button" className="odghost" onClick={() => set((cur) => ({ ...cur, addons: [...cur.addons, { id: uid("a"), name: "", detail: "", price: null }] }))}><Markup html={OD_ICONS.plus} /> Add</button>
        </div>
        <p className="odmuted">Extras guests can tack on at checkout, like a dry bag, a photo pack or an extra rider. Leave the price empty for a free extra.</p>
        <span role="status" aria-live="polite" className="odsr">{addonOrder.spoken}</span>
        {p.addons.map((a, i) => (
          <div className={"odaddon" + (addonOrder.grabbed === a.id ? " held" : "") + (addonOrder.dragging === a.id ? " lifting" : "") + (addonOrder.over === a.id ? " over" : "") + (!a.name.trim() ? " unnamed" : "")} key={a.id} {...addonOrder.dragProps(a.id)}>
            <span className="odgrip" aria-label={"Reorder " + (a.name || "this add-on") + ", position " + (i + 1) + " of " + p.addons.length} {...addonOrder.gripProps(a.id)}><Markup html={OD_ICONS.grip} /></span>
            <input value={a.name} maxLength={LABEL_MAX} placeholder="Add-on name" aria-label="Add-on name" onChange={(e) => patchAddon(a.id, { name: e.target.value })} onBlur={(e) => { const t = e.target.value.trim(); if (t !== a.name) patchAddon(a.id, { name: t }); }} />
            <input value={a.detail} maxLength={DETAIL_MAX} placeholder="Detail (optional)" aria-label={"Detail for " + (a.name || "this add-on")} onChange={(e) => patchAddon(a.id, { detail: e.target.value })} />
            <label className="opinput"><span>$</span><NumBox value={a.price} parse={parsePrice} format={formatPrice} placeholder="Free" ariaLabel={"Price for " + (a.name || "this add-on")} onCommit={(n) => patchAddon(a.id, { price: n })} /></label>
            <button type="button" className="odiconbtn" onClick={() => { set((cur) => ({ ...cur, addons: cur.addons.filter((x) => x.id !== a.id) })); toast("Add-on removed"); }} aria-label={"Remove " + (a.name || "this add-on")}><Markup html={OD_ICONS.trash} /></button>
          </div>
        ))}
        {p.addons.some((a) => !a.name.trim()) ? <small className="odfine odwarn">An add-on without a name stays off the guest page.</small> : null}
      </section>
    </div>
  );
}

/**
 * Duration as a pick list of the usual lengths, with "Other" opening a minutes box. A length that is not on
 * the list (75 minutes from the operator's site, or one they typed) used to be shown as the first entry, "30
 * min", while the row header and the guest page said 75: the operator saw a duration they never set.
 */
function DurationField({ min, onChange }: { min: number; onChange: (m: number) => void }) {
  const onList = DURATION_PRESETS.includes(min);
  const [custom, setCustom] = useState(!onList);
  useEffect(() => {
    if (!onList) setCustom(true);
  }, [onList]);
  return (
    <label className="odfield">
      <span>Duration</span>
      {custom ? (
        <span className="odduration">
          <NumBox value={min} parse={parseMinutes} placeholder="60" ariaLabel="Duration in minutes" onCommit={(n) => onChange(n ?? 60)} />
          <small className="odmuted">min</small>
          <button type="button" className="odlink" onClick={() => { setCustom(false); if (!onList) onChange(60); }}>List</button>
        </span>
      ) : (
        <select value={min} onChange={(e) => { if (e.target.value === "other") setCustom(true); else onChange(Number(e.target.value)); }}>
          {DURATION_PRESETS.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
          <option value="other">Other…</option>
        </select>
      )}
    </label>
  );
}

/** The price options of one service, each row draggable by its handle, or grabbed with Space and moved with the arrow keys. */
function VariantList({ variants, jumpId, onChange }: { variants: OpVariant[]; jumpId?: string; onChange: (next: OpVariant[]) => void }) {
  const order = useReorder<OpVariant>({ items: variants, getId: (v) => v.id, getLabel: (v) => v.label || "Untitled option", onReorder: onChange });
  return (
    <>
      <span role="status" aria-live="polite" className="odsr">{order.spoken}</span>
      {variants.map((v, i) => (
        <VariantRow
          key={v.id}
          v={v}
          jumpHere={v.id === jumpId}
          rowProps={order.dragProps(v.id)}
          gripProps={{ ...order.gripProps(v.id), "aria-label": "Reorder " + (v.label || "this option") + ", position " + (i + 1) + " of " + variants.length }}
          state={(order.grabbed === v.id ? " held" : "") + (order.dragging === v.id ? " lifting" : "") + (order.over === v.id ? " over" : "")}
          onChange={(patch) => onChange(variants.map((x) => (x.id === v.id ? { ...x, ...patch } : x)))}
          onRemove={() => onChange(variants.filter((x) => x.id !== v.id))}
          canRemove={variants.length > 1}
        />
      ))}
    </>
  );
}

function VariantRow({ v, onChange, onRemove, canRemove, jumpHere, rowProps, gripProps, state }: {
  v: OpVariant;
  onChange: (patch: Partial<OpVariant>) => void;
  onRemove: () => void;
  canRemove: boolean;
  jumpHere?: boolean;
  rowProps: Record<string, unknown>;
  gripProps: Record<string, unknown>;
  state: string;
}) {
  const perGuest = v.perGuest ?? perUnitLooksPerGuest(v.per);
  return (
    <div className={"odvar" + (!isPriced(v) ? " unpriced" : "") + state} {...rowProps}>
      <span className="odgrip" {...gripProps}><Markup html={OD_ICONS.grip} /></span>
      <input value={v.label} maxLength={LABEL_MAX} placeholder="Option, like 1 hour or Tandem" aria-label="Option name" onChange={(e) => onChange({ label: e.target.value })} onBlur={(e) => { const t = e.target.value.trim(); if (t !== v.label) onChange({ label: t }); }} />
      <label className="opinput" data-jump={jumpHere ? "price" : undefined}><span>$</span><NumBox value={v.price} parse={parsePrice} format={formatPrice} placeholder="Set" ariaLabel={"Price for " + (v.label || "this option")} onCommit={(n) => onChange({ price: n })} /></label>
      <label className="opinput odvarper">
        <span>per</span>
        <input
          list="odperunits"
          value={v.per}
          maxLength={UNIT_MAX}
          placeholder="person"
          aria-label={"What the price for " + (v.label || "this option") + " buys"}
          onChange={(e) => onChange({ per: e.target.value })}
          onBlur={(e) => { const t = e.target.value.trim().replace(/^\/+/, "").toLowerCase(); if (t !== v.per) onChange({ per: t || "person" }); }}
        />
      </label>
      {/* What the unit means for the bill, said outright rather than guessed from the word. */}
      <button
        type="button"
        className={"odpermode" + (perGuest ? " on" : "")}
        aria-pressed={perGuest}
        title={perGuest ? "Multiplied by the number of guests" : "Charged once, whatever the party size"}
        onClick={() => onChange({ perGuest: !perGuest })}
      >
        {perGuest ? "× guests" : "flat"}
      </button>
      <button type="button" className="odiconbtn" disabled={!canRemove} onClick={onRemove} aria-label="Remove option"><Markup html={OD_ICONS.trash} /></button>
    </div>
  );
}
