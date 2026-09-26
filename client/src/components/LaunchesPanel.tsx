import { useState } from "react";
import { Link } from "react-router-dom";
import { decayedHeat, useFeed, useLaunchList, useLaunchpadStats } from "../lib/api";
import { amount, useNow } from "../lib/format";
import { CoinLogo } from "./PostCard";
import { Progress } from "./charts";
import { LiveDot, Segmented } from "./ui";

/** The launchpad rail: what is filling right now, beside the feed. */
export function LaunchesPanel({ limit = 8, title = "launchpad" }: { limit?: number; title?: string }) {
  const [tab, setTab] = useState<"hot" | "new" | "graduated">("hot");
  const feed = useFeed();
  const stats = useLaunchpadStats();
  const list = useLaunchList(tab, limit);
  const now = useNow();
  const live = feed.state === "live";

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow flex items-center gap-2">
          <LiveDot live={live} />
          {live ? "live" : "offline"} · {title}
        </span>
        <span className="label">
          {feed.state === "loading" ? "…" : "chain" in feed ? feed.chain : ""}
          {"source" in feed && feed.source === "sim" ? " · sim" : ""}
        </span>
      </div>

      <div className="mt-3">
        <Segmented options={["hot", "new", "graduated"] as const} value={tab} onChange={setTab} size="sm" />
      </div>

      {feed.state === "unavailable" && (
        <p className="py-6 text-center text-[13px] text-dim">
          feed unavailable. <Link to="/status" className="link">check status</Link>
        </p>
      )}
      {feed.state === "loading" && <p className="py-6 text-center text-[13px] text-dim">connecting to the launchpad…</p>}
      {live && !list.length && <p className="py-6 text-center text-[13px] text-dim">waiting for the next coin to hit the curve…</p>}

      {live && (
        <ul className="mt-3 divide-y divide-line">
          {list.map((l) => {
            const done = l.phase !== "curve";
            const sym = l.symbol.replace(/^\$+/, "");
            const heat = decayedHeat(l.heat, l.heat_at, now) * l.threshold;
            return (
              <li key={l.id}>
                <Link to={`/launch/${l.token_address}`} className="flex items-center gap-3 py-2.5 transition hover:opacity-75">
                  <CoinLogo symbol={sym} url={l.logo_url} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-[13.5px] font-bold">{l.name}</span>
                      <span className="shrink-0 text-[11.5px] text-dim">${sym}</span>
                    </div>
                    <div className="mt-1.5"><Progress progress={l.progress} done={done} thin /></div>
                  </div>
                  <div className="w-[62px] text-right">
                    <div className={`num text-[13px] font-bold ${done ? "text-bull" : "text-fg"}`}>
                      {done ? (l.phase === "graduated" ? "grad" : "sold") : `${Math.round(l.progress * 100)}%`}
                    </div>
                    <div className="num whitespace-nowrap text-[10px] text-dim">{amount(heat)} {l.pair_symbol}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {stats && live && (
        <div className="num mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[10.5px] text-dim">
          <span>{stats.on_curve} on curve</span>
          <span>{stats.graduated} graduated</span>
          <Link to="/launchpad" className="text-brand transition hover:text-fg">all ↗</Link>
        </div>
      )}
    </div>
  );
}
