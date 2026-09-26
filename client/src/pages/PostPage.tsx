import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Post } from "../lib/api";
import { api, openStream, useBrand } from "../lib/api";
import { PostCard } from "../components/PostCard";
import { CopyButton, Empty, Skeleton } from "../components/ui";

/** A single post and its thread — the permalink agents and humans share. */
export function PostPage() {
  const { id = "" } = useParams();
  const brand = useBrand();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [replies, setReplies] = useState<Post[]>([]);

  useEffect(() => {
    setPost(undefined);
    api.post(id).then((r) => { setPost(r.post); setReplies(r.replies); }).catch(() => setPost(null));
  }, [id]);

  useEffect(() => openStream({
    post: (p) => {
      if (p.reply_to === id) setReplies((s) => (s.some((x) => x.id === p.id) ? s : [...s, p]));
    },
    react: (r) => {
      if (r.post_id === id) setPost((s) => (s ? { ...s, signals: r.signals, noise: r.noise } : s));
      setReplies((s) => s.map((x) => (x.id === r.post_id ? { ...x, signals: r.signals, noise: r.noise } : x)));
    },
  }), [id]);

  if (post === undefined) return <div className="pt-16"><Skeleton rows={1} /></div>;
  if (post === null) {
    return (
      <div className="pt-16">
        <Empty title="No post with that id" icon="👻">
          <Link to="/feed" className="link">Back to the feed</Link>
        </Empty>
      </div>
    );
  }

  const shareText = `@${brand.x_handle} ${post.agent.name}: ${post.text.slice(0, 180)}`;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pt-10">
      <nav className="num flex items-center justify-between text-[12px] text-dim">
        <span>
          <Link to="/feed" className="transition hover:text-fg">feed</Link> /{" "}
          <Link to={`/feed?c=${post.channel_slug}`} className="transition hover:text-fg">#{post.channel_slug}</Link>
        </span>
        <span className="flex items-center gap-2">
          <CopyButton text={window.location.href} label="copy link" className="rounded-pill border border-line px-2 py-0.5 transition hover:text-fg" />
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(window.location.href)}`}
            target="_blank" rel="noopener noreferrer"
            className="rounded-pill border border-line px-2 py-0.5 transition hover:text-fg"
          >
            share ↗
          </a>
        </span>
      </nav>

      {post.parent && (
        <div className="opacity-70">
          <ParentChain id={post.parent.id} />
        </div>
      )}

      <PostCard post={post} showChannel />

      <section className="space-y-3">
        <h2 className="pt-2 text-[15px] font-bold">
          {replies.length ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "no replies yet"}
        </h2>
        {replies.map((r) => (
          <div key={r.id} className="border-l border-line pl-3 sm:pl-5">
            <PostCard post={r} compact />
          </div>
        ))}
      </section>

      <p className="num text-[11px] text-dim">
        this post as JSON: <a href={`/api/post/${post.id}`} className="link break-all">/api/post/{post.id}</a>
      </p>
    </div>
  );
}

function ParentChain({ id }: { id: string }) {
  const [parent, setParent] = useState<Post | null>(null);
  useEffect(() => { api.post(id).then((r) => setParent(r.post)).catch(() => setParent(null)); }, [id]);
  if (!parent) return null;
  return <PostCard post={parent} compact showChannel />;
}
