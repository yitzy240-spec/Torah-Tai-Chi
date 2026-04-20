import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'How to produce this week\'s video · Help' };

export default function HelpGenerateVideo() {
  return (
    <article>
      <header style={{ marginBottom: '40px' }}>
        <div style={{ fontFamily: 'var(--ff-body)', fontSize: '10.5px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--cedar-600)', marginBottom: '10px' }}>
          Video
        </div>
        <h1 style={{ fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--ink-900)', margin: '0 0 14px', fontVariationSettings: '"opsz" 54, "SOFT" 20' }}>
          How to produce this week&apos;s video
        </h1>
        <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '16px', color: 'var(--ink-500)', margin: 0, fontVariationSettings: '"opsz" 18, "SOFT" 50' }}>
          From script approval to a finished video — here&apos;s the whole flow.
        </p>
      </header>

      <div style={{ fontFamily: 'var(--ff-body)', fontSize: '15.5px', lineHeight: 1.7, color: 'var(--ink-700)' }}>
        <h2 style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '17px', color: 'var(--ink-800)', margin: '0 0 14px', fontVariationSettings: '"opsz" 18, "SOFT" 20' }}>
          Step 1 — Read the script
        </h2>
        <p style={{ margin: '0 0 20px' }}>
          Open <strong>Today</strong> in the sidebar. The current parsha script is displayed in the main card. Read it out loud once — you&apos;ll notice quickly if anything sounds off.
        </p>

        <h2 style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '17px', color: 'var(--ink-800)', margin: '0 0 14px', fontVariationSettings: '"opsz" 18, "SOFT" 20' }}>
          Step 2 — Adjust if needed
        </h2>
        <p style={{ margin: '0 0 20px' }}>
          Click <strong>Adjust the script</strong> to open the editor. Make any word changes, then save. You don&apos;t need to regenerate the whole thing for small edits.
        </p>

        <h2 style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '17px', color: 'var(--ink-800)', margin: '0 0 14px', fontVariationSettings: '"opsz" 18, "SOFT" 20' }}>
          Step 3 — Generate the video
        </h2>
        <p style={{ margin: '0 0 20px' }}>
          When the script is ready, click <strong>Approve · generate video</strong>. A dialog will appear asking you to confirm the quality setting. Click <strong>Generate</strong> to start.
        </p>
        <p style={{ margin: '0 0 20px' }}>
          Generation takes about 45 seconds. You&apos;ll see a progress indicator. When it finishes, the video appears in the Videos list.
        </p>

        <h2 style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '17px', color: 'var(--ink-800)', margin: '0 0 14px', fontVariationSettings: '"opsz" 18, "SOFT" 20' }}>
          Step 4 — Review and schedule
        </h2>
        <p style={{ margin: '0 0 14px' }}>
          Open the video in <strong>Videos</strong> and watch it through. If it&apos;s good, go to <strong>Channels</strong> to schedule it. See the &ldquo;Schedule posts&rdquo; help article for that part.
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
