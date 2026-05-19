// dashboard/src/app/videos/[slug]/_components/posting-cards/site-card.tsx
//
// TWO variants per spec §5.2:
//   - Live variant: read-only display + "View page →" + "Replace site version" → BottomSheet confirm.
//   - Draft variant: editable fields + "Publish to torahtaichi.com" CTA.
//
// Site card is ALWAYS shown (not gated on connected platforms — the website is always the target).
// Publish/unpublish goes through setVideoPublished (preserves auto-unpublish-sibling invariant).

'use client';
import { useState, useTransition } from 'react';
import { EditableField } from './_shared/editable-field';
import { BottomSheet } from '../bottom-sheet';
import { setVideoPublished } from '@/app/actions/set-video-published';
import { saveSiteField } from '@/app/actions/video-page/save-site-fields';

interface Props {
  videoId: string;
  parshaSlug: string;
  isLive: boolean;
  liveSince: string | null;
  liveVersionLabel: string | null;
  title: string;
  subtitle: string;
  description: string;
  websiteUrl: string;
  onReplace: () => void;  // routes parent to Phase 1 of a fresh draft
}

export function SiteCard(p: Props) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handlePublish() {
    setError(null);
    startTransition(async () => {
      const res = await setVideoPublished(p.videoId, true, p.parshaSlug);
      if (res.error) setError(res.error);
    });
  }

  if (p.isLive) {
    return (
      <div style={{
        border: '1px solid var(--ink-100)',
        borderRadius: 10,
        padding: 14,
        marginBottom: 12,
        background: 'var(--linen-50)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              🌐 torahtaichi.com
            </div>
            <div style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 600, marginTop: 2 }}>
              ● Live{p.liveSince ? ` since ${new Date(p.liveSince).toLocaleDateString()}` : ''}
            </div>
          </div>
          <a
            href={p.websiteUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--navy-700)', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            View page →
          </a>
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{p.title || '(no title)'}</div>
        <div style={{ fontSize: 13, color: 'var(--ink-700)', marginBottom: 4 }}>{p.subtitle}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 14 }}>{p.description}</div>
        <button
          type="button"
          onClick={() => setConfirmReplace(true)}
          style={{
            width: '100%',
            minHeight: 44,
            fontSize: 13,
            fontWeight: 500,
            background: 'white',
            color: 'var(--navy-700)',
            border: '1px solid var(--navy-700)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Replace site version
        </button>

        <BottomSheet
          open={confirmReplace}
          onOpenChange={setConfirmReplace}
          title="Replace what's on torahtaichi.com?"
          primaryAction={{
            label: 'Yes — start a new version',
            onClick: () => { setConfirmReplace(false); p.onReplace(); },
            destructive: true,
          }}
          secondaryAction={{ label: 'Cancel', onClick: () => setConfirmReplace(false) }}
        >
          This starts a new draft.{' '}
          {p.liveVersionLabel ?? 'The current version'} stays live on the website until you publish the new one.
        </BottomSheet>
      </div>
    );
  }

  // Draft variant: editable fields + publish CTA
  return (
    <div style={{
      border: '1.5px solid var(--navy-700)',
      borderRadius: 10,
      padding: 14,
      marginBottom: 12,
      background: 'white',
    }}>
      <div style={{ fontSize: 11, color: 'var(--navy-700)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 12 }}>
        🌐 torahtaichi.com · not yet published
      </div>

      <EditableField
        storageKey={`site.${p.parshaSlug}.title`}
        label="Title"
        initialValue={p.title}
        onSave={(v) => saveSiteField(p.videoId, 'title', v)}
        multiline={false}
        placeholder="Bamidbar"
      />
      <EditableField
        storageKey={`site.${p.parshaSlug}.subtitle`}
        label="Sub-title"
        initialValue={p.subtitle}
        onSave={(v) => saveSiteField(p.videoId, 'subtitle', v)}
        multiline={false}
        placeholder="In the desert, counted as one."
      />
      <EditableField
        storageKey={`site.${p.parshaSlug}.description`}
        label="Description"
        initialValue={p.description}
        onSave={(v) => saveSiteField(p.videoId, 'description', v)}
        minHeight={80}
        placeholder="Longer copy + SEO meta…"
      />

      {error && (
        <div style={{ fontSize: 12, color: 'var(--tassel)', marginBottom: 8 }}>{error}</div>
      )}

      <button
        type="button"
        onClick={handlePublish}
        disabled={isPending}
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
          cursor: isPending ? 'not-allowed' : 'pointer',
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? 'Publishing…' : 'Publish to torahtaichi.com'}
      </button>
    </div>
  );
}
