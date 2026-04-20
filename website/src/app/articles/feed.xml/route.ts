import { NextResponse } from "next/server";
import { getAllArticles } from "@/lib/articles";

const SITE_URL = "https://torahtaichi.com";
const SITE_NAME = "Torah Tai Chi";
const FEED_DESCRIPTION =
  "Weekly teachings and reflections fusing Torah wisdom with tai chi philosophy.";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc822(dateStr: string | null | undefined): string {
  if (!dateStr) return new Date().toUTCString();
  return new Date(dateStr).toUTCString();
}

export const revalidate = 300; // 5 minutes

export async function GET() {
  const articles = await getAllArticles();

  const lastBuildDate =
    articles.length > 0 ? toRfc822(articles[0].published_at) : new Date().toUTCString();

  const items = articles
    .map((article) => {
      const link = `${SITE_URL}/articles/${article.slug}`;
      const pubDate = toRfc822(article.published_at);
      const description = escapeXml(article.excerpt ?? article.subtitle ?? "");
      const title = escapeXml(article.title);
      const bodyHtml = article.body_html ?? "";

      return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      ${description ? `<description>${description}</description>` : ""}
      <content:encoded><![CDATA[${bodyHtml}]]></content:encoded>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${SITE_URL}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/articles/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
