import { useCallback, useEffect, useId, useRef, useState } from "react";
import "../../styles/concierge.css";
import { ALL_METRO_ID, metroLabel } from "../../data/metros";
import { ICONS } from "../../data/icons";
import {
  askConcierge,
  headline,
  headlineService,
  refinements,
  stepLine,
  understood,
  conciergeReady,
  listingIdFor,
  menuPrice,
  missedTheHour,
  noTimesLine,
  offsetLine,
  priceLine,
  resetConcierge,
  serviceLine,
  splitOptions,
  spreadDepartures,
  whenLine,
  withPlace,
  type ConciergeAnswer,
  type ConciergeDeparture,
  type ConciergeOption,
  type ConciergeStep,
} from "../../lib/concierge";
import { money } from "../../lib/format";
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
import { useApp } from "../../state/AppProvider";
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
  | { kind: "answer"; answer: ConciergeAnswer };
type Entry = Said & { id: number };

const PHONE_KEY = "outset.concierge.phone";

/** The mode this device was last left in. Wide on a laptop unless the guest chose otherwise. */
function readPhoneMode(): boolean {
  try {
    return localStorage.getItem(PHONE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePhoneMode(on: boolean): void {
  try {
    localStorage.setItem(PHONE_KEY, on ? "1" : "0");
  } catch {
    /* Private window: the toggle still works, it just will not be remembered. */
  }
}

const OPENER = "Tell me what you want to do and roughly where. I will check what is actually free right now.";

/** Colour by the kind of step, so a wall of lines still reads at a glance. Mirrors the panel on `/go`. */
const STEP_TONE: Record<string, string> = {
  read: "biz", carry: "biz", clock: "biz", catalog: "go", ask: "go", answer: "go",
  assume: "warn", widen: "warn", loosen: "warn", question: "hot", ambiguous: "hot",
  skip: "dim", compare: "lit",
};

export function WebConcierge({ seed, framed, onClose }: { seed?: string; framed?: boolean; onClose: () => void }) {
  const { state, openRequest } = useApp();
  /**
   * The opening line is the first render, not a timer that fires into it. As a delayed `add` it could be
   * written twice: the effect below re-runs whenever the guest's place settles, and a cleared timeout either
   * loses the line or, guarded the other way, writes a second one under the first.
   */
  const [entries, setEntries] = useState<Entry[]>(() => (seed ? [] : [{ kind: "them", text: OPENER, id: 0 }]));
  const [steps, setSteps] = useState<ConciergeStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  /**
   * The phone. A toggle rather than a breakpoint, because on a laptop the wide layout is the one that shows
   * the agent working and the narrow one is the product as a guest holds it, and testing means wanting each
   * on purpose. Remembered, so the mode survives a reload the way the conversation does.
   */
  const [phone, setPhone] = useState(readPhoneMode);
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
   * The place the home already opened on, as a sentence the reader understands. A point the guest chose or one
   * read off their connection is a town; a metro is the city we filed them under. "Anywhere" is not a place,
   * so it is not offered, and then the agent asks, which is the right thing to do rather than guess a country.
   */
  const place = state.near?.label || (state.metroId !== ALL_METRO_ID ? metroLabel(state.metroId) : null);

  /** The newest step worth saying out loud, so a long wait says what it is waiting on. */
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
   */
  useModal(box);

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

  // Escape closes, as every other overlay on the site does.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Innermost first: the transcript, then the history, then the overlay itself.
      if (manualRef.current) setManual("");
      else if (history) setHistory(null);
      else onClose();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [onClose, history]);

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
      autoNext.current = !!opts.auto;
      setSteps([]);
      setBusy(true);

      // Only the opening question carries the guest's place; after that the agent is holding the conversation
      // and appending a town to "and something cheaper?" would overrule what it already knows.
      const sentence = session.current ? text : withPlace(text, place);
      // It was their own place that went in, so it is said out loud once, the way every other guess is.
      if (!session.current && place && sentence !== text) {
        add({ kind: "note", text: `Looking around ${place}, because that is where you are. Name another town and I will redo it.` });
      }
      const r = await askConcierge(sentence, {
        session: session.current,
        onStep: (s) => {
          if (!gone.current) setSteps((cur) => (cur.length > 220 ? [...cur.slice(-200), s] : [...cur, s]));
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
        add({ kind: "note", text: `Looking around ${place}, because that is where you are. Name another town and I will redo it.` });
        void ask(place, { silent: true, auto: true });
        return;
      }

      setBusy(false);
      add({ kind: "answer", answer: r.answer });
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

  const copyCurrent = () => {
    if (!convo.current) return;
    void copyOut(transcript(convo.current), "current");
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
    setSteps([]);
    setHistory(null);
    session.current = c.id;
    convo.current = c;
    placeGiven.current = true;
    asked.current = seed ?? null;
    nextId.current = 1;
    const back: Entry[] = [];
    for (const t of c.turns) {
      if (!t.auto) back.push({ kind: "me", text: t.q, id: nextId.current++ });
      if (t.answer) back.push({ kind: "answer", answer: t.answer, id: nextId.current++ });
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
    /*
     * The shared link's question stays asked, the way reopening a past conversation leaves it asked.
     *
     * Clearing it re-armed the opening effect, which re-runs whenever `ask` is rebuilt, and `ask` is rebuilt
     * whenever the guest's place changes. `AppProvider` refines that place from the network after the first
     * render, and its "do not interrupt a guest mid-thought" guard only covers a sheet, which this overlay
     * deliberately is not. So a guest who opened an `#ask=` link, pressed New and started typing could have
     * the link's own question re-ask itself into their fresh thread a second later.
     */
    asked.current = seed ?? null;
    setEntries([{ kind: "them", text: OPENER, id: 0 }]);
    setSteps([]);
    setBusy(false);
    nextId.current = 1;
    inputRef.current?.focus();
  };

  /** A business we already hold a page for opens that page. Anything else opens the shop's own booking site. */
  const open = (o: ConciergeOption, d?: ConciergeDeparture) => {
    const id = listingIdFor(o);
    if (id) {
      onClose();
      window.scrollTo(0, 0);
      openRequest(id);
      return;
    }
    const url = d?.bookUrl || o.bookingUrl;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div ref={box} className={"cg" + (framed ? " cg-framed" : "") + (phone && !framed ? " cg-asphone" : "")} role="dialog" aria-modal="true" aria-label="Ask Outset for anything">
      <section className="cg-thread">
        <header className="cg-top">
          <Mark size={30} />
          <span className="cg-who">
            <b>Ask Outset</b>
            <small>{place ? "Real times near " + place : "Real times at real businesses"}</small>
          </span>
          <div className="cg-tools">
            <button type="button" className="cg-tool" onClick={() => setHistory(history ? null : loadConversations())} aria-pressed={!!history} title="Past conversations">
              History
            </button>
            {/* Copies the whole exchange as plain text, so a wrong answer can be pasted at whoever can fix it. */}
            <button type="button" className="cg-tool" onClick={() => copyCurrent()} disabled={!convo.current?.turns.length}>
              {copied === "current" ? "Copied" : "Copy"}
            </button>
            {!framed ? (
              <button type="button" className="cg-tool" onClick={() => { const n = !phone; setPhone(n); writePhoneMode(n); }} aria-pressed={phone} title="Swap between the phone and the wide view">
                {phone ? "Wide" : "Phone"}
              </button>
            ) : null}
            <button type="button" className="cg-tool" onClick={startOver} disabled={!session.current && entries.length < 2}>
              New
            </button>
          </div>
          <button type="button" className="cg-x" onClick={onClose} aria-label="Close">
            <Markup html={ICONS.close} />
          </button>
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
            <p className="cg-note">Your browser would not let the page write to the clipboard, which is normal over plain http. It is selected already.</p>
            <textarea ref={manualRef} className="cg-manualtext" readOnly value={manual} aria-label="The conversation as text" />
          </div>
        ) : null}

        <div className="cg-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
          {entries.map((e) =>
            e.kind === "answer" ? (
              <Answered key={e.id} answer={e.answer} onAsk={ask} onOpen={open} />
            ) : e.kind === "note" ? (
              <p className="cg-note" key={e.id}>{e.text}</p>
            ) : (
              <div className={"cg-b cg-" + e.kind} key={e.id}>
                <span className="cg-sr">{e.kind === "me" ? "You: " : "Outset: "}</span>
                {e.text}
              </div>
            ),
          )}
          {busy ? (
            <>
              <div className="cg-typing" aria-label="Checking with the shops">
                <i /><i /><i />
              </div>
              {/*
                What it is doing, for the wait the panel beside it cannot cover. A cold shop is given twelve
                seconds because it is worth waiting for, and twelve seconds of bouncing dots reads as a hang.
              */}
              {status ? <p className="cg-note cg-status">{status}</p> : null}
            </>
          ) : null}
          {!conciergeReady() ? (
            <p className="cg-note">This build has no API to ask, so there is nothing live to read. Set VITE_API_URL and it works.</p>
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
            placeholder="escape room tonight, 4 of us"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={300}
          />
          <button type="submit" aria-label="Ask" disabled={!draft.trim()}>
            <Markup html={ICONS.send} />
          </button>
        </form>
      </section>

      {/*
        What the agent is doing, while it does it. Not decoration: the phone thread on its own reads like any
        other chatbot, and the point of this product is that these are real businesses answering out of their
        real calendars. Hidden on a narrow screen, where the thread is the whole product.
      */}
      <aside className="cg-stage" aria-hidden="true">
        <h2>What the agent is doing</h2>
        <div className="cg-steps">
          {steps.map((s, i) => (
            <div className="cg-step" key={i}>
              <span className="cg-ms">{s.ms}ms</span>
              <span className={"cg-kind t-" + (STEP_TONE[s.kind] || "lit")}>{s.kind}</span>
              <span className="cg-text">{s.text}</span>
              {s.detail ? <span className="cg-detail">{s.detail}</span> : null}
            </div>
          ))}
          {!steps.length ? <p className="cg-idle">Ask something and watch it read their booking systems.</p> : null}
        </div>
      </aside>
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
 * One answer, said the way somebody behind a counter would say it: the finding first, in a sentence, then the
 * businesses, then anything that qualifies them.
 *
 * The order of the businesses is `payload()`'s own: live times first, then the shops we can at least price off
 * their own site, then the ones that publish nothing. A guest is never shown an empty screen, which is the
 * rule the backend holds to as well.
 */
function Answered({
  answer,
  onAsk,
  onOpen,
}: {
  answer: ConciergeAnswer;
  onAsk: (text: string) => void;
  onOpen: (o: ConciergeOption, d?: ConciergeDeparture) => void;
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
    const got = understood(answer);
    return (
      <>
        {/*
          What it took from the sentence, above what it still needs. A guest who wrote out the party, the
          budget, the day, the hour and the place and got back a four item menu concluded it had not listened.
          It had; it only lacked an activity. This line is the whole difference.
        */}
        {got ? <p className="cg-note cg-got">Got: {got}</p> : null}
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
      </>
    );
  }

  const shown = spreadDepartures(quoted, 4);
  // The shops in the comparison that the live list did not already show, so nothing appears twice.
  const seen = new Set(shown.map((p) => p.option.domain));
  const alsoPriced = priced.filter((o) => !seen.has(o.domain)).slice(0, 3);
  const line = headline(answer, shown);
  const missed = missedTheHour(answer, shown);
  const next = refinements(answer, shown);
  // An offer to narrow, which arrives with the results rather than in front of them.
  const narrow = answer.narrow?.choices?.length ? answer.narrow : null;
  const got = narrow ? understood(answer) : "";

  if (!answer.options.length) {
    return <div className="cg-b cg-them">I could not find anywhere for that. Try another activity, or a bigger town nearby.</div>;
  }

  return (
    <>
      {/*
        What the search could not honour, said before what it found.
        
        This is the honest version of an empty result. A guest who capped the budget at $50 a head and is being
        shown $95 tickets needs that sentence to carry more weight than the list under it, or the cap looks
        like it was applied when it was not. As a plain grey bubble above a bolder headline it read as
        throat-clearing, which is the one thing it must not read as.
      */}
      {answer.loosened ? <div className="cg-b cg-them cg-loosened">{answer.loosened}</div> : null}

      {/*
        The answer, in one sentence: what was found, where, and what it costs. Everything that qualifies it
        sits under the list instead, so nothing stands between the question and the businesses.
      */}
      {line ? <div className="cg-b cg-them cg-compare">{line}</div> : null}
      {/* Still narrowing means it is not sure it has what they meant, so it shows its reading of the sentence. */}
      {narrow && got ? <p className="cg-note cg-got">Got: {got}</p> : null}
      {missed ? <p className="cg-note">Nothing at exactly that time, so these are the closest.</p> : null}

      {/*
        Whichever pile has something in it, in the order `payload()` ranks them.
        
        `rest` used to be dropped on the floor, and that is a real answer thrown away: a shop with no readable
        feed and no price our crawl caught is still a business near the guest, and `counts.total` had already
        told them it existed. It surfaced the day the budget filter started dropping over-cap prices, which
        emptied `priced` and left a headline, a budget line and no businesses under either of them.
      */}
      {shown.length
        ? shown.map(({ option, departure, offset }, i) => (
            <Offer key={option.domain + departure.date + departure.time + i} option={option} departure={departure} offset={offset} onOpen={onOpen} />
          ))
        : (priced.length ? priced : rest).slice(0, 4).map((o) => <Priced key={o.domain} option={o} onOpen={onOpen} />)}

      {shown.length && alsoPriced.length ? (
        <>
          <p className="cg-note">Also nearby, priced but without a time I can read:</p>
          {alsoPriced.map((o) => (
            <Priced key={o.domain} option={o} onOpen={onOpen} />
          ))}
        </>
      ) : null}

      {/* The caveat qualifies the list, so it goes under it. It used to be a paragraph in front of it. */}
      {!shown.length && priced.length ? <p className="cg-note">{noTimesLine(priced.slice(0, 4))}</p> : null}
      {!shown.length && !priced.length && rest.length ? (
        <p className="cg-note">These are near you, but they publish neither a time nor a price I can read, so I am not going to quote you one.</p>
      ) : null}
      {answer.assumptions?.length ? <p className="cg-note">Assuming {answer.assumptions.join(" and ")}. Say otherwise and I will redo it.</p> : null}

      {/*
        What a person says next, in one row.
        
        Two kinds of thing, and they belong together because to a guest they are one thing: what can I say now.
        The agent's own offer to narrow comes first, in the accent, because it is the thing it just suggested;
        the standing actions follow, quieter, because they are always available. `plan.ts` reads every one of
        these out of a sentence already, and almost nobody would think to type them.
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
    </>
  );
}

/**
 * A real departure at a real shop: what it is, when it starts, how far that is from the hour they asked for,
 * what it costs before tax, how full it is, and whose calendar it was read out of.
 *
 * The offset and the source are not decoration. A slot that has quietly slid an hour and a half is how a guest
 * misses their dinner, and "read live from their FareHarbor calendar" is the claim the whole product rests on:
 * this is not our guess at their availability, it is their availability.
 */
function Offer({
  option,
  departure,
  offset,
  onOpen,
}: {
  option: ConciergeOption;
  departure: ConciergeDeparture;
  offset: number | null;
  onOpen: (o: ConciergeOption, d?: ConciergeDeparture) => void;
}) {
  const few = fewSeats(departure.seatsLeft ?? undefined);
  // The vendor would not quote this departure, but the shop publishes a price for the activity on its own site.
  const fallback = departure.fromPrice == null ? menuPrice(option) : null;
  return (
    <button type="button" className="cg-opt" onClick={() => onOpen(option, departure)}>
      <b>{option.name}</b>
      <small>
        {departure.item}
        {option.city ? " · " + option.city : ""}
      </small>
      <small className="cg-when">
        {whenLine(departure)}
        {offset != null ? <em className={offset === 0 ? "cg-onthehour" : "cg-off"}>{offsetLine(offset)}</em> : null}
      </small>
      {option.via ? <small className="cg-via">Read live from {option.via}</small> : null}
      <span className="cg-row">
        <span className="cg-price">
          {departure.fromPrice == null && fallback != null ? money(fallback) : priceLine(departure)}
          {departure.priceLabel && departure.fromPrice != null ? <em> · {departure.priceLabel}</em> : null}
          {/* Their published price for this activity, not this departure's, so it never passes for a quote. */}
          {departure.fromPrice == null && fallback != null ? <em> from their site</em> : null}
        </span>
        {/*
          Seats left, whenever the vendor states them. Not only when they are running out: a real remaining
          count is the strongest thing on the card that says this was read from their system a second ago and
          not from a crawl last week. It turns warm once there are few enough to matter.
        */}
        {departure.seatsLeft != null && departure.seatsLeft > 0 ? (
          <span className={few ? "cg-few" : "cg-seats"}>
            {few ? "Only " : ""}
            {departure.seatsLeft} {departure.seatsLeft === 1 ? "seat" : "seats"} left
          </span>
        ) : null}
        <span className="cg-go">{listingIdFor(option) ? "See this listing" : "Book on their site"} &rarr;</span>
      </span>
    </button>
  );
}

/** No live feed, but the crawl read their own menu. A price a guest can act on beats a blank screen. */
function Priced({ option, onOpen }: { option: ConciergeOption; onOpen: (o: ConciergeOption) => void }) {
  // The cheapest row a guest could actually buy, not whichever the shop's own page happened to list first.
  const s = headlineService(option);
  const line = s ? serviceLine(s) : null;
  return (
    <button type="button" className="cg-opt" onClick={() => onOpen(option)}>
      <b>{option.name}</b>
      <small>
        {s?.name || option.category}
        {option.city ? " · " + option.city : ""}
        {option.rating ? " · " + option.rating + "★" : ""}
      </small>
      <span className="cg-row">
        <span className="cg-price">{line || "Price on request"}</span>
        <span className="cg-go soft">{option.route === "phone" ? "We would call them" : "Check their times"} &rarr;</span>
      </span>
    </button>
  );
}
