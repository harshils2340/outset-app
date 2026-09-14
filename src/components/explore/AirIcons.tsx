/** Line icons in the Airbnb app's weight: 24px box, 2px stroke on a 32 grid, round joins. */
type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 32 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

export function IcSearch({ size = 24, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="14" cy="14" r="9" />
      <path d="m27 27-6.6-6.6" />
    </svg>
  );
}

export function IcHeart({ size = 24, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M16 28c7-4.7 12-9.6 12-15.2A6.8 6.8 0 0 0 21.2 6c-2.3 0-4.1 1.3-5.2 3.1C14.9 7.3 13.1 6 10.8 6A6.8 6.8 0 0 0 4 12.8C4 18.4 9 23.3 16 28z" />
    </svg>
  );
}

/** The heart that sits on a photo: white outline over a translucent fill, solid accent once saved. */
export function IcHeartOnPhoto({ on, size = 24 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable={false} className={"airheart" + (on ? " on" : "")}>
      <path
        d="M16 28c7-4.7 12-9.6 12-15.2A6.8 6.8 0 0 0 21.2 6c-2.3 0-4.1 1.3-5.2 3.1C14.9 7.3 13.1 6 10.8 6A6.8 6.8 0 0 0 4 12.8C4 18.4 9 23.3 16 28z"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IcTicket({ size = 24, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 9a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v3.5a3.5 3.5 0 0 0 0 7V23a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3.5a3.5 3.5 0 0 0 0-7z" />
      <path d="M20 8v3M20 15v2M20 21v3" />
    </svg>
  );
}

export function IcInbox({ size = 24, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M26 5H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h4v4l6-4h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
    </svg>
  );
}

export function IcProfile({ size = 24, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="16" cy="16" r="12" />
      <circle cx="16" cy="13" r="4.5" />
      <path d="M8 25.2c1.6-3.3 4.6-5.2 8-5.2s6.4 1.9 8 5.2" />
    </svg>
  );
}

export function IcFilters({ size = 16, className }: P) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2.6}>
      <path d="M7 16H3M29 16H15M29 6h-4M17 6H3M29 26h-4M17 26H3" />
      <circle cx="11" cy="16" r="4" />
      <circle cx="21" cy="6" r="4" />
      <circle cx="21" cy="26" r="4" />
    </svg>
  );
}

export function IcBack({ size = 16, className }: P) {
  return (
    <svg {...base(size)} className={className} strokeWidth={3}>
      <path d="M20 28 8.7 16.7a1 1 0 0 1 0-1.4L20 4" />
    </svg>
  );
}

export function IcClose({ size = 16, className }: P) {
  return (
    <svg {...base(size)} className={className} strokeWidth={3}>
      <path d="m6 6 20 20M26 6 6 26" />
    </svg>
  );
}

export function IcShare({ size = 16, className }: P) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2.6}>
      <path d="M27 18v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9M16 3v18M9 10l7-7 7 7" />
    </svg>
  );
}

export function IcStar({ size = 12, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable={false} className={className} fill="currentColor">
      <path d="M15.1 1.58l-4.13 8.88-9.86 1.27a1 1 0 0 0-.54 1.74l7.3 6.57-1.97 9.85a1 1 0 0 0 1.48 1.06l8.62-5 8.63 5a1 1 0 0 0 1.48-1.06l-1.97-9.85 7.3-6.57a1 1 0 0 0-.55-1.73l-9.86-1.28-4.12-8.88a1 1 0 0 0-1.82 0z" />
    </svg>
  );
}

export function IcPin({ size = 24, className }: P) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2}>
      <path d="M16 29s10-8.6 10-16a10 10 0 0 0-20 0c0 7.4 10 16 10 16z" />
      <circle cx="16" cy="13" r="3.5" />
    </svg>
  );
}

export function IcNavigate({ size = 24, className }: P) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2}>
      <path d="M28 4 4 14l10 4 4 10z" />
    </svg>
  );
}

export function IcGlobe({ size = 24, className }: P) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2}>
      <circle cx="16" cy="16" r="12" />
      <path d="M4 16h24M16 4c3.3 3.3 5 7.3 5 12s-1.7 8.7-5 12c-3.3-3.3-5-7.3-5-12s1.7-8.7 5-12z" />
    </svg>
  );
}

export function IcChevron({ size = 12, className, dir = "right" }: P & { dir?: "right" | "down" | "up" }) {
  const d = dir === "right" ? "m12 4 11.3 11.3a1 1 0 0 1 0 1.4L12 28" : dir === "down" ? "M28 12 16.7 23.3a1 1 0 0 1-1.4 0L4 12" : "M4 20 15.3 8.7a1 1 0 0 1 1.4 0L28 20";
  return (
    <svg {...base(size)} className={className} strokeWidth={3.2}>
      <path d={d} />
    </svg>
  );
}

export function IcPlus({ size = 12, className }: P) {
  return (
    <svg {...base(size)} className={className} strokeWidth={3}>
      <path d="M16 4v24M4 16h24" />
    </svg>
  );
}

export function IcMinus({ size = 12, className }: P) {
  return (
    <svg {...base(size)} className={className} strokeWidth={3}>
      <path d="M4 16h24" />
    </svg>
  );
}

/** The laurel either side of "Guest favourite". */
export function IcLaurel({ flip }: { flip?: boolean }) {
  return (
    <svg width="18" height="34" viewBox="0 0 18 34" aria-hidden focusable={false} fill="currentColor" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M13.5 32.5C6.2 29.4 2.4 22.6 3.2 13.4 3.6 9 5 5.1 7.3 1.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <ellipse cx="3.6" cy="24" rx="1.8" ry="4" transform="rotate(-38 3.6 24)" />
      <ellipse cx="2" cy="17" rx="1.7" ry="3.8" transform="rotate(-12 2 17)" />
      <ellipse cx="2.6" cy="10" rx="1.6" ry="3.6" transform="rotate(14 2.6 10)" />
      <ellipse cx="5.4" cy="4" rx="1.4" ry="3.2" transform="rotate(34 5.4 4)" />
      <ellipse cx="8.6" cy="29" rx="1.8" ry="3.8" transform="rotate(-62 8.6 29)" />
      <ellipse cx="7.4" cy="21" rx="1.4" ry="3.2" transform="rotate(28 7.4 21)" />
      <ellipse cx="7" cy="13.5" rx="1.3" ry="3" transform="rotate(38 7 13.5)" />
    </svg>
  );
}
