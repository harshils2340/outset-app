import { useEffect, useMemo, useRef, useState } from "react";
import { CATS, CATMETA } from "../../data/categories";
import { ART_LABEL } from "../../data/art";
import { ICONS } from "../../data/icons";
import { ALL_METRO_ID, METROS, metroById } from "../../data/metros";
import type { ArtKind, CategoryId, Unclaimed } from "../../data/types";
import { fromPrice, getCatalog, publicRating } from "../../lib/catalog";
import { fmtDate, fmtReviews, money } from "../../lib/format";
import { searchListings } from "../../lib/search";
import { currentLocation, fmtDistance, kmBetween, searchPlaces, type Place } from "../../lib/places";
import { useApp } from "../../state/AppProvider";
import { Photo } from "../art/Photo";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";

/**
 * Desktop home. The shape is airbnb.com: header with category tabs, a Where / When / Who search pill,
 * and horizontal rails of photo cards with a from-price and rating. Cards open the same listing sheet as the app.
 */

const RAIL_KINDS: { art: ArtKind; title: string }[] = [
  { art: "jetski", title: "Jet ski rentals" },
  { art: "kayak", title: "Kayak and paddle" },
  { art: "fishing", title: "Fishing charters" },
  { art: "cruise", title: "Sunset cruises and sails" },
  { art: "pontoon", title: "Pontoon and boat rentals" },
  { art: "skydive", title: "Tandem skydives" },
  { art: "heli", title: "Helicopter tours" },
  { art: "balloon", title: "Hot air balloon rides" },
  { art: "parasail", title: "Parasailing" },
  { art: "kart", title: "Go-kart racing" },
  { art: "escape", title: "Escape rooms" },
  { art: "axe", title: "Axe throwing" },
  { art: "paintball", title: "Paintball" },
  { art: "horse", title: "Horseback rides" },
];

function rankForRail(list: Unclaimed[]): Unclaimed[] {
  return list
    .slice()
    .sort((a, b) => {
      const pa = (a.cover ? 3 : 0) + (fromPrice(a) != null ? 2 : 0) + Math.min(2, Math.log10((a.reviews || 0) + 1));
      const pb = (b.cover ? 3 : 0) + (fromPrice(b) != null ? 2 : 0) + Math.min(2, Math.log10((b.reviews || 0) + 1));
      return pb - pa;
    });
}

type SortId = "relevance" | "distance" | "price" | "rating";
const SORTS: { id: SortId; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "distance", label: "Nearest" },
  { id: "price", label: "Price: low to high" },
  { id: "rating", label: "Top rated" },
];

function Card({ u, onOpen, near }: { u: Unclaimed; onOpen: (id: string) => void; near?: Place | null }) {
  const from = fromPrice(u);
  const score = publicRating(u);
  const metro = metroById(u.metroId);
  return (
            <button type="button" className="wcard" onClick={() => onOpen(u.id)}>
              <div className="wart">
                <Photo src={u.cover} video={u.video} kind={u.art} id={"w" + u.id} alt={u.title} />
                {score && score.rating >= 4.8 && score.reviews >= 100 ? (
                  <span className="wbadge">Guest favourite</span>
                ) : u.cover ? null : (
                  <span className="wkind">{ART_LABEL[u.art]}</span>
                )}
                <span className="wheart" aria-hidden="true">
                  <Markup html={ICONS.heart} />
                </span>
              </div>
              <div className="wbody">
                <b>{u.title}</b>
                <small>
                  {near && u.lat != null && u.lon != null
                    ? fmtDistance(kmBetween(near, { lat: u.lat, lon: u.lon })) + " away · " + u.area
                    : u.area + (metro && !u.area.includes(metro.name) ? " · " + metro.name : "")}
                </small>
                <span className="wmeta">
                  {from != null ? <span>From <b>{money(from)}</b></span> : <span>Request to book</span>}
                  {score ? (
                    <span className="wrate">
                      <Markup html={ICONS.star} /> {score.rating.toFixed(1)} <em>({fmtReviews(score.reviews)})</em>
                    </span>
                  ) : null}
                </span>
              </div>
            </button>
  );
}

function Rail({ title, items, onOpen, near }: { title: string; items: Unclaimed[]; onOpen: (id: string) => void; near?: Place | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * (ref.current.clientWidth - 120), behavior: "smooth" });
  if (!items.length) return null;
  return (
    <section className="wrail">
      <div className="wrailhead">
        <h2>{title}</h2>
        <span className="wrailnav">
          <button type="button" aria-label="Back" onClick={() => scroll(-1)}>
            <Markup html={ICONS.back} />
          </button>
          <button type="button" aria-label="More" onClick={() => scroll(1)} className="flip">
            <Markup html={ICONS.back} />
          </button>
        </span>
      </div>
      <div className="wrailrow" ref={ref}>
        {items.slice(0, 20).map((u) => <Card key={u.id} u={u} onOpen={onOpen} near={near} />)}
      </div>
    </section>
  );
}

export function WebHome({ onOpenApp, onOperators }: { onOpenApp: () => void; onOperators: () => void }) {
  const { state, setCat, setMetro, setNear, setDate, openRequest, dates } = useApp();
  const [q, setQ] = useState("");
  const [who, setWho] = useState(2);
  const [whereOpen, setWhereOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);
  const near = state.near;
  const [sort, setSort] = useState<SortId>("relevance");
  const [placeQ, setPlaceQ] = useState("");
  const [placeHits, setPlaceHits] = useState<Place[]>([]);
  const [locating, setLocating] = useState(false);
  const metro = metroById(state.metroId);
  const RADIUS_KM = 80;

  useEffect(() => {
    if (!whereOpen) return;
    const t = window.setTimeout(() => {
      searchPlaces(placeQ, near).then(setPlaceHits);
    }, 220);
    return () => window.clearTimeout(t);
  }, [placeQ, whereOpen]);

  const pickPlace = (p: Place) => {
    setNear(p);
    setWhereOpen(false);
    setPlaceQ("");
    if (sort === "relevance") setSort("distance");
  };
  const useMyLocation = async () => {
    setLocating(true);
    const pt = await currentLocation();
    setLocating(false);
    if (!pt) return;
    pickPlace({ label: "Near me", sub: "Current location", lat: pt.lat, lon: pt.lon });
  };

  const pool = useMemo(() => {
    let base = getCatalog();
    if (near) {
      base = base
        .filter((u) => u.lat != null && u.lon != null && kmBetween(near, { lat: u.lat, lon: u.lon }) <= RADIUS_KM)
        .sort((a, b) => kmBetween(near, { lat: a.lat!, lon: a.lon! }) - kmBetween(near, { lat: b.lat!, lon: b.lon! }));
    } else if (state.metroId !== ALL_METRO_ID) {
      base = base.filter((u) => u.metroId === state.metroId);
    }
    return q.trim() ? searchListings(base, q) : base;
  }, [state.metroId, q, state.catalogVersion, near]);

  // A flat, sorted grid replaces the rails whenever the guest picks an order. Nearest needs a place to measure from.
  const sorted = useMemo(() => {
    if (sort === "relevance") return null;
    const list = pool.slice();
    if (sort === "distance") {
      if (!near) return null;
      list.sort((a, b) => kmBetween(near, { lat: a.lat!, lon: a.lon! }) - kmBetween(near, { lat: b.lat!, lon: b.lon! }));
    } else if (sort === "price") {
      list.sort((a, b) => (fromPrice(a) ?? Infinity) - (fromPrice(b) ?? Infinity));
    } else if (sort === "rating") {
      list.sort((a, b) => (publicRating(b)?.rating ?? 0) - (publicRating(a)?.rating ?? 0) || (b.reviews || 0) - (a.reviews || 0));
    }
    return list;
  }, [pool, sort, near]);

  const rails = RAIL_KINDS.filter((r) => state.cat === "all" || CATS.find((c) => c.id === state.cat) && pool.some((u) => u.art === r.art && u.cat === state.cat));
  const where = near ? near.label + (near.sub ? ", " + near.sub.split(",")[0] : "") : metro ? metro.name + ", " + metro.region : "Anywhere";
  const catName = (id: CategoryId) => CATS.find((c) => c.id === id)?.name || "All";

  return (
    <div className="web" onClick={() => { if (whereOpen) setWhereOpen(false); }}>
      <header className="whead">
        <div className="wwrap whead-in">
          <a className="wlogo" href="#" onClick={(e) => { e.preventDefault(); setCat("all"); setQ(""); }}>
            <Mark size={30} />
            <b>Outset</b>
          </a>
          <nav className="wtabs">
            {CATS.map((c) => (
              <button type="button" key={c.id} aria-pressed={state.cat === c.id} onClick={() => setCat(c.id)}>
                <Markup html={ICONS[c.icon]} />
                <span>{c.name}</span>
              </button>
            ))}
          </nav>
          <div className="wright">
            <button type="button" className="wlink" onClick={onOperators}>For operators</button>
            <button type="button" className="wghost" onClick={onOpenApp}>Open the app</button>
            <span className="wavatar">HS</span>
          </div>
        </div>
      </header>

      <div className="wsearchbar">
        <div className="wsearch">
          <div className="wfield" onClick={() => { setWhereOpen(true); setWhenOpen(false); setWhoOpen(false); }}>
            <small>Where</small>
            {whereOpen ? (
              <input
                autoFocus
                className="wplaceq"
                value={placeQ}
                placeholder="City, beach, lake, neighbourhood…"
                onChange={(e) => setPlaceQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && placeHits[0]) pickPlace(placeHits[0]);
                  if (e.key === "Escape") setWhereOpen(false);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <b>{where}</b>
            )}
            {whereOpen ? (
              <div className="wpop wplaces" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="wloc" onClick={useMyLocation} disabled={locating}>
                  <Markup html={ICONS.nav} />
                  {locating ? "Finding you…" : "Use my current location"}
                </button>
                {placeHits.map((p) => (
                  <button type="button" key={p.label + p.sub} onClick={() => pickPlace(p)}>
                    <Markup html={ICONS.pin} />
                    <span><b>{p.label}</b>{p.sub ? <small>{p.sub}</small> : null}</span>
                  </button>
                ))}
                {!placeQ.trim() ? (
                  <>
                    <p className="wpophead">Popular areas</p>
                    <button type="button" className={!near && state.metroId === ALL_METRO_ID ? "on" : ""} onClick={() => { setNear(null); setMetro(ALL_METRO_ID); setWhereOpen(false); }}>
                      <span><b>Anywhere</b><small>US and Canada</small></span>
                    </button>
                    {METROS.slice(0, 12).map((m) => (
                      <button type="button" key={m.id} className={!near && state.metroId === m.id ? "on" : ""} onClick={() => { setNear(null); setMetro(m.id); setWhereOpen(false); }}>
                        <span><b>{m.name}</b><small>{m.region}</small></span>
                      </button>
                    ))}
                  </>
                ) : placeHits.length === 0 ? (
                  <p className="wpophead">Keep typing, or try a bigger town nearby.</p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="wfield" onClick={() => { setWhenOpen((v) => !v); setWhereOpen(false); setWhoOpen(false); }}>
            <small>When</small>
            <b>{fmtDate(dates[state.dateIdx])}</b>
            {whenOpen ? (
              <div className="wpop wdates" onClick={(e) => e.stopPropagation()}>
                {dates.slice(0, 14).map((d, i) => (
                  <button type="button" key={i} className={state.dateIdx === i ? "on" : ""} onClick={() => { setDate(i); setWhenOpen(false); }}>
                    {i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmtDate(d)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="wfield" onClick={() => { setWhoOpen((v) => !v); setWhereOpen(false); setWhenOpen(false); }}>
            <small>Who</small>
            <b>{who} {who === 1 ? "guest" : "guests"}</b>
            {whoOpen ? (
              <div className="wpop wwho" onClick={(e) => e.stopPropagation()}>
                <span>Guests</span>
                <span className="stepper">
                  <button type="button" onClick={() => setWho(Math.max(1, who - 1))}>−</button>
                  <span className="n">{who}</span>
                  <button type="button" onClick={() => setWho(Math.min(12, who + 1))}>+</button>
                </span>
              </div>
            ) : null}
          </div>
          <div className="wfield wq">
            <small>What</small>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jet ski, skydive, sunset sail…" />
          </div>
          <button type="button" className="wgo" aria-label="Search">
            <Markup html={ICONS.search} />
          </button>
        </div>
      </div>

      <main className="wwrap">
        {state.catalogReady ? (
          <div className="wsortbar">
            <span className="wsortlabel">Sort by</span>
            {SORTS.map((o) => (
              <button
                type="button"
                key={o.id}
                aria-pressed={sort === o.id}
                onClick={() => {
                  if (o.id === "distance" && !near) {
                    setWhereOpen(true);
                    return;
                  }
                  setSort(o.id);
                }}
              >
                {o.label}
              </button>
            ))}
            {near ? <span className="wsortnear"><Markup html={ICONS.pin} /> Distances from {near.label}</span> : <span className="wsortnear muted">Pick a place under Where to see how far each one is</span>}
          </div>
        ) : null}
        {!state.catalogReady ? (
          <>
            {[0, 1].map((r) => (
              <section className="wrail" key={r}>
                <div className="wrailhead"><span className="skel skeltitle" /></div>
                <div className="wrailrow">
                  {Array.from({ length: 7 }, (_, i) => (
                    <div className="wcard" key={i}>
                      <div className="wart skel" />
                      <div className="wbody"><span className="skel skelline" /><span className="skel skelline short" /></div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : null}
        {state.catalogReady && sorted ? (
          <section className="wrail">
            <div className="wrailhead">
              <h2>
                {sorted.length.toLocaleString()} {state.cat === "all" ? "experiences" : catName(state.cat).toLowerCase() + " experiences"}
                {q.trim() ? ` for “${q.trim()}”` : ""}
                {sort === "distance" && near ? `, nearest to ${near.label} first` : sort === "price" ? ", cheapest first" : sort === "rating" ? ", top rated first" : ""}
              </h2>
            </div>
            <div className="wgrid">
              {sorted.slice(0, 60).map((u) => <Card key={u.id} u={u} onOpen={openRequest} near={near} />)}
            </div>
            {sorted.length === 0 ? <div className="wempty"><b>Nothing here yet.</b><p>Try a wider area or another category.</p></div> : null}
          </section>
        ) : null}
        {state.catalogReady && !sorted && q.trim() ? (
          <Rail title={`${pool.length} results for “${q.trim()}”${near ? " near " + near.label : metro ? " in " + metro.name : ""}`} items={near ? pool : rankForRail(pool)} onOpen={openRequest} near={near} />
        ) : null}
        {state.catalogReady && !sorted ? rails.map((r) => {
          const items = rankForRail(pool.filter((u) => u.art === r.art));
          const title = near ? `${r.title} near ${near.label}` : metro ? `${r.title} in ${metro.name}` : `Popular ${r.title.toLowerCase()}`;
          return <Rail key={r.art} title={title} items={items} onOpen={openRequest} near={near} />;
        }) : null}
        {state.catalogReady && !sorted && !rails.length ? (
          <div className="wempty">
            <b>Nothing in {catName(state.cat)} here yet.</b>
            <p>Try Anywhere, or another category. {CATMETA[state.cat]?.emptyBody || ""}</p>
          </div>
        ) : null}
      </main>

      <footer className="wfoot">
        <div className="wwrap">
          <span>Outset · Book the jump. Skip the call.</span>
          <span>{getCatalog().length.toLocaleString()} operators across the US and Canada</span>
        </div>
      </footer>
    </div>
  );
}
