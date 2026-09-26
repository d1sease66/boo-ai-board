import { useEffect, useState } from "react";

export function money(n: number | null | undefined) {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 10_000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

export function compact(n: number | null | undefined) {
  if (n == null) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}b`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}m`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function amount(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "0";
  const v = Number(n);
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);
  return v === 0 ? "0" : v.toPrecision(2);
}

export function pct(v: number | null | undefined, digits = 0) {
  return v == null ? "—" : `${(Number(v) * 100).toFixed(digits)}%`;
}

export function signedPct(v: number | null | undefined, digits = 1) {
  if (v == null) return "—";
  const x = Number(v) * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

export function pctMove(entry: number, target: number) {
  const p = ((Number(target) - Number(entry)) / Number(entry)) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function countdown(iso: string, now = Date.now()) {
  let n = Math.floor((Date.parse(iso) - now) / 1000);
  if (n <= 0) return "grading…";
  const d = Math.floor(n / 86400); n -= d * 86400;
  const h = Math.floor(n / 3600); n -= h * 3600;
  const m = Math.floor(n / 60); n -= m * 60;
  const p = (x: number) => String(x).padStart(2, "0");
  return d > 0 ? `${d}d ${p(h)}h` : `${p(h)}:${p(m)}:${p(n)}`;
}

export function short(s: string | null | undefined, head = 6, tail = 4) {
  if (!s) return "—";
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One shared 1s clock, so a page full of countdowns has a single interval. */
const subs = new Set<(t: number) => void>();
let timer: number | undefined;
export function useNow() {
  const [t, set] = useState(Date.now());
  useEffect(() => {
    subs.add(set);
    if (timer === undefined) timer = window.setInterval(() => subs.forEach((s) => s(Date.now())), 1000);
    return () => {
      subs.delete(set);
      if (!subs.size && timer !== undefined) { window.clearInterval(timer); timer = undefined; }
    };
  }, []);
  return t;
}

/** Re-verify an agent's ed25519 signature in the browser. The server's word is not required. */
const verifyCache = new Map<string, Promise<boolean>>();
export function verifyEd25519(publicKeyB64: string, message: string, signatureB64: string) {
  const k = `${publicKeyB64}\0${signatureB64}\0${message}`;
  let p = verifyCache.get(k);
  if (!p) {
    p = (async () => {
      try {
        const raw = Uint8Array.from(atob(publicKeyB64), (c) => c.charCodeAt(0));
        const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" } as AlgorithmIdentifier, false, ["verify"]);
        return await crypto.subtle.verify(
          "Ed25519", key,
          Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0)),
          new TextEncoder().encode(message),
        );
      } catch {
        return false;
      }
    })();
    verifyCache.set(k, p);
  }
  return p;
}
