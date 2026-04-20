import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Help · Torah Tai Chi Dashboard' };

const ARTICLES = [
  {
    href: '/help/publish-article',
    title: 'How to publish a new article',
    summary: 'Write and publish a piece to the Writings section of the website.',
    category: 'Content',
  },
  {
    href: '/help/edit-homepage',
    title: 'How to change the hero text or any site wording',
    summary: 'Update the words that appear on the homepage, About page, and everywhere else.',
    category: 'Content',
  },
  {
    href: '/help/generate-video',
    title: 'How to produce this week\'s video',
    summary: 'Approve the script and kick off video generation — from script to ready-to-post.',
    category: 'Video',
  },
  {
    href: '/help/stance',
    title: 'What the four stances mean and how to change them',
    summary: 'Reviewer, Creator, Scheduler, and Analyst — understanding the Today page views.',
    category: 'Dashboard',
  },
  {
    href: '/help/schedule-posts',
    title: 'How to schedule posts to all channels',
    summary: 'Send the finished video to TikTok, Instagram, YouTube, and Facebook in one step.',
    category: 'Publishing',
  },
  {
    href: '/help/troubleshooting',
    title: 'What to do when something looks wrong',
    summary: 'Common issues and quick fixes — before you need to call anyone.',
    category: 'Help',
  },
];

const CATEGORIES = ['Content', 'Video', 'Publishing', 'Dashboard', 'Help'];

export default function HelpPage() {
  return (
    <div style={{ maxWidth: '760px' }}>
      <header style={{ marginBottom: '52px' }}>
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '10.5px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--cedar-600)',
            marginBottom: '12px',
          }}
        >
          Help centre
        </div>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(32px, 5vw, 52px)',
            lineHeight: 1,
            letterSpacing: '-0.025em',
            color: 'var(--ink-900)',
            margin: '0 0 14px',
            fontVariationSettings: '"opsz" 72, "SOFT" 20',
          }}
        >
          How can we help?
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '17px',
            color: 'var(--ink-500)',
            margin: 0,
            fontVariationSettings: '"opsz" 18, "SOFT" 50',
          }}
        >
          Short guides for the things you do most often.
        </p>
      </header>

      {CATEGORIES.map((cat) => {
        const items = ARTICLES.filter((a) => a.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat} style={{ marginBottom: '44px' }}>
            <h2
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '10.5px',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--cedar-500)',
                margin: '0 0 14px',
              }}
            >
              {cat}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {items.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  style={{
                    display: 'block',
                    padding: '18px 22px',
                    border: '1px solid var(--ink-100)',
                    borderRadius: 'var(--r-lg)',
                    background: 'var(--linen-50)',
                    textDecoration: 'none',
                    transition: 'border-color var(--trans)',
                  }}
                  className="help-card"
                >
                  <div
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontWeight: 500,
                      fontSize: '15.5px',
                      color: 'var(--ink-900)',
                      marginBottom: '5px',
                      fontVariationSettings: '"opsz" 18, "SOFT" 20',
                    }}
                  >
                    {a.title}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                      fontSize: '13.5px',
                      color: 'var(--ink-500)',
                      fontVariationSettings: '"opsz" 14, "SOFT" 50',
                    }}
                  >
                    {a.summary}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
