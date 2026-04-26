'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setVideoPublished } from '@/app/actions/set-video-published';

interface Props {
  videoId: string;
  initialPublished: boolean;
  parshaSlug?: string;
  /** Compact variant fits inline next to the status pills; default is the
   *  fuller card style for the posting panel. */
  variant?: 'card' | 'pill';
}

export function PublishToSiteToggle({ videoId, initialPublished, parshaSlug, variant = 'card' }: Props) {
  const [published, setPublished] = useState(initialPublished);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const toggle = () => {
    const next = !published;
    setError(null);
    setPublished(next); // optimistic
    startTransition(async () => {
      const res = await setVideoPublished(videoId, next, parshaSlug);
      if (res.error) {
        setError(res.error);
        setPublished(!next);
        return;
      }
      router.refresh();
    });
  };

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        title={
          isPending
            ? 'Updating…'
            : published
              ? 'Live on torahtaichi.com — click to unpublish'
              : 'Not on torahtaichi.com — click to publish'
        }
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontFamily: 'var(--ff-body)',
          fontWeight: 500,
          fontSize: '11.5px',
          padding: '4px 12px 4px 8px',
          borderRadius: '999px',
          border: 'none',
          cursor: isPending ? 'wait' : 'pointer',
          background: published ? 'rgba(46,125,94,.12)' : 'rgba(140,125,100,.08)',
          color: published ? 'var(--jade)' : 'var(--ink-500)',
          opacity: isPending ? 0.6 : 1,
          transition: 'all var(--trans)',
        }}
      >
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: published ? 'var(--jade)' : 'var(--ink-300)', flexShrink: 0 }} />
        {published ? 'On torahtaichi.com' : 'Off torahtaichi.com'}
      </button>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '14px',
        padding: '14px 18px',
        border: `1px solid ${published ? 'rgba(46,125,94,.35)' : 'var(--ink-100)'}`,
        borderRadius: 'var(--r-md)',
        background: published ? 'rgba(46,125,94,.04)' : 'var(--linen-50)',
        marginBottom: '16px',
      }}
    >
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '14px',
            color: 'var(--ink-900)',
            marginBottom: '2px',
            fontVariationSettings: '"opsz" 18, "SOFT" 30',
          }}
        >
          {published ? 'Live on torahtaichi.com' : 'Not on torahtaichi.com yet'}
        </div>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '12.5px',
            color: 'var(--ink-500)',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          {published
            ? 'Anyone visiting the site can see this video.'
            : 'Generated videos stay private until you publish them.'}
        </div>
        {error && (
          <div style={{ fontFamily: 'var(--ff-body)', fontSize: '12px', color: 'var(--tassel)', marginTop: '6px' }}>
            {error}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        style={{
          fontFamily: 'var(--ff-body)',
          fontWeight: 500,
          fontSize: '13px',
          padding: '9px 18px',
          minHeight: '40px',
          borderRadius: '999px',
          border: `1px solid ${published ? 'var(--ink-200)' : 'var(--navy-800)'}`,
          background: published ? 'transparent' : 'var(--navy-800)',
          color: published ? 'var(--ink-700)' : 'var(--linen-50)',
          cursor: isPending ? 'wait' : 'pointer',
          transition: 'all var(--trans)',
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? 'Saving…' : published ? 'Unpublish' : 'Publish to site'}
      </button>
    </div>
  );
}
