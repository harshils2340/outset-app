import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ART_LABEL } from "../../data/art";
import { ALL_METRO_ID, METROS, metroById, metroLabel, metroShort } from "../../data/metros";
import type { ArtKind } from "../../data/types";
import { getCatalog } from "../../lib/catalog";
import { dateKey } from "../../lib/dates";
import { currentLocation, searchPlaces, type Place } from "../../lib/places";
import { ART_ALIASES, WHAT_INTENTS, describeQuery, metroInQuery, searchMetros, searchSuggest, stripPlaceWords } from "../../lib/search";
import { useApp } from "../../state/AppProvider";
import { Art } from "../art/Art";
import { Photo } from "../art/Photo";
import { IcClose, IcGlobe, IcMinus, IcNavigate, IcPin, IcPlus, IcSearch } from "./AirIcons";
import { applyFilters, atMetro, browseList, feedFor, whatLabel } from "./feed";
import { getPrefs, setPrefs } from "./prefs";

const QTY_MAX = 8;

/**
 * The phone search sheet, Airbnb's stacked cards with Outset's four parts: Where (a place only), What (the activity,
 * occasion or business, counted inside that place), When and Who. Nothing applies until Search. Every count on a
 * suggestion is the length of the feed that suggestion opens.
 */

type PendingPlace = { kind: "metro"; id: string } | { kind: "near"; place: Place } | null;
type Step = "where" | "what" | "when" | "who";

const kindQuery = (art: ArtKind) => ART_ALIASES[art]?.[0] || art;

function countInMetro(metroId: string): number {
  if (metroId === ALL_METRO_ID) return getCatalog().length;
  return getCatalog().filter((u) => atMetro(u, metroId)).length;
}

export function SearchSheet() {
  const { state, dates, closeSheet, setQ, setCat, setMetro, setNear, openRequest } = useApp();
  const prefs = getPrefs();
  const [step, setStep] = useState<Step>("where");
  const [text, setText] = useState("");
  const [what, setWhat] = useState<string>(state.q);
  const [where, setWhere] = useState<PendingPlace>(null);
  const [when, setWhen] = useState<string | null>(prefs.when && dates.some((d) => dateKey(d) === prefs.when) ? prefs.when : null);
  const [who, setWho] = useState<number | null>(prefs.who);
  const [hits, setHits] = useState<Place[]>([]);
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | null>(null);
  const whatRef = useRef<HTMLInputElement>(null);
  const needle = text.trim();
  const catalog = getCatalog();

  // Any town, beach or postcode, not just the metros. Same place search the desktop uses.
  useEffect(() => {
    if (needle.length < 3) {
      setHits([]);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      void searchPlaces(needle, state.near).then((r) => live && setHits(r));
    }, 220);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [needle, state.near]);

  useEffect(() => {
    if (step === "what") window.setTimeout(() => whatRef.current?.focus(), 0);
  }, [step]);

  const seeded = useMemo(() => METROS.map((m) => ({ m, n: countInMetro(m.id) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n), [state.catalogVersion]);

  // The place the sheet is about to search: the one picked here, else the feed's current one.
  const whatTyped = what.trim();
  const typedMetro = useMemo(() => (whatTyped ? metroInQuery(whatTyped) : null), [whatTyped]);
  const whatRest = typedMetro ? stripPlaceWords(whatTyped, typedMetro.words) : whatTyped;
  const effMetro = typedMetro ? typedMetro.metro.id : where ? (where.kind === "metro" ? where.id : ALL_METRO_ID) : state.near ? ALL_METRO_ID : state.metroId;
  const effNear = typedMetro ? null : where ? (where.kind === "near" ? where.place : null) : state.near;
  const placeName = where ? (where.kind === "near" ? where.place.label : metroLabel(where.id)) : state.near ? state.near.label : metroLabel(state.metroId);
  const hereName = typedMetro ? " in " + typedMetro.metro.name : effNear ? (effNear.label === "Near me" ? " near you" : " near " + effNear.label) : effMetro === ALL_METRO_ID ? " anywhere" : " in " + metroShort(effMetro);
  const whenDate = when ? dates.find((d) => dateKey(d) === when) : undefined;
  const whenName = whenDate ? whenDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "Any week";
  const whoName = who ? who + (who === 1 ? " guest" : " guests") : "Add guests";
  const count = (q: string) => feedFor(catalog, q, state.cat, effMetro, effNear, prefs.filters).length;
  const placeKey = effMetro + "|" + (effNear ? effNear.lat + "," + effNear.lon : "") + "|" + state.cat + "|" + state.catalogVersion;

  // Where, typed: cities first, then any place on the map.
  const cities = useMemo(() => {
    if (!needle) return [];
    const named = metroInQuery(needle)?.metro;
    const list = searchMetros(needle, 4);
    if (named && !list.includes(named)) list.unshift(named);
    return list.map((m) => ({ m, n: countInMetro(m.id) })).filter((x) => x.n > 0).slice(0, 4);
  }, [needle, state.catalogVersion]);

  // An activity typed into Where ("kayak", "axe throwing"): the phone sheet opens on Where, so guests type what
  // they want to do there. It is not a place, even when the map has a town by that name, so it moves to What.
  // It is offered even when a city also matched, because a city can match by accident: Denver's alias is
  // "front range", so "gun range" used to offer Denver and nothing else, and the activity had nowhere to go.
  const activityTyped = useMemo(() => (needle && describeQuery(needle).onlyKind ? whatLabel(needle) : null), [needle]);
  const moveToWhat = () => {
    setWhat(needle);
    setText("");
    setStep("what");
  };

  /**
   * A business typed into Where, by name. The sheet opens on Where, so somebody looking for one shop types its
   * name there, and until now a name was neither a city nor an activity, so the sheet answered "Keep typing".
   * Searched across the whole catalog rather than the city in the pill: naming a business means you want that
   * business, wherever it is.
   */
  const businessHits = useMemo(() => {
    if (needle.length < 3 || activityTyped) return [];
    return searchSuggest(catalog, needle, { metroId: ALL_METRO_ID, cat: state.cat }, 3).operators;
  }, [needle, activityTyped, state.cat, state.catalogVersion]);

  // What, empty: the place's strongest kinds and the occasions people search by, each counted in the place.
  const ideas = useMemo(() => {
    if (step !== "what" || whatRest) return { kinds: [], intents: [] };
    const tally = new Map<ArtKind, number>();
    for (const u of browseList(catalog, state.cat, effMetro, effNear)) tally.set(u.art, (tally.get(u.art) || 0) + 1);
    const kinds = Array.from(tally.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([art]) => ({ art, query: kindQuery(art), n: count(kindQuery(art)) }))
      .filter((k) => k.n > 0);
    const intents = WHAT_INTENTS.map((c) => ({ ...c, n: count(c.query) })).filter((c) => c.n > 0);
    return { kinds, intents };
  }, [step, whatRest, placeKey, prefs.filters]);

  // What, typed: activities, businesses, then occasions, all inside the place.
  const typed = useMemo(() => {
    if (step !== "what" || !whatRest) return null;
    const found = searchSuggest(catalog, whatRest, { metroId: effNear ? ALL_METRO_ID : effMetro, cat: state.cat }, 4);
    const low = whatRest.toLowerCase();
    const words = low.split(/\s+/);
    const chips = WHAT_INTENTS.filter((c) => c.query !== low && words.some((w) => w.length >= 2 && c.label.toLowerCase().split(/\s+/).some((lw) => lw.startsWith(w))));
    const d = describeQuery(whatRest);
    if (d.onlyIntent && !d.arts.length && !WHAT_INTENTS.some((c) => c.query === low)) chips.unshift({ label: d.intent.label!, query: whatRest });
    // Nothing here: the count is still shown, as 0, over the ways out the catalog really has. The family row
    // browses the kind's own tab in this place, so it is counted the way browse counts, filters included.
    const zero = !found.results.length;
    const family = zero && found.family ? { ...found.family, n: applyFilters(browseList(catalog, found.family.cat, effMetro, effNear), prefs.filters).length } : null;
    return {
      zero,
      acts: found.activities.map((a) => ({ ...a, n: count(a.query) })).filter((a) => a.n > 0),
      ops: found.operators,
      intents: chips.map((c) => ({ ...c, n: count(c.query) })).filter((c) => c.n > 0),
      family: family && family.n > 0 ? family : null,
      places: zero ? found.places : [],
      elsewhere: zero ? found.elsewhere : [],
      otherCats: zero ? found.otherCats : 0,
    };
  }, [step, whatRest, placeKey, prefs.filters]);

  const pickPlace = (pl: PendingPlace) => {
    setWhere(pl);
    setText("");
    setStep("what");
  };
  const pickCity = (id: string) => {
    // "kayak tampa" typed into Where: Tampa is the place, and the kayak half fills What if What is empty.
    const named = metroInQuery(needle);
    if (named && named.metro.id === id && !what.trim()) {
      const rest = stripPlaceWords(needle, named.words);
      if (rest) setWhat(rest);
    }
    pickPlace({ kind: "metro", id });
  };
  /** A place typed into What moves to Where, and What keeps the rest. */
  const settleWhat = (value: string) => {
    const named = value.trim() ? metroInQuery(value) : null;
    if (!named) return value.trim();
    setWhere({ kind: "metro", id: named.metro.id });
    const rest = stripPlaceWords(value, named.words);
    setWhat(rest);
    return rest;
  };
  const pickWhat = (query: string) => {
    if (typedMetro) setWhere({ kind: "metro", id: typedMetro.metro.id });
    setWhat(query);
    setStep("when");
  };
  /** A way out of an empty What: the same activity in another place, or anywhere. */
  const pickWhatIn = (query: string, metroId: string) => {
    setWhere({ kind: "metro", id: metroId });
    setWhat(query);
    setStep("when");
  };
  const goStep = (s: Step) => {
    if (step === "what") settleWhat(what);
    setStep(s);
  };

  const useHere = async () => {
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
    pickPlace({ kind: "near", place: { label: "Near me", sub: "Your current location", lat: pt.lat, lon: pt.lon } });
  };

  const clearAll = () => {
    setText("");
    setWhat("");
    setWhere({ kind: "metro", id: ALL_METRO_ID });
    setWhen(null);
    setWho(null);
    setStep("where");
  };

  const run = () => {
    let query = what.trim();
    let place = where;
    /**
     * Whatever is still sitting in the Where box counts. The sheet opens on Where, so a guest who types
     * "gun range" there and presses Search typed the only thing they were ever asked for: dropping it because
     * no suggestion was tapped made the button look dead, which is exactly how it read on a phone.
     * A city goes to Where, anything else goes to What, and "gun range toronto" splits into both.
     */
    const typed = text.trim();
    if (typed) {
      const typedCity = metroInQuery(typed);
      if (typedCity) {
        place = { kind: "metro", id: typedCity.metro.id };
        const rest = stripPlaceWords(typed, typedCity.words);
        if (rest && !query) query = rest;
      } else if (describeQuery(typed).onlyKind || businessHits.length || !hits.length) {
        // An activity, a business we have by that name, or a word the map could not place: it is what they are
        // looking for, not where they are going. The map will happily geocode a shop's name into a suburb.
        if (!query) query = typed;
        /**
         * Naming a business means that business, wherever it is. The feed is filtered by the city in the pill,
         * so on the live site "White Knuckle Watersports" typed from Toronto answered "No exact matches": the
         * shop is in Clearwater Beach. When the guest has not chosen a city themselves and the name matches a
         * business we hold, the search widens to everywhere rather than returning nothing.
         */
        if (!place && businessHits.length && !businessHits.some((u) => u.metroId === state.metroId)) {
          place = { kind: "metro", id: ALL_METRO_ID };
        }
      } else {
        place = { kind: "near", place: hits[0] };
      }
    }
    const named = query ? metroInQuery(query) : null;
    if (named) {
      place = { kind: "metro", id: named.metro.id };
      query = stripPlaceWords(query, named.words);
    }
    setPrefs({ when, who, view: "feed" });
    setQ(query);
    if (place?.kind === "metro") setMetro(place.id);
    else if (place?.kind === "near") {
      setNear(place.place);
      closeSheet();
    } else closeSheet();
  };

  /**
   * A phone screen is about 660 points tall. With four cards stacked on it the suggestion list under the box
   * was 140 points, a row and a half, so picking anything meant scrolling a small box inside a scrolling sheet.
   * While the guest is actually typing, the cards they have not reached yet step aside and the list gets the
   * screen; they come back the moment the box is empty or a suggestion is taken.
   */
  const typing = (step === "where" && !!needle) || (step === "what" && !!whatRest);

  const item = (key: string, icon: ReactNode, title: string, sub: string, onClick: () => void, opts: { art?: boolean; pressed?: boolean; disabled?: boolean } = {}) => (
    <button type="button" key={key} className="airsitem" aria-pressed={opts.pressed} disabled={opts.disabled} onClick={onClick}>
      <span className={"airstile" + (opts.art ? " art" : "")}>{icon}</span>
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </button>
  );
  const n = (k: number) => k.toLocaleString() + hereName;

  return (
    <div className="airsearch">
      <div className="airsearchtop">
        <button type="button" className="aircircle flat bordered" onClick={closeSheet} aria-label="Close">
          <IcClose size={12} />
        </button>
        <span className="airsearchtab">Experiences</span>
        <span className="aircircle ghostslot" aria-hidden />
      </div>

      <div className="airsearchcards">
        {step === "where" ? (
          <section className="airscard open fill">
            <h2>Where to?</h2>
            <label className="airsfield">
              <IcSearch size={16} />
              <input
                value={text}
                placeholder="Search destinations"
                aria-label="Search destinations"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (activityTyped) moveToWhat();
                  else if (businessHits.length && !cities.length) moveToWhat();
                  else if (cities[0]) pickCity(cities[0].m.id);
                  else if (hits[0]) pickPlace({ kind: "near", place: hits[0] });
                  else setStep("what");
                }}
              />
              {text ? (
                <button type="button" className="airsclear" aria-label="Clear where" onClick={() => setText("")}>
                  <IcClose size={8} />
                </button>
              ) : where || state.near || state.metroId !== ALL_METRO_ID ? (
                <button type="button" className="airsclear" aria-label={"Clear " + placeName} onClick={() => { setWhere({ kind: "metro", id: ALL_METRO_ID }); }}>
                  <IcClose size={8} />
                </button>
              ) : null}
            </label>
            {where ? (
              <div className="airschips">
                <button type="button" className="airschip" onClick={() => setWhere(null)} aria-label={"Remove " + placeName}>
                  {placeName} <IcClose size={8} />
                </button>
              </div>
            ) : null}

            <div className="airslist">
              {needle ? (
                <>
                  {/* Typed an activity: that row goes first, because the activity is what they said, not the city that brushed past it. */}
                  {activityTyped ? item("act", <IcSearch size={20} />, activityTyped, "Search activities" + hereName, moveToWhat) : null}
                  {cities.map(({ m, n: k }) =>
                    item("m" + m.id, <IcPin size={20} />, m.name, m.region + ", " + (m.country === "CA" ? "Canada" : "United States") + " · " + k.toLocaleString() + " places", () => pickCity(m.id)),
                  )}
                  {businessHits.length ? <p className="airsgroup">Businesses</p> : null}
                  {businessHits.map((u) => {
                    const m = metroById(u.metroId);
                    return item(
                      "b" + u.id,
                      u.cover ? <Photo src={u.cover} kind={u.art} id={u.id + "wo"} alt="" size="thumb" /> : <Art kind={u.art} id={u.id + "wo"} />,
                      u.title,
                      (ART_LABEL[u.art] ? ART_LABEL[u.art] + " · " : "") + u.area + (m ? " · " + m.name : ""),
                      () => openRequest(u.id),
                      { art: true },
                    );
                  })}
                  {/* A named activity is not a destination. The map has hamlets called Gun Range and Sauna, and
                      offering them under what the guest typed sent them to an empty corner of Texas. */}
                  {!activityTyped && hits.length ? <p className="airsgroup">Places on the map</p> : null}
                  {!activityTyped ? hits.map((h) => item("p" + h.label + h.lat, <IcPin size={20} />, h.label, h.sub, () => pickPlace({ kind: "near", place: h }))) : null}
                  {!cities.length && !hits.length && !activityTyped && !businessHits.length ? <p className="airsgroup">Keep typing, or try a bigger town nearby.</p> : null}
                </>
              ) : (
                <>
                  {item("nearby", <IcNavigate size={20} />, locating ? "Finding you…" : "Nearby", "Find what's around you", useHere, { disabled: locating })}
                  {locateNote ? <p className="airsgroup">{locateNote}</p> : null}
                  {item("anywhere", <IcGlobe size={20} />, "Anywhere", countInMetro(ALL_METRO_ID).toLocaleString() + " places across the US and Canada", () => pickPlace({ kind: "metro", id: ALL_METRO_ID }))}
                  <p className="airsgroup">Suggested destinations</p>
                  {seeded.map(({ m, n: k }) => item(m.id, <IcPin size={20} />, m.name + ", " + m.region, k.toLocaleString() + " places", () => pickPlace({ kind: "metro", id: m.id }), { pressed: !where && state.metroId === m.id }))}
                </>
              )}
            </div>
          </section>
        ) : typing ? null : (
          <button type="button" className="airscard folded" onClick={() => goStep("where")}>
            <span>Where</span>
            <b>{typedMetro ? metroLabel(typedMetro.metro.id) : placeName}</b>
          </button>
        )}

        {step === "what" ? (
          <section className="airscard open fill">
            <h2>What to do?</h2>
            <label className="airsfield">
              <IcSearch size={16} />
              <input
                ref={whatRef}
                value={what}
                placeholder="Search activities"
                aria-label="Search activities"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setWhat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  settleWhat(what);
                  setStep("when");
                }}
              />
              {what ? (
                <button type="button" className="airsclear" aria-label="Clear what" onClick={() => setWhat("")}>
                  <IcClose size={8} />
                </button>
              ) : null}
            </label>
            <div className="airslist">
              {typed ? (
                <>
                  {typedMetro
                    ? item("tm", <IcPin size={20} />, (whatRest ? whatLabel(whatRest) : "Things to do") + " in " + typedMetro.metro.name, "Sets Where to " + metroLabel(typedMetro.metro.id), () => { settleWhat(what); setStep("when"); })
                    : null}
                  {typed.zero ? (
                    <p className="airsgroup">
                      {whatLabel(whatRest)}
                      {hereName} · 0
                    </p>
                  ) : null}
                  {typed.family
                    ? item("fam", <IcSearch size={20} />, typed.family.name + hereName, n(typed.family.n) + " to browse", () => { setCat(typed.family!.cat); pickWhat(""); })
                    : null}
                  {typed.places.length ? <p className="airsgroup">Nearest with it</p> : null}
                  {typed.places.map((pl) => item("pl" + pl.metro.id, <IcPin size={20} />, whatLabel(whatRest) + " in " + pl.metro.name, pl.count.toLocaleString() + " in " + pl.metro.name + ", " + pl.metro.region, () => pickWhatIn(whatRest, pl.metro.id)))}
                  {typed.elsewhere.map((a) => item("el" + a.art, <IcGlobe size={20} />, a.label + " anywhere", a.count.toLocaleString() + " across the US and Canada", () => pickWhatIn(a.query, ALL_METRO_ID)))}
                  {typed.otherCats
                    ? item("oc", <IcSearch size={20} />, "In other categories", typed.otherCats.toLocaleString() + hereName, () => { setCat("all"); pickWhat(whatRest); })
                    : null}
                  {typed.acts.length ? <p className="airsgroup">{typed.zero ? "Close to it" + hereName : "Activities"}</p> : null}
                  {typed.acts.map((a) => item("a" + a.art, <Art kind={a.art} id={"ss" + a.art} />, a.label, n(a.n), () => pickWhat(a.query), { art: true, pressed: whatRest.toLowerCase() === a.query }))}
                  {typed.ops.length ? <p className="airsgroup">Businesses</p> : null}
                  {typed.ops.map((u) => {
                    const m = metroById(u.metroId);
                    return item(
                      "o" + u.id,
                      u.cover ? <Photo src={u.cover} kind={u.art} id={u.id + "so"} alt="" size="thumb" /> : <Art kind={u.art} id={u.id + "so"} />,
                      u.title,
                      (ART_LABEL[u.art] ? ART_LABEL[u.art] + " · " : "") + u.area + (m ? " · " + m.name : ""),
                      () => openRequest(u.id),
                      { art: true },
                    );
                  })}
                  {typed.intents.length ? <p className="airsgroup">Ideas</p> : null}
                  {typed.intents.map((c) => item("i" + c.query, <IcSearch size={18} />, c.label, n(c.n), () => pickWhat(c.query)))}
                  {!typed.acts.length && !typed.ops.length && !typed.intents.length && !typed.family && !typed.places.length && !typed.elsewhere.length && !typed.otherCats ? (
                    <p className="airsgroup">Nothing for “{whatRest}”{hereName} yet. Try fewer words, or another place.</p>
                  ) : null}
                </>
              ) : (
                <>
                  {ideas.kinds.length ? <p className="airsgroup">Popular{hereName}</p> : null}
                  {ideas.kinds.map((k) => item("k" + k.art, <Art kind={k.art} id={"sk" + k.art} />, ART_LABEL[k.art] || k.art, n(k.n), () => pickWhat(k.query), { art: true }))}
                  {ideas.intents.length ? <p className="airsgroup">Ideas</p> : null}
                  {ideas.intents.map((c) => item("i" + c.query, <IcSearch size={18} />, c.label, n(c.n), () => pickWhat(c.query)))}
                </>
              )}
            </div>
          </section>
        ) : typing ? null : (
          <button type="button" className="airscard folded" onClick={() => goStep("what")}>
            <span>What</span>
            <b>{whatRest ? whatLabel(whatRest) : "Any activity"}</b>
          </button>
        )}

        {step === "when" ? (
          <section className="airscard open">
            <h2>When's your trip?</h2>
            <div className="airsdays">
              {dates.map((d) => {
                const k = dateKey(d);
                return (
                  <button type="button" key={k} className="airsday" aria-pressed={when === k} onClick={() => setWhen(when === k ? null : k)}>
                    <small>{d.toLocaleDateString("en-US", { weekday: "short" })}</small>
                    <b>{d.getDate()}</b>
                    <small>{d.toLocaleDateString("en-US", { month: "short" })}</small>
                  </button>
                );
              })}
            </div>
            <div className="airscardfoot">
              <button type="button" className="airlink" onClick={() => { setWhen(null); setStep("who"); }}>
                Skip
              </button>
              <button type="button" className="airdark" onClick={() => setStep("who")}>
                Next
              </button>
            </div>
          </section>
        ) : typing ? null : (
          <button type="button" className="airscard folded" onClick={() => goStep("when")}>
            <span>When</span>
            <b>{whenName}</b>
          </button>
        )}

        {step === "who" ? (
          <section className="airscard open">
            <h2>Who's coming?</h2>
            <div className="airguests">
              <span>
                <b>Guests</b>
                <small>People in your group</small>
              </span>
              <span className="airstepper">
                <button type="button" onClick={() => setWho(who && who > 1 ? who - 1 : null)} disabled={!who} aria-label="Fewer guests">
                  <IcMinus />
                </button>
                <span className="n">{who || 0}</span>
                <button type="button" onClick={() => setWho(Math.min(QTY_MAX, (who || 0) + 1))} disabled={(who || 0) >= QTY_MAX} aria-label="More guests">
                  <IcPlus />
                </button>
              </span>
            </div>
          </section>
        ) : typing ? null : (
          <button type="button" className="airscard folded" onClick={() => goStep("who")}>
            <span>Who</span>
            <b>{whoName}</b>
          </button>
        )}
      </div>

      <div className="airsearchfoot">
        <button type="button" className="airlink" onClick={clearAll}>
          Clear all
        </button>
        <button type="button" className="airaccent go" onClick={run}>
          <IcSearch size={16} /> Search
        </button>
      </div>
    </div>
  );
}
