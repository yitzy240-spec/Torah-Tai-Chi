import type { Metadata } from 'next';
import { Fraunces, Mona_Sans, Frank_Ruhl_Libre } from 'next/font/google';
import { unstable_cache } from 'next/cache';
import './globals.css';
import { SidebarNav } from '@/components/sidebar-nav';
import { createClient } from '@/lib/supabase/server';

/**
 * Today's English + Hebrew date for the dashboard header. Cached for 4
 * hours per user-locale-day boundary; the Hebrew date only flips at
 * sundown anyway, so a fresh fetch every few hours is plenty.
 *
 * The English date is computed locally; Hebrew comes from Hebcal's
 * free converter endpoint. If Hebcal is unreachable we fall back to
 * just the English date and hide the Hebrew span.
 */
const getTodayDates = unstable_cache(
  async (): Promise<{ english: string; hebrew: string | null }> => {
    const now = new Date();
    const english = now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const url = `https://www.hebcal.com/converter?cfg=json&date=${yyyy}-${mm}-${dd}&g2h=1&strict=1`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return { english, hebrew: null };
      const data = await res.json();
      const raw = (data?.hebrew as string | undefined) ?? null;
      // Hebcal returns e.g. "י״ג בְּאִיָּיר תשפ״ו" with a בְּ prefix on
      // the month and niqqud. Strip the prefix and niqqud to match the
      // dashboard's existing typography ("כ״ז ניסן תשפ״ו" style).
      if (!raw) return { english, hebrew: null };
      const stripped = raw
        .replace(/בְּ?/, '')
        .replace(/[\u0591-\u05C7]/g, '')
        .trim();
      return { english, hebrew: stripped };
    } catch {
      return { english, hebrew: null };
    }
  },
  ['today-dates'],
  { revalidate: 60 * 60 * 4 },
);

const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz', 'SOFT'],
  variable: '--font-fraunces',
  display: 'swap',
});

const monaSans = Mona_Sans({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-mona-sans',
  display: 'swap',
});

const frankRuhlLibre = Frank_Ruhl_Libre({
  subsets: ['latin', 'hebrew'],
  weight: ['300', '400', '500', '700', '900'],
  variable: '--font-frank-ruhl',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Torah Tai Chi',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const isAuthenticated = !!user;
  const userName = user?.user_metadata?.name ?? user?.email ?? '';
  const userInitial = userName ? userName.charAt(0).toUpperCase() : 'Y';
  const { english: todayEnglish, hebrew: todayHebrew } = await getTodayDates();

  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${monaSans.variable} ${frankRuhlLibre.variable}`}
        style={{ margin: 0, padding: 0 }}
      >
        {isAuthenticated ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '236px 1fr',
              minHeight: '100vh',
              position: 'relative', // anchor for absolute-positioned modals (stance sheet)
            }}
            className="authenticated-shell"
          >
            <SidebarNav />
            <main
              style={{
                padding: '30px 56px 120px',
                maxWidth: '1080px',
              }}
              className="main-content"
            >
              {/* Top bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '28px',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontSize: '13px',
                    fontStyle: 'italic',
                    color: 'var(--ink-500)',
                    fontVariationSettings: '"opsz" 14, "SOFT" 30',
                  }}
                >
                  {todayEnglish}
                  {todayHebrew && (
                    <span
                      lang="he"
                      dir="rtl"
                      className="hidden sm:inline"
                      style={{
                        fontFamily: 'var(--ff-hebrew)',
                        fontStyle: 'normal',
                        color: 'var(--ink-700)',
                        marginLeft: '8px',
                        paddingLeft: '10px',
                        borderLeft: '1px solid var(--ink-200)',
                      }}
                    >
                      {todayHebrew}
                    </span>
                  )}
                </div>
                <div
                  title={userName}
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    background: 'var(--navy-800)',
                    color: 'var(--linen-50)',
                    display: 'grid',
                    placeItems: 'center',
                    fontFamily: 'var(--ff-display)',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {userInitial}
                </div>
              </div>

              {children}
            </main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
