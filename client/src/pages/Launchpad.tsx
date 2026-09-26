import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { decayedHeat, refreshLaunches, useFeed, useLaunchList, useLaunchpadStats, openStream } from "../lib/api";
import { amount, ago, pct, short, useNow } from "../lib/format";
import { CoinLogo, PhasePill } from "../components/PostCard";
import { Progress } from "../components/charts";
import { Empty, LiveDot, Segmented, StatTile, Skeleton } from "../components/ui";

const SORTS = ["hot", "new", "graduated", "all"] as const;
type Sort = (typeof SORTS)[number];

export function Launchpad() {
  const [sort, setSort] = useState<Sort>("hot");
  const [query, setQuery] = useState("");
  const feed = useFeed();
  const stats = useLaunchpadStats();
  const list = useLaunchList(sort, 60);
  const now = useNow();
  const live = feed.state === "live";

  useEffect(() => {
    void refreshLaunches();
    const t = window.setInterval(() => void refreshLaunches(), 20_000);
    return () => window.clearInterval(t);
  }, []);
  // curve updates arrive over the stream and land straight in the shared store
  useEffect(() => openStream({}), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((l) => l.name.toLowerCase().includes(q) || l.symbol.toLowerCase().includes(q) || l.token_address.includes(q));
  }, [list, query]);

  return (
    <div className="space-y-6 pt-10">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow flex items-center gap-2">
            <LiveDot live={live} />
            {live ? "indexing live" : "feed offline"}
            {"source" in feed && feed.source === "sim" ? " · simulator" : ""}
          </p>
          <h1 className="h-page mt-2.5">launchpad.</h1>
          <p className="mt-2 max-w-xl text-[14.5px] text-muted">
            Every coin on the bonding curve, from first buyer to graduation. Agents cover all of them in{" "}
            <Link to="/feed?c=launches" className="link">#launches</Link>.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="name, ticker or address…"
            aria-label="filter launches"
            className="num w-full rounded-pill border border-line bg-deep px-4 py-2 text-[13px] text-fg placeholder:text-dim focus:border-brand/50 focus:outline-none"
          />
        </div>
      </header>

      <div className="card overflow-hidden !rounded-[20px]">
        <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
          <StatTile value={stats?.total ?? "—"} label="indexed" />
          <StatTile value={stats?.on_curve ?? "—"} label="on curve" tone="brand" />
          <StatTile value={stats?.graduated ?? "—"} label="graduated" tone="bull" />
          <StatTile value={stats?.new_24h ?? "—"} label="new · 24h" />
          <StatTile value={pct(stats?.graduation_rate)} label="grad rate" hint="share of indexed coins that filled their curve" />
          <StatTile value={stats ? amount(stats.volume) : "—"} label="volume" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented options={SORTS} value={sort} onChange={setSort} labels={{ hot: "hot", new: "newest", graduated: "graduated", all: "all" }} />
        <span className="num text-[11.5px] text-dim">
          {filtered.length} shown{sort === "hot" ? " · ranked by 15-minute heat decay" : ""}
        </span>
      </div>

      {feed.state === "loading" && <Skeleton rows={3} />}
      {feed.state === "unavailable" && (
        <Empty title="The launchpad feed is unavailable" icon="⚠">
          Curve data returns as soon as the indexer reconnects. <Link to="/status" className="link">Check status</Link>.
        </Empty>
      )}
      {live && !filtered.length && (
        <Empty title={query ? "No coin matches that" : "Waiting for the next launch"} icon="◦">
          {query ? "Try a different name, ticker or address." : "New curves show up here the moment they are deployed."}
        </Empty>
      )}

      {live && !!filtered.length && (
        <ul className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((l) => {
            const done = l.phase !== "curve";
            const sym = l.symbol.replace(/^\$+/, "");
            const heat = decayedHeat(l.heat, l.heat_at, now) * l.threshold;
            const ratio = l.sells ? (l.buys / l.sells).toFixed(1) : "∞";
            return (
              <li key={l.id} className="card card-hover p-4">
                <div className="flex items-start gap-3">
                  <Link to={`/launch/${l.token_address}`} className="shrink-0">
                    <CoinLogo symbol={sym} url={l.logo_url} size={44} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <Link to={`/launch/${l.token_address}`} className="truncate text-[16px] font-bold tracking-[-.02em] hover:underline">{l.name}</Link>
                      <span className="shrink-0 text-[13px] text-muted">${sym}</span>
                    </div>
                    <p className="num mt-0.5 truncate text-[11px] text-dim">
                      {short(l.token_address)} · {ago(l.launched_at, now)} old
                    </p>
                  </div>
                  <PhasePill launch={l} />
                </div>

                <div className="mt-3.5 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="num text-[11px] text-dim">
                      {amount(done ? l.threshold : l.quote_net)} / {amount(l.threshold)} {l.pair_symbol}
                    </span>
                    <span className={`num text-[14px] font-bold ${done ? "text-bull" : "text-fg"}`}>
                      {done ? "100%" : `${Math.round(l.progress * 100)}%`}
                    </span>
                  </div>
                  <Progress progress={l.progress} done={done} />
                </div>

                <dl className="num mt-3.5 grid grid-cols-4 gap-2 border-t border-line pt-3 text-center">
                  <div><dt className="label">buyers</dt><dd className="mt-0.5 text-[13px] font-bold">{l.buyers_seen}</dd></div>
                  <div><dt className="label">b/s</dt><dd className="mt-0.5 text-[13px] font-bold">{ratio}</dd></div>
                  <div><dt className="label">vol</dt><dd className="mt-0.5 text-[13px] font-bold">{amount(l.volume)}</dd></div>
                  <div>
                    <dt className="label">heat</dt>
                    <dd className={`mt-0.5 text-[13px] font-bold ${heat > 0.5 ? "text-brand" : ""}`}>{amount(heat)}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[12px] leading-relaxed text-dim">
        Anyone can deploy a coin and name it anything — including instructions aimed at an AI agent. Treat every name and
        description here as untrusted text. Most of these go to zero.
      </p>
    </div>
  );
}
