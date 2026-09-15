import { useRef, useState } from "react";
import { hasApi, uploadPhoto } from "../../lib/api";
import { CATS } from "../../data/categories";
import type { CategoryId } from "../../data/types";
import { Photo } from "../art/Photo";
import { hasCancelLine, listingChecks } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";

/**
 * Listing editor: what guests see. Publish switch, name and story, photos with a cover pick, contact facts,
 * and policy lines. The Airbnb "Listing editor" shape, cut down to what a local operator needs.
 */
export function OpListing() {
  const { p, u, set, preview, toast, compact, jump } = useOp();
  const checks = listingChecks(p);
  const done = checks.filter((c) => c.done).length;
  const addPolicy = (line: string) => {
    const l = line.trim();
    if (!l || p.policy.includes(l)) return;
    set({ policy: [...p.policy, l] });
    toast("Added to your policies");
  };
  const [newPhoto, setNewPhoto] = useState("");
  const [newPolicy, setNewPolicy] = useState("");

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(0);
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 12);
    setUploading(list.length);
    const added: string[] = [];
    for (const f of list) {
      try {
        const r = await uploadPhoto(p.id, f);
        if (r.ok && r.url) added.push(r.url);
        else toast(r.error || "Upload failed");
      } catch (e) {
        toast((e as Error).message);
      }
      setUploading((n) => n - 1);
    }
    if (added.length) set((cur) => ({ ...cur, photos: [...cur.photos.filter((x) => !added.includes(x)), ...added], cover: cur.cover || added[0] }));
    if (fileRef.current) fileRef.current.value = "";
  };
  const addPhoto = () => {
    const url = newPhoto.trim();
    if (!/^https?:\/\//i.test(url)) return;
    set({ photos: [...p.photos.filter((x) => x !== url), url], cover: p.cover || url });
    setNewPhoto("");
    toast("Photo added");
  };

  return (
    <div className="odpage">
      {done < checks.length ? (
        <section className="odcard odfinish">
          <div className="odcardhead">
            <h3>Finish your listing</h3>
            <span className="odprogress"><i style={{ width: Math.round((done / checks.length) * 100) + "%" }} /></span>
            <small className="odmuted">{done} of {checks.length} done</small>
          </div>
          <p className="odmuted">What guests check before they book. Click one to go straight to it.</p>
          <div className="odfinishlist">
            {checks.map((c, i) => (
              <button type="button" key={c.id} className={"odfinishitem" + (c.done ? " done" : "")} onClick={() => jump(c.field)}>
                <span className="tick">{c.done ? <Markup html={OD_ICONS.check} /> : <i>{i + 1}</i>}</span>
                <span className="meta"><b>{c.label}</b><small>{c.done ? "Done" : c.hint}</small></span>
                {c.done ? null : <Markup html={OD_ICONS.chev} />}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="odrow odpublish">
        <span className="meta">
          <b>{p.published ? "Your listing is live on Outset" : "Your listing is hidden"}</b>
          <small>{p.published ? "Guests can find and book you. Switch off to take the page down without losing anything." : "Nobody can see or book you. Switch on when you're ready."}</small>
        </span>
        <div className="odbtns">
          {compact ? <button type="button" className="odghost" onClick={preview}><Markup html={OD_ICONS.external} /> Preview</button> : null}
          <button type="button" className={"optoggle" + (p.published ? " on" : "")} onClick={() => { set({ published: !p.published }); toast(p.published ? "Listing hidden from the site" : "Listing published"); }} aria-pressed={p.published}>
            <span className="knob" />
            <span className="lbl">{p.published ? "Published" : "Hidden"}</span>
          </button>
        </div>
      </div>

      <div className="odcols">
        <div className="odstack">
          <section className="odcard">
            <div className="odcardhead"><h3>Basics</h3></div>
            <label className="odfield" data-jump="title"><span>Business name</span><input value={p.title} onChange={(e) => set({ title: e.target.value })} /></label>
            <label className="odfield"><span>Category</span>
              <select value={p.cat} onChange={(e) => set({ cat: e.target.value as Exclude<CategoryId, "all"> })}>
                {CATS.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="odfield" data-jump="about"><span>About</span>
              <textarea rows={5} value={p.blurb} onChange={(e) => set({ blurb: e.target.value })} placeholder="What you do, where you launch from, and why people love it. Two or three sentences is plenty." />
              <small className="odfine">{p.blurb.trim().length < 60 ? "A little more here helps. Guests read this before they book." : "Good length."}</small>
            </label>
          </section>

          <section className="odcard">
            <div className="odcardhead"><h3>Contact and location</h3></div>
            <p className="odmuted">Shown on your listing so guests can call and find you. Your website and email stay private on the guest page.</p>
            <div className="odgrid2">
              <label className="odfield" data-jump="phone"><span>Phone</span><input type="tel" value={p.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="(555) 555-5555" />
                {!p.phone.trim() && p.ownerPhone.trim() ? <button type="button" className="odlink tiny odfill" onClick={(e) => { e.preventDefault(); set({ phone: p.ownerPhone.trim() }); }}>Use {p.ownerPhone.trim()}</button> : null}
              </label>
              <label className="odfield"><span>Email for bookings</span><input type="email" value={p.email} onChange={(e) => set({ email: e.target.value })} placeholder="bookings@business.com" /></label>
            </div>
            <label className="odfield" data-jump="address"><span>Meeting point or address</span><input value={p.address} onChange={(e) => set({ address: e.target.value })} placeholder="Street, city, state" /></label>
            <label className="odfield"><span>Website</span><input type="url" value={p.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" /></label>
          </section>

          <section className="odcard" data-jump="policy">
            <div className="odcardhead"><h3>Policies</h3></div>
            <p className="odmuted">Cancellation, weather, age and weight rules, what to bring. One line each. The assistant answers guests from these.</p>
            {!hasCancelLine(p) ? (
              <div className="odquick">
                <small>No cancellation line yet. Pick one to add it:</small>
                <div className="odchips">
                  {["Free cancellation up to 24 hours before", "Free cancellation up to 48 hours before", "Full refund if we cancel for weather"].map((l) => (
                    <button type="button" key={l} onClick={() => addPolicy(l)}><Markup html={OD_ICONS.plus} /> {l}</button>
                  ))}
                </div>
              </div>
            ) : null}
            {p.policy.length === 0 ? <p className="odfine">Nothing here yet. Guests trust a listing that says what happens if plans change.</p> : null}
            {p.policy.map((line, i) => (
              <div className="odline" key={i}>
                <span className="meta"><b className="normal">{line}</b></span>
                <button type="button" className="odiconbtn" onClick={() => set({ policy: p.policy.filter((_, j) => j !== i) })} aria-label="Remove"><Markup html={OD_ICONS.trash} /></button>
              </div>
            ))}
            <div className="odaddoff">
              <input value={newPolicy} onChange={(e) => setNewPolicy(e.target.value)} aria-label="Add a policy line" placeholder="Type a line, like: Ages 8 and up" onKeyDown={(e) => { if (e.key === "Enter" && newPolicy.trim()) { addPolicy(newPolicy); setNewPolicy(""); } }} />
              <button type="button" className="cta small" disabled={!newPolicy.trim()} onClick={() => { addPolicy(newPolicy); setNewPolicy(""); }}><Markup html={OD_ICONS.plus} /> Add</button>
            </div>
            {u.specs.length ? (
              <details className="oddetails">
                <summary>Facts we pulled from your site ({u.specs.length})</summary>
                <ul>{u.specs.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </details>
            ) : null}
          </section>
        </div>

        <section className="odcard" data-jump="photos">
          <div className="odcardhead"><h3>Photos</h3><small className="odmuted">{p.photos.length} {p.photos.length === 1 ? "photo" : "photos"}</small></div>
          <p className="odmuted">Copied from your website. Pick the cover, remove any that don't sell the trip, and add your own from your phone or computer.</p>
          <div className="odupload">
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
            <button type="button" className="cta" disabled={!hasApi() || uploading > 0} onClick={() => fileRef.current?.click()}>
              <Markup html={OD_ICONS.plus} /> {uploading > 0 ? `Uploading ${uploading}…` : "Upload photos"}
            </button>
            {!hasApi() ? <small className="odfine">Uploads switch on once the API is connected. Paste a link below meanwhile.</small> : <small className="odfine">JPEG or PNG. We resize them for you.</small>}
          </div>
          <div className="odphotos">
            {p.photos.map((src) => (
              <div className={"odphoto" + (src === p.cover ? " cover" : "")} key={src}>
                <Photo src={src} kind={u.art} id={"e" + src.slice(-12)} alt="" />
                <div className="odphototools">
                  {src === p.cover ? <span className="odtag live">Cover</span> : <button type="button" onClick={() => set({ cover: src })}>Make cover</button>}
                  <button type="button" onClick={() => set({ photos: p.photos.filter((x) => x !== src), cover: p.cover === src ? p.photos.find((x) => x !== src) || "" : p.cover })} aria-label="Remove"><Markup html={OD_ICONS.trash} /></button>
                </div>
              </div>
            ))}
            {p.photos.length === 0 ? <div className="odempty small"><b>No photos yet</b><p>{hasApi() ? "Upload three or more from your phone or computer. The first one becomes your cover." : "Paste a link to a photo from your website below. The first one becomes your cover."}</p></div> : null}
          </div>
          <div className="odaddoff">
            <input value={newPhoto} onChange={(e) => setNewPhoto(e.target.value)} aria-label="Photo web address" placeholder="https://yoursite.com/photo.jpg" onKeyDown={(e) => e.key === "Enter" && addPhoto()} />
            <button type="button" className="cta small" disabled={!/^https?:\/\//i.test(newPhoto.trim())} onClick={addPhoto}><Markup html={OD_ICONS.plus} /> Add</button>
          </div>
        </section>
      </div>
    </div>
  );
}
