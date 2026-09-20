import { warmCheckout } from "../../lib/stripeJs";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CATS } from "../../data/categories";
import { ART_LABEL } from "../../data/art";
import { GUIDES } from "../../data/guides";
import { ICONS } from "../../data/icons";
import { metroById } from "../../data/metros";
import { SLOT_TIMES } from "../../data/slots";
import type { CategoryId, Unclaimed, UnclaimedOption } from "../../data/types";
import {
  addressLine,
  bookingPaused,
  contactFor,
  fmtPhone,
  fromPrice,
  getCatalog,
  guestCapFor,
  listingFacts,
  mapsDirHref,
  mapsQuery,
  maxGuestsFor,
  optionLabel,
  perPerson,
  placeLabel,
  plainWords,
  publicRating,
  telHref,
  topRated,
  type FactLine,
} from "../../lib/catalog";
import { fmtDate, fmtReviews, fmtTime, money, priceWith, reviewsLine, unitLine } from "../../lib/format";
import { formatDistance, milesBetween, type GeoPoint } from "../../lib/geo";
import { addonPrice, hasPrice, priceFor, priceUnclaimed, serviceFeeLabel } from "../../lib/pricing";
import { ottoCanPay, useWallet } from "../../lib/wallet";
import { useApp } from "../../state/AppProvider";
import { SIZES, srcSet, thumb } from "../../lib/images";
import { embedAutoplay, listingMedia, photoCandidates, probePhotos, type Media } from "../../lib/media";
import { cleanDesc, durationLabel, groupCap, minAge, splitPolicies } from "../../lib/listingDerive";
import { freeCancelBadge } from "../../lib/cancellation";
import { DAY_SHORT, clock12, companySuggestions, dayLabel, todaysDeals } from "../../lib/companyAgent";
import { bookableStart, clockIn, hourLines, itemWeek, zoneFor } from "../../lib/openNow";
import { displayHours } from "../../lib/hoursText";
import { noStartTimesNote, startTimesOn } from "../../lib/startTimes";
import { itemOpenState } from "../../lib/openNow";
import { apiConfig, fetchAvailability, fetchOpenSlots, hasApi, type LiveAvailability } from "../../lib/api";
import { dateKey } from "../../lib/dates";
import { fewSeats, liveChipsByDate, type TimeChip } from "../../lib/liveTimes";
import { safeHttpUrl } from "../../lib/urlSafety";
import { searchSuggest } from "../../lib/search";
import { listingUrl } from "../../lib/site";
import { Photo } from "../art/Photo";
import { Art } from "../art/Art";
import { Markup } from "../Markup";
import {
  IcBack,
  IcChevron,
  IcClose,
  IcHeartOnPhoto,
  IcLaurel,
  IcMinus,
  IcPin,
  IcPlus,
  IcShare,
  IcStar,
} from "../explore/AirIcons";
import { fmtRating } from "../explore/UnclaimedCard";
import { applyFilters, browseList, nearFirst } from "../explore/feed";
import { getPrefs, setPrefs, startingParty, toggleSaved, usePrefs, type FeedFilters } from "../explore/prefs";
import { SlotCalendar } from "./SlotCalendar";
import { SearchSheet } from "../explore/SearchSheet";
import { AdminSiteLink, ExplainLine, ReviewCard, TYPE_NAME, arrivalNote, bookableServices, dealShown, isStandardOnly, optionLength, splitVariants, variantNote, tidyDuration, possessive, splitIncluded, tidyAddress, tidyCancel, tidyLength, tidyLine, tidyName } from "../web/WebListing";
import { shownReviews } from "../../lib/reviews";

/** Only the starting point for the party picker before a service is chosen; the operator's own limit wins. */
const QTY_MAX = 8;

export function Sheets() {
  const { state, listing, reqTarget, dates, closeSheet, confirm, confirmUnclaimed, openAsk } = useApp();
  const { sheetMode } = usePrefs();
  const on = state.sheet !== null;
  // The listing and the search open full screen, the way Airbnb's app pushes them. The review sheet stays a sheet.
  const full = state.sheet === "request" || state.sheet === "metro";
  // The name a screen reader reads when the sheet opens. The search sheet and Filters share one mode.
  const name =
    state.sheet === "request" ? reqTarget?.title || "Listing" : state.sheet === "metro" ? (sheetMode === "filters" ? "Filters" : "Search") : state.sheet === "review" ? "Review and pay" : undefined;

  // Opening a sheet left focus on the page behind it, which is inert, so the keyboard had nowhere to go and a
  // screen reader said nothing at all: a guest pressing Enter on a card watched the listing take the screen in
  // silence. Closing it dropped focus to the body, so the next Tab started over at the top of the feed instead
  // of at the card they came from. Focus moves into the sheet and comes back to whatever opened it.
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (on) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      box.current?.focus();
      return;
    }
    const back = opener.current;
    opener.current = null;
    // The feed re-renders while a sheet is open, so the card that opened it may be gone.
    if (back && document.contains(back)) back.focus();
  }, [on]);

  return (
    <>
      <div className={"scrim" + (on ? " on" : "")} onClick={closeSheet} />
      <div
        className={"sheet" + (on ? " on" : "") + (full ? " airfull" : "")}
        ref={box}
        tabIndex={on ? -1 : undefined}
        role={on ? "dialog" : undefined}
        aria-modal={on ? true : undefined}
        aria-label={on ? name : undefined}
      >
        {full ? null : <div className="grabber" />}
        <div className={"sheetbody" + (full ? " req" : "")}>
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
              onAsk={(text) => openAsk(text || "What should I know about " + reqTarget.title + " before booking?")}
            />
          ) : null}
          {state.sheet === "metro" ? <SearchBody /> : null}
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
      <p style={{ fontSize: 14, color: "var(--ink-soft)", margin: "6px 0 0" }}>
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
          <span>{serviceFeeLabel(p)}</span>
          <b>{money(p.fee)}</b>
        </div>
        <div className="line total">
          <span>Total</span>
          <b>{money(p.total)}</b>
        </div>
      </div>
      <p className="note" style={{ textAlign: "left", padding: "12px 0 0" }}>
        Cancellation follows {listing.op}&apos;s policy above. A deposit or security hold may apply at check-in.
      </p>
      <div className="dock" style={{ position: "static", background: "none", padding: "14px 0 20px", border: "none" }}>
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

// A 0 here is the crawler finding a currency sign and no number, not a free option: see hasPrice in pricing.ts.
function optionPrice(o: UnclaimedOption): string | null {
  if (!hasPrice(o.price)) return null;
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
          <span>{tidyLine(t)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One hero slide on the phone listing: the clip, the embed, or a photo. Broken media tells the page to drop it. */
function HeroSlide({ m, item, onBroken }: { m: Media; item: Unclaimed; onBroken: () => void }) {
  if (m.kind === "embed") {
    return <iframe className="wembed" src={embedAutoplay(m.src)} title={item.title + " video"} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin" />;
  }
  if (m.kind === "clip") {
    return <Photo src={m.poster} video={m.src} kind={item.art} id={item.id + "req"} alt={item.title} size="wide" fallback={false} onBroken={onBroken} />;
  }
  return <Photo src={m.src} kind={item.art} id={item.id + "req"} alt={item.title} size="wide" fallback={false} onBroken={onBroken} />;
}

/** A section of the listing: Airbnb's 22px heading over its content, with a hairline rule above. */
function Section({ title, sub, children, id, innerRef }: { title?: string; sub?: string; children: ReactNode; id?: string; innerRef?: React.Ref<HTMLElement> }) {
  return (
    <section className="airsec" id={id} ref={innerRef}>
      {title ? <h2>{title}</h2> : null}
      {sub ? <p className="airsecsub">{sub}</p> : null}
      {children}
    </section>
  );
}

/** Things-to-know row: title and a one-line summary, opening in place to the operator's full lines. */
function KnowRow({ icon, title, summary, children }: { icon: string; title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"airknow" + (open ? " open" : "")}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Markup html={icon} className="airknowico" />
        <span className="airknowtext">
          <b>{title}</b>
          {open ? null : <small>{summary}</small>}
        </span>
        <IcChevron dir={open ? "up" : "down"} size={14} />
      </button>
      {open ? <div className="airknowbody">{children}</div> : null}
    </div>
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
  onConfirm: (input: { dateIdx: number; slot: string; qty: number; optionIdx: number | null; addonIdx?: number[]; guest?: { name: string; phone: string; email?: string } }) => void | Promise<unknown>;
  onAsk: (text?: string) => void;
}) {
  const { state } = useApp();
  const { saved } = usePrefs();
  const metro = metroById(item.metroId);
  const catName = CATS.find((c) => c.id === item.cat)?.name ?? item.cat;
  // The day and party picked in the search sheet carry into the booking, the way Airbnb carries dates and guests.
  const [dateIdx, setDateIdx] = useState(() => {
    const w = getPrefs().when;
    const i = w ? dates.findIndex((d) => dateKey(d) === w) : -1;
    return i >= 0 ? i : 0;
  });
  const [time, setTime] = useState<string | null>(null);
  const [qty, setQty] = useState(() => startingParty(QTY_MAX));
  const [optionIdx, setOptionIdx] = useState<number | null>(item.options.length === 1 ? 0 : null);
  // "Max guests per slot" as the operator set it for the service being booked, else the ceiling the shop's own
  // site states. Named here too, so a stepper that has stopped says whose limit stopped it.
  const maxGuests = maxGuestsFor(item, optionIdx);
  const guestCap = guestCapFor(item, optionIdx);
  // The party comes down with it, for the same reason as on the desktop page: the open times are asked for a
  // party this size, so one larger than the service holds leaves every date empty with nothing saying why.
  useEffect(() => { setQty((q) => Math.min(q, maxGuests)); }, [maxGuests]);
  const [pay, setPay] = useState(false);
  // The operator needs a way to reach whoever booked, and the API refuses a booking without it.
  const [guest, setGuest] = useState<{ name: string; phone: string; email: string }>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem("outset.guest") || "{}");
      const g = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return {
        name: typeof g.name === "string" ? g.name : "",
        phone: typeof g.phone === "string" ? g.phone : "",
        email: typeof g.email === "string" ? g.email : "",
      };
    } catch {
      return { name: "", phone: "", email: "" };
    }
  });
  const guestOk = guest.name.trim().length >= 2 && guest.phone.replace(/\D/g, "").length >= 10;
  const [callOpen, setCallOpen] = useState(false);
  const [addonIdx, setAddonIdx] = useState<number[]>([]);
  const [openSvc, setOpenSvc] = useState<string | null>(null);
  const [moreSvc, setMoreSvc] = useState<string[]>([]);
  const extras = addonIdx.map((i) => (item.addons || [])[i]).filter(Boolean);
  const [guideOpen, setGuideOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [moreDesc, setMoreDesc] = useState(false);
  // The request goes to the API and can take a while on a slow connection. Without this the button looked
  // untouched for up to 25 seconds, so a guest pressed it again, and again: each press is a fresh booking code
  // and a fresh row at the shop. The desktop page already had it.
  const [sending, setSending] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [stuck, setStuck] = useState(false);
  // The hero shows only media that really loads: no placeholder art on a listing. Photos are probed at thumbnail
  // size up front, and a slide that still fails drops out of the strip and the count.
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const drop = (src: string) => setBroken((b) => (b.has(src) ? b : new Set(b).add(src)));
  const media = listingMedia(item, broken);
  const [slide, setSlide] = useState(0);
  const padRef = useRef<HTMLDivElement>(null);
  const svcRef = useRef<HTMLElement>(null);
  const dateRef = useRef<HTMLElement>(null);
  useEffect(() => probePhotos(photoCandidates(item).slice(0, 12), drop), [item.id]);
  const guide = GUIDES[item.art];
  const picked = optionIdx != null ? item.options[optionIdx] : null;
  const needService = item.options.length > 0;
  // The dashboard's Published and Accepting switches, the same pair the desktop page has always read. This
  // screen read neither, so a shop that had hidden its page or paused bookings still offered a full picker
  // here: a guest picked a service, a date, a time and a party, typed their name, number and email, pressed
  // Request to book and only then got a toast saying the listing was hidden, with no way forward.
  const paused = bookingPaused(item);
  const pausedHead = item.offline ? "This listing is hidden right now" : "Not taking bookings right now";
  const pausedWhy = item.offline ? item.title + " has taken this page down for the moment." : item.title + " has paused new bookings. Check back soon.";
  const ready = !paused && time != null && (!needService || picked != null);
  // The card form's script and config load now, while the guest reads the price, so "Book and pay" opens it at once.
  useEffect(() => { if (ready) warmCheckout(); }, [ready]);
  const day = dates[dateIdx];
  const p = priceUnclaimed(picked, qty, extras);
  const instant = !!(item.claimed && item.instant);
  // Whether a card is taken is decided by the API from the listing's own price, not by this screen, and it
  // takes one on a request as much as on an instant booking: the card is held and captured when the shop
  // accepts. This screen said nothing about a card at all, so a guest on a phone pressed "Request to book"
  // under the line "nothing is charged until they do" and Stripe's card form came up. The desktop page has
  // read this since cards were switched on; this is the same read. Off, or unanswered, and nothing changes.
  const [payments, setPayments] = useState(false);
  useEffect(() => { let alive = true; void apiConfig().then((c) => { if (alive) setPayments(c.payments); }); return () => { alive = false; }; }, []);
  const { wallet } = useWallet();
  const cardNow = payments && !!p.total;
  const ottoNow = ottoCanPay(wallet, p.total);
  // The public rating and its count appear only beside written reviews we can actually show (see WebListing).
  const reviews = useMemo(() => shownReviews(item.quotes, item.title), [item.quotes, item.title]);
  const score = reviews.length ? publicRating(item) : null;
  // The same bar the two cards use, plus this surface's rule that a rating shows only beside reviews to read.
  const guestFav = !!score && topRated(item);
  const contact = contactFor(item);
  // Null when the shop published something that is not a number a guest can ring, and then no call is offered.
  const callHref = contact?.phone ? telHref(contact.phone) : null;
  const facts = listingFacts(item);
  const here = useGuestPoint();
  const dest = mapsQuery(item, contact);
  const place = tidyAddress(placeLabel(item, contact));
  const pin = item.lat != null && item.lon != null ? { lat: item.lat, lng: item.lon } : null;
  const miles = here && pin ? milesBetween(here, pin) : null;
  const dist = miles != null && miles <= 150 && metro ? formatDistance(miles, metro.country) + " away" : null;
  const addressRaw = contact ? addressLine(contact) : null;
  const address = addressRaw ? tidyAddress(addressRaw) : null;
  const checkin = arrivalNote(item);
  const isSaved = saved.includes(item.id);
  // One business is "Museum in Saint Petersburg", not "Museums in": the singular type the desktop page uses.
  const kind = TYPE_NAME[item.art] || ART_LABEL[item.art] || catName;

  /* Live departures from the operator's own booking system, when they run one we can read. The picker paints with
     the published times first and upgrades itself when this resolves; with no API it never resolves live. */
  const [avail, setAvail] = useState<LiveAvailability | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchAvailability(item.id, dateKey(dates[0]), dates.length)
      .then((a) => {
        if (alive) setAvail(a);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item.id]);
  const liveDays = useMemo(() => liveChipsByDate(avail), [avail]);
  const live = liveDays.size > 0;
  /* What is still open on Outset: the claimed shop's hours minus every time already booked, for a party this
     size. Capacity is per service and per time, so a time with one seat left is not open to two guests. */
  const [openMap, setOpenMap] = useState<Map<string, string[]> | null>(null);
  useEffect(() => {
    if (!hasApi()) return;
    let alive = true;
    void fetchOpenSlots(item.id, dateKey(dates[0]), dates.length, picked?.name, qty).then((r) => {
      if (!alive || !r.known) return;
      setOpenMap(new Map(r.days.map((d) => [d.date, d.slots])));
    });
    return () => {
      alive = false;
    };
  }, [item.id, picked?.name, qty]);
  // Today only offers start times at least an hour out. Nobody can book a 7 AM slot at 8:30. "Today" and the
  // cutoff are both read on the shop's clock, because the times themselves are its wall clock times.
  const stillOpen = bookableStart(item);
  // With no API to ask, the fixed times still drop the ones this shop's own published hours are shut for, so
  // the picker and the "Closed today" row above it cannot say different things. Same rule the API applies.
  const week = useMemo(() => itemWeek(item), [item]);
  const chipsFor = (d: Date): TimeChip[] => {
    const k = dateKey(d);
    const later = (t: string) => stillOpen(k, t);
    if (live) return (liveDays.get(k) || []).filter((c) => later(c.time)).sort((a, b) => a.time.localeCompare(b.time));
    const base = openMap ? openMap.get(k) || [] : startTimesOn(week ? week[d.getDay()] ?? null : null, SLOT_TIMES);
    return base.filter(later).map((t) => ({ key: t, time: t, label: fmtTime(t) }));
  };
  const chips = chipsFor(day);
  useEffect(() => {
    if (time && !chips.some((c) => c.time === time)) setTime(null);
  }, [dateIdx, live, openMap]);
  // Land the guest on a day that has start times rather than an empty one, as the desktop page does: opened in
  // the evening, the sheet said "No more start times today" under today's date and left the guest to find tomorrow.
  // Runs when the times change (live departures or open slots arriving), never on a day the guest picked themselves.
  useEffect(() => {
    if (chipsFor(day).length) return;
    const i = dates.findIndex((d) => chipsFor(d).length);
    if (i >= 0 && i !== dateIdx) setDateIdx(i);
  }, [live, openMap]);

  /* ---------- derived from the operator's own site, never invented. Same rules as the desktop page. ---------- */
  const requirements = item.requirements?.length ? item.requirements : facts.who.filter((l) => l.posted).map((l) => l.text);
  const included = splitIncluded(item.includes);
  const includes = included.yes;
  const notIncluded = included.no.map((n) => n.text);
  const reqKeys = new Set(requirements.map((r) => r.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const highlights = (item.highlights?.length ? item.highlights : facts.about.slice(0, 6)).filter((h) => !reqKeys.has(h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const waiverLines = (item.policies?.filter((l) => /\bwaivers?\b|\bliabilit|\brelease form|\bsign(ed|ing)? (a |the |our |your )?(waiver|release|form)|\bcheck-?in\b/i.test(l)) || facts.waiver.filter((l) => l.posted).map((l) => l.text)).filter((l) => l.length <= 160);
  const policies = splitPolicies(item.policies || []);
  const otherPolicies = policies.other;
  // A cancellation term stated as a policy line rather than in `cancellation` is still their cancellation term.
  const cancelPolicies = policies.cancel.filter((l) => !item.cancellation || !tidyLine(item.cancellation).toLowerCase().includes(tidyLine(l).toLowerCase()));
  const cancelRaw = freeCancelBadge(item);
  const cancel = cancelRaw ? tidyCancel(cancelRaw) : null;
  const age = minAge(requirements);
  const durationRaw = item.dur || durationLabel(item);
  const duration = durationRaw ? tidyDuration(durationRaw) : null;
  const openNow = itemOpenState(item);
  const dealsNow = todaysDeals(item);
  const today = item.promos?.length ? clockIn(zoneFor(item)).day : -1;
  /* Airbnb's highlight rows: an icon, a bold line, a grey line. Only facts this operator actually published. */
  const rows: { icon: string; title: string; sub: string; tone?: "open" | "soon" | "closed" }[] = [];
  // The same status line the desktop header shows, so the two do not word it differently: "Closes at 5 PM"
  // rather than just "Open", and its own tone when closing time is near.
  if (openNow) rows.push({ icon: ICONS.clock, title: openNow.line, sub: "From the hours they publish", tone: openNow.open ? (openNow.soon ? "soon" : "open") : "closed" });
  if (guestFav && score) rows.push({ icon: ICONS.star, title: "Top rated", sub: "Rated " + fmtRating(score.rating) + " across " + reviewsLine(score.reviews, "public") });
  else if (score && score.reviews >= 1000) rows.push({ icon: ICONS.star, title: "Popular", sub: reviewsLine(score.reviews, "public") });
  if (cancel) rows.push({ icon: ICONS.check, title: cancel, sub: "Per their published cancellation terms" });
  if (instant) rows.push({ icon: ICONS.bolt, title: "Instant confirmation", sub: "Your spot is confirmed as soon as you book" });
  if (duration) rows.push({ icon: ICONS.clock, title: duration, sub: "Duration" });
  if (age) rows.push({ icon: ICONS.user, title: "Ages " + age + "+", sub: "Minimum age" });
  const cap = groupCap(item.groupInfo);
  if (cap != null) rows.push({ icon: ICONS.user, title: "Up to " + cap + " guests", sub: "Group size" });
  if (item.season) rows.push({ icon: ICONS.compass, title: item.season, sub: "Season" });
  if (item.waiverUrl) rows.push({ icon: ICONS.ticket, title: "Sign the waiver online", sub: "Saves time at check-in" });
  const hours = displayHours(hourLines(item).length ? hourLines(item) : contact?.hours || []);
  const videos = (item.ytVideos || []).slice(0, 2);
  const embed = !videos.length && !item.video && item.videoEmbed ? item.videoEmbed : null;
  const blurb = item.blurb ? cleanDesc(item.blurb).replace(/\s+(Book|Learn more|Read more|Reserve)\.?$/i, "") : "";
  const longBlurb = blurb.length > 260;
  const from = fromPrice(item);
  const fromUnit = item.options.find((o) => o.price === from);
  const fromPer = from != null && (!fromUnit || perPerson(fromUnit)) ? " / person" : "";
  const suggestions = useMemo(() => companySuggestions({ item, contact }).slice(0, 4), [item.id]);
  const subtitle = [kind + " in " + item.area, metro && !item.area.includes(metro.name) && !item.area.includes(",") ? metro.name : null].filter(Boolean).join(", ");

  const share = async () => {
    const url = listingUrl(item.id);
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* dismissed */
    }
  };

  // Checkout opens at its top; coming back from it lands where the guest left the listing.
  const listScroll = useRef(0);
  useEffect(() => {
    if (!pay && padRef.current) padRef.current.scrollTop = listScroll.current;
  }, [pay]);
  const reserve = () => {
    if (ready) {
      listScroll.current = padRef.current?.scrollTop || 0;
      setPay(true);
      return;
    }
    const target = needService && !picked ? svcRef.current : dateRef.current;
    setNudge(needService && !picked ? "Choose a service first" : "Pick a start time");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useEffect(() => {
    if (ready) setNudge(null);
  }, [ready]);

  const topButtons = (solid?: boolean) => (
    <>
      <button className={"aircircle" + (solid ? " solid" : "")} type="button" onClick={onBack} aria-label="Back">
        <IcBack size={16} />
      </button>
      <span className="airtopright">
        <button className={"aircircle" + (solid ? " solid" : "")} type="button" onClick={share} aria-label={copied ? "Link copied" : "Share"}>
          {copied ? <Markup html={ICONS.check} /> : <IcShare size={16} />}
        </button>
        <button className={"aircircle" + (solid ? " solid" : "") + (isSaved ? " saved" : "")} type="button" onClick={() => toggleSaved(item.id)} aria-label={isSaved ? "Remove from wishlist" : "Save"} aria-pressed={isSaved}>
          <IcHeartOnPhoto on={isSaved} size={16} />
        </button>
      </span>
    </>
  );

  if (pay && ready && time) {
    // The same three labels the desktop listing uses, so the two surfaces cannot promise different things.
    const cta = !guestOk ? "Add your name and number" : cardNow ? (ottoNow ? "Book with Otto " : "Book and pay ") + money(p.total!) : instant ? (p.total ? "Confirm and pay " + money(p.total) : "Confirm booking") : "Request to book";
    return (
      <>
        <div className="reqpad airpay" key="pay">
          <div className="airpaytop">
            <button className="aircircle flat" type="button" onClick={() => setPay(false)} aria-label="Back to the listing">
              <IcBack size={16} />
            </button>
            <h1>{instant ? "Confirm and pay" : "Request to book"}</h1>
          </div>
          <div className="airpaybody">
            <div className="airpaycard">
              <span className="airpaythumb">
                {media.find((m) => m.kind === "photo") ? (
                  <Photo src={(media.find((m) => m.kind === "photo") as { src: string }).src} kind={item.art} id={item.id + "pay"} alt="" size="thumb" />
                ) : (
                  <Art kind={item.art} id={item.id + "pay"} />
                )}
              </span>
              <span className="airpaymeta">
                <b>{item.title}</b>
                <small>{kind}</small>
                {score ? (
                  <small className="airpayrate">
                    <IcStar size={10} /> {fmtRating(score.rating)} ({fmtReviews(score.reviews)})
                  </small>
                ) : null}
              </span>
            </div>

            <section className="airsec">
              <h2>Your trip</h2>
              <div className="airtriprow">
                <span>
                  <b>Date and time</b>
                  <small>
                    {fmtDate(day)} · {fmtTime(time)}
                  </small>
                </span>
                <button type="button" className="airlink" onClick={() => setPay(false)}>
                  Edit
                </button>
              </div>
              <div className="airtriprow">
                <span>
                  <b>Guests</b>
                  <small>{qty + (qty === 1 ? " person" : " people")}</small>
                </span>
                <button type="button" className="airlink" onClick={() => setPay(false)}>
                  Edit
                </button>
              </div>
              {picked ? (
                <div className="airtriprow">
                  <span>
                    <b>Service</b>
                    <small>{optionLabel(picked)}</small>
                  </span>
                </div>
              ) : null}
            </section>

            <section className="airsec">
              <h2>Price details</h2>
              <div className="airlines">
                {p.base ? (
                  // A per-person price is multiplied by the party, and this line is the only place that says so
                  // before the guest pays. Both desktop surfaces have shown "$29 × 4 guests" since cards were
                  // switched on; the phone showed "Sunset sail · 2 hours  $116" over a tier row reading "$29",
                  // and on a phone the frame goes away and this screen is the whole app.
                  <div className="airline">
                    <span>{picked && perPerson(picked) && hasPrice(picked.price) ? money(picked.price) + " × " + qty + (qty === 1 ? " guest" : " guests") : picked ? optionLabel(picked) : "Experience"}</span>
                    <span>{money(p.base)}</span>
                  </div>
                ) : (
                  <div className="airline">
                    <span>Experience</span>
                    <span>Pay with operator</span>
                  </div>
                )}
                {extras.map((a) => (
                  <div className="airline" key={a.name}>
                    <span>{a.name}</span>
                    <span>{money(addonPrice(a))}</span>
                  </div>
                ))}
                {p.fee ? (
                  <div className="airline">
                    <span className="u">{serviceFeeLabel(p)}</span>
                    <span>{money(p.fee)}</span>
                  </div>
                ) : null}
                <div className="airline total">
                  <b>Total</b>
                  <b>{p.total ? money(p.total) : "Pay on site"}</b>
                </div>
              </div>
            </section>

            <section className="airsec">
              <h2>Who's booking</h2>
              <p className="airsecsub">{item.title} uses these to reach you about this booking.</p>
              <div className="airfields">
                <label>
                  <small>Name</small>
                  <input value={guest.name} placeholder="Your name" autoComplete="name" onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
                </label>
                <label>
                  <small>Mobile number</small>
                  <input value={guest.phone} placeholder="(555) 555-0123" inputMode="tel" autoComplete="tel" onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
                </label>
                <label>
                  <small>Email</small>
                  <input value={guest.email} placeholder="Where your confirmation goes" inputMode="email" autoComplete="email" onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
                </label>
              </div>
              {/* Only the name and the mobile are required, and email is the one channel that is built, so a
                  guest who skips it hears nothing: not the confirmation, not a decline, not a cancellation. */}
              {!guest.email.trim() ? <p className="airsecsub">Leave it empty and we have no way to tell you when {item.title} answers. Your code stays under Trips on this device.</p> : null}
            </section>

            <section className="airsec">
              <p className="airfine">
                {cardNow
                  ? "Secure card payment. " + (ottoNow ? "Otto holds the card on your Profile, within " + money(wallet!.maxDollars) + ". " : "") + "Your card is held and only charged once " + item.title + (instant ? " has you booked." : " confirms.")
                  : instant
                    ? "Confirmed straight away."
                    : "This is a request. " + item.title + (guest.email.trim() ? " confirms by email, and nothing" : " confirms it, and nothing") + " is charged until they do."}{" "}
                Meet at {item.area}.
              </p>
            </section>
          </div>
        </div>
        <div className="airpayfoot">
          <button
            className="airaccent wide"
            type="button"
            disabled={!guestOk || sending}
            aria-busy={sending}
            onClick={() => {
              if (sending) return;
              try {
                localStorage.setItem("outset.guest", JSON.stringify(guest));
              } catch {
                /* private mode */
              }
              setSending(true);
              void Promise.resolve(
                onConfirm({
                  dateIdx,
                  slot: time,
                  qty,
                  optionIdx,
                  addonIdx,
                  guest: { name: guest.name.trim(), phone: guest.phone.trim(), email: guest.email.trim() || undefined },
                }),
              ).finally(() => setSending(false));
            }}
          >
            {sending ? "Sending…" : cta}
          </button>
        </div>
      </>
    );
  }

  const heroH = media.length ? 300 : 0;

  return (
    <>
      <div
        className="reqpad airlisting"
        key="listing"
        ref={padRef}
        onScroll={(e) => {
          const s = e.currentTarget.scrollTop > Math.max(8, heroH - 64);
          if (s !== stuck) setStuck(s);
        }}
      >
        <div className={"airbar" + (media.length ? " overlay" : " static") + (stuck ? " stuck" : "")}>
          <div className="airbarin">
            {topButtons(!media.length || stuck)}
          </div>
        </div>
        {media.length ? (
          <div className="airhero">
            {media.length === 1 ? (
              <HeroSlide m={media[0]} item={item} onBroken={() => drop(media[0].src)} />
            ) : (
              <div
                className="reqstrip"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  setSlide(Math.min(media.length - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
                }}
              >
                {media.map((m) => (
                  <div className="reqslide" key={m.src}>
                    <HeroSlide m={m} item={item} onBroken={() => drop(m.src)} />
                  </div>
                ))}
              </div>
            )}
            {media.length > 1 ? (
              <span className="aircounter">
                {Math.min(slide, media.length - 1) + 1} / {media.length}
              </span>
            ) : null}
          </div>
        ) : null}


        <div className={"airbody" + (media.length ? "" : " flat")}>
          {state.removeId === item.id ? (
            <div className="airnotice">
              <b>Is this your business and you'd rather not be listed?</b>
              <span>We take listings down within one business day. Send one line from a company email and it's gone.</span>
              <a
                className="airdark"
                href={"mailto:harshils2340@gmail.com?subject=" + encodeURIComponent("Remove listing: " + item.title + " (" + item.id + ")") + "&body=" + encodeURIComponent("Please remove " + item.title + " from Outset.\n\nListing: " + listingUrl(item.id) + "\n")}
              >
                Request removal
              </a>
            </div>
          ) : null}

          <div className="airtitle">
            <h1>{item.title}</h1>
            <AdminSiteLink item={{ src: item.src, contact: contact || item.contact }} className="airadminsite" />
            <p>{subtitle}</p>
            {duration || age ? <p className="soft">{[duration, age ? "Ages " + age + "+" : null].filter(Boolean).join(" · ")}</p> : null}
          </div>

          {score && guestFav ? (
            <div className="airfav">
              <span className="airfavnum">
                <b>{fmtRating(score.rating)}</b>
                <span className="airstars">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <IcStar key={i} size={9} />
                  ))}
                </span>
              </span>
              <span className="airfavmid">
                <IcLaurel />
                <b>
                  Guest
                  <br />
                  favourite
                </b>
                <IcLaurel flip />
              </span>
              <span className="airfavnum">
                <b>{fmtReviews(score.reviews)}</b>
                <small>Reviews</small>
              </span>
            </div>
          ) : score ? (
            <p className="airrateline">
              <IcStar size={12} /> <b>{fmtRating(score.rating)}</b> · <span className="u">{reviewsLine(score.reviews)}</span>
            </p>
          ) : null}

          {dealsNow.length ? (
            <div className="airdealnow" aria-label="Today's deal">
              <Markup html={ICONS.bolt} />
              <span>
                <b>Today's deal{dealsNow.length > 1 ? "s" : ""}</b>
                {dealsNow.map((d, i) => (
                  <small key={d.text + "|" + i}>
                    {dealShown(d).title}
                    {d.code ? " · code " + d.code : ""}
                    {d.end ? " · until " + clock12(d.end) : d.start ? " · from " + clock12(d.start) : ""}
                  </small>
                ))}
              </span>
            </div>
          ) : null}

          <section className="airsec airhost">
            <span className="airavatar">{item.title.replace(/^the\s+/i, "").charAt(0).toUpperCase()}</span>
            <span>
              <b>Hosted by {item.title}</b>
              <small>{[kind, item.area].join(" · ")}</small>
            </span>
          </section>

          {rows.length ? (
            <section className="airsec">
              <div className="airrows">
                {rows.map((r) => (
                  <div key={r.title + r.sub} className={"airrow" + (r.tone ? " " + r.tone : "")}>
                    <Markup html={r.icon} className="airrowico" />
                    <span className="airrowtext">
                      <b>{r.title}</b>
                      <small>{r.sub}</small>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {blurb ? (
            <section className="airsec">
              <p className={"airdesc" + (longBlurb && !moreDesc ? " clamp" : "")}>{blurb}</p>
              {longBlurb ? (
                <button type="button" className="airmorebtn" onClick={() => setMoreDesc((v) => !v)}>
                  {moreDesc ? "Show less" : "Show more"} <IcChevron size={10} dir={moreDesc ? "up" : "right"} />
                </button>
              ) : null}
            </section>
          ) : null}

          {highlights.length ? (
            <Section title="What you'll do">
              <Bullets items={highlights} icon={ICONS.check} />
            </Section>
          ) : null}

          {guide ? (
            <section className="airsec">
              <button type="button" className="airguide" onClick={() => setGuideOpen((v) => !v)} aria-expanded={guideOpen}>
                <span>
                  <b>What {kindLabel(item.art)} is actually like</b>
                  <small>{guide.time}</small>
                </span>
                <IcChevron size={14} dir={guideOpen ? "up" : "down"} />
              </button>
              {guideOpen ? (
                <div className="guide airguidebody">
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
                      <span className="guidechip" key={b}>
                        {b}
                      </span>
                    ))}
                  </div>
                  <p className="guidehead">Good for</p>
                  <p className="guidetext">{guide.goodFor}</p>
                  <p className="guidehead">Nervous?</p>
                  <p className="guidetext">{guide.nerves}</p>
                  <p className="guidefoot">
                    This is how {kindLabel(item.art)} usually works. {possessive(item.title)} own prices, ages, limits and rules are listed below.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          {item.options.length ? (
            <Section title="Choose a service" innerRef={svcRef}>
              {bookableServices(item.services).length ? (
                <div className="svclist">
                  {bookableServices(item.services).map((svc, svcIdx) => (
                    <div className="svc" key={svc.name + "|" + svcIdx}>
                      {svc.photo ? <img className="svcpic" src={thumb(svc.photo, "thumb")} srcSet={srcSet(svc.photo, "thumb")} sizes={SIZES.thumb} alt={tidyName(svc.name)} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} /> : null}
                      <div className="svchead2">
                        <b>{tidyName(svc.name)}</b>
                        {svc.desc && cleanDesc(svc.desc).length > 140 ? (
                          <button type="button" className="svcabout" onClick={() => setOpenSvc(openSvc === svc.name ? null : svc.name)}>
                            {openSvc === svc.name ? "Less" : "More"}
                          </button>
                        ) : null}
                      </div>
                      <ExplainLine explain={svc.explain} className="svcexplain" />
                      {svc.desc ? <p className="svcdesc">{openSvc === svc.name || cleanDesc(svc.desc).length <= 140 ? cleanDesc(svc.desc) : cleanDesc(svc.desc).slice(0, 140).replace(/\s+\S*$/, "") + "…"}</p> : null}
                      {(() => {
                        const key = svc.name + "|" + svcIdx;
                        const { shown, hidden } = splitVariants(svc.variants, optionIdx, moreSvc.includes(key));
                        const single = isStandardOnly(svc);
                        return (
                          <>
                            {shown.map((v) => {
                              const note = variantNote(v.explain, v.label);
                              const length = single ? optionLength(item, v.optionIdx) : null;
                              return (
                                <button key={svc.name + v.optionIdx} type="button" className={"addon" + (single ? " single" : "")} aria-pressed={optionIdx === v.optionIdx} onClick={() => setOptionIdx(v.optionIdx)} aria-label={single ? tidyName(svc.name) : undefined}>
                                  <span className="tick radio" />
                                  <span className="txt">
                                    {single ? (length ? <b>{length}</b> : null) : <b>{tidyLength(v.label)}</b>}
                                    {note ? <small className="varnote">{note}</small> : null}
                                  </span>
                                  <span className={"addonprice" + (hasPrice(v.price) ? "" : " ask")}>{hasPrice(v.price) ? priceWith(v.price, v.per) : "Price on request"}</span>
                                </button>
                              );
                            })}
                            {hidden ? (
                              <button type="button" className="svcmore" aria-expanded="false" onClick={() => setMoreSvc((c) => [...c, key])}>
                                More options ({hidden})
                              </button>
                            ) : moreSvc.includes(key) && svc.variants.some((v) => v.moreOptions) ? (
                              <button type="button" className="svcmore" aria-expanded="true" onClick={() => setMoreSvc((c) => c.filter((k) => k !== key))}>
                                Fewer options
                              </button>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="airoptions">
                  {item.options.map((o, i) => (
                    <button key={o.name + i} type="button" className="addon" aria-pressed={optionIdx === i} onClick={() => setOptionIdx(i)}>
                      <span className="tick radio" />
                      <span className="txt">
                        <b>{tidyName(o.name)}</b>
                        {o.detail ? <small>{tidyLength(o.detail)}</small> : null}
                      </span>
                      {optionPrice(o) ? <span className="addonprice">{optionPrice(o)}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </Section>
          ) : null}

          {item.addons && item.addons.length ? (
            <Section title="Add-ons">
              <div className="airoptions">
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
                    <span className="addonprice">{addonPrice(a) ? "+" + money(addonPrice(a)) : "Free"}</span>
                  </button>
                ))}
              </div>
            </Section>
          ) : null}

          {paused ? (
            <Section title={pausedHead} innerRef={dateRef}>
              <p className="reqpolicy">{pausedWhy}</p>
            </Section>
          ) : (
          <Section title="Date and time" sub={live ? "Live times from their booking system" : "Start times for " + fmtDate(day)} innerRef={dateRef}>
            <SlotCalendar
              dates={dates}
              dateIdx={dateIdx}
              onPickDate={setDateIdx}
              slots={chips.map((c) => c.time)}
              time={time}
              onPickTime={setTime}
              emptyNote={live ? "No departures on this date. Pick another day." : noStartTimesNote(week ? week[day.getDay()] ?? null : null, day.toLocaleDateString("en-US", { weekday: "long" }))}
              dayMeta={live ? (d) => {
                // The dot counts the departures the picker would really offer, so today cannot read as open in
                // the grid and empty under it once its last start time has gone.
                const n = chipsFor(d).length;
                return { open: n, full: n === 0 };
              } : undefined}
              slotMeta={
                live
                  ? (t) => {
                      const c = chips.find((x) => x.time === t);
                      const left = c?.seatsLeft;
                      return {
                        note: fewSeats(left) ? left + " left" : c?.price != null ? money(c.price) : undefined,
                        tone: fewSeats(left) ? "few" : undefined,
                      };
                    }
                  : undefined
              }
            />
            <div className="airguests">
              <span>
                <b>Guests</b>
                {/* A stepper that stops says whose limit stopped it, because a dead "+" with no reason beside it
                    reads as the page being broken. */}
                <small>{guestCap != null ? "This shop takes up to " + guestCap + (guestCap === 1 ? " guest" : " guests") : "People in your group"}</small>
              </span>
              <span className="airstepper">
                <button type="button" onClick={() => setQty(qty - 1)} disabled={qty <= 1} aria-label="Fewer people">
                  <IcMinus />
                </button>
                <span className="n">{qty}</span>
                <button type="button" onClick={() => setQty(Math.min(maxGuests, qty + 1))} disabled={qty >= maxGuests} aria-label="More people">
                  <IcPlus />
                </button>
              </span>
            </div>
          </Section>
          )}

          {includes.length || notIncluded.length ? (
            <Section title="What's included">
              {includes.length ? <Bullets items={includes} icon={ICONS.check} /> : null}
              {notIncluded.length ? (
                <>
                  <p className="airminor">Not included</p>
                  <Bullets items={notIncluded} icon={ICONS.close} className="no" />
                </>
              ) : null}
            </Section>
          ) : null}

          <Section title="Where you'll be">
            <div className="contact">
              <a className="crow maps" href={mapsDirHref(dest, here)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                <IcPin size={20} />
                <span>
                  <b>{item.meetingPoint ? tidyLine(item.meetingPoint) : place}</b>
                  {item.meetingPoint && address && item.meetingPoint !== address ? <small>{address}</small> : null}
                  <small className="go">{dist ? dist + " · Get directions" : "Get directions"}</small>
                </span>
              </a>
              {callHref && contact?.phone ? (
                <button type="button" className="crow" onClick={() => setCallOpen((v) => !v)} aria-expanded={callOpen}>
                  <Markup html={ICONS.phone} />
                  <span>
                    <b>{fmtPhone(contact.phone)}</b>
                    <small>{callOpen ? "Choose who to call" : "Tap to call"}</small>
                  </span>
                </button>
              ) : null}
              {callOpen && callHref ? (
                <div className="callpick">
                  <button type="button" className="airaccent" onClick={() => onAsk()}>
                    Ask Outset instead
                  </button>
                  <a className="airghost" href={callHref} onClick={(e) => e.stopPropagation()}>
                    Call a person at the shop
                  </a>
                  <p className="reqhint">Outset answers by chat for now. Voice is coming.</p>
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
            {checkin ? (
              <div className="reqbox">
                <b>When you arrive</b>
                {checkin}
              </div>
            ) : null}
          </Section>

          <section className="airsec">
            <div className="airotto">
              <div className="airottohead">
                <span className="airottomark">
                  <Markup html={ICONS.spark} />
                </span>
                <span>
                  <b>Ask Outset</b>
                  <small>Reads {possessive(item.title)} published info, and live availability, 24/7</small>
                </span>
              </div>
              {suggestions.length ? (
                <div className="airottochips">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => onAsk(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              <button type="button" className="airghost wide" onClick={() => onAsk()}>
                Message Outset
              </button>
            </div>
          </section>

          {score || reviews.length ? (
            <Section title={score ? "★ " + fmtRating(score.rating) + " · " + reviewsLine(score.reviews) : "What guests say"}>
              {reviews.length ? (
                <div className="airquotes">
                  {reviews.map((r) => (
                    <ReviewCard key={r.key} r={r} />
                  ))}
                </div>
              ) : null}
            </Section>
          ) : null}

          {item.promos?.length ? (
            <Section title="Deals">
              <ul className="reqdeals">
                {item.promos.map((pr, prIdx) => {
                  const onToday = dealsNow.includes(pr);
                  const d = dealShown(pr);
                  return (
                    <li key={d.title + "|" + prIdx} className={onToday ? "on" : ""}>
                      <span className="wdealtext">
                        <b className="wdealtitle">{d.title}</b>
                        {onToday ? <em>Today</em> : null}
                      </span>
                      {d.detail ? <p className="wdealdetail">{d.detail}</p> : null}
                      {d.code || d.when ? (
                        <span className="wdealmeta">
                          {d.code ? <span>Code: <b>{d.code}</b></span> : null}
                          {d.when ? <small>{d.when}</small> : null}
                        </span>
                      ) : null}
                      {d.date ? (
                        <span className="wdealchips">
                          <i className={"hit" + (onToday ? " today" : "")}>{d.date}</i>
                        </span>
                      ) : (
                        <span className="wdealchips" role="img" aria-label={dayLabel(d.days)}>
                          {d.days.length ? (
                            DAY_SHORT.map((dn, i) => (
                              <i key={dn} className={d.days.includes(i) ? (i === today ? "hit today" : "hit") : ""}>
                                {dn}
                              </i>
                            ))
                          ) : (
                            <i className={"hit" + (onToday ? " today" : "")}>Every day</i>
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}

          <Section title="Things to know">
            <div className="airknows">
              <KnowRow icon={ICONS.user} title="Who can go" summary={requirements[0] ? tidyLine(requirements[0]) : "Contact the business to check"}>
                {requirements.length ? <Bullets items={requirements} /> : <FactList lines={facts.who.filter((l) => l.posted)} />}
              </KnowRow>
              {item.bring?.length ? (
                <KnowRow icon={ICONS.ticket} title="What to bring" summary={plainWords(item.bring.slice(0, 3).join(", "))}>
                  <Bullets items={item.bring} />
                </KnowRow>
              ) : null}
              {item.groupInfo?.length ? (
                <KnowRow icon={ICONS.user} title="Groups" summary={tidyLine(item.groupInfo[0])}>
                  <Bullets items={item.groupInfo} />
                </KnowRow>
              ) : null}
              <KnowRow icon={ICONS.check} title="Waiver and check-in" summary={waiverLines[0] ? tidyLine(waiverLines[0]) : item.waiverUrl ? "Sign online before you arrive" : "Contact the business to check"}>
                {waiverLines.length ? <Bullets items={waiverLines} /> : <FactList lines={facts.waiver.filter((l) => l.posted && l.text.length <= 160)} />}
                {safeHttpUrl(item.waiverUrl) ? (
                  <a className="reqwaiver" href={safeHttpUrl(item.waiverUrl)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    <Markup html={ICONS.ticket} />
                    <span>
                      <b>Sign the waiver online before you arrive</b>
                      <small>Saves time at check-in. Opens the operator's waiver form.</small>
                    </span>
                  </a>
                ) : null}
              </KnowRow>
              <KnowRow
                icon={ICONS.clock}
                title={otherPolicies.length ? "Policies" : "Cancellation policy"}
                summary={cancel || (item.cancellation ? tidyLine(item.cancellation) : cancelPolicies[0] ? tidyLine(cancelPolicies[0]) : "Contact the business for cancellation terms")}
              >
                {item.cancellation ? (
                  <p className="reqpolicy">{tidyLine(item.cancellation)}</p>
                ) : cancelPolicies.length ? null : (
                  <p className="reqpolicy gap">Contact {item.title} for their cancellation terms before you book.</p>
                )}
                {cancelPolicies.length ? <Bullets items={cancelPolicies} /> : null}
                {otherPolicies.length ? <Bullets items={otherPolicies} /> : null}
                {facts.note && !item.cancellation && !item.policies?.length ? <p className="reqpolicy">{facts.note}</p> : null}
              </KnowRow>
            </div>
          </Section>

          {item.faq?.length ? (
            <Section title="Frequently asked questions">
              <div className="reqfaq">
                {item.faq.map((f, i) => (
                  <div key={i} className={"reqfaqitem" + (openFaq === i ? " open" : "")}>
                    <button type="button" onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
                      <span>{tidyLine(f.q)}</span>
                      <IcChevron size={14} dir={openFaq === i ? "up" : "down"} />
                    </button>
                    {openFaq === i ? <p>{tidyLine(f.a)}</p> : null}
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {videos.length || embed ? (
            <Section title="See it in action" sub={"Videos from " + possessive(item.title) + " own channels."}>
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
            </Section>
          ) : null}
        </div>
      </div>

      <div className="airreserve">
        {paused ? (
          <>
            <span className="airreserveprice">
              <span className="big">
                <b>{item.offline ? "Hidden right now" : "Not taking bookings"}</b>
              </span>
              {/* One short line: the bar keeps it on one row beside the button, so a longer sentence is cut off
                  with an ellipsis. The section above carries the shop's own wording in full. */}
              <span className="why">{item.offline ? "Taken down for now." : "Check back soon."}</span>
            </span>
            <button type="button" className="airaccent" onClick={onBack}>
              Find another
            </button>
          </>
        ) : (
        <>
        <button type="button" className="airreserveprice" onClick={() => dateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {ready && p.total ? (
            <span className="big">
              <b>{money(p.total)}</b> total
            </span>
          ) : picked && hasPrice(picked.price) ? (
            <span className="big">
              <b>{priceWith(picked.price, picked.per)}</b>
            </span>
          ) : from != null ? (
            <span className="big">
              From <b>{money(from)}</b>
              {fromPer}
            </span>
          ) : (
            <span className="big">
              <b>{instant ? "Instant Book" : "Request to book"}</b>
            </span>
          )}
          <span className={"when" + (nudge ? " nudge" : "")}>{nudge || (ready && time ? day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " · " + fmtTime(time) : "Choose a date")}</span>
        </button>
        <button type="button" className="airaccent" onClick={reserve}>
          {instant ? "Reserve" : "Request"}
        </button>
        </>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------------------------------------------
   Search: the full-screen Where / What / When / Who sheet lives in explore/SearchSheet.tsx; Filters stays here.
   --------------------------------------------------------------------------------------------------------------- */

function SearchBody() {
  const { sheetMode } = usePrefs();
  return sheetMode === "filters" ? <FiltersBody /> : <SearchSheet />;
}

const FILTERS: { key: keyof FeedFilters; title: string; sub: string; icon: string }[] = [
  { key: "fav", title: "Guest favourites", sub: "4.8 or higher from 100+ reviews", icon: ICONS.star },
  { key: "cancel", title: "Free cancellation", sub: "Published in their policy", icon: ICONS.check },
  { key: "deal", title: "Deals today", sub: "A promo running today", icon: ICONS.bolt },
  { key: "priced", title: "Shows prices", sub: "Prices on the listing", icon: ICONS.ticket },
];

function FiltersBody() {
  const { state, closeSheet, setCat } = useApp();
  const prefs = usePrefs();
  const [cat, setPendingCat] = useState<CategoryId>(state.cat);
  const [f, setF] = useState<FeedFilters>(prefs.filters);
  const count = useMemo(() => {
    const catalog = getCatalog();
    const q = state.q.trim();
    const base = q ? nearFirst(searchSuggest(catalog, q, { metroId: state.metroId, cat }).results, state.near) : browseList(catalog, cat, state.metroId, state.near);
    return applyFilters(base, f).length;
  }, [cat, f, state.q, state.metroId, state.near, state.catalogVersion]);

  return (
    <div className="airsearch filters">
      <div className="airfilterstop">
        <button type="button" className="aircircle flat" onClick={closeSheet} aria-label="Close">
          <IcClose size={14} />
        </button>
        <h1>Filters</h1>
        <span className="aircircle ghostslot" aria-hidden />
      </div>
      <div className="airfiltersbody">
        <section className="airfsec">
          <h2>Recommended for you</h2>
          <div className="airftiles">
            {FILTERS.map((x) => (
              <button key={x.key} type="button" className="airftile" aria-pressed={f[x.key]} onClick={() => setF({ ...f, [x.key]: !f[x.key] })}>
                <Markup html={x.icon} />
                <b>{x.title}</b>
                <small>{x.sub}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="airfsec">
          <h2>Type of experience</h2>
          <div className="airfpills">
            {CATS.map((c) => (
              <button key={c.id} type="button" className="airfpill" aria-pressed={cat === c.id} onClick={() => setPendingCat(c.id)}>
                <Markup html={ICONS[c.icon]} />
                {c.name}
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="airsearchfoot">
        <button
          type="button"
          className="airlink"
          onClick={() => {
            setF({ fav: false, cancel: false, deal: false, priced: false });
            setPendingCat("all");
          }}
        >
          Clear all
        </button>
        <button
          type="button"
          className="airdark"
          onClick={() => {
            setPrefs({ filters: f, view: "feed" });
            if (cat !== state.cat) setCat(cat);
            closeSheet();
          }}
        >
          {count ? "Show " + (count > 1000 ? "1,000+" : count.toLocaleString()) + (count === 1 ? " experience" : " experiences") : "No exact matches"}
        </button>
      </div>
    </div>
  );
}
