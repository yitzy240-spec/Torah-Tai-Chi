import type { Metadata } from "next";
import Link from "next/link";
import { ARTICLES } from "@/data/articles";
import ArticleCard from "@/components/ArticleCard";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = ARTICLES.find((a) => a.slug === slug);
  if (!article) return { title: "Article" };
  return {
    title: article.title,
    description: article.excerpt,
  };
}

function renderBody(body: string) {
  const paragraphs = body.split(/\n\n+/).filter(Boolean);
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];

    if (para.startsWith("## ")) {
      elements.push(
        <h2 key={i}>{para.slice(3)}</h2>
      );
    } else if (para.startsWith("> ")) {
      elements.push(
        <div key={i} className="pullquote">{para.slice(2)}</div>
      );
    } else {
      // Convert inline markdown *italic* to <em>
      const parts = para.split(/\*([^*]+)\*/g);
      const content = parts.map((part, j) => {
        if (j % 2 === 1) return <em key={j}>{part}</em>;
        return part;
      });
      const isFirst = elements.length === 0;
      elements.push(
        <p key={i} className={isFirst ? "lead" : ""}>{content}</p>
      );
    }
  }

  return elements;
}

export default async function ArticleDetailPage({ params }: Props) {
  const { slug } = await params;
  const article = ARTICLES.find((a) => a.slug === slug);

  if (!article) {
    return (
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 48px 0" }}>
        <h1 style={{ fontFamily: "var(--ff-display)" }}>Article not found</h1>
        <Link href="/articles">← All writings</Link>
      </div>
    );
  }

  const otherArticles = ARTICLES.filter((a) => a.slug !== slug).slice(0, 2);

  return (
    <>
      <div className="back-wrap" style={{ maxWidth: "720px" }}>
        <Link href="/articles" className="back-link">
          &larr; All writings
        </Link>
      </div>

      <header className="ad-header stagger">
        <span className="ad-tag">{article.category}</span>
        <h1>{article.title}</h1>
        <p className="ad-deck">{article.subtitle}</p>
        <div className="ad-meta">
          {article.date} &middot; {article.readMinutes} min read
        </div>
      </header>

      <article className="ad-body stagger">
        {renderBody(article.body)}
      </article>

      <section className="continue-section">
        <h2 className="continue-head">
          Continue <em>reading</em>
        </h2>
        <div className="continue-grid stagger">
          {otherArticles.map((a) => (
            <ArticleCard key={a.slug} article={a} />
          ))}
        </div>
      </section>
    </>
  );
}
