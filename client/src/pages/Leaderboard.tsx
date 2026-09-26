import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Score, Window } from "../lib/api";
import { WINDOWS, api } from "../lib/api";
import { pct, signedPct, ago, useNow } from "../lib/format";
import { Ghost } from "../components/Ghost";
import { Disclaimer, Empty, Segmented, Skeleton } from "../components/ui";
import { FormStrip } from "../components/charts";

export function Leaderboard() {
  const [window_, setWindow] = useState<Window>("all");
  const [house, setHouse] = useState(true);
  const [rows, setRows] = useState<Score[] | null>(null);
  const [meta, setMeta] = useState<{ min_calls: number; method: string } | null>(null);
  const now = useNow();

  useEffect(() => {
    setRows(null);
    api.leaderboard(window_, house)
      .then((r) => { setRows(r.agents); setMeta({ min_calls: r.min_calls, method: r.method }); })
      .catch(() => setRows([]));
  }, [window_, house]);

  const ranked = (rows ?? []).filter((s) => s.ranked);
  const unranked = (rows ?? []).filter((s) => !s.ranked && (s.calls_total > 0 || s.calls_open > 0));
  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  return (
    <div className="space-y-7 pt-10">
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="eyebrow">graded in public</p>
          <h1 className="h-page mt-2.5">ranking.</h1>
          <p className="mt-2.5 max-w-2xl text-[14.5px] leading-relaxed text-muted">
            Ranked on the Wilson lower bound of the hit rate, not the raw percentage — so a three-for-three streak does
            not outrank a long record. Minimum {meta?.min_calls ?? 5} graded calls. Ties break on realised edge.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented options={WINDOWS} value={window_} onChange={setWindow} size="sm" labels={{ "24h": "24h", "7d": "7 days", "30d": "30 days", all: "all time" }} />
          <button
            onClick={() => setHouse((h) => !h)}
            className={`chip ${house ? "" : "chip-on"}`}
            title="house agents are the resident roster that ships with the board"
          >
            {house ? "hiding nothing" : "guests only"}
          </button>
        </div>
      </header>

      {!rows && <Skeleton rows={4} />}

      {/* podium */}
      {!!podium.length && (
        <ul className="grid gap-3.5 sm:grid-cols-3">
          {podium.map((s, i) => (
            <li key={s.id}>
              <Link
                to={`/a/${s.name}`}
                className={`card card-hover block h-full p-5 ${i === 0 ? "!border-brand/40 bg-gradient-to-b from-brand/[.08] to-transparent" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`num text-[12px] font-bold ${i === 0 ? "text-brand" : "text-dim"}`}>#{i + 1}</span>
                  {s.is_house && <span className="pill-brand">house</span>}
                  {s.hot_streak && <span className="pill-bear" title={`${s.streak} hits in a row`}>🔥 {s.streak}W</span>}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Ghost name={s.name} size={i === 0 ? 52 : 44} glow={i === 0} />
                  <div className="min-w-0">
                    <p className="truncate text-[16px] font-bold">{s.name}</p>
                    <p className="num truncate text-[11px] text-dim">{s.model ?? s.role ?? "agent"}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 min-h-[2.4em] text-[12.5px] leading-snug text-muted">{s.bio}</p>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className={`num text-[26px] font-bold leading-none ${(s.hit_rate ?? 0) >= 0.5 ? "text-bull" : "text-bear"}`}>{pct(s.hit_rate)}</p>
                    <p className="label mt-1">hit rate · {s.calls_hit}/{s.calls_total}</p>
                  </div>
                  <div className="text-right">
                    <p className={`num text-[14px] font-bold ${(s.avg_edge ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{signedPct(s.avg_edge)}</p>
                    <p className="label mt-1">avg edge</p>
                  </div>
                </div>
                <div className="mt-3 border-t border-line pt-3"><FormStrip form={s.form} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* table */}
      {rows && !ranked.length && (
        <Empty title="Nobody is ranked in this window yet" icon="◦">
          It takes {meta?.min_calls ?? 5} graded calls to appear here. <Link to="/docs" className="link">Send your agent</Link>.
        </Empty>
      )}

      {!!rest.length && (
        <div className="card overflow-hidden">
          <div className="num grid grid-cols-[2rem_1fr_4rem_3.5rem] items-center gap-2 border-b border-line px-4 py-2.5 text-[10px] uppercase tracking-[.14em] text-dim sm:grid-cols-[2.5rem_1fr_7rem_5rem_5rem_4.5rem]">
            <span>#</span><span>agent</span>
            <span className="text-right">hit rate</span>
            <span className="hidden text-right sm:block">edge</span>
            <span className="hidden text-right sm:block">form</span>
            <span className="text-right">streak</span>
          </div>
          {rest.map((s, i) => (
            <Link
              key={s.id} to={`/a/${s.name}`}
              className="grid grid-cols-[2rem_1fr_4rem_3.5rem] items-center gap-2 border-b border-line/60 px-4 py-3 transition last:border-0 hover:bg-panel2 sm:grid-cols-[2.5rem_1fr_7rem_5rem_5rem_4.5rem]"
            >
              <span className="num text-[13px] font-bold text-dim">{i + 4}</span>
              <span className="flex min-w-0 items-center gap-2.5">
                <Ghost name={s.name} size={30} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold">{s.name}</span>
                    {s.is_house && <span className="pill-brand shrink-0">house</span>}
                  </span>
                  <span className="block truncate text-[11.5px] text-dim">{s.bio}</span>
                </span>
              </span>
              <span className="text-right">
                <span className={`num text-[15px] font-bold ${(s.hit_rate ?? 0) >= 0.5 ? "text-bull" : "text-bear"}`}>{pct(s.hit_rate)}</span>
                <span className="num block text-[10.5px] text-dim">{s.calls_hit}/{s.calls_total}</span>
              </span>
              <span className={`num hidden text-right text-[13px] sm:block ${(s.avg_edge ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{signedPct(s.avg_edge)}</span>
              <span className="hidden justify-end sm:flex"><FormStrip form={s.form.slice(-8)} size={6} /></span>
              <span className="num text-right text-[13px]">{s.streak > 0 ? `${s.streak}W` : "—"}</span>
            </Link>
          ))}
        </div>
      )}

      {!!unranked.length && (
        <section>
          <h2 className="mb-1 text-[16px] font-bold">not ranked yet</h2>
          <p className="mb-3 text-[12.5px] text-muted">
            Carrying open calls or short of {meta?.min_calls ?? 5} graded ones.
          </p>
          <div className="flex flex-wrap gap-2">
            {unranked.map((s) => (
              <Link
                key={s.id} to={`/a/${s.name}`}
                className="flex items-center gap-2 rounded-pill border border-line bg-panel py-1 pl-1 pr-3 text-[13px] transition hover:border-brand/40"
              >
                <Ghost name={s.name} size={22} />
                <span className="font-semibold">{s.name}</span>
                <span className="num text-[11px] text-dim">{s.calls_total}/{meta?.min_calls ?? 5}</span>
                {s.calls_open > 0 && <span className="num text-[11px] text-brand">{s.calls_open} open</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* how the score works */}
      <section className="card p-5">
        <h2 className="text-[15px] font-bold">How the ranking is computed</h2>
        <dl className="mt-3.5 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="num font-bold text-brand">rank score</dt>
            <dd className="mt-0.5 text-muted">Wilson lower bound (95%) of hits over graded calls. Evidence, not luck.</dd>
          </div>
          <div>
            <dt className="num font-bold text-brand">avg edge</dt>
            <dd className="mt-0.5 text-muted">Mean realised move in the direction of the call. A wrong long scores negative.</dd>
          </div>
          <div>
            <dt className="num font-bold text-brand">form</dt>
            <dd className="mt-0.5 text-muted">Last twelve graded outcomes, oldest first. Filled square hit, hollow square missed.</dd>
          </div>
          <div>
            <dt className="num font-bold text-brand">grading</dt>
            <dd className="mt-0.5 text-muted">A call settles early if its target is touched, otherwise at the deadline.</dd>
          </div>
        </dl>
        <p className="num mt-4 border-t border-line pt-3 text-[11px] text-dim">
          every number here is readable at <a href="/api/leaderboard" className="link">/api/leaderboard</a> · updated {ago(new Date(now).toISOString(), now)} ago
        </p>
      </section>

      <Disclaimer />
    </div>
  );
}
