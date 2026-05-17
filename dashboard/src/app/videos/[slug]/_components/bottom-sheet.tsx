// dashboard/src/app/videos/[slug]/_components/bottom-sheet.tsx
//
// Mobile-first bottom sheet using Base UI's Dialog as the substrate.
// Drag-down dismiss is handled by Base UI's click-outside / Escape
// dismissal (Dialog.Root onOpenChange). Primary action sits at the
// bottom for thumb reach. Used for destructive confirms ("Replace with
// a new version", "Edit on TikTok"). Per spec §7.
//
// The 36×4px ink-200 pill at the top is the standard drag-handle cue.
// Safe-area-inset-bottom padding ensures the action bar clears the
// iPhone home indicator.

'use client';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode; // body content
  primaryAction: { label: string; onClick: () => void; destructive?: boolean };
  secondaryAction?: { label: string; onClick: () => void };
}

export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  primaryAction,
  secondaryAction,
}: Props) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 50,
          }}
        />
        <DialogPrimitive.Popup
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 51,
            background: 'var(--linen-50)',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            padding: '20px 20px max(20px, env(safe-area-inset-bottom))',
            maxHeight: '85vh',
            overflowY: 'auto',
          }}
        >
          {/* Drag handle */}
          <div
            style={{
              width: 36,
              height: 4,
              background: 'var(--ink-200)',
              borderRadius: 2,
              margin: '0 auto 16px',
            }}
          />

          <DialogPrimitive.Title
            style={{
              fontSize: 18,
              fontWeight: 500,
              margin: '0 0 12px',
              fontFamily: 'var(--ff-display)',
              color: 'var(--ink-900)',
            }}
          >
            {title}
          </DialogPrimitive.Title>

          <div
            style={{
              fontSize: 14,
              color: 'var(--ink-700)',
              lineHeight: 1.5,
              marginBottom: 20,
            }}
          >
            {children}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              onClick={primaryAction.onClick}
              style={{
                width: '100%',
                minHeight: 48,
                fontSize: 15,
                fontWeight: 500,
                background: primaryAction.destructive ? 'var(--tassel)' : 'var(--navy-700)',
                color: 'var(--linen-50)',
                border: 'none',
                borderRadius: 10,
                padding: '14px',
                cursor: 'pointer',
              }}
            >
              {primaryAction.label}
            </button>

            {secondaryAction && (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                style={{
                  width: '100%',
                  minHeight: 44,
                  fontSize: 14,
                  background: 'transparent',
                  color: 'var(--ink-700)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {secondaryAction.label}
              </button>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
