import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'How to schedule posts · Help' };

export default function HelpSchedulePosts() {
  return (
    <article>
      <header style={{ marginBottom: '40px' }}>
        <div style={{ fontFamily: 'var(--ff-body)', fontSize: '10.5px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--cedar-600)', marginBottom: '10px' }}>
          Publishing
        </div>
        <h1 style={{ fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--ink-900)', margin: '0 0 14px', fontVariationSettings: '"opsz" 54, "SOFT" 20' }}>
          How to schedule posts to all channels
        </h1>
        <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '16px', color: 'var(--ink-500)', margin: 0, fontVariationSettings: '"opsz" 18, "SOFT" 50' }}>
          One action sends the video to TikTok, Instagram, YouTube, and Facebook.
        </p>
      </header>

      <div style={{ fontFamily: 'var(--ff-body)', fontSize: '15.5px', lineHeight: 1.7, color: 'var(--ink-700)' }}>
        <ol style={{ paddingLeft: '22px', margin: '0 0 28px' }}>
          <li style={{ marginBottom: '14px' }}>Make sure the video has been generated and you&apos;ve watched it through. (See <em>How to produce this week&apos;s video</em> if you haven&apos;t done that part yet.)</li>
          <li style={{ marginBottom: '14px' }}>Go to <strong>Channels</strong> in the sidebar, or click the video in the Videos list and open the scheduling panel.</li>
          <li style={{ marginBottom: '14px' }}>Review the captions for each platform. They are pre-written for you — adjust the wording for any platform if you want.</li>
          <li style={{ marginBottom: '14px' }}>Set the date and time you want the posts to go out.</li>
          <li style={{ marginBottom: '14px' }}>Click <strong>Schedule all</strong>. The system sends all four posts to Buffer, which queues them for the time you chose.</li>
          <li style={{ marginBottom: '14px' }}>You&apos;ll see a confirmation showing each platform with a green tick. That means it&apos;s queued.</li>
        </ol>

        <p style={{ margin: '0 0 14px' }}>
          If one platform shows a red warning instead of a tick, that platform had an issue. The others still went through. Note which one failed and try again, or contact me.
        </p>

        <p style={{ margin: '0 0 14px' }}>
          To check your Buffer queue or edit a post before it goes out, log in to <a href="https://buffer.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cedar-600)' }}>buffer.com</a> directly.
        </p>
      </div>

      <StuckSection />
    </article>
  );
}

function StuckSection() {
  return (
    <div style={{ marginTop: '52px', paddingTop: '28px', borderTop: '1px solid var(--ink-100)' }}>
      <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '14px', color: 'var(--ink-500)', margin: '0 0 8px', fontVariationSettings: '"opsz" 14, "SOFT" 60' }}>
        Still stuck?
      </p>
      <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13.5px', color: 'var(--ink-600)', margin: 0 }}>
        Email <a href="mailto:yitzym@fiveblocks.com" style={{ color: 'var(--cedar-600)', textDecoration: 'underline', textDecorationColor: 'var(--cedar-300)', textUnderlineOffset: '3px' }}>yitzym@fiveblocks.com</a> and I&apos;ll sort it out quickly.
      </p>
    </div>
  );
}
