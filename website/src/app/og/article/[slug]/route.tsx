import { ImageResponse } from "next/og";
import { getAllArticles, getArticleBySlug } from "@/lib/articles";

export const dynamic = "force-static";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };

export async function generateStaticParams() {
  try {
    const articles = await getAllArticles();
    return articles.map((a) => ({ slug: a.slug }));
  } catch {
    return [];
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  let title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let category = "";

  try {
    const article = await getArticleBySlug(slug);
    if (article) {
      title = article.title;
      category = article.category ?? "";
    }
  } catch {
    // use slug-derived title
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#f5f0e8",
          padding: "80px",
          position: "relative",
        }}
      >
        {/* Subtle cedar glow top-right */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,90,60,0.12) 0%, transparent 70%)",
          }}
        />

        {/* Category tag */}
        {category && (
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#8b5a3c",
              fontFamily: "sans-serif",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              marginBottom: "24px",
            }}
          >
            {category}
          </div>
        )}

        {/* Article title */}
        <div
          style={{
            fontSize: title.length > 40 ? 64 : 80,
            fontWeight: 700,
            color: "#1a1a1a",
            fontFamily: "serif",
            lineHeight: 1.1,
            marginBottom: "32px",
            maxWidth: "900px",
          }}
        >
          {title}
        </div>

        {/* Divider */}
        <div
          style={{
            width: "60px",
            height: "3px",
            background: "#8b5a3c",
          }}
        />

        {/* Branding */}
        <div
          style={{
            position: "absolute",
            bottom: "48px",
            left: "80px",
            fontSize: 24,
            color: "rgba(0,0,0,0.3)",
            fontFamily: "sans-serif",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Torah Tai Chi
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
