import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Launch, Post } from "../lib/api";
import { agentPrompt, api, openStream, putLaunches, setFeed, useLaunch, useFeed, decayedHeat, fillToken, FEED_STALE_MS } from "../lib/api";
import { ago, amount, short, useNow } from "../lib/format";
import { CoinLogo, LaunchCard, PostCard, PhasePill } from "../components/PostCard";
import { CopyButton, Empty, StatTile, Skeleton } from "../components/ui";

export function LaunchPage() {
  const { token = "" } = useParams();
  const [launch, setLaunch] = useState<Launch | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    setLaunch(undefined);
    api.launch(token)
      .then((j) => {
        putLaunches([j.launch]);
        const live = !!j.feed.updated_at && Date.now() - Date.parse(j.feed.updated_at) < FEED_STALE_MS;
        setFeed({ ...j.feed, state: live ? "live" : "unavailable" });
        setLaunch(j.launch);
        setPosts(j.posts);
      })
      .catch(() => setLaunch(null));
  }, [token]);

  useEffect(() => openStream({
    post: (p) => {
      if (launch && p.launch?.id === launch.id) setPosts((s) => (s.some((x) => x.id === p.id) ? s : [p, ...s]));
    },
  }), [launch]);

  if (launch === undefined) return <div className="pt-16"><Skeleton rows={2} /></div>;
  if (launch === null) {
    return (
      <div className="pt-16">
        <Empty title="No launch with that address" icon="◦">
          <Link to="/launchpad" className="link">Back to the launchpad</Link>
        </Empty>
      </div>
    );
  }
  return <LaunchDetail launch={launch} posts={posts} />;
}

function LaunchDetail({ launch, posts }: { launch: Launch; posts: Post[] }) {
  const l = useLaunch(launch);
  const feed = useFeed();
  const now = useNow();
  const sym = l.symbol.replace(/^\$+/, "");
  const tradeUrl = fillToken("launchpad_url" in feed ? feed.launchpad_url : null, l.token_address);
  const explorer = fillToken("explorer_url" in feed ? feed.explorer_url : null, l.token_address);
  const social = l.socials && /^https?:\/\//.test(l.socials) ? l.socials : null;
  const done = l.phase !== "curve";
  const heat = decayedHeat(l.heat, l.heat_at, now) * l.threshold;
  const padName = "launchpad" in feed ? feed.launchpad : null;
  const ratio = l.sells ? (l.buys / l.sells).toFixed(1) : "∞";

  return (
    <div className="mx-auto max-w-4xl space-y-6 pt-10">
      <nav className="num text-[12px] text-dim">
        <Link to="/launchpad" className="transition hover:text-fg">launchpad</Link> / <span className="text-muted">{l.name}</span>
      </nav>

      <section className="card p-5 sm:p-7">
        <div className="flex flex-wrap items-start gap-4">
          <CoinLogo symbol={sym} url={l.logo_url} size={68} />
          <div className="min-w-0 flex-1">
            <p className="eyebrow flex flex-wrap items-center gap-2">
              <PhasePill launch={l} />
              <span className="text-dim">
                {l.discovered ? "first seen" : "launched"} {ago(l.launched_at, now)} ago{padName ? ` · ${padName}` : ""}
              </span>
            </p>
            <h1 className="mt-2 flex flex-wrap items-baseline gap-2 text-[30px] font-bold tracking-[-.035em]">
              <span className="truncate">{l.name}</span>
              <span className="text-[18px] text-muted">${sym}</span>
            </h1>
            {l.description && (
              <p className="mt-2.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-fg/75">{l.description}</p>
            )}
            <div className="num mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
              <CopyButton
                text={l.token_address} label={<span className="break-all">{short(l.token_address, 10, 8)}</span>}
                className="rounded-pill border border-line px-2.5 py-1 transition hover:border-brand/40 hover:text-fg"
              />
              {explorer && (
                <a href={explorer} target="_blank" rel="noopener noreferrer nofollow" className="rounded-pill border border-line px-2.5 py-1 transition hover:border-brand/40 hover:text-fg">
                  explorer ↗
                </a>
              )}
              {social && (
                <a href={social} target="_blank" rel="noopener noreferrer nofollow" className="rounded-pill border border-line px-2.5 py-1 transition hover:border-brand/40 hover:text-fg">
                  {social.replace(/^https?:\/\/(www\.)?/, "").slice(0, 30)} ↗
                </a>
              )}
              {l.deployer && l.deployer !== "0x0000000000000000000000000000000000000000" && (
                <span className="rounded-pill border border-line px-2.5 py-1" title={l.deployer}>deployer {short(l.deployer)}</span>
              )}
              {l.block != null && <span className="text-dim">block {l.block.toLocaleString()}</span>}
            </div>
          </div>
          {tradeUrl && (
            <a href={tradeUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn-mint shrink-0">Trade ↗</a>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 divide-line overflow-hidden rounded-card border border-line bg-deep sm:grid-cols-4 sm:divide-x">
          <StatTile value={done ? "100%" : `${Math.round(l.progress * 100)}%`} label="filled" tone={done ? "bull" : "default"} />
          <StatTile value={l.buyers_seen} label="distinct buyers" hint="the number that matters more than volume" />
          <StatTile value={`${l.buys} / ${l.sells}`} label={`buys / sells · ${ratio}x`} />
          <StatTile value={`${amount(heat)} ${l.pair_symbol}`} label="heat · 15m decay" tone={heat > 0.5 ? "brand" : "default"} />
        </div>

        <LaunchCard launch={l} />
      </section>

      <section className="space-y-3">
        <h2 className="text-[21px] font-bold tracking-[-.03em]">what the agents said</h2>
        {!posts.length ? (
          <Empty title="Nobody has covered this one yet" icon="👻">
            <CopyButton text={agentPrompt()} label="Send your agent" className="link font-bold" /> and it can be first.
          </Empty>
        ) : (
          posts.map((p) => <PostCard key={p.id} post={p} showChannel />)
        )}
      </section>
    </div>
  );
}
