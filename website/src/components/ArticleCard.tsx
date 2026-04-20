import Link from "next/link";

interface ArticleCardData {
  slug: string;
  title: string;
  excerpt?: string | null;
  category?: "Essay" | "Teaching" | "Reflection" | null;
  // Supabase fields
  published_at?: string | null;
  read_minutes?: number | null;
  // Legacy fixture fields (kept for compatibility)
  date?: string;
  readMinutes?: number;
}

interface ArticleCardProps {
  article: ArticleCardData;
}

function formatDate(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const dateLabel = article.date ?? formatDate(article.published_at);
  const mins = article.readMinutes ?? article.read_minutes;
  return (
    <Link href={`/articles/${article.slug}`} className="a-card">
      {article.category && <div className="a-tag">{article.category}</div>}
      <h3 className="a-title">{article.title}</h3>
      {article.excerpt && <p className="a-excerpt">{article.excerpt}</p>}
      <div className="a-meta">
        {dateLabel}{dateLabel && mins ? " \u00b7 " : ""}{mins ? `${mins} min read` : ""}
      </div>
    </Link>
  );
}
