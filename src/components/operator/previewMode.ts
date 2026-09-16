import { useEffect, useRef } from "react";
import { applyStoredProfiles, type JumpField } from "../../lib/operator";
import { useApp } from "../../state/AppProvider";

/**
 * Preview mode: the guest site running inside the dashboard's preview panel, at ?preview=1#o=<id>.
 *
 * It is the real guest page with its real styles, in its own browsing context, so nothing leaks into the
 * dashboard's CSS. It is strictly read-only: it books nothing, claims nothing, writes nothing to storage and
 * sends nothing but GET requests. Live edits arrive through the storage event the dashboard's saveProfile
 * fires in every other same-origin window; the frame re-applies the stored profiles and re-renders in place,
 * so the scroll position survives.
 */
export const IS_PREVIEW = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "1";

/** Messages between the dashboard and its preview frame. Same origin only. */
export type PreviewMsg =
  | { type: "outset-preview-edit"; field: JumpField }
  | { type: "outset-preview-reveal"; field: JumpField };

const PROFILE_KEY = "outset.operator.profile.v1.";

// Installed when the module loads, before React renders or the provider boots, so not even the first
// hydrate can write to storage or the network from inside a preview.
if (IS_PREVIEW) lockDown();

function lockDown(): void {
  // Storage: the guest app saves bookings, chats and saved listings. The preview shares the owner's
  // storage, so any write here would land in the real dashboard. Reads stay open; that is how edits arrive.
  const proto = window.Storage.prototype;
  proto.setItem = function () { /* read-only preview */ };
  proto.removeItem = function () { /* read-only preview */ };
  proto.clear = function () { /* read-only preview */ };

  // Network: catalog and listing files are GETs. A booking, claim, checkout, chat or profile save is not.
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") return Promise.reject(new Error("Preview is read-only"));
    return realFetch(input, init);
  };
  if (navigator.sendBeacon) navigator.sendBeacon = () => false;
}

/** Guest controls that would book, pay, message or leave the listing. Blocked in the preview. */
const BLOCKED = [
  ".alprimary",
  ".alsubcta button",
  ".airaccent",
  ".airreserve button",
  ".alback",
  ".allogo",
  ".airbar button",
  "[class*='otto'] button",
  ".callpick a",
  ".alwhererow",
].join(",");

/** The parts of the guest page an owner can click to jump to the field that controls them. */
const EDITABLE: { sel: string; field: JumpField; up?: string }[] = [
  // Desktop guest page
  { sel: ".altitle", field: "title" },
  { sel: ".alphotos", field: "photos" },
  { sel: ".aldesc", field: "about" },
  { sel: ".alsvcs", field: "services", up: "section" },
  { sel: ".almain .alvariant", field: "services", up: "section" },
  { sel: "#al-location", field: "address" },
  { sel: ".aldescguide", field: "guide" },
  // Phone guest page
  { sel: ".airtitle h1", field: "title" },
  { sel: ".airhero", field: "photos" },
  { sel: ".airdesc", field: "about", up: "section" },
  { sel: ".svclist", field: "services", up: "section" },
  { sel: ".airknows", field: "policy" },
  { sel: ".airlisting .contact", field: "address" },
];

/** Where the preview scrolls when the owner starts editing a field. The editable parts, plus the booking box. */
const REVEAL: Partial<Record<JumpField, string>> = {
  hours: ".alreserve, #al-dates, .airguests",
  price: "[data-opv='services']",
  phone: "[data-opv='address']",
};

function tag(): void {
  for (const e of EDITABLE) {
    document.querySelectorAll<HTMLElement>(e.sel).forEach((el) => {
      const host = (e.up ? el.closest<HTMLElement>(e.up) : null) || el;
      if (host.dataset.opv !== e.field) host.dataset.opv = e.field;
    });
  }
  // "Things to know" on the desktop page has no class of its own; find it by its heading.
  document.querySelectorAll<HTMLElement>(".alwide h2, .alsec h2").forEach((h) => {
    if (/things to know/i.test(h.textContent || "")) {
      const sec = h.closest<HTMLElement>("section") || h.parentElement;
      if (sec && sec.dataset.opv !== "policy") sec.dataset.opv = "policy";
    }
  });
}

const CSS = `
.opvribbon{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483000;pointer-events:none;
  background:#222;color:#fff;font:600 12px/1 system-ui,-apple-system,sans-serif;letter-spacing:.02em;border-radius:999px;padding:7px 12px;
  box-shadow:0 4px 14px rgba(0,0,0,.25);white-space:nowrap;transition:background .2s}
.opvribbon.nudge{background:#c2410c}
@media (max-width:1024px){.opvribbon{top:auto;bottom:92px}}
[data-opv]{cursor:pointer;outline:2px dashed transparent;outline-offset:4px;border-radius:6px;transition:outline-color .12s}
[data-opv]:hover,[data-opv].opvflash,[data-opv].opvlive{outline-color:#ff5a1f}
[data-opv].opvlive{outline-style:solid}
.opvchip{position:fixed;z-index:2147483001;pointer-events:none;background:#ff5a1f;color:#fff;font:600 12px/1 system-ui,-apple-system,sans-serif;
  border-radius:999px;padding:6px 10px;box-shadow:0 4px 12px rgba(0,0,0,.2);white-space:nowrap}
.alprimary,.alsubcta button,.airaccent,.airreserve .airaccent{opacity:.55 !important;cursor:not-allowed !important}
`;

const LABEL: Record<string, string> = {
  title: "Edit name",
  photos: "Edit photos",
  about: "Edit description",
  services: "Edit services and prices",
  address: "Edit contact and address",
  policy: "Edit policies",
  guide: "Edit what it's like",
};

/**
 * Mounted once from App. Does nothing outside preview mode. Inside it: re-applies stored profiles on every
 * storage event, blocks booking controls, and turns clicks on the page into jumps to the dashboard field.
 */
export function usePreviewMode(): void {
  const { touchCatalog } = useApp();
  // The provider hands out a new api object on every state change; keep the listeners installed once.
  const touch = useRef(touchCatalog);
  touch.current = touchCatalog;
  useEffect(() => {
    if (!IS_PREVIEW) return;
    document.documentElement.classList.add("outset-preview");
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    const ribbon = document.createElement("div");
    ribbon.className = "opvribbon";
    ribbon.textContent = "Preview · bookings are off";
    document.body.appendChild(ribbon);
    const chip = document.createElement("div");
    chip.className = "opvchip";
    chip.hidden = true;
    document.body.appendChild(chip);
    const framed = window.parent !== window;

    // Live edits. saveProfile writes localStorage in the dashboard; this window hears it as a storage event.
    let queued = 0;
    const onStorage = (e: StorageEvent) => {
      if (e.key && !e.key.startsWith(PROFILE_KEY)) return;
      if (queued) return;
      queued = window.setTimeout(() => {
        queued = 0;
        applyStoredProfiles({ remote: false });
        touch.current();
      }, 60);
    };
    window.addEventListener("storage", onStorage);

    let nudge = 0;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.closest) return;
      const edit = t.closest<HTMLElement>("[data-opv]");
      if (edit && framed) {
        e.preventDefault();
        e.stopPropagation();
        const msg: PreviewMsg = { type: "outset-preview-edit", field: edit.dataset.opv as JumpField };
        window.parent.postMessage(msg, window.location.origin);
        return;
      }
      if (t.closest(BLOCKED) || t.closest("a[href]")) {
        e.preventDefault();
        e.stopPropagation();
        ribbon.classList.add("nudge");
        ribbon.textContent = "Preview only · guests book on your live page";
        window.clearTimeout(nudge);
        nudge = window.setTimeout(() => {
          ribbon.classList.remove("nudge");
          ribbon.textContent = "Preview · bookings are off";
        }, 2200);
      }
    };
    // Escape would close the listing; in a preview there is nothing behind it to go back to.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);

    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-opv]");
      if (!el || !framed) {
        chip.hidden = true;
        return;
      }
      const r = el.getBoundingClientRect();
      chip.textContent = LABEL[el.dataset.opv || ""] || "Edit";
      chip.style.left = Math.max(8, r.left) + "px";
      chip.style.top = Math.max(8, r.top - 30 < 44 ? r.top + 8 : r.top - 30) + "px";
      chip.hidden = false;
    };
    document.addEventListener("mouseover", onOver);
    const onScroll = () => { chip.hidden = true; };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });

    // The dashboard asks the preview to show the part the owner is editing.
    let live = 0;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data as PreviewMsg | null;
      if (!m || m.type !== "outset-preview-reveal") return;
      const sel = REVEAL[m.field] || "[data-opv='" + m.field + "']";
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const inView = r.top >= 0 && r.top < window.innerHeight * 0.7;
      if (!inView) el.scrollIntoView({ behavior: "smooth", block: r.height > window.innerHeight ? "start" : "center" });
      el.classList.add("opvflash");
      window.setTimeout(() => el.classList.remove("opvflash"), 1200);
      // The part being edited stays marked while the owner works on it; the next field takes over the mark.
      document.querySelectorAll(".opvlive").forEach((x) => { if (x !== el) x.classList.remove("opvlive"); });
      el.classList.add("opvlive");
      window.clearTimeout(live);
      live = window.setTimeout(() => el.classList.remove("opvlive"), 6000);
    };
    window.addEventListener("message", onMsg);

    let raf = 0;
    const mo = new MutationObserver(() => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        tag();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    tag();

    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mouseover", onOver);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("message", onMsg);
      mo.disconnect();
      style.remove();
      ribbon.remove();
      chip.remove();
    };
  }, []);
}
