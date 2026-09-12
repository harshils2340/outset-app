import { useCallback, useRef, useState } from "react";

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

  // Refs so the callbacks stay stable while still reading the current list.
  const emit = useRef(onReorder);
  emit.current = onReorder;
  const live = useRef(items);
  live.current = items;
  // What the list looked like before the grab, so Escape can restore it.
  const snapshot = useRef<readonly T[] | null>(null);

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

  const dragProps = useCallback(
    (id: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent<HTMLElement>) => {
        snapshot.current = live.current;
        setDragging(id);
        // Firefox will not start a drag without payload.
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
      },
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!dragging || dragging === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(id);
        const from = indexOf(dragging);
        const to = indexOf(id);
        if (from < 0 || to < 0 || from === to) return;
        emit.current(moveTo(from, to));
      },
      onDragEnd: () => {
        snapshot.current = null;
        setDragging(null);
        setOver(null);
        const at = indexOf(id);
        if (at >= 0) setSpoken(getLabel(live.current[at]) + " dropped at position " + (at + 1) + ".");
      },
      onDrop: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        setOver(null);
      },
    }),
    [dragging, getLabel, indexOf, moveTo],
  );

  return { grabbed, dragging, over, spoken, grab, drop, cancel, step, onKeyDown, dragProps };
}
