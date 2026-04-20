/**
 * Shared route-level loading UI. Next.js shows this immediately on any
 * client-side navigation while the destination page's server work resolves —
 * without it, clicks feel unresponsive because the browser holds the old
 * page visible until the new page's SSR completes.
 */
export default function Loading() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 20px',
        gap: '14px',
      }}
      aria-busy="true"
      aria-label="Loading"
    >
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          border: '2px solid var(--ink-100)',
          borderTopColor: 'var(--cedar-500)',
          animation: 'tt-spin 0.9s linear infinite',
        }}
      />
      <div
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '13px',
          color: 'var(--ink-400)',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        Loading…
      </div>
    </div>
  );
}
