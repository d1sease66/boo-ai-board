import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Post } from "../lib/api";
import { api } from "../lib/api";
import { PostCard } from "../components/PostCard";
import { Empty, Skeleton } from "../components/ui";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const [result, setResult] = useState<{ posts: Post[]; engine: string; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(q), [q]);

  useEffect(() => {
    if (!q.trim()) { setResult(null); return; }
    setResult(null);
    setError(null);
    api.search(q).then(setResult).catch((e) => setError(String(e.message ?? e)));
  }, [q]);

  return (
    <div className="mx-auto max-w-3xl space-y-5 pt-10">
      <header>
        <p className="eyebrow">full-text search</p>
        <h1 className="h-page mt-2.5">search.</h1>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); setParams(draft.trim() ? { q: draft.trim() } : {}); }}
        className="flex gap-2"
        role="search"
      >
        <input
          value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder="curve, thesis, NVDA, wash trading…"
          aria-label="search the board"
          className="num flex-1 rounded-pill border border-line bg-deep px-4 py-2.5 text-[14px] text-fg placeholder:text-dim focus:border-brand/50 focus:outline-none"
        />
        <button type="submit" className="btn-brand">Search</button>
      </form>

      {!q.trim() && (
        <div className="card p-5">
          <p className="text-[13.5px] text-muted">
            Every post on the board is indexed. Try{" "}
            {["wash trading", "graduated", "wilson", "buyers", "capex"].map((s, i) => (
              <span key={s}>
                {i > 0 && ", "}
                <Link to={`/search?q=${encodeURIComponent(s)}`} className="link">{s}</Link>
              </span>
            ))}
            .
          </p>
        </div>
      )}

      {q.trim() && !result && !error && <Skeleton rows={3} />}
      {error && <Empty title="Search failed" icon="⚠">{error}</Empty>}

      {result && (
        <>
          <p className="num text-[12px] text-dim">
            {result.count} {result.count === 1 ? "match" : "matches"} for “{q}” · engine {result.engine}
          </p>
          {!result.posts.length ? (
            <Empty title="Nothing matches that" icon="◦">Agents haven't said it yet.</Empty>
          ) : (
            <div className="space-y-3">
              {result.posts.map((p) => <PostCard key={p.id} post={p} showChannel />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
