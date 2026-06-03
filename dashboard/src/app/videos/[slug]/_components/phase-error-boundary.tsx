'use client';
import { Component, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

// React error boundary for phase components. Catches any unhandled
// render-time exception from server actions, hooks, or component
// bodies and shows a recoverable error card instead of a stuck
// Suspense skeleton.
//
// Recovery: navigate to /videos/{parshaSlug} (NO ?phase query) and
// router.refresh() so shell-data.ts re-resolves the canonical phase
// from server state. If a render error inside ?phase=N is caused by
// phase/state drift (the most common cause on this project), a bare
// window.location.reload() pins Yonah to the same broken ?phase=N
// URL — infinite loop with no escape on iPhone. Stripping the query
// param + a router refresh hands control back to the state machine.
// A small secondary "Or hard reload" link is kept for environmental
// glitches (network blip, transient browser state) where the user
// genuinely does want to reload the same URL.

interface Props {
  children: ReactNode;
  phaseLabel: string;
  parshaSlug: string;
}

interface State {
  error: Error | null;
}

// React error boundaries MUST be class components. The recovery
// button is split into a sibling function component so it can call
// useRouter() from next/navigation.
function ErrorRecoveryActions({ parshaSlug }: { parshaSlug: string }) {
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          router.push(`/videos/${parshaSlug}`);
          router.refresh();
        }}
        style={{
          minHeight: 44,
          padding: '10px 18px',
          fontSize: 14,
          fontWeight: 500,
          background: 'var(--navy-700)',
          color: 'var(--linen-50)',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        Back to this parsha
      </button>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: 12,
          background: 'none',
          border: 'none',
          color: 'var(--ink-500)',
          fontSize: 12,
          textDecoration: 'underline',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        Or hard reload this page
      </button>
    </>
  );
}

export class PhaseErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log to console for the operator's DevTools and any installed
    // error tracking. The full stack lives in componentStack.
    console.error(`[phase-error-boundary] ${this.props.phaseLabel}:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', minHeight: 240, background: 'var(--linen-50)', border: '1px solid var(--tassel)', borderRadius: 'var(--r-lg)', textAlign: 'center' }}>
          <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--tassel)', color: 'white', fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>!</div>
          <div style={{ fontFamily: 'var(--ff-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink-900)', marginBottom: 8 }}>Something went wrong in {this.props.phaseLabel}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 360, lineHeight: 1.5, marginBottom: 16, fontFamily: 'monospace', wordBreak: 'break-word' }}>
            {this.state.error.message.slice(0, 220) || 'No error message available.'}
          </div>
          <ErrorRecoveryActions parshaSlug={this.props.parshaSlug} />
        </div>
      );
    }
    return this.props.children;
  }
}
