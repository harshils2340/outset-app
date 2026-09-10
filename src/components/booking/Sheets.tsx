import { useEffect, useState } from "react";
import { CATS } from "../../data/categories";
import { GUIDES } from "../../data/guides";
import { ICONS } from "../../data/icons";
import { ALL_METRO_ID, METROS, metroById, metroLabel } from "../../data/metros";
import { SLOT_TIMES } from "../../data/slots";
import type { Unclaimed, UnclaimedOption } from "../../data/types";
import {
  addressLine,
  contactFor,
  fmtHours,
  fmtPhone,
  fromPrice,
  getCatalog,
  listingFacts,
  mapsDirHref,
  mapsQuery,
  optionLabel,
  placeLabel,
  plainWords,
  publicRating,
  telHref,
  type FactLine,
} from "../../lib/catalog";
import { DAYS, fmtDate, fmtReviews, fmtTime, money, priceWith, unitLine } from "../../lib/format";
import { formatDistance, milesBetween, type GeoPoint } from "../../lib/geo";
import { priceFor, priceUnclaimed } from "../../lib/pricing";
import { useApp } from "../../state/AppProvider";
import { SIZES, srcSet, thumb } from "../../lib/images";
import { cleanDesc, durationLabel, freeCancel, minAge } from "../../lib/listingDerive";
import { DAY_SHORT, clock12, dayLabel, todaysDeals } from "../../lib/companyAgent";
import { clockIn, zoneFor } from "../../lib/openNow";
import { itemOpenState } from "../../lib/openNow";
import { Photo } from "../art/Photo";
import { Markup } from "../Markup";

const QTY_MAX = 8;

export function Sheets() {
  const { state, listing, reqTarget, dates, closeSheet, confirm, confirmUnclaimed, setMetro, openChat } = useApp();
  const on = state.sheet !== null;

  return (
    <>
      <div className={"scrim" + (on ? " on" : "")} onClick={closeSheet} />
      <div className={"sheet" + (on ? " on" : "")}>
        <div className="grabber" />
        <div className={"sheetbody" + (state.sheet === "request" ? " req" : "")}>
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
              key={reqTarget.id}
              item={reqTarget}
              dates={dates}
              onBack={closeSheet}
              onConfirm={confirmUnclaimed}
              onAsk={() => openChat(reqTarget.id)}
            />
          ) : null}
          {state.sheet === "metro" ? (
            <MetroBody current={state.metroId} onPick={setMetro} onBack={closeSheet} />
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
      <p className="eyebrow">Your trip</p>
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
              Charged instantly
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

function kindLabel(art: keyof typeof GUIDES): string {
  const names: Record<string, string> = {
    skydive: "a tandem skydive", heli: "a helicopter tour", balloon: "a balloon flight", kart: "karting",
    escape: "an escape room", axe: "axe throwing", paintball: "paintball", horse: "a trail ride",
    jetski: "a jet ski session", pontoon: "a pontoon day", fishing: "a fishing charter", parasail: "parasailing",
    cruise: "a sunset cruise", kayak: "a paddle",
    bowling: "bowling", minigolf: "mini golf", arcade: "an arcade session", trampoline: "a trampoline park", lasertag: "laser tag", icerink: "ice skating", waterpark: "a water park day", themepark: "a theme park day", zoo: "a zoo visit", aquarium: "an aquarium visit", karaoke: "a karaoke room", climbing: "a climbing session", range: "a range session", archery: "archery", golf: "a round of golf", zipline: "a zipline", ski: "a day on the mountain", bike: "a bike rental", snowmobile: "a snowmobile ride", rafting: "a rafting trip", scuba: "a dive", surf: "a surf lesson", paragliding: "a tandem paraglide", gliding: "a glider flight", brewery: "a brewery visit", winery: "a wine tasting", distillery: "a distillery tour", cooking: "a cooking class", spa: "a spa visit", yoga: "a yoga class", dance: "a dance class", pottery: "a pottery class", tour: "a tour", rage: "a rage room session", theatre: "a show", museum: "a museum visit", garden: "a garden visit", camping: "a night under the stars", tennis: "a court booking", swim: "a swim", martialarts: "a class", gymnastics: "a gymnastics session", fitness: "a class", venue: "a venue booking", sailing: "a sail", discgolf: "a round", billiards: "a table", motorsport: "a ride", sauna: "a sauna session",
  };
  return names[art] || "this";
}

function optionPrice(o: UnclaimedOption): string | null {
  if (o.price == null) return null;
  return priceWith(o.price, o.per);
}

let guestPointCache: GeoPoint | null | undefined;

function useGuestPoint(): GeoPoint | null {
  const [pt, setPt] = useState<GeoPoint | null>(guestPointCache ?? null);
  useEffect(() => {
    if (guestPointCache !== undefined) {
      setPt(guestPointCache);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      guestPointCache = null;
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        guestPointCache = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPt(guestPointCache);
      },
      () => {
        guestPointCache = null;
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }, []);
  return pt;
}

function FactList({ lines }: { lines: FactLine[] }) {
  return (
    <ul className="policy">
      {lines.map((line) => (
        <li key={line.text} className={line.posted ? undefined : "gap"}>
          <Markup html={ICONS.dot} />
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Bullet list in the phone sheet's visual language. Text is the operator's own, run through plainWords. */
function Bullets({ items, icon = ICONS.dot, className = "" }: { items: string[]; icon?: string; className?: string }) {
  return (
    <ul className={"policy " + className}>
      {items.map((t) => (
        <li key={t}>
          <Markup html={icon} />
          <span>{plainWords(t)}</span>
        </li>
      ))}
    </ul>
  );
}

function RequestBody({
  item,
  dates,
  onBack,
  onConfirm,
  onAsk,
}: {
  item: Unclaimed;
  dates: Date[];
  onBack: () => void;
  onConfirm: (input: { dateIdx: number; slot: string; qty: number; optionIdx: number | null; addonIdx?: number[] }) => void;
  onAsk: () => void;
}) {
  const metro = metroById(item.metroId);
  const catName = CATS.find((c) => c.id === item.cat)?.name ?? item.cat;
  const [dateIdx, setDateIdx] = useState(0);
  const [time, setTime] = useState<string | null>(null);
  const [qty, setQty] = useState(2);
  const [optionIdx, setOptionIdx] = useState<number | null>(item.options.length === 1 ? 0 : null);
  const [pay, setPay] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [addonIdx, setAddonIdx] = useState<number[]>([]);
  const [openSvc, setOpenSvc] = useState<string | null>(null);
  const extras = addonIdx.map((i) => (item.addons || [])[i]).filter(Boolean);
  const [guideOpen, setGuideOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const guide = GUIDES[item.art];
  const picked = optionIdx != null ? item.options[optionIdx] : null;
  const needService = item.options.length > 0;
  const ready = time != null && (!needService || picked != null);
  const day = dates[dateIdx];
  const p = priceUnclaimed(picked, qty, extras);
  const whenLine = time
    ? [fmtDate(day), fmtTime(time), qty + (qty === 1 ? " person" : " people")].join(" · ")
    : "";
  const dockPrice = p.total ? money(p.total) : picked ? optionPrice(picked) || "Instant" : "Instant";
  const score = publicRating(item);
  const contact = contactFor(item);
  const facts = listingFacts(item);
  const here = useGuestPoint();
  const dest = mapsQuery(item, contact);
  const place = placeLabel(item, contact);
  const pin = item.lat != null && item.lon != null ? { lat: item.lat, lng: item.lon } : null;
  const miles = here && pin ? milesBetween(here, pin) : null;
  const dist = miles != null && miles <= 150 && metro ? formatDistance(miles, metro.country) + " away" : null;
  const address = contact ? addressLine(contact) : null;

  /* ---------- derived from the operator's own site, never invented. Same rules as the desktop page. ---------- */
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
  const priced = fromPrice(item) != null;
  const openNow = itemOpenState(item);
  const dealsNow = todaysDeals(item);
  const today = item.promos?.length ? clockIn(zoneFor(item)).day : -1;
  const badges: { icon: string; text: string; tone?: "open" | "closed" }[] = [];
  if (openNow) badges.push({ icon: ICONS.clock, text: openNow.label, tone: openNow.open ? "open" : "closed" });
  if (score && score.rating >= 4.8 && score.reviews >= 100) badges.push({ icon: ICONS.star, text: "Top rated" });
  else if (score && score.reviews >= 1000) badges.push({ icon: ICONS.star, text: "Popular" });
  if (cancel) badges.push({ icon: ICONS.check, text: cancel });
  if (priced) badges.push({ icon: ICONS.bolt, text: "Instant confirmation" });
  const quick: { icon: string; label: string; value: string }[] = [];
  if (duration) quick.push({ icon: ICONS.clock, label: "Duration", value: duration });
  if (age) quick.push({ icon: ICONS.user, label: "Minimum age", value: age + "+" });
  if (item.groupInfo?.length) {
    const cap = item.groupInfo.map((g) => g.match(/(\d{1,3})\s*(?:guests?|people|passengers|riders|max)/i)).find(Boolean);
    if (cap) quick.push({ icon: ICONS.user, label: "Group size", value: "Up to " + cap[1] });
  }
  if (item.season) quick.push({ icon: ICONS.compass, label: "Season", value: item.season });
  if (item.waiverUrl) quick.push({ icon: ICONS.ticket, label: "Waiver", value: "Sign online first" });
  const hours = item.hoursText?.length ? item.hoursText : contact?.hours.map(fmtHours) || [];
  const videos = (item.ytVideos || []).slice(0, 2);
  const embed = !videos.length && !item.video && item.videoEmbed ? item.videoEmbed : null;

  if (pay && ready && time) {
    return (
      <>
        <div className="reqpad">
          <div className="reqinner">
            <p className="eyebrow">Your trip</p>
            <h3>{item.title}</h3>
            <p className="reqlede">{whenLine}</p>
            {picked ? <p className="reqhint">{optionLabel(picked)}</p> : null}
            <div className="lines">
              {p.base ? (
                <div className="line">
                  <span>{picked ? optionLabel(picked) : "Experience"}</span>
                  <b>{money(p.base)}</b>
                </div>
              ) : (
                <div className="line">
                  <span>Experience</span>
                  <b>Pay with operator</b>
                </div>
              )}
              {extras.map((a) => (
                <div className="line" key={a.name}>
                  <span>{a.name}</span>
                  <b>{money(a.price ?? 0)}</b>
                </div>
              ))}
              {p.fee ? (
                <div className="line">
                  <span>Service fee</span>
                  <b>{money(p.fee)}</b>
                </div>
              ) : null}
              <div className="line total">
                <span>Total</span>
                <b>{p.total ? money(p.total) : "Pay on site"}</b>
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
                  <small style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Charged instantly</small>
                </span>
              </div>
            </div>
            <p className="note" style={{ textAlign: "left", padding: "12px 0 0" }}>
              Confirmation is instant. Meet at {item.area}.
            </p>
          </div>
        </div>
        <div className="dock reqdock">
          <button className="cta ghost" onClick={() => setPay(false)}>
            Back
          </button>
          <button
            className="cta"
            onClick={() => onConfirm({ dateIdx, slot: time, qty, optionIdx, addonIdx })}
          >
            {p.total ? "Confirm " + money(p.total) : "Confirm booking"}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="reqpad">
        <div className="reqhero">
          <Photo src={item.cover} video={item.video} kind={item.art} id={item.id + "req"} alt={item.title} />
          <button className="backbtn" type="button" onClick={onBack} aria-label="Close">
            <Markup html={ICONS.close} />
          </button>
          {score ? (
            <span className="rating">
              <Markup html={ICONS.star} />
              {score.rating.toFixed(1)}{" "}
              <span className="count">({fmtReviews(score.reviews)})</span>
            </span>
          ) : null}
        </div>
        {item.photos && item.photos.length > 1 ? (
          <div className="gallery">
            {item.photos.slice(0, 6).map((u, i) => (
              <img key={u} src={thumb(u, "thumb")} srcSet={srcSet(u, "thumb")} sizes={SIZES.thumb} alt={item.title + " photo " + (i + 1)} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
            ))}
          </div>
        ) : null}
        <div className="reqinner">
        <p className="eyebrow">
          {metro ? metro.name : item.area} · {catName}
        </p>
        <h3>{item.title}</h3>
        {score ? (
          <p className="reqrate">
            <Markup html={ICONS.star} />
            {score.rating.toFixed(1)}{" "}
            <span className="count">({fmtReviews(score.reviews)} reviews)</span>
          </p>
        ) : null}
        {badges.length ? (
          <div className="reqbadges">
            {badges.map((b) => (
              <span key={b.text} className={"reqbadge" + (b.tone ? " " + b.tone : "")}><Markup html={b.icon} /> {b.text}</span>
            ))}
          </div>
        ) : null}
        {dealsNow.length ? (
          <div className="reqdeal" aria-label="Today's deal">
            <Markup html={ICONS.bolt} />
            <span>
              <b>Today's deal{dealsNow.length > 1 ? "s" : ""}</b>
              {dealsNow.map((p) => (
                <small key={p.text}>{plainWords(p.text)}{p.end ? " · until " + clock12(p.end) : p.start ? " · from " + clock12(p.start) : ""}</small>
              ))}
            </span>
          </div>
        ) : null}
        {quick.length ? (
          <div className="reqquick">
            {quick.map((q) => (
              <div key={q.label}>
                <Markup html={q.icon} />
                <span><small>{q.label}</small><b>{q.value}</b></span>
              </div>
            ))}
          </div>
        ) : null}
        {item.quotes?.length ? (
          <div className="reqquotes">
            {item.quotes.slice(0, 2).map((r, i) => (
              <blockquote key={i}>
                <p>“{r.text.length > 140 ? r.text.slice(0, 140).replace(/\s+\S*$/, "") + "…" : r.text}”</p>
                <footer>{r.rating ? "★".repeat(Math.round(r.rating)) + " " : ""}{r.author || "A guest"}</footer>
              </blockquote>
            ))}
          </div>
        ) : null}
        {item.blurb ? (
          <p className="reqblurb">
            {cleanDesc(item.blurb).replace(/\s+(Book|Learn more|Read more|Reserve)\.?$/i, "")}
            <span className="reqcredit"> · From their website</span>
          </p>
        ) : null}
        {highlights.length ? (
          <>
            <p className="svchead">Highlights</p>
            <Bullets items={highlights} icon={ICONS.check} />
          </>
        ) : null}

        {guide ? <><button type="button" className="guidebtn" onClick={() => setGuideOpen((v) => !v)} aria-expanded={guideOpen}>
          <span>
            <b>What {kindLabel(item.art)} is actually like</b>
            <small>{guide.time}</small>
          </span>
          <Markup html={guideOpen ? ICONS.chevUp : ICONS.chevDown} />
        </button>
        {guideOpen ? (
          <div className="guide">
            <p className="guidehead">How the day goes</p>
            <ol className="guidesteps">
              {guide.steps.map((step, i) => (
                <li key={i}>
                  <span className="n">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="guidehead">Bring</p>
            <div className="guidechips">
              {guide.bring.map((b) => (
                <span className="guidechip" key={b}>{b}</span>
              ))}
            </div>
            <p className="guidehead">Good for</p>
            <p className="guidetext">{guide.goodFor}</p>
            <p className="guidehead">Nervous?</p>
            <p className="guidetext">{guide.nerves}</p>
            <p className="guidefoot">This is how {kindLabel(item.art)} usually works. {item.title}'s own prices, ages, limits and rules are listed below.</p>
          </div>
        ) : null}</> : null}

        <p className="svchead">Meeting point and check-in</p>
        <div className="contact">
          <a
            className="crow maps"
            href={mapsDirHref(dest, here)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <Markup html={ICONS.nav} />
            <span>
              <b>{item.meetingPoint ? plainWords(item.meetingPoint) : place}</b>
              {item.meetingPoint && address && item.meetingPoint !== address ? <small>{address}</small> : null}
              <small className="go">{dist ? dist + " · Get directions" : "Get directions"}</small>
            </span>
          </a>
          {contact?.phone ? (
            <button type="button" className="crow" onClick={() => setCallOpen((v) => !v)} aria-expanded={callOpen}>
              <Markup html={ICONS.phone} />
              <span>
                <b>{fmtPhone(contact.phone)}</b>
                <small>{callOpen ? "Choose who to call" : "Tap to call"}</small>
              </span>
            </button>
          ) : null}
          {callOpen && contact?.phone ? (
            <div className="callpick">
              <button type="button" className="cta" onClick={onAsk}>
                Call the 24/7 assistant
              </button>
              <a className="cta ghost" href={telHref(contact.phone)} onClick={(e) => e.stopPropagation()}>
                Call a person at the shop
              </a>
              <p className="reqhint">The assistant answers by chat for now. Voice is coming.</p>
            </div>
          ) : null}
          {hours.length ? (
            <div className="crow">
              <Markup html={ICONS.clock} />
              <span>
                {hours.map((h) => (
                  <b key={h}>{h}</b>
                ))}
                <small>Hours</small>
              </span>
            </div>
          ) : null}
        </div>
        {item.checkin ? (
          <div className="reqbox">
            <b>When you arrive</b>
            {plainWords(item.checkin)}
          </div>
        ) : null}

        <p className="svchead">Questions?</p>
        <button type="button" className="cta askcta" onClick={onAsk}>
          <Markup html={ICONS.spark} />
          <span>
            <b>Ask the 24/7 assistant</b>
            <small>Instant answers from {item.title}'s published info only</small>
          </span>
        </button>

        <p className="svchead">Who can go</p>
        {requirements.length ? <Bullets items={requirements} /> : <FactList lines={facts.who.filter((l) => l.posted)} />}

        {item.bring?.length ? (
          <>
            <p className="svchead">What to bring</p>
            <Bullets items={item.bring} />
          </>
        ) : null}

        {item.groupInfo?.length ? (
          <>
            <p className="svchead">Groups</p>
            <Bullets items={item.groupInfo} />
          </>
        ) : null}

        <p className="svchead">Waiver and check-in</p>
        {waiverLines.length ? <Bullets items={waiverLines} /> : <FactList lines={facts.waiver.filter((l) => l.posted && l.text.length <= 160)} />}

        {includes.length ? (
          <>
            <p className="svchead">What's included</p>
            <Bullets items={includes} icon={ICONS.check} />
          </>
        ) : null}
        {notIncluded.length ? (
          <>
            <p className="svchead">Not included</p>
            <Bullets items={notIncluded} icon={ICONS.close} className="no" />
          </>
        ) : null}
        {facts.note && !item.cancellation && !item.policies?.length ? (
          <div className="reqbox">
            <b>Good to know</b>
            {facts.note}
          </div>
        ) : null}

        {item.options.length ? (
          <>
            <p className="svchead">Choose a service</p>
            {item.services && item.services.length ? (
              <div className="svclist">
                {item.services.map((svc, svcIdx) => (
                  <div className="svc" key={svc.name + "|" + svcIdx}>
                    {svc.photo ? <img className="svcpic" src={thumb(svc.photo, "thumb")} srcSet={srcSet(svc.photo, "thumb")} sizes={SIZES.thumb} alt={plainWords(svc.name)} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} /> : null}
                    <div className="svchead2">
                      <b>{plainWords(svc.name)}</b>
                      {svc.desc && cleanDesc(svc.desc).length > 140 ? (
                        <button type="button" className="svcabout" onClick={() => setOpenSvc(openSvc === svc.name ? null : svc.name)}>
                          {openSvc === svc.name ? "Less" : "More"}
                        </button>
                      ) : null}
                    </div>
                    {svc.desc ? <p className="svcdesc">{openSvc === svc.name || cleanDesc(svc.desc).length <= 140 ? cleanDesc(svc.desc) : cleanDesc(svc.desc).slice(0, 140).replace(/\s+\S*$/, "") + "…"}</p> : null}
                    {svc.variants.map((v) => (
                      <button
                        key={svc.name + v.optionIdx}
                        type="button"
                        className="addon"
                        aria-pressed={optionIdx === v.optionIdx}
                        onClick={() => setOptionIdx(v.optionIdx)}
                      >
                        <span className="tick">
                          <Markup html={ICONS.check} />
                        </span>
                        <span className="txt">
                          <b>{plainWords(v.label)}</b>
                        </span>
                        <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                          {v.price != null ? priceWith(v.price, v.per) : "Price on request"}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div>
                {item.options.map((o, i) => (
                  <button
                    key={o.name + i}
                    type="button"
                    className="addon"
                    aria-pressed={optionIdx === i}
                    onClick={() => setOptionIdx(i)}
                  >
                    <span className="tick">
                      <Markup html={ICONS.check} />
                    </span>
                    <span className="txt">
                      <b>{plainWords(o.name)}</b>
                      {o.detail ? <small>{plainWords(o.detail)}</small> : null}
                    </span>
                    {optionPrice(o) ? (
                      <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                        {optionPrice(o)}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}

        {item.addons && item.addons.length ? (
          <>
            <p className="svchead">Add-ons</p>
            <div>
              {item.addons.map((a, i) => (
                <button
                  key={a.name + i}
                  type="button"
                  className="addon"
                  aria-pressed={addonIdx.includes(i)}
                  onClick={() => setAddonIdx((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))}
                >
                  <span className="tick">
                    <Markup html={ICONS.check} />
                  </span>
                  <span className="txt">
                    <b>{a.name}</b>
                    {a.detail ? <small>{a.detail}</small> : null}
                  </span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                    {a.price ? "+" + money(a.price) : "Free"}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {item.promos?.length ? (
          <>
            <p className="svchead">Deals</p>
            <ul className="reqdeals">
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
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        {item.cancellation || item.waiverUrl || otherPolicies.length ? (
          <>
            <p className="svchead">Cancellation policy</p>
            {item.cancellation ? (
              <p className="reqpolicy">{plainWords(item.cancellation)}</p>
            ) : (
              <p className="reqpolicy gap">{item.title} has not published cancellation terms. Otto will have them confirm before you pay.</p>
            )}
            {otherPolicies.length ? <Bullets items={otherPolicies} /> : null}
            {item.waiverUrl ? (
              <a className="reqwaiver" href={item.waiverUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                <Markup html={ICONS.ticket} />
                <span>
                  <b>Sign the waiver online before you arrive</b>
                  <small>Saves time at check-in. Opens the operator's waiver form.</small>
                </span>
              </a>
            ) : null}
          </>
        ) : null}

        {item.faq?.length ? (
          <>
            <p className="svchead">Frequently asked questions</p>
            <div className="reqfaq">
              {item.faq.map((f, i) => (
                <div key={i} className={"reqfaqitem" + (openFaq === i ? " open" : "")}>
                  <button type="button" onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
                    <span>{plainWords(f.q)}</span>
                    <Markup html={openFaq === i ? ICONS.chevUp : ICONS.chevDown} />
                  </button>
                  {openFaq === i ? <p>{plainWords(f.a)}</p> : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {videos.length || embed ? (
          <>
            <p className="svchead">See it in action</p>
            <p className="reqhint" style={{ marginTop: 2 }}>Videos from {item.title}'s own channels.</p>
            <div className="reqvideos">
              {videos.map((v) => (
                <div className="reqvideo" key={v.id}>
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
              {embed ? (
                <div className="reqvideo">
                  <iframe src={embed} title={item.title + " video"} loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {score ? (
          <>
            <p className="svchead">Reviews</p>
            <div className="reqreviews">
              <b>{score.rating.toFixed(1)}</b>
              <span>
                <span className="stars" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <Markup key={i} html={ICONS.star} />)}</span>
                <small>{fmtReviews(score.reviews)} public reviews{item.quotes?.length ? "" : ". Written reviews arrive once guests book through Outset."}</small>
              </span>
            </div>
          </>
        ) : null}

        <p className="svchead">Date</p>
        <div className="dates reqdates">
          {dates.slice(0, 8).map((dd, i) => (
            <button
              key={dd.toISOString()}
              type="button"
              className="date"
              aria-pressed={dateIdx === i}
              onClick={() => setDateIdx(i)}
            >
              <small>{i === 0 ? "Today" : i === 1 ? "Tmrw" : DAYS[dd.getDay()]}</small>
              <b>{dd.getDate()}</b>
            </button>
          ))}
        </div>
        <p className="svchead">Time</p>
        <div className="slots">
          {SLOT_TIMES.map((t) => (
            <button
              key={t}
              type="button"
              className="slot"
              aria-pressed={time === t}
              onClick={() => setTime(t)}
            >
              <b>{fmtTime(t)}</b>
            </button>
          ))}
        </div>

        <div className="rowbetween" style={{ marginTop: 18, alignItems: "center" }}>
          <p className="svchead" style={{ margin: 0 }}>
            People
          </p>
          <span className="stepper">
            <button type="button" onClick={() => setQty(qty - 1)} disabled={qty <= 1}>
              −
            </button>
            <span className="n">{qty}</span>
            <button type="button" onClick={() => setQty(qty + 1)} disabled={qty >= QTY_MAX}>
              +
            </button>
          </span>
        </div>
        </div>
      </div>
      <div className="dock reqdock">
        <div className="price">
          <b>{dockPrice}</b>
          <span className="min">{ready ? whenLine : "Pick a time"}</span>
        </div>
        <button className="cta" disabled={!ready} onClick={() => setPay(true)}>
          Book
        </button>
      </div>
    </>
  );
}

function countInMetro(metroId: string): number {
  if (metroId === ALL_METRO_ID) return getCatalog().length;
  return getCatalog().filter((u) => u.metroId === metroId).length;
}

function MetroBody({
  current,
  onPick,
  onBack,
}: {
  current: string;
  onPick: (metroId: string) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = METROS.filter((m) => {
    if (!needle) return true;
    return (m.name + " " + m.region + " " + m.country).toLowerCase().includes(needle);
  });
  const seeded = filtered.filter((m) => countInMetro(m.id) > 0);
  const rest = filtered.filter((m) => countInMetro(m.id) === 0);
  const us = (rows: typeof METROS) => rows.filter((m) => m.country === "US");
  const ca = (rows: typeof METROS) => rows.filter((m) => m.country === "CA");

  return (
    <>
      <p className="eyebrow">Where</p>
      <h3>Choose an area</h3>
      <p style={{ fontSize: 14, color: "var(--ink-soft)", margin: "4px 0 0" }}>
        {METROS.length} cities across the US and Canada.
      </p>
      <div className="search" style={{ marginTop: 16 }}>
        <input
          placeholder="Search a city"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search a city"
        />
      </div>
      <button
        type="button"
        className="metroitem"
        aria-pressed={current === ALL_METRO_ID}
        onClick={() => onPick(ALL_METRO_ID)}
      >
        <span>
          <b>{metroLabel(ALL_METRO_ID)}</b>
          <small>All cities</small>
        </span>
        <span className="count">{countInMetro(ALL_METRO_ID)}</span>
      </button>
      {seeded.length ? <p className="metrogroup">Available now</p> : null}
      {us(seeded).map((m) => (
        <MetroRow key={m.id} id={m.id} current={current} onPick={onPick} />
      ))}
      {ca(seeded).map((m) => (
        <MetroRow key={m.id} id={m.id} current={current} onPick={onPick} />
      ))}
      {us(rest).length ? <p className="metrogroup">United States</p> : null}
      {us(rest).map((m) => (
        <MetroRow key={m.id} id={m.id} current={current} onPick={onPick} />
      ))}
      {ca(rest).length ? <p className="metrogroup">Canada</p> : null}
      {ca(rest).map((m) => (
        <MetroRow key={m.id} id={m.id} current={current} onPick={onPick} />
      ))}
      <div className="dock" style={{ position: "static", background: "none", padding: "14px 0 20px" }}>
        <button className="cta" onClick={onBack}>
          Done
        </button>
      </div>
    </>
  );
}

function MetroRow({
  id,
  current,
  onPick,
}: {
  id: string;
  current: string;
  onPick: (metroId: string) => void;
}) {
  return (
    <button type="button" className="metroitem" aria-pressed={current === id} onClick={() => onPick(id)}>
      <span>
        <b>{metroLabel(id)}</b>
      </span>
      <span className="count">{countInMetro(id)}</span>
    </button>
  );
}
