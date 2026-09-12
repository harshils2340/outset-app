import { useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ART_LABEL } from "../../data/art";
import { CATS, CATMETA, VIRTUAL_CATS, inCat } from "../../data/categories";
import { ALL_METRO_ID, metroById, metroShort } from "../../data/metros";
import type { CategoryId, Unclaimed } from "../../data/types";
import { ICONS } from "../../data/icons";
import { getCatalog } from "../../lib/catalog";
import { ART_ALIASES, metroInQuery, searchSuggest, warmSearch, type SearchScope } from "../../lib/search";
import { useApp } from "../../state/AppProvider";
import { Art } from "../art/Art";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";
import { UnclaimedCard } from "./UnclaimedCard";

type FeedRail = { id: string; title: string; items: Unclaimed[]; open: () => void };

/**
 * All: one rail per catalog category (Classes and Culture are cuts of those, so they are not repeated here).
 * A Classes or Culture tab: one rail per kind, since its listings span several catalog categories.
 */
function groupRails(list: Unclaimed[], cat: CategoryId, setCat: (c: CategoryId) => void, setQ: (q: string) => void): FeedRail[] {
  const kinds = VIRTUAL_CATS[cat];
  if (kinds) {
    return kinds
      .map((art) => ({ id: art, title: ART_LABEL[art], items: list.filter((u) => u.art === art), open: () => setQ(ART_ALIASES[art]?.[0] || art) }))
      .filter((r) => r.items.length > 0);
  }
  return CATS.filter((c) => c.id !== "all" && !VIRTUAL_CATS[c.id])
    .map((c) => ({ id: c.id, title: CATMETA[c.id].railTitle, items: list.filter((u) => inCat(u, c.id)), open: () => setCat(c.id) }))
    .filter((r) => r.items.length > 0);
}

/** Cards rendered per rail before "Show more". Keeps the feed fast with thousands of operators. */
const PAGE = 48;
const RAIL_CAP = 24;

function rowChunks<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return [items];
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** Idle time if the browser offers it, the next tick if it does not. */
function whenIdle(run: () => void): void {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run);
  else window.setTimeout(run, 50);
}

export function ExploreView() {
  const { state, setCat, setQ, setMetro, setTab, openMetro, openRequest } = useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [hit, setHit] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const q = state.q.trim();
  const meta = CATMETA[state.cat] || CATMETA.all;
  const catalog = getCatalog();

  // The word index over 55,000 operators is built in idle time once the catalog lands, so the first keystroke
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

  // Typing stays smooth: the catalog is searched from a query that may lag a keystroke behind when the thread is busy.
  const dq = useDeferredValue(q);
  const scope = useMemo<SearchScope>(() => ({ metroId: state.metroId, cat: state.cat }), [state.metroId, state.cat]);
  const browse = useMemo(
    () => catalog.filter((u) => (state.metroId === ALL_METRO_ID || u.metroId === state.metroId) && inCat(u, state.cat)),
    [catalog, state.metroId, state.cat],
  );
  // One pass feeds the dropdown and the feed behind it, so a keystroke ranks the catalog once.
  const found = useMemo(() => (dq ? searchSuggest(catalog, dq, scope) : null), [catalog, dq, scope]);
  const cityEmpty = useMemo(
    () => state.metroId !== ALL_METRO_ID && !catalog.some((u) => u.metroId === state.metroId),
    [catalog, state.metroId],
  );

  const list = found ? found.results : browse;
  const activities = found?.activities ?? [];
  const operators = found?.operators ?? [];
  const places = found?.places ?? [];
  const rows = activities.length + operators.length + places.length;
  const showPreview = searchOpen && q.length > 0;
  const here = state.metroId === ALL_METRO_ID ? "" : " in " + metroShort(state.metroId);

  const emptyTitle = cityEmpty ? "Nothing in this city yet" : q ? "Nothing for “" + q + "”" : meta.emptyTitle;
  const emptyBody = cityEmpty ? "Try Anywhere, or pick a city with listings." : meta.emptyBody;
  const rails = groupRails(list, state.cat, setCat, setQ);
  const manyRails = rails.length > 1;

  function pickMetro(id: string) {
    // "kayak tampa" with Tampa picked becomes a kayak search in Tampa, not a search for the word "tampa".
    const named = metroInQuery(state.q);
    if (named && named.metro.id === id) {
      const drop = new Set(named.words);
      setQ(state.q.split(/\s+/).filter((w) => !drop.has(w.toLowerCase().replace(/[^a-z0-9]+/g, ""))).join(" ").trim());
    }
    setMetro(id);
    setSearchOpen(false);
    setHit(0);
  }

  function pickRow(i: number) {
    if (i < activities.length) {
      setQ(activities[i].query);
      setHit(0);
      return;
    }
    const o = i - activities.length;
    if (o < operators.length) {
      setSearchOpen(false);
      openRequest(operators[o].id);
      return;
    }
    pickMetro(places[o - operators.length].metro.id);
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!showPreview || !rows) {
      if (e.key === "Escape") (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHit((i) => Math.min(rows - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHit((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickRow(Math.min(hit, rows - 1));
    } else if (e.key === "Escape") {
      setSearchOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <>
      <div className="apphead">
        <div className="locrow">
          <div className="brand">
            <Mark size={22} />
            <b>Outset</b>
          </div>
          <button className="avatar" type="button" onClick={() => setTab("account")} aria-label="Profile">
            H
          </button>
        </div>
        <div className="searchwrap">
          <div className={"search" + (showPreview ? " on" : "")}>
            <Markup html={ICONS.search} />
            <input
              id="q"
              placeholder={meta.search}
              value={state.q}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setQ(e.target.value);
                setHit(0);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
              onKeyDown={onSearchKey}
            />
            <button
              className="wherechip"
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={openMetro}
            >
              <b>{metroShort(state.metroId)}</b>
              <Markup html={ICONS.chev} className="locchev" />
            </button>
            {state.q ? (
              <button
                type="button"
                className="searchclear"
                aria-label="Clear search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQ("");
                  setHit(0);
                }}
              >
                <Markup html={ICONS.close} />
              </button>
            ) : null}
          </div>
          {showPreview ? (
            <div className="searchpreview" onMouseDown={(e) => e.preventDefault()}>
              {found?.nearMiss ? (
                <div className="searchempty">
                  <b>
                    Nothing for “{q}”{here}.
                  </b>
                  <span>{rows || found.elsewhere.length ? "Closest in the catalog:" : "Try fewer words, or another city."}</span>
                </div>
              ) : null}
              {activities.length ? <p className="searchgroup">Activities</p> : null}
              {activities.map((a, i) => (
                <button
                  type="button"
                  key={a.art}
                  className={"searchhit" + (hit === i ? " on" : "")}
                  onClick={() => pickRow(i)}
                  onMouseEnter={() => setHit(i)}
                >
                  <span className="searchthumb">
                    <Art kind={a.art} id={"sa" + a.art} />
                  </span>
                  <span className="searchmeta">
                    <b>{a.label}</b>
                    <small>
                      {a.count} {a.count === 1 ? "place" : "places"}
                      {here}
                    </small>
                  </span>
                </button>
              ))}
              {operators.length ? <p className="searchgroup">Operators</p> : null}
              {operators.map((u, i) => {
                const idx = activities.length + i;
                const metro = metroById(u.metroId);
                return (
                  <button
                    type="button"
                    key={u.id}
                    className={"searchhit" + (hit === idx ? " on" : "")}
                    onClick={() => pickRow(idx)}
                    onMouseEnter={() => setHit(idx)}
                  >
                    <span className="searchthumb">
                      <Art kind={u.art} id={u.id + "s"} />
                    </span>
                    <span className="searchmeta">
                      <b>{u.title}</b>
                      <small>
                        {(ART_LABEL[u.art] ? ART_LABEL[u.art] + " · " : "") + u.area}
                        {metro ? " · " + metro.name : ""}
                      </small>
                    </span>
                  </button>
                );
              })}
              {places.length ? <p className="searchgroup">Places</p> : null}
              {places.map((pl, i) => {
                const idx = activities.length + operators.length + i;
                return (
                  <button
                    type="button"
                    key={pl.metro.id}
                    className={"searchhit" + (hit === idx ? " on" : "")}
                    onClick={() => pickRow(idx)}
                    onMouseEnter={() => setHit(idx)}
                  >
                    <span className="searchico">
                      <Markup html={ICONS.pin} />
                    </span>
                    <span className="searchmeta">
                      <b>{pl.metro.name}</b>
                      <small>
                        {pl.metro.region}, {pl.metro.country === "CA" ? "Canada" : "United States"} · {pl.count.toLocaleString()} places
                      </small>
                    </span>
                  </button>
                );
              })}
              {found && !found.nearMiss ? (
                <div className="searchhint">
                  {list.length.toLocaleString()} in the feed
                  {state.cat !== "all" ? " · " + meta.railTitle : ""}
                </div>
              ) : null}
              {(found?.elsewhere ?? []).map((a) => (
                <button
                  type="button"
                  key={a.art}
                  className="searchmore"
                  onClick={() => {
                    setMetro(ALL_METRO_ID);
                    setQ(a.query);
                  }}
                >
                  {a.label} anywhere · {a.count.toLocaleString()} places
                </button>
              ))}
              {found?.otherCats ? (
                <button type="button" className="searchmore" onClick={() => setCat("all")}>
                  {found.otherCats.toLocaleString()} more outside {meta.railTitle}. Show all categories
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="chipbar">
        {CATS.map((c) => (
          <button key={c.id} className="chip" aria-pressed={state.cat === c.id} onClick={() => setCat(c.id)}>
            <Markup html={ICONS[c.icon]} />
            {c.name}
          </button>
        ))}
      </div>
      {list.length ? (
        <>
          <div className="feedhead">
            <p className="eyebrow">{q ? "Matches" : meta.railTitle || "Near you"}</p>
            <h2>
              {list.length.toLocaleString()} {meta.head}
            </h2>
          </div>
          {rails.map((rail) => (
            <section key={rail.id} className="railblock">
              {manyRails ? (
                <div className="railhead">
                  <button type="button" className="railtitle" onClick={rail.open}>
                    <h2>{rail.title}</h2>
                  </button>
                  <span className="railcount">{rail.items.length}</span>
                </div>
              ) : null}
              {rowChunks(manyRails ? rail.items.slice(0, RAIL_CAP) : rail.items.slice(0, limit), manyRails ? RAIL_CAP : 6).map((row, i) => (
                <div className="rail" key={rail.id + "-" + i}>
                  {row.map((u) => (
                    <UnclaimedCard key={u.id} item={u} compact />
                  ))}
                  {manyRails && i === 0 && rail.items.length > RAIL_CAP ? (
                    <button type="button" className="railmore" onClick={rail.open}>
                      <b>See all {rail.items.length}</b>
                      <small>{rail.title}</small>
                    </button>
                  ) : null}
                </div>
              ))}
              {!manyRails && rail.items.length > limit ? (
                <button type="button" className="cta ghost showmore" onClick={() => setLimit((n) => n + PAGE)}>
                  Show more · {rail.items.length - limit} left
                </button>
              ) : null}
            </section>
          ))}
        </>
      ) : (
        <div className="empty">
          <div className="glyph">
            <Markup html={ICONS.search} />
          </div>
          <b>{emptyTitle}</b>
          <p>{emptyBody}</p>
          {found ? (
            <div className="emptyfix">
              {found.otherCats ? (
                <button type="button" className="cta ghost" onClick={() => setCat("all")}>
                  {found.otherCats.toLocaleString()} in other categories
                </button>
              ) : null}
              {state.metroId !== ALL_METRO_ID ? (
                <button type="button" className="cta ghost" onClick={() => setMetro(ALL_METRO_ID)}>
                  Search anywhere
                </button>
              ) : null}
              {activities.map((a) => (
                <button type="button" key={a.art} className="cta ghost" onClick={() => setQ(a.query)}>
                  {a.label} · {a.count.toLocaleString()}
                </button>
              ))}
              {found.elsewhere.map((a) => (
                <button
                  type="button"
                  key={a.art}
                  className="cta ghost"
                  onClick={() => {
                    setMetro(ALL_METRO_ID);
                    setQ(a.query);
                  }}
                >
                  {a.label} anywhere · {a.count.toLocaleString()}
                </button>
              ))}
              {places.map((pl) => (
                <button type="button" key={pl.metro.id} className="cta ghost" onClick={() => pickMetro(pl.metro.id)}>
                  {pl.metro.name} · {pl.count.toLocaleString()}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div className="spacer" />
    </>
  );
}
