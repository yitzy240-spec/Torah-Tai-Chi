import { listVideoComments } from '@/lib/youtube';

interface Props {
  /** YouTube public video id (11 chars). */
  youtubeVideoId: string;
}

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export async function YouTubeComments({ youtubeVideoId }: Props) {
  let comments;
  try {
    comments = await listVideoComments(youtubeVideoId, 25);
  } catch {
    return null; // YouTube not connected or other auth issue — silently hide.
  }

  if (comments.length === 0) {
    return (
      <section
        style={{
          padding: '24px 26px',
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-50)',
          marginBottom: 36,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: 15,
            color: 'var(--ink-900)',
            margin: '0 0 4px 0',
          }}
        >
          Comments
        </h2>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: 13,
            color: 'var(--ink-400)',
            margin: 0,
          }}
        >
          No YouTube comments yet on this video.
        </p>
      </section>
    );
  }

  return (
    <section
      style={{
        padding: '24px 26px',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--linen-50)',
        marginBottom: 36,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: 15,
            color: 'var(--ink-900)',
            margin: 0,
          }}
        >
          Comments
        </h2>
        <a
          href={`https://www.youtube.com/watch?v=${youtubeVideoId}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: 12.5,
            color: 'var(--ink-500)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Reply on YouTube ↗
        </a>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {comments.map((c) => (
          <li
            key={c.id}
            style={{
              display: 'flex',
              gap: 12,
              paddingBottom: 16,
              borderBottom: '1px dotted var(--ink-100)',
            }}
          >
            {c.authorAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.authorAvatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }}
              />
            ) : (
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'var(--ink-100)',
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                {c.authorChannelUrl ? (
                  <a
                    href={c.authorChannelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontFamily: 'var(--ff-body)',
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: 'var(--ink-900)',
                      textDecoration: 'none',
                    }}
                  >
                    {c.authorName}
                  </a>
                ) : (
                  <span
                    style={{
                      fontFamily: 'var(--ff-body)',
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: 'var(--ink-900)',
                    }}
                  >
                    {c.authorName}
                  </span>
                )}
                <span
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontStyle: 'italic',
                    fontSize: 12,
                    color: 'var(--ink-400)',
                  }}
                >
                  {timeAgo(c.publishedAt)}
                </span>
              </div>
              <p
                style={{
                  fontFamily: 'var(--ff-reading)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: 'var(--ink-800)',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {c.text}
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: 14,
                  marginTop: 8,
                  fontFamily: 'var(--ff-body)',
                  fontSize: 11.5,
                  color: 'var(--ink-500)',
                }}
              >
                {c.likeCount > 0 && <span>{c.likeCount} {c.likeCount === 1 ? 'like' : 'likes'}</span>}
                {c.replyCount > 0 && <span>{c.replyCount} {c.replyCount === 1 ? 'reply' : 'replies'}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
