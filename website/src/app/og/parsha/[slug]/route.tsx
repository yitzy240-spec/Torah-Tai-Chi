import { ImageResponse } from "next/og";
import { getAllParshiot, getParshaBySlug } from "@/lib/parshiot";

export const dynamic = "force-static";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };

export async function generateStaticParams() {
  try {
    const parshiot = await getAllParshiot();
    return parshiot.map((p) => ({ slug: p.slug }));
  } catch {
    return [];
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  let parshaName = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let hebrewName = "";

  try {
    const parsha = await getParshaBySlug(slug);
    if (parsha) {
      parshaName = parsha.name;
      hebrewName = parsha.hebrewName ?? "";
    }
  } catch {
    // use slug-derived name
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
          background: "#1a2744",
          padding: "80px",
          position: "relative",
        }}
      >
        {/* Subtle cedar glow */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: "480px",
            height: "480px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,90,60,0.2) 0%, transparent 70%)",
          }}
        />

        {/* Hebrew name */}
        {hebrewName && (
          <div
            style={{
              fontSize: 36,
              color: "rgba(255,255,255,0.5)",
              fontFamily: "serif",
              marginBottom: "16px",
              letterSpacing: "0.04em",
              direction: "rtl",
            }}
          >
            {hebrewName}
          </div>
        )}

        {/* Parsha name */}
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            color: "#ffffff",
            fontFamily: "serif",
            lineHeight: 1.05,
            marginBottom: "24px",
          }}
        >
          {parshaName}
        </div>

        {/* Divider */}
        <div
          style={{
            width: "60px",
            height: "3px",
            background: "#8b5a3c",
            marginBottom: "24px",
          }}
        />

        {/* Branding */}
        <div
          style={{
            position: "absolute",
            bottom: "48px",
            left: "80px",
            fontSize: 24,
            color: "rgba(255,255,255,0.4)",
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
