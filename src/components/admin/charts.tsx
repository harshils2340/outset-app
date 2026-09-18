import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Hand-written inline-SVG charts for the private metrics page.
 *
 * The site's Content-Security-Policy allows scripts from 'self' only, so no charting library from a CDN can
 * load, and an npm one would put a second React-sized dependency in the bundle for one page. These are small
 * enough to read in one sitting: a scale, a path, an axis, and one shared readout that answers to the mouse
 * and to the keyboard alike.
 *
 * Rules every chart here keeps:
 * - Colour comes from CSS custom properties (src/styles/admin.css), so dark mode is a different palette and
 *   not an automatic flip of a hardcoded hex.
 * - A series of fewer than two points is not a chart. It says so instead of drawing one point on an axis.
 * - A range with nothing in it says "no data in this range", never an empty grid.
 * - Every chart is reachable by keyboard: tab to it, arrow keys walk the points, the readout follows.
 */

export type Point = { day: string; values: number[] };
export type Series = { label: string; color: string };

const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

/** The width the chart actually has. Charts are read at 1440 and at 400, and both get the same code. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(220, el.clientWidth));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** "Sep 3". Days arrive as "2026-09-03"; parsing with new Date() would shift them by a timezone. */
export function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Axis numbers: 1.2k rather than 1,200, so the left gutter stays narrow on a phone. */
export function tick(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000000) return (n / 1000000).toFixed(a % 1000000 ? 1 : 0) + "m";
  if (a >= 1000) return (n / 1000).toFixed(a % 1000 ? 1 : 0) + "k";
  return String(Math.round(n * 100) / 100);
}

/** A round-ish top for the y axis, so the gridlines land on numbers a person would choose. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (max <= step * mag) return step * mag;
  }
  return 10 * mag;
}

export function ChartEmpty({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="adempty" role="note">
      <b>{label}</b>
      <span>{reason}</span>
    </div>
  );
}

/** Shared frame: the container, the legend, the readout, and the keyboard handling every chart wants. */
function useFocusIndex(count: number): [number | null, React.Dispatch<React.SetStateAction<number | null>>, (e: React.KeyboardEvent) => void] {
  const [i, setI] = useState<number | null>(null);
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (!count) return;
      const cur = i == null ? count - 1 : i;
      if (e.key === "ArrowRight") { e.preventDefault(); setI(Math.min(count - 1, cur + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setI(Math.max(0, cur - 1)); }
      else if (e.key === "Home") { e.preventDefault(); setI(0); }
      else if (e.key === "End") { e.preventDefault(); setI(count - 1); }
      else if (e.key === "Escape") setI(null);
    },
    [count, i],
  );
  return [i, setI, onKey];
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="adlegend">
      {series.map((s) => (
        <li key={s.label}>
          <i style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function Readout({ point, series, fmt }: { point: Point | null; series: Series[]; fmt: (n: number, i: number) => string }) {
  return (
    <div className="adread" role="status" aria-live="polite">
      {point ? (
        <>
          <b>{shortDay(point.day)}</b>
          {series.map((s, i) => (
            <span key={s.label}>
              <i style={{ background: s.color }} aria-hidden="true" />
              {s.label} {fmt(point.values[i] ?? 0, i)}
            </span>
          ))}
        </>
      ) : (
        <span className="adread-hint">Hover, or focus the chart and use the arrow keys.</span>
      )}
    </div>
  );
}

type TimeChartProps = {
  title: string;
  points: Point[];
  series: Series[];
  fmt?: (n: number, i: number) => string;
  height?: number;
  /** "area" stacks nothing and fills under a single line; "bars" draws one bar per day per series, stacked. */
  kind?: "area" | "bars";
  emptyReason?: string;
};

/**
 * One chart for lines/areas and for stacked bars: the axes, the scale, the hover and the keyboard are the same
 * thing twice over, and the only difference is what is painted between the points.
 */
export function TimeChart({ title, points, series, fmt = (n) => tick(n), height = 200, kind = "area", emptyReason }: TimeChartProps) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [focus, setFocus, onKey] = useFocusIndex(points.length);
  const total = useMemo(() => points.reduce((a, p) => a + p.values.reduce((x, y) => x + y, 0), 0), [points]);

  if (points.length < 2) return <ChartEmpty label={title} reason={emptyReason || "Fewer than two days of data: there is nothing to draw a line between yet."} />;
  if (total === 0) return <ChartEmpty label={title} reason={emptyReason || "No data in this range."} />;

  const innerW = Math.max(60, w - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const stacked = kind === "bars";
  const maxima = points.map((p) => (stacked ? p.values.reduce((a, b) => a + b, 0) : Math.max(...p.values)));
  const top = niceMax(Math.max(...maxima));
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  // Whole things (emails, claims, bookings) get whole gridlines: a "2.5" on a count of bookings reads as half
  // a booking. Money keeps its halfway line as it is.
  const allInt = points.every((p) => p.values.every((v) => Number.isInteger(v)));
  const mid = allInt ? Math.round(top / 2) : top / 2;
  const ticks = Array.from(new Set([0, mid, top]));
  // At 400px wide a label every few days overlaps into mush: show three, and let the readout give exact days.
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 70))));
  const barW = Math.max(1, Math.min(18, innerW / points.length - 2));

  const pick = (clientX: number, el: SVGSVGElement) => {
    const box = el.getBoundingClientRect();
    const rel = ((clientX - box.left) / box.width) * w - PAD.left;
    setFocus(Math.max(0, Math.min(points.length - 1, Math.round((rel / innerW) * (points.length - 1)))));
  };

  return (
    <div className="adchart" ref={ref}>
      <Legend series={series} />
      <svg
        viewBox={`0 0 ${w} ${height}`}
        width="100%"
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`${title}. ${points.length} days, from ${shortDay(points[0].day)} to ${shortDay(points[points.length - 1].day)}. Use the arrow keys to read each day.`}
        onKeyDown={onKey}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget)}
        onMouseLeave={() => setFocus(null)}
        onBlur={() => setFocus(null)}
        onFocus={() => setFocus((f) => (f == null ? points.length - 1 : f))}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className="adgrid" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="adaxis">{tick(t)}</text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.day} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="adaxis">
              {shortDay(p.day)}
            </text>
          ) : null,
        )}
        {stacked
          ? points.map((p, i) => {
              let base = 0;
              return (
                <g key={p.day}>
                  {p.values.map((v, s) => {
                    const h = (v / top) * innerH;
                    const yy = PAD.top + innerH - h - (base / top) * innerH;
                    base += v;
                    if (h <= 0) return null;
                    // 2px of surface between stacked segments, so the boundary is a gap and not a guess.
                    return <rect key={s} x={x(i) - barW / 2} y={yy} width={barW} height={Math.max(1, h - (s ? 2 : 0))} rx={2} fill={series[s].color} />;
                  })}
                </g>
              );
            })
          : series.map((s, si) => {
              const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.values[si] ?? 0).toFixed(1)}`).join("");
              const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
              return (
                <g key={s.label}>
                  {series.length === 1 ? <path d={area} fill={s.color} opacity={0.14} /> : null}
                  <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}
        {focus != null && points[focus] ? (
          <g>
            <line x1={x(focus)} x2={x(focus)} y1={PAD.top} y2={PAD.top + innerH} className="adcross" />
            {!stacked
              ? series.map((s, si) => <circle key={s.label} cx={x(focus)} cy={y(points[focus].values[si] ?? 0)} r={4} fill={s.color} className="adknob" />)
              : null}
          </g>
        ) : null}
      </svg>
      <Readout point={focus == null ? null : points[focus]} series={series} fmt={fmt} />
    </div>
  );
}

/** The headline tile's sparkline: no axes, no legend, one line. Decorative; the tile's number carries the meaning. */
export function Sparkline({ values, color, width = 120, height = 32 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => (i * width) / (values.length - 1);
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg className="adspark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" focusable="false">
      <path d={`${line}L${width},${height}L0,${height}Z`} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} fill={color} />
    </svg>
  );
}

export type FunnelStep = { label: string; value: number | null; note: string };

/**
 * The funnel, as a funnel: each step's bar is its share of the first known step, and the number between two
 * bars is the conversion from the one above, with its denominator named. A step the API could not measure
 * breaks the chain rather than pretending the one below it converted from nothing.
 */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const known = steps.filter((s) => s.value != null) as { label: string; value: number; note: string }[];
  if (!known.length) return <ChartEmpty label="Funnel" reason="None of these steps is tracked yet." />;
  const base = Math.max(...known.map((s) => s.value), 1);
  return (
    <ol className="adfunnel">
      {steps.map((s, i) => {
        const prev = steps[i - 1];
        const pct = i > 0 && prev && prev.value != null && s.value != null && prev.value > 0 ? (s.value / prev.value) * 100 : null;
        return (
          <li key={s.label}>
            {i > 0 ? (
              <p className="adfunnel-conv">
                {pct == null ? <span className="adnull">conversion not known: {prev?.value == null ? prev?.label.toLowerCase() + " is not tracked yet" : "no one reached " + prev.label.toLowerCase()}</span> : <><b>{pct.toFixed(pct < 10 ? 1 : 0)}%</b> of {prev.label.toLowerCase()} ({prev.value!.toLocaleString("en-US")})</>}
              </p>
            ) : null}
            <div className="adfunnel-row">
              <span className="adfunnel-label">{s.label}</span>
              <div className="adfunnel-track">
                <div className="adfunnel-bar" style={{ width: s.value == null || s.value === 0 ? "0%" : `${Math.max(1.5, (s.value / base) * 100)}%` }} />
              </div>
              <span className="adfunnel-val">{s.value == null ? <em className="adnull">not tracked yet</em> : s.value.toLocaleString("en-US")}</span>
            </div>
            <p className="adfunnel-note">{s.note}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** One bar split in two: claimed against the whole catalog. A 59,000-slice pie is not a chart, it is a circle. */
export function ShareBar({ part, whole, partLabel, wholeLabel }: { part: number; whole: number; partLabel: string; wholeLabel: string }) {
  const pct = whole > 0 ? (part / whole) * 100 : 0;
  return (
    <div className="adshare">
      <div className="adshare-track" role="img" aria-label={`${partLabel}: ${part.toLocaleString("en-US")} of ${whole.toLocaleString("en-US")} ${wholeLabel}, ${pct.toFixed(2)} percent.`}>
        <div className="adshare-part" style={{ width: `${Math.max(0.4, pct)}%` }} />
      </div>
      <p className="adshare-legend">
        <b>{part.toLocaleString("en-US")}</b> {partLabel} · <b>{(whole - part).toLocaleString("en-US")}</b> not yet · {pct.toFixed(2)}% of {whole.toLocaleString("en-US")} {wholeLabel}
      </p>
    </div>
  );
}

/**
 * Horizontal bars for a small set of named amounts (booking statuses, spend by source). Labels sit outside the
 * bar, so they never clip. A row may carry its own colour, which is how the cost section keeps each source
 * separable while the section as a whole stays in one family.
 */
export function RowBars({
  rows,
  color,
  title,
  fmt = (n: number) => n.toLocaleString("en-US"),
  emptyReason = "Nothing in this range.",
}: {
  rows: { label: string; value: number; color?: string }[];
  color: string;
  title: string;
  fmt?: (n: number) => string;
  emptyReason?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length || rows.every((r) => !r.value)) return <ChartEmpty label={title} reason={emptyReason} />;
  const totalAll = rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="adrows">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="adrows-label">{r.label}</span>
          <div className="adrows-track">
            <div className="adrows-bar" style={{ width: `${Math.max(0.5, (r.value / max) * 100)}%`, background: r.color || color }} />
          </div>
          <span className="adrows-val">{fmt(r.value)}<em>{totalAll ? ` · ${((r.value / totalAll) * 100).toFixed(0)}%` : ""}</em></span>
        </li>
      ))}
    </ul>
  );
}

/**
 * How much of a budget is gone: one bar against a ceiling, with the ceiling drawn as the end of the track and
 * not as a line somewhere inside it.
 *
 * Over the cap is a real state and it is drawn, not clamped: the bar fills and turns to the "over" colour, and
 * the label still reads the true percentage, because a meter pinned at 100% would hide the one case worth
 * noticing. A cap of zero or an unknown spend is not a meter at all and says so.
 */
export function Meter({ value, cap, label, fmt, color, overColor }: { value: number | null; cap: number | null; label: string; fmt: (n: number) => string; color: string; overColor: string }) {
  if (value == null || cap == null || cap <= 0) {
    return <ChartEmpty label={label} reason={value == null ? "Nothing has reported a figure to measure against the cap." : "No cap is set, so there is no share of it to show."} />;
  }
  const pct = (value / cap) * 100;
  const over = pct > 100;
  return (
    <div className="admeter">
      <div className="admeter-track" role="img" aria-label={`${label}: ${fmt(value)} of ${fmt(cap)}, ${pct.toFixed(1)} percent${over ? ", over the cap" : ""}.`}>
        <div className="admeter-fill" style={{ width: `${Math.min(100, Math.max(0.6, pct))}%`, background: over ? overColor : color }} />
      </div>
      <p className="admeter-legend">
        <b>{fmt(value)}</b> of <b>{fmt(cap)}</b> · {pct.toFixed(1)}% {over ? <strong className="admeter-over">over the cap</strong> : "of the cap used"}
      </p>
    </div>
  );
}
