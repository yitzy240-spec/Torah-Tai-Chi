// dashboard/src/app/videos/[slug]/_components/live-site-cms-card.tsx
//
// Inline-editable site CMS card for the live-at-rest page (B2).
// Renders all 5 text fields the public website consumes:
//   title, subtitle, description, website_caption, spoken_script.
//
// DEFAULT STATE: read-only display. Each field row shows label + value + "Edit" link.
// Per-field edit: tapping "Edit" on ONE field collapses it to an input, focused.
//   - localStorage draft + optimistic save via EditableField primitive.
//   - "Cancel" link reverts that field to read mode + restores the original value.
//
// "Publish changes" CTA: navy fill when any field has a pending edit, outlined when none.
// "Unpublish" stays outlined, no change.
// "X fields editing" context note shows while any field is in edit mode.
//
// "View page" link is always present while the video is live.

'use client';
import { useState, useRef, useTransition, useEffect } from 'react';
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

type FieldKey = 'title' | 'subtitle' | 'description' | 'websiteCaption' | 'spokenScript';

function ReadValueDisplay({ value, multiline }: { value: string; multiline?: boolean }) {
  if (multiline) {
    return (
      <div
        style={{
          fontSize: 15,
          color: 'var(--ink-500)',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {value || <span style={{ color: 'var(--ink-300)', fontStyle: 'italic' }}>—</span>}
      </div>
    );
  }
  return (
    <div
      style={{
        fontSize: 15,
        color: 'var(--ink-500)',
      }}
    >
      {value || <span style={{ color: 'var(--ink-300)', fontStyle: 'italic' }}>—</span>}
    </div>
  );
}

interface FieldRowProps {
  label: string;
  fieldKey: FieldKey;
  storageKey: string;
  initialValue: string;
  currentValue: string;
  multiline?: boolean;
  minHeight?: number;
  placeholder?: string;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (v: string) => Promise<void>;
  onValueChange: (v: string) => void;
}

function FieldRow({
  label,
  storageKey,
  initialValue,
  currentValue,
  multiline = true,
  minHeight,
  placeholder,
  isEditing,
  onEdit,
  onCancel,
  onSave,
}: FieldRowProps) {
  // Auto-focus the input when switching into edit mode.
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Label row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isEditing ? 4 : 2,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--ink-700)', fontWeight: 500 }}>{label}</span>
        {isEditing ? (
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 11,
              color: 'var(--ink-400)',
              background: 'transparent',
              border: 'none',
              padding: '2px 0',
              cursor: 'pointer',
              minHeight: 'unset',
              textDecoration: 'underline',
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            style={{
              fontSize: 11,
              color: 'var(--navy-700)',
              background: 'transparent',
              border: 'none',
              padding: '2px 0',
              cursor: 'pointer',
              minHeight: 'unset',
              textDecoration: 'underline',
            }}
          >
            Edit
          </button>
        )}
      </div>

      {/* Value / input */}
      {isEditing ? (
        <EditableField
          storageKey={storageKey}
          label=""
          initialValue={currentValue}
          onSave={onSave}
          multiline={multiline}
          minHeight={minHeight}
          placeholder={placeholder}
        />
      ) : (
        <div
          style={{ paddingBottom: 2 }}
          onClick={onEdit}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onEdit(); }}
          aria-label={`Edit ${label}`}
        >
          <ReadValueDisplay value={initialValue} multiline={multiline} />
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--ink-100)', marginTop: isEditing ? 4 : 8 }} />
    </div>
  );
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

  // Track which fields are in edit mode
  const [editingFields, setEditingFields] = useState<Set<FieldKey>>(new Set());

  // Track the current field values so the "Publish changes" bulk-save can flush
  // them all in one call. EditableField fires per-field optimistic saves on each
  // change, but we still capture the latest value here for the final flush.
  const latestTitle = useRef(title);
  const latestSubtitle = useRef(subtitle);
  const latestDescription = useRef(description);
  const latestWebsiteCaption = useRef(websiteCaption);
  const latestSpokenScript = useRef(spokenScript);

  const editingCount = editingFields.size;
  const hasEdits = editingCount > 0;

  function startEditing(field: FieldKey) {
    setEditingFields((prev) => new Set([...prev, field]));
  }

  function stopEditing(field: FieldKey) {
    setEditingFields((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }

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
        setEditingFields(new Set());
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

  const fieldProps = {
    title: {
      label: 'Title',
      storageKey: `site.${parshaSlug}.title`,
      initialValue: title,
      latestRef: latestTitle,
      dbField: 'title' as const,
      multiline: false,
      placeholder: 'Bamidbar',
    },
    subtitle: {
      label: 'Sub-title',
      storageKey: `site.${parshaSlug}.subtitle`,
      initialValue: subtitle,
      latestRef: latestSubtitle,
      dbField: 'subtitle' as const,
      multiline: false,
      placeholder: 'In the desert, counted as one.',
    },
    description: {
      label: 'Description',
      storageKey: `site.${parshaSlug}.description`,
      initialValue: description,
      latestRef: latestDescription,
      dbField: 'description' as const,
      multiline: true,
      minHeight: 80,
      placeholder: 'Longer copy + SEO meta…',
    },
    websiteCaption: {
      label: 'Caption (shown below video on website)',
      storageKey: `site.${parshaSlug}.website_caption`,
      initialValue: websiteCaption,
      latestRef: latestWebsiteCaption,
      dbField: 'website_caption' as const,
      multiline: true,
      minHeight: 60,
      placeholder: 'Short caption displayed under the video…',
    },
    spokenScript: {
      label: 'Spoken script (shown on website below video)',
      storageKey: `site.${parshaSlug}.spoken_script`,
      initialValue: spokenScript,
      latestRef: latestSpokenScript,
      dbField: 'spoken_script' as const,
      multiline: true,
      minHeight: 120,
      placeholder: 'Full script text…',
    },
  };

  type FieldMeta = {
    label: string;
    storageKey: string;
    initialValue: string;
    latestRef: React.MutableRefObject<string>;
    dbField: 'title' | 'subtitle' | 'description' | 'website_caption' | 'spoken_script';
    multiline: boolean;
    minHeight?: number;
    placeholder: string;
  };

  const fieldEntries = Object.entries(fieldProps) as Array<[FieldKey, FieldMeta]>;

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

      {/* 5 fields — read by default, per-field edit affordance */}
      {fieldEntries.map(
        ([key, fp]) => (
          <FieldRow
            key={key}
            fieldKey={key}
            label={fp.label}
            storageKey={fp.storageKey}
            initialValue={fp.initialValue}
            currentValue={fp.latestRef.current}
            multiline={fp.multiline}
            minHeight={fp.minHeight}
            placeholder={fp.placeholder}
            isEditing={editingFields.has(key)}
            onEdit={() => startEditing(key)}
            onCancel={() => {
              stopEditing(key);
              // Reset the latestRef back to initial so publish-flush stays consistent
              fp.latestRef.current = fp.initialValue;
            }}
            onSave={async (v) => {
              fp.latestRef.current = v;
              await saveSiteField(videoId, fp.dbField, v);
            }}
            onValueChange={(v) => {
              fp.latestRef.current = v;
            }}
          />
        ),
      )}

      {/* "X fields editing" context note */}
      {hasEdits && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--ink-500)',
            marginBottom: 8,
            fontStyle: 'italic',
          }}
        >
          {editingCount === 1 ? '1 field editing' : `${editingCount} fields editing`} — save with "Publish changes" below
        </div>
      )}

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

      {/* Publish changes — primary when edits pending, outlined when none */}
      <button
        type="button"
        onClick={handlePublishChanges}
        disabled={publishing || unpublishing}
        style={{
          width: '100%',
          minHeight: 48,
          fontSize: 14,
          fontWeight: 500,
          background: hasEdits ? 'var(--navy-700)' : 'white',
          color: hasEdits ? 'var(--linen-50)' : 'var(--ink-700)',
          border: hasEdits ? 'none' : '1px solid var(--ink-300)',
          borderRadius: 8,
          padding: 12,
          cursor: publishing || unpublishing ? 'not-allowed' : 'pointer',
          opacity: publishing || unpublishing ? 0.7 : 1,
          marginBottom: 8,
          transition: 'background 0.15s, color 0.15s, border 0.15s',
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
