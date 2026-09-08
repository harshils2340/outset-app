import { useEffect, useState } from "react";
import { CATS } from "../../data/categories";
import { GUIDES } from "../../data/guides";
import { ICONS } from "../../data/icons";
import { ALL_METRO_ID, METROS, metroById, metroLabel } from "../../data/metros";
import { SLOT_TIMES } from "../../data/slots";
import type { Unclaimed, UnclaimedOption } from "../../data/types";
import {
  contactFor,
  fmtHours,
  fmtPhone,
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
          <Photo src={item.cover} kind={item.art} id={item.id + "req"} alt={item.title} />
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
              <img key={u} src={u} alt={item.title + " photo " + (i + 1)} loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
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
        {item.src && !/^(osm-|gplace-)/.test(item.src) ? (
          <a className="wsrc" href={"https://" + item.src.replace(/^https?:\/\//, "")} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Source: {item.src.replace(/^https?:\/\//, "").replace(/^www\./, "")} ↗
          </a>
        ) : null}
        {item.blurb ? (
          <p className="reqblurb">
            {plainWords(item.blurb)}
            <span className="reqcredit"> · From their website</span>
          </p>
        ) : null}

        <button type="button" className="guidebtn" onClick={() => setGuideOpen((v) => !v)} aria-expanded={guideOpen}>
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
        ) : null}

        <p className="svchead">Where</p>
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
              <b>{place}</b>
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
          {contact && contact.hours.length ? (
            <div className="crow">
              <Markup html={ICONS.clock} />
              <span>
                {contact.hours.map((h) => (
                  <b key={h}>{fmtHours(h)}</b>
                ))}
                <small>Hours</small>
              </span>
            </div>
          ) : null}
        </div>

        <p className="svchead">Questions?</p>
        <button type="button" className="cta askcta" onClick={onAsk}>
          <Markup html={ICONS.spark} />
          <span>
            <b>Ask the 24/7 assistant</b>
            <small>Instant answers from {item.title}'s published info only</small>
          </span>
        </button>

        {facts.about.length ? (
          <>
            <p className="svchead">The experience</p>
            <ul className="policy">
              {facts.about.map((s) => (
                <li key={s}>
                  <Markup html={ICONS.dot} />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <p className="svchead">Who can go</p>
        <FactList lines={facts.who} />

        <p className="svchead">Waiver & check-in</p>
        <FactList lines={facts.waiver} />

        {item.includes.length ? (
          <>
            <p className="svchead">Includes</p>
            <ul className="policy">
              {item.includes.map((s) => (
                <li key={s}>
                  <Markup html={ICONS.dot} />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {facts.note ? (
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
                {item.services.map((svc) => (
                  <div className="svc" key={svc.name}>
                    {svc.photo ? <img className="svcpic" src={svc.photo} alt={plainWords(svc.name)} loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} /> : null}
                    <div className="svchead2">
                      <b>{plainWords(svc.name)}</b>
                      {svc.desc ? (
                        <button type="button" className="svcabout" onClick={() => setOpenSvc(openSvc === svc.name ? null : svc.name)}>
                          {openSvc === svc.name ? "Less" : "What is this?"}
                        </button>
                      ) : null}
                    </div>
                    {svc.desc && openSvc === svc.name ? <p className="svcdesc">{plainWords(svc.desc)}</p> : null}
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
