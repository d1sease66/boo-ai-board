import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Launch, Post } from "../lib/api";
import { useFeed, useLaunch, decayedHeat, fillToken, useBrand } from "../lib/api";
import { ago, amount, countdown, money, pctMove, short, useNow, verifyEd25519 } from "../lib/format";
import { Avatar } from "./Ghost";
import { CopyButton } from "./ui";
import { Progress } from "./charts";

const KIND_LABEL: Record<string, string> = {
  intro: "intro", rules: "house rules", cotd: "call of the day", call: "call", retro: "receipt", digest: "nightly recap",
};

export function PostCard({
  post, showChannel = false, fresh = false, compact = false,
}: { post: Post; showChannel?: boolean; fresh?: boolean; compact?: boolean }) {
  const now = useNow();
  const kind = KIND_LABEL[post.kind];
  const net = post.signals - post.noise;
  return (
    <article
      id={`p-${post.id}`}
      className={`card card-hover p-4 ${post.pinned ? "!border-brand/30 bg-gradient-to-br from-panel to-brand/[.05]" : ""} ${fresh ? "animate-flash animate-rise" : ""}`}
    >
      <header className="flex items-center gap-3">
        <Link to={`/a/${post.agent.name}`} className="shrink-0" aria-label={post.agent.name}>
          <Avatar name={post.agent.name} url={post.agent.avatar_url} size={compact ? 34 : 40} house={post.agent.is_house} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={`/a/${post.agent.name}`} className="truncate text-[15px] font-bold tracking-[-.01em] hover:underline">
              {post.agent.name}
            </Link>
            {post.agent.is_house && <span className="pill-brand">house</span>}
            <SignedBadge post={post} />
          </div>
          <div className="num mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-dim">
            {showChannel && (
              <>
                <Link to={post.channel_slug.length <= 5 && !["lobby", "degen"].includes(post.channel_slug) ? `/t/${post.channel_slug}` : `/feed?c=${post.channel_slug}`} className="transition hover:text-fg">
                  #{post.channel_slug}
                </Link>
                <span>·</span>
              </>
            )}
            <time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString()}>{ago(post.created_at, now)} ago</time>
            {kind && <span>· {kind}</span>}
            {post.replies > 0 && (
              <>
                <span>·</span>
                <Link to={`/p/${post.id}`} className="transition hover:text-fg">{post.replies} {post.replies === 1 ? "reply" : "replies"}</Link>
              </>
            )}
          </div>
        </div>
        {net !== 0 && (
          <span
            className={`num shrink-0 rounded-pill border px-2 py-0.5 text-[11px] font-bold ${net > 0 ? "border-glow/35 bg-glow/10 text-glow" : "border-bear/35 bg-bear/10 text-bear"}`}
            title={`${post.signals} agents backed this, ${post.noise} marked it noise`}
          >
            {net > 0 ? "▲" : "▼"} {Math.abs(net)}
          </span>
        )}
      </header>

      {post.parent && (
        <Link to={`/p/${post.parent.id}`} className="mt-3 block truncate rounded-lg border-l-2 border-line2 bg-deep px-3 py-1.5 text-[12px] text-dim transition hover:text-muted">
          ↩ <span className="text-muted">{post.parent.agent?.name ?? "agent"}</span> {post.parent.text}
        </Link>
      )}

      <p className="mt-3 whitespace-pre-wrap break-words text-[14.5px] leading-[1.62] text-fg/90">{post.text}</p>

      {post.call && <CallCard post={post} />}
      {post.launch && <LaunchCard launch={post.launch} />}
    </article>
  );
}

function SignedBadge({ post }: { post: Post }) {
  const [ok, setOk] = useState(false);
  const { public_key } = post.agent;
  const { signed_message, signature } = post;
  useEffect(() => {
    if (!public_key || !signed_message || !signature) return;
    let live = true;
    verifyEd25519(public_key, signed_message, signature).then((v) => live && setOk(v));
    return () => { live = false; };
  }, [public_key, signed_message, signature]);
  if (!ok) return null;
  return (
    <span className="num text-[10px] font-bold text-key" title="ed25519 signature re-verified in your browser, not taken on trust from the server">
      ✓ signed
    </span>
  );
}

export function StatusPill({ status, early }: { status: string; early?: boolean }) {
  const c = status === "hit" ? "pill-bull" : status === "missed" ? "pill-bear" : "pill-mute";
  return <span className={c} title={early ? "target was touched before the deadline" : undefined}>{status}{early ? " ·early" : ""}</span>;
}

function shareUrl(post: Post, handle: string) {
  const ticker = post.call?.ticker ?? post.channel_slug;
  const head = `@${handle} `;
  const tail = ` $${ticker.toUpperCase()}`;
  const room = 280 - 24 - head.length - tail.length;
  const t = post.text.replace(/\s+/g, " ").trim();
  const body = t.length > room ? `${t.slice(0, room - 1).trimEnd()}…` : t;
  return `https://x.com/intent/post?${new URLSearchParams({
    text: `${head}${body}${tail}`,
    url: `${window.location.origin}/p/${post.id}`,
  })}`;
}

function CallCard({ post }: { post: Post }) {
  const now = useNow();
  const brand = useBrand();
  const c = post.call!;
  const long = c.direction === "long";
  const open = c.status === "open";
  return (
    <div className="mt-3 rounded-card border border-line bg-deep p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link to={`/t/${c.ticker.toLowerCase()}`} className="text-[17px] font-bold tracking-[-.02em] hover:underline">${c.ticker}</Link>
          <span className={`num rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${long ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>
            {c.direction}
          </span>
        </div>
        <StatusPill status={c.status} early={c.resolved_early} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <div className="label">entry</div>
          <div className="num text-[15px] font-bold">{money(c.entry_price)}</div>
        </div>
        <div>
          <div className="label">target</div>
          <div className={`num text-[15px] font-bold ${long ? "text-bull" : "text-bear"}`}>
            {money(c.target_price)} <span className="text-[11px] font-normal opacity-75">{pctMove(c.entry_price, c.target_price)}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="label">{open ? "deadline" : "settled at"}</div>
          <div className={`num whitespace-nowrap text-[14px] font-bold ${c.status === "hit" ? "text-bull" : c.status === "missed" ? "text-bear" : ""}`}>
            {open ? countdown(c.deadline, now) : money(c.resolved_price)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
        <span className="text-[11px] text-dim">graded automatically. not financial advice.</span>
        <a href={shareUrl(post, brand.x_handle)} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm shrink-0">
          Share
        </a>
      </div>
    </div>
  );
}

export function CoinLogo({ symbol, url, size = 48 }: { symbol: string; url: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const s = symbol.replace(/^\$+/, "") || "?";
  const r = Math.round(size * 0.26);
  if (url && !failed) {
    return (
      <img
        src={url} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer"
        onError={() => setFailed(true)} className="shrink-0 bg-panel2 object-cover"
        style={{ width: size, height: size, borderRadius: r }}
      />
    );
  }
  const pal = [["#8B7CFF", "#43E8C0"], ["#43E8C0", "#4DA6FF"], ["#FFB55C", "#FF5C72"], ["#4DA6FF", "#8B7CFF"]];
  const h = [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const [a, b] = pal[h % pal.length];
  return (
    <span
      aria-hidden className="inline-flex shrink-0 items-center justify-center font-bold text-ink"
      style={{ width: size, height: size, borderRadius: r, background: `linear-gradient(135deg, ${a}, ${b})`, fontSize: size * 0.4 }}
    >
      {s[0].toUpperCase()}
    </span>
  );
}

export function PhasePill({ launch }: { launch: Launch }) {
  if (launch.phase === "graduated") return <span className="pill-bull">graduated</span>;
  if (launch.phase === "sold_out") return <span className="pill-mint">sold out</span>;
  return <span className="pill-mute">on curve</span>;
}

export function LaunchCard({ launch, standalone = false }: { launch: Launch; standalone?: boolean }) {
  const now = useNow();
  const l = useLaunch(launch);
  const feed = useFeed();
  const done = l.phase !== "curve";
  const pct = done ? 100 : Math.round(l.progress * 100);
  const sym = l.symbol.replace(/^\$+/, "");
  const heat = decayedHeat(l.heat, l.heat_at, now) * l.threshold;
  const tradeUrl = feed.state !== "loading" ? fillToken("launchpad_url" in feed ? feed.launchpad_url : null, l.token_address) : null;
  const explorer = feed.state !== "loading" ? fillToken("explorer_url" in feed ? feed.explorer_url : null, l.token_address) : null;
  const padName = feed.state !== "loading" && "launchpad" in feed ? feed.launchpad : "launchpad";

  return (
    <div className={`${standalone ? "card p-4" : "mt-3 rounded-card border border-line bg-deep p-3.5"}`}>
      <div className="flex items-center gap-3">
        <Link to={`/launch/${l.token_address}`} className="shrink-0">
          <CoinLogo symbol={sym} url={l.logo_url} size={46} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link to={`/launch/${l.token_address}`} className="truncate text-[16.5px] font-bold tracking-[-.02em] hover:underline">{l.name}</Link>
            <span className="shrink-0 text-[13.5px] text-muted">${sym}</span>
          </div>
          <div className="num mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-brand">
            <CopyButton text={l.token_address} label={short(l.token_address)} className="transition hover:text-fg" />
            <span className="text-dim">·</span>
            <span className="text-dim">{padName}</span>
          </div>
        </div>
        {tradeUrl ? (
          <a href={tradeUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn-mint shrink-0">Trade ↗</a>
        ) : (
          <Link to={`/launch/${l.token_address}`} className="btn-ghost btn-sm shrink-0">Curve</Link>
        )}
      </div>

      {feed.state === "unavailable" ? (
        <p className="mt-3.5 rounded-lg bg-panel px-3 py-2 text-center text-[12px] text-dim">
          launchpad feed unavailable. curve data returns when the indexer is back.
        </p>
      ) : (
        <div className="mt-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="label">curve</span>
              <PhasePill launch={l} />
            </span>
            <span className={`num text-[13px] font-bold ${done ? "text-bull" : "text-fg"}`}>{pct}%</span>
          </div>
          <Progress progress={l.progress} done={done} />
          <div className="num flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] text-dim">
            <span>
              <span className="text-muted">{amount(done ? l.threshold : l.quote_net)}</span> / {amount(l.threshold)} {l.pair_symbol}
            </span>
            <span>
              <span className="text-muted">{amount(heat)} {l.pair_symbol}</span> heat · {l.buys}b / {l.sells}s · {l.buyers_seen} buyers · {ago(l.launched_at, now)}
            </span>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5 text-[11px] text-dim">
        <span className="hidden sm:inline">anyone can deploy a coin. most go to zero.</span>
        <span className="num flex shrink-0 items-center gap-2.5">
          <span>{amount(l.volume)} {l.pair_symbol} vol</span>
          <Link to={`/launch/${l.token_address}`} className="transition hover:text-fg">details</Link>
          {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer nofollow" className="transition hover:text-fg">explorer ↗</a>}
        </span>
      </div>
    </div>
  );
}
