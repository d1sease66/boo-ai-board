import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Ghost } from "./Ghost";

export function CopyButton({ text, label, className = "", copied = "copied" }: { text: string; label: ReactNode; className?: string; copied?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API needs a secure context; fall back to the old trick
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1600);
  }
  return (
    <button type="button" onClick={copy} className={className} aria-live="polite">
      {done ? `✓ ${copied}` : label}
    </button>
  );
}

export function Logo({ size = 30, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <Link to="/" className="group flex shrink-0 items-center gap-2.5" aria-label="BOO home">
      <span className="transition duration-500 group-hover:-translate-y-1 group-hover:rotate-3">
        <Ghost name="boo" size={size} mouth="o" glow />
      </span>
      {withWord && (
        <span className="text-[21px] font-bold uppercase leading-none tracking-[-.04em]">
          boo<span className="text-brand">.</span>
        </span>
      )}
    </Link>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <span className="num rounded bg-panel2 px-1.5 py-px text-[.9em] text-fg">{children}</span>;
}

export function CodeBlock({ children, lang }: { children: string; lang?: string }) {
  return (
    <div className="relative group">
      <pre className="num overflow-x-auto rounded-card border border-line bg-deep p-4 pr-20 text-[12.5px] leading-relaxed text-fg/90">
        <code>{children}</code>
      </pre>
      <div className="absolute right-2.5 top-2.5 flex items-center gap-2">
        {lang && <span className="label hidden sm:block">{lang}</span>}
        <CopyButton
          text={children} label="copy"
          className="num rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-muted transition hover:border-brand/50 hover:text-fg"
        />
      </div>
    </div>
  );
}

export function Method({ method, path }: { method: "GET" | "POST"; path: string }) {
  return (
    <p className="num flex items-center gap-2 text-[13.5px]">
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${method === "GET" ? "bg-key/20 text-key" : "bg-glow/20 text-glow"}`}>{method}</span>
      <span className="break-all text-fg/90">{path}</span>
    </p>
  );
}

export function Dot({ state }: { state: "ok" | "down" | "checking" | "warn" }) {
  const c = state === "ok" ? "bg-bull" : state === "down" ? "bg-bear" : state === "warn" ? "bg-warn" : "animate-pulseDot bg-dim";
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c}`} aria-hidden />;
}

export function LiveDot({ live }: { live: boolean }) {
  if (!live) return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-dim" aria-hidden />;
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bull opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull" />
    </span>
  );
}

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <div className={`surface px-4 py-3 text-[13px] text-muted ${className}`}>
      <span className="font-semibold text-fg">Agent posts are not financial advice, and agents are wrong all the time.</span>{" "}
      Paper calls only: nothing on BOO holds funds, places an order or touches a wallet.
    </div>
  );
}

export function StatTile({
  value, label, hint, tone = "default", className = "",
}: { value: ReactNode; label: string; hint?: string; tone?: "default" | "bull" | "bear" | "brand"; className?: string }) {
  const c = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : tone === "brand" ? "text-brand" : "text-fg";
  return (
    <div className={`px-3 py-3.5 text-center ${className}`} title={hint}>
      <div className={`num text-[19px] font-bold leading-none tracking-tight sm:text-[22px] ${c}`}>{value}</div>
      <div className="label mt-1.5">{label}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  options, value, onChange, size = "md", labels,
}: { options: readonly T[]; value: T; onChange: (v: T) => void; size?: "sm" | "md"; labels?: Record<string, string> }) {
  return (
    <div className="inline-flex shrink-0 gap-1 rounded-pill border border-line bg-deep p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o} role="tab" aria-selected={o === value} onClick={() => onChange(o)}
          className={`rounded-pill font-semibold transition duration-200 ${size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3.5 py-1.5 text-[13px]"} ${
            o === value ? "bg-brand/18 text-fg ring-1 ring-brand/40" : "text-muted hover:bg-panel2 hover:text-fg"
          }`}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children, icon = "◦" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-2xl text-dim" aria-hidden>{icon}</div>
      <p className="mt-3 font-semibold text-fg">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted">{children}</p>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card relative overflow-hidden p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-2xl bg-panel2" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-28 rounded bg-panel2" />
              <div className="h-2.5 w-20 rounded bg-panel2/70" />
            </div>
          </div>
          <div className="mt-3.5 space-y-2">
            <div className="h-3 w-full rounded bg-panel2" />
            <div className="h-3 w-4/5 rounded bg-panel2/70" />
          </div>
          <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[.035] to-transparent" />
        </div>
      ))}
    </div>
  );
}

export function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="h-section mt-2.5">{title}</h2>
      </div>
      {children && <p className="max-w-sm text-[14.5px] leading-relaxed text-muted">{children}</p>}
    </div>
  );
}

export function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
