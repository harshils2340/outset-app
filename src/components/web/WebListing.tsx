import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { apiConfig } from "../../lib/api";
import { GUIDES } from "../../data/guides";
import { ICONS } from "../../data/icons";
import { metroById } from "../../data/metros";
import { SLOT_TIMES } from "../../data/slots";
import type { Unclaimed } from "../../data/types";
import { addressLine, contactFor, fmtHours, fmtPhone, fromPrice, getCatalog, listingFacts, mapsHref, perPerson, plainWords, publicRating, telHref } from "../../lib/catalog";
import { DAYS, fmtDate, fmtReviews, fmtTime, money, priceWith } from "../../lib/format";
import { SIZES, srcSet, thumb } from "../../lib/images";
import { embedAutoplay, isGif, listingMedia, photoCandidates, probePhotos, type Media } from "../../lib/media";
import { cleanDesc, durationLabel, freeCancel, minAge } from "../../lib/listingDerive";
import { clockIn, itemOpenState, itemWeek, zoneFor } from "../../lib/openNow";
import { DAY_SHORT, clock12, dayLabel, todaysDeals } from "../../lib/companyAgent";
import { fmtDistance, kmBetween, nearestLocation } from "../../lib/places";
import { priceUnclaimed } from "../../lib/pricing";
import { listingUrl } from "../../lib/site";
import { useApp } from "../../state/AppProvider";
import { Photo } from "../art/Photo";
import { WebAssistant } from "./WebAssistant";
import { Markup } from "../Markup";
import { SlotCalendar } from "../booking/SlotCalendar";

/**
 * Desktop listing page. Airbnb hotel layout (photo grid, details left, sticky booking card right, similar below)
 * with the sections a Viator tour page or a GetMyBoat trip page carries: highlights, what's included, who can go,
 * what to bring, meeting point and check-in, cancellation policy, FAQ, videos. Every section shows only what the
 * operator's own site states. Nothing is invented to fill a gap, and empty sections stay hidden.
 */

const KIND: Record<string, string> = {
  skydive: "a tandem skydive", heli: "a helicopter tour", balloon: "a balloon flight", kart: "karting", escape: "an escape room",
  axe: "axe throwing", paintball: "paintball", horse: "a trail ride", jetski: "a jet ski session", pontoon: "a pontoon day",
  fishing: "a fishing charter", parasail: "parasailing", cruise: "a sunset cruise", kayak: "a paddle",
  bowling: "bowling", minigolf: "mini golf", arcade: "an arcade session", trampoline: "a trampoline park", lasertag: "laser tag", icerink: "ice skating", waterpark: "a water park day", themepark: "a theme park day", zoo: "a zoo visit", aquarium: "an aquarium visit", karaoke: "a karaoke room", climbing: "a climbing session", range: "a range session", archery: "archery", golf: "a round of golf", zipline: "a zipline", ski: "a day on the mountain", bike: "a bike rental", snowmobile: "a snowmobile ride", rafting: "a rafting trip", scuba: "a dive", surf: "a surf lesson", paragliding: "a tandem paraglide", gliding: "a glider flight", brewery: "a brewery visit", winery: "a wine tasting", distillery: "a distillery tour", cooking: "a cooking class", spa: "a spa visit", yoga: "a yoga class", dance: "a dance class", pottery: "a pottery class", tour: "a tour", rage: "a rage room session", theatre: "a show", museum: "a museum visit", garden: "a garden visit", camping: "a night under the stars", tennis: "a court booking", swim: "a swim", martialarts: "a class", gymnastics: "a gymnastics session", fitness: "a class", venue: "a venue booking", sailing: "a sail", discgolf: "a round", billiards: "a table", motorsport: "a ride", sauna: "a sauna session",
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
        {u.dur || u.fc ? <small className="wcardfacts">{u.dur ? <span>{u.dur.replace(/\s+to\s+/, "–").replace(/\s*hours?\b/, " hr").replace(/\s*minutes?\b|\s*mins?\b/, " min")}</span> : null}{u.fc ? <span className="fc">Free cancellation</span> : null}</small> : null}
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

/** TikTok's creator embed needs its script once per page; it upgrades every tiktok-embed blockquote it finds. */
function TikTokScript() {
  useEffect(() => {
    const id = "tiktok-embed-js";
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) existing.remove();
    const s = document.createElement("script");
    s.id = id;
    s.async = true;
    s.src = "https://www.tiktok.com/embed.js";
    document.body.appendChild(s);
  }, []);
  return null;
}

/**
 * One tile of the hero. The first slot plays the operator's clip or embed when there is one, otherwise the cover.
 * A tile that fails to load, or turns out to be a tiny logo, reports itself broken and the grid re-picks its layout
 * around the media that is actually there; nothing on this page ever falls back to placeholder art.
 */
function HeroTile({ m, item, i, onBroken }: { m: Media; item: Unclaimed; i: number; onBroken: () => void }) {
  if (m.kind === "embed") {
    return <iframe className="wembed" src={embedAutoplay(m.src)} title={item.title + " video"} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />;
  }
  if (m.kind === "clip") {
    return <Photo src={m.poster} video={m.src} kind={item.art} id={"wl" + item.id} alt={item.title} size="hero" fallback={false} onBroken={onBroken} />;
  }
  // Photo tries the proxy, then the operator's original, before giving up, and reports a logo-sized file as broken.
  return <Photo src={m.src} kind={item.art} id={"wl" + item.id + i} alt={i === 0 ? item.title : item.title + " photo " + (i + 1)} size={i === 0 ? "hero" : "wide"} fallback={false} onBroken={onBroken} />;
}

const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

/** The lightbox slide: a full-size photo, the clip with controls, or the embed as a player. */
function GallerySlide({ m, item, index }: { m: Media; item: Unclaimed; index: number }) {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  if (m.kind === "embed") {
    return <iframe className="wgalleryembed" src={m.src} title={item.title + " video"} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen onClick={stop} />;
  }
  if (m.kind === "clip" && !isGif(m.src)) {
    return <video className="wgalleryimg" src={m.src} poster={thumb(m.poster, "full")} controls autoPlay muted loop playsInline onClick={stop} aria-label={item.title + " video"} />;
  }
  return <img className="wgalleryimg" src={m.kind === "clip" ? m.src : thumb(m.src, "full")} alt={item.title + " photo " + (index + 1)} decoding="async" fetchPriority="high" referrerPolicy="no-referrer" onClick={stop} />;
}

function Bullets({ items, icon = ICONS.check, className = "" }: { items: string[]; icon?: string; className?: string }) {
  return (
    <ul className={"wbullets " + className}>
      {items.map((t) => (
        <li key={t}>
          <Markup html={icon} />
          <span>{plainWords(t)}</span>
        </li>
      ))}
    </ul>
  );
}

export function WebListing({ item, onClose, onOpen }: { item: Unclaimed; onClose: () => void; onOpen: (id: string) => void }) {
  const { state, dates, confirmUnclaimed, setDate } = useApp();
  const metro = metroById(item.metroId);
  const score = publicRating(item);
  const contact = contactFor(item);
  const address = contact ? addressLine(contact) : null;
  const facts = listingFacts(item);
  const guide = GUIDES[item.art];
  // The hero lays itself out from the media that really loads. Every photo is probed at thumbnail size up front so a
  // dead URL or a 40 px logo never claims a tile; a tile that still fails later drops out and the grid re-picks.
  const candidates = photoCandidates(item);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const drop = (src: string) => setBroken((b) => (b.has(src) ? b : new Set(b).add(src)));
  const media = listingMedia(item, broken);
  const hasVideo = media[0]?.kind !== "photo" && media.length > 0;
  useEffect(() => probePhotos(candidates.slice(0, 12), drop), [candidates.join("|")]);

  const [time, setTime] = useState<string | null>(null);
  const [qty, setQty] = useState(2);
  const [optionIdx, setOptionIdx] = useState<number | null>(item.options.length === 1 ? 0 : null);
  useEffect(() => {
    if (optionIdx == null && item.options.length === 1) setOptionIdx(0);
  }, [item.options.length]);
  const [addonIdx, setAddonIdx] = useState<number[]>([]);
  const [openSvc, setOpenSvc] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [guest, setGuest] = useState<{ name: string; phone: string; email?: string }>(() => {
    try {
      return JSON.parse(localStorage.getItem("outset.guest") || "") || { name: "", phone: "", email: "" };
    } catch {
      return { name: "", phone: "" };
    }
  });
  const guestOk = guest.name.trim().length >= 2 && guest.phone.replace(/\D/g, "").length >= 10;
  const [payments, setPayments] = useState(false);
  useEffect(() => { let alive = true; void apiConfig().then((c) => { if (alive) setPayments(c.payments); }); return () => { alive = false; }; }, []);
  const [gallery, setGallery] = useState<number | null>(null);

  useEffect(() => {
    if (gallery == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGallery(null);
      if (e.key === "ArrowRight") setGallery((g) => (g == null ? g : (g + 1) % media.length));
      if (e.key === "ArrowLeft") setGallery((g) => (g == null ? g : (g - 1 + media.length) % media.length));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [gallery, media.length]);
  useEffect(() => {
    // A tile dropping out of the list must not leave the lightbox pointing past the end.
    if (gallery != null && gallery >= media.length) setGallery(media.length ? media.length - 1 : null);
  }, [gallery, media.length]);

  const picked = optionIdx != null ? item.options[optionIdx] : null;
  const extras = addonIdx.map((i) => (item.addons || [])[i]).filter(Boolean);
  const p = priceUnclaimed(picked, qty, extras);
  const needService = item.options.length > 0;
  // Attractions sell entry, not a slot. With no menu to book, the card becomes hours plus a tickets link.
  const VISIT_ARTS = new Set(["zoo", "aquarium", "themepark", "waterpark", "museum", "garden", "theatre", "arcade", "icerink", "trampoline", "bowling", "minigolf", "billiards", "camping", "sauna", "swim", "tennis", "discgolf", "venue", "brewery", "winery", "distillery"]);
  const visit = !needService && VISIT_ARTS.has(item.art);
  const visitOpen = useMemo(() => (visit ? itemOpenState(item) : null), [visit, item]);
  const visitWeek = useMemo(() => (visit ? itemWeek(item) : null), [visit, item]);
  const clock = (m: number) => fmtTime(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  const ready = time != null && (!needService || picked != null) && guestOk;
  const day = dates[state.dateIdx];
  // Today only shows start times at least an hour out. Nobody can book a 7 AM slot at 8:30.
  const openSlots = useMemo(() => {
    if (state.dateIdx !== 0) return SLOT_TIMES;
    const now = new Date();
    const cutoff = now.getHours() * 60 + now.getMinutes() + 60;
    return SLOT_TIMES.filter((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) >= cutoff);
  }, [state.dateIdx]);
  useEffect(() => { if (time && !openSlots.includes(time)) setTime(null); }, [openSlots, time]);

  const similar = useMemo(() => {
    const all = getCatalog().filter((u) => u.id !== item.id && u.art === item.art);
    const near = all.filter((u) => u.metroId && u.metroId === item.metroId);
    // Same metro first, then the same state or province, then anywhere. Nobody in Washington DC wants San Jose.
    const region = (item.area.match(/,\s*([A-Z]{2})\b/) || [])[1];
    const sameRegion = region ? all.filter((u) => u.area.endsWith(", " + region)) : [];
    const pool = near.length >= 4 ? near : sameRegion.length >= 4 ? sameRegion : near.length ? [...near, ...sameRegion] : all;
    return pool.sort((a, b) => (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || (b.reviews || 0) - (a.reviews || 0)).slice(0, 7);
  }, [item.id]);

  /* ---------- derived, never invented ---------- */
  const requirements = item.requirements?.length ? item.requirements : facts.who.filter((l) => l.posted).map((l) => l.text);
  const includes = item.includes.filter((l) => !/\bnot included|excluded|not provided|bring your own\b/i.test(l));
  const notIncluded = item.includes.filter((l) => /\bnot included|excluded|not provided\b/i.test(l)).map((l) => l.replace(/\s*\(?not included\)?/i, "").trim());
  const reqKeys = new Set(requirements.map((r) => r.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const highlights = (item.highlights?.length ? item.highlights : facts.about.slice(0, 6)).filter((h) => !reqKeys.has(h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const waiverLines = (item.policies?.filter((l) => /\bwaivers?\b|\bliabilit|\brelease form|\bsign(ed|ing)? (a |the |our |your )?(waiver|release|form)|\bcheck-?in\b/i.test(l)) || facts.waiver.filter((l) => l.posted).map((l) => l.text)).filter((l) => l.length <= 160);
  const otherPolicies = (item.policies || []).filter((l) => !/cancel|refund|waiver|liabilit/i.test(l));
  const cancel = item.fc || freeCancel(item.cancellation);
  const age = minAge(requirements);
  const duration = item.dur || durationLabel(item);
  const openNow = itemOpenState(item);
  const dealsNow = todaysDeals(item);
  const today = item.promos?.length ? clockIn(zoneFor(item)).day : -1;
  const badges: { icon: string; text: string }[] = [];
  if (openNow) badges.push({ icon: ICONS.clock, text: openNow.label });
  if (score && score.rating >= 4.8 && score.reviews >= 100) badges.push({ icon: ICONS.star, text: "Top rated" });
  else if (score && score.reviews >= 1000) badges.push({ icon: ICONS.star, text: "Popular" });
  if (cancel) badges.push({ icon: ICONS.check, text: cancel });
  if (item.claimed && item.instant) badges.push({ icon: ICONS.bolt, text: "Instant confirmation" });
  const quick: { icon: string; label: string; value: string }[] = [];
  if (duration) quick.push({ icon: ICONS.clock, label: "Duration", value: duration });
  if (age) quick.push({ icon: ICONS.user, label: "Minimum age", value: age + "+" });
  if (item.groupInfo?.length) {
    const cap = item.groupInfo.map((g) => g.match(/(\d{1,3})\s*(?:guests?|people|passengers|riders|max)/i)).find(Boolean);
    if (cap) quick.push({ icon: ICONS.user, label: "Group size", value: "Up to " + cap[1] });
  }
  if (item.season) quick.push({ icon: ICONS.compass, label: "Season", value: item.season });
  if (item.waiverUrl) quick.push({ icon: ICONS.ticket, label: "Waiver", value: "Sign online before you arrive" });
  const hours = item.hoursText?.length ? item.hoursText : contact?.hours.map(fmtHours) || [];

  const book = () => {
    if (!ready || !time) return;
    try {
      localStorage.setItem("outset.guest", JSON.stringify(guest));
    } catch {
      /* ignore */
    }
    confirmUnclaimed({ dateIdx: state.dateIdx, slot: time, qty, optionIdx, addonIdx, guest: { name: guest.name.trim(), phone: guest.phone.trim(), email: (guest.email || "").trim() || undefined } });
    setDone(true);
  };

  return (
    <div className="wlisting">
      <div className="wwrap">
        <button type="button" className="wback" onClick={onClose}>
          <Markup html={ICONS.back} /> Back to results
        </button>

        {state.removeId === item.id ? (
          <div className="wremove">
            <b>Is this your business and you'd rather not be listed?</b>
            <span>We take listings down within one business day. Send one line from a company email and it's gone.</span>
            <a className="cta small" href={"mailto:harshils2340@gmail.com?subject=" + encodeURIComponent("Remove listing: " + item.title + " (" + item.id + ")") + "&body=" + encodeURIComponent("Please remove " + item.title + " from Outset.\n\nListing: " + listingUrl(item.id) + "\n")}>Request removal</a>
          </div>
        ) : null}
        <h1 className="wtitle">{item.title}</h1>
        <div className="wsub">
          {score ? (
            <span className="wrate">
              <Markup html={ICONS.star} /> <b>{score.rating.toFixed(1)}</b> · {fmtReviews(score.reviews)} reviews
            </span>
          ) : null}
          <span>{item.area}{metro && !item.area.includes(metro.name) ? ", " + metro.name : ""}</span>
          {(() => {
            const n = state.near ? nearestLocation(item, state.near) : null;
            if (!n) return null;
            return <span className="wdot wdist"><Markup html={ICONS.pin} /> {fmtDistance(n.km)} from {state.near!.label}{n.alt ? " to their " + n.label + " location" : ""}</span>;
          })()}
          {item.locations?.length ? <span className="wdot">{item.locations.length + 1} locations</span> : null}
          <span className="wdot">{plainWords(KIND[item.art] || "experience").replace(/^(a|an) /, "")}</span>
        </div>
        {badges.length ? (
          <div className="wbadges">
            {badges.map((b) => (
              <span key={b.text} className="wbadgechip"><Markup html={b.icon} /> {b.text}</span>
            ))}
          </div>
        ) : null}
        {dealsNow.length ? (
          <div className="wdeal" aria-label="Today's deal">
            <Markup html={ICONS.bolt} />
            <span>
              <b>Today's deal{dealsNow.length > 1 ? "s" : ""}</b>
              {dealsNow.map((p) => (
                <small key={p.text}>{plainWords(p.text)}{p.end ? " · until " + clock12(p.end) : p.start ? " · from " + clock12(p.start) : ""}</small>
              ))}
            </span>
          </div>
        ) : null}
        {item.quotes?.length ? (
          <div className="wquotes" aria-label="What guests say">
            {item.quotes.slice(0, 2).map((r, i) => (
              <blockquote key={i} className="wquote">
                <p>“{r.text.length > 170 ? r.text.slice(0, 170).replace(/\s+\S*$/, "") + "…" : r.text}”</p>
                <footer>
                  {r.rating ? <span className="wquotestars">{"★".repeat(Math.round(r.rating))}</span> : null}
                  <span>{r.author || "A guest"}</span>
                </footer>
              </blockquote>
            ))}
          </div>
        ) : null}

        {media.length ? (
          <div className={"wphotos n" + Math.min(media.length, 5)}>
            {media.slice(0, 5).map((m, i) => (
              <button type="button" className={"wphoto " + (i === 0 ? "main" : "p" + (i - 1))} key={m.src} onClick={() => setGallery(i)} aria-label={i === 0 ? "Open photos" : "Open photo " + (i + 1)}>
                <HeroTile m={m} item={item} i={i} onBroken={() => drop(m.src)} />
              </button>
            ))}
            {media.length > 1 ? (
              <button type="button" className="wmore" onClick={() => setGallery(0)}>
                {hasVideo ? "Show video and " + (media.length - 1) + (media.length === 2 ? " photo" : " photos") : "Show all " + media.length + " photos"}
              </button>
            ) : null}
          </div>
        ) : (
          <hr className="wrule" />
        )}

        {gallery != null && media[gallery] ? (
          <div className="wgallery" onClick={() => setGallery(null)} role="dialog" aria-label="Photos">
            <div className="wgalleryhead" onClick={(e) => e.stopPropagation()}>
              <span>{gallery + 1} / {media.length}</span>
              <b>{item.title}</b>
              <button type="button" className="wgalleryclose" onClick={() => setGallery(null)} aria-label="Close">
                <Markup html={ICONS.close} />
              </button>
            </div>
            <button type="button" className="wgallerynav prev" onClick={(e) => { e.stopPropagation(); setGallery((gallery - 1 + media.length) % media.length); }} aria-label="Previous photo" disabled={media.length < 2}>
              <Markup html={ICONS.back} />
            </button>
            <GallerySlide m={media[gallery]} item={item} index={gallery} />
            <button type="button" className="wgallerynav next" onClick={(e) => { e.stopPropagation(); setGallery((gallery + 1) % media.length); }} aria-label="Next photo" disabled={media.length < 2}>
              <Markup html={ICONS.back} />
            </button>
            <div className="wgallerystrip" onClick={(e) => e.stopPropagation()}>
              {media.map((m, i) => (
                <button type="button" key={m.src} aria-pressed={i === gallery} onClick={() => setGallery(i)} aria-label={m.kind === "photo" ? "Photo " + (i + 1) : "Video"}>
                  {m.kind === "photo" || (m.kind === "clip" && m.poster) ? (
                    <img src={thumb(m.kind === "photo" ? m.src : m.poster, "thumb")} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="wgalleryplay"><Markup html={PLAY} /></span>
                  )}
                  {m.kind !== "photo" ? <span className="wgalleryplay over"><Markup html={PLAY} /></span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className={"wcols" + (media.length ? "" : " nohero")}>
          <div className="wmain">
            {quick.length ? (
              <div className="wquick">
                {quick.map((q) => (
                  <div key={q.label}>
                    <Markup html={q.icon} />
                    <span><small>{q.label}</small><b>{q.value}</b></span>
                  </div>
                ))}
              </div>
            ) : null}

            {item.blurb ? (
              <p className="wblurb lead">{cleanDesc(item.blurb).replace(/\s+(Book|Learn more|Read more|Reserve)\.?$/i, "")}</p>
            ) : null}

            {highlights.length ? (
              <section className="wsec first">
                <h2>Highlights</h2>
                <Bullets items={highlights} className="two" />
              </section>
            ) : null}

            {guide ? <section className="wsec">
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
            </section> : null}

            {item.services && item.services.length ? (
              <section className="wsec">
                <h2>What you can book</h2>
                <div className="wmenu">
                  {item.services.map((svc, svcIdx) => (
                    <div className={"wsvc" + (svc.photo ? " haspic" : "")} key={svc.name + "|" + svcIdx}>
                      {svc.photo ? <img className="wsvcpic" src={thumb(svc.photo, "thumb")} srcSet={srcSet(svc.photo, "thumb")} sizes={SIZES.thumb} alt={plainWords(svc.name)} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} /> : null}
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

            {includes.length || notIncluded.length ? (
              <section className="wsec wfacts">
                {includes.length ? (
                  <div>
                    <h2>What's included</h2>
                    <Bullets items={includes} />
                  </div>
                ) : null}
                {notIncluded.length ? (
                  <div>
                    <h2>Not included</h2>
                    <Bullets items={notIncluded} icon={ICONS.close} className="no" />
                  </div>
                ) : null}
              </section>
            ) : null}

            {requirements.length || item.bring?.length || item.groupInfo?.length || waiverLines.length ? (
            <section className="wsec wfacts">
              {requirements.length ? (
              <div>
                <h2>Who can go</h2>
                <Bullets items={requirements} icon={ICONS.dot} />
              </div>
              ) : null}
              <div>
                {item.bring?.length ? (
                  <>
                    <h2>What to bring</h2>
                    <Bullets items={item.bring} icon={ICONS.dot} />
                  </>
                ) : item.groupInfo?.length ? (
                  <>
                    <h2>Groups</h2>
                    <Bullets items={item.groupInfo} icon={ICONS.dot} />
                  </>
                ) : waiverLines.length ? (
                  <>
                    <h2>Waiver and check-in</h2>
                    <Bullets items={waiverLines} icon={ICONS.dot} />
                  </>
                ) : null}
              </div>
            </section>
            ) : null}

            {item.bring?.length && item.groupInfo?.length ? (
              <section className="wsec">
                <h2>Groups</h2>
                <Bullets items={item.groupInfo} icon={ICONS.dot} />
              </section>
            ) : null}

            <section className="wsec">
              <h2>Meeting point and check-in</h2>
              <div className="wmeet">
                <div className="contact">
                  <a className="crow" href={contact ? mapsHref(contact, item.title + " " + item.area) : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(item.title + " " + item.area)} target="_blank" rel="noreferrer">
                    <Markup html={ICONS.pin} />
                    <span><b>{item.meetingPoint || address || item.area}</b><small>{item.meetingPoint && address && item.meetingPoint !== address ? address + " · Open in Maps" : address ? "Open in Maps" : "Find on the map"}</small></span>
                  </a>
                  {contact?.phone ? (
                    <a className="crow" href={telHref(contact.phone)}>
                      <Markup html={ICONS.phone} />
                      <span><b>{fmtPhone(contact.phone)}</b><small>Call a person at the shop</small></span>
                    </a>
                  ) : null}
                  {hours.length ? (
                    <div className="crow">
                      <Markup html={ICONS.clock} />
                      <span>{hours.map((h) => <b key={h}>{h}</b>)}<small>Hours</small></span>
                    </div>
                  ) : null}
                </div>
                {item.checkin ? (
                  <div className="wcheckin">
                    <p className="guidehead">When you arrive</p>
                    <p>{plainWords(item.checkin)}</p>
                  </div>
                ) : null}
              </div>
              {item.locations?.length ? (
                <div className="wvenues">
                  <p className="guidehead">{item.locations.length + 1} locations{state.near ? ", nearest to " + state.near.label + " first" : ""}</p>
                  <div className="wvenuegrid">
                    {[{ city: item.area, lat: item.lat, lon: item.lon, street: address || undefined, primary: true }, ...item.locations.map((l) => ({ ...l, city: l.city + (l.region ? ", " + l.region : ""), primary: false }))]
                      .map((v) => ({ ...v, km: state.near && v.lat != null && v.lon != null ? kmBetween(state.near, { lat: v.lat, lon: v.lon }) : null }))
                      .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity))
                      .slice(0, 24)
                      .map((v, i) => (
                        <a key={i} className="wvenue" href={"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((v.street ? v.street + ", " : "") + v.city)} target="_blank" rel="noreferrer">
                          <b>{v.city}</b>
                          <small>{v.street || (v.primary ? "Main location" : "")}{v.km != null ? (v.street || v.primary ? " · " : "") + fmtDistance(v.km) + " away" : ""}</small>
                        </a>
                      ))}
                  </div>
                </div>
              ) : null}
            </section>

            {item.promos?.length ? (
              <section className="wsec" id="deals">
                <h2>Deals</h2>
                <p className="wdealnote">From {item.title}'s own site. Days are in their local time.</p>
                <ul className="wdeals">
                  {item.promos.map((p) => {
                    const on = dealsNow.includes(p);
                    return (
                      <li key={p.text} className={on ? "on" : ""}>
                        <span className="wdealchips" aria-label={dayLabel(p.days)}>
                          {p.days.length ? DAY_SHORT.map((d, i) => (
                            <i key={d} className={p.days.includes(i) ? (i === today ? "hit today" : "hit") : ""}>{d}</i>
                          )) : <i className={"hit" + (on ? " today" : "")}>Every day</i>}
                        </span>
                        <span className="wdealtext">
                          {plainWords(p.text)}
                          {p.start || p.end ? <small>{p.start ? clock12(p.start) : "Open"} to {p.end ? clock12(p.end) : "close"}</small> : null}
                          {on ? <em>Today</em> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {item.cancellation || item.waiverUrl || waiverLines.length && (item.bring?.length || item.groupInfo?.length) || otherPolicies.length ? (
              <section className="wsec">
                <h2>Cancellation policy</h2>
                {item.cancellation ? <p className="wpolicytext">{plainWords(item.cancellation)}</p> : <p className="wpolicytext gap">{item.title} has not published cancellation terms. Otto will have them confirm before you pay.</p>}
                {otherPolicies.length ? <Bullets items={otherPolicies} icon={ICONS.dot} /> : null}
                {item.waiverUrl ? (
                  <a className="wwaiver" href={item.waiverUrl} target="_blank" rel="noreferrer">
                    <Markup html={ICONS.ticket} />
                    <span><b>Sign the waiver online before you arrive</b><small>Saves time at check-in. Opens the operator's waiver form.</small></span>
                  </a>
                ) : null}
              </section>
            ) : null}

            {item.faq?.length ? (
              <section className="wsec">
                <h2>Frequently asked questions</h2>
                <div className="wfaq">
                  {item.faq.map((f, i) => (
                    <div key={i} className={"wfaqitem" + (openFaq === i ? " open" : "")}>
                      <button type="button" onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
                        <span>{plainWords(f.q)}</span>
                        <Markup html={openFaq === i ? ICONS.chevUp : ICONS.chevDown} />
                      </button>
                      {openFaq === i ? <p>{plainWords(f.a)}</p> : null}
                    </div>
                  ))}
                </div>
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

            {score || item.quotes?.length ? (
              <section className="wsec">
                <h2>Reviews</h2>
                {score ? (
                  <div className="wreviews">
                    <b>{score.rating.toFixed(1)}</b>
                    <span>
                      <span className="wstars" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <Markup key={i} html={ICONS.star} />)}</span>
                      <small>{fmtReviews(score.reviews)} public reviews{item.quotes?.length ? "" : ". Written reviews arrive once guests book through Outset."}</small>
                    </span>
                  </div>
                ) : null}
                {item.quotes?.length ? (
                  <div className="wreviewgrid">
                    {item.quotes.map((r, i) => (
                      <article key={i} className="wreview">
                        <header>
                          <span className="wavatar sm">{(r.author || "G").slice(0, 1).toUpperCase()}</span>
                          <span className="meta"><b>{r.author || "A guest"}</b>{r.rating ? <small className="wquotestars">{"★".repeat(Math.round(r.rating))}</small> : r.date ? <small>{r.date}</small> : null}</span>
                        </header>
                        <p>{r.text}</p>
                      </article>
                    ))}
                    <p className="wreviewnote">Reviews the operator publishes on their own site. Verified reviews from Outset bookings will show here too.</p>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>

          <aside className="wbook">
            {visit ? (
              // A place you walk into: a zoo, a museum, a show. Hours and the door, not a time slot.
              <div className="wbookcard">
                <div className="wbookhead">
                  <span><b>Plan your visit</b></span>
                  {score ? <span className="wrate"><Markup html={ICONS.star} /> {score.rating.toFixed(1)}</span> : null}
                </div>
                {visitOpen ? <p className={"wopen" + (visitOpen.open ? " on" : "")}>{visitOpen.label}</p> : null}
                {visitWeek?.some((d) => d && d.close > d.open) ? (
                  <ul className="whours">{visitWeek.map((d, i) => <li key={i}><span>{DAYS[i]}</span>{d && d.close > d.open ? clock(d.open) + " to " + clock(d.close) : "Closed"}</li>)}</ul>
                ) : contact?.hours?.length ? (
                  <ul className="whours">{contact.hours.slice(0, 7).map((h) => <li key={h}>{h}</li>)}</ul>
                ) : (
                  <p className="wbooksub">Hours are not published. Call before you go.</p>
                )}
                {contact?.website || item.src ? (
                  <a className="cta" style={{ width: "100%", marginTop: 12, display: "block", textAlign: "center" }} href={contact?.website || item.src} target="_blank" rel="noreferrer">Get tickets</a>
                ) : contact?.phone ? (
                  <a className="cta" style={{ width: "100%", marginTop: 12, display: "block", textAlign: "center" }} href={telHref(contact.phone)}>Call to plan</a>
                ) : null}
                <p className="wbookfine">Tickets are sold by {item.title}. Prices and times on their side.</p>
              </div>
            ) : done ? (
              <div className="wbookcard">
                <div className="confmark"><Markup html={ICONS.check} /></div>
                <h3>{item.claimed && item.instant ? "You're booked" : "Request sent"}</h3>
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
                {duration || cancel ? (
                  <p className="wbookmeta">
                    {duration ? <span><Markup html={ICONS.clock} /> {duration}</span> : null}
                    {cancel ? <span><Markup html={ICONS.check} /> {cancel}</span> : null}
                  </p>
                ) : null}
                <div className="rowbetween" style={{ marginTop: 6, marginBottom: 6 }}>
                  <p className="guidehead" style={{ margin: 0 }}>Guests</p>
                  <span className="stepper">
                    <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} disabled={qty <= 1}>−</button>
                    <span className="n">{qty}</span>
                    <button type="button" onClick={() => setQty(Math.min(12, qty + 1))}>+</button>
                  </span>
                </div>
                <p className="guidehead">Date and time</p>
                <SlotCalendar
                  dates={dates}
                  dateIdx={state.dateIdx}
                  onPickDate={setDate}
                  slots={openSlots}
                  time={time}
                  onPickTime={setTime}
                  emptyNote="No more start times today. Pick another day."
                />
                {needService ? (
                  <p className="wpicked">{picked ? plainWords(picked.name + (picked.detail ? " · " + picked.detail : "")) : "Choose what to book on the left"}</p>
                ) : null}
                <p className="guidehead">Who's booking</p>
                <div className="wguest">
                  <input value={guest.name} placeholder="Your name" autoComplete="name" onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
                  <input value={guest.phone} placeholder="Mobile number" inputMode="tel" autoComplete="tel" onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
                  <input value={guest.email || ""} placeholder="Email for your confirmation" inputMode="email" autoComplete="email" onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
                </div>
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
                  {payments && p.total ? <p className="wpaynote">Secure card payment. Your card is held and only charged once the booking is confirmed.</p> : null}
                </div>
                <button type="button" className="cta" style={{ width: "100%" }} disabled={!ready} onClick={book}>
                  {ready ? (p.total ? (payments ? "Book and pay · " : "Book · ") + money(p.total) : "Book") : needService && !picked ? "Choose a service" : time == null ? "Pick a time" : "Add your name and number"}
                </button>
                <p className="wbookfoot">
                  {item.claimed && item.instant ? "Instant confirmation. " : "The operator confirms by text or email. "}
                  {cancel ? cancel + "." : item.cancellation ? "Cancellation terms are set by " + item.title + ", see the policy below." : "Cancellation terms are set by the operator."}
                </p>
              </div>
            )}
            <WebAssistant item={item} />
          </aside>
        </div>

        {similar.length ? (
          <section className="wrail">
            <div className="wrailhead"><h2>More like this{metro ? " near " + metro.name : ""}</h2></div>
            <div className="wrailrow">{similar.map((u) => <Card key={u.id} u={u} onOpen={onOpen} />)}</div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
