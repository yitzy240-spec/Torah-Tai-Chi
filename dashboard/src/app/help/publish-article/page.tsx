import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'How to publish a new article · Help' };

export default function HelpPublishArticle() {
  return (
    <article>
      <header style={{ marginBottom: '40px' }}>
        <div style={{ fontFamily: 'var(--ff-body)', fontSize: '10.5px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--cedar-600)', marginBottom: '10px' }}>
          Content
        </div>
        <h1 style={{ fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--ink-900)', margin: '0 0 14px', fontVariationSettings: '"opsz" 54, "SOFT" 20' }}>
          How to publish a new article
        </h1>
        <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '16px', color: 'var(--ink-500)', margin: 0, fontVariationSettings: '"opsz" 18, "SOFT" 50' }}>
          Add a piece to the Writings section of the website in about two minutes.
        </p>
      </header>

      <div style={{ fontFamily: 'var(--ff-body)', fontSize: '15.5px', lineHeight: 1.7, color: 'var(--ink-700)' }}>
        <ol style={{ paddingLeft: '22px', margin: '0 0 28px' }}>
          <li style={{ marginBottom: '14px' }}>Go to <strong>Articles</strong> in the left sidebar.</li>
          <li style={{ marginBottom: '14px' }}>Click <strong>New article</strong> in the top right.</li>
          <li style={{ marginBottom: '14px' }}>Fill in the title, subtitle, and category. Category appears as the small label above the title on the website — something like &ldquo;Teaching&rdquo; or &ldquo;Practice&rdquo;.</li>
          <li style={{ marginBottom: '14px' }}>Write the body in the editor. You can use bold, italics, and paragraph breaks. Keep it simple.</li>
          <li style={{ marginBottom: '14px' }}>Set the <strong>Read time</strong> if you know it — readers appreciate it. Two hundred words is about one minute.</li>
          <li style={{ marginBottom: '14px' }}>When you&apos;re ready, click <strong>Publish</strong>. The article appears on the website within about 30 seconds.</li>
        </ol>

        <p style={{ margin: '0 0 14px' }}>
          If you want to save a draft first without publishing, use <strong>Save draft</strong>. It won&apos;t appear on the site until you click Publish.
        </p>

        <p style={{ margin: '0 0 14px' }}>
          To edit a published article later, find it in the Articles list and click on it. Any change you save is live in under a minute.
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
