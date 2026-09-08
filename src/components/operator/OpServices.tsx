import { useState } from "react";
import { money } from "../../lib/format";
import { PER_UNITS, uid, type OpAddon, type OpService, type OpVariant } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";

/**
 * Menu editor. Uber Eats menu manager plus Booksy service list: every service has a description, a duration,
 * a capacity, a live switch and price options. Changes save on blur and show on the guest listing right away.
 */
export function OpServices() {
  const { p, set, preview, toast } = useOp();
  const [openId, setOpenId] = useState<string | null>(null);

  const patchService = (id: string, patch: Partial<OpService> | ((s: OpService) => OpService)) =>
    set((cur) => ({ ...cur, services: cur.services.map((s) => (s.id !== id ? s : typeof patch === "function" ? patch(s) : { ...s, ...patch })) }));

  const addService = () => {
    const s: OpService = { id: uid("s"), name: "New service", desc: "", live: false, durationMin: 60, capacity: 8, variants: [{ id: uid("v"), label: "Standard", price: null, per: "person" }] };
    set((cur) => ({ ...cur, services: [...cur.services, s] }));
    setOpenId(s.id);
  };
  const removeService = (id: string) => {
    set((cur) => ({ ...cur, services: cur.services.filter((s) => s.id !== id) }));
    toast("Service removed");
  };
  const move = (id: string, dir: number) =>
    set((cur) => {
      const i = cur.services.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.services.length) return cur;
      const next = cur.services.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return { ...cur, services: next };
    });

  const patchAddon = (id: string, patch: Partial<OpAddon>) => set((cur) => ({ ...cur, addons: cur.addons.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));

  const unpriced = p.services.flatMap((s) => s.variants).filter((v) => v.price == null).length;

  return (
    <div className="odpage">
      <div className="odbar">
        <p className="odmuted">This is your menu as guests see it. We copied it from your website. {unpriced ? <b>{unpriced} {unpriced === 1 ? "option has" : "options have"} no price yet.</b> : "Every option has a price."}</p>
        <div className="odbtns">
          <button type="button" className="odghost" onClick={preview}><Markup html={OD_ICONS.external} /> Preview listing</button>
          <button type="button" className="cta small" onClick={addService}><Markup html={OD_ICONS.plus} /> Add service</button>
        </div>
      </div>

      <div className="odsvclist">
        {p.services.map((s, i) => {
          const open = openId === s.id;
          const from = s.variants.map((v) => v.price).filter((n): n is number => n != null);
          return (
            <div className={"odsvc" + (open ? " open" : "") + (s.live ? "" : " off")} key={s.id}>
              <div className="odsvchead">
                <button type="button" className="odsvctitle" onClick={() => setOpenId(open ? null : s.id)}>
                  <b>{s.name || "Untitled service"}</b>
                  <small>
                    {s.variants.length} {s.variants.length === 1 ? "option" : "options"} · {s.durationMin} min · up to {s.capacity}
                    {from.length ? " · from " + money(Math.min(...from)) : " · no price"}
                  </small>
                </button>
                <div className="odsvctools">
                  <button type="button" className="odiconbtn" disabled={i === 0} onClick={() => move(s.id, -1)} aria-label="Move up"><Markup html={OD_ICONS.chevUp} /></button>
                  <button type="button" className="odiconbtn" disabled={i === p.services.length - 1} onClick={() => move(s.id, 1)} aria-label="Move down"><Markup html={OD_ICONS.chevDown} /></button>
                  <button type="button" className={"opavail" + (s.live ? "" : " off")} onClick={() => patchService(s.id, { live: !s.live })}>{s.live ? "Live" : "Hidden"}</button>
                  <button type="button" className="odiconbtn" onClick={() => setOpenId(open ? null : s.id)} aria-label="Edit"><Markup html={open ? OD_ICONS.chevUp : OD_ICONS.chevDown} /></button>
                </div>
              </div>
              {open ? (
                <div className="odsvcbody">
                  <div className="odgrid2">
                    <label className="odfield"><span>Name</span><input value={s.name} onChange={(e) => patchService(s.id, { name: e.target.value })} /></label>
                    <div className="odgrid2 tight">
                      <label className="odfield"><span>Duration</span>
                        <select value={s.durationMin} onChange={(e) => patchService(s.id, { durationMin: Number(e.target.value) })}>
                          {[30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480].map((m) => <option key={m} value={m}>{m < 60 ? m + " min" : m / 60 + (m === 60 ? " hour" : " hours")}</option>)}
                        </select>
                      </label>
                      <label className="odfield"><span>Max guests per slot</span><input type="number" min={1} value={s.capacity} onChange={(e) => patchService(s.id, { capacity: Math.max(1, Number(e.target.value) || 1) })} /></label>
                    </div>
                  </div>
                  <label className="odfield"><span>Description</span><textarea rows={3} value={s.desc} onChange={(e) => patchService(s.id, { desc: e.target.value })} placeholder="What's included, where you meet, what to bring." /></label>

                  <div className="odvarhead"><b>Price options</b><small>Guests pick one. Price is per the unit you choose.</small></div>
                  {s.variants.map((v) => (
                    <VariantRow key={v.id} v={v} onChange={(patch) => patchService(s.id, (cur) => ({ ...cur, variants: cur.variants.map((x) => (x.id === v.id ? { ...x, ...patch } : x)) }))} onRemove={() => patchService(s.id, (cur) => ({ ...cur, variants: cur.variants.filter((x) => x.id !== v.id) }))} canRemove={s.variants.length > 1} />
                  ))}
                  <div className="odbtns">
                    <button type="button" className="odghost" onClick={() => patchService(s.id, (cur) => ({ ...cur, variants: [...cur.variants, { id: uid("v"), label: "", price: null, per: cur.variants[0]?.per || "person" }] }))}><Markup html={OD_ICONS.plus} /> Add option</button>
                    <button type="button" className="odghost danger" onClick={() => removeService(s.id)}><Markup html={OD_ICONS.trash} /> Delete service</button>
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
          </div>
        ) : null}
      </div>

      <section className="odcard">
        <div className="odcardhead">
          <h3>Add-ons</h3>
          <button type="button" className="odghost" onClick={() => set((cur) => ({ ...cur, addons: [...cur.addons, { id: uid("a"), name: "", detail: "", price: null }] }))}><Markup html={OD_ICONS.plus} /> Add</button>
        </div>
        <p className="odmuted">Extras guests can tack on at checkout, like a dry bag, a photo pack or an extra rider.</p>
        {p.addons.map((a) => (
          <div className="odaddon" key={a.id}>
            <input value={a.name} placeholder="Add-on name" onChange={(e) => patchAddon(a.id, { name: e.target.value })} />
            <input value={a.detail} placeholder="Detail (optional)" onChange={(e) => patchAddon(a.id, { detail: e.target.value })} />
            <label className="opinput"><span>$</span><input type="number" min={0} value={a.price ?? ""} placeholder="0" onChange={(e) => patchAddon(a.id, { price: e.target.value === "" ? null : Number(e.target.value) })} /></label>
            <button type="button" className="odiconbtn" onClick={() => set((cur) => ({ ...cur, addons: cur.addons.filter((x) => x.id !== a.id) }))} aria-label="Remove"><Markup html={OD_ICONS.trash} /></button>
          </div>
        ))}
      </section>
    </div>
  );
}

function VariantRow({ v, onChange, onRemove, canRemove }: { v: OpVariant; onChange: (patch: Partial<OpVariant>) => void; onRemove: () => void; canRemove: boolean }) {
  return (
    <div className="odvar">
      <input value={v.label} placeholder="Option, like 1 hour or Tandem" onChange={(e) => onChange({ label: e.target.value })} />
      <label className="opinput"><span>$</span><input type="number" min={0} value={v.price ?? ""} placeholder="Set" onChange={(e) => onChange({ price: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <select value={v.per} onChange={(e) => onChange({ per: e.target.value })}>
        {PER_UNITS.map((u) => <option key={u} value={u}>per {u}</option>)}
      </select>
      <button type="button" className="odiconbtn" disabled={!canRemove} onClick={onRemove} aria-label="Remove option"><Markup html={OD_ICONS.trash} /></button>
    </div>
  );
}
