import assert from "node:assert/strict";
import test from "node:test";
import { askedBubbles, bubbleId, settleBubble, type Bubble } from "../../components/operator/chatBubbles";

/**
 * Which bubble a late grounded answer lands in, on the Assistant page's test chat.
 *
 * The rules' gap line is one canned sentence, so two questions that both fall through to the model leave two
 * bubbles reading exactly the same words. Naming the bubble by its text meant the first answer back filled
 * both of them and the second answer, finding nothing pending, was dropped: an operator on the page that
 * promises "same answers guests get" read their previous question's answer under this one.
 */

const GAP = "They haven't published that.";

test("every bubble gets its own name", () => {
  const ids = new Set(Array.from({ length: 200 }, () => bubbleId()));
  assert.equal(ids.size, 200);
});

test("two questions with the identical gap line settle one bubble each", () => {
  let msgs: Bubble[] = [];
  const [q1, a1] = askedBubbles("Do you rent wetsuits?", GAP, true);
  msgs = [...msgs, q1, a1];
  const [q2, a2] = askedBubbles("Is there parking?", GAP, true);
  msgs = [...msgs, q2, a2];
  assert.equal(a1.t, a2.t, "the premise: both bubbles read the same");

  // The second question's answer comes back first, the way a network does.
  msgs = settleBubble(msgs, a2.id, "Street parking is free after 6pm.");
  assert.equal(msgs.find((m) => m.id === a1.id)!.t, GAP, "the wetsuit bubble must not take the parking answer");
  assert.equal(msgs.find((m) => m.id === a1.id)!.pending, true, "and it is still waiting on its own");
  assert.equal(msgs.find((m) => m.id === a2.id)!.t, "Street parking is free after 6pm.");

  msgs = settleBubble(msgs, a1.id, "Wetsuits are included in every rental.");
  assert.equal(msgs.find((m) => m.id === a1.id)!.t, "Wetsuits are included in every rental.");
  assert.equal(msgs.find((m) => m.id === a2.id)!.t, "Street parking is free after 6pm.", "the parking answer stays put");
});

test("a model with nothing better leaves the rules' own line standing", () => {
  const [q, a] = askedBubbles("Do you take dogs?", GAP, true);
  const msgs = settleBubble([q, a], a.id, null);
  assert.equal(msgs[1].t, GAP);
  assert.equal(msgs[1].pending, undefined, "and it stops saying it is checking");
});

test("a bubble already settled is not overwritten by a second answer", () => {
  const [q, a] = askedBubbles("Do you take dogs?", GAP, true);
  let msgs = settleBubble([q, a], a.id, "Dogs are welcome on the deck.");
  msgs = settleBubble(msgs, a.id, "Something else entirely.");
  assert.equal(msgs[1].t, "Dogs are welcome on the deck.");
});

test("an answer the rules had a fact for is never pending and never settled", () => {
  const [, a] = askedBubbles("What time do you open?", "They open at 9 AM.", false);
  assert.equal(a.pending, undefined);
  assert.deepEqual(settleBubble([a], a.id, "anything"), [a], "an unchanged list, same reference, so React does not re-render");
});

test("an id that is not in the list changes nothing", () => {
  const [q, a] = askedBubbles("Do you take dogs?", GAP, true);
  const msgs = [q, a];
  assert.equal(settleBubble(msgs, "no-such-bubble", "hello"), msgs);
});
