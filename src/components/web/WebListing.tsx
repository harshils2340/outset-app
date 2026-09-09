import { useEffect, useMemo, useState } from "react";
import { GUIDES } from "../../data/guides";
import { ICONS } from "../../data/icons";
import { metroById } from "../../data/metros";
import { SLOT_TIMES } from "../../data/slots";
import type { Unclaimed } from "../../data/types";
import { addressLine, contactFor, fmtHours, fmtPhone, fromPrice, getCatalog, listingFacts, mapsHref, perPerson, plainWords, publicRating, telHref } from "../../lib/catalog";
import { DAYS, fmtDate, fmtReviews, fmtTime, money, priceWith } from "../../lib/format";
import { fmtDistance, kmBetween } from "../../lib/places";
import { priceUnclaimed } from "../../lib/pricing";
import { useApp } from "../../state/AppProvider";
import { Photo } from "../art/Photo";
import { WebAssistant } from "./WebAssistant";
import { Markup } from "../Markup";

/**
 * Desktop listing page in the Airbnb hotel shape: photo grid, details on the left, sticky booking card on the right,
 * similar listings below. Same facts and booking rules as the phone sheet.
 */

const KIND: Record<string, string> = {
  skydive: "a tandem skydive", heli: "a helicopter tour", balloon: "a balloon flight", kart: "karting", escape: "an escape room",
  axe: "axe throwing", paintball: "paintball", horse: "a trail ride", jetski: "a jet ski session", pontoon: "a pontoon day",
  fishing: "a fishing charter", parasail: "parasailing", cruise: "a sunset cruise", kayak: "a paddle",
};

function Card({ u, onOpen }: { u: Unclaimed; onOpen: (id: string) => void }) {
  const from = fromPrice(u);
  const score = publicRating(u);
  return (
    <button type="button" className="wcard" onClick={() => onOpen(u.id)}>
      <div className="wart">
        <Photo src={u.cover} video={u.video} kind={u.art} id={"s" + u.id} alt={u.title} />
      </div>
      <div className="wbody">
        <b>{u.title}</b>
        <small>{u.area}</small>
        <span className="wmeta">
          {from != null ? <span>From <b>{money(from)}</b></span> : <span>Request to book</span>}
          {score ? (
            <span className="wrate">
              <Markup html={ICONS.star} /> {score.rating.toFixed(1)}
            </span>
          ) : null}
        </span>
      </div>
    </button>
  );
}

/** Service copy straight from the operator's page, minus the button labels that get scraped along with it. */
function cleanDesc(raw: string): string {
  return plainWords(raw)
    .replace(/\b(SELECT|BOOK NOW|BOOK ONLINE|RESERVE NOW|LEARN MORE|READ MORE|CLICK HERE|ADD TO CART|BUY NOW)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** TikTok's creator embed needs its script once per page; it upgrades every tiktok-embed blockquote it finds. */
function TikTokScript() {
  useEffect(() => {
    const id = "tiktok-embed-js";
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      existing.remove();
    }
    const s = document.createElement("script");
    s.id = id;
    s.async = true;
    s.src = "https://www.tiktok.com/embed.js";
    document.body.appendChild(s);
  }, []);
  return null;
}

export function WebListing({ item, onClose, onOpen }: { item: Unclaimed; onClose: () => void; onOpen: (id: string) => void }) {
  const { state, dates, confirmUnclaimed, setDate } = useApp();
  const metro = metroById(item.metroId);
  const score = publicRating(item);
  const contact = contactFor(item);
  const address = contact ? addressLine(contact) : null;
  const facts = listingFacts(item);
  const guide = GUIDES[item.art];
  const candidates = [item.cover, ...(item.photos || []).filter((p) => p !== item.cover)].filter(Boolean) as string[];
  // Show every candidate right away, and drop the ones that fail to load or come back tiny.
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const photos = candidates.filter((c) => !broken.has(c));
  useEffect(() => {
    const imgs = candidates.map((src) => {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => { if (img.naturalWidth < 300) setBroken((b) => new Set(b).add(src)); };
      img.onerror = () => setBroken((b) => new Set(b).add(src));
      img.src = src;
      return img;
    });
    return () => imgs.forEach((i) => { i.onload = null; i.onerror = null; });
  }, [candidates.join("|")]);

  const [time, setTime] = useState<string | null>(null);
  const [qty, setQty] = useState(2);
  const [optionIdx, setOptionIdx] = useState<number | null>(item.options.length === 1 ? 0 : null);
  useEffect(() => {
    if (optionIdx == null && item.options.length === 1) setOptionIdx(0);
  }, [item.options.length]);
  const [addonIdx, setAddonIdx] = useState<number[]>([]);
  const [openSvc, setOpenSvc] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [gallery, setGallery] = useState<number | null>(null);

  useEffect(() => {
    if (gallery == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGallery(null);
      if (e.key === "ArrowRight") setGallery((g) => (g == null ? g : (g + 1) % photos.length));
      if (e.key === "ArrowLeft") setGallery((g) => (g == null ? g : (g - 1 + photos.length) % photos.length));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [gallery, photos.length]);

  const picked = optionIdx != null ? item.options[optionIdx] : null;
  const extras = addonIdx.map((i) => (item.addons || [])[i]).filter(Boolean);
  const p = priceUnclaimed(picked, qty, extras);
  const needService = item.options.length > 0;
  const ready = time != null && (!needService || picked != null);
  const day = dates[state.dateIdx];

  const similar = useMemo(() => {
    const all = getCatalog().filter((u) => u.id !== item.id && u.art === item.art);
    const near = all.filter((u) => u.metroId && u.metroId === item.metroId);
    const pool = near.length >= 4 ? near : all;
    return pool.sort((a, b) => (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || (b.reviews || 0) - (a.reviews || 0)).slice(0, 7);
  }, [item.id]);

  const book = () => {
    if (!ready || !time) return;
    confirmUnclaimed({ dateIdx: state.dateIdx, slot: time, qty, optionIdx, addonIdx });
    setDone(true);
  };

  return (
    <div className="wlisting">
      <div className="wwrap">
        <button type="button" className="wback" onClick={onClose}>
          <Markup html={ICONS.back} /> Back to results
        </button>

        <h1 className="wtitle">{item.title}</h1>
        <div className="wsub">
          {score ? (
            <span className="wrate">
              <Markup html={ICONS.star} /> <b>{score.rating.toFixed(1)}</b> · {fmtReviews(score.reviews)} reviews
            </span>
          ) : null}
          <span>{item.area}{metro && !item.area.includes(metro.name) ? ", " + metro.name : ""}</span>
          {state.near && item.lat != null && item.lon != null ? (
            <span className="wdot wdist"><Markup html={ICONS.pin} /> {fmtDistance(kmBetween(state.near, { lat: item.lat, lon: item.lon }))} from {state.near.label}</span>
          ) : null}
          <span className="wdot">{plainWords(KIND[item.art] || "experience").replace(/^(a|an) /, "")}</span>
          {item.src && !/^(osm-|gplace-)/.test(item.src) ? (
            <a className="wsrc" href={"https://" + item.src.replace(/^https?:\/\//, "")} target="_blank" rel="noreferrer">
              Source: {item.src.replace(/^https?:\/\//, "").replace(/^www\./, "")} ↗
            </a>
          ) : null}
        </div>

        <div className={"wphotos" + (photos.length >= 3 ? " grid" : " single")}>
          <button type="button" className="wphoto main" onClick={() => setGallery(0)} aria-label="Open photos">
            {!item.video && item.videoEmbed ? (
              <iframe className="wembed" src={item.videoEmbed + (item.videoEmbed.includes("?") ? "&" : "?") + "autoplay=1&mute=1&muted=1&loop=1&controls=0&playsinline=1&background=1"} title={item.title + " video"} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
            ) : (
              <Photo src={photos[0]} video={item.video} kind={item.art} id={"wl" + item.id} alt={item.title} />
            )}
          </button>
          {photos.length >= 3
            ? photos.slice(1, 5).map((src, i) => (
                <button type="button" className={"wphoto p" + i} key={src} onClick={() => setGallery(i + 1)} aria-label={"Open photo " + (i + 2)}>
                  <img src={src} alt={item.title + " photo " + (i + 2)} loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />
                </button>
              ))
            : null}
          {photos.length > 1 ? (
            <button type="button" className="wmore" onClick={() => setGallery(0)}>
              Show all {photos.length} photos
            </button>
          ) : null}
        </div>

        {gallery != null && photos.length ? (
          <div className="wgallery" onClick={() => setGallery(null)} role="dialog" aria-label="Photos">
            <div className="wgalleryhead" onClick={(e) => e.stopPropagation()}>
              <span>{gallery + 1} / {photos.length}</span>
              <b>{item.title}</b>
              <button type="button" className="wgalleryclose" onClick={() => setGallery(null)} aria-label="Close">
                <Markup html={ICONS.close} />
              </button>
            </div>
            <button type="button" className="wgallerynav prev" onClick={(e) => { e.stopPropagation(); setGallery((gallery - 1 + photos.length) % photos.length); }} aria-label="Previous photo" disabled={photos.length < 2}>
              <Markup html={ICONS.back} />
            </button>
            <img className="wgalleryimg" src={photos[gallery]} alt={item.title + " photo " + (gallery + 1)} referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} />
            <button type="button" className="wgallerynav next" onClick={(e) => { e.stopPropagation(); setGallery((gallery + 1) % photos.length); }} aria-label="Next photo" disabled={photos.length < 2}>
              <Markup html={ICONS.back} />
            </button>
            <div className="wgallerystrip" onClick={(e) => e.stopPropagation()}>
              {photos.map((src, i) => (
                <button type="button" key={src} aria-pressed={i === gallery} onClick={() => setGallery(i)}>
                  <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="wcols">
          <div className="wmain">
            {item.blurb ? (
              <p className="wblurb lead">
                {plainWords(item.blurb)} <span className="reqcredit">· From their website</span>
              </p>
            ) : null}

            <section className="wsec">
              <button type="button" className="wguidebtn" onClick={() => setGuideOpen((v) => !v)} aria-expanded={guideOpen}>
                <span>
                  <b>What {KIND[item.art] || "this"} is actually like</b>
                  <small>{guide.time}</small>
                </span>
                <Markup html={guideOpen ? ICONS.chevUp : ICONS.chevDown} />
              </button>
              {guideOpen ? (
                <div className="wguide">
                  <ol className="guidesteps">
                    {guide.steps.map((s, i) => (
                      <li key={i}>
                        <span className="n">{i + 1}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="wguidecols">
                    <div>
                      <p className="guidehead">Bring</p>
                      <div className="guidechips">{guide.bring.map((b) => <span className="guidechip" key={b}>{b}</span>)}</div>
                    </div>
                    <div>
                      <p className="guidehead">Good for</p>
                      <p className="guidetext">{guide.goodFor}</p>
                      <p className="guidehead">Nervous?</p>
                      <p className="guidetext">{guide.nerves}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            {item.services && item.services.length ? (
              <section className="wsec">
                <h2>What you can book</h2>
                <div className="wmenu">
                  {item.services.map((svc) => (
                    <div className={"wsvc" + (svc.photo ? " haspic" : "")} key={svc.name}>
                      {svc.photo ? <img className="wsvcpic" src={svc.photo} alt={plainWords(svc.name)} loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} /> : null}
                      <div className="wsvchead">
                        <b>{plainWords(svc.name)}</b>
                        {svc.desc && cleanDesc(svc.desc).length > 180 ? (
                          <button type="button" className="svcabout" onClick={() => setOpenSvc(openSvc === svc.name ? null : svc.name)}>
                            {openSvc === svc.name ? "Less" : "More"}
                          </button>
                        ) : null}
                      </div>
                      {svc.desc ? <p className="svcdesc">{openSvc === svc.name || cleanDesc(svc.desc).length <= 180 ? cleanDesc(svc.desc) : cleanDesc(svc.desc).slice(0, 180).replace(/\s+\S*$/, "") + "…"}</p> : null}
                      {svc.variants.map((v) => (
                        <button key={v.optionIdx} type="button" className="wvariant" aria-pressed={optionIdx === v.optionIdx} onClick={() => setOptionIdx(v.optionIdx)}>
                          <span className="tick"><Markup html={ICONS.check} /></span>
                          <span>{plainWords(v.label)}</span>
                          <b>{v.price != null ? priceWith(v.price, v.per) : "Price on request"}</b>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            ) : item.options.length ? (
              <section className="wsec">
                <h2>What you can book</h2>
                <div className="wmenu">
                  {item.options.map((o, i) => (
                    <button key={o.name + i} type="button" className="wvariant" aria-pressed={optionIdx === i} onClick={() => setOptionIdx(i)}>
                      <span className="tick"><Markup html={ICONS.check} /></span>
                      <span>{plainWords(o.name)}{o.detail ? " · " + plainWords(o.detail) : ""}</span>
                      <b>{o.price != null ? priceWith(o.price, o.per) : "Price on request"}</b>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {item.addons && item.addons.length ? (
              <section className="wsec">
                <h2>Add-ons</h2>
                <div className="wmenu">
                  {item.addons.map((a, i) => (
                    <button key={a.name} type="button" className="wvariant" aria-pressed={addonIdx.includes(i)} onClick={() => setAddonIdx((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}>
                      <span className="tick"><Markup html={ICONS.check} /></span>
                      <span>{a.name}</span>
                      <b>{a.price ? "+" + money(a.price) : "Free"}</b>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="wsec wfacts">
              <div>
                <h2>Who can go</h2>
                <ul className="policy">{facts.who.map((l) => <li key={l.text} className={l.posted ? undefined : "gap"}><Markup html={ICONS.dot} /><span>{l.text}</span></li>)}</ul>
              </div>
              <div>
                <h2>Waiver and check-in</h2>
                <ul className="policy">{facts.waiver.map((l) => <li key={l.text} className={l.posted ? undefined : "gap"}><Markup html={ICONS.dot} /><span>{l.text}</span></li>)}</ul>
              </div>
            </section>

            {facts.about.length || item.includes.length ? (
              <section className="wsec wfacts">
                {facts.about.length ? (
                  <div>
                    <h2>The experience</h2>
                    <ul className="policy">{facts.about.map((s) => <li key={s}><Markup html={ICONS.dot} /><span>{plainWords(s)}</span></li>)}</ul>
                  </div>
                ) : null}
                {item.includes.length ? (
                  <div>
                    <h2>Included</h2>
                    <ul className="policy">{item.includes.map((s) => <li key={s}><Markup html={ICONS.dot} /><span>{plainWords(s)}</span></li>)}</ul>
                  </div>
                ) : null}
              </section>
            ) : null}

            {(item.ytVideos && item.ytVideos.length) || item.tiktok ? (
              <section className="wsec">
                <h2>See it in action</h2>
                <p className="wsecsub">Videos from {item.title}'s own channels.</p>
                {item.ytVideos && item.ytVideos.length ? (
                  <div className={"wvideos" + (item.ytVideos.length === 1 ? " one" : "")}>
                    {item.ytVideos.slice(0, 2).map((v) => (
                      <div className="wvideo" key={v.id}>
                        <iframe
                          src={"https://www.youtube-nocookie.com/embed/" + v.id + "?rel=0&modestbranding=1"}
                          title={v.title}
                          loading="lazy"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                        <small>{v.title}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
                {item.tiktok ? (
                  <div className="wtiktok">
                    <blockquote className="tiktok-embed" cite={"https://www.tiktok.com/@" + item.tiktok} data-unique-id={item.tiktok} data-embed-type="creator" style={{ maxWidth: 780, minWidth: 288 }}>
                      <section>
                        <a target="_blank" rel="noreferrer" href={"https://www.tiktok.com/@" + item.tiktok}>@{item.tiktok} on TikTok</a>
                      </section>
                    </blockquote>
                    <TikTokScript />
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="wsec">
              <h2>Where you'll be</h2>
              <div className="contact">
                <a className="crow" href={contact ? mapsHref(contact, item.title + " " + item.area) : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(item.title + " " + item.area)} target="_blank" rel="noreferrer">
                  <Markup html={ICONS.pin} />
                  <span><b>{address || item.area}</b><small>{address ? "Open in Maps" : "Find on the map"}</small></span>
                </a>
                {contact?.phone ? (
                  <a className="crow" href={telHref(contact.phone)}>
                    <Markup html={ICONS.phone} />
                    <span><b>{fmtPhone(contact.phone)}</b><small>Call a person at the shop</small></span>
                  </a>
                ) : null}
                {contact && contact.hours.length ? (
                  <div className="crow">
                    <Markup html={ICONS.clock} />
                    <span>{contact.hours.map((h) => <b key={h}>{fmtHours(h)}</b>)}<small>Hours</small></span>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <aside className="wbook">
            {done ? (
              <div className="wbookcard">
                <div className="confmark"><Markup html={ICONS.check} /></div>
                <h3>You're booked</h3>
                <p className="wbooksub">{fmtDate(day)} · {time ? fmtTime(time) : ""} · {qty} {qty === 1 ? "guest" : "guests"}</p>
                <p className="wbooksub">{picked ? plainWords(picked.name + (picked.detail ? " · " + picked.detail : "")) : item.title}</p>
                <button type="button" className="cta" style={{ width: "100%", marginTop: 14 }} onClick={onClose}>Find another experience</button>
              </div>
            ) : (
              <div className="wbookcard">
                <div className="wbookhead">
                  {fromPrice(item) != null ? <span><b>{money(fromPrice(item) as number)}</b> from</span> : <span><b>Request to book</b></span>}
                  {score ? <span className="wrate"><Markup html={ICONS.star} /> {score.rating.toFixed(1)}</span> : null}
                </div>
                <p className="guidehead">Date</p>
                <div className="wdates">
                  {dates.slice(0, 8).map((dd, i) => (
                    <button key={i} type="button" className="date" aria-pressed={state.dateIdx === i} onClick={() => setDate(i)}>
                      <small>{i === 0 ? "Today" : i === 1 ? "Tmrw" : DAYS[dd.getDay()]}</small>
                      <b>{dd.getDate()}</b>
                    </button>
                  ))}
                </div>
                <p className="guidehead">Time</p>
                <div className="wslots">
                  {SLOT_TIMES.map((t) => (
                    <button key={t} type="button" className="slot" aria-pressed={time === t} onClick={() => setTime(t)}><b>{fmtTime(t)}</b></button>
                  ))}
                </div>
                <div className="rowbetween" style={{ marginTop: 14 }}>
                  <p className="guidehead" style={{ margin: 0 }}>Guests</p>
                  <span className="stepper">
                    <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} disabled={qty <= 1}>−</button>
                    <span className="n">{qty}</span>
                    <button type="button" onClick={() => setQty(Math.min(12, qty + 1))}>+</button>
                  </span>
                </div>
                {needService ? (
                  <p className="wpicked">{picked ? plainWords(picked.name + (picked.detail ? " · " + picked.detail : "")) : "Choose what to book on the left"}</p>
                ) : null}
                <div className="lines">
                  {p.base && picked ? (
                    <div className="line">
                      <span>{plainWords(picked.name)}{perPerson(picked) ? " × " + qty + (qty === 1 ? " guest" : " guests") : ""}</span>
                      <b>{money(p.base)}</b>
                    </div>
                  ) : null}
                  {extras.map((a) => <div className="line" key={a.name}><span>{a.name}</span><b>{money(a.price ?? 0)}</b></div>)}
                  {p.fee ? <div className="line"><span>Service fee</span><b>{money(p.fee)}</b></div> : null}
                  <div className="line total"><span>Total</span><b>{p.total ? money(p.total) : "Pay on site"}</b></div>
                </div>
                <button type="button" className="cta" style={{ width: "100%" }} disabled={!ready} onClick={book}>
                  {ready ? (p.total ? "Book · " + money(p.total) : "Book") : needService && !picked ? "Choose a service" : "Pick a time"}
                </button>
                <p className="wbookfoot">Instant confirmation. Free cancellation up to 24 hours before unless the operator says otherwise.</p>
              </div>
            )}
            <WebAssistant item={item} />
          </aside>
        </div>

        {similar.length ? (
          <section className="wrail">
            <div className="wrailhead"><h2>More {KIND[item.art]?.replace(/^(a|an) /, "") || "experiences"}{metro ? " near " + metro.name : ""}</h2></div>
            <div className="wrailrow">{similar.map((u) => <Card key={u.id} u={u} onOpen={onOpen} />)}</div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
