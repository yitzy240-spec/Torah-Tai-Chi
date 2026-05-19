// dashboard/src/app/videos/[slug]/_components/live-site-cms-card.tsx
//
// Inline-editable site CMS card for the live-at-rest page (B2).
// Renders all 5 text fields the public website consumes:
//   title, subtitle, description, website_caption, spoken_script.
//
// Each field is edited inline via EditableField (localStorage + optimistic save).
// A single "Publish changes" button at the bottom saves all pending fields and
// triggers website ISR revalidation. A separate "Unpublish" button (outlined,
// not red) removes the video from torahtaichi.com with a BottomSheet confirm.
//
// "View page" link is always present while the video is live.

'use client';
import { useState, useRef, useTransition } from 'react';
import { EditableField } from './posting-cards/_shared/editable-field';
import { BottomSheet } from './bottom-sheet';
import { saveSiteField } from '@/app/actions/video-page/save-site-fields';
import { publishSiteChanges } from '@/app/actions/video-page/publish-site-changes';
import { unpublishSite } from '@/app/actions/video-page/unpublish-site';

interface Props {
  videoId: string;
  parshaSlug: string;
  websiteUrl: string;
  liveSince: string | null;
  // The 5 fields shown on the public website
  title: string;
  subtitle: string;
  description: string;
  websiteCaption: string;
  spokenScript: string;
}

export function LiveSiteCmsCard({
  videoId,
  parshaSlug,
  websiteUrl,
  liveSince,
  title,
  subtitle,
  description,
  websiteCaption,
  spokenScript,
}: Props) {
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishing, startPublishing] = useTransition();
  const [unpublishing, startUnpublishing] = useTransition();

  // Track the current field values so the "Publish changes" bulk-save can flush
  // them all in one call. EditableField fires per-field optimistic saves on each
  // change, but we still capture the latest value here for the final flush.
  const latestTitle = useRef(title);
  const latestSubtitle = useRef(subtitle);
  const latestDescription = useRef(description);
  const latestWebsiteCaption = useRef(websiteCaption);
  const latestSpokenScript = useRef(spokenScript);

  function handlePublishChanges() {
    setSaveError(null);
    setSavedAt(null);
    startPublishing(async () => {
      const res = await publishSiteChanges(videoId, parshaSlug, {
        title: latestTitle.current,
        subtitle: latestSubtitle.current,
        description: latestDescription.current,
        website_caption: latestWebsiteCaption.current,
        spoken_script: latestSpokenScript.current,
      });
      if (!res.ok) {
        setSaveError(res.error);
      } else {
        setSavedAt(new Date().toLocaleTimeString());
      }
    });
  }

  function handleUnpublish() {
    startUnpublishing(async () => {
      const res = await unpublishSite(videoId, parshaSlug);
      if (!res.ok) setSaveError(res.error);
      setUnpublishOpen(false);
    });
  }

  return (
    <div
      style={{
        border: '1px solid var(--ink-100)',
        borderRadius: 10,
        padding: 16,
        marginBottom: 20,
        background: 'white',
      }}
    >
      {/* Header row: platform label + live pill + view link */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--ink-500)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            torahtaichi.com
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--jade)',
              fontWeight: 600,
              marginTop: 2,
            }}
          >
            Live{liveSince ? ` since ${new Date(liveSince).toLocaleDateString()}` : ''}
          </div>
        </div>
        <a
          href={websiteUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 12,
            color: 'var(--navy-700)',
            textDecoration: 'underline',
            whiteSpace: 'nowrap',
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          View page →
        </a>
      </div>

      {/* 5 editable fields */}
      <EditableField
        storageKey={`site.${parshaSlug}.title`}
        label="Title"
        initialValue={title}
        onSave={async (v) => {
          latestTitle.current = v;
          await saveSiteField(videoId, 'title', v);
        }}
        multiline={false}
        placeholder="Bamidbar"
      />
      <EditableField
        storageKey={`site.${parshaSlug}.subtitle`}
        label="Sub-title"
        initialValue={subtitle}
        onSave={async (v) => {
          latestSubtitle.current = v;
          await saveSiteField(videoId, 'subtitle', v);
        }}
        multiline={false}
        placeholder="In the desert, counted as one."
      />
      <EditableField
        storageKey={`site.${parshaSlug}.description`}
        label="Description"
        initialValue={description}
        onSave={async (v) => {
          latestDescription.current = v;
          await saveSiteField(videoId, 'description', v);
        }}
        minHeight={80}
        placeholder="Longer copy + SEO meta…"
      />
      <EditableField
        storageKey={`site.${parshaSlug}.website_caption`}
        label="Caption (shown below video on website)"
        initialValue={websiteCaption}
        onSave={async (v) => {
          latestWebsiteCaption.current = v;
          await saveSiteField(videoId, 'website_caption', v);
        }}
        minHeight={60}
        placeholder="Short caption displayed under the video…"
      />
      <EditableField
        storageKey={`site.${parshaSlug}.spoken_script`}
        label="Spoken script (shown on website below video)"
        initialValue={spokenScript}
        onSave={async (v) => {
          latestSpokenScript.current = v;
          await saveSiteField(videoId, 'spoken_script', v);
        }}
        minHeight={120}
        placeholder="Full script text…"
      />

      {saveError && (
        <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>
          {saveError}
        </div>
      )}
      {savedAt && !saveError && (
        <div style={{ fontSize: 12, color: 'var(--jade)', marginBottom: 8 }}>
          Changes published at {savedAt}
        </div>
      )}

      {/* Publish changes — primary action */}
      <button
        type="button"
        onClick={handlePublishChanges}
        disabled={publishing || unpublishing}
        style={{
          width: '100%',
          minHeight: 48,
          fontSize: 14,
          fontWeight: 500,
          background: 'var(--navy-700)',
          color: 'var(--linen-50)',
          border: 'none',
          borderRadius: 8,
          padding: 12,
          cursor: publishing || unpublishing ? 'not-allowed' : 'pointer',
          opacity: publishing || unpublishing ? 0.7 : 1,
          marginBottom: 8,
        }}
      >
        {publishing ? 'Saving…' : 'Publish changes'}
      </button>

      {/* Unpublish — outlined secondary, NOT red (reversible action) */}
      <button
        type="button"
        onClick={() => setUnpublishOpen(true)}
        disabled={publishing || unpublishing}
        style={{
          width: '100%',
          minHeight: 44,
          fontSize: 13,
          fontWeight: 500,
          background: 'white',
          color: 'var(--ink-700)',
          border: '1px solid var(--ink-300)',
          borderRadius: 8,
          cursor: publishing || unpublishing ? 'not-allowed' : 'pointer',
          opacity: publishing || unpublishing ? 0.7 : 1,
        }}
      >
        {unpublishing ? 'Unpublishing…' : 'Unpublish'}
      </button>

      {/* Unpublish confirm bottom-sheet */}
      <BottomSheet
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        title="Take this video off torahtaichi.com?"
        primaryAction={{
          label: 'Unpublish',
          onClick: handleUnpublish,
        }}
        secondaryAction={{
          label: 'Cancel',
          onClick: () => setUnpublishOpen(false),
        }}
      >
        It stays posted on social platforms. You can republish anytime.
      </BottomSheet>
    </div>
  );
}
