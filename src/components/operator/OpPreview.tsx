import { useEffect, useRef, useState } from "react";
import type { JumpField } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS } from "./opContext";
import type { PreviewMsg } from "./previewMode";

export type PreviewDevice = "desktop" | "phone";
type Prefs = { open: boolean; device: PreviewDevice; width: number };

const PREFS_KEY = "outset.dashboard.preview.v1";
/**
 * Just past the guest app's 1024 px phone cutoff, so the frame renders the desktop listing at the largest
 * scale the panel allows. It used to be 1140, which shrank the page to 40% in a half-width panel.
 */
const DESKTOP_W = 1040;
/** The phone the guest app's width check turns into its phone layout. */
const PHONE_W = 390;
export const PREVIEW_MIN_W = 340;
/** The least the editor keeps beside the preview. Below this the Basics fields wrap badly. */
const EDITOR_MIN_W = 480;

function sidebarWidth(): number {
  return window.innerWidth <= 1180 ? 200 : 248;
}

/** Half of the space beside the sidebar: the split Harshil asked for, "half editing, half live preview". */
export function defaultPreviewWidth(): number {
  if (typeof window === "undefined") return 480;
  return Math.round(Math.min(maxWidth(), Math.max(PREVIEW_MIN_W, (window.innerWidth - sidebarWidth()) / 2)));
}

/**
 * Open by default: the preview is the point of the editor. Only a deliberate close is remembered. Prefs
 * saved before the split view (open: false with no `closedBy`) are treated as never having chosen.
 */
/**
 * The frame the operator is most likely to care about: the one they are on. A touch screen or a narrow window
 * means they run the business from a phone or tablet, and their guests probably book from one too; a mouse on a
 * wide screen gets the desktop listing. Only the starting point; the toggle is remembered once they pick.
 */
function defaultDevice(): PreviewDevice {
  try {
    if (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 1024) return "phone";
  } catch {
    /* no matchMedia */
  }
  return "desktop";
}

/** Prefs written before v2 carried a narrower default width; those widths are dropped so everyone starts at the half split. */
const PREFS_VERSION = 2;

export function loadPreviewPrefs(): Prefs {
  const fallback: Prefs = { open: true, device: defaultDevice(), width: defaultPreviewWidth() };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<Prefs> & { closedBy?: string; v?: number };
    const dragged = v.v === PREFS_VERSION && typeof v.width === "number" && v.width >= PREVIEW_MIN_W;
    return {
      open: v.open === false && v.closedBy === "user" ? false : true,
      device: v.device === "phone" ? "phone" : v.device === "desktop" ? "desktop" : defaultDevice(),
      width: dragged ? Math.min(v.width as number, maxWidth()) : defaultPreviewWidth(),
    };
  } catch {
    return fallback;
  }
}

export function savePreviewPrefs(patch: Partial<Prefs>): void {
  try {
    const cur = loadPreviewPrefs();
    const next = { ...cur, ...patch, v: PREFS_VERSION, closedBy: patch.open === false ? "user" : patch.open === true ? undefined : (JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as { closedBy?: string }).closedBy };
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

export function previewSrc(id: string): string {
  return import.meta.env.BASE_URL + "?preview=1#o=" + encodeURIComponent(id);
}

/** Largest width the panel may take: the editor keeps EDITOR_MIN_W beside it. */
function maxWidth(): number {
  return Math.max(PREVIEW_MIN_W, window.innerWidth - sidebarWidth() - EDITOR_MIN_W);
}

/**
 * The live preview docked beside the editor: the real guest listing in a same-origin frame, rendered at a
 * desktop width and scaled to fit, or at phone width. Edits show within a moment of typing, without a reload.
 * Clicking part of the preview jumps to the field that controls it.
 */
export function OpPreview({ id, title, width, onWidth, onClose, onEdit, revealRef }: {
  id: string;
  title: string;
  width: number;
  onWidth: (w: number) => void;
  onClose: () => void;
  onEdit: (field: JumpField) => void;
  /** Filled in here; the dashboard calls it to scroll the preview to the part being edited. */
  revealRef: React.MutableRefObject<((field: JumpField) => void) | null>;
}) {
  const [device, setDevice] = useState<PreviewDevice>(() => loadPreviewPrefs().device);
  const [nonce, setNonce] = useState(0);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The frame boots the whole guest app. Call it ready once the listing's title is on the page.
  useEffect(() => {
    setReady(false);
    setSlow(false);
    let tries = 0;
    const t = window.setInterval(() => {
      tries += 1;
      const doc = frameRef.current?.contentDocument;
      if (doc && doc.querySelector(".altitle, .airtitle h1")) {
        setReady(true);
        window.clearInterval(t);
      } else if (tries === 40) setSlow(true);
    }, 200);
    return () => window.clearInterval(t);
  }, [device, nonce, id]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      const m = e.data as PreviewMsg | null;
      if (m && m.type === "outset-preview-edit") onEdit(m.field);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onEdit]);

  useEffect(() => {
    revealRef.current = (field) => {
      const msg: PreviewMsg = { type: "outset-preview-reveal", field };
      frameRef.current?.contentWindow?.postMessage(msg, window.location.origin);
    };
    return () => { revealRef.current = null; };
  }, [revealRef]);

  const pickDevice = (d: PreviewDevice) => {
    setDevice(d);
    savePreviewPrefs({ device: d });
  };

  // Drag the left edge to resize. A shield covers the frame while dragging so it does not swallow the pointer.
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setDragging(true);
    let last = startW;
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(maxWidth(), Math.max(PREVIEW_MIN_W, startW + (startX - ev.clientX))));
      onWidth(last);
    };
    const up = () => {
      setDragging(false);
      savePreviewPrefs({ width: last });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // The window got narrower: keep the editor's minimum by giving the panel back what it no longer has room for.
  useEffect(() => {
    const fit = () => {
      const cap = maxWidth();
      if (width > cap) onWidth(cap);
    };
    window.addEventListener("resize", fit);
    fit();
    return () => window.removeEventListener("resize", fit);
  }, [width, onWidth]);
  const resetWidth = () => {
    const w = defaultPreviewWidth();
    onWidth(w);
    savePreviewPrefs({ width: w });
  };
  const nudgeWidth = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = Math.min(maxWidth(), Math.max(PREVIEW_MIN_W, width + (e.key === "ArrowLeft" ? 40 : -40)));
    onWidth(next);
    savePreviewPrefs({ width: next });
  };

  const pad = device === "phone" ? 20 : 16;
  const innerW = Math.max(0, box.w - pad * 2);
  const innerH = Math.max(0, box.h - pad * 2);
  const frameW = device === "phone" ? PHONE_W : DESKTOP_W;
  const scale = innerW ? Math.min(1, innerW / frameW) : 1;
  // Phone: a phone-shaped screen, no taller than a real one. Desktop: fill the panel's height.
  const shownH = device === "phone" ? Math.min(innerH, Math.round(844 * scale)) : innerH;
  const frameH = scale ? Math.round(shownH / scale) : shownH;
  const src = previewSrc(id);

  return (
    <aside className={"odpreview" + (dragging ? " dragging" : "")} aria-label="Guest preview">
      <div
        className="odpvgrip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview. Drag, or use the arrow keys. Double-click for half and half."
        title="Drag to resize. Double-click for half and half."
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startDrag}
        onDoubleClick={resetWidth}
        onKeyDown={nudgeWidth}
      />
      <div className="odpvbar">
        <span className="odpvtitle">
          <b>Guest preview</b>
          <small><i className={"odpvdot" + (ready ? " on" : "")} />{ready ? "Live · updates as you type" : "Loading your listing…"}</small>
        </span>
        <div className="odseg small" role="group" aria-label="Preview size">
          <button type="button" aria-pressed={device === "desktop"} onClick={() => pickDevice("desktop")}><Markup html={OD_ICONS.monitor} /><span>Desktop</span></button>
          <button type="button" aria-pressed={device === "phone"} onClick={() => pickDevice("phone")}><Markup html={OD_ICONS.mobile} /><span>Phone</span></button>
        </div>
        <button type="button" className="odiconbtn" onClick={() => setNonce((n) => n + 1)} aria-label="Reload preview" title="Reload preview"><Markup html={OD_ICONS.reload} /></button>
        <a className="odiconbtn" href={src} target="_blank" rel="noopener" aria-label="Open preview in a new tab" title="Open in new tab"><Markup html={OD_ICONS.external} /></a>
        <button type="button" className="odiconbtn" onClick={onClose} aria-label="Close preview" title="Close preview"><Markup html={OD_ICONS.x} /></button>
      </div>
      <div className={"odpvstage " + device} ref={stageRef}>
        {box.w ? (
          <div className="odpvscreen" style={{ width: Math.round(frameW * scale), height: shownH }}>
            <iframe
              key={device + nonce + id}
              ref={frameRef}
              title={"Guest preview of " + title}
              src={src}
              style={{ width: frameW, height: frameH, transform: `scale(${scale})` }}
            />
            {!ready ? (
              <div className="odpvloading">
                <span className="odspin" aria-hidden="true" />
                <span>{slow ? "Still loading. Your edits are saved either way." : "Loading your listing…"}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {dragging ? <div className="odpvshield" /> : null}
      </div>
      <p className="odpvhint">Click any part of the preview to edit it.</p>
    </aside>
  );
}
