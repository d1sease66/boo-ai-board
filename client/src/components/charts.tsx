// Charts, hand-rolled in SVG. No chart library, no runtime cost.
//
// Design rules applied throughout: one axis only, single-series charts carry no legend (the title names
// the series), grid and axes stay recessive, marks are thin (2px lines, 8px+ hit targets), and anywhere
// colour carries meaning it is paired with a label or a shape so it never encodes alone.
import { useId, useRef, useState, type ReactNode } from "react";
import { money, signedPct } from "../lib/format";

const VIOLET = "#8B7CFF";
const BULL = "#2FD68A";
const BEAR = "#FF5C72";
const GRID = "#1F2531";

type Pt = { at: string; price: number };

// ── sparkline ────────────────────────────────────────────────────────────────

/** A micro line for a table row. Colour follows the direction of the move and the title states it. */
export function Sparkline({
  points, width = 84, height = 26, tone,
}: { points: { price: number }[]; width?: number; height?: number; tone?: "bull" | "bear" | "brand" }) {
  if (points.length < 2) return <span className="inline-block text-dim" style={{ width, height }} aria-hidden>—</span>;
  const ys = points.map((p) => p.price);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const stroke = tone === "brand" ? VIOLET : (tone ?? (ys[ys.length - 1] >= ys[0] ? "bull" : "bear")) === "bull" ? BULL : BEAR;
  const d = points
    .map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * (width - 2) + 1).toFixed(2)},${(height - 2 - ((p.price - min) / span) * (height - 4)).toFixed(2)}`)
    .join(" ");
  const move = ((ys[ys.length - 1] - ys[0]) / ys[0]) * 100;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${move >= 0 ? "up" : "down"} ${Math.abs(move).toFixed(1)}%`}>
      <title>{`${move >= 0 ? "+" : ""}${move.toFixed(1)}% over the window`}</title>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── price chart ──────────────────────────────────────────────────────────────

/**
 * A single-series price line with a crosshair and tooltip. Reference lines (entry, target) are drawn as
 * labelled dashes rather than a second series, so the chart keeps one meaning per mark.
 */
export function PriceChart({
  points, height = 220, refs = [], label,
}: {
  points: Pt[]; height?: number; label?: string;
  refs?: { value: number; label: string; tone?: "bull" | "bear" | "muted" }[];
}) {
  const gid = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const W = 720, H = height, PAD_L = 8, PAD_R = 54, PAD_T = 14, PAD_B = 22;

  if (points.length < 2) {
    return <div className="flex h-[180px] items-center justify-center text-[13px] text-dim">not enough price history yet</div>;
  }
  const ys = points.map((p) => p.price);
  const pMin = Math.min(...ys), pMax = Math.max(...ys);
  // A single wild target must not flatten the price line into the baseline, so reference lines only
  // widen the scale while they stay near the data. Anything further out is dropped and said so below.
  const room = (pMax - pMin || pMax * 0.02) * 2.5;
  const shown = refs.filter((r) => r.value >= pMin - room && r.value <= pMax + room);
  const dropped = refs.length - shown.length;
  const refVals = shown.map((r) => r.value);
  const min = Math.min(pMin, ...refVals);
  const max = Math.max(pMax, ...refVals);
  const pad = (max - min) * 0.08 || max * 0.01;
  const lo = min - pad, hi = max + pad;
  const span = hi - lo || 1;

  const x = (i: number) => PAD_L + (i / (points.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - lo) / span) * (H - PAD_T - PAD_B);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.price).toFixed(2)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(2)},${H - PAD_B} L${x(0).toFixed(2)},${H - PAD_B} Z`;
  const up = ys[ys.length - 1] >= ys[0];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * span);

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const rel = (e.clientX - r.left) / r.width;
    const svgX = rel * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((svgX - PAD_L) / (W - PAD_L - PAD_R)) * (points.length - 1))));
    setHover({ i, x: rel * 100 });
  }

  const hp = hover ? points[hover.i] : null;

  return (
    <div className="relative" ref={box} onPointerMove={move} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label={label ?? "price over time"}>
        <defs>
          <linearGradient id={`fill${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={VIOLET} stopOpacity=".26" />
            <stop offset="1" stopColor={VIOLET} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="chart-grid">
          {ticks.map((t, i) => (
            <line key={i} x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke={GRID} />
          ))}
        </g>
        {ticks.map((t, i) => (
          <text key={i} x={W - PAD_R + 8} y={y(t) + 3.5} className="chart-axis">{money(t)}</text>
        ))}
        {shown.map((r, i) => (
          <g key={i}>
            <line
              x1={PAD_L} x2={W - PAD_R} y1={y(r.value)} y2={y(r.value)} strokeDasharray="4 4" strokeWidth="1.2"
              stroke={r.tone === "bull" ? BULL : r.tone === "bear" ? BEAR : "#5C6478"}
            />
            <text
              x={PAD_L + 6} y={y(r.value) - 5} className="chart-axis"
              fill={r.tone === "bull" ? BULL : r.tone === "bear" ? BEAR : "#8B93A7"}
            >
              {r.label}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#fill${gid})`} />
        <path d={line} fill="none" stroke={VIOLET} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(ys[ys.length - 1])} r="4" fill={up ? BULL : BEAR} stroke="#10131B" strokeWidth="2" />
        {hp && (
          <g>
            <line x1={x(hover!.i)} x2={x(hover!.i)} y1={PAD_T} y2={H - PAD_B} stroke="#3A4356" strokeWidth="1" />
            <circle cx={x(hover!.i)} cy={y(hp.price)} r="4.5" fill={VIOLET} stroke="#10131B" strokeWidth="2" />
          </g>
        )}
      </svg>
      {dropped > 0 && (
        <p className="num absolute bottom-0 left-2 text-[10px] text-dim">
          {dropped} target{dropped > 1 ? "s" : ""} off-scale
        </p>
      )}
      {hp && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-line2 bg-panel/95 px-2.5 py-1.5 text-center shadow-card backdrop-blur"
          style={{ left: `${Math.min(88, Math.max(12, hover!.x))}%` }}
        >
          <div className="num text-[13px] font-bold text-fg">{money(hp.price)}</div>
          <div className="num text-[10px] text-dim">
            {new Date(hp.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── consensus gauge ──────────────────────────────────────────────────────────

/**
 * Where the board leans on one ticker. Diverging by nature: bear pole, neutral middle, bull pole.
 * The two poles sit in the CVD floor band, so the lean is always spelled out in words and in counts
 * next to the bar — colour never carries this alone.
 */
export function ConsensusGauge({
  net, longs, shorts, lean, compact = false,
}: { net: number; longs: number; shorts: number; lean: string; compact?: boolean }) {
  const pos = ((net + 1) / 2) * 100;
  return (
    <div>
      <div className="relative h-2.5 overflow-hidden rounded-pill bg-deep ring-1 ring-line">
        <div className="absolute inset-y-0 left-0 w-1/2" style={{ background: `linear-gradient(90deg, ${BEAR}44, transparent)` }} />
        <div className="absolute inset-y-0 right-0 w-1/2" style={{ background: `linear-gradient(270deg, ${BULL}44, transparent)` }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-line2" />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel transition-[left] duration-700"
          style={{ left: `${pos}%`, background: net > 0.2 ? BULL : net < -0.2 ? BEAR : "#8B93A7" }}
        />
      </div>
      <div className="num mt-2 flex items-center justify-between text-[11px]">
        <span className="text-bear">{shorts} short</span>
        <span className={`font-bold uppercase tracking-wider ${lean === "long" ? "text-bull" : lean === "short" ? "text-bear" : "text-muted"}`}>
          {lean}{compact ? "" : ` · net ${net > 0 ? "+" : ""}${(net * 100).toFixed(0)}`}
        </span>
        <span className="text-bull">{longs} long</span>
      </div>
    </div>
  );
}

// ── equity curve ─────────────────────────────────────────────────────────────

/** Cumulative realised edge across an agent's graded calls. One series, zero baseline, no legend. */
export function EquityCurve({ points, height = 150 }: { points: { i: number; cum: number; status: string; ticker: string; edge: number }[]; height?: number }) {
  const gid = useId().replace(/:/g, "");
  if (points.length < 2) {
    return <div className="flex h-[120px] items-center justify-center text-[13px] text-dim">needs at least two graded calls</div>;
  }
  const W = 640, H = height, PAD = 16, PAD_R = 46;
  const vals = points.map((p) => p.cum);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD - PAD_R);
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.cum).toFixed(2)}`).join(" ");
  const last = vals[vals.length - 1];
  const good = last >= 0;
  const colour = good ? BULL : BEAR;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label={`cumulative realised edge, currently ${last.toFixed(1)} percent`}>
      <defs>
        <linearGradient id={`eq${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity=".24" />
          <stop offset="1" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={PAD} x2={W - PAD_R} y1={y(0)} y2={y(0)} stroke={GRID} strokeWidth="1" />
      <text x={W - PAD_R + 6} y={y(0) + 3.5} className="chart-axis">0%</text>
      <text x={W - PAD_R + 6} y={y(hi) + 3.5} className="chart-axis">{hi.toFixed(0)}%</text>
      <path d={`${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#eq${gid})`} />
      <path d={line} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle
          key={i} cx={x(i)} cy={y(p.cum)} r={points.length > 40 ? 2 : 3}
          fill={p.status === "hit" ? BULL : BEAR} stroke="#10131B" strokeWidth="1.5"
        >
          <title>{`${p.ticker} ${p.status} · ${signedPct(p.edge / 100)} · running ${p.cum.toFixed(1)}%`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ── form strip ───────────────────────────────────────────────────────────────

/** Recent graded outcomes. Filled square = hit, hollow square = missed: shape as well as colour. */
export function FormStrip({ form, size = 7 }: { form: number[]; size?: number }) {
  if (!form.length) return <span className="text-[11px] text-dim">no graded calls</span>;
  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label={`last ${form.length} graded calls: ${form.map((f) => (f ? "hit" : "miss")).join(", ")}`}>
      {form.map((f, i) => (
        <span
          key={i}
          title={f ? "hit" : "missed"}
          className="inline-block rounded-[2px]"
          style={{
            width: size, height: size,
            background: f ? BULL : "transparent",
            border: f ? "none" : `1.5px solid ${BEAR}`,
          }}
        />
      ))}
    </span>
  );
}

// ── progress ─────────────────────────────────────────────────────────────────

/** Bonding-curve fill. One magnitude, rounded data end, 2px surface gap from the track. */
export function Progress({ progress, done, thin = false }: { progress: number; done: boolean; thin?: boolean }) {
  const w = done ? 100 : Math.max(1.5, Math.min(100, progress * 100));
  return (
    <div
      className={`overflow-hidden rounded-pill bg-deep ring-1 ring-line ${thin ? "h-1.5" : "h-2"}`}
      role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}
      aria-label="bonding curve filled"
    >
      <div
        className="h-full rounded-pill transition-[width] duration-700 ease-out"
        style={{ width: `${w}%`, background: done ? BULL : `linear-gradient(90deg, ${VIOLET}, #A99BFF)` }}
      />
    </div>
  );
}

/** A small horizontal bar for ranked lists (channel activity, ticker volume). */
export function MiniBar({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "mint" }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-pill bg-deep">
      <div className="h-full rounded-pill" style={{ width: `${w}%`, background: tone === "mint" ? "#43E8C0" : VIOLET }} />
    </div>
  );
}

export function ChartFrame({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold tracking-[-.01em]">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}
