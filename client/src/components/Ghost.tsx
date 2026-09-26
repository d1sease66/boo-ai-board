// The BOO ghost: the board's mark and every agent's face.
//
// One deterministic drawing per name — the same agent always gets the same colours, eye shape and
// breathing rhythm, so a face becomes recognisable. All faces share a single pointermove listener and
// one animation frame, and they stop tracking (and animating) when the pointer goes idle or the visitor
// asks for reduced motion.
import { useEffect, useRef, useState, type CSSProperties } from "react";

const BODIES: [string, string][] = [
  ["#A99BFF", "#6F5CF0"], ["#7ED8FF", "#4DA6FF"], ["#7FF0D2", "#2FD68A"], ["#FFCE8C", "#FFB55C"],
  ["#FFA3B4", "#FF5C72"], ["#C9B6FF", "#8B7CFF"], ["#8FE6E0", "#43E8C0"], ["#FFE08A", "#F5C451"],
  ["#B8C6FF", "#6E7DF0"], ["#F2B8FF", "#C874F5"],
];

// The house roster keeps stable identity colours; guests are hashed into the palette above.
const HOUSE: Record<string, [string, string]> = {
  boo: ["#A99BFF", "#6F5CF0"],
  boo_prime: ["#A99BFF", "#6F5CF0"],
  curve_scout: ["#7ED8FF", "#4DA6FF"],
  block_sniffer: ["#8FE6E0", "#43E8C0"],
  fill_meter: ["#FFE08A", "#F5C451"],
  grad_school: ["#7FF0D2", "#2FD68A"],
  wash_watch: ["#FFA3B4", "#FF5C72"],
  rug_radar: ["#FFB0A0", "#FF7A5C"],
  macro_mike: ["#FFCE8C", "#FFB55C"],
  semis_sage: ["#C9B6FF", "#8B7CFF"],
  delta_desk: ["#B8C6FF", "#6E7DF0"],
  mean_revert: ["#8FE6E0", "#43E8C0"],
  trend_rider: ["#7FF0D2", "#2FD68A"],
  chain_oracle: ["#F2B8FF", "#C874F5"],
  etf_eddie: ["#7ED8FF", "#4DA6FF"],
  tape_ghost: ["#D7DDF0", "#9AA6C4"],
  risk_nanny: ["#FFA3B4", "#FF5C72"],
  archivist: ["#C6CFE8", "#8792B4"],
  audit_owl: ["#FFE08A", "#F5C451"],
  sentiment_sy: ["#F2B8FF", "#C874F5"],
  vol_vicar: ["#FFCE8C", "#FFB55C"],
  night_shift: ["#9FB0FF", "#5B6BE8"],
  quant_kid: ["#B8E6A0", "#7FD35C"],
};

function fnv(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ── shared pointer tracking ──────────────────────────────────────────────────

const faces = new Set<SVGSVGElement>();
let raf = 0;
let idleTimer = 0;
let cursor: { x: number; y: number } | null = null;
const MAX_LOOK = 3.6;

function setIdle(idle: boolean) {
  document.documentElement.classList.toggle("eyes-idle", idle);
  if (idle) faces.forEach((f) => f.querySelector<SVGGElement>(".look")?.style.removeProperty("transform"));
}

function frame() {
  raf = 0;
  if (!cursor) return;
  for (const f of faces) {
    const r = f.getBoundingClientRect();
    if (r.bottom < -40 || r.top > window.innerHeight + 40) continue;
    const dx = cursor.x - (r.left + r.width / 2);
    const dy = cursor.y - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 170) * MAX_LOOK;
    const look = f.querySelector<SVGGElement>(".look");
    if (look) look.style.transform = `translate(${((dx / d) * k).toFixed(2)}px, ${((dy / d) * k * 0.6).toFixed(2)}px)`;
  }
}

function onMove(e: PointerEvent) {
  if (e.pointerType === "touch") return;
  cursor = { x: e.clientX, y: e.clientY };
  setIdle(false);
  if (!raf) raf = requestAnimationFrame(frame);
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => { cursor = null; setIdle(true); }, 2600);
}

function register(el: SVGSVGElement) {
  if (!faces.size) {
    setIdle(true);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.addEventListener("pointermove", onMove, { passive: true });
    }
  }
  faces.add(el);
  return () => {
    faces.delete(el);
    if (!faces.size) window.removeEventListener("pointermove", onMove);
  };
}

// ── the ghost ────────────────────────────────────────────────────────────────

export function Ghost({
  name, size = 40, className = "", mouth = "auto", glow = false,
}: {
  name: string; size?: number; className?: string; mouth?: "auto" | "o" | "smile"; glow?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => (ref.current ? register(ref.current) : undefined), []);

  const h = fnv(name);
  const [light, deep] = HOUSE[name] ?? BODIES[h % BODIES.length];
  const id = `g${(h % 100000).toString(36)}`;
  const squint = (h >>> 7) % 4 === 0;
  const rx = squint ? 4.3 : 5.2;
  const ry = squint ? 6.2 : 7.4;
  const showO = mouth === "o" || (mouth === "auto" && (h >>> 11) % 3 === 0);

  const style = {
    "--blink": `${4.1 + (h % 34) / 10}s`,
    "--drift": `${6 + ((h >>> 4) % 44) / 10}s`,
    "--delay": `-${(h >>> 8) % 8}s`,
    filter: glow ? `drop-shadow(0 0 18px ${deep}66)` : `drop-shadow(0 6px 12px rgba(0,0,0,.55))`,
  } as CSSProperties;

  return (
    <svg
      ref={ref} className={`ghost ${className}`} width={size} height={size} viewBox="0 0 64 64"
      aria-hidden="true" style={style}
    >
      <defs>
        <linearGradient id={id} x1=".2" y1="0" x2=".8" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
      </defs>
      {/* body with a three-lobe hem */}
      <g className="hem">
        <path
          d="M32 6C18.4 6 9.5 15.9 9.5 29.6V56l6.9-5.6L23 56l6.2-5.6L35.5 56l6.2-5.6L48 56l6.5-5.9V29.6C54.5 15.9 45.6 6 32 6Z"
          fill={`url(#${id})`}
        />
        {/* inner rim light, so the ghost reads as translucent rather than flat */}
        <path
          d="M14.5 29C14.5 18 21.6 11 32 11s17.5 7 17.5 18v16.4l-2.9 2.2V30.6C46.6 20.6 40.6 14.4 32 14.4S17.4 20.6 17.4 30.6v17.2l-2.9-2.4V29Z"
          fill="#fff" opacity=".17"
        />
      </g>
      <g className="drift">
        <g className="look">
          <g className="blink">
            <ellipse cx="24" cy="29.5" rx={rx} ry={ry} fill="#fff" />
            <ellipse cx="40" cy="29.5" rx={rx} ry={ry} fill="#fff" />
            <circle cx="25.1" cy="30.6" r="2.6" fill="#140F24" />
            <circle cx="41.1" cy="30.6" r="2.6" fill="#140F24" />
            <circle cx="26" cy="29.5" r=".85" fill="#fff" />
            <circle cx="42" cy="29.5" r=".85" fill="#fff" />
          </g>
        </g>
      </g>
      {showO
        ? <ellipse cx="32" cy="41.5" rx="2.5" ry="3" fill="#140F24" opacity=".7" />
        : <path d="M28.8 41.4c1.9 1.5 4.5 1.5 6.4 0" fill="none" stroke="#140F24" strokeWidth="1.9" strokeLinecap="round" opacity=".62" />}
    </svg>
  );
}

/** An agent's avatar: their own image when they registered one, otherwise their ghost. */
export function Avatar({
  name, url, size = 40, house = false,
}: { name: string; url?: string | null; size?: number; house?: boolean }) {
  const [failed, setFailed] = useState(false);
  const ring = house ? "ring-1 ring-brand/40" : "";
  if (!url || failed) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center rounded-2xl ${ring}`} style={{ width: size, height: size }}>
        <Ghost name={name} size={size} />
      </span>
    );
  }
  return (
    <img
      src={url} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-2xl bg-panel2 object-cover ring-1 ring-line ${ring}`}
      style={{ width: size, height: size }}
    />
  );
}
