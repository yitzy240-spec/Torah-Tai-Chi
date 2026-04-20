import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Troubleshooting · Help' };

export default function HelpTroubleshooting() {
  return (
    <article>
      <header style={{ marginBottom: '40px' }}>
        <div style={{ fontFamily: 'var(--ff-body)', fontSize: '10.5px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--cedar-600)', marginBottom: '10px' }}>
          Help
        </div>
        <h1 style={{ fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--ink-900)', margin: '0 0 14px', fontVariationSettings: '"opsz" 54, "SOFT" 20' }}>
          What to do when something looks wrong
        </h1>
        <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '16px', color: 'var(--ink-500)', margin: 0, fontVariationSettings: '"opsz" 18, "SOFT" 50' }}>
          Most issues have a quick fix. Start here before calling anyone.
        </p>
      </header>

      <div style={{ fontFamily: 'var(--ff-body)', fontSize: '15.5px', lineHeight: 1.7, color: 'var(--ink-700)', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <Issue
          title="A page shows 'Something didn't load'"
          fix="Click Try again. If it keeps happening, do a full page refresh (Cmd + R on Mac, Ctrl + R on Windows). This clears usually within a minute or two."
        />
        <Issue
          title="The website hasn't updated after I saved a change"
          fix="Wait 30–60 seconds and refresh the website. Changes propagate automatically — they don't need a rebuild. If it's still not showing after two minutes, try opening the website in a private/incognito window."
        />
        <Issue
          title="'Buffer needs reconnect' appears at the top of Today"
          fix={<>Go to <Link href="/settings/buffer" style={{ color: 'var(--cedar-600)' }}>Settings → Buffer</Link> and reconnect the account. Buffer tokens expire occasionally — this is normal.</>}
        />
        <Issue
          title="Video generation seems stuck"
          fix="Generation takes about 45 seconds but can occasionally take up to two minutes. Wait it out. If the progress indicator hasn't moved after three minutes, refresh the page. The video may have completed in the background — check the Videos list."
        />
        <Issue
          title="A post didn't schedule to one platform"
          fix="Check the Channels page for an error message. Often it's a platform-specific issue on Buffer's side. You can reschedule just that platform from the video's scheduling panel."
        />
        <Issue
          title="The Today page shows the wrong parsha"
          fix="The current parsha is detected automatically from the Jewish calendar. If it looks wrong the week before or after a transition, it will correct itself. If it's consistently wrong, email me."
        />
        <Issue
          title="I can't log in"
          fix="Try resetting your password from the login screen. If you don't receive the reset email within five minutes, check your spam folder. Still nothing — email me."
        />
      </div>

      <StuckSection />
    </article>
  );
}

function Issue({ title, fix }: { title: string; fix: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '16px', color: 'var(--ink-900)', marginBottom: '8px', fontVariationSettings: '"opsz" 18, "SOFT" 20' }}>
        {title}
      </div>
      <div style={{ color: 'var(--ink-600)' }}>{fix}</div>
    </div>
  );
}

function StuckSection() {
  return (
    <div style={{ marginTop: '52px', paddingTop: '28px', borderTop: '1px solid var(--ink-100)' }}>
      <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '14px', color: 'var(--ink-500)', margin: '0 0 8px', fontVariationSettings: '"opsz" 14, "SOFT" 60' }}>
        None of these match what you&apos;re seeing?
      </p>
      <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13.5px', color: 'var(--ink-600)', margin: 0 }}>
        Email <a href="mailto:yitzym@fiveblocks.com" style={{ color: 'var(--cedar-600)', textDecoration: 'underline', textDecorationColor: 'var(--cedar-300)', textUnderlineOffset: '3px' }}>yitzym@fiveblocks.com</a> with a brief description of what you were doing and what happened. A screenshot helps but isn&apos;t required.
      </p>
    </div>
  );
}
