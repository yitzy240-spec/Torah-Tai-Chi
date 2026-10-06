// dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/frame-picker.tsx
//
// Uses <canvas> to extract a frame from the stitched video at HTMLVideoElement.currentTime.
// Outputs a JPEG blob; the caller decides where it goes:
//   - YouTube card → save-youtube-thumbnail (videos.youtube_thumbnail_url)
//   - Site cards   → save-site-thumbnail    (videos.thumb_path, the website cover)

'use client';
import { useRef, useState } from 'react';

// Longest edge of the saved frame. Keeps the JPEG well under the 1 MB
// server-action body limit once base64-encoded, even for 1080p sources.
const MAX_EDGE = 1280;

interface Props {
  videoUrl: string;
  initialThumbUrl: string | null;
  onPick: (blob: Blob) => Promise<void>;
  label?: string;
  buttonLabel?: string;
}

/** Blob → data URL. Server actions take strings; FileReader avoids the
 *  `String.fromCharCode(...bytes)` spread, which overflows the call stack
 *  on a few-hundred-KB image. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function FramePicker({
  videoUrl,
  initialThumbUrl,
  onPick,
  label = 'Cover thumbnail',
  buttonLabel = 'Use this frame as cover',
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialThumbUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    const v = videoRef.current;
    if (!v) return;
    setError(null);

    const srcW = v.videoWidth || 720;
    const srcH = v.videoHeight || 1280;
    const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

    setPending(true);
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          setError('Could not capture that frame — try again.');
          setPending(false);
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        try {
          await onPick(blob);
          setPreviewUrl(objectUrl);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Saving the frame failed.');
        } finally {
          setPending(false);
        }
      }, 'image/jpeg', 0.88);
    } catch {
      // toBlob throws SecurityError if the canvas is tainted (video served
      // without CORS headers).
      setError('Could not capture that frame — try again.');
      setPending(false);
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {previewUrl && (
          <img
            src={previewUrl}
            alt="cover preview"
            style={{ width: 72, height: 128, borderRadius: 4, background: 'var(--ink-200)', objectFit: 'cover', flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1 }}>
          <video
            ref={videoRef}
            src={videoUrl}
            // Without crossOrigin the canvas is tainted by the Supabase
            // storage origin and toBlob throws, so the pick silently fails.
            crossOrigin="anonymous"
            controls
            playsInline
            preload="metadata"
            style={{ width: '100%', aspectRatio: '9/16', borderRadius: 4, background: 'var(--ink-900)', display: 'block' }}
          />
          <button
            type="button"
            onClick={pick}
            disabled={pending}
            style={{
              marginTop: 8,
              minHeight: 44,
              padding: '8px 14px',
              fontSize: 13,
              background: 'white',
              color: 'var(--navy-700)',
              border: '1px solid var(--navy-700)',
              borderRadius: 8,
              cursor: pending ? 'not-allowed' : 'pointer',
              width: '100%',
            }}
          >
            {pending ? 'Saving…' : buttonLabel}
          </button>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--tassel)', marginTop: 6 }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
