import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CATS, CATMETA } from "../../data/categories";
import { ART_LABEL } from "../../data/art";
import { ICONS } from "../../data/icons";
import { ALL_METRO_ID, METROS, metroById } from "../../data/metros";
import type { ArtKind, CategoryId, Unclaimed } from "../../data/types";
import { fromPrice, getCatalog, publicRating } from "../../lib/catalog";
import { listingFacts } from "../../lib/catalog";
import { fmtDate, fmtReviews, money } from "../../lib/format";
import { metroInQuery, parseIntent, searchListings } from "../../lib/search";
import { loadListing } from "../../lib/catalogLoad";
import { currentLocation, fmtDistance, nearestLocation, searchPlaces, type Place } from "../../lib/places";
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
  { art: "bowling", title: "Bowling" },
  { art: "minigolf", title: "Mini golf" },
  { art: "arcade", title: "Arcades" },
  { art: "trampoline", title: "Trampoline parks" },
  { art: "lasertag", title: "Laser tag" },
  { art: "icerink", title: "Ice skating" },
  { art: "waterpark", title: "Water parks" },
  { art: "themepark", title: "Theme parks" },
  { art: "zoo", title: "Zoos and wildlife parks" },
  { art: "aquarium", title: "Aquariums" },
  { art: "karaoke", title: "Karaoke rooms" },
  { art: "climbing", title: "Climbing gyms" },
  { art: "range", title: "Shooting ranges" },
  { art: "archery", title: "Archery" },
  { art: "golf", title: "Golf tee times" },
  { art: "zipline", title: "Ziplines" },
  { art: "ski", title: "Ski and snowboard" },
  { art: "bike", title: "Bike and e-bike rentals" },
  { art: "snowmobile", title: "Snowmobile tours" },
  { art: "rafting", title: "Whitewater rafting" },
  { art: "scuba", title: "Scuba and snorkel" },
  { art: "surf", title: "Surf lessons" },
  { art: "paragliding", title: "Paragliding" },
  { art: "gliding", title: "Glider flights" },
  { art: "brewery", title: "Breweries" },
  { art: "winery", title: "Wineries" },
  { art: "distillery", title: "Distilleries" },
  { art: "cooking", title: "Cooking classes" },
  { art: "spa", title: "Spas and massage" },
  { art: "yoga", title: "Yoga" },
  { art: "dance", title: "Dance classes" },
  { art: "pottery", title: "Pottery and art classes" },
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

/** Up to three listings a guest wants side by side. */
const CompareCtx = createContext<{ ids: string[]; toggle: (id: string) => void }>({ ids: [], toggle: () => {} });

const INTENT_CHIPS = ["Birthday ideas", "With kids", "Date night", "Adrenaline", "Rainy day", "Sunset", "Under $50", "Team outing"];

type SortId = "relevance" | "distance" | "price" | "rating";
const SORTS: { id: SortId; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "distance", label: "Nearest" },
  { id: "price", label: "Price: low to high" },
  { id: "rating", label: "Top rated" },
];

function CompareToggle({ id }: { id: string }) {
  const { ids, toggle } = useContext(CompareCtx);
  const on = ids.includes(id);
  return (
    <span
      role="button"
      tabIndex={0}
      className={"wcompare" + (on ? " on" : "")}
      onClick={(e) => { e.stopPropagation(); toggle(id); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); toggle(id); } }}
    >
      {on ? "✓ Comparing" : "+ Compare"}
    </span>
  );
}

function CompareTable({ items, near, onOpen, onClose, onRemove }: { items: Unclaimed[]; near?: Place | null; onOpen: (id: string) => void; onClose: () => void; onRemove: (id: string) => void }) {
  const { touchCatalog } = useApp();
  useEffect(() => {
    Promise.all(items.map((u) => loadListing(u.id))).then((r) => r.some(Boolean) && touchCatalog());
  }, [items.map((u) => u.id).join(",")]);
  const row = (label: string, cell: (u: Unclaimed) => React.ReactNode) => (
    <tr key={label}>
      <th>{label}</th>
      {items.map((u) => <td key={u.id}>{cell(u)}</td>)}
    </tr>
  );
  const firstPriced = (u: Unclaimed) => u.options.find((o) => o.price != null);
  return (
    <div className="wcmpmodal" onClick={onClose}>
      <div className="wcmpbox" onClick={(e) => e.stopPropagation()}>
        <div className="wcmphead">
          <h2>Compare</h2>
          <button type="button" className="wghost" onClick={onClose}>Close</button>
        </div>
        <table className="wcmp">
          <thead>
            <tr>
              <th />
              {items.map((u) => (
                <th key={u.id}>
                  <div className="wcmpart"><Photo src={u.cover} kind={u.art} id={"c" + u.id} alt={u.title} /></div>
                  <b>{u.title}</b>
                  <button type="button" className="wcmpremove" onClick={() => onRemove(u.id)}>Remove</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row("From", (u) => { const f = fromPrice(u); return f != null ? <b>{money(f)}</b> : <span className="muted">Request to book</span>; })}
            {row("Rating", (u) => { const sc = publicRating(u); return sc ? <span><Markup html={ICONS.star} /> {sc.rating.toFixed(1)} <em className="muted">({fmtReviews(sc.reviews)})</em></span> : <span className="muted">No public rating</span>; })}
            {row("Where", (u) => { const n = near ? nearestLocation(u, near) : null; return n ? n.label + " · " + fmtDistance(n.km) + " away" : u.area; })}
            {row("What you'd book", (u) => { const o = firstPriced(u) || u.options[0]; return o ? o.name + (o.detail ? " · " + o.detail : "") : <span className="muted">Menu not published</span>; })}
            {row("Options", (u) => u.options.length ? u.options.length + (u.options.length === 1 ? " option" : " options") : <span className="muted">None listed</span>)}
            {row("Who can go", (u) => { const f = listingFacts(u).who.find((l) => l.posted); return f ? f.text : <span className="muted">Not posted</span>; })}
            {row("Included", (u) => u.includes.length ? u.includes.slice(0, 3).join(", ") : <span className="muted">Not posted</span>)}
            {row("Photos", (u) => (u.photos?.length || (u.cover ? 1 : 0)) + "")}
            {row("", (u) => <button type="button" className="cta small" onClick={() => onOpen(u.id)}>View and book</button>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
                <CompareToggle id={u.id} />
              </div>
              <div className="wbody">
                <b>{u.title}</b>
                <small>
                  {(() => {
                    const n = near ? nearestLocation(u, near) : null;
                    if (n) return fmtDistance(n.km) + " away · " + n.label + (u.locations?.length ? " · " + (u.locations.length + 1) + " locations" : "");
                    return u.area + (metro && !u.area.includes(metro.name) ? " · " + metro.name : "") + (u.locations?.length ? " · " + (u.locations.length + 1) + " locations" : "");
                  })()}
                </small>
                {u.dur || u.fc ? (
                  <small className="wcardfacts">
                    {u.dur ? <span>{u.dur}</span> : null}
                    {u.fc ? <span className="fc">Free cancellation</span> : null}
                  </small>
                ) : null}
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
  // Eight cards render up front; the rest mount once the rail is scrolled or paged, so a page of 14 rails
  // does not fetch 280 photos before anyone touches it.
  const [shown, setShown] = useState(8);
  const reveal = () => setShown(20);
  const scroll = (dir: number) => {
    reveal();
    ref.current?.scrollBy({ left: dir * (ref.current.clientWidth - 120), behavior: "smooth" });
  };
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
      <div className="wrailrow" ref={ref} onScroll={shown < 20 ? reveal : undefined}>
        {items.slice(0, shown).map((u) => <Card key={u.id} u={u} onOpen={onOpen} near={near} />)}
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
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const toggleCompare = (id: string) => setCompareIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? [...cur.slice(1), id] : [...cur, id]));
  const intent = useMemo(() => parseIntent(q), [q]); // intent words survive place stripping
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

  // A city typed into What ("axe throwing denver") beats the Where setting.
  const typedMetro = useMemo(() => (q.trim() ? metroInQuery(q) : null), [q]);
  const qWithoutPlace = useMemo(() => {
    if (!typedMetro) return q;
    const drop = new Set(typedMetro.words);
    return q.split(/\s+/).filter((w) => !drop.has(w.toLowerCase().replace(/[^a-z0-9]+/g, ""))).join(" ");
  }, [q, typedMetro]);
  const pool = useMemo(() => {
    let base = getCatalog();
    if (typedMetro) {
      base = base.filter((u) => u.metroId === typedMetro.metro.id);
    } else if (near) {
      const km = (u: Unclaimed) => nearestLocation(u, near)?.km ?? Infinity;
      base = base.filter((u) => km(u) <= RADIUS_KM).sort((a, b) => km(a) - km(b));
    } else if (state.metroId !== ALL_METRO_ID) {
      base = base.filter((u) => u.metroId === state.metroId);
    }
    return qWithoutPlace.trim() ? searchListings(base, qWithoutPlace) : base;
  }, [state.metroId, q, qWithoutPlace, typedMetro, state.catalogVersion, near]);

  // A flat, sorted grid replaces the rails whenever the guest picks an order. Nearest needs a place to measure from.
  const sorted = useMemo(() => {
    if (sort === "relevance") return null;
    const list = pool.slice();
    if (sort === "distance") {
      if (!near) return null;
      list.sort((a, b) => (nearestLocation(a, near)?.km ?? Infinity) - (nearestLocation(b, near)?.km ?? Infinity));
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
    <CompareCtx.Provider value={{ ids: compareIds, toggle: toggleCompare }}>
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
        {state.catalogReady && !q.trim() && sort === "relevance" ? (
          <div className="whow">
            <div><b>The whole price</b><span>The price you see is the price you pay. Fuel, deposit, bait and tip rules are on the listing, not at the dock.</span></div>
            <div><b>The rules before the drive</b><span>Weight limits, minimum ages, private or shared, and what happens if it rains, all on the page before you book.</span></div>
            <div><b>Someone answers</b><span>Book a real slot in three taps, or ask Otto anything and get an answer from the operator's own information.</span></div>
          </div>
        ) : null}
        {state.catalogReady ? (
          <div className="wintents">
            {INTENT_CHIPS.map((c) => (
              <button type="button" key={c} aria-pressed={q.trim().toLowerCase() === c.toLowerCase()} onClick={() => setQ(q.trim().toLowerCase() === c.toLowerCase() ? "" : c)}>
                {c}
              </button>
            ))}
          </div>
        ) : null}
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
          <section className="wrail">
            <div className="wrailhead">
              <h2>
                {intent.label ? intent.label : `Results for “${qWithoutPlace.trim() || q.trim()}”`}
                {typedMetro ? " in " + typedMetro.metro.name : near ? " near " + near.label : metro ? " in " + metro.name : ""}
                <em className="wcount">{pool.length.toLocaleString()}</em>
              </h2>
            </div>
            {intent.label ? <p className="wsecsub">{intent.kids ? "Only places whose published rules allow younger kids. " : ""}{intent.maxPrice != null ? "Starting price at or under $" + intent.maxPrice + ". " : ""}Best fit first, then rating and reviews. Add up to three to compare.</p> : null}
            <div className="wgrid">
              {(near ? pool : pool).slice(0, 60).map((u) => <Card key={u.id} u={u} onOpen={openRequest} near={near} />)}
            </div>
            {pool.length === 0 ? (
              <div className="wempty">
                <b>Nothing for this{typedMetro ? " in " + typedMetro.metro.name : near ? " near " + near.label : metro ? " in " + metro.name : ""} yet.</b>
                <p>Try a wider area, fewer words, or one of the ideas above.{typedMetro || near || metro ? " " : ""}{typedMetro || near || metro ? <button type="button" className="wlink" onClick={() => { setNear(null); setMetro(ALL_METRO_ID); if (typedMetro) setQ(qWithoutPlace.trim()); }}>Search everywhere</button> : null}</p>
              </div>
            ) : null}
          </section>
        ) : null}
        {state.catalogReady && !sorted && !q.trim() ? rails.map((r) => {
          const items = rankForRail(pool.filter((u) => u.art === r.art));
          const title = near ? `${r.title} near ${near.label}` : metro ? `${r.title} in ${metro.name}` : `Popular ${r.title.toLowerCase()}`;
          return <Rail key={r.art} title={title} items={items} onOpen={openRequest} near={near} />;
        }) : null}
        {state.catalogReady && !sorted && !q.trim() && !rails.length ? (
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
      {compareIds.length ? (
        <div className="wcmptray">
          <span className="wcmptrayitems">
            {compareIds.map((id) => { const u = getCatalog().find((x) => x.id === id); return u ? <span key={id} className="wcmpchip"><b>{u.title}</b><button type="button" aria-label="Remove" onClick={() => toggleCompare(id)}>×</button></span> : null; })}
          </span>
          <span className="wcmptrayactions">
            <button type="button" className="wghost" onClick={() => setCompareIds([])}>Clear</button>
            <button type="button" className="cta small" disabled={compareIds.length < 2} onClick={() => setCompareOpen(true)}>Compare {compareIds.length}</button>
          </span>
        </div>
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
