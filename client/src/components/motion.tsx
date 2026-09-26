// Motion primitives.
//
// Everything here is CSS transitions driven by an IntersectionObserver or a single rAF loop — no
// animation library, nothing running while it is off-screen. Every effect checks
// prefers-reduced-motion and degrades to its finished state rather than disappearing.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** True once the element has scrolled into view. Latches, so an element never un-reveals. */
export function useInView<T extends HTMLElement>(options: IntersectionObserverInit = {}) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (reducedMotion() || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12, ...options },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, options]);

  return { ref, seen };
}

/** Fades and lifts its children in when they first scroll into view. */
export function Reveal({
  children, delay = 0, y = 22, as: Tag = "div", className = "",
}: { children: ReactNode; delay?: number; y?: number; as?: "div" | "section" | "li" | "span"; className?: string }) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const style: CSSProperties = {
    opacity: seen ? 1 : 0,
    transform: seen ? "none" : `translateY(${y}px)`,
    transition: `opacity .7s cubic-bezier(.2,.8,.25,1) ${delay}ms, transform .7s cubic-bezier(.2,.8,.25,1) ${delay}ms`,
    willChange: seen ? "auto" : "opacity, transform",
  };
  return (
    <Tag ref={ref as never} style={style} className={className}>
      {children}
    </Tag>
  );
}

/** Reveals children one after another, so a grid lands as a wave instead of a block. */
export function Stagger({
  children, step = 70, className = "",
}: { children: ReactNode[]; step?: number; className?: string }) {
  return (
    <div className={className}>
      {children.map((child, i) => (
        <Reveal key={i} delay={i * step}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Counts up to a number when it scrolls into view, and animates again whenever the value changes —
 * so a figure arriving over the live stream visibly ticks instead of silently swapping.
 */
export function CountUp({
  value, format = (n) => Math.round(n).toLocaleString("en-US"), duration = 1100, className = "",
}: { value: number | null | undefined; format?: (n: number) => string; duration?: number; className?: string }) {
  const { ref, seen } = useInView<HTMLSpanElement>();
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (!seen || value == null) return;
    if (reducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(a + (b - a) * easeOut(t));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value, duration]);

  return (
    <span ref={ref} className={className}>
      {value == null ? "—" : format(shown)}
    </span>
  );
}

/** A soft light that follows the pointer across a card. Pointer-only; touch never triggers it. */
export function Spotlight({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerEnter={(e) => e.pointerType !== "touch" && setOn(true)}
      onPointerLeave={() => setOn(false)}
      className={`spotlight ${on ? "spotlight-on" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** Tilts slightly towards the pointer. Used sparingly — one hero element, not every card. */
export function Tilt({ children, max = 7, className = "" }: { children: ReactNode; max?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch" || reducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.transform = `perspective(900px) rotateY(${(dx * max).toFixed(2)}deg) rotateX(${(-dy * max).toFixed(2)}deg)`;
    });
  }

  function reset() {
    const el = ref.current;
    if (el) el.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg)";
  }

  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={reset}
      className={className}
      style={{ transition: "transform .5s cubic-bezier(.2,.8,.25,1)", transformStyle: "preserve-3d" }}
    >
      {children}
    </div>
  );
}

/**
 * A seamless horizontal marquee. The content is rendered twice and translated by exactly half,
 * so the loop has no seam, and it pauses on hover so anything in it stays readable.
 */
export function Marquee({
  children, seconds = 40, className = "",
}: { children: ReactNode; seconds?: number; className?: string }) {
  return (
    <div className={`marquee ${className}`}>
      <div className="marquee-track" style={{ animationDuration: `${seconds}s` }}>
        <div className="marquee-set">{children}</div>
        <div className="marquee-set" aria-hidden>{children}</div>
      </div>
    </div>
  );
}

/** Reveals a headline word by word. Falls back to plain text without motion. */
export function WordReveal({ text, className = "", delay = 0 }: { text: string; className?: string; delay?: number }) {
  const { ref, seen } = useInView<HTMLSpanElement>();
  const words = text.split(" ");
  return (
    <span ref={ref} className={className}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom">
          <span
            className="inline-block"
            style={{
              opacity: seen ? 1 : 0,
              transform: seen ? "none" : "translateY(100%)",
              transition: `opacity .6s cubic-bezier(.2,.8,.25,1) ${delay + i * 55}ms, transform .6s cubic-bezier(.2,.8,.25,1) ${delay + i * 55}ms`,
            }}
          >
            {w}
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}

/** Progress of the page scroll, 0 → 1. Drives the reading bar under the header. */
export function useScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setP(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return p;
}
