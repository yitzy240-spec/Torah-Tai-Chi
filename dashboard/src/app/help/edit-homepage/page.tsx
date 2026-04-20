import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'How to edit site wording · Help' };

export default function HelpEditHomepage() {
  return (
    <article>
      <header style={{ marginBottom: '40px' }}>
        <div style={{ fontFamily: 'var(--ff-body)', fontSize: '10.5px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--cedar-600)', marginBottom: '10px' }}>
          Content
        </div>
        <h1 style={{ fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--ink-900)', margin: '0 0 14px', fontVariationSettings: '"opsz" 54, "SOFT" 20' }}>
          How to change the hero text or any site wording
        </h1>
        <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '16px', color: 'var(--ink-500)', margin: 0, fontVariationSettings: '"opsz" 18, "SOFT" 50' }}>
          Every word on the homepage, About page, and footer is editable here.
        </p>
      </header>

      <div style={{ fontFamily: 'var(--ff-body)', fontSize: '15.5px', lineHeight: 1.7, color: 'var(--ink-700)' }}>
        <ol style={{ paddingLeft: '22px', margin: '0 0 28px' }}>
          <li style={{ marginBottom: '14px' }}>Go to <strong>Site content</strong> in the left sidebar.</li>
          <li style={{ marginBottom: '14px' }}>The page shows all the editable text on the site, grouped by section — Home, About, Footer, and others.</li>
          <li style={{ marginBottom: '14px' }}>Click into any field and type your change.</li>
          <li style={{ marginBottom: '14px' }}>Click <strong>Save</strong> next to that field. The website updates in about 30 seconds — no rebuild needed.</li>
        </ol>

        <p style={{ margin: '0 0 14px' }}>
          The field labels tell you where the text appears. For example, <em>home.hero.title</em> is the large headline on the homepage.
        </p>

        <p style={{ margin: '0 0 14px' }}>
          If you want to add a line break inside a field, press Shift + Enter. A blank line creates a new paragraph.
        </p>

        <p style={{ margin: '0 0 14px' }}>
          Changes are saved per field — you don&apos;t need to save the whole page at once. If you make a mistake, just edit the field again and save.
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
