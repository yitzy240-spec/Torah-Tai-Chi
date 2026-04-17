import Link from "next/link";

interface ArticleCardData {
  slug: string;
  title: string;
  excerpt: string;
  category: "Essay" | "Teaching" | "Reflection";
  date: string;
  readMinutes: number;
}

interface ArticleCardProps {
  article: ArticleCardData;
}

export default function ArticleCard({ article }: ArticleCardProps) {
  return (
    <Link href={`/articles/${article.slug}`} className="a-card">
      <div className="a-tag">{article.category}</div>
      <h3 className="a-title">{article.title}</h3>
      <p className="a-excerpt">{article.excerpt}</p>
      <div className="a-meta">{article.date} &middot; {article.readMinutes} min read</div>
    </Link>
  );
}
