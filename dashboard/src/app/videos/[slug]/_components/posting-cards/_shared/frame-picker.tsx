// dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/frame-picker.tsx
//
// Uses <canvas> to extract a frame from the stitched video at HTMLVideoElement.currentTime.
// Outputs a JPEG blob that is uploaded to Supabase Storage via save-youtube-thumbnail action.
// Does NOT write to videos.thumb_path (that's the auto-extracted stitch-time thumbnail).

'use client';
import { useRef, useState } from 'react';

interface Props {
  videoUrl: string;
  initialThumbUrl: string | null;
  onPick: (blob: Blob) => Promise<void>;
}

export function FramePicker({ videoUrl, initialThumbUrl, onPick }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialThumbUrl);
  const [pending, setPending] = useState(false);

  async function pick() {
    const v = videoRef.current;
    if (!v) return;

    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth || 720;
    canvas.height = v.videoHeight || 1280;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

    setPending(true);
    canvas.toBlob(async (blob) => {
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        try {
          await onPick(blob);
        } finally {
          setPending(false);
        }
      } else {
        setPending(false);
      }
    }, 'image/jpeg', 0.9);
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 6 }}>
        Cover thumbnail
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
            {pending ? 'Picking…' : 'Use this frame as cover'}
          </button>
        </div>
      </div>
    </div>
  );
}
