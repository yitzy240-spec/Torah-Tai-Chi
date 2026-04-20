'use client';

import { useState, useTransition } from 'react';
import { broadcast, type BroadcastResult } from '@/app/actions/broadcast';

interface Channel {
  id: string;
  service: string;
  username: string;
}

interface Props {
  channels: Channel[];
}

const MEDIA_REQUIRED = new Set(['instagram', 'tiktok']);

export function ComposeForm({ channels }: Props) {
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(channels.map((c) => c.id)));
  const [shareNow, setShareNow] = useState(true);
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<BroadcastResult[] | null>(null);
  const [topError, setTopError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let users re-upload the same file if needed
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/compose/upload', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
      setImageUrl(body.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const toggleChannel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mediaRequiredChannels = channels
    .filter((c) => selected.has(c.id) && MEDIA_REQUIRED.has(c.service))
    .map((c) => c.service);
  const showMediaWarning = !imageUrl.trim() && mediaRequiredChannels.length > 0;

  const submit = () => {
    setTopError(null);
    setResults(null);
    startTransition(async () => {
      const res = await broadcast({
        text,
        imageUrl: imageUrl.trim() || undefined,
        channelIds: Array.from(selected),
        shareNow,
      });
      if (res.error) setTopError(res.error);
      setResults(res.results);
    });
  };

  const canSubmit = text.trim().length > 0 && selected.size > 0 && !pending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Caption */}
      <div>
        <label htmlFor="caption" style={LABEL_STYLE}>Caption</label>
        <textarea
          id="caption"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="What do you want to say?"
          style={{
            ...INPUT_STYLE,
            minHeight: '140px',
            resize: 'vertical',
            fontFamily: 'var(--ff-body)',
            lineHeight: 1.5,
          }}
        />
        <div style={HELP_STYLE}>{text.length} characters</div>
      </div>

      {/* Image — upload or paste URL */}
      <div>
        <label style={LABEL_STYLE}>
          Image <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}>(required for Instagram & TikTok)</span>
        </label>

        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Selected image"
            style={{
              maxHeight: '220px',
              width: 'auto',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--ink-100)',
              display: 'block',
              marginBottom: '12px',
            }}
          />
        )}

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--ff-body)',
              fontSize: '13px',
              fontWeight: 500,
              padding: '9px 16px',
              minHeight: '40px',
              borderRadius: '999px',
              border: '1px solid var(--ink-200)',
              background: 'var(--linen-50)',
              color: 'var(--ink-700)',
              cursor: uploading ? 'wait' : 'pointer',
              transition: 'all var(--trans)',
              opacity: uploading ? 0.6 : 1,
            }}
          >
            <input type="file" accept="image/*" disabled={uploading} onChange={handleFileChange} style={{ display: 'none' }} />
            {uploading ? 'Uploading…' : imageUrl ? 'Replace image' : 'Upload image'}
          </label>
          {imageUrl && !uploading && (
            <button
              type="button"
              onClick={() => { setImageUrl(''); setUploadError(null); }}
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '12.5px',
                color: 'var(--ink-500)',
                textDecoration: 'underline',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                minHeight: '40px',
              }}
            >
              Remove
            </button>
          )}
        </div>

        <input
          id="imageUrl"
          type="url"
          value={imageUrl}
          onChange={(e) => { setImageUrl(e.target.value); setUploadError(null); }}
          placeholder="…or paste a public image URL"
          style={{ ...INPUT_STYLE, fontSize: '13.5px' }}
        />

        {uploadError && (
          <div style={{ marginTop: '8px', fontFamily: 'var(--ff-body)', fontSize: '12.5px', color: '#8b2d1c' }}>
            {uploadError}
          </div>
        )}
      </div>

      {/* Channels */}
      <div>
        <div style={LABEL_STYLE}>Channels</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
          {channels.map((c) => {
            const isSelected = selected.has(c.id);
            const needsMedia = MEDIA_REQUIRED.has(c.service);
            return (
              <label
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  border: `1px solid ${isSelected ? 'var(--navy-500)' : 'var(--ink-100)'}`,
                  borderRadius: 'var(--r-md)',
                  background: isSelected ? 'var(--navy-wash)' : 'var(--linen-50)',
                  cursor: 'pointer',
                  transition: 'all var(--trans)',
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleChannel(c.id)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--navy-800)' }}
                />
                <span style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, textTransform: 'capitalize', color: 'var(--ink-900)' }}>
                  {c.service}
                </span>
                <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '13px', color: 'var(--ink-500)' }}>
                  @{c.username}
                </span>
                {needsMedia && (
                  <span style={{
                    marginLeft: 'auto',
                    fontFamily: 'var(--ff-body)',
                    fontSize: '10.5px',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--cedar-600)',
                  }}>
                    needs image
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {showMediaWarning && (
          <div style={{
            marginTop: '10px',
            padding: '10px 14px',
            borderRadius: 'var(--r-sm)',
            background: 'rgba(168,114,47,.08)',
            fontFamily: 'var(--ff-body)',
            fontSize: '12.5px',
            color: 'var(--cedar-700)',
          }}>
            {mediaRequiredChannels.join(' + ')} require an image URL. Posts to those will fail without one.
          </div>
        )}
      </div>

      {/* When */}
      <div>
        <label style={LABEL_STYLE}>Timing</label>
        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          {[
            { v: true, label: 'Post now' },
            { v: false, label: 'Queue in Buffer' },
          ].map((opt) => (
            <button
              key={String(opt.v)}
              type="button"
              onClick={() => setShareNow(opt.v)}
              style={{
                fontFamily: 'var(--ff-body)',
                fontWeight: 500,
                fontSize: '13.5px',
                padding: '10px 18px',
                minHeight: '40px',
                borderRadius: '999px',
                border: `1px solid ${shareNow === opt.v ? 'var(--navy-800)' : 'var(--ink-200)'}`,
                background: shareNow === opt.v ? 'var(--navy-800)' : 'transparent',
                color: shareNow === opt.v ? 'var(--linen-50)' : 'var(--ink-700)',
                cursor: 'pointer',
                transition: 'all var(--trans)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingTop: '12px', borderTop: '1px solid var(--ink-100)' }}>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          style={{
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '14px',
            padding: '12px 28px',
            minHeight: '44px',
            borderRadius: '999px',
            border: '1px solid var(--navy-800)',
            background: canSubmit ? 'var(--navy-800)' : 'var(--ink-300)',
            color: 'var(--linen-50)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'all var(--trans)',
            boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
          }}
        >
          {pending ? 'Sending…' : shareNow ? `Post now to ${selected.size}` : `Queue to ${selected.size}`}
        </button>
        <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12.5px', color: 'var(--ink-400)' }}>
          {shareNow ? 'Posts publish immediately.' : 'Posts land in Buffer\'s queue.'}
        </span>
      </div>

      {/* Results */}
      {topError && (
        <div style={{
          padding: '14px 18px',
          borderRadius: 'var(--r-md)',
          background: 'rgba(192,57,43,.08)',
          border: '1px solid rgba(192,57,43,.25)',
          color: '#8b2d1c',
          fontFamily: 'var(--ff-body)',
          fontSize: '13.5px',
          lineHeight: 1.5,
        }}>
          {topError}
        </div>
      )}
      {results && results.length > 0 && (
        <div>
          <div style={LABEL_STYLE}>Result</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
            {results.map((r) => (
              <div
                key={r.channel.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: 'var(--r-sm)',
                  background: r.ok ? 'rgba(90,110,61,.08)' : 'rgba(192,57,43,.08)',
                  fontFamily: 'var(--ff-body)',
                  fontSize: '13px',
                }}
              >
                <span style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: r.ok ? 'var(--jade)' : '#c0392b',
                  flexShrink: 0,
                }} />
                <span style={{ textTransform: 'capitalize', fontWeight: 500, color: 'var(--ink-900)' }}>{r.channel.service}</span>
                <span style={{ color: 'var(--ink-400)', fontStyle: 'italic', fontFamily: 'var(--ff-display)' }}>@{r.channel.username}</span>
                <span style={{ marginLeft: 'auto', color: r.ok ? 'var(--jade)' : '#8b2d1c' }}>
                  {r.ok ? 'Posted ✓' : (r.error ?? 'Failed')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--ff-body)',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-500)',
  marginBottom: '8px',
};

const INPUT_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '12px 14px',
  fontFamily: 'var(--ff-body)',
  fontSize: '14.5px',
  color: 'var(--ink-900)',
  background: 'var(--linen-50)',
  border: '1px solid var(--ink-200)',
  borderRadius: 'var(--r-md)',
  outline: 'none',
  transition: 'border-color var(--trans)',
};

const HELP_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-display)',
  fontStyle: 'italic',
  fontSize: '12px',
  color: 'var(--ink-400)',
  marginTop: '6px',
};
