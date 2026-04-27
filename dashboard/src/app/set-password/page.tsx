'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { changePassword } from '@/app/actions/change-password';

type State =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string };

export default function SetPasswordPage() {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) {
      setState({ kind: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }
    if (pw !== confirm) {
      setState({ kind: 'error', message: 'Passwords don\u2019t match.' });
      return;
    }
    setState({ kind: 'saving' });
    const res = await changePassword(pw);
    if (res.error) {
      setState({ kind: 'error', message: res.error });
      return;
    }
    router.replace('/');
    router.refresh();
  }

  const labelStyle = {
    display: 'block',
    fontFamily: 'var(--ff-body)',
    fontWeight: 500,
    fontSize: '11px',
    letterSpacing: '0.16em',
    textTransform: 'uppercase' as const,
    color: 'var(--ink-700)',
    marginBottom: '8px',
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '12px 14px',
    minHeight: '44px',
    fontFamily: 'var(--ff-body)',
    fontSize: '14px',
    color: 'var(--ink-900)',
    background: 'var(--linen-50)',
    border: '1px solid var(--ink-200)',
    borderRadius: 'var(--r-md)',
    outline: 'none',
  };

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 'clamp(64px, 22vh, 220px)',
        paddingBottom: '48px',
        paddingLeft: '24px',
        paddingRight: '24px',
        background: 'var(--linen-50)',
      }}
    >
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
      >
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(24px, 3vw, 30px)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: '0 0 8px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 32, "SOFT" 30',
          }}
        >
          Choose a new password
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '14px',
            color: 'var(--ink-700)',
            margin: '0 0 24px 0',
            lineHeight: 1.55,
          }}
        >
          Enter a new password below. You\u2019ll use this from now on to sign in.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label htmlFor="new-password" style={labelStyle}>New password</label>
            <input
              id="new-password"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              autoFocus
              disabled={state.kind === 'saving'}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="confirm-password" style={labelStyle}>Confirm new password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={state.kind === 'saving'}
              style={inputStyle}
            />
          </div>
          {state.kind === 'error' && (
            <p
              role="alert"
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '13px',
                color: '#B23A2B',
                margin: 0,
                lineHeight: 1.45,
              }}
            >
              {state.message}
            </p>
          )}
          <button
            type="submit"
            disabled={state.kind === 'saving' || !pw || !confirm}
            style={{
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: '14px',
              padding: '12px 22px',
              minHeight: '46px',
              borderRadius: '999px',
              border: '1px solid var(--navy-800)',
              background:
                state.kind === 'saving' || !pw || !confirm ? 'var(--ink-300)' : 'var(--navy-800)',
              color: 'var(--linen-50)',
              cursor: state.kind === 'saving' ? 'wait' : 'pointer',
            }}
          >
            {state.kind === 'saving' ? 'Saving\u2026' : 'Save and continue'}
          </button>
        </form>
      </div>
    </main>
  );
}
