'use client';
import { useActionState } from 'react';
import { requestLoginLink } from '@/app/actions/request-login-link';

// ---------------------------------------------------------------------------
// State shape for useActionState.
// Server action `requestLoginLink(email, redirectTo)` is kept untouched; we
// adapt the (prevState, formData) signature here on the client so the magic-
// link flow itself is unchanged.
// ---------------------------------------------------------------------------
type LoginState =
  | { status: 'idle' }
  | { status: 'sent'; email: string }
  | { status: 'error'; message: string; email: string };

const initialState: LoginState = { status: 'idle' };

async function submitLogin(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) {
    return { status: 'error', message: 'Please enter your email.', email };
  }
  // window is available — useActionState in a client component posts via JS,
  // so the server action runs and the callback computed here is fine.
  const redirectTo = `${window.location.origin}/auth/callback`;
  const result = await requestLoginLink(email, redirectTo);
  if (result.error) {
    return { status: 'error', message: result.error, email };
  }
  return { status: 'sent', email };
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(submitLogin, initialState);

  const sent = state.status === 'sent';
  const errorMessage = state.status === 'error' ? state.message : null;
  const lastEmail = state.status === 'sent' ? state.email : undefined;

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        // Anchor card high on desktop (~35% from top). Mobile falls back to a
        // tighter top padding via the media-query rule in globals.css so the
        // field is within thumb reach without excessive scroll.
        paddingTop: 'max(10vh, 64px)',
        paddingBottom: '48px',
        paddingLeft: '24px',
        paddingRight: '24px',
        background: 'var(--linen-50)',
      }}
      className="tt-login-main"
    >
      {/* Brand mark above the card — gives this internal tool a clear
          orientation cue (dash-login-5, -7 on tier3). */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '28px',
        }}
      >
        <LoginBrandMark />
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '17px',
            letterSpacing: '-0.003em',
            color: 'var(--ink-900)',
          }}
        >
          Torah&nbsp;Tai&nbsp;Chi
        </div>
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '10.5px',
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: 'var(--cedar-600)',
          }}
        >
          Studio admin
        </div>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '40px 40px 36px',
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--ink-200)',
          background: 'var(--linen-50)',
          boxShadow: '0 30px 80px -40px rgba(35,27,16,.28), 0 1px 0 rgba(35,27,16,.04)',
        }}
        className="tt-login-card"
      >
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(26px, 3.4vw, 34px)',
            lineHeight: 1.08,
            letterSpacing: '-0.02em',
            margin: '0 0 8px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 40, "SOFT" 30',
          }}
        >
          Root before you{' '}
          <em
            style={{
              fontStyle: 'italic',
              color: 'var(--ink-500)',
              fontVariationSettings: '"opsz" 40, "SOFT" 60',
            }}
          >
            rise.
          </em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '14px',
            color: 'var(--ink-700)',
            margin: '0 0 28px 0',
            lineHeight: 1.55,
          }}
        >
          Sign in to the studio. We&apos;ll email you a single-use link — no
          password to remember.
        </p>

        {/* aria-live region for status announcements — announces the success
            state or any inline error to screen readers (dash-login-4, -9). */}
        <div aria-live="polite" aria-atomic="true">
          {sent && lastEmail && (
            <div
              role="status"
              style={{
                padding: '18px 20px',
                borderRadius: 'var(--r-md)',
                background: 'var(--navy-wash)',
                border: '1px solid var(--navy-100)',
                fontFamily: 'var(--ff-body)',
                fontSize: '14px',
                color: 'var(--ink-700)',
                lineHeight: 1.55,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontWeight: 500,
                  fontSize: '17px',
                  color: 'var(--ink-900)',
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: 'var(--jade)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--linen-50)',
                    flexShrink: 0,
                  }}
                >
                  <svg
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ width: '12px', height: '12px' }}
                  >
                    <path d="M2.5 6.2l2.4 2.3 4.6-4.8" />
                  </svg>
                </span>
                Check your email
              </div>
              <div>
                Magic link sent to{' '}
                <strong style={{ fontWeight: 500, color: 'var(--ink-900)' }}>
                  {lastEmail}
                </strong>
                . It expires in an hour.
              </div>
            </div>
          )}
        </div>

        {!sent && (
          <form
            action={formAction}
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
            noValidate
          >
            <div>
              <label
                htmlFor="email"
                style={{
                  display: 'block',
                  fontFamily: 'var(--ff-body)',
                  fontWeight: 500,
                  fontSize: '11px',
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-700)',
                  marginBottom: '8px',
                }}
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={
                  state.status === 'error' ? state.email : ''
                }
                placeholder="you@torahtaichi.com"
                autoComplete="email"
                autoFocus
                disabled={pending}
                aria-invalid={errorMessage ? true : undefined}
                aria-describedby={errorMessage ? 'login-error' : 'login-privacy'}
                className="tt-login-input"
              />
            </div>

            {errorMessage && (
              <p
                id="login-error"
                role="alert"
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontSize: '13px',
                  color: '#B23A2B' /* --tassel */,
                  margin: 0,
                  lineHeight: 1.45,
                }}
              >
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              className="tt-login-submit"
            >
              {pending ? (
                <>
                  <Spinner />
                  <span>Sending…</span>
                </>
              ) : (
                <span>Send sign-in link</span>
              )}
            </button>

            <p
              id="login-privacy"
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '12.5px',
                color: 'var(--ink-500)',
                margin: '2px 0 0 0',
                lineHeight: 1.5,
                textAlign: 'center',
              }}
            >
              We&apos;ll only email you the sign-in link. Nothing else.
            </p>
          </form>
        )}
      </div>

      {/* Escape hatch — so a stuck user isn't dead-ended (dash-login-7, -8). */}
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '13px',
          color: 'var(--ink-500)',
          margin: '24px 0 0 0',
          lineHeight: 1.5,
          textAlign: 'center',
          fontVariationSettings: '"opsz" 14, "SOFT" 60',
        }}
      >
        Need access, or the email never arrived?{' '}
        <a
          href="mailto:yitzy@torahtaichi.com?subject=Torah%20Tai%20Chi%20dashboard%20access"
          style={{
            color: 'var(--navy-800)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            textDecorationColor: 'var(--navy-300)',
            fontStyle: 'normal',
          }}
        >
          Ask Yitzy
        </a>
        .
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Pending-state spinner. Inline SVG so no asset dependency.
// ---------------------------------------------------------------------------
function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{
        width: '14px',
        height: '14px',
        animation: 'tt-spin 900ms linear infinite',
        flexShrink: 0,
      }}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="28"
        strokeDashoffset="18"
        opacity="0.9"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Brand mark — inline copy of the sidebar BrandMark with unique gradient IDs
// to avoid clashes if this ever renders alongside the authenticated shell.
// ---------------------------------------------------------------------------
function LoginBrandMark() {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      style={{ width: '52px', height: '52px', flexShrink: 0 }}
    >
      <defs>
        <radialGradient id="cedarWood-lg" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#E3B888" />
          <stop offset="45%" stopColor="#B8823A" />
          <stop offset="100%" stopColor="#6A4622" />
        </radialGradient>
        <radialGradient id="linenLobe-lg" cx="40%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#FAF4E8" />
          <stop offset="100%" stopColor="#E9DDC1" />
        </radialGradient>
        <radialGradient id="navyLobe-lg" cx="60%" cy="60%" r="80%">
          <stop offset="0%" stopColor="#2B3A5C" />
          <stop offset="100%" stopColor="#131E38" />
        </radialGradient>
        <path id="arcTop-lg" d="M 18,60 A 42,42 0 0,1 102,60" />
      </defs>
      <circle
        cx="60"
        cy="60"
        r="42"
        fill="url(#cedarWood-lg)"
        stroke="#3D2A14"
        strokeWidth="0.8"
      />
      <circle
        cx="60"
        cy="60"
        r="34"
        fill="none"
        stroke="#3D2A14"
        strokeWidth="0.4"
        opacity="0.5"
      />
      <g transform="translate(60 60)">
        <circle r="28" fill="url(#linenLobe-lg)" />
        <path
          d="M 0,-28 A 28,28 0 0,0 0,28 A 14,14 0 0,1 0,0 A 14,14 0 0,0 0,-28 Z"
          fill="url(#navyLobe-lg)"
        />
        <circle cx="0" cy="-14" r="3.2" fill="#FAF4E8" />
        <circle cx="0" cy="14" r="3.2" fill="#2B3A5C" />
        <g transform="translate(0,-14) scale(0.55)">
          <polygon
            points="0,-8 6.93,4 -6.93,4"
            fill="none"
            stroke="#9E7A3A"
            strokeWidth="1.2"
          />
          <polygon
            points="0,8 6.93,-4 -6.93,-4"
            fill="none"
            stroke="#9E7A3A"
            strokeWidth="1.2"
          />
        </g>
      </g>
      <text
        fontFamily="Fraunces, serif"
        fontSize="9"
        fontWeight="600"
        letterSpacing="3"
        fill="#3D2A14"
      >
        <textPath href="#arcTop-lg" startOffset="50%" textAnchor="middle">
          TORAH
        </textPath>
      </text>
      <text
        x="60"
        y="108"
        fontFamily="Fraunces, serif"
        fontSize="8"
        fontWeight="600"
        letterSpacing="3"
        fill="#3D2A14"
        textAnchor="middle"
      >
        TAI CHI
      </text>
    </svg>
  );
}
