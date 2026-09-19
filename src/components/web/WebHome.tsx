import "../../styles/air-home.css";
import { Fragment, createContext, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CATS, CATMETA, WORLDS, inCat, worldOf, type WorldChip } from "../../data/categories";
import { ART_LABEL } from "../../data/art";
import { ICONS } from "../../data/icons";
import { ALL_METRO_ID, METROS, metroById, metroCoords } from "../../data/metros";
import { countryOfArea } from "../../data/regions";
import type { ArtKind, CategoryId, Unclaimed } from "../../data/types";
import { experienceById, fromPrice, getCatalog, publicRating, topRated } from "../../lib/catalog";
import { listingFacts } from "../../lib/catalog";
import { fmtDate, fmtReviews, money, titleCase } from "../../lib/format";
import { ART_ALIASES, WHAT_INTENTS, describeQuery, metroInQuery, parseIntent, searchMetros, searchRegions, searchSuggest, stripPlaceWords, warmSearch, type SearchScope } from "../../lib/search";
import { loadListing } from "../../lib/catalogLoad";
import { dealToday } from "../../lib/companyAgent";
import { itemOpenState } from "../../lib/openNow";
import { fmtDistance } from "../../lib/geo";
import { currentLocation, kmBetween, nearestLocation, searchPlaces, type Place } from "../../lib/places";
import { useApp } from "../../state/AppProvider";
import { Photo } from "../art/Photo";
import { useNearNow } from "./NearNow";
import { Mark } from "../layout/Mark";
import { useModal } from "../layout/useModal";
import { Markup } from "../Markup";
import { AdminSiteLink, liteDealTitle, tidyDuration } from "./WebListing";
import { freeCancelBadge } from "../../lib/cancellation";
import { withinDrive, kmToPlace, NEAR_RADIUS_KM, DRIVE_RADIUS_KM } from "../explore/feed";
import { getPrefs, setPrefs } from "../explore/prefs";


/** "1 place", "2,418 places". */
const places = (n: number) => n.toLocaleString("en-US") + (n === 1 ? " place" : " places");
/**
 * Desktop home, laid out as airbnb.com: a white header with the Outset mark, a three-way switch and the account
 * menu; the Where / What / When / Who pill whose segments open as large popovers (Where holds a place, What holds
 * the activity or business, and the two never overwrite each other); the icon category bar with Filters;
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

/**
 * Result counts for What suggestions, memoised per place and query. Each is the length of the very search the row
 * runs, so "Jet ski rentals · 32" opens a grid of 32 rather than an estimate from a different pass.
 */
const countMemo = new Map<string, number>();
function searchCount(q: string, scope: SearchScope, scopeKey: string): number {
  const key = scopeKey + "|" + q.trim().toLowerCase();
  let n = countMemo.get(key);
  if (n == null) {
    if (countMemo.size > 400) countMemo.clear();
    n = searchSuggest(getCatalog(), q, scope, 1).results.length;
    countMemo.set(key, n);
  }
  return n;
}

/** The heading name for a What query: the kind's own title, the occasion, or the words in quotes. */
function whatName(q: string): string {
  const t = q.trim();
  if (!t) return "";
  const chip = WHAT_INTENTS.find((c) => c.query === t.toLowerCase());
  if (chip) return chip.label;
  const d = describeQuery(t);
  if (d.onlyKind && d.arts.length === 1) {
    const title = RAIL_KINDS.find((r) => r.art === d.arts[0])?.title || ART_LABEL[d.arts[0]] || t;
    return title + (d.intent.maxPrice != null ? " under $" + d.intent.maxPrice : "") + (d.intent.kids ? " for kids" : "");
  }
  if (d.onlyIntent) return d.intent.label!;
  return "“" + t.charAt(0).toUpperCase() + t.slice(1) + "”";
}

function rankForRail(list: Unclaimed[], center?: { lat: number; lon: number } | null): Unclaimed[] {
  // In a city, the city itself leads: a Miami row opening on Boca Raton, 70 km up the coast, reads as the wrong
  // place. Listings in the city are lifted and the far edge of the metro area is pushed back, before quality.
  const nearness = (u: Unclaimed) => {
    if (!center || u.lat == null || u.lon == null) return 0;
    const km = kmBetween(center, { lat: u.lat, lon: u.lon });
    return km <= 25 ? 2 : km <= 50 ? 0.5 : -1.5;
  };
  // A rail is photos. Places without one wait in search results until the crawl or the operator adds a picture.
  return list
    .filter((u) => !!u.cover)
    .sort((a, b) => {
      // "Popular Jet Ski Rentals" must open on jet ski rentals: a listing whose own words never confirm its kind
      // goes after every one that does, however many reviews it has.
      if (!!a.kindUnconfirmed !== !!b.kindUnconfirmed) return a.kindUnconfirmed ? 1 : -1;
      const pa = (a.cover ? 3 : 0) + (fromPrice(a) != null ? 2 : 0) + Math.min(2, Math.log10((a.reviews || 0) + 1)) + nearness(a);
      const pb = (b.cover ? 3 : 0) + (fromPrice(b) != null ? 2 : 0) + Math.min(2, Math.log10((b.reviews || 0) + 1)) + nearness(b);
      return pb - pa;
    });
}

/** Up to three listings a guest wants side by side. */
const CompareCtx = createContext<{ ids: string[]; toggle: (id: string) => void }>({ ids: [], toggle: () => {} });

/** The Where menu's shortlist: the biggest cities a guest would type, not the first twelve metros in the file. */
const POPULAR_METROS = ["toronto", "nyc", "los-angeles", "chicago", "miami", "tampa", "vancouver", "austin", "denver", "seattle", "las-vegas", "boston", "atlanta", "san-diego", "montreal", "orlando"];

/**
 * Airbnb's Homes / Experiences / Services switch, mapped onto Outset's worlds (data/categories.ts WORLDS): it picks
 * the world and the category row under it shows only that world's chips.
 */
type SortId = "relevance" | "distance" | "price" | "rating";
const SORTS: { id: SortId; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "distance", label: "Nearest" },
  { id: "price", label: "Price: low to high" },
  { id: "rating", label: "Top rated" },
];

type Seg = "where" | "what" | "when" | "who";
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
  if (topRated(u)) return "Top rated";
  // A titled deal gets its own line under the card; the pill stays for a deal with no title.
  if (dealToday(u) && !liteDealTitle(u.deal)) return "Deal today";
  if (open) return "Open now";
  return null;
}

function Card({ u, onOpen, near, rail }: { u: Unclaimed; onOpen: (id: string) => void; near?: Place | null; rail?: boolean }) {
  const score = publicRating(u);
  const metro = metroById(u.metroId);
  const from = fromPrice(u);
  const openSt = useMemo(() => itemOpenState(u), [u]);
  // Browse records carry only the cover. Hovering a card for a moment loads the listing's own photos and plays them
  // as a slow slideshow, the way Airbnb's cards preview a stay, so a guest sees more than one picture without opening
  // the listing. Only the hovered card fetches anything, and only once.
  const [morePhotos, setMorePhotos] = useState<string[]>([]);
  const gallery = useMemo(() => Array.from(new Set([u.cover, ...(u.photos || []), ...morePhotos].filter(Boolean) as string[])).slice(0, 6), [u.cover, u.photos, morePhotos]);
  const [pic, setPic] = useState(0);
  const [playing, setPlaying] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const loaded = useRef(false);
  /**
   * Whether the pointer is still on this card. The photos are a fetch away, and a guest running the pointer
   * across a row leaves long before a slow connection answers: the slideshow then started on a card nobody was
   * pointing at and played on, because the leave had already happened and nothing was left to stop it.
   */
  const hovering = useRef(false);
  // Set when the guest steps the photos with the arrows: the slideshow then holds that photo instead of moving on.
  const manual = useRef(false);
  const startPreview = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !u.cover) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hovering.current = true;
    hoverTimer.current = window.setTimeout(async () => {
      if (!loaded.current) {
        loaded.current = true;
        if (u.lite) await loadListing(u.id).catch(() => false);
        const full = experienceById(u.id);
        if (full?.photos?.length) setMorePhotos(full.photos.slice(0, 6));
      }
      // The photos were a fetch away and the pointer may have moved on while they arrived. They are kept, so a
      // second hover plays at once, but a card the guest has left does not start playing behind them.
      if (!hovering.current) return;
      setPlaying(true);
    }, 900);
  };
  const stopPreview = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    hovering.current = false;
    manual.current = false;
    setPlaying(false);
    setPic(0);
  };
  const photoBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!playing || gallery.length < 2) return;
    // Only move to a photo that has finished loading, skipping any still on its way, so a slow image proxy
    // never shows a grey frame between pictures. The cover stays underneath as the floor.
    const ready = (i: number) => {
      if (i === 0) return true;
      const img = photoBox.current?.querySelector<HTMLImageElement>(`.ah-card-slide[data-i="${i}"] img`);
      return !!img && img.complete && img.naturalWidth > 0;
    };
    const t = window.setInterval(() => {
      if (manual.current) return;
      setPic((cur) => {
        for (let k = 1; k <= gallery.length; k++) {
          const n = (cur + k) % gallery.length;
          if (ready(n)) return n;
        }
        return cur;
      });
    }, 1700);
    return () => window.clearInterval(t);
  }, [playing, gallery.length]);
  useEffect(() => () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current); }, []);
  const badge = cardBadge(u, !!openSt?.open);
  const dealTitle = liteDealTitle(u.deal);
  const dealOn = !!dealTitle && dealToday(u);
  const priced = from != null ? u.options.find((o) => o.price === from) : undefined;
  const per = (priced?.per || "").replace(/^\//, "").trim();
  const where = (() => {
    // A distance from the middle of a whole state means nothing to a guest; the town does.
    const n = near && !near.region ? nearestLocation(u, near) : null;
    const extra = u.locations?.length ? " · " + (u.locations.length + 1) + " locations" : "";
    if (n) return (n.label ? n.label + " · " : "") + fmtDistance(n.km, countryOfArea(u.area)) + " away" + extra;
    return u.area + (metro && !u.area.includes(metro.name) ? " · " + metro.name : "") + extra;
  })();
  const detail = u.dur
    ? tidyDuration(u.dur)
    : openSt?.open && openSt.closesAt
      ? "Open until " + openSt.closesAt
      : openSt && !openSt.open
        ? openSt.label
        : freeCancelBadge(u)
          ? "Free cancellation"
          : ART_LABEL[u.art];
  const step = (d: number) => {
    manual.current = true;
    setPic((i) => (i + d + gallery.length) % gallery.length);
  };
  const stars = score ? (
    <span className="ah-card-rate">
      <Markup html={SVG.star} />
      {score.rating.toFixed(1)}
      <em>({fmtReviews(score.reviews)})</em>
    </span>
  ) : null;
  return (
    // The hover lives on the whole card: a transparent button covers it for the click, so the photo never sees the pointer.
    <div className="ah-card" onPointerEnter={startPreview} onPointerLeave={stopPreview}>
      <button type="button" className="ah-card-hit" onClick={() => onOpen(u.id)} aria-label={u.title + (score ? ", rated " + score.rating.toFixed(1) : "")} />
      {/* Founder view only: sits above the card's click layer so it opens the site, not the listing. */}
      <AdminSiteLink item={u} variant="icon" />
      <div className={"ah-card-photo" + (playing ? " is-playing" : "")} ref={photoBox}>
        {/* The cover is always the bottom layer; the other photos are stacked above it and fade in when shown. */}
        <Photo key={gallery[playing ? 0 : pic] || "cover"} src={gallery[playing ? 0 : pic]} video={(playing ? 0 : pic) === 0 ? u.video : undefined} kind={u.art} id={"w" + u.id} alt="" />
        {playing && gallery.length > 1
          ? gallery.slice(1).map((src, k) => (
              <div key={src} data-i={k + 1} className={"ah-card-slide" + (k + 1 === pic ? " on" : "")} aria-hidden={k + 1 !== pic}>
                <Photo src={src} kind={u.art} id={"w" + u.id + "-" + (k + 1)} alt="" fallback={false} />
              </div>
            ))
          : null}
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
        {/* The deal sits on the photo, so every card's text block has the same four lines and prices line up. */}
        {dealTitle ? <span className={"ah-card-dealchip" + (dealOn ? " today" : "")}>{dealTitle}</span> : null}
      </div>
      <div className="ah-card-text">
        {/* Airbnb's grid puts the stars beside the title; its narrow rows move them to the end of the price line. */}
        <div className="ah-card-line1">
          <span className="ah-card-title" title={u.title}>{u.title}</span>
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
  const box = useRef<HTMLDivElement | null>(null);
  useModal(box);
  const row = (label: string, cell: (u: Unclaimed) => React.ReactNode) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      {items.map((u) => <td key={u.id}>{cell(u)}</td>)}
    </tr>
  );
  const firstPriced = (u: Unclaimed) => u.options.find((o) => o.price != null);
  return (
    <div className="ah-modal-scrim" onClick={onClose}>
      <div className="ah-modal wide" ref={box} role="dialog" aria-modal="true" aria-label="Compare" onClick={(e) => e.stopPropagation()}>
        <div className="ah-modal-head">
          <button type="button" className="ah-iconbtn" aria-label="Close" onClick={onClose}><Markup html={SVG.close} /></button>
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
              {row("Where", (u) => { const n = near ? nearestLocation(u, near) : null; return n ? (n.label ? n.label + " · " : "") + fmtDistance(n.km, countryOfArea(u.area)) + " away" : u.area; })}
              {row("What you'd book", (u) => { const o = firstPriced(u) || u.options[0]; return o ? o.name + (o.detail ? " · " + o.detail : "") : <span className="ah-muted">Contact the business</span>; })}
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

function CategoryBar({ chips, selected, onPick, filterCount, onFilters }: { chips: WorldChip[]; selected: string; onPick: (c: WorldChip) => void; filterCount: number; onFilters: () => void }) {
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
  useEffect(measure, [chips]);
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
          {chips.map((c) => (
            <button
              type="button"
              role="tab"
              key={c.id}
              aria-selected={selected === c.id}
              tabIndex={selected === c.id ? 0 : -1}
              className="ah-cat"
              onClick={() => onPick(c)}
            >
              <Markup html={c.svg || ICONS[c.icon]} />
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
  const box = useRef<HTMLDivElement | null>(null);
  useModal(box);
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
      <div className="ah-modal" ref={box} role="dialog" aria-modal="true" aria-labelledby="ah-filters-title" onClick={(e) => e.stopPropagation()}>
        <div className="ah-modal-head">
          <button type="button" className="ah-iconbtn" aria-label="Close" onClick={onClose}><Markup html={SVG.close} /></button>
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

/**
 * What the guest searched for outlives this page's mount.
 *
 * App.tsx swaps this page out for WebListing while a listing is open, so every useState below started over when
 * "Back to results" brought it back. A guest who searched "jet ski", opened one and came back landed on the plain
 * home page, whose first rail is "Popular Pontoon and Boat Rentals": to them, the jet ski page had sent them to
 * boats, and the scroll position that AppProvider restores dropped them in the middle of that rail. The search,
 * its filters and the pill's shape are kept here at module scope, and every mount starts from them.
 */
/** The two steppers' ceilings. A party larger than this is a call to the shop, not a booking box. */
const ADULTS_MAX = 12;
const KIDS_MAX = 10;

/**
 * The party the guest last picked, split back into the two steppers. Only the total is kept (that is what a
 * booking takes), and it outlives a reload, so the pill has to be able to read it back.
 */
function rememberedParty(): { who: number; kids: number } {
  const total = Math.min(ADULTS_MAX + KIDS_MAX, getPrefs().who || 2);
  const adults = Math.max(1, Math.min(ADULTS_MAX, total));
  return { who: adults, kids: Math.max(0, total - adults) };
}

const remembered: { q: string; whereText: string; artChip: ArtKind | null; who: number; kids: number; searched: boolean; sort: SortId; price: PriceRange } = {
  q: "", whereText: "", artChip: null, ...rememberedParty(), searched: false, sort: "relevance", price: { min: null, max: null },
};

export function WebHome({ onOpenApp, onOperators }: { onOpenApp: () => void; onOperators: () => void }) {
  const { state, setCat, setMetro, setNear, setDate, openRequest, dates } = useApp();
  // What: the activity, occasion or business. Where: the words typed while looking for a place. The place itself
  // lives in app state (near or metro), so the two boxes never overwrite each other.
  const [q, setQ] = useState(remembered.q);
  const [whereText, setWhereText] = useState(remembered.whereText);
  // A kind chip inside Food & drink or Wellness ("Breweries"). Experiences chips are the category tabs themselves.
  const [artChip, setArtChip] = useState<ArtKind | null>(remembered.artChip);
  const [who, setWho] = useState(remembered.who);
  const [kids, setKids] = useState(remembered.kids);
  /**
   * Who is a pick, not a label. The total carries into the booking box on every listing this guest opens, the
   * way the date already does through app state, and the way the phone sheet has always carried its own.
   */
  const pickParty = (adults: number, children: number, cleared = false) => {
    setWho(adults);
    setKids(children);
    setPrefs({ who: cleared ? null : adults + children });
  };
  const [seg, setSeg] = useState<Seg | null>(null);
  // The pill starts as What alone. Where, When and Who appear once the guest has searched: the button, Enter,
  // or a pick from the What menu. Refining comes second, not before the guest has said what they want to do.
  const [searched, setSearched] = useState(remembered.searched);
  // Where, When and Who live in a modal: it opens on its own after the first search, and the chip in the pill
  // (or the compact bar) reopens it. The value is the section that is unfolded.
  const [refine, setRefine] = useState<"where" | "when" | "who" | null>(null);
  const near = state.near;
  const [sort, setSort] = useState<SortId>(remembered.sort);
  const [price, setPrice] = useState<PriceRange>(remembered.price);
  // Written back on every change, so the next mount (after a listing closes) picks up where this one left off.
  useEffect(() => {
    Object.assign(remembered, { q, whereText, artChip, who, kids, searched, sort, price });
  }, [q, whereText, artChip, who, kids, searched, sort, price]);
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
  const [locateNote, setLocateNote] = useState<string | null>(null);
  const metro = metroById(state.metroId);
  const world = WORLDS.find((w) => w.id === worldOf(state.cat))!;
  const kindChip = artChip && world.chips.find((c) => c.art === artChip) ? artChip : null;
  const chipOk = (u: Unclaimed) => !kindChip || u.art === kindChip;
  // A picked state holds every listing in it; a picked point holds what is within the radius. Shared with the
  // phone feed in `explore/feed.ts`, because the two used to disagree for the same guest in the same session.
  // The home pool reaches as far as a day trip; the rows on it are cut to what is truly near (see nearPool).
  const inNear = withinDrive;
  const pillRef = useRef<HTMLDivElement>(null);
  const whereInput = useRef<HTMLInputElement>(null);
  const whatInput = useRef<HTMLInputElement>(null);
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
    setHit(-1);
    // Where, When and Who are a modal, not segments: anything that asks for one (the compact bar, a filter
    // that needs a place) opens the modal on that section and leaves the pill as What alone.
    if (s && s !== "what") {
      setSearched(true);
      setSeg(null);
      setRefine(s);
      return;
    }
    setSeg(s);
  };
  const focusSeg = (s: "where" | "what") => window.setTimeout(() => (s === "where" ? whereInput : whatInput).current?.focus(), 0);

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
  }, !!seg && !filtersOpen && !compareOpen && !refine);
  useEscape(() => setRefine(null), !!refine && !filtersOpen && !compareOpen);
  const refineBox = useRef<HTMLDivElement | null>(null);
  useModal(refineBox, !!refine);

  useEffect(() => {
    if (refine !== "where") return;
    let live = true;
    const t = window.setTimeout(() => {
      searchPlaces(whereText, near).then((r) => live && setPlaceHits(r));
    }, 220);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [whereText, refine]);

  /** Where is done once a place is picked: the modal moves on to When, keeping whatever What already holds. */
  const afterPlace = () => {
    setWhereText("");
    setRefine("when");
  };
  const pickPlace = (p: Place) => {
    setNear(p);
    // Rows stay rows, as on Airbnb: each is already measured from the place, and "Open right now" leads them.
    afterPlace();
  };
  const useMyLocation = async () => {
    setLocating(true);
    setLocateNote(null);
    const pt = await currentLocation();
    setLocating(false);
    // Refused, or the prompt was never answered. Saying nothing leaves the guest pressing a row that
    // looks broken, so say it and point at the box that does work.
    if (!pt) {
      setLocateNote("We could not get your location. Type a town or a city instead.");
      return;
    }
    setLocateNote(null);
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

  // A city typed into What ("axe throwing denver") beats the saved place until the menu closes, then moves to Where.
  const typedMetro = useMemo(() => (dq.trim() ? metroInQuery(dq) : null), [dq]);
  const qWithoutPlace = useMemo(() => (typedMetro ? stripPlaceWords(dq, typedMetro.words) : dq), [dq, typedMetro]);
  // "Miami" on its own is a place, not a keyword. A guest who types a city wants that city's things to do laid out
  // as rows the way the home page lays them out, not a flat grid headed "Results for “Miami” in Miami".
  const placeOnly = !!typedMetro && !qWithoutPlace.trim();
  // The city being looked at, typed or picked, and its centre for ranking.
  const activeMetro = typedMetro?.metro ?? (near ? undefined : metro);
  const activeCenter = useMemo(() => {
    const c = activeMetro ? metroCoords(activeMetro.id) : null;
    return c ? { lat: c.lat, lon: c.lng } : null;
  }, [activeMetro?.id]);

  // Where the guest is looking. The search reads the whole catalog and narrows here, so its index is built once.
  const scope = useMemo<SearchScope>(() => {
    const cat = state.cat;
    const art = kindChip;
    if (typedMetro) return { cat, metroId: typedMetro.metro.id, keep: art ? (u: Unclaimed) => u.art === art : undefined };
    if (near) return { cat, keep: (u: Unclaimed) => (!art || u.art === art) && inNear(u, near) };
    if (state.metroId !== ALL_METRO_ID) return { cat, metroId: state.metroId, keep: art ? (u: Unclaimed) => u.art === art : undefined };
    return { cat, keep: art ? (u: Unclaimed) => u.art === art : undefined };
  }, [typedMetro, near, state.metroId, state.cat, kindChip]);

  // One pass feeds the What dropdown and the results behind it, so a keystroke ranks the catalog once.
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
    let base = getCatalog().filter((u) => !!u.cover && chipOk(u));
    if (typedMetro) {
      base = base.filter((u) => u.metroId === typedMetro.metro.id);
    } else if (near) {
      const km = (u: Unclaimed) => nearestLocation(u, near)?.km ?? Infinity;
      base = base.filter((u) => inNear(u, near));
      if (!near.region) base.sort((a, b) => km(a) - km(b));
    } else if (state.metroId !== ALL_METRO_ID) {
      base = base.filter((u) => u.metroId === state.metroId);
    }
    return base;
  }, [found, state.metroId, typedMetro, state.catalogVersion, near, kindChip]);

  // A picked point: the rows show only what is truly near; the ring between near and a day trip is one row of its own.
  const nearPoint = !!near && !near.region;
  const nearPool = useMemo(() => (nearPoint ? pool.filter((u) => kmToPlace(u, near!) <= NEAR_RADIUS_KM) : pool), [pool, near, nearPoint]);
  const drivePool = useMemo(() => (nearPoint ? pool.filter((u) => { const km = kmToPlace(u, near!); return km > NEAR_RADIUS_KM && km <= DRIVE_RADIUS_KM; }) : []), [pool, near, nearPoint]);

  // How many nearby places are listed but have no photo yet, so the page can say so instead of hiding the gap.
  const waiting = useMemo(() => {
    if (found) return 0;
    let base = getCatalog().filter((u) => !u.cover && chipOk(u));
    if (typedMetro) base = base.filter((u) => u.metroId === typedMetro.metro.id);
    else if (near) base = base.filter((u) => inNear(u, near));
    else if (state.metroId !== ALL_METRO_ID) base = base.filter((u) => u.metroId === state.metroId);
    return base.filter((u) => inCat(u, state.cat)).length;
  }, [found, state.metroId, typedMetro, state.catalogVersion, near, state.cat, kindChip]);

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
  const base = useMemo(() => (q.trim() && !placeOnly ? pool : pool.filter((u) => inCat(u, state.cat))), [pool, q, placeOnly, state.cat]);

  // Airbnb's two shapes: rows when nothing is narrowed, one flat grid once a category, order, price or search is.
  const gridMode = (!q.trim() || placeOnly) && (state.cat !== "all" || effSort !== "relevance" || priceOn);
  const gridList = useMemo(() => {
    if (!gridMode) return null;
    const list = base.filter(inPrice);
    if (effSort === "relevance") return near ? list : rankForRail(list, activeCenter);
    return applySort(list);
  }, [gridMode, base, effSort, near, price.min, price.max]);
  const searchList = useMemo(() => {
    if (!q.trim() || placeOnly) return null;
    return applySort(pool.filter(inPrice));
  }, [q, placeOnly, pool, effSort, near, price.min, price.max]);

  /**
   * What a button that says "Show N places" is promising: the list the page will actually draw, not the one
   * before the price range was applied. `base` is the pool the filters count from, so the Where, when and who
   * modal was promising 828 places with a price range set that left 90, while the Filters modal beside it,
   * reading the same page at the same moment, said 90.
   */
  const shownCount = (gridList ?? searchList ?? base).length;

  // Kinds with at least one listing here, scored by how many have a photo. The strongest HOME_RAILS become rails
  // in the mixed order above; the rest are links so the page is not sixty rails long.
  const { rails, moreKinds } = useMemo(() => {
    const count = new Map<ArtKind, { n: number; covers: number }>();
    for (const u of nearPool) {
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
  }, [nearPool, state.cat]);
  const openNow = useNearNow(near, state.catalogVersion);
  // Photographed places per city, for the Where menu's suggestions.
  const metroCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const u of getCatalog()) if (u.cover) out.set(u.metroId, (out.get(u.metroId) || 0) + 1);
    return out;
  }, [state.catalogVersion]);

  const metroTotals = useMemo(() => {
    const out = new Map<string, number>();
    for (const u of getCatalog()) out.set(u.metroId, (out.get(u.metroId) || 0) + 1);
    return out;
  }, [state.catalogVersion]);

  const nearName = (p: Place) => (p.label === "Near me" ? "you" : p.label);
  const placeName = near ? near.label + (near.sub ? ", " + near.sub.split(",")[0] : "") : metro ? metro.name + ", " + metro.region : "";
  const whereShort = typedMetro ? typedMetro.metro.name : near ? near.label : metro ? metro.name : "Anywhere";
  const inWhere = typedMetro ? " in " + typedMetro.metro.name : near ? " near " + nearName(near) : metro ? " in " + metro.name : "";
  /** Where a count applies, for the What menu: "in Miami", "near you", or everywhere. */
  const hereLine = inWhere || " across the US and Canada";
  const whatTitle = qWithoutPlace.trim() ? whatName(qWithoutPlace) : "";
  const whatShort = whatTitle.replace(/[“”]/g, "") || "Any activity";
  const catName = (id: CategoryId) => CATS.find((c) => c.id === id)?.name || "All";
  const dayLabel = state.dateIdx === 0 ? "Today" : state.dateIdx === 1 ? "Tomorrow" : fmtDate(dates[state.dateIdx]);
  const guests = who + kids;
  const guestLabel = guests + (guests === 1 ? " guest" : " guests");

  const acts = found?.activities ?? [];
  const ops = found?.operators ?? [];
  const spots = found?.places ?? [];
  // Counts in the What menu come from the same search each row runs, keyed by where it runs.
  const scopeKey = state.catalogVersion + ":" + state.cat + ":" + (kindChip || "") + ":" + (typedMetro ? "m" + typedMetro.metro.id : near ? "n" + near.lat + "," + near.lon + (near.region || "") : "m" + state.metroId);
  const countFor = (query: string) => searchCount(query, scope, scopeKey);

  const pickCity = (id: string) => {
    // "axe throwing denver" with Denver picked becomes an axe search in Denver, not a search for the word "denver".
    if (typedMetro && typedMetro.metro.id === id) setQ(qWithoutPlace.trim());
    setNear(null);
    setMetro(id);
    setHit(-1);
  };

  /** A place typed into What ("kayak tampa") moves to Where, and What keeps the rest. */
  const commitWhat = () => {
    const m = q.trim() ? metroInQuery(q) : null;
    if (!m) return;
    setNear(null);
    setMetro(m.metro.id);
    setQ(stripPlaceWords(q, m.words));
  };
  const commitRef = useRef(commitWhat);
  commitRef.current = commitWhat;
  const prevSeg = useRef<Seg | null>(null);
  useEffect(() => {
    if (prevSeg.current === "what" && seg !== "what") commitRef.current();
    prevSeg.current = seg;
  }, [seg]);

  /** The first search opens the Where, When and Who modal once; after that the chip in the pill reopens it. */
  const firstSearch = (text: string) => {
    if (!text.trim()) return;
    if (!searched) setRefine("where");
    setSearched(true);
  };
  const runSearch = () => {
    commitWhat();
    firstSearch(q);
    setSeg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  /** A What suggestion runs its search at once: the grid behind the menu is the answer. */
  const pickWhat = (query: string) => {
    if (typedMetro) {
      setNear(null);
      setMetro(typedMetro.metro.id);
    }
    setQ(query);
    firstSearch(query);
    setSeg(null);
    window.scrollTo({ top: 0 });
  };

  type Row = { key: string; head?: string; icon?: string; u?: Unclaimed; title: string; sub?: string; on?: boolean; pick: () => void };

  // ---- Where: places only. Empty: nearby and suggested places. Typed: the city, states, cities, map places.
  const wt = whereText.trim();
  const whereMetro = useMemo(() => (wt ? metroInQuery(wt) : null), [wt]);
  const whereRegions = useMemo(() => (wt ? searchRegions(getCatalog(), wt) : []), [wt, state.catalogVersion]);
  const whereCities = useMemo(() => {
    if (!wt) return [];
    const list = whereRegions.length
      ? METROS.filter((m) => m.region === whereRegions[0].code).sort((a, b) => (metroTotals.get(b.id) || 0) - (metroTotals.get(a.id) || 0)).slice(0, 4)
      : searchMetros(wt, 3);
    return list.filter((m) => (metroTotals.get(m.id) || 0) > 0 && m.id !== whereMetro?.metro.id);
  }, [wt, whereRegions, whereMetro, metroTotals]);
  const pickMetro = (id: string) => {
    // "kayak tampa" typed into Where: Tampa is the place, and the kayak half goes to What if What is empty.
    if (whereMetro && whereMetro.metro.id === id && !q.trim()) {
      const rest = stripPlaceWords(wt, whereMetro.words);
      if (rest) setQ(rest);
    }
    setNear(null);
    setMetro(id);
    afterPlace();
  };

  const whereRows: Row[] = [];
  if (!wt) {
    whereRows.push({ key: "nearby", head: "Nearby", icon: ICONS.nav, title: locating ? "Finding you…" : "Nearby", sub: "Find what's around you", on: near?.label === "Near me", pick: useMyLocation });
    whereRows.push({ key: "anywhere", head: "Suggested destinations", icon: ICONS.globe, title: "Anywhere", sub: "US and Canada", on: !near && state.metroId === ALL_METRO_ID, pick: () => { setNear(null); setMetro(ALL_METRO_ID); afterPlace(); } });
    for (const id of POPULAR_METROS) {
      const m = METROS.find((x) => x.id === id);
      if (m) whereRows.push({ key: "m" + m.id, icon: ICONS.pin, title: m.name + ", " + m.region, sub: places(metroCounts.get(m.id) || 0) + " with photos", on: !near && state.metroId === m.id, pick: () => pickMetro(m.id) });
    }
  } else {
    // A typed city leads with the city itself: "Miami" used to list six map places called Miami and never our Miami.
    if (whereMetro) {
      const m = whereMetro.metro;
      whereRows.push({ key: "tm" + m.id, head: "Places", icon: ICONS.pin, title: m.name + ", " + m.region, sub: "Things to do · " + places(metroCounts.get(m.id) || 0), on: !near && state.metroId === m.id, pick: () => pickMetro(m.id) });
    }
    whereRegions.forEach((r, i) => whereRows.push({ key: "r" + r.code, head: i === 0 && !whereMetro ? "Places" : undefined, icon: ICONS.pin, title: r.name, sub: r.count.toLocaleString() + " places · " + r.country, pick: () => pickPlace({ label: r.name, sub: r.country, lat: r.lat, lon: r.lon, region: r.code }) }));
    whereCities.forEach((m, i) => whereRows.push({ key: "s" + m.id, head: i === 0 && !whereRegions.length ? "Cities" : undefined, icon: ICONS.pin, title: m.name + ", " + m.region, sub: places(metroTotals.get(m.id) || 0), on: !near && state.metroId === m.id, pick: () => pickMetro(m.id) }));
    // A typed city keeps map places to its own area: "Miami" should not offer Miami, Oklahoma.
    const tmc = whereMetro ? metroCoords(whereMetro.metro.id) : null;
    placeHits.filter((p) => !tmc || kmBetween({ lat: tmc.lat, lon: tmc.lng }, p) <= 150).forEach((p, i) => whereRows.push({ key: "p" + p.label + p.sub, head: i === 0 ? "Places on the map" : undefined, icon: ICONS.pin, title: p.label, sub: p.sub, pick: () => pickPlace(p) }));
  }

  // ---- What: the activity or business, counted inside the chosen place.
  const whatRows: Row[] = [];
  const intentRows = (chips: { label: string; query: string }[], head: string) => {
    let first = true;
    for (const c of chips) {
      const n = countFor(c.query);
      if (!n) continue;
      whatRows.push({ key: "i" + c.query, head: first ? head : undefined, icon: ICONS.spark, title: c.label, sub: n.toLocaleString() + hereLine, on: q.trim().toLowerCase() === c.query, pick: () => pickWhat(c.query) });
      first = false;
    }
  };
  // The same kinds the page shows as rails, in the same order, so the menu and the page agree.
  const topKinds = useMemo(() => (seg === "what" && !qWithoutPlace.trim() ? rails.slice(0, 6).map((r) => r.art) : []), [seg, qWithoutPlace, rails]);
  if (seg === "what") {
    if (!qWithoutPlace.trim()) {
      let first = true;
      for (const art of topKinds) {
        const query = kindQuery(art);
        const n = countFor(query);
        if (!n) continue;
        const title = RAIL_KINDS.find((r) => r.art === art)?.title || ART_LABEL[art];
        whatRows.push({ key: "k" + art, head: first ? "Popular" + hereLine : undefined, icon: ICONS.spark, title, sub: n.toLocaleString() + hereLine, pick: () => pickWhat(query) });
        first = false;
      }
      intentRows(WHAT_INTENTS, "Ideas");
    } else {
      const typed = qWithoutPlace.trim().toLowerCase();
      if (typedMetro) {
        const m = typedMetro.metro;
        whatRows.push({ key: "tm" + m.id, head: "Place", icon: ICONS.pin, title: whatTitle.replace(/[“”]/g, "") + " in " + m.name, sub: "Sets Where to " + m.name + ", " + m.region, pick: () => { commitWhat(); firstSearch(q); setSeg(null); window.scrollTo({ top: 0 }); } });
      }
      let first = true;
      for (const a of acts) {
        const n = countFor(a.query);
        if (!n) continue;
        whatRows.push({ key: "a" + a.art, head: first ? "Activities" : undefined, icon: ICONS.spark, title: RAIL_KINDS.find((r) => r.art === a.art)?.title || a.label, sub: n.toLocaleString() + hereLine, on: typed === a.query, pick: () => pickWhat(a.query) });
        first = false;
      }
      ops.forEach((u, i) => whatRows.push({ key: "o" + u.id, head: i === 0 ? "Businesses" : undefined, u, title: u.title, sub: ART_LABEL[u.art] + " · " + u.area, pick: () => { commitWhat(); openSeg(null); openRequest(u.id); } }));
      const words = typed.split(/\s+/);
      const chips = WHAT_INTENTS.filter((c) => c.query !== typed && words.some((w) => w.length >= 2 && c.label.toLowerCase().split(/\s+/).some((lw) => lw.replace(/[^a-z0-9$]/g, "").startsWith(w.replace(/[^a-z0-9$]/g, "")))));
      const d = describeQuery(qWithoutPlace);
      if (d.onlyIntent && !WHAT_INTENTS.some((c) => c.query === typed)) chips.unshift({ label: d.intent.label!, query: qWithoutPlace.trim() });
      intentRows(chips, "Ideas");
      (found?.elsewhere ?? []).forEach((a, i) => whatRows.push({ key: "e" + a.art, head: i === 0 ? "Elsewhere" : undefined, icon: ICONS.globe, title: a.label + " across the US and Canada", sub: places(a.count), pick: () => { setNear(null); setMetro(ALL_METRO_ID); pickWhat(a.query); } }));
      if (found?.nearMiss) spots.forEach((pl, i) => whatRows.push({ key: "np" + pl.metro.id, head: i === 0 ? "Nearest with it" : undefined, icon: ICONS.pin, title: whatShort + " in " + pl.metro.name, sub: places(pl.count) + " · " + pl.metro.region, pick: () => pickCity(pl.metro.id) }));
      if (found?.family) whatRows.push({ key: "fam" + found.family.cat, head: "Browse instead", icon: ICONS.catAll, title: found.family.name + hereLine, sub: places(found.family.count) + " to browse", pick: () => { setQ(""); setCat(found.family!.cat); setSeg(null); } });
      if (found?.otherCats) whatRows.push({ key: "othercats", icon: ICONS.catAll, title: "Show all categories", sub: found.otherCats.toLocaleString() + " more outside " + catName(state.cat), pick: () => setCat("all") });
    }
  }
  const rows = seg === "what" ? whatRows : whereRows;

  /**
   * The Where rows the modal actually draws. Untyped it shows a shortlist, so the arrows have to walk that and
   * not the whole list: pressing down past the eighth row moved a highlight nobody could see.
   */
  const whereShown = wt ? whereRows : whereRows.slice(0, 8);

  const moveHit = (e: React.KeyboardEvent<HTMLInputElement>, s: "where" | "what") => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return false;
    e.preventDefault();
    const list = s === "what" ? whatRows : whereShown;
    // Opening a segment starts the highlight over, so it may only happen when that segment is not open yet.
    // Where is a modal and is already open around its own input; What reopened itself on every press, which
    // reset the highlight to nothing and put it straight back on the first row, so holding the key went nowhere.
    if (s === "what" && seg !== "what") openSeg("what");
    setHit((i) => (e.key === "ArrowDown" ? Math.min(list.length - 1, i + 1) : Math.max(-1, i - 1)));
    return true;
  };
  const onWhereKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (moveHit(e, "where") || e.key !== "Enter") return;
    e.preventDefault();
    if (hit >= 0 && whereShown[hit]) whereShown[hit].pick();
    // Enter on a typed place picks it: the city, else the state the region match found, else the first place.
    else if (whereMetro) pickMetro(whereMetro.metro.id);
    else if (whereRegions.length) whereRows.find((r) => r.key === "r" + whereRegions[0].code)?.pick();
    else if (wt && whereRows[0]) whereRows[0].pick();
    else afterPlace();
  };
  const onWhatKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (moveHit(e, "what") || e.key !== "Enter") return;
    e.preventDefault();
    if (seg === "what" && hit >= 0 && rows[hit]) rows[hit].pick();
    else runSearch();
  };

  const clearWhere = () => {
    setWhereText("");
    setNear(null);
    setMetro(ALL_METRO_ID);
    whereInput.current?.focus();
  };
  const clearWhat = () => {
    setQ("");
    setHit(-1);
    whatInput.current?.focus();
  };

  const pickCat = (c: CategoryId) => {
    setCat(c);
    setArtChip(null);
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  };
  /** Switching worlds starts on that world's All and keeps Where and What. */
  const pickWorld = (id: string) => {
    const w = WORLDS.find((x) => x.id === id);
    if (w) pickCat(w.chips[0].cat);
  };
  const pickChip = (c: WorldChip) => {
    pickCat(c.cat);
    if (c.art) setArtChip(c.art);
  };

  const filterCount = (effSort !== "relevance" ? 1 : 0) + (priceOn ? 1 : 0);
  const resetFilters = () => { setSort("relevance"); setPrice({ min: null, max: null }); setCat("all"); setArtChip(null); };
  const showRails = state.catalogReady && (!q.trim() || placeOnly) && !gridMode;

  return (
    <CompareCtx.Provider value={{ ids: compareIds, toggle: toggleCompare }}>
    <div className={"web ah" + (compareIds.length ? " has-cmpbar" : "")}>
      <header className={"ah-header" + (scrolled ? " is-scrolled" : "") + (expanded ? " is-expanded" : " is-compact")}>
        <div className="ah-top ah-gutter">
          <a className="ah-logo" href="./" aria-label="Outset home" onClick={(e) => { e.preventDefault(); setCat("all"); setArtChip(null); setQ(""); setSearched(false); setSort("relevance"); setPrice({ min: null, max: null }); window.scrollTo({ top: 0 }); }}>
            <Mark size={32} />
            <b>Outset</b>
          </a>
          {expanded ? (
            <nav className="ah-switch" aria-label="What to browse">
              {WORLDS.map((w) => {
                const on = w.id === world.id;
                return (
                  <button type="button" key={w.id} aria-current={on ? "page" : undefined} className={on ? "on" : ""} onClick={() => pickWorld(w.id)}>
                    <Markup html={ICONS[w.icon]} />
                    <span>{w.label}</span>
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className={"ah-mini" + (searched ? "" : " solo")} role="group" aria-label="Search">
              {searched ? (
                <>
                  <button type="button" aria-label={"Where: " + whereShort} onClick={() => { openSeg("where"); focusSeg("where"); }}>{whereShort}</button>
                  <i />
                </>
              ) : null}
              <button type="button" aria-label={"What: " + whatShort} className={q.trim() ? "" : "soft"} onClick={() => { openSeg("what"); focusSeg("what"); }}>{whatShort}</button>
              {searched ? (
                <>
                  <i />
                  <button type="button" aria-label={"When: " + dayLabel} onClick={() => openSeg("when")}>{dayLabel}</button>
                  <i />
                  <button type="button" aria-label={"Who: " + guestLabel} className="soft" onClick={() => openSeg("who")}>{guestLabel}</button>
                </>
              ) : null}
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
            <div className={"ah-pill solo" + (seg ? " is-active" : "")} ref={pillRef} role="search">
              <label className={"ah-seg what" + (seg === "what" ? " on" : "")} htmlFor="ah-what" data-seg="what-label">
                <span className="ah-seg-label">What</span>
                <input
                  id="ah-what"
                  ref={whatInput}
                  data-seg="what"
                  value={q}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Search activities"
                  role="combobox"
                  aria-expanded={seg === "what"}
                  aria-controls="ah-what-pop"
                  aria-activedescendant={seg === "what" && hit >= 0 && rows[hit] ? "ah-row-" + hit : undefined}
                  onFocus={() => { if (seg !== "what" && !skipFocusOpen.current) openSeg("what"); }}
                  onClick={() => { if (seg !== "what") openSeg("what"); }}
                  onChange={(e) => { setQ(e.target.value); setHit(-1); if (seg !== "what") openSeg("what"); }}
                  onKeyDown={onWhatKey}
                />
                {seg === "what" && q ? (
                  <button type="button" className="ah-clear" aria-label="Clear what" onMouseDown={(e) => e.preventDefault()} onClick={clearWhat}><Markup html={SVG.close} /></button>
                ) : null}
              </label>
              {searched ? (
                <button type="button" className="ah-refine-chip" aria-haspopup="dialog" aria-label={"Where, when and who: " + whereShort + ", " + dayLabel + ", " + guestLabel} onClick={() => openSeg("where")}>
                  <span>{whereShort}</span>
                  <i />
                  <span>{dayLabel}</span>
                  <i />
                  <span>{guestLabel}</span>
                </button>
              ) : null}
              <button type="button" className={"ah-go" + (seg ? " wide" : "")} onClick={runSearch} aria-label="Search">
                <Markup html={SVG.search} />
                {seg ? <span>Search</span> : null}
              </button>

              {seg === "what" ? (
                <div className="ah-pop what" id="ah-what-pop" role="listbox" aria-label="What">
                  {found?.nearMiss ? (
                    <p className="ah-pop-note">
                      Nothing for “{qWithoutPlace.trim()}”{inWhere}{rows.length ? ". Closest in the catalog:" : ". Try fewer words, or another place."}
                    </p>
                  ) : null}
                  {!rows.length && !found?.nearMiss ? <p className="ah-pop-note">{q.trim() ? "Keep typing, or try fewer words." : "Nothing listed" + hereLine + " yet. Try another place."}</p> : null}
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
            </div>
          </div>
        ) : null}

        <div className="ah-catrow ah-gutter">
          <CategoryBar key={world.id} chips={world.chips} selected={kindChip || state.cat} onPick={pickChip} filterCount={filterCount} onFilters={() => setFiltersOpen(true)} />
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
          <Rail title={"Open right now near " + nearName(near!)} note="From their published hours" items={openNow} onOpen={openRequest} near={near} eager />
        ) : null}

        {showRails ? rails.map((r, i) => {
          const items = rankForRail(nearPool.filter((u) => u.art === r.art), activeCenter);
          // "near you", not "near Near Me": the place's own name stays out of title case.
          const title = near ? titleCase(r.title) + " near " + nearName(near) : titleCase(activeMetro ? `${r.title} in ${activeMetro.name}` : `Popular ${r.title}`);
          return <Rail key={r.art} title={title} items={items} onOpen={openRequest} near={near} eager={i < 2} onShowAll={() => { setQ(kindQuery(r.art)); window.scrollTo({ top: 0 }); }} />;
        }) : null}
        {showRails && nearPoint && drivePool.length >= 4 ? (
          <Rail title={"Worth the drive from " + nearName(near!)} note={"Between " + NEAR_RADIUS_KM + " and " + DRIVE_RADIUS_KM + " km away, a day out rather than an afternoon"} items={rankForRail(drivePool.filter((u) => inCat(u, state.cat)), activeCenter)} onOpen={openRequest} near={near} />
        ) : null}

        {showRails && !rails.length && !openNow.length ? (
          <div className="ah-empty">
            <h2>Nothing in {catName(state.cat)} here yet</h2>
            <p>Try Anywhere, or another category. {CATMETA[state.cat]?.emptyBody || ""}</p>
            <button type="button" className="ah-btn-outline" onClick={() => { setNear(null); setMetro(ALL_METRO_ID); }}>Search everywhere</button>
          </div>
        ) : null}

        {showRails && moreKinds.length ? (
          <section className="ah-inspire" aria-labelledby="ah-more-kinds">
            <h2 id="ah-more-kinds">More kinds{near ? ` near ${nearName(near)}` : metro ? ` in ${metro.name}` : ""}</h2>
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
                  {gridList.length > 1000 ? "Over 1,000" : gridList.length.toLocaleString()} {kindChip ? (world.chips.find((c) => c.art === kindChip)?.name || "").toLowerCase() : state.cat === "all" ? "experiences" : catName(state.cat).toLowerCase() + " experiences"}
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
                  {whatTitle || "Things to do"}
                  {hereLine} · {searchList.length.toLocaleString()}
                </h2>
                <p>
                  {intent.label
                    ? (intent.kids ? "Only places whose published rules allow younger kids. " : "") + (intent.maxPrice != null ? "Starting price at or under $" + intent.maxPrice + ". " : "") + "Best fit first, then rating and reviews."
                    : "Best fit first, then rating and reviews."}
                </p>
              </div>
              <div className="ah-rowtools">
                <button type="button" className="ah-showall" onClick={() => { setQ(""); window.scrollTo({ top: 0 }); }}>Clear what</button>
              </div>
            </div>
            {searchList.length ? (
              <Grid items={searchList} onOpen={openRequest} near={near} resetKey={q + effSort + price.min + price.max} />
            ) : (
              // Never a bare no-match: every way out below is a real count from the catalog.
              <div className="ah-empty">
                <h2>Nothing for “{qWithoutPlace.trim() || q.trim()}”{hereLine} yet</h2>
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
                  {found?.family ? (
                    <button type="button" className="ah-btn-outline" onClick={() => { setQ(""); setCat(found.family!.cat); }}>Browse {found.family.name}{hereLine} · {found.family.count.toLocaleString()}</button>
                  ) : null}
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

      {refine ? (
        <div className="ah-modal-scrim" onClick={() => setRefine(null)}>
          <div className="ah-modal ah-refine" ref={refineBox} role="dialog" aria-modal="true" aria-labelledby="ah-refine-title" onClick={(e) => e.stopPropagation()}>
            <div className="ah-refine-head">
              <button type="button" className="ah-refine-x" aria-label="Close" onClick={() => setRefine(null)}><Markup html={SVG.close} /></button>
              <h2 id="ah-refine-title">Where, when and who</h2>
            </div>
            <div className="ah-refine-body">
              {refine === "where" ? (
                <section className="ah-rcard open" aria-label="Where">
                  <h3>Where to?</h3>
                  <label className="ah-rinput">
                    <Markup html={SVG.search} />
                    <input
                      ref={whereInput}
                      autoFocus
                      value={whereText}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={placeName || "Search destinations"}
                      aria-label="Where"
                      role="combobox"
                      aria-expanded={whereShown.length > 0}
                      aria-controls="ah-where-list"
                      aria-activedescendant={hit >= 0 && whereShown[hit] ? "ah-wrow-" + hit : undefined}
                      onChange={(e) => { setWhereText(e.target.value); setHit(-1); }}
                      onKeyDown={onWhereKey}
                    />
                    {whereText || placeName ? (
                      <button type="button" className="ah-clear" aria-label="Clear where" onClick={clearWhere}><Markup html={SVG.close} /></button>
                    ) : null}
                  </label>
                  {locateNote ? <p className="ah-pop-note">{locateNote}</p> : null}
                  {wt && !whereRows.length ? <p className="ah-pop-note">Keep typing, or try a bigger town nearby.</p> : null}
                  <div className="ah-rgrid" id="ah-where-list" role="listbox" aria-label="Places">
                    {whereShown.map((r, i) => (
                      <Fragment key={r.key}>
                        {r.head ? <p className="ah-pop-head">{r.head}</p> : null}
                        <button
                          type="button"
                          id={"ah-wrow-" + i}
                          role="option"
                          aria-selected={hit === i || !!r.on}
                          className={"ah-pop-row" + (hit === i ? " hit" : "") + (r.on ? " on" : "")}
                          onMouseEnter={() => setHit(i)}
                          onClick={r.pick}
                          disabled={r.key === "nearby" && locating}
                        >
                          <span className="ah-pop-icon"><Markup className="ah-ico" html={r.icon || ICONS.pin} /></span>
                          <span className="ah-pop-text">
                            <b>{r.title}</b>
                            {r.sub ? <small>{r.sub}</small> : null}
                          </span>
                        </button>
                      </Fragment>
                    ))}
                  </div>
                </section>
              ) : (
                <button type="button" className="ah-rcard folded" onClick={() => setRefine("where")}>
                  <span>Where</span>
                  <b>{placeName || "Anywhere"}</b>
                </button>
              )}
              {refine === "when" ? (
                <section className="ah-rcard open" aria-label="When">
                  <h3>When?</h3>
                  <Calendar dates={dates} idx={state.dateIdx} onPick={(i) => { setDate(i); setRefine("who"); }} />
                  <div className="ah-chips">
                    {[0, 1].map((i) => (
                      <button type="button" key={i} aria-pressed={state.dateIdx === i} onClick={() => { setDate(i); setRefine("who"); }}>{i === 0 ? "Today" : "Tomorrow"}</button>
                    ))}
                    {(() => {
                      const sat = dates.findIndex((d, i) => i > 1 && d.getDay() === 6);
                      return sat > 0 ? <button type="button" aria-pressed={state.dateIdx === sat} onClick={() => { setDate(sat); setRefine("who"); }}>This Saturday</button> : null;
                    })()}
                    <span className="ah-chips-note">Operators take requests for the next {dates.length} days.</span>
                  </div>
                </section>
              ) : (
                <button type="button" className="ah-rcard folded" onClick={() => setRefine("when")}>
                  <span>When</span>
                  <b>{dayLabel}</b>
                </button>
              )}
              {refine === "who" ? (
                <section className="ah-rcard open" aria-label="Who">
                  <h3>Who's coming?</h3>
                  <Stepper label="Adults" sub="Ages 13 or above" value={who} min={1} max={ADULTS_MAX} onChange={(n) => pickParty(n, kids)} />
                  <Stepper label="Children" sub="Ages 12 and under" value={kids} min={0} max={KIDS_MAX} onChange={(n) => pickParty(who, n)} />
                  <p className="ah-pop-foot">Age and weight rules differ by activity. Each listing shows its own.</p>
                </section>
              ) : (
                <button type="button" className="ah-rcard folded" onClick={() => setRefine("who")}>
                  <span>Who</span>
                  <b>{guestLabel}</b>
                </button>
              )}
            </div>
            <div className="ah-refine-foot">
              <button type="button" className="ah-textbtn strong" onClick={() => { setWhereText(""); setNear(null); setMetro(ALL_METRO_ID); setDate(0); pickParty(2, 0, true); setRefine("where"); }}>Clear all</button>
              <button type="button" className="ah-btn-dark" onClick={() => { setRefine(null); window.scrollTo({ top: 0 }); }}>
                Show {shownCount.toLocaleString()} {shownCount === 1 ? "place" : "places"}
              </button>
            </div>
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
