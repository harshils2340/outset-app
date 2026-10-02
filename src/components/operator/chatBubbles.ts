/**
 * The bubbles in the operator's test chat on the Assistant page, and which one a late answer belongs to.
 *
 * `companyAnswer` marks an answer `gap` when the rules had no fact for the question, and `askOttoModel` then
 * reads the same published facts and may come back with something better (src/lib/ottoModel.ts). That answer
 * arrives whenever the network says so, which is after the next question has been asked and sometimes out of
 * the order the questions were asked in. So a bubble has to be named, and the name has to be its own.
 *
 * It used to be named by its text: the pending bubble was found with `x.pending && x.t === a.text`. The gap
 * line is a canned sentence ("They haven't published that."), so two questions in a row that both fall
 * through to the model left two bubbles reading exactly the same thing, and the first answer back replaced
 * both of them while the second was dropped on the floor. On the page that promises "same answers guests
 * get", an operator read the answer to their last question under this one. The guest side never had this: it
 * settles by the bubble's index (`chatSettled` in AppProvider).
 */

export type Bubble = {
  /** Unique per bubble, for the whole life of the panel: what a late answer settles. */
  id: string;
  who: "me" | "them";
  t: string;
  /** The rules answered with a gap line and the grounded model is still being asked. */
  pending?: boolean;
};

let n = 0;
export function bubbleId(): string {
  n += 1;
  return "b" + n + "." + Math.random().toString(36).slice(2, 7);
}

/** The guest's question and the answer under it, the answer marked pending when the model is still to come. */
export function askedBubbles(question: string, answer: string, pending: boolean): [Bubble, Bubble] {
  return [
    { id: bubbleId(), who: "me", t: question },
    { id: bubbleId(), who: "them", t: answer, ...(pending ? { pending: true } : {}) },
  ];
}

/**
 * One bubble settled by the grounded model. `text` null means the model had nothing better than the rules'
 * line, which the bubble is already holding. A bubble that is not pending any more is left alone, so a second
 * answer for the same bubble cannot overwrite the first.
 */
export function settleBubble(msgs: Bubble[], id: string, text: string | null): Bubble[] {
  if (!msgs.some((m) => m.id === id && m.pending)) return msgs;
  return msgs.map((m) => (m.id === id && m.pending ? { id: m.id, who: m.who, t: text || m.t } : m));
}
