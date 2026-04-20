'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { broadcast } from '@/app/actions/broadcast';
import { AiImagePanel } from './ai-image-panel';
import { AiVideoPanel } from './ai-video-panel';

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'View on TikTok',
  instagram: 'View on Instagram',
  twitter: 'View on X',
  facebook: 'View on Facebook',
  youtube: 'View on YouTube',
};

interface Channel {
  id: string;
  service: string;
  username: string;
}

interface Props {
  channels: Channel[];
  /** Whether BUFFER_ACCESS_TOKEN is set — gates the Schedule-all button on the video panel. */
  bufferConfigured: boolean;
}

const MEDIA_REQUIRED = new Set(['instagram', 'tiktok']);

export function ComposeForm({ channels, bufferConfigured }: Props) {
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(channels.map((c) => c.id)));
  const [pending, startTransition] = useTransition();
  const [topError, setTopError] = useState<string | null>(null);
  // Per-channel status lives inline in the channel cards.
  type ChannelState =
    | { kind: 'idle' }
    | { kind: 'posting' }
    | { kind: 'success'; bufferId: string; link?: string }
    | { kind: 'failed'; error: string };
  const [statuses, setStatuses] = useState<Record<string, ChannelState>>({});
  const linkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll Buffer for platform-direct externalLink for any successful post.
  // Buffer populates it once the network actually publishes — seconds for X,
  // up to ~2 min for TikTok. Gives up after 3 minutes.
  useEffect(() => {
    if (linkPollRef.current) clearInterval(linkPollRef.current);
    const pending = Object.entries(statuses)
      .filter(([, s]) => s.kind === 'success' && !s.link)
      .map(([channelId, s]) => ({ channelId, bufferId: (s as { bufferId: string }).bufferId }));
    if (pending.length === 0) return;
    const started = Date.now();
    const MAX_MS = 3 * 60 * 1000;
    const tick = async () => {
      try {
        const ids = pending.map((p) => p.bufferId).join(',');
        const res = await fetch(`/api/buffer/post-links?ids=${ids}`, { cache: 'no-store' });
        if (res.ok) {
          const body = (await res.json()) as { links: Record<string, string | null> };
          setStatuses((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const { channelId, bufferId } of pending) {
              const link = body.links[bufferId];
              if (link && next[channelId]?.kind === 'success') {
                next[channelId] = { kind: 'success', bufferId, link };
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
      } catch {
        // ignore; keep trying
      }
      if (Date.now() - started > MAX_MS && linkPollRef.current) {
        clearInterval(linkPollRef.current);
      }
    };
    tick();
    linkPollRef.current = setInterval(tick, 5000);
    return () => {
      if (linkPollRef.current) clearInterval(linkPollRef.current);
    };
  }, [statuses]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let users re-upload the same file if needed
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      // Step 1: ask our server for a signed URL (tiny JSON body, no Vercel body-size concern).
      const signRes = await fetch('/api/compose/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      const signText = await signRes.text();
      let signJson: { signedUrl?: string; publicUrl?: string; error?: string };
      try {
        signJson = JSON.parse(signText);
      } catch {
        throw new Error(`Signing failed (HTTP ${signRes.status}): ${signText.slice(0, 120)}`);
      }
      if (!signRes.ok || !signJson.signedUrl || !signJson.publicUrl) {
        throw new Error(signJson.error ?? `Signing failed (${signRes.status})`);
      }
      // Step 2: PUT the bytes directly to Supabase Storage. Bypasses Vercel entirely.
      const putRes = await fetch(signJson.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file,
      });
      if (!putRes.ok) {
        const t = await putRes.text();
        throw new Error(`Upload to storage failed (${putRes.status}): ${t.slice(0, 120)}`);
      }
      setImageUrl(signJson.publicUrl);
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

  const submit = (mode: 'post-now' | 'queue') => {
    setTopError(null);
    // Flash every selected card into posting state immediately.
    const initial: Record<string, ChannelState> = {};
    for (const id of selected) initial[id] = { kind: 'posting' };
    setStatuses(initial);

    startTransition(async () => {
      const res = await broadcast({
        text,
        imageUrl: imageUrl.trim() || undefined,
        channelIds: Array.from(selected),
        shareNow: mode === 'post-now',
      });
      if (res.error) setTopError(res.error);
      // Apply per-channel outcomes
      setStatuses((prev) => {
        const next = { ...prev };
        for (const r of res.results ?? []) {
          next[r.channel.id] = r.ok && r.bufferId
            ? { kind: 'success', bufferId: r.bufferId }
            : { kind: 'failed', error: r.error ?? 'Failed' };
        }
        return next;
      });
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
          <button
            type="button"
            onClick={() => setAiPanelOpen(true)}
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
              border: '1px solid var(--cedar-500)',
              background: 'transparent',
              color: 'var(--cedar-700)',
              cursor: 'pointer',
              transition: 'all var(--trans)',
            }}
          >
            ✦ Generate with AI
          </button>
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

        {aiPanelOpen && (
          <div style={{ marginBottom: '12px' }}>
            <AiImagePanel
              onSelect={(url) => { setImageUrl(url); setAiPanelOpen(false); setUploadError(null); }}
              onCancel={() => setAiPanelOpen(false)}
            />
          </div>
        )}

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

      {/* AI video from topic */}
      <AiVideoPanel bufferConfigured={bufferConfigured} />

      {/* Channels */}
      <div>
        <div style={LABEL_STYLE}>Channels</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
          {channels.map((c) => {
            const isSelected = selected.has(c.id);
            const needsMedia = MEDIA_REQUIRED.has(c.service);
            const status = statuses[c.id];
            const posted = status?.kind === 'success' || status?.kind === 'failed';
            return (
              <label
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  border: `1px solid ${
                    status?.kind === 'success' ? 'var(--jade)'
                    : status?.kind === 'failed' ? 'rgba(192,57,43,.5)'
                    : isSelected ? 'var(--navy-500)'
                    : 'var(--ink-100)'
                  }`,
                  borderRadius: 'var(--r-md)',
                  background:
                    status?.kind === 'success' ? 'rgba(90,110,61,.08)'
                    : status?.kind === 'failed' ? 'rgba(192,57,43,.05)'
                    : isSelected ? 'var(--navy-wash)'
                    : 'var(--linen-50)',
                  cursor: posted ? 'default' : 'pointer',
                  transition: 'all var(--trans)',
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleChannel(c.id)}
                  disabled={posted || pending}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--navy-800)' }}
                />
                <span style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, textTransform: c.service === 'twitter' ? 'none' : 'capitalize', color: 'var(--ink-900)' }}>
                  {c.service === 'twitter' ? 'X' : c.service}
                </span>
                <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '13px', color: 'var(--ink-500)' }}>
                  @{c.username}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {status?.kind === 'posting' && (
                    <>
                      <span
                        aria-hidden="true"
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          border: '2px solid var(--ink-100)',
                          borderTopColor: 'var(--navy-800)',
                          display: 'inline-block',
                          animation: 'tt-spin 0.9s linear infinite',
                        }}
                      />
                      <span style={{ fontFamily: 'var(--ff-body)', fontSize: '12.5px', color: 'var(--ink-500)' }}>
                        Posting…
                      </span>
                    </>
                  )}
                  {status?.kind === 'success' && (
                    <>
                      <span style={{
                        width: '18px', height: '18px', borderRadius: '50%',
                        background: 'var(--jade)', color: 'var(--linen-50)',
                        display: 'grid', placeItems: 'center', fontSize: '11px', fontWeight: 700,
                      }}>✓</span>
                      {status.link ? (
                        <a
                          href={status.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontFamily: 'var(--ff-body)', fontSize: '12.5px',
                            color: 'var(--navy-700)', textDecoration: 'underline',
                            textDecorationColor: 'var(--navy-300)', textUnderlineOffset: '3px',
                          }}
                        >
                          {PLATFORM_LABELS[c.service] ?? 'View post'} ↗
                        </a>
                      ) : (
                        <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12px', color: 'var(--ink-400)' }}>
                          Publishing to {c.service === 'twitter' ? 'X' : c.service}…
                        </span>
                      )}
                    </>
                  )}
                  {status?.kind === 'failed' && (
                    <>
                      <span style={{
                        width: '18px', height: '18px', borderRadius: '50%',
                        background: '#c0392b', color: 'var(--linen-50)',
                        display: 'grid', placeItems: 'center', fontSize: '11px', fontWeight: 700,
                      }}>!</span>
                      <span title={status.error} style={{ fontFamily: 'var(--ff-body)', fontSize: '12px', color: '#8b2d1c', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {status.error}
                      </span>
                    </>
                  )}
                  {!status && needsMedia && (
                    <span style={{
                      fontFamily: 'var(--ff-body)',
                      fontSize: '10.5px',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--cedar-600)',
                    }}>
                      needs image
                    </span>
                  )}
                </div>
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

      {/* Submit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '12px', borderTop: '1px solid var(--ink-100)', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => submit('post-now')}
          disabled={!canSubmit}
          style={{
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '14px',
            padding: '12px 24px',
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
          {pending ? 'Sending…' : `Post now to ${selected.size}`}
        </button>
        <button
          type="button"
          onClick={() => submit('queue')}
          disabled={!canSubmit}
          style={{
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '14px',
            padding: '12px 24px',
            minHeight: '44px',
            borderRadius: '999px',
            border: '1px solid var(--ink-200)',
            background: 'transparent',
            color: canSubmit ? 'var(--ink-700)' : 'var(--ink-400)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'all var(--trans)',
          }}
        >
          {`Queue in Buffer`}
        </button>
        <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12.5px', color: 'var(--ink-400)' }}>
          Post now publishes immediately. Queue lands it in Buffer&apos;s schedule.
        </span>
      </div>

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
