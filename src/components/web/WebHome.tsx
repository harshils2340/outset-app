import "../../styles/air-home.css";
import { createContext, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CATS, CATMETA, inCat } from "../../data/categories";
import { ART_LABEL } from "../../data/art";
import { ICONS } from "../../data/icons";
import { ALL_METRO_ID, METROS, metroById } from "../../data/metros";
import type { ArtKind, CategoryId, Unclaimed } from "../../data/types";
import { fromPrice, getCatalog, publicRating } from "../../lib/catalog";
import { listingFacts } from "../../lib/catalog";
import { fmtDate, fmtReviews, money, titleCase } from "../../lib/format";
import { ART_ALIASES, metroInQuery, parseIntent, searchSuggest, warmSearch, type SearchScope } from "../../lib/search";
import { loadListing } from "../../lib/catalogLoad";
import { dealToday } from "../../lib/companyAgent";
import { itemOpenState } from "../../lib/openNow";
import { currentLocation, fmtDistance, nearestLocation, searchPlaces, type Place } from "../../lib/places";
import { useApp } from "../../state/AppProvider";
import { Photo } from "../art/Photo";
import { useNearNow } from "./NearNow";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";

/**
 * Desktop home, laid out as airbnb.com: a white header with the Outset mark, a three-way switch and the account
 * menu; the Where / When / Who pill whose segments open as large popovers; the icon category bar with Filters;
 * rows of photo cards (Airbnb's "Guest favourites in X"); a flat card grid once a category, order, price or
 * search narrows things; and Airbnb's three-column footer. Styles live in styles/air-home.css under `ah-`.
 */

/**
 * Every kind in the catalog, in the order the home mixes them: experiences first (water, air, adrenaline),
 * then food and drink, classes, play, wellness, outdoor, culture. The home shows the strongest HOME_RAILS
 * for the chosen place and the rest as links under "More kinds".
 */
const RAIL_KINDS: { art: ArtKind; title: string }[] = [
  // water
  { art: "jetski", title: "Jet ski rentals" },
  { art: "pontoon", title: "Pontoon and boat rentals" },
  { art: "fishing", title: "Fishing charters" },
  { art: "cruise", title: "Sunset cruises and sails" },
  { art: "kayak", title: "Kayak and paddle" },
  { art: "parasail", title: "Parasailing" },
  { art: "scuba", title: "Scuba and snorkel" },
  { art: "surf", title: "Surf lessons" },
  { art: "sailing", title: "Sailing lessons and charters" },
  { art: "rafting", title: "Whitewater rafting" },
  // air
  { art: "skydive", title: "Tandem skydives" },
  { art: "heli", title: "Helicopter tours" },
  { art: "balloon", title: "Hot air balloon rides" },
  { art: "paragliding", title: "Paragliding" },
  { art: "gliding", title: "Glider flights" },
  // adrenaline
  { art: "kart", title: "Go-kart racing" },
  { art: "zipline", title: "Ziplines" },
  { art: "escape", title: "Escape rooms" },
  { art: "axe", title: "Axe throwing" },
  { art: "rage", title: "Rage rooms" },
  { art: "paintball", title: "Paintball" },
  { art: "range", title: "Shooting ranges" },
  { art: "archery", title: "Archery" },
  { art: "motorsport", title: "Motocross, ATV and off-road" },
  { art: "climbing", title: "Climbing gyms" },
  // food and drink
  { art: "brewery", title: "Breweries and taprooms" },
  { art: "winery", title: "Wineries and tastings" },
  { art: "distillery", title: "Distilleries" },
  { art: "cooking", title: "Cooking classes" },
  // classes
  { art: "pottery", title: "Pottery and paint-and-sip" },
  { art: "dance", title: "Dance and fitness classes" },
  { art: "martialarts", title: "Martial arts" },
  { art: "yoga", title: "Yoga and pilates" },
  { art: "fitness", title: "Fitness classes" },
  { art: "gymnastics", title: "Gymnastics, cheer and parkour" },
  { art: "swim", title: "Pools and swim lessons" },
  // play
  { art: "bowling", title: "Bowling" },
  { art: "minigolf", title: "Mini golf" },
  { art: "arcade", title: "Arcades" },
  { art: "trampoline", title: "Trampoline parks" },
  { art: "lasertag", title: "Laser tag" },
  { art: "icerink", title: "Ice skating" },
  { art: "karaoke", title: "Karaoke rooms" },
  { art: "billiards", title: "Billiards, darts and shuffleboard" },
  { art: "waterpark", title: "Water parks" },
  { art: "themepark", title: "Theme parks" },
  { art: "venue", title: "Party and event venues" },
  // wellness
  { art: "spa", title: "Spas and massage" },
  { art: "sauna", title: "Sauna, bathhouse and cold plunge" },
  // outdoor
  { art: "golf", title: "Golf courses and ranges" },
  { art: "discgolf", title: "Disc golf, driving ranges and topgolf" },
  { art: "horse", title: "Horseback rides" },
  { art: "camping", title: "Campgrounds and glamping" },
  { art: "tennis", title: "Tennis and pickleball courts" },
  { art: "ski", title: "Ski and snowboard" },
  { art: "snowmobile", title: "Snowmobile tours" },
  { art: "bike", title: "Bike and e-bike rentals" },
  // culture
  { art: "museum", title: "Museums and exhibits" },
  { art: "theatre", title: "Live theatre and shows" },
  { art: "tour", title: "Guided tours" },
  { art: "zoo", title: "Zoos and wildlife parks" },
  { art: "aquarium", title: "Aquariums" },
  { art: "garden", title: "Botanical gardens and parks" },
];

/** Rails on the home before the rest collapse into "More kinds" links. */
const HOME_RAILS = 14;
/** Cards in a grid before "Show more". Divisible by 2, 3, 4, 5 and 6 so every column count ends on a full row. */
const GRID_PAGE = 60;
const HELP_EMAIL = "hello@onoutset.com";

/** Idle time if the browser offers it, the next tick if it does not. */
function whenIdle(run: () => void): void {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run);
  else window.setTimeout(run, 50);
}

/** What a "More kinds" link types into the search: the first alias, so the search names exactly that kind. */
const kindQuery = (art: ArtKind) => ART_ALIASES[art]?.[0] || art;

function rankForRail(list: Unclaimed[]): Unclaimed[] {
  // A rail is photos. Places without one wait in search results until the crawl or the operator adds a picture.
  return list
    .filter((u) => !!u.cover)
    .sort((a, b) => {
      // "Popular Jet Ski Rentals" must open on jet ski rentals: a listing whose own words never confirm its kind
      // goes after every one that does, however many reviews it has.
      if (!!a.kindUnconfirmed !== !!b.kindUnconfirmed) return a.kindUnconfirmed ? 1 : -1;
      const pa = (a.cover ? 3 : 0) + (fromPrice(a) != null ? 2 : 0) + Math.min(2, Math.log10((a.reviews || 0) + 1));
      const pb = (b.cover ? 3 : 0) + (fromPrice(b) != null ? 2 : 0) + Math.min(2, Math.log10((b.reviews || 0) + 1));
      return pb - pa;
    });
}

/** Up to three listings a guest wants side by side. */
const CompareCtx = createContext<{ ids: string[]; toggle: (id: string) => void }>({ ids: [], toggle: () => {} });

/** The Where menu's shortlist: the biggest cities a guest would type, not the first twelve metros in the file. */
const POPULAR_METROS = ["toronto", "nyc", "los-angeles", "chicago", "miami", "tampa", "vancouver", "austin", "denver", "seattle", "las-vegas", "boston", "atlanta", "san-diego", "montreal", "orlando"];

/**
 * Airbnb's Homes / Experiences / Services switch, mapped onto Outset's own tabs: everything, food and drink,
 * and wellness. It writes the same category as the icon bar below, so the two never disagree.
 */
const SWITCH: { id: CategoryId; label: string; icon: string }[] = [
  { id: "all", label: "Experiences", icon: "catAll" },
  { id: "food", label: "Food & drink", icon: "catFood" },
  { id: "wellness", label: "Wellness", icon: "catWellness" },
];

type SortId = "relevance" | "distance" | "price" | "rating";
const SORTS: { id: SortId; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "distance", label: "Nearest" },
  { id: "price", label: "Price: low to high" },
  { id: "rating", label: "Top rated" },
];

type Seg = "where" | "when" | "who";
type PriceRange = { min: number | null; max: number | null };

const SVG = {
  menu: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h12"/></svg>',
  avatar: '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="currentColor"/><circle cx="16" cy="12.5" r="5" fill="#fff"/><path d="M6.6 26.2a10.6 10.6 0 0 1 18.8 0A15.9 15.9 0 0 1 16 30a15.9 15.9 0 0 1-9.4-3.8z" fill="#fff"/></svg>',
  filters: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 4.5h7M12.5 4.5h2M1.5 11.5h2M7.5 11.5h7"/><circle cx="10.5" cy="4.5" r="2"/><circle cx="5.5" cy="11.5" r="2"/></svg>',
  left: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5 5 8l5.5 5.5"/></svg>',
  right: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 2.5 11 8l-5.5 5.5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 2.5v11M2.5 8h11"/></svg>',
  minus: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 8h11"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m3 3 10 10M13 3 3 13"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="7" cy="7" r="5"/><path d="m11 11 3.5 3.5"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3L13 4.5"/></svg>',
  star: '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 .9 10.2 5.6l5.1.6-3.8 3.5 1 5L8 12.2l-4.5 2.5 1-5L.7 6.2l5.1-.6z"/></svg>',
};

/* ------------------------------------------------------------------------------------------------------------ */
/* Cards                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------ */

function CompareCheck({ id, title, small }: { id: string; title: string; small?: boolean }) {
  const { ids, toggle } = useContext(CompareCtx);
  const on = ids.includes(id);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={"Compare " + title}
      className={"ah-cmpcheck" + (on ? " on" : "") + (small ? " small" : "")}
      onClick={(e) => { e.stopPropagation(); toggle(id); }}
    >
      <span className="box">{on ? <Markup html={SVG.check} /> : null}</span>
      {small ? null : <span>Compare</span>}
    </button>
  );
}

/** The card's pill: Top rated beats a deal beats open now, one pill at most, the way Airbnb shows one badge. */
function cardBadge(u: Unclaimed, open: boolean): string | null {
  const score = publicRating(u);
  if (score && score.rating >= 4.8 && score.reviews >= 50) return "Top rated";
  if (dealToday(u)) return "Deal today";
  if (open) return "Open now";
  return null;
}

function Card({ u, onOpen, near, rail }: { u: Unclaimed; onOpen: (id: string) => void; near?: Place | null; rail?: boolean }) {
  const score = publicRating(u);
  const metro = metroById(u.metroId);
  const from = fromPrice(u);
  const openSt = useMemo(() => itemOpenState(u), [u]);
  const gallery = useMemo(() => Array.from(new Set([u.cover, ...(u.photos || [])].filter(Boolean) as string[])).slice(0, 5), [u.cover, u.photos]);
  const [pic, setPic] = useState(0);
  const badge = cardBadge(u, !!openSt?.open);
  const priced = from != null ? u.options.find((o) => o.price === from) : undefined;
  const per = (priced?.per || "").replace(/^\//, "").trim();
  const where = (() => {
    const n = near ? nearestLocation(u, near) : null;
    const extra = u.locations?.length ? " · " + (u.locations.length + 1) + " locations" : "";
    if (n) return n.label + " · " + fmtDistance(n.km) + " away" + extra;
    return u.area + (metro && !u.area.includes(metro.name) ? " · " + metro.name : "") + extra;
  })();
  const detail = u.dur
    ? u.dur
    : openSt?.open && openSt.closesAt
      ? "Open until " + openSt.closesAt
      : openSt && !openSt.open
        ? openSt.label
        : u.fc
          ? "Free cancellation"
          : ART_LABEL[u.art];
  const step = (d: number) => setPic((i) => (i + d + gallery.length) % gallery.length);
  const stars = score ? (
    <span className="ah-card-rate">
      <Markup html={SVG.star} />
      {score.rating.toFixed(1)}
      <em>({fmtReviews(score.reviews)})</em>
    </span>
  ) : null;
  return (
    <div className="ah-card">
      <button type="button" className="ah-card-hit" onClick={() => onOpen(u.id)} aria-label={u.title + (score ? ", rated " + score.rating.toFixed(1) : "")} />
      <div className="ah-card-photo">
        <Photo key={gallery[pic] || "cover"} src={gallery[pic]} video={pic === 0 ? u.video : undefined} kind={u.art} id={"w" + u.id} alt="" />
        {badge ? <span className={"ah-card-badge" + (badge === "Deal today" ? " deal" : "")}>{badge}</span> : null}
        <span className="ah-card-heart" aria-hidden="true"><Markup html={ICONS.heart} /></span>
        {gallery.length > 1 ? (
          <>
            <button type="button" className="ah-card-nav prev" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); step(-1); }} hidden={pic === 0}>
              <Markup html={SVG.left} />
            </button>
            <button type="button" className="ah-card-nav next" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); step(1); }} hidden={pic === gallery.length - 1}>
              <Markup html={SVG.right} />
            </button>
            <span className="ah-card-dots" aria-hidden="true">
              {gallery.map((_, i) => <i key={i} className={i === pic ? "on" : ""} />)}
            </span>
          </>
        ) : null}
        <CompareCheck id={u.id} title={u.title} small={gallery.length > 1} />
      </div>
      <div className="ah-card-text">
        {/* Airbnb's grid puts the stars beside the title; its narrow rows move them to the end of the price line. */}
        <div className="ah-card-line1">
          <span className="ah-card-title">{u.title}</span>
          {rail ? null : stars}
        </div>
        <div className="ah-card-sub">{where}</div>
        <div className="ah-card-sub">{detail}</div>
        <div className="ah-card-price">
          {from == null ? (
            <span>Request to book</span>
          ) : per && per !== "each" ? (
            <><b>{money(from)}</b> / {per}</>
          ) : (
            <>From <b>{money(from)}</b></>
          )}
          {rail && stars ? <><span className="ah-card-dot" aria-hidden="true"> · </span>{stars}</> : null}
        </div>
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="ah-card is-skel" aria-hidden="true">
      <div className="ah-card-photo skel" />
      <div className="ah-card-text">
        <span className="skel ah-skelline" />
        <span className="skel ah-skelline short" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Rows and grids                                                                                                */
/* ------------------------------------------------------------------------------------------------------------ */

function RowArrows({ onPrev, onNext, canPrev, canNext }: { onPrev: () => void; onNext: () => void; canPrev: boolean; canNext: boolean }) {
  return (
    <span className="ah-arrows">
      <button type="button" aria-label="Previous" onClick={onPrev} disabled={!canPrev}><Markup html={SVG.left} /></button>
      <button type="button" aria-label="Next" onClick={onNext} disabled={!canNext}><Markup html={SVG.right} /></button>
    </span>
  );
}

function Rail({ title, items, onOpen, near, eager, onShowAll, note }: { title: string; items: Unclaimed[]; onOpen: (id: string) => void; near?: Place | null; eager?: boolean; onShowAll?: () => void; note?: string }) {
  const wrapRef = useRef<HTMLElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Off-screen rails stay as skeletons so a page of 15 rails does not fetch hundreds of photos at once.
  const [live, setLive] = useState(!!eager);
  const [shown, setShown] = useState(10);
  const [edge, setEdge] = useState({ prev: false, next: true });
  useEffect(() => {
    if (live || !wrapRef.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setLive(true);
        io.disconnect();
      }
    }, { rootMargin: "480px" });
    io.observe(wrapRef.current);
    return () => io.disconnect();
  }, [live]);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({ prev: el.scrollLeft > 4, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(measure, [live, shown, items.length]);
  const scroll = (dir: number) => {
    setLive(true);
    setShown(24);
    ref.current?.scrollBy({ left: dir * ref.current.clientWidth, behavior: "smooth" });
  };
  if (!items.length) return null;
  return (
    <section className="ah-rail" ref={wrapRef} aria-label={title}>
      <div className="ah-rowhead">
        <div className="ah-rowtitle">
          <h2>{title}</h2>
          {note ? <p>{note}</p> : null}
        </div>
        <div className="ah-rowtools">
          {onShowAll ? <button type="button" className="ah-showall" onClick={onShowAll}>Show all</button> : null}
          <RowArrows onPrev={() => scroll(-1)} onNext={() => scroll(1)} canPrev={edge.prev} canNext={edge.next} />
        </div>
      </div>
      <div className="ah-railrow" ref={ref} onScroll={() => { measure(); if (live && shown < 24) setShown(24); }}>
        {live
          ? items.slice(0, shown).map((u) => <Card key={u.id} u={u} onOpen={onOpen} near={near} rail />)
          : Array.from({ length: Math.min(8, items.length) }, (_, i) => <CardSkeleton key={i} />)}
      </div>
    </section>
  );
}

function Grid({ items, onOpen, near, resetKey }: { items: Unclaimed[]; onOpen: (id: string) => void; near?: Place | null; resetKey: string }) {
  const [shown, setShown] = useState(GRID_PAGE);
  useEffect(() => setShown(GRID_PAGE), [resetKey]);
  return (
    <>
      <div className="ah-grid">
        {items.slice(0, shown).map((u) => <Card key={u.id} u={u} onOpen={onOpen} near={near} />)}
      </div>
      {items.length > shown ? (
        <div className="ah-more">
          <p>Showing {shown.toLocaleString()} of {items.length.toLocaleString()}</p>
          <button type="button" className="ah-btn-dark" onClick={() => setShown((n) => n + GRID_PAGE)}>Show more</button>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Compare                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------ */

function CompareTable({ items, near, onOpen, onClose, onRemove }: { items: Unclaimed[]; near?: Place | null; onOpen: (id: string) => void; onClose: () => void; onRemove: (id: string) => void }) {
  const { touchCatalog } = useApp();
  useEffect(() => {
    Promise.all(items.map((u) => loadListing(u.id))).then((r) => r.some(Boolean) && touchCatalog());
  }, [items.map((u) => u.id).join(",")]);
  useEscape(onClose);
  const row = (label: string, cell: (u: Unclaimed) => React.ReactNode) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      {items.map((u) => <td key={u.id}>{cell(u)}</td>)}
    </tr>
  );
  const firstPriced = (u: Unclaimed) => u.options.find((o) => o.price != null);
  return (
    <div className="ah-modal-scrim" onClick={onClose}>
      <div className="ah-modal wide" role="dialog" aria-modal="true" aria-label="Compare" onClick={(e) => e.stopPropagation()}>
        <div className="ah-modal-head">
          <button type="button" className="ah-iconbtn" aria-label="Close" onClick={onClose} autoFocus><Markup html={SVG.close} /></button>
          <h2>Compare</h2>
          <span />
        </div>
        <div className="ah-modal-body">
          <table className="ah-cmp">
            <thead>
              <tr>
                <th />
                {items.map((u) => (
                  <th key={u.id} scope="col">
                    <div className="ah-cmp-art"><Photo src={u.cover} kind={u.art} id={"c" + u.id} alt="" /></div>
                    <b>{u.title}</b>
                    <button type="button" className="ah-textbtn" onClick={() => onRemove(u.id)}>Remove</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row("From", (u) => { const f = fromPrice(u); return f != null ? <b>{money(f)}</b> : <span className="ah-muted">Request to book</span>; })}
              {row("Rating", (u) => { const sc = publicRating(u); return sc ? <span className="ah-cmp-rate"><Markup html={SVG.star} /> {sc.rating.toFixed(1)} <em className="ah-muted">({fmtReviews(sc.reviews)})</em></span> : <span className="ah-muted">No public rating</span>; })}
              {row("Where", (u) => { const n = near ? nearestLocation(u, near) : null; return n ? n.label + " · " + fmtDistance(n.km) + " away" : u.area; })}
              {row("What you'd book", (u) => { const o = firstPriced(u) || u.options[0]; return o ? o.name + (o.detail ? " · " + o.detail : "") : <span className="ah-muted">Menu not published</span>; })}
              {row("Options", (u) => u.options.length ? u.options.length + (u.options.length === 1 ? " option" : " options") : <span className="ah-muted">None listed</span>)}
              {row("Who can go", (u) => { const f = listingFacts(u).who.find((l) => l.posted); return f ? f.text : <span className="ah-muted">Not posted</span>; })}
              {row("Included", (u) => u.includes.length ? u.includes.slice(0, 3).join(", ") : <span className="ah-muted">Not posted</span>)}
              {row("Photos", (u) => (u.photos?.length || (u.cover ? 1 : 0)) + "")}
              {row("", (u) => <button type="button" className="ah-btn-dark small" onClick={() => onOpen(u.id)}>View and book</button>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Small shared pieces                                                                                           */
/* ------------------------------------------------------------------------------------------------------------ */

/** Escape closes the topmost popover or modal. */
function useEscape(run: () => void, active = true) {
  const cb = useRef(run);
  cb.current = run;
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") cb.current(); };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [active]);
}

function Stepper({ label, sub, value, min, max, onChange }: { label: string; sub: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="ah-steprow">
      <span>
        <b>{label}</b>
        <small>{sub}</small>
      </span>
      <span className="ah-stepper">
        <button type="button" aria-label={"Fewer " + label.toLowerCase()} disabled={value <= min} onClick={() => onChange(value - 1)}><Markup html={SVG.minus} /></button>
        <span aria-live="polite">{value}</span>
        <button type="button" aria-label={"More " + label.toLowerCase()} disabled={value >= max} onClick={() => onChange(value + 1)}><Markup html={SVG.plus} /></button>
      </span>
    </div>
  );
}

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];

/** Two months side by side. Only the days the app can book (the provider's date list) are selectable. */
function Calendar({ dates, idx, onPick }: { dates: Date[]; idx: number; onPick: (i: number) => void }) {
  const first = dates[0];
  const last = dates[dates.length - 1];
  const span = (last.getFullYear() - first.getFullYear()) * 12 + last.getMonth() - first.getMonth();
  const [offset, setOffset] = useState(0);
  const byDay = useMemo(() => new Map(dates.map((d, i) => [d.toDateString(), i])), [dates]);
  const today = new Date().toDateString();
  const month = (k: number) => {
    const m = new Date(first.getFullYear(), first.getMonth() + offset + k, 1);
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = [...Array.from({ length: m.getDay() }, () => null), ...Array.from({ length: days }, (_, i) => new Date(m.getFullYear(), m.getMonth(), i + 1))];
    return (
      <div className="ah-month" key={k}>
        <h3>{m.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3>
        <div className="ah-monthgrid" role="grid">
          {WEEK.map((w, i) => <span key={"h" + i} className="ah-wd" aria-hidden="true">{w}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={i} />;
            const di = byDay.get(d.toDateString());
            return (
              <button
                type="button"
                key={i}
                className={"ah-day" + (di === idx ? " on" : "") + (d.toDateString() === today ? " today" : "")}
                disabled={di == null}
                aria-pressed={di === idx}
                aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + (di == null ? ", not bookable yet" : "")}
                onClick={() => di != null && onPick(di)}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <div className="ah-cal">
      <button type="button" className="ah-calnav prev" aria-label="Previous month" disabled={offset === 0} onClick={() => setOffset((o) => o - 1)}><Markup html={SVG.left} /></button>
      <button type="button" className="ah-calnav next" aria-label="Next month" disabled={offset + 1 >= Math.max(1, span)} onClick={() => setOffset((o) => o + 1)}><Markup html={SVG.right} /></button>
      {month(0)}
      {month(1)}
    </div>
  );
}

function UserMenu({ onOperators, onOpenApp }: { onOperators: () => void; onOpenApp: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEscape(() => { setOpen(false); btn.current?.focus(); }, open);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", on);
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("mousedown", on);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") || []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const go = (run: () => void) => () => { setOpen(false); run(); };
  return (
    <div className="ah-usermenu" ref={ref}>
      <button ref={btn} type="button" className="ah-userbtn" aria-haspopup="menu" aria-expanded={open} aria-label="Main menu" onClick={() => setOpen((v) => !v)}>
        <Markup html={SVG.menu} />
        <Markup className="ah-avatar" html={SVG.avatar} />
      </button>
      {open ? (
        <div className="ah-menu" role="menu" onKeyDown={onKey}>
          <a role="menuitem" href={"mailto:" + HELP_EMAIL} onClick={() => setOpen(false)}>Help Centre</a>
          <hr />
          <button type="button" role="menuitem" className="ah-menu-feature" onClick={go(onOperators)}>
            <span>
              <b>List your business</b>
              <small>Claim your free listing and take bookings online.</small>
            </span>
            <Mark size={36} />
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={go(onOperators)}>For operators</button>
          <button type="button" role="menuitem" onClick={go(onOpenApp)}>Open the phone app</button>
          <hr />
          <button type="button" role="menuitem" onClick={go(onOperators)}>Operator log in or sign up</button>
        </div>
      ) : null}
    </div>
  );
}

function CategoryBar({ cat, setCat, filterCount, onFilters }: { cat: CategoryId; setCat: (c: CategoryId) => void; filterCount: number; onFilters: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ prev: false, next: false });
  const measure = () => {
    const el = ref.current;
    if (el) setEdge({ prev: el.scrollLeft > 2, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: "smooth" });
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const tabs = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=tab]") || []);
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
    tabs[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return (
    <div className="ah-cats">
      <div className={"ah-cats-track" + (edge.prev ? " fade-l" : "") + (edge.next ? " fade-r" : "")}>
        {edge.prev ? <button type="button" className="ah-cats-arrow prev" aria-label="Previous categories" onClick={() => scroll(-1)}><Markup html={SVG.left} /></button> : null}
        <div className="ah-cats-scroll" ref={ref} role="tablist" aria-label="Categories" onScroll={measure} onKeyDown={onKey}>
          {CATS.map((c) => (
            <button
              type="button"
              role="tab"
              key={c.id}
              aria-selected={cat === c.id}
              tabIndex={cat === c.id ? 0 : -1}
              className="ah-cat"
              onClick={() => setCat(c.id)}
            >
              <Markup html={ICONS[c.icon]} />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
        {edge.next ? <button type="button" className="ah-cats-arrow next" aria-label="More categories" onClick={() => scroll(1)}><Markup html={SVG.right} /></button> : null}
      </div>
      <button type="button" className={"ah-filters" + (filterCount ? " on" : "")} onClick={onFilters}>
        <Markup html={SVG.filters} />
        <span>Filters</span>
        {filterCount ? <em>{filterCount}</em> : null}
      </button>
    </div>
  );
}

function FiltersModal({ sort, price, prices, total, near, onApply, onClose, onNeedPlace }: {
  sort: SortId;
  price: PriceRange;
  prices: number[];
  total: number;
  near: Place | null;
  onApply: (sort: SortId, price: PriceRange) => void;
  onClose: () => void;
  onNeedPlace: () => void;
}) {
  const [draftSort, setDraftSort] = useState<SortId>(sort);
  const sortedPrices = useMemo(() => prices.slice().sort((a, b) => a - b), [prices]);
  const lo = sortedPrices.length ? Math.floor(sortedPrices[0]) : 0;
  const hi = useMemo(() => {
    if (!sortedPrices.length) return 0;
    const p90 = sortedPrices[Math.min(sortedPrices.length - 1, Math.floor(sortedPrices.length * 0.9))];
    const nice = p90 <= 100 ? 10 : p90 <= 500 ? 25 : 50;
    return Math.max(lo + nice, Math.ceil(p90 / nice) * nice);
  }, [sortedPrices, lo]);
  const [dmin, setDmin] = useState(price.min ?? lo);
  const [dmax, setDmax] = useState(price.max ?? hi);
  useEscape(onClose);
  const BINS = 40;
  const bins = useMemo(() => {
    const out = new Array(BINS).fill(0);
    if (hi <= lo) return out;
    for (const p of sortedPrices) out[Math.min(BINS - 1, Math.floor(((Math.min(p, hi) - lo) / (hi - lo)) * (BINS - 1)))]++;
    return out;
  }, [sortedPrices, lo, hi]);
  const peak = Math.max(1, ...bins);
  const range: PriceRange = { min: dmin > lo ? dmin : null, max: dmax < hi ? dmax : null };
  const matches = range.min == null && range.max == null ? total : sortedPrices.filter((p) => (range.min == null || p >= range.min) && (range.max == null || p <= range.max)).length;
  const step = hi - lo > 400 ? 10 : 5;
  const pct = (v: number) => (v - lo) / Math.max(1, hi - lo);
  return (
    <div className="ah-modal-scrim" onClick={onClose}>
      <div className="ah-modal" role="dialog" aria-modal="true" aria-labelledby="ah-filters-title" onClick={(e) => e.stopPropagation()}>
        <div className="ah-modal-head">
          <button type="button" className="ah-iconbtn" aria-label="Close" onClick={onClose} autoFocus><Markup html={SVG.close} /></button>
          <h2 id="ah-filters-title">Filters</h2>
          <span />
        </div>
        <div className="ah-modal-body">
          <section className="ah-fsec">
            <h3>Sort by</h3>
            <div className="ah-seg-control" role="radiogroup" aria-label="Sort by">
              {SORTS.map((o) => (
                <button
                  type="button"
                  role="radio"
                  key={o.id}
                  aria-checked={draftSort === o.id}
                  onClick={() => {
                    if (o.id === "distance" && !near) {
                      onNeedPlace();
                      return;
                    }
                    setDraftSort(o.id);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="ah-fnote">{near ? "Distances are measured from " + near.label + "." : "Nearest needs a place: pick one under Where, or use your location."}</p>
          </section>
          <section className="ah-fsec">
            <h3>Price range</h3>
            {sortedPrices.length >= 2 && hi > lo ? (
              <>
                <p className="ah-fnote">Starting price per booking, as the operator publishes it. Places without a published price are hidden while a range is set.</p>
                <div className="ah-hist" aria-hidden="true">
                  {bins.map((n, i) => {
                    const v = lo + (i / (BINS - 1)) * (hi - lo);
                    return <i key={i} className={v >= dmin && v <= dmax ? "in" : ""} style={{ height: Math.max(2, (n / peak) * 100) + "%" }} />;
                  })}
                </div>
                <div className="ah-range" style={{ ["--a" as string]: pct(dmin), ["--b" as string]: pct(dmax) }}>
                  <input type="range" aria-label="Minimum price" min={lo} max={hi} step={step} value={dmin} onChange={(e) => setDmin(Math.min(+e.target.value, dmax - step))} />
                  <input type="range" aria-label="Maximum price" min={lo} max={hi} step={step} value={dmax} onChange={(e) => setDmax(Math.max(+e.target.value, dmin + step))} />
                </div>
                <div className="ah-pricebox">
                  <label>
                    <small>Minimum</small>
                    <span>$<input inputMode="numeric" style={{ width: String(dmin).length + 1 + "ch" }} value={dmin} onChange={(e) => { const n = +e.target.value.replace(/\D/g, ""); setDmin(Math.max(lo, Math.min(n, dmax - step))); }} /></span>
                  </label>
                  <label>
                    <small>Maximum</small>
                    <span>$<input inputMode="numeric" style={{ width: String(dmax).length + 1 + "ch" }} value={dmax} onChange={(e) => { const n = +e.target.value.replace(/\D/g, ""); setDmax(Math.min(hi, Math.max(n, dmin + step))); }} />{dmax >= hi ? "+" : ""}</span>
                  </label>
                </div>
              </>
            ) : (
              <p className="ah-fnote">Not enough published prices here to filter by price yet.</p>
            )}
          </section>
        </div>
        <div className="ah-modal-foot">
          <button type="button" className="ah-textbtn strong" onClick={() => { setDraftSort("relevance"); setDmin(lo); setDmax(hi); }}>Clear all</button>
          <button type="button" className="ah-btn-dark" onClick={() => onApply(draftSort, range)}>
            Show {matches.toLocaleString()} {matches === 1 ? "place" : "places"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Page                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

export function WebHome({ onOpenApp, onOperators }: { onOpenApp: () => void; onOperators: () => void }) {
  const { state, setCat, setMetro, setNear, setDate, openRequest, dates } = useApp();
  const [q, setQ] = useState("");
  const [who, setWho] = useState(2);
  const [kids, setKids] = useState(0);
  const [seg, setSeg] = useState<Seg | null>(null);
  const near = state.near;
  const [sort, setSort] = useState<SortId>("relevance");
  const [price, setPrice] = useState<PriceRange>({ min: null, max: null });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const toggleCompare = (id: string) => setCompareIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? [...cur.slice(1), id] : [...cur, id]));
  // Typing stays smooth: the catalog is searched from a query that may lag a keystroke behind when the thread is busy.
  const dq = useDeferredValue(q);
  const [hit, setHit] = useState(-1);
  const intent = useMemo(() => parseIntent(dq), [dq]); // intent words survive place stripping
  const [placeHits, setPlaceHits] = useState<Place[]>([]);
  const [locating, setLocating] = useState(false);
  const metro = metroById(state.metroId);
  const RADIUS_KM = 80;
  const pillRef = useRef<HTMLDivElement>(null);
  const whereInput = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Airbnb's header: a hairline once the page moves, and the big pill folds into a small one after a short scroll.
  // Only the two thresholds are state, so scrolling re-renders the page twice at most, not on every pixel.
  const [scrolled, setScrolled] = useState(false);
  const [compact, setCompact] = useState(false);
  const openedAt = useRef(0);
  useEffect(() => {
    const on = () => {
      const y = window.scrollY;
      setScrolled(y > 0);
      setCompact(y > 48);
      // Scrolling the page away folds an open search, as Airbnb does.
      if (y > 48 && Math.abs(y - openedAt.current) > 120) setSeg(null);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const expanded = !compact || seg !== null;
  const openSeg = (s: Seg | null) => {
    openedAt.current = window.scrollY;
    setSeg(s);
    if (s !== "where") setHit(-1);
  };

  // Outside click and Escape close whichever segment is open.
  useEffect(() => {
    if (!seg) return;
    const on = (e: MouseEvent) => { if (pillRef.current && !pillRef.current.contains(e.target as Node)) setSeg(null); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [seg]);
  const skipFocusOpen = useRef(false);
  useEscape(() => {
    const was = seg;
    setSeg(null);
    skipFocusOpen.current = true;
    if (was) pillRef.current?.querySelector<HTMLElement>(`[data-seg="${was}"]`)?.focus();
    skipFocusOpen.current = false;
  }, !!seg && !filtersOpen && !compareOpen);

  useEffect(() => {
    if (seg !== "where") return;
    const t = window.setTimeout(() => {
      searchPlaces(q, near).then(setPlaceHits);
    }, 220);
    return () => window.clearTimeout(t);
  }, [q, seg]);

  const pickPlace = (p: Place) => {
    setNear(p);
    setQ("");
    // Rows stay rows, as on Airbnb: each is already measured from the place, and "Open right now" leads them.
    openSeg("when");
  };
  const useMyLocation = async () => {
    setLocating(true);
    const pt = await currentLocation();
    setLocating(false);
    if (!pt) return;
    pickPlace({ label: "Near me", sub: "Current location", lat: pt.lat, lon: pt.lon });
  };

  // The word index over 55,000 operators is built in idle time once the catalog lands, so the first keystroke
  // is not the one that pays for it.
  useEffect(() => {
    let live = true;
    const step = () => {
      if (live && !warmSearch(getCatalog())) whenIdle(step);
    };
    whenIdle(step);
    return () => {
      live = false;
    };
  }, [state.catalogVersion]);

  // A city typed into Where ("axe throwing denver") beats the saved place.
  const typedMetro = useMemo(() => (dq.trim() ? metroInQuery(dq) : null), [dq]);
  const qWithoutPlace = useMemo(() => {
    if (!typedMetro) return dq;
    const drop = new Set(typedMetro.words);
    return dq.split(/\s+/).filter((w) => !drop.has(w.toLowerCase().replace(/[^a-z0-9]+/g, ""))).join(" ");
  }, [dq, typedMetro]);

  // Where the guest is looking. The search reads the whole catalog and narrows here, so its index is built once.
  const scope = useMemo<SearchScope>(() => {
    const cat = state.cat;
    if (typedMetro) return { cat, metroId: typedMetro.metro.id };
    if (near) return { cat, keep: (u: Unclaimed) => (nearestLocation(u, near)?.km ?? Infinity) <= RADIUS_KM };
    if (state.metroId !== ALL_METRO_ID) return { cat, metroId: state.metroId };
    return { cat };
  }, [typedMetro, near, state.metroId, state.cat]);

  // One pass feeds the Where dropdown and the results behind it, so a keystroke ranks the catalog once.
  const found = useMemo(
    () => (qWithoutPlace.trim() ? searchSuggest(getCatalog(), qWithoutPlace, scope, 6) : null),
    [qWithoutPlace, scope, state.catalogVersion],
  );

  // Browse shows places a guest can act on, and a card is mostly its photo: a grid of scene illustrations
  // reads as a broken page however good the listing behind it is. So browse needs a real photo, not just
  // something to act on, and a listing waits here until the crawl finds one. Searching the business by name
  // still finds it (that path returns `found.results` untouched) and its own page still opens, which the
  // claim emails depend on.
  const pool = useMemo(() => {
    if (found) return found.results;
    let base = getCatalog().filter((u) => !!u.cover);
    if (typedMetro) {
      base = base.filter((u) => u.metroId === typedMetro.metro.id);
    } else if (near) {
      const km = (u: Unclaimed) => nearestLocation(u, near)?.km ?? Infinity;
      base = base.filter((u) => km(u) <= RADIUS_KM).sort((a, b) => km(a) - km(b));
    } else if (state.metroId !== ALL_METRO_ID) {
      base = base.filter((u) => u.metroId === state.metroId);
    }
    return base;
  }, [found, state.metroId, typedMetro, state.catalogVersion, near]);

  // How many nearby places are listed but have no photo yet, so the page can say so instead of hiding the gap.
  const waiting = useMemo(() => {
    if (found) return 0;
    let base = getCatalog().filter((u) => !u.cover);
    if (typedMetro) base = base.filter((u) => u.metroId === typedMetro.metro.id);
    else if (near) base = base.filter((u) => (nearestLocation(u, near)?.km ?? Infinity) <= RADIUS_KM);
    else if (state.metroId !== ALL_METRO_ID) base = base.filter((u) => u.metroId === state.metroId);
    return base.filter((u) => inCat(u, state.cat)).length;
  }, [found, state.metroId, typedMetro, state.catalogVersion, near, state.cat]);

  const priceOn = price.min != null || price.max != null;
  const inPrice = (u: Unclaimed) => {
    if (!priceOn) return true;
    const f = fromPrice(u);
    return f != null && (price.min == null || f >= price.min) && (price.max == null || f <= price.max);
  };
  const effSort: SortId = sort === "distance" && !near ? "relevance" : sort;
  const applySort = (list: Unclaimed[]) => {
    if (effSort === "distance" && near) list.sort((a, b) => (nearestLocation(a, near)?.km ?? Infinity) - (nearestLocation(b, near)?.km ?? Infinity));
    else if (effSort === "price") list.sort((a, b) => (fromPrice(a) ?? Infinity) - (fromPrice(b) ?? Infinity));
    else if (effSort === "rating") list.sort((a, b) => (publicRating(b)?.rating ?? 0) - (publicRating(a)?.rating ?? 0) || (b.reviews || 0) - (a.reviews || 0));
    return list;
  };

  // The places the category tab, filters and search leave, before any order is applied. Filters count from here.
  const base = useMemo(() => (q.trim() ? pool : pool.filter((u) => inCat(u, state.cat))), [pool, q, state.cat]);

  // Airbnb's two shapes: rows when nothing is narrowed, one flat grid once a category, order, price or search is.
  const gridMode = !q.trim() && (state.cat !== "all" || effSort !== "relevance" || priceOn);
  const gridList = useMemo(() => {
    if (!gridMode) return null;
    const list = base.filter(inPrice);
    if (effSort === "relevance") return near ? list : rankForRail(list);
    return applySort(list);
  }, [gridMode, base, effSort, near, price.min, price.max]);
  const searchList = useMemo(() => {
    if (!q.trim()) return null;
    return applySort(pool.filter(inPrice));
  }, [q, pool, effSort, near, price.min, price.max]);

  // Kinds with at least one listing here, scored by how many have a photo. The strongest HOME_RAILS become rails
  // in the mixed order above; the rest are links so the page is not sixty rails long.
  const { rails, moreKinds } = useMemo(() => {
    const count = new Map<ArtKind, { n: number; covers: number }>();
    for (const u of pool) {
      if (!inCat(u, state.cat)) continue;
      const c = count.get(u.art) || { n: 0, covers: 0 };
      c.n++;
      if (u.cover) c.covers++;
      count.set(u.art, c);
    }
    const present = RAIL_KINDS.filter((r) => count.has(r.art));
    const score = (art: ArtKind) => { const c = count.get(art)!; return c.covers * 4 + c.n; };
    // A rail is a row of photos. Kinds that have fewer than six photographed places go to the link list until the crawl catches up.
    const railable = present.filter((r) => count.get(r.art)!.covers >= 6);
    const top = new Set(railable.slice().sort((a, b) => score(b.art) - score(a.art)).slice(0, HOME_RAILS).map((r) => r.art));
    return {
      rails: present.filter((r) => top.has(r.art)),
      moreKinds: present.filter((r) => !top.has(r.art)).map((r) => ({ ...r, n: count.get(r.art)!.n })),
    };
  }, [pool, state.cat]);
  const openNow = useNearNow(near, state.catalogVersion);
  // Photographed places per city, for the Where menu's suggestions.
  const metroCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const u of getCatalog()) if (u.cover) out.set(u.metroId, (out.get(u.metroId) || 0) + 1);
    return out;
  }, [state.catalogVersion]);

  const placeName = near ? near.label + (near.sub ? ", " + near.sub.split(",")[0] : "") : metro ? metro.name + ", " + metro.region : "";
  const whereShort = near ? near.label : metro ? metro.name : "Anywhere";
  const inWhere = typedMetro ? " in " + typedMetro.metro.name : near ? " near " + near.label : metro ? " in " + metro.name : "";
  const catName = (id: CategoryId) => CATS.find((c) => c.id === id)?.name || "All";
  const dayLabel = state.dateIdx === 0 ? "Today" : state.dateIdx === 1 ? "Tomorrow" : fmtDate(dates[state.dateIdx]);
  const guests = who + kids;
  const guestLabel = guests + (guests === 1 ? " guest" : " guests");

  // The Where dropdown. Empty: nearby and suggested places. Typed: kinds of thing, businesses, cities, map places.
  const acts = found?.activities ?? [];
  const ops = found?.operators ?? [];
  const spots = found?.places ?? [];

  const pickCity = (id: string) => {
    // "axe throwing denver" with Denver picked becomes an axe search in Denver, not a search for the word "denver".
    if (typedMetro && typedMetro.metro.id === id) setQ(qWithoutPlace.trim());
    setNear(null);
    setMetro(id);
    setHit(-1);
  };

  type Row = { key: string; head?: string; icon?: string; u?: Unclaimed; title: string; sub?: string; on?: boolean; pick: () => void };
  const rows: Row[] = [];
  if (!q.trim()) {
    rows.push({ key: "nearby", head: "Nearby", icon: ICONS.nav, title: locating ? "Finding you…" : "Nearby", sub: "Find what's around you", on: near?.label === "Near me", pick: useMyLocation });
    rows.push({ key: "anywhere", head: "Suggested destinations", icon: ICONS.globe, title: "Anywhere", sub: "US and Canada", on: !near && state.metroId === ALL_METRO_ID, pick: () => { setNear(null); setMetro(ALL_METRO_ID); openSeg("when"); } });
    for (const id of POPULAR_METROS) {
      const m = METROS.find((x) => x.id === id);
      if (m) rows.push({ key: "m" + m.id, icon: ICONS.pin, title: m.name + ", " + m.region, sub: (metroCounts.get(m.id) || 0).toLocaleString() + " places with photos", on: !near && state.metroId === m.id, pick: () => { setNear(null); setMetro(m.id); openSeg("when"); } });
    }
  } else {
    acts.forEach((a, i) => rows.push({ key: "a" + a.art, head: i === 0 ? "Activities" : undefined, icon: ICONS.spark, title: a.label, sub: a.count.toLocaleString() + (a.count === 1 ? " place" : " places") + inWhere, pick: () => { setQ(a.query); setHit(-1); } }));
    ops.forEach((u, i) => rows.push({ key: "o" + u.id, head: i === 0 ? "Businesses" : undefined, u, title: u.title, sub: ART_LABEL[u.art] + " · " + u.area, pick: () => { openSeg(null); openRequest(u.id); } }));
    spots.forEach((pl, i) => rows.push({ key: "s" + pl.metro.id, head: i === 0 ? "Cities" : undefined, icon: ICONS.pin, title: pl.metro.name + ", " + pl.metro.region, sub: pl.count.toLocaleString() + " places", pick: () => pickCity(pl.metro.id) }));
    placeHits.forEach((p, i) => rows.push({ key: "p" + p.label + p.sub, head: i === 0 ? "Places on the map" : undefined, icon: ICONS.pin, title: p.label, sub: p.sub, pick: () => pickPlace(p) }));
    (found?.elsewhere ?? []).forEach((a, i) => rows.push({ key: "e" + a.art, head: i === 0 ? "Elsewhere" : undefined, icon: ICONS.globe, title: a.label + " across the US and Canada", sub: a.count.toLocaleString() + " places", pick: () => { setNear(null); setMetro(ALL_METRO_ID); setQ(a.query); } }));
    if (found?.otherCats) rows.push({ key: "othercats", icon: ICONS.catAll, title: "Show all categories", sub: found.otherCats.toLocaleString() + " more outside " + catName(state.cat), pick: () => setCat("all") });
  }

  const onWhereKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (seg !== "where") openSeg("where");
      setHit((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHit((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hit >= 0 && rows[hit]) rows[hit].pick();
      else runSearch();
    }
  };

  const runSearch = () => {
    setSeg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const clearWhere = () => {
    setQ("");
    setNear(null);
    setMetro(ALL_METRO_ID);
    whereInput.current?.focus();
  };

  const pickCat = (c: CategoryId) => {
    setCat(c);
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  };

  const filterCount = (effSort !== "relevance" ? 1 : 0) + (priceOn ? 1 : 0);
  const resetFilters = () => { setSort("relevance"); setPrice({ min: null, max: null }); setCat("all"); };
  const showRails = state.catalogReady && !q.trim() && !gridMode;

  return (
    <CompareCtx.Provider value={{ ids: compareIds, toggle: toggleCompare }}>
    <div className={"web ah" + (compareIds.length ? " has-cmpbar" : "")}>
      <header className={"ah-header" + (scrolled ? " is-scrolled" : "") + (expanded ? " is-expanded" : " is-compact")}>
        <div className="ah-top ah-gutter">
          <a className="ah-logo" href="./" aria-label="Outset home" onClick={(e) => { e.preventDefault(); setCat("all"); setQ(""); setSort("relevance"); setPrice({ min: null, max: null }); window.scrollTo({ top: 0 }); }}>
            <Mark size={32} />
            <b>Outset</b>
          </a>
          {expanded ? (
            <nav className="ah-switch" aria-label="What to browse">
              {SWITCH.map((s) => {
                const on = s.id === "all" ? state.cat !== "food" && state.cat !== "wellness" : state.cat === s.id;
                return (
                  <button type="button" key={s.id} aria-current={on ? "page" : undefined} className={on ? "on" : ""} onClick={() => pickCat(s.id)}>
                    <Markup html={ICONS[s.icon]} />
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="ah-mini" role="group" aria-label="Search">
              <button type="button" onClick={() => { openSeg("where"); window.setTimeout(() => whereInput.current?.focus(), 0); }}>{q.trim() || whereShort}</button>
              <i />
              <button type="button" onClick={() => openSeg("when")}>{dayLabel}</button>
              <i />
              <button type="button" className="soft" onClick={() => openSeg("who")}>{guestLabel}</button>
              <span className="ah-mini-go" aria-hidden="true"><Markup html={SVG.search} /></span>
            </div>
          )}
          <div className="ah-right">
            <button type="button" className="ah-host" onClick={onOperators}>List your business</button>
            <UserMenu onOperators={onOperators} onOpenApp={onOpenApp} />
          </div>
        </div>

        {expanded ? (
          <div className="ah-searchrow ah-gutter">
            <div className={"ah-pill" + (seg ? " is-active" : "")} ref={pillRef} role="search">
              <label className={"ah-seg where" + (seg === "where" ? " on" : "")} htmlFor="ah-where" data-seg="where-label">
                <span className="ah-seg-label">Where</span>
                <input
                  id="ah-where"
                  ref={whereInput}
                  data-seg="where"
                  className={placeName && !q ? "has-place" : ""}
                  value={q}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={placeName || "Search destinations or activities"}
                  role="combobox"
                  aria-expanded={seg === "where"}
                  aria-controls="ah-where-pop"
                  aria-activedescendant={seg === "where" && hit >= 0 && rows[hit] ? "ah-row-" + hit : undefined}
                  onFocus={() => { if (seg !== "where" && !skipFocusOpen.current) openSeg("where"); }}
                  onClick={() => { if (seg !== "where") openSeg("where"); }}
                  onChange={(e) => { setQ(e.target.value); setHit(-1); if (seg !== "where") openSeg("where"); }}
                  onKeyDown={onWhereKey}
                />
                {seg === "where" && (q || placeName) ? (
                  <button type="button" className="ah-clear" aria-label="Clear where" onMouseDown={(e) => e.preventDefault()} onClick={clearWhere}><Markup html={SVG.close} /></button>
                ) : null}
              </label>
              <span className="ah-div" />
              <button type="button" className={"ah-seg when" + (seg === "when" ? " on" : "")} data-seg="when" aria-expanded={seg === "when"} aria-controls="ah-when-pop" onClick={() => openSeg(seg === "when" ? null : "when")}>
                <span className="ah-seg-label">When</span>
                <span className="ah-seg-value set">{dayLabel}</span>
              </button>
              <span className="ah-div" />
              <div className={"ah-seg who" + (seg === "who" ? " on" : "")}>
                <button type="button" className="ah-seg-hit" data-seg="who" aria-expanded={seg === "who"} aria-controls="ah-who-pop" onClick={() => openSeg(seg === "who" ? null : "who")}>
                  <span className="ah-seg-label">Who</span>
                  <span className="ah-seg-value set">{guestLabel}</span>
                </button>
                <button type="button" className={"ah-go" + (seg ? " wide" : "")} onClick={runSearch} aria-label="Search">
                  <Markup html={SVG.search} />
                  {seg ? <span>Search</span> : null}
                </button>
              </div>

              {seg === "where" ? (
                <div className="ah-pop where" id="ah-where-pop" role="listbox" aria-label="Where">
                  {found?.nearMiss ? (
                    <p className="ah-pop-note">
                      Nothing for “{q.trim()}”{inWhere}{rows.length ? ". Closest in the catalog:" : ". Try fewer words, or another city."}
                    </p>
                  ) : null}
                  {q.trim() && !rows.length && !found?.nearMiss ? <p className="ah-pop-note">Keep typing, or try a bigger town nearby.</p> : null}
                  {rows.map((r, i) => (
                    <div key={r.key}>
                      {r.head ? <p className="ah-pop-head">{r.head}</p> : null}
                      <button
                        type="button"
                        id={"ah-row-" + i}
                        role="option"
                        aria-selected={hit === i || !!r.on}
                        className={"ah-pop-row" + (hit === i ? " hit" : "") + (r.on ? " on" : "")}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHit(i)}
                        onClick={r.pick}
                        disabled={r.key === "nearby" && locating}
                      >
                        <span className="ah-pop-icon">
                          {r.u ? <Photo src={r.u.cover} kind={r.u.art} id={"s" + r.u.id} alt="" size="thumb" /> : <Markup className="ah-ico" html={r.icon || ICONS.pin} />}
                        </span>
                        <span className="ah-pop-text">
                          <b>{r.title}</b>
                          {r.sub ? <small>{r.sub}</small> : null}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {seg === "when" ? (
                <div className="ah-pop when" id="ah-when-pop">
                  <Calendar dates={dates} idx={state.dateIdx} onPick={(i) => { setDate(i); openSeg("who"); }} />
                  <div className="ah-chips">
                    {[0, 1].map((i) => (
                      <button type="button" key={i} aria-pressed={state.dateIdx === i} onClick={() => { setDate(i); openSeg("who"); }}>{i === 0 ? "Today" : "Tomorrow"}</button>
                    ))}
                    {(() => {
                      const sat = dates.findIndex((d, i) => i > 1 && d.getDay() === 6);
                      return sat > 0 ? <button type="button" aria-pressed={state.dateIdx === sat} onClick={() => { setDate(sat); openSeg("who"); }}>This Saturday</button> : null;
                    })()}
                    <span className="ah-chips-note">Operators take requests for the next {dates.length} days.</span>
                  </div>
                </div>
              ) : null}
              {seg === "who" ? (
                <div className="ah-pop who" id="ah-who-pop">
                  <Stepper label="Adults" sub="Ages 13 or above" value={who} min={1} max={12} onChange={setWho} />
                  <Stepper label="Children" sub="Ages 12 and under" value={kids} min={0} max={10} onChange={setKids} />
                  <p className="ah-pop-foot">Age and weight rules differ by activity. Each listing shows its own.</p>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="ah-catrow ah-gutter">
          <CategoryBar cat={state.cat} setCat={pickCat} filterCount={filterCount} onFilters={() => setFiltersOpen(true)} />
        </div>
      </header>
      <div className="ah-header-space" aria-hidden="true" />
      {seg && compact ? <div className="ah-scrim" onClick={() => setSeg(null)} /> : null}

      <main className="ah-main ah-gutter" ref={mainRef} id="ah-main">
        {!state.catalogReady ? (
          <>
            {[0, 1].map((r) => (
              <section className="ah-rail" key={r} aria-hidden="true">
                <div className="ah-rowhead"><span className="skel ah-skeltitle" /></div>
                <div className="ah-railrow">
                  {Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} />)}
                </div>
              </section>
            ))}
          </>
        ) : null}

        {showRails && openNow.length ? (
          <Rail title={"Open right now near " + near!.label} note="From their published hours" items={openNow} onOpen={openRequest} near={near} eager />
        ) : null}

        {showRails ? rails.map((r, i) => {
          const items = rankForRail(pool.filter((u) => u.art === r.art));
          const title = titleCase(near ? `${r.title} near ${near.label}` : metro ? `${r.title} in ${metro.name}` : `Popular ${r.title}`);
          return <Rail key={r.art} title={title} items={items} onOpen={openRequest} near={near} eager={i < 2} onShowAll={() => { setQ(kindQuery(r.art)); window.scrollTo({ top: 0 }); }} />;
        }) : null}

        {showRails && !rails.length && !openNow.length ? (
          <div className="ah-empty">
            <h2>Nothing in {catName(state.cat)} here yet</h2>
            <p>Try Anywhere, or another category. {CATMETA[state.cat]?.emptyBody || ""}</p>
            <button type="button" className="ah-btn-outline" onClick={() => { setNear(null); setMetro(ALL_METRO_ID); }}>Search everywhere</button>
          </div>
        ) : null}

        {showRails && moreKinds.length ? (
          <section className="ah-inspire" aria-labelledby="ah-more-kinds">
            <h2 id="ah-more-kinds">More kinds{near ? ` near ${near.label}` : metro ? ` in ${metro.name}` : ""}</h2>
            <div className="ah-inspire-grid">
              {moreKinds.map((k) => (
                <button type="button" key={k.art} onClick={() => { setQ(kindQuery(k.art)); window.scrollTo({ top: 0 }); }}>
                  <b>{k.title}</b>
                  <small>{k.n.toLocaleString()} {k.n === 1 ? "place" : "places"}</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {state.catalogReady && gridList ? (
          <section className="ah-results" aria-labelledby="ah-grid-title">
            <div className="ah-rowhead">
              <div className="ah-rowtitle">
                <h2 id="ah-grid-title">
                  {gridList.length > 1000 ? "Over 1,000" : gridList.length.toLocaleString()} {state.cat === "all" ? "experiences" : catName(state.cat).toLowerCase() + " experiences"}
                  {inWhere}
                </h2>
                <p>
                  {effSort === "distance" && near ? "Nearest to " + near.label + " first" : effSort === "price" ? "Lowest price first" : effSort === "rating" ? "Top rated first" : "Best photographed and reviewed first"}
                  {priceOn ? " · " + (price.min != null ? money(price.min) : "Any") + " to " + (price.max != null ? money(price.max) : "any price") : ""}
                </p>
              </div>
            </div>
            {gridList.length ? (
              <Grid items={gridList} onOpen={openRequest} near={near} resetKey={state.cat + effSort + price.min + price.max + (near?.label || "") + state.metroId} />
            ) : (
              <div className="ah-empty">
                <h2>No exact matches</h2>
                <p>Try changing or removing some of your filters or adjusting your search area.</p>
                <button type="button" className="ah-btn-outline" onClick={resetFilters}>Remove all filters</button>
              </div>
            )}
          </section>
        ) : null}

        {state.catalogReady && searchList ? (
          <section className="ah-results" aria-labelledby="ah-search-title">
            <div className="ah-rowhead">
              <div className="ah-rowtitle">
                <h2 id="ah-search-title">
                  {intent.label ? intent.label : `Results for “${qWithoutPlace.trim() || q.trim()}”`}
                  {inWhere}
                </h2>
                <p>
                  {searchList.length.toLocaleString()} {searchList.length === 1 ? "place" : "places"}
                  {intent.label ? " · " + (intent.kids ? "Only places whose published rules allow younger kids. " : "") + (intent.maxPrice != null ? "Starting price at or under $" + intent.maxPrice + ". " : "") + (intent.arts.length ? "One row per kind of plan, best first." : "Best fit first, then rating and reviews.") : ""}
                </p>
              </div>
              <div className="ah-rowtools">
                <button type="button" className="ah-showall" onClick={() => { setQ(""); whereInput.current?.focus(); }}>Clear search</button>
              </div>
            </div>
            {intent.arts.length && searchList.length > 12 && effSort === "relevance" && !priceOn ? (
              // A browse, not a search: "date night" is wineries, cooking classes, sunset sails, side by side.
              <div className="ah-browse">
                {intent.arts
                  .map((art) => ({ art, items: rankForRail(searchList.filter((u) => u.art === art)) }))
                  .filter((g) => g.items.length >= 2)
                  .map((g) => (
                    <Rail key={g.art} title={RAIL_KINDS.find((r) => r.art === g.art)?.title || g.art} items={g.items} onOpen={openRequest} near={near} />
                  ))}
              </div>
            ) : searchList.length ? (
              <Grid items={searchList} onOpen={openRequest} near={near} resetKey={q + effSort + price.min + price.max} />
            ) : (
              // Never a bare no-match: every way out below is a real count from the catalog.
              <div className="ah-empty">
                <h2>Nothing for “{qWithoutPlace.trim() || q.trim()}”{inWhere} yet</h2>
                <p>Try one of these, or fewer words.</p>
                <span className="ah-emptyfix">
                  {priceOn ? <button type="button" className="ah-btn-outline" onClick={() => setPrice({ min: null, max: null })}>Remove the price filter</button> : null}
                  {found?.otherCats ? (
                    <button type="button" className="ah-btn-outline" onClick={() => setCat("all")}>{found.otherCats.toLocaleString()} in other categories</button>
                  ) : null}
                  {acts.map((a) => (
                    <button type="button" key={a.art} className="ah-btn-outline" onClick={() => setQ(a.query)}>{a.label} · {a.count.toLocaleString()}</button>
                  ))}
                  {(found?.elsewhere ?? []).map((a) => (
                    <button type="button" key={a.art} className="ah-btn-outline" onClick={() => { setNear(null); setMetro(ALL_METRO_ID); setQ(a.query); }}>
                      {a.label} across the US and Canada · {a.count.toLocaleString()}
                    </button>
                  ))}
                  {spots.map((pl) => (
                    <button type="button" key={pl.metro.id} className="ah-btn-outline" onClick={() => pickCity(pl.metro.id)}>{pl.metro.name} · {pl.count.toLocaleString()}</button>
                  ))}
                  {typedMetro || near || metro ? (
                    <button type="button" className="ah-btn-outline" onClick={() => { setNear(null); setMetro(ALL_METRO_ID); if (typedMetro) setQ(qWithoutPlace.trim()); }}>Search everywhere</button>
                  ) : null}
                </span>
              </div>
            )}
          </section>
        ) : null}

        {state.catalogReady && !q.trim() && waiting > 0 ? (
          <p className="ah-waiting">
            {waiting.toLocaleString()} more {waiting === 1 ? "place is" : "places are"} listed{inWhere} without a photo yet. They appear here as we gather their photos and prices; search one by name to open it now.
          </p>
        ) : null}
      </main>

      <footer className="ah-footer">
        <div className="ah-gutter">
          <div className="ah-footcols">
            <section>
              <h3>Support</h3>
              <ul>
                <li><a href={"mailto:" + HELP_EMAIL}>Help Centre</a></li>
                <li><a href={"mailto:" + HELP_EMAIL + "?subject=" + encodeURIComponent("A listing on Outset")}>Report a listing concern</a></li>
                <li><button type="button" onClick={onOpenApp}>Open the phone app</button></li>
              </ul>
            </section>
            <section>
              <h3>Operators</h3>
              <ul>
                <li><button type="button" onClick={onOperators}>List your business</button></li>
                <li><button type="button" onClick={onOperators}>Claim your listing</button></li>
                <li><button type="button" onClick={onOperators}>Operator log in</button></li>
              </ul>
            </section>
            <section>
              <h3>Outset</h3>
              <ul>
                <li><button type="button" onClick={() => { resetFilters(); setQ(""); window.scrollTo({ top: 0 }); }}>Browse every category</button></li>
                <li><button type="button" onClick={() => { window.scrollTo({ top: 0 }); openSeg("where"); window.setTimeout(() => whereInput.current?.focus(), 50); }}>Search a city</button></li>
                <li><a href="sitemap.xml">Sitemap</a></li>
              </ul>
            </section>
          </div>
          <div className="ah-footbar">
            <span>
              © {new Date().getFullYear()} Outset<span aria-hidden="true"> · </span>Book the jump. Skip the call.
            </span>
            <span className="ah-footbar-right">
              <span>English (US)</span>
              <span>$ USD</span>
              <span>{getCatalog().length.toLocaleString()} operators across the US and Canada</span>
            </span>
          </div>
        </div>
      </footer>

      {compareIds.length ? (
        <div className="ah-cmpbar" role="region" aria-label="Compare">
          <div className="ah-gutter ah-cmpbar-in">
            <span className="ah-cmpbar-lead">
              <b>Compare</b>
              <small>{compareIds.length} of 3 picked</small>
            </span>
            <span className="ah-cmpbar-items">
              {compareIds.map((id) => {
                const u = getCatalog().find((x) => x.id === id);
                return u ? (
                  <span key={id} className="ah-cmpchip">
                    <span className="ah-cmpchip-art"><Photo src={u.cover} kind={u.art} id={"t" + u.id} alt="" size="thumb" /></span>
                    <b>{u.title}</b>
                    <button type="button" aria-label={"Remove " + u.title} onClick={() => toggleCompare(id)}><Markup html={SVG.close} /></button>
                  </span>
                ) : null;
              })}
            </span>
            <span className="ah-cmpbar-actions">
              <button type="button" className="ah-textbtn strong" onClick={() => setCompareIds([])}>Clear</button>
              <button type="button" className="ah-btn-dark" disabled={compareIds.length < 2} onClick={() => setCompareOpen(true)}>
                {compareIds.length < 2 ? "Pick one more" : "Compare " + compareIds.length}
              </button>
            </span>
          </div>
        </div>
      ) : null}

      {filtersOpen ? (
        <FiltersModal
          sort={effSort}
          price={price}
          prices={base.map(fromPrice).filter((n): n is number => n != null)}
          total={base.length}
          near={near}
          onApply={(s, p) => { setSort(s); setPrice(p); setFiltersOpen(false); window.scrollTo({ top: 0 }); }}
          onClose={() => setFiltersOpen(false)}
          onNeedPlace={() => { setFiltersOpen(false); window.scrollTo({ top: 0 }); openSeg("where"); window.setTimeout(() => whereInput.current?.focus(), 50); }}
        />
      ) : null}

      {compareOpen ? (
        <CompareTable
          items={compareIds.map((id) => getCatalog().find((x) => x.id === id)).filter((x): x is Unclaimed => !!x)}
          near={near}
          onOpen={(id) => { setCompareOpen(false); openRequest(id); }}
          onClose={() => setCompareOpen(false)}
          onRemove={(id) => { toggleCompare(id); if (compareIds.length <= 2) setCompareOpen(false); }}
        />
      ) : null}
    </div>
    </CompareCtx.Provider>
  );
}
