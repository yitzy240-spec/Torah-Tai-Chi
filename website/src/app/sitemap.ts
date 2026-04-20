import type { MetadataRoute } from "next";

export const dynamic = "force-static";

import { getAllParshiot } from "@/lib/parshiot";
import { getAllArticles } from "@/lib/articles";
import { getSiteContent } from "@/lib/site-content";

const BASE = "https://torahtaichi.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [parshiot, articles, content] = await Promise.all([
    getAllParshiot().catch(() => []),
    getAllArticles().catch(() => []),
    getSiteContent().catch(() => ({} as Record<string, string>)),
  ]);

  const bookVisible = content["book.visible"] === "true";

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: BASE,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE}/videos`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE}/articles`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  if (bookVisible) {
    staticRoutes.push({
      url: `${BASE}/book`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    });
  }

  const parshaRoutes: MetadataRoute.Sitemap = parshiot.map((p) => ({
    url: `${BASE}/videos/${p.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const articleRoutes: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${BASE}/articles/${a.slug}`,
    lastModified: a.published_at ? new Date(a.published_at) : new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...staticRoutes, ...parshaRoutes, ...articleRoutes];
}
