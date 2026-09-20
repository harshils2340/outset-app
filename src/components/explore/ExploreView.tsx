import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CATS, CATMETA } from "../../data/categories";
import { ALL_METRO_ID, metroCoords, metroShort } from "../../data/metros";
import { ICONS } from "../../data/icons";
import { getCatalog, savedListings, stillArriving } from "../../lib/catalog";
import { dateKey } from "../../lib/dates";
import { mergeMapsHits, useMapsNearby } from "../../lib/mapsNearby";
import { searchSuggest, warmSearch, type SearchScope } from "../../lib/search";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";
import { IcFilters, IcHeart, IcSearch } from "./AirIcons";
import { UnclaimedCard } from "./UnclaimedCard";
import { applyFilters, atMetro, browseList, nearFirst, whatLabel } from "./feed";
import { activeFilterCount, clearFilters, setPrefs, usePrefs } from "./prefs";
import "../../styles/air-phone.css";
import { useDeadCovers, withPhotos } from "../../lib/deadCovers";

/** Cards mounted per page of the feed. More arrive as the guest nears the end, the way Airbnb's list does. */
const PAGE = 18;

/** Idle time if the browser offers it, the next tick if it does not. */
function whenIdle(run: () => void): void {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run);
  else window.setTimeout(run, 50);
}

export function ExploreView({ onAsk, onCloseAsk, asking }: { onAsk: () => void; onCloseAsk?: () => void; asking: boolean }) {
  const { state, dates, setCat, setQ, setMetro, openMetro } = useApp();
  const prefs = usePrefs();
  const [limit, setLimit] = useState(PAGE);
  const [scrolled, setScrolled] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const q = state.q.trim();
  const meta = CATMETA[state.cat] || CATMETA.all;
  const catalog = getCatalog();
  const filterCount = activeFilterCount(prefs.filters);

  // The word index over 55,000 operators is built in idle time once the catalog lands, so the first search
  // is not the one that pays for it.
  useEffect(() => {
    let live = true;
    const step = () => {
      if (live && !warmSearch(catalog)) whenIdle(step);
    };
    whenIdle(step);
    return () => {
      live = false;
    };
  }, [catalog]);

  const dq = useDeferredValue(q);
  const scope = useMemo<SearchScope>(() => {
    if (state.metroId === ALL_METRO_ID) return { cat: state.cat };
    return { cat: state.cat, keep: (u) => atMetro(u, state.metroId) };
  }, [state.metroId, state.cat]);
  const near = state.near;
  const browse = useMemo(() => browseList(catalog, state.cat, state.metroId, near), [catalog, state.metroId, state.cat, near]);
  const found = useMemo(() => (dq ? searchSuggest(catalog, dq, scope) : null), [catalog, dq, scope]);
  const mapsPin = near && !near.region
    ? { lat: near.lat, lon: near.lon }
    : (() => {
      if (state.metroId === ALL_METRO_ID) return null;
      const c = metroCoords(state.metroId);
      return c ? { lat: c.lat, lon: c.lng } : null;
    })();
  const mapsHits = useMapsNearby(dq, mapsPin?.lat ?? null, mapsPin?.lon ?? null);
  const cityEmpty = useMemo(
    () => state.metroId !== ALL_METRO_ID && !catalog.some((u) => atMetro(u, state.metroId)),
    [catalog, state.metroId],
  );
  const listed = useMemo(() => {
    const base = found ? mergeMapsHits(found.results, mapsHits) : browse;
    return applyFilters(found ? nearFirst(base, near) : base, prefs.filters);
  }, [found, mapsHits, browse, prefs.filters, near]);
  /**
   * Browse promises a photograph, so a listing whose cover turned out to be dead leaves the feed. Only browse:
   * a saved listing stays in Wishlists whatever happened to its picture, because the guest put it there.
   */
  const list = withPhotos(listed, useDeadCovers());

  // A new search, place, category or filter starts the list from the top.
  useEffect(() => {
    setLimit(PAGE);
    const view = document.getElementById("view");
    if (view && view.scrollTop > 140) view.scrollTop = 0;
  }, [dq, state.cat, state.metroId, near, prefs.filters, prefs.view]);

  // The header lifts off the feed with a shadow once the list scrolls under it.
  useEffect(() => {
    const view = document.getElementById("view");
    if (!view) return;
    const on = () => setScrolled(view.scrollTop > 4);
    on();
    view.addEventListener("scroll", on, { passive: true });
    return () => view.removeEventListener("scroll", on);
  }, []);

  // More cards as the end of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + PAGE);
      },
      { root: document.getElementById("view"), rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [list, limit]);

  const place = state.locating ? "Finding you…" : state.near ? (state.near.label === "Near me" ? "Near you" : state.near.label) : state.metroId === ALL_METRO_ID ? "" : metroShort(state.metroId);
  const whenDate = prefs.when ? dates.find((d) => dateKey(d) === prefs.when) : undefined;
  const whenLabel = whenDate ? whenDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Any week";
  const whoLabel = prefs.who ? prefs.who + (prefs.who === 1 ? " guest" : " guests") : "Add guests";
  // The pill reads place then activity, the two parts of the search: "Tampa · Parasailing" over "Any week · Add guests".
  const what = whatLabel(q);
  const pillTitle = q || place ? (place || "Anywhere") + " · " + (what || "Any activity") : "Where to?";
  const pillSub = (q || place ? [whenLabel, whoLabel] : ["Anywhere", whenLabel, whoLabel]).join(" · ");
  const here = state.near ? " near " + (state.near.label === "Near me" ? "you" : state.near.label) : state.metroId === ALL_METRO_ID ? "" : " in " + metroShort(state.metroId);

  const openSearch = () => {
    setPrefs({ sheetMode: "search" });
    openMetro();
  };
  const openFilters = () => {
    setPrefs({ sheetMode: "filters" });
    openMetro();
  };

  if (prefs.view === "wishlists") return <Wishlists saved={prefs.saved} complete={state.catalogComplete} />;

  if (!state.catalogReady || state.locating) {
    return (
      <div className="airexplore">
        <header className="airhead">
          <div className="airpillrow">
            <button type="button" className="airpill" onClick={openSearch} aria-label="Search">
              <IcSearch size={18} className="airpillico" />
              <span className="airpilltext">
                <b>{pillTitle}</b>
                <small>{pillSub}</small>
              </span>
            </button>
            <button type="button" className={"airask" + (asking ? " on" : "")} onClick={() => (asking ? onCloseAsk?.() : onAsk())} aria-pressed={asking} aria-label={asking ? "Back to browse" : "Ask"}>
              <Markup html={ICONS.spark} />
            </button>
            <button type="button" className="airfilter" onClick={openFilters} aria-label="Filters">
              <IcFilters size={16} />
            </button>
          </div>
          <nav className="aircats" aria-label="Categories">
            {CATS.map((c) => (
              <button key={c.id} type="button" className="aircat" aria-pressed={state.cat === c.id} onClick={() => setCat(c.id)}>
                <Markup html={ICONS[c.icon]} />
                <span>{c.name}</span>
              </button>
            ))}
          </nav>
        </header>
        <div className="airfeed" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="aircard" key={i}>
              <div className="aircardphoto skel" />
              <div className="aircardbody">
                <span className="skel skelline" />
                <span className="skel skelline short" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const emptyTitle = cityEmpty ? "Nothing in this city yet" : q ? "No exact matches" : filterCount ? "No exact matches" : meta.emptyTitle;
  const waysOut = !!found && (!!found.family || found.places.length > 0 || found.elsewhere.length > 0 || found.activities.length > 0 || found.otherCats > 0);
  const emptyBody = cityEmpty
    ? "Try Anywhere, or pick a city with listings."
    : q && waysOut
      ? "Nothing listed for that" + (here || "") + " yet. Here is the closest the catalog has."
      : q || filterCount
        ? "Try changing or removing some of your filters or adjusting your search area."
        : meta.emptyBody;

  return (
    <div className="airexplore">
      <header className={"airhead" + (scrolled ? " lifted" : "")}>
        <div className="airpillrow">
          <button type="button" className="airpill" onClick={openSearch} aria-label="Search">
            <IcSearch size={18} className="airpillico" />
            <span className="airpilltext">
              <b>{pillTitle}</b>
              <small>{pillSub}</small>
            </span>
          </button>
          {/*
            The one way in, in the row a guest's thumb is already on.

            At this width the app is already a phone, so the toggle has nothing to change about the UI: it
            opens the agent and that is all it ever does. Same control, same words, same meaning as on the
            wide site, which matters because a judge scanning a QR code and the laptop on stage are looking at
            the same product.
          */}
          <button type="button" className={"airask" + (asking ? " on" : "")} onClick={() => (asking ? onCloseAsk?.() : onAsk())} aria-pressed={asking} aria-label={asking ? "Back to browse" : "Ask"}>
            <Markup html={ICONS.spark} />
          </button>
          <button type="button" className={"airfilter" + (filterCount ? " on" : "")} onClick={openFilters} aria-label="Filters">
            <IcFilters size={16} />
            {filterCount ? <span className="airfiltercount">{filterCount}</span> : null}
          </button>
        </div>
        <nav className="aircats" aria-label="Categories">
          {CATS.map((c) => (
            <button key={c.id} type="button" className="aircat" aria-pressed={state.cat === c.id} onClick={() => setCat(c.id)}>
              <Markup html={ICONS[c.icon]} />
              <span>{c.name}</span>
            </button>
          ))}
        </nav>
      </header>

      {list.length ? (
        <>
          <p className="aircount">
            {q ? (
              <>
                {what}
                {here || " anywhere"} · {list.length.toLocaleString()}
              </>
            ) : (
              <>
                {list.length > 1000 ? "Over " + (Math.floor(list.length / 1000) * 1000).toLocaleString() : list.length.toLocaleString()}{" "}
                {list.length === 1 ? "experience" : "experiences"}
                {here}
              </>
            )}
          </p>
          <div className="airfeed">
            {list.slice(0, limit).map((u) => (
              <UnclaimedCard key={u.id} item={u} />
            ))}
          </div>
          {list.length > limit ? (
            <div ref={sentinel} className="airmore">
              <button type="button" className="airghost" onClick={() => setLimit((n) => n + PAGE)}>
                Show more
              </button>
            </div>
          ) : (
            <p className="airend">That's everything{here}.</p>
          )}
        </>
      ) : (
        <div className="airempty">
          {q ? (
            <p className="aircount">
              {what}
              {here || " anywhere"} · 0
            </p>
          ) : null}
          <h2>{emptyTitle}</h2>
          <p>{emptyBody}</p>
          <div className="airemptyfix">
            {filterCount ? (
              <button type="button" className="airghost" onClick={clearFilters}>
                Remove all filters
              </button>
            ) : null}
            {found?.otherCats ? (
              <button type="button" className="airghost" onClick={() => setCat("all")}>
                {found.otherCats.toLocaleString()} in other categories
              </button>
            ) : null}
            {state.metroId !== ALL_METRO_ID || state.near ? (
              <button type="button" className="airghost" onClick={() => setMetro(ALL_METRO_ID)}>
                Search anywhere
              </button>
            ) : null}
            {found?.family ? (
              <button
                type="button"
                className="airghost"
                onClick={() => {
                  setQ("");
                  setCat(found.family!.cat);
                }}
              >
                Browse {found.family.name}
                {here} · {found.family.count.toLocaleString()}
              </button>
            ) : null}
            {(found?.activities ?? []).map((a) => (
              <button type="button" key={a.art} className="airghost" onClick={() => setQ(a.query)}>
                {a.label} · {a.count.toLocaleString()}
              </button>
            ))}
            {(found?.elsewhere ?? []).map((a) => (
              <button
                type="button"
                key={a.art}
                className="airghost"
                onClick={() => {
                  setMetro(ALL_METRO_ID);
                  setQ(a.query);
                }}
              >
                {a.label} anywhere · {a.count.toLocaleString()}
              </button>
            ))}
            {(found?.places ?? []).map((pl) => (
              <button type="button" key={pl.metro.id} className="airghost" onClick={() => setMetro(pl.metro.id)}>
                {pl.metro.name} · {pl.count.toLocaleString()}
              </button>
            ))}
            {q ? (
              <button type="button" className="airghost" onClick={() => setQ("")}>
                Clear search
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Airbnb's Wishlists tab: everything the guest hearted, newest first, kept on this device.
 *
 * The saves outlive the page and the catalog does not: it is fetched after the first paint, and most
 * operators arrive only with the full file. Looking each id up and dropping what does not resolve meant a
 * guest who opened this tab on a cold start was told "Create your first wishlist" over a list of twelve, and
 * pressed "Start exploring" to get back the saves they already had. Say the list is still coming instead.
 */
function Wishlists({ saved, complete }: { saved: string[]; complete: boolean }) {
  const { items, missing } = savedListings(saved);
  // Nothing resolved yet and the catalog is still on its way: this is a list loading, not an empty one.
  if (stillArriving(missing, items.length, complete)) {
    return (
      <div className="airexplore">
        <header className="airpagehead">
          <h1>Wishlists</h1>
        </header>
        <div className="airpageempty">
          <IcHeart size={32} />
          <h2>Loading your {missing === 1 ? "saved place" : missing.toLocaleString() + " saved places"}</h2>
          <p>One moment while we look them up.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="airexplore">
      <header className="airpagehead">
        <h1>Wishlists</h1>
      </header>
      {items.length ? (
        <>
          <p className="airpagesub">
            {items.length} saved · on this device
          </p>
          <div className="airfeed">
            {items.map((u) => (
              <UnclaimedCard key={u.id} item={u} />
            ))}
          </div>
        </>
      ) : (
        <div className="airpageempty">
          <IcHeart size={32} />
          <h2>Create your first wishlist</h2>
          <p>As you search, tap the heart icon to save your favourite experiences to a wishlist.</p>
          <button type="button" className="airdark" onClick={() => setPrefs({ view: "feed" })}>
            Start exploring
          </button>
        </div>
      )}
    </div>
  );
}
