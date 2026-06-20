import type { Metadata } from "next";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { getSiteContent } from "@/lib/site-content";
import { organizationSchema, websiteSchema } from "@/lib/jsonld";

export const metadata: Metadata = {
  metadataBase: new URL("https://torahtaichi.com"),
  title: {
    default: "Torah Tai Chi — Where Ancient Wisdom Meets the Body",
    template: "%s · Torah Tai Chi",
  },
  description:
    "Weekly teachings fusing Torah wisdom with tai chi philosophy. Where Jewish wisdom and the body's intelligence say the same thing.",
  openGraph: {
    siteName: "Torah Tai Chi",
    url: "https://torahtaichi.com",
    images: [{ url: "/og/default.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
  },
  alternates: {
    canonical: "https://torahtaichi.com",
  },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    other: [
      { rel: "manifest", url: "/manifest.json" },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = await getSiteContent();
  const showBook = content["book.visible"] === "true";

  const orgSchemaJson = JSON.stringify(organizationSchema());
  const siteSchemaJson = JSON.stringify(websiteSchema());

  // Google Analytics 4 — only renders when the measurement id is configured
  // (set NEXT_PUBLIC_GA_ID in Vercel), so dev/preview don't pollute the data.
  // Raw gtag snippet (matching the JSON-LD scripts below) — no @next/third-
  // parties dep on this bleeding-edge Next. SPA pageviews between articles are
  // captured by GA4 Enhanced Measurement → "Page changes" (on by default).
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..900,0..100;1,9..144,300..900,0..100&family=Mona+Sans:ital,wght@0,200..900;1,200..900&family=Frank+Ruhl+Libre:wght@300..900&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: orgSchemaJson }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: siteSchemaJson }}
        />
        {gaId && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            />
            <script
              dangerouslySetInnerHTML={{
                __html:
                  `window.dataLayer=window.dataLayer||[];` +
                  `function gtag(){dataLayer.push(arguments);}` +
                  `gtag('js',new Date());gtag('config','${gaId}');`,
              }}
            />
          </>
        )}
      </head>
      <body>
        <SiteNav showBook={showBook} />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
