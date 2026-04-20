import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'What the four stances mean · Help' };

export default function HelpStance() {
  return (
    <article>
      <header style={{ marginBottom: '40px' }}>
        <div style={{ fontFamily: 'var(--ff-body)', fontSize: '10.5px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--cedar-600)', marginBottom: '10px' }}>
          Dashboard
        </div>
        <h1 style={{ fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--ink-900)', margin: '0 0 14px', fontVariationSettings: '"opsz" 54, "SOFT" 20' }}>
          What the four stances mean
        </h1>
        <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '16px', color: 'var(--ink-500)', margin: 0, fontVariationSettings: '"opsz" 18, "SOFT" 50' }}>
          The Today page adapts to what you&apos;re doing. Pick the stance that matches where you are.
        </p>
      </header>

      <div style={{ fontFamily: 'var(--ff-body)', fontSize: '15.5px', lineHeight: 1.7, color: 'var(--ink-700)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <StanceBlock
            name="Reviewer"
            description="You're reading the script and deciding whether it's ready. This is the default view when you open the dashboard. The sage-page card is front and centre."
          />
          <StanceBlock
            name="Creator"
            description="You're writing or editing. The script editor expands and the other panels step back. Use this when you want to focus on the words."
          />
          <StanceBlock
            name="Scheduler"
            description="You're queuing posts for the week. The channels panel moves to the top. Use this after the video is approved and you're ready to set times."
          />
          <StanceBlock
            name="Analyst"
            description="You're reviewing how last week's content performed. The analytics summary moves to the top. Good for a Friday morning check-in."
          />
        </div>

        <p style={{ marginTop: '28px' }}>
          To change stance, click the stance label at the top of the Today page. A small panel slides open with the four options. Your choice is remembered until you change it.
        </p>
      </div>

      <StuckSection />
    </article>
  );
}

function StanceBlock({ name, description }: { name: string; description: string }) {
  return (
    <div style={{ borderLeft: '2px solid var(--cedar-200)', paddingLeft: '18px' }}>
      <div style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '16px', color: 'var(--ink-900)', marginBottom: '6px', fontVariationSettings: '"opsz" 18, "SOFT" 20' }}>
        {name}
      </div>
      <div>{description}</div>
    </div>
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
