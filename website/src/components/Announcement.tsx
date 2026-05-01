import Link from "next/link";
import type { SiteContentMap } from "@/lib/site-content";

interface AnnouncementProps {
  content: SiteContentMap;
}

function nonBlank(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return null;
  return trimmed;
}

export default function Announcement({ content }: AnnouncementProps) {
  const visible = content["home.announcement.visible"]?.toLowerCase().trim() === "true";
  const title = nonBlank(content["home.announcement.title"]);
  if (!visible || !title) return null;

  const eyebrow = nonBlank(content["home.announcement.eyebrow"]) ?? "Coming up";
  const body = nonBlank(content["home.announcement.body"]);
  const ctaLabel = nonBlank(content["home.announcement.cta_label"]);
  const ctaHref = nonBlank(content["home.announcement.cta_href"]);
  const datePill = nonBlank(content["home.announcement.date_pill"]);

  return (
    <section className="announcement" aria-labelledby="announcement-title">
      <div className="announcement-card">
        <div className="announcement-meta">
          <span className="announcement-eyebrow">
            <span className="announcement-eyebrow-bar" aria-hidden="true" />
            {eyebrow}
          </span>
          {datePill && <span className="announcement-date-pill">{datePill}</span>}
        </div>
        <h2 id="announcement-title" className="announcement-title">
          {title}
        </h2>
        {body && <p className="announcement-body">{body}</p>}
        {ctaLabel && ctaHref && (
          <div className="announcement-cta-row">
            <Link href={ctaHref} className="btn btn-primary announcement-cta">
              {ctaLabel}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
