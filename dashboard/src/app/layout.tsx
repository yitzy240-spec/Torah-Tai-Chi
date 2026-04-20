import type { Metadata } from 'next';
import { Fraunces, Mona_Sans, Frank_Ruhl_Libre } from 'next/font/google';
import './globals.css';
import { SidebarNav } from '@/components/sidebar-nav';
import { createClient } from '@/lib/supabase/server';

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
                  Thursday, April 16
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
                    כ״ז ניסן תשפ״ו
                  </span>
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
