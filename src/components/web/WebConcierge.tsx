import { useCallback, useEffect, useId, useRef, useState } from "react";
import "../../styles/concierge.css";
import { ALL_METRO_ID, metroLabel } from "../../data/metros";
import { ICONS } from "../../data/icons";
import {
  askConcierge,
  conciergeReady,
  headline,
  listingForOption,
  refinements,
  stepLine,
  understood,
  headlineService,
  missedTheHour,
  noTimesLine,
  offsetLine,
  priceLine,
  resetConcierge,
  serviceLine,
  slotOf,
  splitOptions,
  spreadDepartures,
  groupShops,
  whenLine,
  withPlace,
  type ConciergeAnswer,
  type ConciergeDeparture,
  type ConciergeStep,
  type ConciergeOption,
} from "../../lib/concierge";
import { fmtTime } from "../../lib/format";
import { dateKey } from "../../lib/dates";
import { loadGuest } from "../../lib/storage";
import { fewSeats } from "../../lib/liveTimes";
import {
  copyText,
  forgetConversation,
  forgetEverything,
  loadConversations,
  rememberTurn,
  titleOf,
  transcript,
  whenLabel,
  type Conversation,
} from "../../lib/conciergeHistory";
import { DATES, useApp } from "../../state/AppProvider";
import { Mark } from "../layout/Mark";
import { useModal } from "../layout/useModal";
import { Markup } from "../Markup";

/**
 * Ask for anything, and get times you can actually book.
 *
 * The catalog answers "who is there". This answers the harder question a guest actually has: "is there a seat
 * at seven tonight, and what will it cost me". `backend/src/concierge/` reads each shop's own booking system
 * while the guest waits, and until now the only place that answer could be seen was `/go`, a page the API
 * renders for itself. So the strongest thing the product does was not part of the product.
 *
 * Built as an overlay rather than a screen of its own. The guest is mid-thought when they ask, and a thought
 * that ends in a business should leave them on that business's page with the site still behind them, not on
 * the far side of a navigation they have to come back from. It also keeps this out of the reducer's screen
 * list and its history sync, which are the two places a fifth screen goes quietly wrong.
 *
 * What the site adds over `/go`, because a page has no guest and no catalog:
 *
 * 1. It knows where the guest is, so the agent does not spend a turn asking.
 * 2. An option is a business we hold a listing for, so it opens that listing, its photos, its menu and Otto.
 * 3. A stream that fails becomes the plain route rather than an apology.
 */

/** What went into the thread. Split from its id so `add` can take one without inventing the id twice. */
type Said =
  | { kind: "me"; text: string }
  | { kind: "them"; text: string }
  | { kind: "note"; text: string }
  /**
   * An answer keeps the trace that produced it.
   *
   * The steps used to be thrown away the moment the answer landed, which meant the single most convincing
   * thing the product does, going and reading eleven shops' booking systems in three seconds, was visible
   * only as a sentence that flickered past under three dots. Kept here, an answer can show its own working
   * on demand, and the demo stops depending on somebody watching the right four seconds.
   */
  | { kind: "answer"; answer: ConciergeAnswer; steps: ConciergeStep[] };
type Entry = Said & { id: number };

/**
 * The greeting, said the way a person would say it rather than a landing page would print it. It carries what
 * the agent does in one breath, because there is no separate screen to explain that on: this is a text thread,
 * and a text thread has messages in it, not a hero and a numbered list.
 */
const OPENER = "Tell me what you want to do and I'll check who's actually free, live, right now.";

/**
 * The first things a guest could say, offered as quick replies under the greeting rather than as a page of
 * cards. A messaging app suggests replies you can tap; it does not show you a grid of examples and an
 * illustrated three-step guide, so neither does this. Two are deliberately untidy, a lower-case "saturday" and
 * a budget with no activity attached, because the reader handles that and a demo that only shows tidy input is
 * selling the wrong thing.
 */
const EXAMPLES = [
  "escape room in Waterloo tonight, 4 of us",
  "axe throwing near Waterloo",
  "something to do near me tonight",
];

export function WebConcierge({ seed, framed, embed, onClose }: { seed?: string; framed?: boolean; embed?: boolean; onClose: () => void }) {
  const { state, openRequest, confirmUnclaimed } = useApp();
  /**
   * The opening line is the first render, not a timer that fires into it. As a delayed `add` it could be
   * written twice: the effect below re-runs whenever the guest's place settles, and a cleared timeout either
   * loses the line or, guarded the other way, writes a second one under the first.
   */
  const [entries, setEntries] = useState<Entry[]>(() => (seed ? [] : [{ kind: "them", text: OPENER, id: 0 }]));
  const [busy, setBusy] = useState(false);
  /** The agent's own steps for the question in flight, capped, so the working card stays cheap to draw. */
  const [steps, setSteps] = useState<ConciergeStep[]>([]);
  /** The same steps, uncapped, so the answer can keep the whole trace when it lands. */
  const stepsRef = useRef<ConciergeStep[]>([]);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<Conversation[] | null>(null);
  const [copied, setCopied] = useState("");
  /**
   * The transcript, on screen, for when the clipboard refuses.
   *
   * It refuses more often than it looks. `navigator.clipboard` does not exist on an insecure origin, and
   * testing the site from a phone over the LAN is plain http; the `execCommand` fallback needs the document
   * focused, which it is not if the press came from a background tab. A copy button that silently does
   * nothing is worse than no copy button, so the text is put where it can be selected by hand.
   */
  const [manual, setManual] = useState("");
  const [pending, setPending] = useState<{ option: ConciergeOption; departure: ConciergeDeparture; party: number } | null>(null);
  const [guestForm, setGuestForm] = useState(() => {
    const g = loadGuest();
    return { name: g.name || "", phone: g.phone || "", email: g.email || "" };
  });
  const [booking, setBooking] = useState(false);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const session = useRef<string | null>(null);
  /** Every turn of the conversation on screen, for copying it out and for putting it back after a reload. */
  const convo = useRef<Conversation | null>(null);
  const nextId = useRef(1);
  const running = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const inputId = useId();
  /**
   * How long the question in flight has been running, in tenths of a second.
   *
   * Said out loud while it works, because the wait is the product doing the thing nobody else does: a guest
   * watching "3.4s" climb while shop names go past is watching eleven booking systems being read, and a
   * spinner with no clock on it reads as a page that has stopped.
   */
  const [elapsed, setElapsed] = useState(0);

  /**
   * The place the home already opened on, as a sentence the reader understands. A point the guest chose or one
   * read off their connection is a town; a metro is the city we filed them under. "Anywhere" is not a place,
   * so it is not offered, and then the agent asks, which is the right thing to do rather than guess a country.
   */
  const place = state.near?.label || (state.metroId !== ALL_METRO_ID ? metroLabel(state.metroId) : null);

  /**
   * The newest step worth saying out loud, so a long wait says what it is waiting on.
   *
   * A cold shop is given twelve seconds because it is worth waiting for, and on a phone there is no trace
   * panel beside the thread. One unchanging sentence for thirteen seconds reads exactly like a hang; the shop
   * it is actually on, changing as it moves, reads as progress.
   */
  const status = (() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const line = stepLine(steps[i]);
      if (line) return line;
    }
    return null;
  })();

  /**
   * It says `aria-modal`, so it has to behave like one, and it did not.
   *
   * Driven in a real Chromium, 23 of 24 Tab stops walked straight out of the overlay into the home page
   * underneath it, which a full-screen scrim covers: a focus ring on things nobody can see. A wheel over the
   * thread rolled that page 900 px, so closing left the guest somewhere else entirely. And focus never came
   * back to whatever opened it.
   *
   * Declared before the effect that focuses the box's own field, so the hook reads the real opener rather than
   * that field. It then puts focus on the first stop and the effect below moves it to the field, which is
   * where it belongs: this opens ready to be typed into.
   *
   * Embed is a page mode under the site header, not a dialog. Locking the page and trapping Tab would hide
   * Browse from the keyboard and freeze the rest of the site as if a scrim were still up.
   */
  useModal(box, !embed);

  const add = (e: Said) => setEntries((cur) => [...cur, { ...e, id: nextId.current++ }]);

  const asked = useRef<string | null>(null);
  /** Whether the next recorded turn was the app answering on the guest's behalf rather than the guest typing. */
  const autoNext = useRef(false);

  useEffect(() => {
    if (!manual) return;
    const el = manualRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [manual]);

  // Escape closes, as every other overlay on the site does. In embed it only dismisses history, because
  // leaving Ask is the Browse tab in the site header, not a dialog Close.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Innermost first: the transcript, then the history, then the overlay itself.
      if (manualRef.current) setManual("");
      else if (history) setHistory(null);
      else if (!embed) onClose();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [embed, onClose, history]);

  /**
   * A question in flight when the overlay closes is abandoned, so its answer cannot arrive into nothing.
   *
   * The abort waits a tick, and that tick is not a detail. In development React runs every effect twice:
   * mount, unmount, mount again, on the same component with its state intact. Aborting here and now killed the
   * request the first mount had already sent, and the second mount's own guard then saw the question as asked,
   * so the opening question was cancelled and never re-sent: a thread with the guest's sentence in it and the
   * typing dots running for ever. One tick later a remount has already cleared `gone`, so only a real close
   * still aborts.
   */
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      window.setTimeout(() => {
        if (gone.current) running.current?.abort();
      }, 0);
    };
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, busy]);

  // The clock runs only while something is in flight, and is reset by the question rather than by the tick,
  // so a second question does not inherit the first one's elapsed time.
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setElapsed((n) => n + 1), 100);
    return () => window.clearInterval(t);
  }, [busy]);

  /** Set once the place question has been answered from what the site knows, so it cannot answer it twice. */
  const placeGiven = useRef(false);

  const ask = useCallback(
    async (raw: string, opts: { silent?: boolean; auto?: boolean } = {}) => {
      const text = raw.trim();
      if (!text) return;
      // A second question cancels the first: a slow answer landing after the guest has moved on reads as the
      // agent answering the wrong question.
      running.current?.abort();
      const ctl = new AbortController();
      running.current = ctl;

      // `silent` is the app answering a question on the guest's behalf. It is not something they said, so it
      // does not go in the thread as their words; the note above it says what was assumed instead.
      if (!opts.silent) add({ kind: "me", text });
      // A silent turn is the same question still being worked on, so its trace continues rather than starts:
      // "read your sentence, asked where, answered it from the browser" is one story told once.
      if (!opts.silent) {
        setSteps([]);
        stepsRef.current = [];
        setElapsed(0);
      }
      autoNext.current = !!opts.auto;
      setBusy(true);

      // Only the opening question carries the guest's place; after that the agent is holding the conversation
      // and appending a town to "and something cheaper?" would overrule what it already knows.
      const sentence = session.current ? text : withPlace(text, place);
      const r = await askConcierge(sentence, {
        session: session.current,
        /*
          Two copies on purpose. The state drives the working card while it runs and is capped, because
          rendering sixty lines forty times is the one thing that could make the wait slower than it is. The
          ref is the whole trace, uncapped, and it is what the finished answer keeps: "how I got this" that
          starts at step thirty is not how it got it.
        */
        onStep: (st) => {
          if (gone.current) return;
          stepsRef.current = [...stepsRef.current, st];
          setSteps((cur) => (cur.length > 40 ? [...cur.slice(-30), st] : [...cur, st]));
        },
        signal: ctl.signal,
      });
      // Aborted, or the overlay has closed for real: either way there is nobody left to tell.
      if (ctl.signal.aborted || gone.current) return;
      running.current = null;

      if (!r.ok) {
        setBusy(false);
        if (r.error) {
          add({ kind: "them", text: r.error });
          // A failure is worth keeping too: "it said it could not reach the shops" is a bug report.
          keep({ q: sentence, at: Date.now(), ms: 0, answer: null, error: r.error });
        }
        return;
      }
      session.current = r.answer.session;

      /**
       * It asked where they are, and the site already knows.
       *
       * Handing somebody who typed "a team offsite for 10 on monday between 5 and 7 near me" a menu of three
       * cities is the product not listening, and it is the one question we never have to ask: the home opened
       * on a place. So it is answered here, said out loud as an assumption, and the guest can overrule it in a
       * sentence. `busy` is deliberately left on, because from where they are sitting this is still the one
       * question they asked being worked on.
       */
      if (r.answer.followUp?.why === "place" && place && !placeGiven.current) {
        placeGiven.current = true;
        keep({ q: sentence, at: Date.now(), ms: r.answer.ms, answer: r.answer });
        void ask(place, { silent: true, auto: true });
        return;
      }

      setBusy(false);
      add({ kind: "answer", answer: r.answer, steps: stepsRef.current });
      keep({ q: sentence, at: Date.now(), ms: r.answer.ms, answer: r.answer });
    },
    [place],
  );

  /**
   * The opening move. A guest who tapped an example, or arrived on `#ask=...`, has already asked their
   * question by opening this, so it is asked for them rather than typed out again; everyone else gets a line
   * saying what this box is for.
   *
   * Guarded by a ref rather than a dependency list, because `ask` is rebuilt whenever the guest's place
   * settles, and a place that settles a moment after the overlay opens would ask the same question twice.
   */
  useEffect(() => {
    inputRef.current?.focus();
    // Guarded by the sentence rather than a flag: a flag made development's double mount safe but also made a
    // second shared link arriving at an open page do nothing at all, which is the half somebody gets sent.
    if (!seed || asked.current === seed) return;
    asked.current = seed;
    void ask(seed);
  }, [seed, ask]);

  /** Record one exchange on this device, against the agent's own session id so the two line up. */
  const keep = (t: { q: string; at: number; ms: number; answer: ConciergeAnswer | null; error?: string }) => {
    const id = session.current;
    if (!id) return;
    const turn = { ...t, ...(autoNext.current ? { auto: true as const } : {}) };
    autoNext.current = false;
    const list = rememberTurn(id, turn);
    convo.current = list.find((c) => c.id === id) || null;
    if (history) setHistory(list);
  };

  /** Say "Copied" on the button that was pressed, then take it back. */
  const flash = (key: string) => {
    setCopied(key);
    window.setTimeout(() => setCopied((cur) => (cur === key ? "" : cur)), 1600);
  };

  /** Copy, and if the clipboard will not have it, show the text so it can be taken by hand. */
  const copyOut = async (text: string, key: string) => {
    const ok = await copyText(text);
    if (ok) flash(key);
    else setManual(text);
  };

  /**
   * Put a past conversation back on the screen.
   *
   * Rebuilt from the answers as they were rendered, not re-asked: the whole reason to look at an old thread is
   * that it said something wrong, and asking again would quietly replace the evidence with a different answer.
   * The agent's own session is picked up with it, so carrying on where it left off still works while the
   * agent still holds it, and starts a fresh one once its two hours are up.
   */
  const openConversation = (c: Conversation) => {
    running.current?.abort();
    running.current = null;
    setBusy(false);
    setHistory(null);
    session.current = c.id;
    convo.current = c;
    placeGiven.current = true;
    asked.current = seed ?? null;
    nextId.current = 1;
    const back: Entry[] = [];
    for (const t of c.turns) {
      if (!t.auto) back.push({ kind: "me", text: t.q, id: nextId.current++ });
      // A conversation read back off this device has the answers but not the trace: what the agent did is
      // not written to storage, and inventing a plausible one would be the worst kind of demo.
      if (t.answer) back.push({ kind: "answer", answer: t.answer, steps: [], id: nextId.current++ });
      else if (t.error) back.push({ kind: "them", text: t.error, id: nextId.current++ });
    }
    setEntries(back.length ? back : [{ kind: "them", text: OPENER, id: 0 }]);
  };

  const startOver = () => {
    running.current?.abort();
    running.current = null;
    void resetConcierge(session.current);
    session.current = null;
    convo.current = null;
    placeGiven.current = false;
    asked.current = null;
    setEntries([{ kind: "them", text: OPENER, id: 0 }]);
    setBusy(false);
    nextId.current = 1;
    inputRef.current?.focus();
  };

  /** Every shop in the shortlist opens on Outset. A live time we have never ingested still gets a page. */
  const open = (o: ConciergeOption) => {
    const id = listingForOption(o);
    onClose();
    window.scrollTo(0, 0);
    openRequest(id);
  };

  const rememberGuest = (g: { name: string; phone: string; email: string }) => {
    try {
      localStorage.setItem("outset.guest", JSON.stringify(g));
    } catch {
      /* ignore */
    }
  };

  const sendBook = async (o: ConciergeOption, d: ConciergeDeparture, party: number, guest: { name: string; phone: string; email: string }) => {
    const id = listingForOption(o);
    const slot = slotOf(d.time);
    if (!id || !slot || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      add({ kind: "them", text: "I could not hold that time on Outset. Pick another one." });
      return;
    }
    const dateIdx = Math.max(0, DATES.findIndex((day) => dateKey(day) === d.date));
    setBooking(true);
    const r = await confirmUnclaimed({
      listing: id,
      dateIdx,
      date: d.date,
      slot,
      qty: Math.min(60, Math.max(1, party)),
      optionIdx: null,
      service: d.item || o.name,
      total: d.fromPrice,
      guest: { name: guest.name.trim(), phone: guest.phone.trim(), email: guest.email.trim() || undefined },
    });
    setBooking(false);
    if (!r.ok) {
      add({ kind: "them", text: r.error || "That time could not be booked. Try another." });
      return;
    }
    setPending(null);
    if (r.checkoutUrl && r.checkoutUrl !== "embedded") {
      add({ kind: "them", text: "Sending you to Stripe to hold the card." });
      onClose();
      return;
    }
    add({ kind: "them", text: r.checkoutUrl === "embedded" ? "Hold the card on the next screen. Then you are booked." : "You're on the list. Keep that confirmation on the next screen." });
    onClose();
  };

  const book = (o: ConciergeOption, d: ConciergeDeparture, party: number) => {
    const g = { ...guestForm, ...loadGuest() };
    const name = (g.name || guestForm.name).trim();
    const phone = (g.phone || guestForm.phone).replace(/\D/g, "");
    if (name.length < 2 || phone.length < 7) {
      setGuestForm({ name: g.name || guestForm.name, phone: g.phone || guestForm.phone, email: g.email || guestForm.email });
      setPending({ option: o, departure: d, party });
      add({ kind: "them", text: "Name and mobile, then I will book that time." });
      return;
    }
    const guest = { name, phone: g.phone || guestForm.phone, email: (g.email || guestForm.email || "").trim() };
    rememberGuest(guest);
    void sendBook(o, d, party, guest);
  };

  /**
   * Nothing has been asked yet, so the thread is a standing invitation rather than one grey bubble.
   *
   * The opener still lives in `entries`, because the transcript, the history and the "New" button all reason
   * about a thread that has one line in it. It is simply drawn as the opening screen instead of as a message
   * until the guest says something.
   */
  const opening = !busy && entries.length === 1 && entries[0].kind === "them" && entries[0].text === OPENER;

  return (
    <div
      ref={box}
      className={"cg" + (framed ? " cg-framed" : "") + (embed ? " cg-embed" : "")}
      role={embed ? "region" : "dialog"}
      aria-modal={embed ? undefined : "true"}
      aria-label="Ask"
      onClick={(e) => {
        if (!framed && !embed && e.target === e.currentTarget) onClose();
      }}
    >
      <section className="cg-thread">
        <header className="cg-top">
          {embed ? null : (
            <>
              <Mark size={30} />
              <span className="cg-who">
                <b>Ask</b>
                <small>Live times from the shops around you</small>
              </span>
            </>
          )}
          <div className="cg-tools">
            <button type="button" className="cg-tool" onClick={() => setHistory(history ? null : loadConversations())} aria-pressed={!!history}>
              History
            </button>
            <button type="button" className="cg-tool" onClick={startOver} disabled={!session.current && entries.length < 2}>
              New
            </button>
          </div>
          {embed ? null : (
          <button type="button" className="cg-x" onClick={onClose} aria-label="Close">
            <Markup html={ICONS.close} />
          </button>
          )}
        </header>

        {history ? (
          <HistoryPanel
            list={history}
            currentId={session.current}
            onOpen={openConversation}
            onCopy={(c) => void copyOut(transcript(c), c.id)}
            copied={copied}
            onDrop={(id) => setHistory(forgetConversation(id))}
            onClear={() => { forgetEverything(); setHistory([]); convo.current = null; }}
            onClose={() => setHistory(null)}
          />
        ) : null}

        {manual ? (
          <div className="cg-manual">
            <div className="cg-histtop">
              <b>Copy this</b>
              <button type="button" className="cg-x" onClick={() => setManual("")} aria-label="Close">
                <Markup html={ICONS.close} />
              </button>
            </div>
            <p className="cg-note">Select and copy the text below.</p>
            <textarea ref={manualRef} className="cg-manualtext" readOnly value={manual} aria-label="The conversation as text" />
          </div>
        ) : null}

        <div className="cg-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
          {entries.map((e) =>
            e.kind === "answer" ? (
              <Answered key={e.id} answer={e.answer} steps={e.steps} onAsk={ask} onOpen={open} onBook={book} />
            ) : e.kind === "note" ? (
              <p className="cg-note" key={e.id}>{e.text}</p>
            ) : (
              <div className={"cg-b cg-" + e.kind} key={e.id}>
                <span className="cg-sr">{e.kind === "me" ? "You: " : "Outset: "}</span>
                {e.text}
              </div>
            ),
          )}
          {busy ? <Working steps={steps} status={status} elapsed={elapsed} /> : null}
          {/*
            Quick replies under the greeting, the way a phone suggests them, not a page of example cards. They
            disappear the moment anything has actually been asked, same as any messaging app's own suggestions.
          */}
          {opening ? (
            <div className="cg-chips cg-suggest">
              {EXAMPLES.map((ex) => (
                <button type="button" key={ex} onClick={() => void ask(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          ) : null}
          {pending ? (
            <form
              className="cg-guest"
              onSubmit={(e) => {
                e.preventDefault();
                const name = guestForm.name.trim();
                const phone = guestForm.phone.trim();
                if (name.length < 2 || phone.replace(/\D/g, "").length < 7) return;
                rememberGuest(guestForm);
                const hold = pending;
                void sendBook(hold.option, hold.departure, hold.party, guestForm);
              }}
            >
              <p className="cg-note">{pending.option.name}, {whenLine(pending.departure)}</p>
              <input value={guestForm.name} onChange={(e) => setGuestForm({ ...guestForm, name: e.target.value })} placeholder="Your name" autoComplete="name" required />
              <input value={guestForm.phone} onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })} placeholder="Mobile" autoComplete="tel" required />
              <input value={guestForm.email} onChange={(e) => setGuestForm({ ...guestForm, email: e.target.value })} placeholder="Email" autoComplete="email" />
              <button type="submit" disabled={booking}>{booking ? "Booking…" : "Book"}</button>
            </form>
          ) : null}
          {!conciergeReady() ? (
            <p className="cg-note">Ask is offline on this build.</p>
          ) : null}
        </div>

        <form
          className="cg-input"
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft;
            setDraft("");
            void ask(v);
          }}
        >
          <label htmlFor={inputId} className="cg-sr">What do you want to do?</label>
          <input
            id={inputId}
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="escape room in Waterloo tonight, 4 of us"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={300}
          />
          {/*
            While it works the send button is a stop button. A guest who has changed their mind can already
            type over it, since a second question cancels the first, but somebody watching a shop take its twelve
            seconds needs a way out that does not require thinking of another question first.
          */}
          {busy ? (
            <button
              type="button"
              className="cg-stop"
              aria-label="Stop"
              onClick={() => {
                running.current?.abort();
                running.current = null;
                setBusy(false);
              }}
            >
              <span />
            </button>
          ) : (
            <button type="submit" aria-label="Ask" disabled={!draft.trim()}>
              <Markup html={ICONS.send} />
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

/**
 * Every conversation this device remembers.
 *
 * It exists to be read back and quoted. The agent keeps its own sessions for two hours and loses them when it
 * restarts, so this is the copy that survives, and "Copy" hands the whole exchange over as plain text: the
 * questions, what it read out of them, every business and every price it put on screen. That is the loop this
 * gets better through, somebody pasting a wrong answer at whoever can fix it.
 */
function HistoryPanel({
  list,
  currentId,
  copied,
  onOpen,
  onCopy,
  onDrop,
  onClear,
  onClose,
}: {
  list: Conversation[];
  currentId: string | null;
  copied: string;
  onOpen: (c: Conversation) => void;
  onCopy: (c: Conversation) => void;
  onDrop: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="cg-hist">
      <div className="cg-histtop">
        <b>Past conversations</b>
        <button type="button" className="cg-tool" onClick={onClear} disabled={!list.length}>Clear all</button>
        <button type="button" className="cg-x" onClick={onClose} aria-label="Close history">
          <Markup html={ICONS.close} />
        </button>
      </div>
      {list.length ? (
        <ul className="cg-histlist">
          {list.map((c) => {
            const asks = c.turns.filter((t) => !t.auto).length;
            return (
              <li key={c.id} className={c.id === currentId ? "on" : ""}>
                <button type="button" className="cg-histopen" onClick={() => onOpen(c)}>
                  <b>{titleOf(c)}</b>
                  <small>
                    {whenLabel(c.lastAt)} · {asks === 1 ? "1 question" : asks + " questions"}
                    {c.id === currentId ? " · on screen" : ""}
                  </small>
                </button>
                <span className="cg-histacts">
                  <button type="button" className="cg-tool" onClick={() => onCopy(c)}>{copied === c.id ? "Copied" : "Copy"}</button>
                  <button type="button" className="cg-tool" onClick={() => onDrop(c.id)} aria-label={"Delete " + titleOf(c)}>Delete</button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="cg-note">Nothing yet. Ask something and it will be here after a reload.</p>
      )}
    </div>
  );
}


/**
 * What it is doing, while it does it.
 *
 * Three bouncing dots for twelve seconds is indistinguishable from a hang, and it also throws away the most
 * persuasive thing on the screen: that the wait is a dozen booking systems being read one after another. So
 * the wait says what it is on, keeps the two lines before it so movement is visible, and runs a clock. The
 * clock matters twice over in a demo: it is the proof this is happening now rather than out of a cache.
 */
function Working({ steps, status, elapsed }: { steps: ConciergeStep[]; status: string | null; elapsed: number }) {
  // Newest last in the trace; newest first here, because the one it is on belongs at the top next to the clock.
  const said: string[] = [];
  for (let i = steps.length - 1; i >= 0 && said.length < 4; i--) {
    const line = stepLine(steps[i]);
    if (line && !said.includes(line)) said.push(line);
  }
  const behind = said.slice(1);

  return (
    <div className="cg-work" aria-label="Checking who's free">
      <div className="cg-work-top">
        <span className="cg-work-dot" aria-hidden="true" />
        <b>{status || "Checking who's free"}</b>
        <span className="cg-work-clock">{(elapsed / 10).toFixed(1)}s</span>
      </div>
      {behind.length ? (
        <ul className="cg-work-past">
          {behind.map((line, i) => (
            <li key={line} style={{ opacity: 0.66 - i * 0.18 }}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The receipt under an answer: what was checked, how long it took, and every step on request.
 *
 * Closed it is one quiet line, because a guest booking a jet ski does not want a log. Open it is the whole
 * trace the agent wrote about itself: the shops it asked, the ones that timed out, the budget it applied,
 * the calendars it read. That is the part that makes somebody believe the times on the screen, and it is the
 * difference between a chat interface and evidence, and it is exactly what a demo needs to be able to show
 * on purpose rather than hope somebody catches it going past.
 */
function Trace({ answer, steps }: { answer: ConciergeAnswer; steps: ConciergeStep[] }) {
  const [open, setOpen] = useState(false);
  const asked = new Set(steps.filter((s) => s.kind === "ask").map((s) => s.text)).size;
  const live = new Set(
    answer.options.filter((o) => o.departures.length).map((o) => o.domain),
  ).size;

  const bits: string[] = [];
  if (asked) bits.push(asked === 1 ? "1 booking system read" : asked + " booking systems read");
  else if (answer.counts.total) bits.push(answer.counts.total === 1 ? "1 place checked" : answer.counts.total + " places checked");
  if (live) bits.push(live === 1 ? "1 live calendar" : live + " live calendars");
  if (answer.ms) bits.push((answer.ms / 1000).toFixed(1) + "s");

  return (
    <div className={"cg-receipt" + (open ? " on" : "")}>
      <button
        type="button"
        className="cg-receipt-top"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        disabled={!steps.length}
      >
        <span className="cg-receipt-mark" aria-hidden="true" />
        <span className="cg-receipt-line">{bits.join(" · ") || "Checked live"}</span>
        {steps.length ? <span className="cg-receipt-more">{open ? "Hide" : "How I got this"}</span> : null}
      </button>
      {open && steps.length ? (
        <ol className="cg-trace">
          {steps.map((s, i) => (
            <li key={i} className={"cg-t-" + tone(s.kind)}>
              <span className="cg-trace-at">{(s.ms / 1000).toFixed(1)}s</span>
              <span className="cg-trace-kind">{s.kind}</span>
              <span className="cg-trace-text">
                {s.text}
                {s.detail ? <em>{s.detail}</em> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * How a step reads at a glance. Only three tones, because a trace where every line is a different colour is
 * a trace nobody scans: what went right, what went wrong, and everything the agent merely decided.
 */
function tone(kind: string): "go" | "warn" | "dim" {
  if (kind === "answer" || kind === "catalog" || kind === "resolve" || kind === "compare") return "go";
  if (kind === "timeout" || kind === "skip" || kind === "loosen" || kind === "widen" || kind === "budget") return "warn";
  return "dim";
}

/** The rating a shop carries, said in one short string, or nothing when nobody has rated it. */
function stars(o: ConciergeOption): string | null {
  if (o.rating == null) return null;
  return "★ " + o.rating.toFixed(1) + (o.reviews ? " (" + o.reviews.toLocaleString() + ")" : "");
}

/**
 * One answer, said the way somebody behind a counter would say it: the finding first, in a sentence, then the
 * businesses, then anything that qualifies them, then the receipt.
 *
 * The order of the businesses is `payload()`'s own: live times first, then the shops we can at least price off
 * their own site, then the ones that publish nothing. A guest is never shown an empty screen, which is the
 * rule the backend holds to as well.
 */
function Answered({
  answer,
  steps,
  onAsk,
  onOpen,
  onBook,
}: {
  answer: ConciergeAnswer;
  steps: ConciergeStep[];
  onAsk: (text: string) => void;
  onOpen: (o: ConciergeOption, d?: ConciergeDeparture) => void;
  onBook: (o: ConciergeOption, d: ConciergeDeparture, party: number) => void;
}) {
  const { quoted, priced, rest } = splitOptions(answer.options);

  /**
   * A question back, with its answers ready to tap and the box still the answer.
   *
   * The chips are a shortcut, never the only way through. Offering three of them to somebody who has just
   * typed a whole sentence reads as the product not listening, so they sit under a line that says plainly
   * that anything typed works too.
   */
  if (answer.followUp) {
    return (
      <div className="cg-answer">
        {/*
          What it took from the sentence, above what it still needs, as separate pills rather than one grey
          line. Somebody who wrote out their party, their budget, the day and the place and got back a four
          item menu concluded it had not listened. It had; it only lacked an activity, and reading back the
          five things it did get, one chip each, is the whole difference.
        */}
        <Read answer={answer} />
        <div className="cg-b cg-them">{answer.followUp.question}</div>
        {answer.followUp.choices.length ? (
          <div className="cg-chips">
            {answer.followUp.choices.map((c) => (
              <button type="button" key={c.text} onClick={() => onAsk(c.text)}>
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
        <p className="cg-note">Or just tell me in your own words.</p>
      </div>
    );
  }

  const party = answer.intent?.party || 2;
  const shown = spreadDepartures(quoted, 4);
  const shops = groupShops(shown);
  const line = headline(answer, shown);
  const missed = missedTheHour(answer, shown);
  // An offer to narrow arrives WITH the results rather than in front of them, which is the whole reason the
  // funnel stopped gating an answer behind a question.
  const narrow = answer.narrow?.choices?.length ? answer.narrow : null;
  const next = refinements(answer, shown);
  const unread = priced.length ? priced : rest;

  if (!answer.options.length) {
    return <div className="cg-b cg-them">I could not find anywhere for that. Try another town or activity.</div>;
  }

  return (
    <div className="cg-answer">
      {answer.loosened ? <div className="cg-b cg-them cg-loosened">{answer.loosened}</div> : null}
      {line ? <p className="cg-say">{line}</p> : null}
      <Read answer={answer} />
      {missed ? <p className="cg-note">Nothing at that exact time. These are the closest.</p> : null}

      {shops.length ? (
        shops.map((shop) => (
          <Shop key={shop.option.domain} option={shop.option} slots={shop.slots} party={party} onOpen={onOpen} onBook={onBook} />
        ))
      ) : (
        <>
          {/*
            Why there are no times on these, said as our own limitation rather than as a claim about the
            shop. Most of them do publish their availability; we cannot read their page yet, and a guest told
            to phone a shop that takes bookings online is the product looking broken.
          */}
          <p className="cg-note">{noTimesLine(unread.slice(0, 4))}</p>
          {unread.slice(0, 4).map((o) => (
            <Priced key={o.domain} option={o} onOpen={onOpen} />
          ))}
        </>
      )}

      <Trace answer={answer} steps={steps} />

      {/*
        What a person says next, in one row: the agent's own offer to narrow first, then the standing actions.
        `plan.ts` reads every one of these out of a sentence already and almost nobody would think to type
        them, so a shortlist with no way to push back on it is a dead end.
      */}
      {narrow ? <p className="cg-note">{narrow.question}</p> : null}
      {narrow || next.length ? (
        <div className="cg-chips cg-actions">
          {narrow?.choices.map((c) => (
            <button type="button" key={c.text} onClick={() => onAsk(c.text)}>
              {c.label}
            </button>
          ))}
          {next.map((r) => (
            <button type="button" className="cg-quiet" key={r.text} onClick={() => onAsk(r.text)}>
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** What the agent took from the sentence, one chip per thing, or nothing when it took nothing worth saying. */
function Read({ answer }: { answer: ConciergeAnswer }) {
  const got = understood(answer);
  if (!got) return null;
  return (
    <div className="cg-read" aria-label="What I understood">
      {got.split(" · ").map((bit) => (
        <span className="cg-readbit" key={bit}>
          {bit}
        </span>
      ))}
    </div>
  );
}

/**
 * One shop, its open times, one Book on each time.
 *
 * Three rides at the same dock used to be three cards, each with a listing link and a calendar credit. A guest
 * paying for a jet ski wants the time and the price, so the shop is the card and its times are rows inside it.
 */
function Shop({
  option,
  slots,
  party,
  onOpen,
  onBook,
}: {
  option: ConciergeOption;
  slots: { departure: ConciergeDeparture; offset: number | null }[];
  party: number;
  onOpen: (o: ConciergeOption, d?: ConciergeDeparture) => void;
  onBook: (o: ConciergeOption, d: ConciergeDeparture, party: number) => void;
}) {
  const sameDay = slots.length > 0 && slots.every((s) => s.departure.date === slots[0].departure.date);
  const day = sameDay ? whenLine({ date: slots[0].departure.date, time: "" }) : null;
  const rated = stars(option);
  return (
    <article className="cg-card">
      <div className="cg-card-top">
        <button type="button" className="cg-card-name" onClick={() => onOpen(option, slots[0]?.departure)}>
          <b>{option.name}</b>
          <small>{[option.city, rated].filter(Boolean).join(" · ")}</small>
        </button>
        {/*
          Whose calendar these times came out of.

          This is the claim the whole product rests on: not our guess at their availability, theirs. It is a
          fact about the shop rather than about any one departure, so it sits once at the top of the card,
          and it is the loudest quiet thing on the screen because it is the reason to believe the rest.
        */}
        {option.via ? (
          <span className="cg-live" title={"Read live from " + option.via}>
            <i aria-hidden="true" />
            Live
          </span>
        ) : null}
      </div>
      {option.via ? <p className="cg-source">Read from {option.via} just now</p> : null}
      {day ? <p className="cg-day">{day}</p> : null}

      <div className="cg-slots">
        {slots.map(({ departure, offset }) => {
          const few = fewSeats(departure.seatsLeft ?? undefined);
          return (
            <div className="cg-slot" key={departure.date + departure.time + departure.item}>
              <div className="cg-slot-when">
                <span className="cg-slot-time">{fmtTime(departure.time)}</span>
                {offset != null ? (
                  <em className={offset === 0 ? "cg-onthehour" : "cg-off"}>{offsetLine(offset)}</em>
                ) : null}
                {departure.item ? <small>{departure.item}</small> : null}
              </div>
              <div className="cg-slot-right">
                <span className="cg-price">{priceLine(departure)}</span>
                {/*
                  Seats left whenever the vendor states them, not only when they are running out. A real
                  remaining count is the strongest thing on the row that says this was read a second ago
                  rather than crawled last week. It turns warm once there are few enough to matter.
                */}
                {departure.seatsLeft != null && departure.seatsLeft > 0 ? (
                  <span className={few ? "cg-few" : "cg-seats"}>
                    {few ? "Only " : ""}
                    {departure.seatsLeft} left
                  </span>
                ) : null}
                <button type="button" className="cg-book" onClick={() => onBook(option, departure, party)}>
                  Book
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button type="button" className="cg-ghost" onClick={() => onOpen(option, slots[0]?.departure)}>
        Photos, prices and what to bring
      </button>
    </article>
  );
}

/**
 * A shop we can price but not time: its cheapest published figure, and a way through to its page.
 *
 * Quieter than a live card on purpose. A menu price read off their website last week and a seat read off
 * their calendar a second ago are not the same claim, and the two must never look alike on one screen.
 */
function Priced({ option, onOpen }: { option: ConciergeOption; onOpen: (o: ConciergeOption) => void }) {
  const s = headlineService(option);
  const line = s ? serviceLine(s) : null;
  const rated = stars(option);
  const phone = option.route === "phone" ? option.phone : null;
  return (
    <article className="cg-card cg-quietcard">
      <div className="cg-card-top">
        <button type="button" className="cg-card-name" onClick={() => onOpen(option)}>
          <b>{option.name}</b>
          <small>{[option.city, rated].filter(Boolean).join(" · ") || option.category}</small>
        </button>
        <span className="cg-tag">{phone ? "By phone" : "From their site"}</span>
      </div>
      <div className="cg-quietrow">
        <span className="cg-price">
          {line || "Price on request"}
          {s?.name ? <em>{s.name}</em> : null}
        </span>
        {phone ? (
          <a className="cg-ghost cg-call" href={"tel:" + phone.replace(/[^\d+]/g, "")}>
            Call {phone}
          </a>
        ) : (
          <button type="button" className="cg-ghost" onClick={() => onOpen(option)}>
            See their times
          </button>
        )}
      </div>
    </article>
  );
}
