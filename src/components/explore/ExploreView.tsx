import { useState, type KeyboardEvent } from "react";
import { ART_LABEL } from "../../data/art";
import { CATS, CATMETA } from "../../data/categories";
import { ALL_METRO_ID, metroById, metroShort } from "../../data/metros";
import type { CategoryId, Unclaimed } from "../../data/types";
import { ICONS } from "../../data/icons";
import { getCatalog } from "../../lib/catalog";
import { searchListings, searchMetros } from "../../lib/search";
import { useApp } from "../../state/AppProvider";
import { Art } from "../art/Art";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";
import { UnclaimedCard } from "./UnclaimedCard";

function groupRails(list: Unclaimed[]): { id: CategoryId; title: string; items: Unclaimed[] }[] {
  return CATS.filter((c) => c.id !== "all")
    .map((c) => ({
      id: c.id,
      title: CATMETA[c.id].railTitle,
      items: list.filter((u) => u.cat === c.id),
    }))
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

export function ExploreView() {
  const { state, setCat, setQ, setMetro, setTab, openMetro, openRequest } = useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [hit, setHit] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const q = state.q.trim();
  const meta = CATMETA[state.cat] || CATMETA.all;
  const inMetro = getCatalog().filter((u) => state.metroId === ALL_METRO_ID || u.metroId === state.metroId);
  const ranked = q ? searchListings(inMetro, q) : inMetro;
  const list = ranked.filter((u) => state.cat === "all" || u.cat === state.cat);
  const previewList = (q ? searchListings(inMetro, q) : []).slice(0, 8);
  const previewMetros = q.length >= 2 ? searchMetros(q) : [];
  const showPreview = searchOpen && q.length > 0;
  const metroHits = previewMetros.length;
  const totalHits = metroHits + previewList.length;

  const emptyTitle = inMetro.length === 0 ? "Nothing in this city yet" : meta.emptyTitle;
  const emptyBody =
    inMetro.length === 0 ? "Try Anywhere, or pick a city with listings." : meta.emptyBody;
  const rails = groupRails(list);
  const manyRails = rails.length > 1;

  function pickListing(id: string) {
    setSearchOpen(false);
    openRequest(id);
  }

  function pickMetro(id: string) {
    setMetro(id);
    setQ("");
    setSearchOpen(false);
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!showPreview || !totalHits) {
      if (e.key === "Escape") (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHit((i) => Math.min(totalHits - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHit((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hit < metroHits) pickMetro(previewMetros[hit].id);
      else pickListing(previewList[hit - metroHits].id);
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
              {previewMetros.map((m, i) => (
                <button
                  type="button"
                  key={m.id}
                  className={"searchhit" + (hit === i ? " on" : "")}
                  onClick={() => pickMetro(m.id)}
                  onMouseEnter={() => setHit(i)}
                >
                  <span className="searchico">
                    <Markup html={ICONS.pin} />
                  </span>
                  <span className="searchmeta">
                    <b>{m.name}</b>
                    <small>
                      {m.region}, {m.country === "CA" ? "Canada" : "United States"}
                    </small>
                  </span>
                </button>
              ))}
              {previewList.map((u, i) => {
                const idx = metroHits + i;
                const metro = metroById(u.metroId);
                return (
                  <button
                    type="button"
                    key={u.id}
                    className={"searchhit" + (hit === idx ? " on" : "")}
                    onClick={() => pickListing(u.id)}
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
              {!totalHits ? (
                <div className="searchempty">No matches for &quot;{q}&quot;</div>
              ) : (
                <div className="searchhint">
                  {list.length} in the feed
                  {state.cat !== "all" ? " · " + meta.railTitle : ""}
                </div>
              )}
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
              {list.length} {meta.head}
            </h2>
          </div>
          {rails.map((rail) => (
            <section key={rail.id} className="railblock">
              {manyRails ? (
                <div className="railhead">
                  <button type="button" className="railtitle" onClick={() => setCat(rail.id)}>
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
                    <button type="button" className="railmore" onClick={() => setCat(rail.id)}>
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
        </div>
      )}
      <div className="spacer" />
    </>
  );
}
