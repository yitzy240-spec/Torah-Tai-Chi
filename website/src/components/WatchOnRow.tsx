import type { Parsha } from "@/lib/parshiot";

interface Props {
  postUrls: NonNullable<Parsha["postUrls"]>;
  /** Heading shown above the buttons. Falls back to a default. */
  label?: string;
}

const PLATFORM_ORDER: Array<keyof NonNullable<Parsha["postUrls"]>> = [
  "youtube",
  "tiktok",
  "instagram",
  "twitter",
  "facebook",
];

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitter: "X",
  facebook: "Facebook",
};

/**
 * "Watch on platform" row for the bottom of a teaching detail page.
 * Reads videos.post_urls (denormalized by the dashboard from autoPost
 * results). Shows one button per platform that has a URL — missing
 * platforms are silently hidden.
 */
export default function WatchOnRow({ postUrls, label }: Props) {
  const heading = label ?? "Watch on";
  const platforms = PLATFORM_ORDER.filter(
    (p) => typeof postUrls[p] === "string" && postUrls[p]!.length > 0,
  );
  if (platforms.length === 0) return null;

  return (
    <section className="share-row" aria-label={heading}>
      <div className="share-label">{heading}</div>
      <div className="share-buttons">
        {platforms.map((p) => {
          const url = postUrls[p]!;
          return (
            <a
              key={p}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="share-btn"
              aria-label={`Watch on ${PLATFORM_LABEL[p]}`}
            >
              <PlatformIcon platform={p} />
              {PLATFORM_LABEL[p]}
            </a>
          );
        })}
      </div>
    </section>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  switch (platform) {
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.5v-7l6.3 3.5z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.6 6.7a4.6 4.6 0 0 1-3-1.7 4.6 4.6 0 0 1-1-2.5h-3.4v12a2.7 2.7 0 1 1-2-2.6V8.5a6 6 0 1 0 5.4 6V9.1a8 8 0 0 0 4 1.2V6.9a4.5 4.5 0 0 1-.1-.2z" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      );
    case "twitter":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-3h2.5V9.5c0-2.5 1.5-3.9 3.7-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.7-1.6 1.5V12h2.7l-.4 3h-2.3v7A10 10 0 0 0 22 12z" />
        </svg>
      );
    default:
      return null;
  }
}
