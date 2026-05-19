// dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/editable-field.tsx
//
// 16pt textarea/input wrapper with localStorage draft + optimistic save + label.
// Used by all per-platform posting cards to ensure iOS doesn't auto-zoom.

'use client';
import { useLocalStorageDraft } from '@/hooks/use-localstorage-draft';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';

interface Props {
  storageKey: string;
  label: string;
  initialValue: string;
  onSave: (next: string) => Promise<void>;
  minHeight?: number;
  multiline?: boolean;
  placeholder?: string;
  labelNote?: string; // secondary label copy e.g. "(may not appear on IG)"
  readOnly?: boolean;
}

export function EditableField({
  storageKey,
  label,
  initialValue,
  onSave,
  minHeight = 60,
  multiline = true,
  placeholder,
  labelNote,
  readOnly = false,
}: Props) {
  const [local, setLocal, clear] = useLocalStorageDraft(storageKey, initialValue);
  const { update } = useOptimisticSave<string>({ current: local, save: onSave, onSuccess: clear });

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 3 }}>
        {label}
        {labelNote && (
          <span style={{ color: 'var(--ink-400)', marginLeft: 4 }}>{labelNote}</span>
        )}
      </label>
      {multiline ? (
        <textarea
          value={local}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => {
            setLocal(e.target.value);
            update(e.target.value);
          }}
          style={{
            width: '100%',
            minHeight,
            padding: 8,
            fontSize: 16,
            border: '1px solid var(--ink-100)',
            borderRadius: 6,
            background: readOnly ? 'var(--linen-50)' : 'white',
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <input
          type="text"
          value={local}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => {
            setLocal(e.target.value);
            update(e.target.value);
          }}
          style={{
            width: '100%',
            minHeight: 44,
            padding: '8px 10px',
            fontSize: 16,
            border: '1px solid var(--ink-100)',
            borderRadius: 6,
            background: readOnly ? 'var(--linen-50)' : 'white',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}
