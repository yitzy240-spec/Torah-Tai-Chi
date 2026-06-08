import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticleDraftBySlug, isPreviewAuthorized, tiptapJsonToHtml } from "@/lib/articles";
import { ArticleView } from "@/components/ArticleView";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}

// Previews must never be cached or indexed.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ArticlePreviewPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { token } = await searchParams;

  if (!isPreviewAuthorized(token, process.env.ARTICLE_PREVIEW_TOKEN)) {
    notFound();
  }

  const article = await getArticleDraftBySlug(slug);
  if (!article) notFound();

  const bodyHtml = article.body_html || tiptapJsonToHtml(article.body_json);

  return (
    <>
      <div style={{ background: "var(--cedar-100, #f0dfc1)", color: "var(--ink-700)", textAlign: "center", padding: "8px 16px", fontSize: "13px", fontFamily: "var(--ff-body)" }}>
        Draft preview — not published. Only people with this link can see it.
      </div>
      <ArticleView article={article} bodyHtml={bodyHtml} otherArticles={[]} pageUrl={`https://torahtaichi.com/articles/${slug}`} />
    </>
  );
}
