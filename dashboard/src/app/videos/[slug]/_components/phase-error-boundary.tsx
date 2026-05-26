'use client';
import { Component, type ReactNode } from 'react';

// React error boundary for phase components. Catches any unhandled
// render-time exception from server actions, hooks, or component
// bodies and shows a recoverable error card instead of a stuck
// Suspense skeleton. Reload picks up wherever state actually is.

interface Props {
  children: ReactNode;
  phaseLabel: string;
}

interface State {
  error: Error | null;
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
          <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 44, padding: '10px 18px', fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            Reload this page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
