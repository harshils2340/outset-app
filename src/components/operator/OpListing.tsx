import { useEffect, useRef, useState } from "react";
import { hasApi, uploadPhoto } from "../../lib/api";
import { CATS } from "../../data/categories";
import { GUIDES } from "../../data/guides";
import type { CategoryId } from "../../data/types";
import { Photo } from "../art/Photo";
import { GUIDE_LIMITS, KNOW_LIMITS, hasCancelLine, listingChecks, type OpFaq, type OpGuide } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";

/* Text limits. The guest page lays these out at these sizes; past them a listing card or heading breaks. */
const TITLE_MAX = 80;
const BLURB_MAX = 2000;
const PHONE_MAX = 30;
const EMAIL_MAX = 120;
const WEBSITE_MAX = 200;
const ADDRESS_MAX = 160;
const POLICY_MAX = 200;
const POLICY_LINES = 20;
const PHOTOS_MAX = 30;

/** One line as typed, made safe for a heading: control characters out, runs of spaces to one. Emoji stay. */
function oneLine(s: string, max: number): string {
  return s.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").slice(0, max);
}

/** A photo link the browser can load: http(s), no spaces, and it must not be a page of the dashboard itself. */
function photoUrlOk(raw: string): boolean {
  const url = raw.trim();
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return false;
  try {
    const u = new URL(url);
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * A list of short lines with add, edit in place, move up or down, and remove. Policies, guide steps and the
 * bring list all use it. Enter adds or saves, Escape cancels an edit, nothing empty is ever saved.
 */
function LineList({ items, onChange, max, maxLen, placeholder, numbered, empty, jumpOn, onAdded }: {
  items: string[];
  onChange: (next: string[]) => void;
  max: number;
  maxLen: number;
  placeholder: string;
  numbered?: boolean;
  empty?: string;
  /** Focus the add box after this many renders of an outside "add" (the policy chips). */
  jumpOn?: number;
  onAdded?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ i: number; text: string } | null>(null);
  const addRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (jumpOn) addRef.current?.focus();
  }, [jumpOn]);
  const full = items.length >= max;
  const add = () => {
    const l = oneLine(draft, maxLen).trim();
    if (!l || full) return;
    if (items.some((x) => x.trim().toLowerCase() === l.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...items, l]);
    setDraft("");
    onAdded?.();
  };
  const saveEdit = () => {
    if (!editing) return;
    const l = oneLine(editing.text, maxLen).trim();
    // Emptying a line and pressing Enter removes it, the way a blank row disappears in Notes.
    onChange(l ? items.map((x, j) => (j === editing.i ? l : x)) : items.filter((_, j) => j !== editing.i));
    setEditing(null);
  };
  return (
    <div className="odlines">
      {items.length === 0 && empty ? <p className="odfine">{empty}</p> : null}
      {items.map((line, i) => (
        <div className={"odline odlineitem" + (editing?.i === i ? " editing" : "")} key={i + ":" + line}>
          {numbered ? <span className="odlinen">{i + 1}</span> : null}
          {editing?.i === i ? (
            <input
              className="odlineedit"
              autoFocus
              value={editing.text}
              maxLength={maxLen}
              aria-label={"Edit line " + (i + 1)}
              onChange={(e) => setEditing({ i, text: e.target.value })}
              onBlur={saveEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
              }}
            />
          ) : (
            <button type="button" className="odlinetext" onClick={() => setEditing({ i, text: line })} title="Click to edit">{line}</button>
          )}
          <span className="odlinetools">
            <button type="button" className="odiconbtn small" disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))} aria-label="Move up"><Markup html={OD_ICONS.chevUp} /></button>
            <button type="button" className="odiconbtn small" disabled={i === items.length - 1} onClick={() => onChange(move(items, i, i + 1))} aria-label="Move down"><Markup html={OD_ICONS.chevDown} /></button>
            <button type="button" className="odiconbtn small" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove"><Markup html={OD_ICONS.trash} /></button>
          </span>
        </div>
      ))}
      <div className="odaddoff">
        <input
          ref={addRef}
          value={draft}
          maxLength={maxLen}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={placeholder}
          placeholder={full ? "That's the most you can add (" + max + ")" : placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" className="cta small" disabled={full || !draft.trim()} onClick={add}><Markup html={OD_ICONS.plus} /> Add</button>
      </div>
      {draft.length >= maxLen ? <p className="odfine">Keep it to {maxLen} characters. Long lines get cut off on the listing.</p> : null}
    </div>
  );
}

/** Question and answer pairs, each editable in place. A pair with either box empty stays off the guest page until both are filled. */
function FaqList({ items, onChange }: { items: OpFaq[]; onChange: (next: OpFaq[]) => void }) {
  const full = items.length >= KNOW_LIMITS.faq;
  const edit = (i: number, patch: Partial<OpFaq>) => onChange(items.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="odlines">
      {items.length === 0 ? <p className="odfine">Nothing yet. The questions people call about: parking, what to wear, whether kids can come.</p> : null}
      {items.map((f, i) => (
        <div className="odfaq" key={i}>
          <input value={f.q} maxLength={KNOW_LIMITS.question} placeholder="Question, like: Is parking free?" aria-label={"Question " + (i + 1)} onChange={(e) => edit(i, { q: oneLine(e.target.value, KNOW_LIMITS.question) })} />
          <textarea rows={2} value={f.a} maxLength={KNOW_LIMITS.answer} placeholder="Your answer" aria-label={"Answer " + (i + 1)} onChange={(e) => edit(i, { a: e.target.value.slice(0, KNOW_LIMITS.answer) })} />
          <button type="button" className="odiconbtn small" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove question"><Markup html={OD_ICONS.trash} /></button>
        </div>
      ))}
      <button type="button" className="cta small" disabled={full} onClick={() => onChange([...items, { q: "", a: "" }])}><Markup html={OD_ICONS.plus} /> {full ? "That's the most (" + KNOW_LIMITS.faq + ")" : "Add a question"}</button>
    </div>
  );
}

/**
 * Listing editor: what guests see. Publish switch, name and story, photos with a cover pick, contact facts,
 * policy lines and the first-timer guide. The Airbnb "Listing editor" shape, cut down to what a local operator needs.
 */
export function OpListing() {
  const { p, u, set, preview, toast, compact, jump } = useOp();
  const checks = listingChecks(p);
  const done = checks.filter((c) => c.done).length;
  const setPolicy = (policy: string[]) => set({ policy });
  const addPolicy = (line: string) => {
    const l = oneLine(line, POLICY_MAX).trim();
    if (!l || p.policy.some((x) => x.toLowerCase() === l.toLowerCase())) return;
    if (p.policy.length >= POLICY_LINES) {
      toast("That's the most policy lines a listing can hold (" + POLICY_LINES + ")");
      return;
    }
    set({ policy: [...p.policy, l] });
    toast("Added to your policies");
  };
  const [newPhoto, setNewPhoto] = useState("");
  // Links that never loaded. Shown as such so the owner can remove them instead of wondering why a tile is blank.
  const [broken, setBroken] = useState<Set<string>>(new Set());

  // The first-timer guide. Nothing saved yet means the page shows the kind's default; the editor starts from
  // that same default, so the owner edits a full draft rather than an empty box. The first change saves it.
  const suggested: OpGuide = { steps: GUIDES[u.art]?.steps || [], bring: GUIDES[u.art]?.bring || [], goodFor: GUIDES[u.art]?.goodFor || "" };
  const guide: OpGuide = p.guide || suggested;
  const setGuide = (patch: Partial<OpGuide>) => set({ guide: { ...guide, ...patch } });

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(0);
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = Math.max(0, PHOTOS_MAX - p.photos.length);
    if (!room) {
      toast("A listing holds " + PHOTOS_MAX + " photos. Remove one to add another.");
      return;
    }
    const list = Array.from(files).slice(0, Math.min(12, room));
    // Picking twenty photos used to upload twelve and lose the other eight without a word.
    if (files.length > list.length) toast("We'll take the first " + list.length + ". Add the other " + (files.length - list.length) + " in a second batch.");
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
    if (added.length) set((cur) => ({ ...cur, photos: [...cur.photos.filter((x) => !added.includes(x)), ...added].slice(0, PHOTOS_MAX), cover: cur.cover || added[0] }));
    if (fileRef.current) fileRef.current.value = "";
  };
  const addPhoto = () => {
    const url = newPhoto.trim();
    if (!photoUrlOk(url)) {
      toast("That doesn't look like a photo link. It should start with https://");
      return;
    }
    if (p.photos.includes(url)) {
      toast("That photo is already in your gallery");
      setNewPhoto("");
      return;
    }
    if (p.photos.length >= PHOTOS_MAX) {
      toast("A listing holds " + PHOTOS_MAX + " photos. Remove one to add another.");
      return;
    }
    set({ photos: [...p.photos, url], cover: p.cover || url });
    setNewPhoto("");
    toast("Photo added");
  };
  const removePhoto = (src: string) => {
    set({ photos: p.photos.filter((x) => x !== src), cover: p.cover === src ? p.photos.find((x) => x !== src) || "" : p.cover });
    setBroken((b) => { if (!b.has(src)) return b; const n = new Set(b); n.delete(src); return n; });
  };
  // A cover that is no longer in the gallery (removed in another tab, or a stale profile) would leave the card blank.
  const coverOk = !!p.cover && p.photos.includes(p.cover);
  const photoNote = p.photos.length >= PHOTOS_MAX ? "That's the most a listing can hold." : hasApi() ? "JPEG or PNG. We resize them for you." : "Uploads switch on once the API is connected. Paste a link below meanwhile.";
  const trimField = (key: "title" | "phone" | "email" | "website" | "address", max: number) => () => {
    const clean = oneLine(p[key], max).trim();
    if (clean !== p[key]) set({ [key]: clean });
  };
  const websiteOk = !p.website.trim() || /^https?:\/\/\S+\.\S+$/i.test(p.website.trim());
  const emailOk = !p.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim());

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
          {/* Hidden is not gone: the record keeps its own link, so a guest with a bookmark or an old email
              still opens the page and reads that it is down. Saying "nobody can see you" left an owner to
              find that out from a guest. */}
          <small>{p.published ? "Guests can find and book you. Switch off to take the page down without losing anything." : "You are off every list, rail and search, and nothing can be booked. A guest who already has your link opens a page that says it is hidden. Switch on when you're ready."}</small>
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
            <label className="odfield" data-jump="title"><span>Business name</span>
              <input value={p.title} maxLength={TITLE_MAX} onChange={(e) => set({ title: oneLine(e.target.value, TITLE_MAX) })} onBlur={trimField("title", TITLE_MAX)} placeholder={u.title} />
              {!p.title.trim() ? <small className="odfine warn">Add a name. Until you do, guests see "{u.title}".</small> : p.title.length >= TITLE_MAX ? <small className="odfine">That's the longest a name can be ({TITLE_MAX} characters).</small> : null}
            </label>
            <label className="odfield"><span>Category</span>
              <select value={p.cat} onChange={(e) => set({ cat: e.target.value as Exclude<CategoryId, "all"> })}>
                {CATS.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="odfield" data-jump="about"><span>About</span>
              <textarea rows={5} value={p.blurb} maxLength={BLURB_MAX} onChange={(e) => set({ blurb: e.target.value.slice(0, BLURB_MAX) })} placeholder="What you do, where you launch from, and why people love it. Two or three sentences is plenty." />
              <small className="odfine">
                {p.blurb.length >= BLURB_MAX ? "That's the most the description holds (" + BLURB_MAX + " characters)." : p.blurb.trim().length < 60 ? "A little more here helps. Guests read this before they book." : "Good length."}
                {p.blurb.length > BLURB_MAX * 0.8 ? " " + p.blurb.length + " / " + BLURB_MAX : ""}
              </small>
            </label>
          </section>

          <section className="odcard">
            <div className="odcardhead"><h3>Contact and location</h3></div>
            <p className="odmuted">Shown on your listing so guests can call and find you. Your website and email stay private on the guest page.</p>
            <div className="odgrid2">
              <label className="odfield" data-jump="phone"><span>Phone</span><input type="tel" value={p.phone} maxLength={PHONE_MAX} onChange={(e) => set({ phone: oneLine(e.target.value, PHONE_MAX) })} onBlur={trimField("phone", PHONE_MAX)} placeholder="(555) 555-5555" />
                {!p.phone.trim() && p.ownerPhone.trim() ? <button type="button" className="odlink tiny odfill" onClick={(e) => { e.preventDefault(); set({ phone: p.ownerPhone.trim() }); }}>Use {p.ownerPhone.trim()}</button> : null}
                {p.phone.trim() && p.phone.replace(/\D/g, "").length < 7 ? <small className="odfine warn">That's short for a phone number. Guests tap it to call you.</small> : null}
              </label>
              <label className="odfield"><span>Email for bookings</span><input type="email" value={p.email} maxLength={EMAIL_MAX} onChange={(e) => set({ email: oneLine(e.target.value, EMAIL_MAX) })} onBlur={trimField("email", EMAIL_MAX)} placeholder="bookings@business.com" />
                {!emailOk ? <small className="odfine warn">That doesn't look like an email address.</small> : null}
              </label>
            </div>
            <label className="odfield" data-jump="address"><span>Meeting point or address</span><input value={p.address} maxLength={ADDRESS_MAX} onChange={(e) => set({ address: oneLine(e.target.value, ADDRESS_MAX) })} onBlur={trimField("address", ADDRESS_MAX)} placeholder="Street, city, state" />
              {!p.address.trim() ? <small className="odfine warn">Without an address, guests can't get directions to you.</small> : null}
            </label>
            <label className="odfield"><span>Website</span><input type="url" value={p.website} maxLength={WEBSITE_MAX} onChange={(e) => set({ website: oneLine(e.target.value, WEBSITE_MAX) })} onBlur={trimField("website", WEBSITE_MAX)} placeholder="https://" />
              {!websiteOk ? <small className="odfine warn">Start with https:// so the link works.</small> : null}
            </label>
          </section>

          <section className="odcard" data-jump="policy">
            <div className="odcardhead"><h3>Things to know</h3></div>
            <p className="odmuted">Copied from your booking system and website, in your words. Every line here shows on your listing, and the assistant answers guests from it.</p>

            <h4 className="odsub">Cancellation policy</h4>
            <label className="odfield"><span className="odvh">Cancellation policy</span>
              <input value={p.cancellation ?? ""} maxLength={KNOW_LIMITS.cancellation} onChange={(e) => set({ cancellation: oneLine(e.target.value, KNOW_LIMITS.cancellation) })} placeholder="Free cancellation up to 24 hours before your start time" />
            </label>
            {!hasCancelLine(p) ? (
              <div className="odquick">
                <small>Guests look for this before they pay. Pick one or type your own:</small>
                <div className="odchips">
                  {["Free cancellation up to 24 hours before", "Free cancellation up to 48 hours before", "Full refund if we cancel for weather"].map((l) => (
                    <button type="button" key={l} onClick={() => { set({ cancellation: l }); toast("Cancellation policy set"); }}><Markup html={OD_ICONS.plus} /> {l}</button>
                  ))}
                </div>
              </div>
            ) : null}

            <h4 className="odsub">Who can go</h4>
            <LineList
              items={p.requirements ?? []}
              onChange={(requirements) => set({ requirements })}
              max={KNOW_LIMITS.requirements}
              maxLen={KNOW_LIMITS.requirement}
              placeholder="Add a rule, like: Ages 8 and up, or Under 250 lb"
              empty="No rules listed. Age, weight, swimming and licence rules save a call."
            />

            <h4 className="odsub">What's included</h4>
            <LineList
              items={p.includes ?? []}
              onChange={(includes) => set({ includes })}
              max={KNOW_LIMITS.includes}
              maxLen={KNOW_LIMITS.include}
              placeholder="Add an item, like: Life jackets, or Fuel and captain"
              empty="Nothing listed. Guests compare listings on what the price covers."
            />

            <h4 className="odsub">Check-in and waiver</h4>
            <label className="odfield"><span className="odvh">Check-in and waiver</span>
              <textarea rows={2} value={p.checkin ?? ""} maxLength={KNOW_LIMITS.checkin} onChange={(e) => set({ checkin: e.target.value.replace(/[\r\n]+/g, " ").slice(0, KNOW_LIMITS.checkin) })} placeholder="Arrive 15 minutes early and sign the waiver at the dock" />
            </label>

            <h4 className="odsub">Other policies</h4>
            <LineList
              items={p.policy}
              onChange={setPolicy}
              max={POLICY_LINES}
              maxLen={POLICY_MAX}
              placeholder="Type a line, like: No refunds for no-shows"
              empty="Weather, deposits, groups, pets. One line each."
              onAdded={() => toast("Added to your policies")}
            />
            {u.specs.length ? (
              <details className="oddetails">
                <summary>Facts we pulled from your site ({u.specs.length})</summary>
                <ul>{u.specs.map((s, i) => <li key={i}>{s} <button type="button" className="odlink tiny" disabled={p.policy.some((x) => x.toLowerCase() === oneLine(s, POLICY_MAX).trim().toLowerCase())} onClick={() => addPolicy(s)}>Add</button></li>)}</ul>
              </details>
            ) : null}

            <h4 className="odsub">Questions guests ask</h4>
            <FaqList items={p.faq ?? []} onChange={(faq) => set({ faq })} />
          </section>

          <section className="odcard" data-jump="guide">
            <div className="odcardhead">
              <h3>What it's actually like</h3>
              {p.guide ? <button type="button" className="odlink" onClick={() => { set({ guide: undefined }); toast("Back to the suggested guide"); }}>Reset to suggested</button> : <small className="odmuted">Suggested</small>}
            </div>
            <p className="odmuted">
              A first-timer opens this from your listing before they book: how the day goes, what to bring, who it suits.
              {p.guide ? " This is your version." : GUIDES[u.art] ? " We wrote a draft for your kind of business. Change anything and guests see your version." : " Tell them how it goes in your own words."}
            </p>
            <h4 className="odsub">How the day goes, in order</h4>
            <LineList
              items={guide.steps}
              onChange={(steps) => setGuide({ steps })}
              max={GUIDE_LIMITS.steps}
              maxLen={GUIDE_LIMITS.step}
              numbered
              placeholder="Add a step, like: Check in 15 minutes early and sign the waiver"
              empty="No steps yet. Three to five short ones read best."
            />
            <h4 className="odsub">What to bring or wear</h4>
            <LineList
              items={guide.bring}
              onChange={(bring) => setGuide({ bring })}
              max={GUIDE_LIMITS.bring}
              maxLen={GUIDE_LIMITS.bringItem}
              placeholder="Add an item, like: Sunscreen and a towel"
              empty="Nothing listed. Guests like knowing what to pack."
            />
            <label className="odfield"><span>Good for</span>
              <textarea rows={2} value={guide.goodFor} maxLength={GUIDE_LIMITS.goodFor} onChange={(e) => setGuide({ goodFor: e.target.value.replace(/[\r\n]+/g, " ").slice(0, GUIDE_LIMITS.goodFor) })} placeholder="Who it suits, like: Families with kids 8 and up, first-timers, groups celebrating something." />
              {guide.goodFor.length >= GUIDE_LIMITS.goodFor ? <small className="odfine">That's the most this line holds ({GUIDE_LIMITS.goodFor} characters).</small> : null}
            </label>
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
            <small className="odfine">{photoNote}</small>
          </div>
          {p.photos.length && !coverOk ? <p className="odfine warn">No cover picked. <button type="button" className="odlink tiny" onClick={() => set({ cover: p.photos[0] })}>Use the first photo</button></p> : null}
          <div className="odphotos">
            {p.photos.map((src, i) => (
              <div className={"odphoto" + (src === p.cover ? " cover" : "") + (broken.has(src) ? " broken" : "")} key={src}>
                {broken.has(src) ? (
                  <div className="odphotodead"><b>Couldn't load this photo</b><small>{src.replace(/^https?:\/\//, "").slice(0, 40)}…</small></div>
                ) : (
                  <Photo src={src} kind={u.art} id={"e" + src.slice(-12)} alt="" fallback={false} onBroken={() => setBroken((b) => (b.has(src) ? b : new Set(b).add(src)))} />
                )}
                <div className="odphotoorder">
                  <button type="button" disabled={i === 0} onClick={() => set({ photos: move(p.photos, i, i - 1) })} aria-label="Move earlier"><Markup html={OD_ICONS.back} /></button>
                  <span>{i + 1}</span>
                  <button type="button" disabled={i === p.photos.length - 1} onClick={() => set({ photos: move(p.photos, i, i + 1) })} aria-label="Move later"><Markup html={OD_ICONS.chev} /></button>
                </div>
                <div className="odphototools">
                  {src === p.cover ? <span className="odtag live">Cover</span> : <button type="button" disabled={broken.has(src)} onClick={() => set({ cover: src })}>Make cover</button>}
                  <button type="button" onClick={() => removePhoto(src)} aria-label="Remove"><Markup html={OD_ICONS.trash} /></button>
                </div>
              </div>
            ))}
            {p.photos.length === 0 ? <div className="odempty small"><b>No photos yet</b><p>{hasApi() ? "Upload three or more from your phone or computer. The first one becomes your cover." : "Paste a link to a photo from your website below. The first one becomes your cover."}</p></div> : null}
          </div>
          {p.photos.length > 1 ? <p className="odfine">The cover is the big photo on your listing. Guests see the rest in this order.</p> : null}
          <div className="odaddoff">
            <input value={newPhoto} disabled={p.photos.length >= PHOTOS_MAX} onChange={(e) => setNewPhoto(e.target.value)} aria-label="Photo web address" placeholder={p.photos.length >= PHOTOS_MAX ? "Gallery is full (" + PHOTOS_MAX + ")" : "https://yoursite.com/photo.jpg"} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPhoto(); } }} />
            <button type="button" className="cta small" disabled={!photoUrlOk(newPhoto) || p.photos.length >= PHOTOS_MAX} onClick={addPhoto}><Markup html={OD_ICONS.plus} /> Add</button>
          </div>
          {newPhoto.trim() && !photoUrlOk(newPhoto) ? <p className="odfine warn">Paste the full link to the image, starting with https://</p> : null}
        </section>
      </div>
    </div>
  );
}
