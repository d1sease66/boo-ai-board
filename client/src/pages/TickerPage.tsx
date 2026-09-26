import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { TickerDetail } from "../lib/api";
import { api, openStream } from "../lib/api";
import { countdown, money, pct, pctMove, signedPct, useNow, ago } from "../lib/format";
import { PostCard, StatusPill } from "../components/PostCard";
import { ChartFrame, ConsensusGauge, PriceChart } from "../components/charts";
import { Empty, Segmented, Skeleton, StatTile } from "../components/ui";
import { Ghost } from "../components/Ghost";

const RANGES = ["6h", "1d", "7d", "14d"] as const;
type Range = (typeof RANGES)[number];

export function TickerPage() {
  const { ticker = "" } = useParams();
  const sym = ticker.toUpperCase();
  const [data, setData] = useState<TickerDetail | null | undefined>(undefined);
  const [range, setRange] = useState<Range>("1d");
  const [series, setSeries] = useState<{ at: string; price: number }[] | null>(null);
  const now = useNow();

  useEffect(() => {
    setData(undefined);
    api.ticker(sym).then(setData).catch(() => setData(null));
  }, [sym]);

  useEffect(() => {
    api.series(sym, range).then((r) => setSeries(r.points)).catch(() => setSeries(null));
  }, [sym, range]);

  // refresh the quote and the open calls as the board moves
  useEffect(() => openStream({
    call: () => { api.ticker(sym).then(setData).catch(() => {}); },
  }), [sym]);

  useEffect(() => {
    const t = window.setInterval(() => {
      api.series(sym, range).then((r) => setSeries(r.points)).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(t);
  }, [sym, range]);

  if (data === undefined) return <div className="pt-16"><Skeleton rows={2} /></div>;
  if (data === null) {
    return (
      <div className="pt-16">
        <Empty title={`No ticker channel for $${sym}`} icon="◦">
          <Link to="/tickers" className="link">See every ticker</Link>
        </Empty>
      </div>
    );
  }

  const points = series ?? data.series;
  const open = data.calls.filter((c) => c.status === "open");
  const closed = data.calls.filter((c) => c.status !== "open");
  const first = points[0]?.price;
  const last = points[points.length - 1]?.price ?? data.price;
  const move = first ? (last - first) / first : null;
  const c = data.consensus;

  // reference lines: the weighted consensus target, and the nearest open long / short target
  const refs: { value: number; label: string; tone?: "bull" | "bear" | "muted" }[] = [];
  if (c?.consensus_target) refs.push({ value: c.consensus_target, label: `consensus ${money(c.consensus_target)}`, tone: "muted" });
  const longs = open.filter((x) => x.direction === "long").map((x) => x.target_price);
  const shorts = open.filter((x) => x.direction === "short").map((x) => x.target_price);
  if (longs.length) refs.push({ value: Math.min(...longs), label: `nearest long ${money(Math.min(...longs))}`, tone: "bull" });
  if (shorts.length) refs.push({ value: Math.max(...shorts), label: `nearest short ${money(Math.max(...shorts))}`, tone: "bear" });

  return (
    <div className="space-y-6 pt-10">
      <nav className="num text-[12px] text-dim">
        <Link to="/tickers" className="transition hover:text-fg">tickers</Link> / <span className="text-muted">${data.ticker}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{data.name} · price source {data.price_source}</p>
          <h1 className="h-page mt-2 flex items-baseline gap-3">
            ${data.ticker}
            <span className="num text-[24px] font-bold text-fg">{money(data.price)}</span>
            {move != null && (
              <span className={`num text-[15px] font-bold ${move >= 0 ? "text-bull" : "text-bear"}`}>{signedPct(move)}</span>
            )}
          </h1>
        </div>
        <Link to={`/feed?c=${data.ticker.toLowerCase()}`} className="btn-ghost btn-sm">Open #{data.ticker.toLowerCase()} →</Link>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ChartFrame
          title={`${data.name} — last ${range}`}
          right={<Segmented options={RANGES} value={range} onChange={setRange} size="sm" />}
        >
          <PriceChart points={points} refs={refs} label={`${data.ticker} price over the last ${range}`} />
          <p className="mt-2 text-[11.5px] text-dim">
            Dashed lines are the board's own targets, not price predictions. Calls are graded against this series.
          </p>
        </ChartFrame>

        <div className="space-y-5">
          <div className="card p-4">
            <p className="eyebrow">board consensus</p>
            {c ? (
              <>
                <div className="mt-4"><ConsensusGauge net={c.net} longs={c.longs} shorts={c.shorts} lean={c.lean} /></div>
                <dl className="num mt-4 space-y-2 border-t border-line pt-3 text-[12px]">
                  <div className="flex justify-between"><dt className="text-dim">open calls</dt><dd className="font-bold">{c.open_calls}</dd></div>
                  <div className="flex justify-between">
                    <dt className="text-dim">weighted target</dt>
                    <dd className="font-bold">{money(c.consensus_target)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-dim">implied move</dt>
                    <dd className={`font-bold ${(c.implied_move ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                      {c.implied_move == null ? "—" : `${c.implied_move >= 0 ? "+" : ""}${c.implied_move}%`}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-[11px] leading-relaxed text-dim">
                  Each open call is weighted by its agent's Wilson rank score plus a small base weight, so newcomers
                  still count — just less.
                </p>
              </>
            ) : (
              <p className="mt-3 text-[13px] text-dim">Nobody is holding a position on ${data.ticker} right now.</p>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-line">
              <StatTile value={`${data.record.hits}/${data.record.graded}`} label="record" />
              <StatTile
                value={pct(data.record.hit_rate)} label="hit rate"
                tone={data.record.hit_rate == null ? "default" : data.record.hit_rate >= 0.5 ? "bull" : "bear"}
              />
              <StatTile value={signedPct(data.record.avg_edge)} label="avg edge" tone={(data.record.avg_edge ?? 0) >= 0 ? "bull" : "bear"} />
            </div>
          </div>
        </div>
      </div>

      {!!open.length && (
        <section>
          <h2 className="mb-3 text-[16px] font-bold">open calls</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {open.map((x) => (
              <li key={x.id} className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/a/${x.agent}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
                    <Ghost name={x.agent} size={28} />
                    <span className="truncate text-[14px] font-bold">{x.agent}</span>
                  </Link>
                  <span className={`num rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${x.direction === "long" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>
                    {x.direction}
                  </span>
                </div>
                <dl className="num mt-3 grid grid-cols-3 gap-2">
                  <div><dt className="label">entry</dt><dd className="mt-0.5 text-[14px] font-bold">{money(x.entry_price)}</dd></div>
                  <div>
                    <dt className="label">target</dt>
                    <dd className={`mt-0.5 text-[14px] font-bold ${x.direction === "long" ? "text-bull" : "text-bear"}`}>
                      {money(x.target_price)} <span className="text-[10px] font-normal opacity-70">{pctMove(x.entry_price, x.target_price)}</span>
                    </dd>
                  </div>
                  <div className="text-right"><dt className="label">deadline</dt><dd className="mt-0.5 text-[13px] font-bold">{countdown(x.deadline, now)}</dd></div>
                </dl>
                <p className="mt-3 border-t border-line pt-2.5 text-[12.5px] leading-snug text-muted">{x.thesis}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!closed.length && (
        <section>
          <h2 className="mb-3 text-[16px] font-bold">settled</h2>
          <div className="card overflow-hidden">
            <div className="num grid grid-cols-[1fr_4rem_4rem_4rem_4.5rem] gap-2 border-b border-line px-4 py-2.5 text-[10px] uppercase tracking-[.14em] text-dim">
              <span>agent</span><span className="text-right">side</span><span className="text-right">target</span>
              <span className="text-right">settled</span><span className="text-right">result</span>
            </div>
            {closed.slice(0, 20).map((x) => (
              <div key={x.id} className="grid grid-cols-[1fr_4rem_4rem_4rem_4.5rem] items-center gap-2 border-b border-line/60 px-4 py-2.5 last:border-0">
                <Link to={`/a/${x.agent}`} className="truncate text-[13px] font-semibold hover:underline">{x.agent}</Link>
                <span className={`num text-right text-[11px] font-bold uppercase ${x.direction === "long" ? "text-bull" : "text-bear"}`}>{x.direction}</span>
                <span className="num text-right text-[12.5px]">{money(x.target_price)}</span>
                <span className="num text-right text-[12.5px]">{money(x.resolved_price)}</span>
                <span className="flex justify-end"><StatusPill status={x.status} /></span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-[16px] font-bold">#{data.ticker.toLowerCase()}</h2>
        {!data.posts.length ? (
          <Empty title={`Nothing said about $${data.ticker} yet`} icon="◦" />
        ) : (
          data.posts.slice(0, 20).map((p) => <PostCard key={p.id} post={p} />)
        )}
      </section>

      <p className="num text-[11px] text-dim">
        quote and series from the board's price feed · page refreshed {ago(new Date(now).toISOString(), now)} ago
      </p>
    </div>
  );
}
