import { headline, headlineService, offsetLine, priceLine, serviceLine, splitOptions, spreadDepartures, whenLine, type ConciergeAnswer } from "./concierge";
import { money } from "./format";

/**
 * Every conversation the guest has had with the concierge, kept on their own device.
 *
 * Two jobs, and the second is the one that matters. The first is ordinary: a thread that survives a reload,
 * so asking something is not a thing you lose by navigating away. The second is that a conversation has to
 * come back OUT as plain text, because the way this gets better is somebody reading a bad answer, copying the
 * whole exchange, and pasting it at whoever can fix it. An answer you cannot quote is an answer you cannot
 * report.
 *
 * On the device only. The agent keeps its own sessions in memory with a two-hour TTL and they die with the
 * process, so this is the copy that outlives a restart. It holds what the guest was actually shown, which is
 * also the only version worth arguing about.
 */

const KEY = "outset.concierge.v1";
/** Enough to scroll back through a morning of testing without filling a 5 MB origin. */
const MAX_CONVERSATIONS = 25;
const MAX_TURNS = 40;

export type Turn = {
  /** What the guest typed, or what the app asked on their behalf. */
  q: string;
  at: number;
  ms: number;
  /** The answer as it was rendered. Null when the ask failed, in which case `error` says how. */
  answer: ConciergeAnswer | null;
  error?: string;
  /** True when the app supplied the sentence, so a transcript does not put words in the guest's mouth. */
  auto?: boolean;
};

export type Conversation = { id: string; startedAt: number; lastAt: number; turns: Turn[] };

/* ---------- storage ---------- */

function isTurn(v: unknown): v is Turn {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return typeof t.q === "string" && typeof t.at === "number" && Number.isFinite(t.at) && (t.answer === null || typeof t.answer === "object");
}

function isConversation(v: unknown): v is Conversation {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === "string" && !!c.id && typeof c.startedAt === "number" && Array.isArray(c.turns) && c.turns.every(isTurn);
}

/**
 * Every conversation this device remembers, newest first.
 *
 * A row that no longer fits the shape is dropped rather than taking the list with it, the way `storage.ts`
 * treats a stale booking: a build that changed the answer's shape should cost the guest one conversation, not
 * all of them.
 */
export function loadConversations(): Conversation[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(isConversation).sort((a, b) => b.lastAt - a.lastAt);
  } catch {
    return [];
  }
}

function write(list: Conversation[]): void {
  const trimmed = list.slice(0, MAX_CONVERSATIONS);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Out of room, almost always because one answer carried a long departure list. Halve the history and try
    // once more; losing the oldest conversations is better than losing the one just had.
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2)))));
    } catch {
      /* A private window with storage off. The thread still works, it just will not be there tomorrow. */
    }
  }
}

/** Record one exchange against its conversation, creating the conversation the first time. */
export function rememberTurn(id: string, turn: Turn): Conversation[] {
  if (!id) return loadConversations();
  const list = loadConversations();
  const found = list.find((c) => c.id === id);
  if (found) {
    found.turns = [...found.turns, turn].slice(-MAX_TURNS);
    found.lastAt = turn.at;
  } else {
    list.unshift({ id, startedAt: turn.at, lastAt: turn.at, turns: [turn] });
  }
  const next = list.sort((a, b) => b.lastAt - a.lastAt);
  write(next);
  return next;
}

export function forgetConversation(id: string): Conversation[] {
  const next = loadConversations().filter((c) => c.id !== id);
  write(next);
  return next;
}

export function forgetEverything(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/* ---------- reading it back ---------- */

/** What a conversation was about, for a list of them: the first thing actually asked. */
export function titleOf(c: Conversation): string {
  const first = c.turns.find((t) => !t.auto && t.q.trim());
  return (first?.q || c.turns[0]?.q || "Untitled").trim();
}

/** "6:42 AM" today, "Fri 6:42 AM" this week, otherwise the date. Short enough for a narrow list. */
export function whenLabel(at: number, now: Date = new Date()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const days = Math.round((now.getTime() - at) / 86400000);
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + time;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ---------- the part that exists so a bad answer can be reported ---------- */

/**
 * One exchange as plain text: the question, then exactly what was put on the screen.
 *
 * Written to be pasted, not read here. Every number that appeared is in it, because the whole point of
 * copying an answer is that the person receiving it can see the $20.14 infant fare without being in the room.
 */
export function turnText(t: Turn): string {
  const lines: string[] = [];
  lines.push((t.auto ? "> (app answered) " : "> ") + t.q);
  if (!t.answer) {
    lines.push("  " + (t.error || "no answer"));
    return lines.join("\n");
  }
  const a = t.answer;
  const i = a.intent;
  if (i) {
    const read = [i.categoryLabel, i.city, i.party ? i.party + " people" : null, i.when && i.when !== "any" ? i.when : null,
      i.atMinute != null ? Math.floor(i.atMinute / 60) + ":" + String(i.atMinute % 60).padStart(2, "0") : null,
      i.maxTotal != null ? money(i.maxTotal) + " total" : i.maxPerPerson != null ? money(i.maxPerPerson) + "/head" : null].filter(Boolean);
    if (read.length) lines.push("  read: " + read.join(" · "));
  }
  if (a.assumptions?.length) lines.push("  assumed: " + a.assumptions.join(", "));
  if (a.followUp) {
    lines.push("  asked back: " + a.followUp.question + "  [" + a.followUp.choices.map((c) => c.label).join(" / ") + "]");
    return lines.join("\n");
  }
  if (a.loosened) lines.push("  ! " + a.loosened);

  const { quoted, priced, rest } = splitOptions(a.options);
  const shown = spreadDepartures(quoted, 4);
  const head = headline(a, shown);
  if (head) lines.push("  " + head);

  for (const { option, departure, offset } of shown) {
    const bits = [whenLine(departure), offset != null ? "(" + offsetLine(offset) + ")" : null, priceLine(departure),
      departure.priceLabel, departure.seatsLeft != null ? departure.seatsLeft + " seats left" : null, option.via].filter(Boolean);
    lines.push("    " + option.name + " - " + departure.item);
    lines.push("      " + bits.join(" · "));
  }
  /*
   * The priced shops, chosen and quoted the way the screen chose and quoted them.
   *
   * Two ways this said something the guest never saw. It took the first priced row off the shop's own page,
   * and the crawl returns them in page order, so a site listing "Child (under 12) $15" above "Adult $30" was
   * copied out as $15: the very defect `headlineService` exists to fix, reintroduced in the one place whose
   * job is to say what was on the screen. And it listed no priced shop at all whenever a live time was found,
   * while the screen shows up to three of them under "Also nearby, priced but without a time I can read", so
   * a transcript quietly dropped businesses the guest was looking at. Mirrors `Answered` in WebConcierge.
   */
  const seen = new Set(shown.map((p) => p.option.domain));
  const alsoPriced = shown.length ? priced.filter((o) => !seen.has(o.domain)).slice(0, 3) : priced.slice(0, 4);
  for (const o of alsoPriced) {
    const s = headlineService(o);
    lines.push("    " + o.name + (o.city ? " · " + o.city : "") + " - " + (s ? serviceLine(s) : "price on request") + " · route " + o.route);
  }
  if (!shown.length && !priced.length) {
    for (const o of rest.slice(0, 4)) lines.push("    " + o.name + (o.city ? " · " + o.city : "") + " - nothing published · route " + o.route);
  }
  if (a.narrow?.choices?.length) lines.push("  offered: " + a.narrow.choices.map((c) => c.label).join(" / "));
  lines.push("  " + a.counts.quoted + " with live times, " + a.counts.priced + " priced, " + a.counts.total + " found · " + a.ms + "ms");
  return lines.join("\n");
}

/** A whole conversation as plain text, with a header saying when and against which agent session. */
export function transcript(c: Conversation): string {
  const when = new Date(c.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return [`Outset concierge · ${when} · session ${c.id}`, "", ...c.turns.map(turnText)].join("\n");
}

/**
 * Put text on the clipboard, and say whether it worked.
 *
 * `navigator.clipboard` does not exist on an insecure origin, and the whole point of this is testing the site
 * from a phone over the LAN, which is plain http. So the old `execCommand` path is not legacy cruft here, it
 * is the path that will actually run.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Fall through: permissions can refuse even where the API exists. */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Off screen but still focusable, and readonly so a phone keyboard does not appear on the way past.
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
