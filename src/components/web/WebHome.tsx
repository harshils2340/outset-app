import { useMemo, useRef, useState } from "react";
import { CATS, CATMETA } from "../../data/categories";
import { ART_LABEL } from "../../data/art";
import { ICONS } from "../../data/icons";
import { ALL_METRO_ID, METROS, metroById } from "../../data/metros";
import type { ArtKind, CategoryId, Unclaimed } from "../../data/types";
import { fromPrice, getCatalog, publicRating } from "../../lib/catalog";
import { fmtDate, fmtReviews, money } from "../../lib/format";
import { searchListings } from "../../lib/search";
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

function Rail({ title, items, onOpen }: { title: string; items: Unclaimed[]; onOpen: (id: string) => void }) {
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
        {items.slice(0, 20).map((u) => {
          const from = fromPrice(u);
          const score = publicRating(u);
          const metro = metroById(u.metroId);
          return (
            <button type="button" className="wcard" key={u.id} onClick={() => onOpen(u.id)}>
              <div className="wart">
                <Photo src={u.cover} kind={u.art} id={"w" + u.id} alt={u.title} />
                {u.cover ? null : <span className="wkind">{ART_LABEL[u.art]}</span>}
              </div>
              <div className="wbody">
                <b>{u.title}</b>
                <small>{u.area}{metro && !u.area.includes(metro.name) ? " · " + metro.name : ""}</small>
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
        })}
      </div>
    </section>
  );
}

export function WebHome({ onOpenApp, onOperators }: { onOpenApp: () => void; onOperators: () => void }) {
  const { state, setCat, setMetro, setDate, openRequest, dates } = useApp();
  const [q, setQ] = useState("");
  const [who, setWho] = useState(2);
  const [whereOpen, setWhereOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);
  const metro = metroById(state.metroId);

  const pool = useMemo(() => {
    const inMetro = getCatalog().filter((u) => state.metroId === ALL_METRO_ID || u.metroId === state.metroId);
    return q.trim() ? searchListings(inMetro, q) : inMetro;
  }, [state.metroId, q, state.catalogVersion]);

  const rails = RAIL_KINDS.filter((r) => state.cat === "all" || CATS.find((c) => c.id === state.cat) && pool.some((u) => u.art === r.art && u.cat === state.cat));
  const where = metro ? metro.name + ", " + metro.region : "Anywhere";
  const catName = (id: CategoryId) => CATS.find((c) => c.id === id)?.name || "All";

  return (
    <div className="web">
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
          <div className="wfield" onClick={() => { setWhereOpen((v) => !v); setWhenOpen(false); setWhoOpen(false); }}>
            <small>Where</small>
            <b>{where}</b>
            {whereOpen ? (
              <div className="wpop" onClick={(e) => e.stopPropagation()}>
                <button type="button" className={state.metroId === ALL_METRO_ID ? "on" : ""} onClick={() => { setMetro(ALL_METRO_ID); setWhereOpen(false); }}>Anywhere</button>
                {METROS.map((m) => (
                  <button type="button" key={m.id} className={state.metroId === m.id ? "on" : ""} onClick={() => { setMetro(m.id); setWhereOpen(false); }}>
                    {m.name}, {m.region}
                  </button>
                ))}
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
        {q.trim() ? (
          <Rail title={`${pool.length} results for “${q.trim()}”${metro ? " in " + metro.name : ""}`} items={rankForRail(pool)} onOpen={openRequest} />
        ) : null}
        {rails.map((r) => {
          const items = rankForRail(pool.filter((u) => u.art === r.art));
          const title = metro ? `${r.title} in ${metro.name}` : `Popular ${r.title.toLowerCase()}`;
          return <Rail key={r.art} title={title} items={items} onOpen={openRequest} />;
        })}
        {!rails.length ? (
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
