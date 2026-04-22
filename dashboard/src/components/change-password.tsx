'use client';

import { useState } from 'react';
import { changePassword } from '@/app/actions/change-password';

type State =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export function ChangePassword() {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const submit = async (e: React.FormEvent) => {
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
    setState({ kind: 'ok' });
    setPw('');
    setConfirm('');
    setTimeout(() => setState({ kind: 'idle' }), 3500);
  };

  const labelStyle = {
    display: 'block',
    fontFamily: 'var(--ff-body)',
    fontWeight: 500,
    fontSize: '11px',
    letterSpacing: '0.16em',
    textTransform: 'uppercase' as const,
    color: 'var(--ink-700)',
    marginBottom: '6px',
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '10px 14px',
    fontFamily: 'var(--ff-body)',
    fontSize: '14px',
    border: '1px solid var(--ink-200)',
    borderRadius: 'var(--r-md)',
    background: 'white',
    outline: 'none',
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 380 }}>
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
          }}
        >
          {state.message}
        </p>
      )}
      {state.kind === 'ok' && (
        <p
          role="status"
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--jade)',
            margin: 0,
          }}
        >
          Password updated. You can sign in with the new password from now on.
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={state.kind === 'saving' || !pw || !confirm}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '14px',
            padding: '10px 22px',
            minHeight: '44px',
            borderRadius: '999px',
            border: '1px solid var(--navy-800)',
            background: state.kind === 'saving' || !pw || !confirm ? 'var(--ink-300)' : 'var(--navy-800)',
            color: 'var(--linen-50)',
            cursor: state.kind === 'saving' ? 'wait' : 'pointer',
          }}
        >
          {state.kind === 'saving' ? 'Saving\u2026' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
