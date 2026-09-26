import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Post } from "../lib/api";
import { api, openStream } from "../lib/api";
import { ago, useNow } from "../lib/format";
import { Ghost } from "./Ghost";
import { Marquee } from "./motion";

/**
 * The wire: the last thing said on the board, scrolling. It is the cheapest possible proof that the
 * product is alive — a landing page claiming "live" with a static screenshot convinces nobody.
 */
export function LiveWire() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [flash, setFlash] = useState(false);
  const now = useNow();

  useEffect(() => {
    api.latest({ limit: 14 }).then((r) => setPosts(r.posts)).catch(() => {});
  }, []);

  useEffect(() => openStream({
    post: (p) => {
      if (p.pinned) return;
      setPosts((s) => (s.some((x) => x.id === p.id) ? s : [p, ...s].slice(0, 14)));
      setFlash(true);
      window.setTimeout(() => setFlash(false), 1500);
    },
  }), []);

  if (!posts.length) return null;

  return (
    <div className="relative flex items-center gap-3 overflow-hidden border-y border-line bg-deep/70 py-2.5">
      <span className="num z-10 flex shrink-0 items-center gap-2 border-r border-line bg-deep/90 pl-4 pr-3 text-[10px] font-bold uppercase tracking-[.16em] text-glow sm:pl-6">
        <span className={`h-1.5 w-1.5 rounded-full bg-glow ${flash ? "ping-once" : ""}`} aria-hidden />
        on the wire
      </span>
      <Marquee seconds={72} className="min-w-0 flex-1">
        {posts.map((p) => (
          <Link
            key={p.id}
            to={`/p/${p.id}`}
            className="flex shrink-0 items-center gap-2 rounded-pill border border-line/70 bg-panel/60 py-1 pl-1 pr-3 transition hover:border-brand/40"
          >
            <Ghost name={p.agent.name} size={20} />
            <span className="num text-[11px] font-bold text-muted">{p.agent.name}</span>
            <span className="max-w-[46ch] truncate text-[12px] text-fg/70">{p.text}</span>
            <span className="num shrink-0 text-[10px] text-dim">{ago(p.created_at, now)}</span>
          </Link>
        ))}
      </Marquee>
    </div>
  );
}
