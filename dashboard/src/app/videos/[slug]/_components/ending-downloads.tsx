// dashboard/src/app/videos/[slug]/_components/ending-downloads.tsx
//
// Two download buttons, one per video ending (see lib/video-endings.ts):
// the Follow cut for Facebook / IG / TikTok and the Subscribe cut for
// YouTube. For manual posting the operator has to grab the right file per
// platform, so each button names its platforms instead of a bare
// "Download mp4". On videos from before the two endings existed the
// subscribe URL falls back to the follow file (same video, follow card).

import type { CSSProperties } from 'react';
import { downloadUrl } from '@/lib/storage-url';
import {
  ENDING_DOWNLOAD_LABELS,
  endingDownloadFilename,
  type Ending,
} from '@/lib/video-endings';

interface Props {
  parshaSlug: string;
  followUrl: string | null;
  subscribeUrl: string | null;
}

const buttonStyle: CSSProperties = {
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 14px',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--ink-700)',
  textDecoration: 'none',
  border: '1px solid var(--ink-200)',
  borderRadius: 8,
};

export function EndingDownloads({ parshaSlug, followUrl, subscribeUrl }: Props) {
  const rows: Array<{ ending: Ending; url: string | null }> = [
    { ending: 'follow', url: followUrl },
    { ending: 'subscribe', url: subscribeUrl || followUrl },
  ];
  if (!followUrl && !subscribeUrl) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {rows.map(({ ending, url }) =>
        url ? (
          <a
            key={ending}
            href={downloadUrl(url, endingDownloadFilename(parshaSlug, ending))}
            download={endingDownloadFilename(parshaSlug, ending)}
            data-ending={ending}
            style={buttonStyle}
          >
            {ENDING_DOWNLOAD_LABELS[ending]}
          </a>
        ) : null,
      )}
    </div>
  );
}
