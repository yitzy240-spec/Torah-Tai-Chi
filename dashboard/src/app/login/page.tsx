'use client';
import { useState } from 'react';
import { requestLoginLink } from '@/app/actions/request-login-link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await requestLoginLink(
      email,
      `${window.location.origin}/auth/callback`,
    );
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setSent(true);
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: 'var(--linen-50)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '48px 44px',
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--ink-100)',
          background: 'var(--linen-50)',
          boxShadow: '0 30px 80px -40px rgba(35,27,16,.25)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '10.5px',
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: 'var(--cedar-600)',
            marginBottom: '14px',
          }}
        >
          Torah Tai Chi · admin
        </div>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(30px, 4vw, 40px)',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            margin: '0 0 10px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 48, "SOFT" 30',
          }}
        >
          Root before you <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 48, "SOFT" 60' }}>rise.</em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '15px',
            color: 'var(--ink-500)',
            margin: '0 0 32px 0',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
            lineHeight: 1.5,
          }}
        >
          Sign in to the studio. We&apos;ll email you a single-use link — no password to remember.
        </p>

        {sent ? (
          <div
            style={{
              padding: '18px 20px',
              borderRadius: 'var(--r-md)',
              background: 'var(--navy-wash)',
              border: '1px solid var(--ink-100)',
              fontFamily: 'var(--ff-body)',
              fontSize: '14px',
              color: 'var(--ink-700)',
              lineHeight: 1.55,
            }}
          >
            <div style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '16px', color: 'var(--ink-900)', marginBottom: '4px' }}>
              Check your inbox.
            </div>
            We sent a sign-in link to <strong style={{ fontWeight: 500 }}>{email}</strong>. It expires in an hour.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label
                htmlFor="email"
                style={{
                  display: 'block',
                  fontFamily: 'var(--ff-body)',
                  fontSize: '10.5px',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-500)',
                  marginBottom: '8px',
                }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@torahtaichi.com"
                autoComplete="email"
                autoFocus
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  minHeight: '44px',
                  fontFamily: 'var(--ff-body)',
                  fontSize: '15px',
                  color: 'var(--ink-900)',
                  background: 'var(--linen-50)',
                  border: '1px solid var(--ink-200)',
                  borderRadius: 'var(--r-md)',
                  outline: 'none',
                  transition: 'all var(--trans)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--navy-800)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--ink-200)')}
              />
            </div>
            {error && (
              <p
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontSize: '13px',
                  color: '#b91c1c',
                  margin: 0,
                }}
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !email}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontFamily: 'var(--ff-body)',
                fontWeight: 500,
                fontSize: '14px',
                padding: '12px 24px',
                minHeight: '44px',
                borderRadius: '999px',
                border: '1px solid var(--navy-800)',
                background: loading || !email ? 'var(--ink-300)' : 'var(--navy-800)',
                color: 'var(--linen-50)',
                cursor: loading || !email ? 'not-allowed' : 'pointer',
                transition: 'all var(--trans)',
                boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
              }}
            >
              {loading ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
