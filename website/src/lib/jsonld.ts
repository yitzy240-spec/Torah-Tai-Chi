/**
 * JSON-LD Schema.org helpers for Torah Tai Chi.
 * Each function returns a plain object ready for JSON.stringify().
 */

const SITE_URL = 'https://torahtaichi.com';
const SITE_NAME = 'Torah Tai Chi';
const LOGO_URL = `${SITE_URL}/android-chrome-512x512.png`;

const SOCIAL_PROFILES = [
  'https://www.tiktok.com/@torahtaichi',
  'https://www.youtube.com/@torahtaichi',
  'https://www.instagram.com/torahtaichi',
  'https://www.facebook.com/torahtaichi',
];

// ─── Organization ────────────────────────────────────────────────────────────

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: LOGO_URL,
    },
    sameAs: SOCIAL_PROFILES,
  };
}

// ─── WebSite ─────────────────────────────────────────────────────────────────

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

// ─── Article ─────────────────────────────────────────────────────────────────

export interface ArticleSchemaInput {
  title: string;
  description?: string | null;
  datePublished?: string | null;
  slug: string;
  ogImageUrl?: string;
}

export function articleSchema(article: ArticleSchemaInput) {
  const authorPublisher = {
    '@type': 'Organization',
    name: SITE_NAME,
    logo: {
      '@type': 'ImageObject',
      url: LOGO_URL,
    },
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    ...(article.description ? { description: article.description } : {}),
    ...(article.datePublished ? { datePublished: article.datePublished } : {}),
    image: article.ogImageUrl ?? `${SITE_URL}/og/article/${article.slug}`,
    url: `${SITE_URL}/articles/${article.slug}`,
    author: authorPublisher,
    publisher: authorPublisher,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/articles/${article.slug}`,
    },
  };
}

// ─── VideoObject ─────────────────────────────────────────────────────────────

export interface VideoSchemaInput {
  name: string;
  description?: string | null;
  thumbnailUrl?: string;
  uploadDate?: string | null;
  contentUrl?: string | null;
  slug: string;
}

export function videoSchema(parsha: VideoSchemaInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: parsha.name,
    description:
      parsha.description ??
      `${parsha.name} — a Torah Tai Chi weekly teaching where tradition meets the body.`,
    thumbnailUrl:
      parsha.thumbnailUrl ?? `${SITE_URL}/og/parsha/${parsha.slug}`,
    uploadDate: parsha.uploadDate ?? new Date().toISOString().split('T')[0],
    contentUrl:
      parsha.contentUrl ??
      `${SITE_URL}/videos/${parsha.slug}`,
    duration: 'PT45S',
    url: `${SITE_URL}/videos/${parsha.slug}`,
  };
}

// ─── Book ────────────────────────────────────────────────────────────────────

export interface BookSchemaInput {
  name: string;
  description?: string | null;
}

export function bookSchema(book: BookSchemaInput) {
  const org = { '@type': 'Organization', name: SITE_NAME };
  return {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.name,
    ...(book.description ? { description: book.description } : {}),
    author: org,
    publisher: org,
    url: `${SITE_URL}/book`,
  };
}

// ─── BreadcrumbList ───────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbSchema(trail: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
