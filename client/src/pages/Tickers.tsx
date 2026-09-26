import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Consensus, TickerRow } from "../lib/api";
import { api } from "../lib/api";
import { money, pct, signedPct } from "../lib/format";
import { ConsensusGauge } from "../components/charts";
import { Empty, Skeleton, StatTile } from "../components/ui";

export function Tickers() {
  const [rows, setRows] = useState<TickerRow[] | null>(null);
  const [consensus, setConsensus] = useState<Record<string, Consensus>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    api.tickers().then((r) => setRows(r.tickers)).catch(() => setRows([]));
    api.consensus()
      .then((r) => {
        setConsensus(Object.fromEntries(r.consensus.map((c) => [c.ticker, c])));
        setPrices(Object.fromEntries(r.consensus.filter((c) => c.price != null).map((c) => [c.ticker, c.price!])));
      })
      .catch(() => {});
  }, []);

  const active = (rows ?? []).filter((t) => t.open_calls > 0);
  const quiet = (rows ?? []).filter((t) => t.open_calls === 0);
  const graded = (rows ?? []).reduce((s, t) => s + t.graded, 0);
  const hits = (rows ?? []).reduce((s, t) => s + t.hits, 0);

  return (
    <div className="space-y-6 pt-10">
      <header>
        <p className="eyebrow">where the board has a position</p>
        <h1 className="h-page mt-2.5">tickers.</h1>
        <p className="mt-2.5 max-w-2xl text-[14.5px] leading-relaxed text-muted">
          Each ticker is a channel and a scoreboard. Consensus weights every open call by the caller's ranking score, so
          a long record counts for more than a loud opinion.
        </p>
      </header>

      <div className="card overflow-hidden !rounded-[20px]">
        <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
          <StatTile value={rows?.length ?? "—"} label="tickers" />
          <StatTile value={active.length} label="with open calls" tone="brand" />
          <StatTile value={graded} label="graded calls" />
          <StatTile value={graded ? pct(hits / graded) : "—"} label="board hit rate" tone={graded && hits / graded >= 0.5 ? "bull" : "bear"} />
        </div>
      </div>

      {!rows && <Skeleton rows={3} />}

      {!!active.length && (
        <section>
          <h2 className="mb-3 text-[16px] font-bold">open positions</h2>
          <ul className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {active.map((t) => {
              const c = consensus[t.ticker];
              const price = prices[t.ticker];
              return (
                <li key={t.ticker}>
                  <Link to={`/t/${t.ticker.toLowerCase()}`} className="card card-hover block h-full p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[17px] font-bold tracking-[-.02em]">${t.ticker}</p>
                        <p className="truncate text-[12px] text-dim">{t.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="num text-[15px] font-bold">{money(price)}</p>
                        <p className="num text-[10.5px] text-dim">{t.open_calls} open</p>
                      </div>
                    </div>
                    {c && <div className="mt-4"><ConsensusGauge net={c.net} longs={c.longs} shorts={c.shorts} lean={c.lean} compact /></div>}
                    <dl className="num mt-3.5 grid grid-cols-3 gap-2 border-t border-line pt-3">
                      <div>
                        <dt className="label">record</dt>
                        <dd className="mt-0.5 text-[13px] font-bold">{t.hits}/{t.graded}</dd>
                      </div>
                      <div>
                        <dt className="label">hit rate</dt>
                        <dd className={`mt-0.5 text-[13px] font-bold ${(t.hit_rate ?? 0) >= 0.5 ? "text-bull" : "text-bear"}`}>{pct(t.hit_rate)}</dd>
                      </div>
                      <div>
                        <dt className="label">edge</dt>
                        <dd className={`mt-0.5 text-[13px] font-bold ${(t.avg_edge ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{signedPct(t.avg_edge)}</dd>
                      </div>
                    </dl>
                    {c?.implied_move != null && (
                      <p className="num mt-3 text-[11px] text-dim">
                        consensus target {money(c.consensus_target)} ·{" "}
                        <span className={c.implied_move >= 0 ? "text-bull" : "text-bear"}>
                          {c.implied_move >= 0 ? "+" : ""}{c.implied_move}%
                        </span>{" "}
                        from here
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {rows && !rows.length && <Empty title="No tickers configured" icon="◦" />}

      {!!quiet.length && (
        <section>
          <h2 className="mb-1 text-[16px] font-bold">no open calls</h2>
          <p className="mb-3 text-[12.5px] text-muted">Nobody is committed on these right now.</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {quiet.map((t) => (
              <li key={t.ticker}>
                <Link to={`/t/${t.ticker.toLowerCase()}`} className="card card-hover flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-bold">${t.ticker}</span>
                    <span className="block truncate text-[11px] text-dim">{t.name}</span>
                  </span>
                  <span className="num text-right text-[11px] text-dim">
                    {t.graded ? (
                      <>
                        <span className={`block text-[13px] font-bold ${(t.hit_rate ?? 0) >= 0.5 ? "text-bull" : "text-bear"}`}>{pct(t.hit_rate)}</span>
                        {t.hits}/{t.graded}
                      </>
                    ) : "untested"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
