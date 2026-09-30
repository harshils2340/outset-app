import { useCallback, useRef, useState } from "react";

/**
 * The smallest shape of a DOM node the row walk below needs, so the walk itself can be read by a test with
 * no browser in it. A real `Element` satisfies it.
 */
export type RowNode = { readonly dataset?: { readonly rid?: string }; readonly parentElement: RowNode | null; closest(selector: string): RowNode | null };

/**
 * The row of one list a point sits inside, or null when the point is somewhere else entirely.
 *
 * Walked upwards rather than read once, because a service card holds its own price option rows and each of
 * those carries a `data-rid` of its own: the nearest row to a point inside an open card belongs to the inner
 * list, and the card underneath it is the row the outer list knows.
 */
export function rowUnder(from: RowNode | null, mine: (rid: string) => boolean): string | null {
  let el: RowNode | null = from;
  while (el) {
    const row: RowNode | null = el.closest("[data-rid]");
    if (!row) return null;
    const rid = row.dataset?.rid;
    if (rid && mine(rid)) return rid;
    el = row.parentElement;
  }
  return null;
}

/**
 * Drag and keyboard reordering for a list.
 *
 * Ported from the 21st.dev Reorder List. The keyboard model is kept exactly: Space or Enter grabs a row,
 * the arrow keys move it, Space drops it, Escape puts the list back the way it was. The original drives
 * the drag through motion/react, which this project does not carry, so dragging runs on the native HTML5
 * drag events instead. Announcements go to a polite live region so a screen reader follows the move.
 */
export function useReorder<T>({
  items,
  getId,
  getLabel,
  onReorder,
}: {
  items: readonly T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  onReorder: (next: T[]) => void;
}) {
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [spoken, setSpoken] = useState("");
  // The row whose handle is under the mouse. Only that row is draggable: a card that is always draggable
  // swallows every mouse drag inside it, so an operator could not sweep-select the text in a name box.
  const [armed, setArmed] = useState<string | null>(null);

  // Refs so the callbacks stay stable while still reading the current list.
  const emit = useRef(onReorder);
  emit.current = onReorder;
  const live = useRef(items);
  live.current = items;
  // What the list looked like before the grab, so Escape can restore it.
  const snapshot = useRef<readonly T[] | null>(null);
  // Whether the drag that is ending landed on a row. A drag reorders the list as it passes over each row, so
  // a drag the operator gave up on (Escape, or letting go over the page header) left the new order in place
  // with nothing to undo it, while the keyboard path promises Escape puts the list back.
  const landed = useRef(false);

  const indexOf = useCallback((id: string) => live.current.findIndex((x) => getId(x) === id), [getId]);

  const moveTo = useCallback(
    (from: number, to: number): T[] => {
      const next = [...live.current];
      const [taken] = next.splice(from, 1);
      next.splice(to, 0, taken);
      return next;
    },
    [],
  );

  const grab = useCallback(
    (id: string) => {
      snapshot.current = live.current;
      setGrabbed(id);
      const at = indexOf(id);
      setSpoken(getLabel(live.current[at]) + " grabbed, position " + (at + 1) + " of " + live.current.length + ".");
    },
    [getLabel, indexOf],
  );

  const drop = useCallback(
    (id: string) => {
      snapshot.current = null;
      setGrabbed(null);
      const at = indexOf(id);
      setSpoken(getLabel(live.current[at]) + " dropped at position " + (at + 1) + ".");
    },
    [getLabel, indexOf],
  );

  const cancel = useCallback(() => {
    if (snapshot.current) emit.current([...snapshot.current]);
    snapshot.current = null;
    setGrabbed(null);
    setSpoken("Reorder cancelled, the original order is back.");
  }, []);

  const step = useCallback(
    (id: string, delta: -1 | 1) => {
      const from = indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= live.current.length) return;
      const next = moveTo(from, to);
      emit.current(next);
      setSpoken(getLabel(next[to]) + ", position " + (to + 1) + " of " + next.length + ".");
    },
    [getLabel, indexOf, moveTo],
  );

  const onKeyDown = useCallback(
    (id: string) => (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      const held = grabbed === id;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (held) drop(id);
        else grab(id);
        return;
      }
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && held) {
        e.preventDefault();
        step(id, e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (e.key === "Escape" && held) {
        e.preventDefault();
        cancel();
      }
    },
    [grabbed, grab, drop, step, cancel],
  );

  /**
   * A finger on the handle. Phones do not fire HTML5 drag events, so a touch drag runs on pointer events:
   * whatever row sits under the finger is where the row goes.
   *
   * The three listeners sit on the window rather than on the handle, because the handle stops hearing the
   * finger the moment the list first reorders. Moving a row is `insertBefore` on a node already in the
   * document, which the DOM counts as a removal, and a removal releases the pointer capture the handle was
   * holding. So the drag's own end never arrived: the finger lifted and the row stayed lifted, another row
   * kept its drop marker, nothing was announced to a screen reader, and the three listeners were still on
   * the handle for the next drag to run twice over.
   */
  const onPointerDown = useCallback(
    (id: string) => (e: React.PointerEvent<HTMLElement>) => {
      setArmed(id);
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      const pointer = e.pointerId;
      snapshot.current = live.current;
      setDragging(id);
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointer) return;
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-rid]");
        const target = under?.dataset.rid;
        if (!target || target === id) return;
        const from = indexOf(id);
        const to = indexOf(target);
        if (from < 0 || to < 0 || from === to) return;
        moved = true;
        setOver(target);
        emit.current(moveTo(from, to));
      };
      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        snapshot.current = null;
        setDragging(null);
        setOver(null);
        setArmed(null);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointer) return;
        stop();
        if (!moved) return;
        const at = indexOf(id);
        if (at >= 0) setSpoken(getLabel(live.current[at]) + " dropped at position " + (at + 1) + ".");
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointer) return;
        const was = snapshot.current;
        stop();
        if (was && moved) {
          emit.current([...was]);
          setSpoken("Reorder cancelled, the original order is back.");
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [getLabel, indexOf, moveTo],
  );

  const disarm = useCallback(() => setArmed(null), []);

  /**
   * Whether the operator let go over a row of this list.
   *
   * A `drop` event is not something the browser can be relied on to send. The list reorders as the drag
   * passes over each row, so the row being dragged slides under the cursor, and a target the pointer never
   * moved onto again is not one Chrome will drop on: every mouse drag finished with no drop at all and
   * `onDragEnd` put the list back, so a service dragged into place snapped straight back to where it was.
   * Where the operator let go is what settles it: a row of this list is a drop, anywhere else is giving up.
   */
  const endedOnThisList = useCallback(
    (x: number, y: number): boolean => {
      // A drag abandoned outside the window reports no useful point, and 0,0 is the page corner rather than
      // a row the operator aimed at.
      if (!Number.isFinite(x) || !Number.isFinite(y) || (x <= 0 && y <= 0)) return false;
      const at = rowUnder(document.elementFromPoint(x, y), (rid) => live.current.some((item) => getId(item) === rid));
      return at !== null;
    },
    [getId],
  );

  /** Everything the handle needs: keyboard grab, touch drag, and arming the mouse drag on its row. */
  const gripProps = useCallback(
    (id: string) => ({
      role: "button" as const,
      tabIndex: 0,
      "aria-pressed": grabbed === id,
      onKeyDown: onKeyDown(id),
      onPointerDown: onPointerDown(id),
      onPointerUp: disarm,
      onPointerCancel: disarm,
    }),
    [grabbed, onKeyDown, onPointerDown, disarm],
  );

  const dragProps = useCallback(
    (id: string) => ({
      draggable: armed === id,
      "data-rid": id,
      onDragStart: (e: React.DragEvent<HTMLElement>) => {
        snapshot.current = live.current;
        landed.current = false;
        setDragging(id);
        // Firefox will not start a drag without payload.
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
      },
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!dragging) return;
        // Every row of this list accepts the drop, the dragged row included. A drag reorders as it passes, so
        // the row being dragged ends up under the cursor, and that is where a mouse drag almost always
        // finishes: refusing it there made the browser cancel the drop and `onDragEnd` put the list back.
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragging === id) {
          setOver(null);
          return;
        }
        setOver(id);
        const from = indexOf(dragging);
        const to = indexOf(id);
        if (from < 0 || to < 0 || from === to) return;
        emit.current(moveTo(from, to));
      },
      onDragEnd: (e: React.DragEvent<HTMLElement>) => {
        const was = snapshot.current;
        snapshot.current = null;
        setDragging(null);
        setOver(null);
        setArmed(null);
        if (!landed.current && !endedOnThisList(e.clientX, e.clientY)) {
          if (was) emit.current([...was]);
          setSpoken("Reorder cancelled, the original order is back.");
          return;
        }
        const at = indexOf(id);
        if (at >= 0) setSpoken(getLabel(live.current[at]) + " dropped at position " + (at + 1) + ".");
      },
      onDrop: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        landed.current = true;
        setOver(null);
      },
    }),
    [armed, dragging, endedOnThisList, getLabel, indexOf, moveTo],
  );

  return { grabbed, dragging, over, spoken, grab, drop, cancel, step, onKeyDown, gripProps, dragProps };
}
