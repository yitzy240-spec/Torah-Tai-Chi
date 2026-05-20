'use client';

import { useState, useRef, useCallback } from 'react';

interface SiteContentRow {
  id: string;
  key: string;
  value: string;
  description: string | null;
  updated_at: string | null;
}

interface FieldState {
  value: string;
  /** Last value successfully published to Storyblok. Drives the dirty
   *  comparison — comparing against the prop's row.value would freeze on
   *  the initial server-fetched string and ignore subsequent saves, so
   *  a revert to the original after a save couldn't trigger another save. */
  savedValue: string;
  saving: boolean;
  error: string | null;
}

function groupByPrefix(rows: SiteContentRow[]) {
  const groups: Record<string, SiteContentRow[]> = {
    Home: [],
    About: [],
    Footer: [],
    Other: [],
  };
  for (const row of rows) {
    if (row.key.startsWith('home.')) groups.Home.push(row);
    else if (row.key.startsWith('about.')) groups.About.push(row);
    else if (row.key.startsWith('footer.')) groups.Footer.push(row);
    else groups.Other.push(row);
  }
  return groups;
}

export function SiteContentEditor({ initialRows }: { initialRows: SiteContentRow[] }) {
  const [fields, setFields] = useState<Record<string, FieldState>>(() => {
    const m: Record<string, FieldState> = {};
    for (const row of initialRows) {
      const v = row.value ?? '';
      m[row.key] = { value: v, savedValue: v, saving: false, error: null };
    }
    return m;
  });

  // Toast state
  const [toast, setToast] = useState<{ key: string; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(key: string, msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ key, msg });
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  const handleChange = useCallback((key: string, value: string) => {
    setFields((prev) => ({
      ...prev,
      [key]: { ...prev[key], value, error: null },
    }));
  }, []);

  const handleSave = useCallback(async (key: string) => {
    const field = fields[key];
    if (!field || field.saving) return;

    setFields((prev) => ({ ...prev, [key]: { ...prev[key], saving: true, error: null } }));

    const RETRY_DELAYS = [200, 1000];
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('/api/site-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value: field.value }),
        });

        if (res.status >= 500 && attempt < 2) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(body.error ?? 'Save failed');
        }

        setFields((prev) => ({
          ...prev,
          [key]: { ...prev[key], saving: false, savedValue: prev[key].value },
        }));
        showToast(key, 'Saved.');
        return;
      } catch (e) {
        lastError = e;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        }
      }
    }

    const msg = lastError instanceof Error
      ? `${lastError.message} — check your connection and try again`
      : 'Save failed — check your connection and try again';
    setFields((prev) => ({
      ...prev,
      [key]: { ...prev[key], saving: false, error: msg },
    }));
  }, [fields]);

  const groups = groupByPrefix(initialRows);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '48px', position: 'relative' }}>
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '32px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--navy-800)',
            color: 'var(--linen-50)',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13.5px',
            padding: '10px 24px',
            borderRadius: '999px',
            boxShadow: '0 4px 20px rgba(19,30,56,.3)',
            zIndex: 100,
            pointerEvents: 'none',
          }}
        >
          {toast.msg}
        </div>
      )}

      {Object.entries(groups).map(([groupName, rows]) => {
        if (rows.length === 0) return null;
        return (
          <section key={groupName}>
            <h2
              style={{
                fontFamily: 'var(--ff-display)',
                fontWeight: 500,
                fontSize: '11px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--cedar-500)',
                margin: '0 0 16px 0',
                fontVariationSettings: '"opsz" 12, "SOFT" 20',
              }}
            >
              {groupName}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {rows.map((row) => {
                const initial = row.value ?? '';
                const field = fields[row.key] ?? { value: initial, savedValue: initial, saving: false, error: null };
                const isDirty = field.value !== field.savedValue && !field.saving;

                return (
                  <FieldCard
                    key={row.key}
                    row={row}
                    field={field}
                    isDirty={isDirty}
                    onChange={(v) => handleChange(row.key, v)}
                    onSave={() => handleSave(row.key)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface FieldCardProps {
  row: SiteContentRow;
  field: FieldState;
  isDirty: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

function FieldCard({ row, field, isDirty, onChange, onSave }: FieldCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 400) + 'px';
  }

  return (
    <div
      style={{
        border: `1px solid ${isDirty ? 'var(--cedar-300)' : 'var(--ink-100)'}`,
        borderRadius: 'var(--r-lg)',
        padding: '18px 20px 16px',
        background: 'var(--linen-50)',
        transition: 'border-color var(--trans)',
        position: 'relative',
      }}
    >
      {/* Status indicator */}
      <div
        style={{
          position: 'absolute',
          top: '14px',
          right: '16px',
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '11.5px',
          color: isDirty ? 'var(--cedar-500)' : 'var(--ink-500)',
          fontVariationSettings: '"opsz" 12, "SOFT" 50',
        }}
      >
        {field.saving ? 'Saving\u2026' : isDirty ? 'Unsaved' : 'Saved'}
      </div>

      {/* Key label */}
      <div
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: '10.5px',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--cedar-600)',
          marginBottom: '4px',
        }}
      >
        {row.key}
      </div>

      {/* Description */}
      {row.description && (
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '12.5px',
            color: 'var(--ink-500)',
            marginBottom: '10px',
            fontVariationSettings: '"opsz" 13, "SOFT" 50',
          }}
        >
          {row.description}
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={field.value}
        onChange={(e) => {
          onChange(e.target.value);
          autoResize(e.target);
        }}
        rows={2}
        style={{
          width: '100%',
          minHeight: '60px',
          maxHeight: '400px',
          resize: 'none',
          fontFamily: 'var(--ff-body)',
          fontSize: '14px',
          lineHeight: 1.6,
          color: 'var(--ink-900)',
          background: 'white',
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-md)',
          padding: '10px 12px',
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border-color var(--trans)',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = 'var(--cedar-400)';
          autoResize(e.target);
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'var(--ink-100)';
        }}
      />

      {/* Error */}
      {field.error && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--tassel)',
            marginTop: '6px',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
          }}
        >
          {field.error}
        </div>
      )}

      {/* Save button row */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
        <button
          type="button"
          disabled={!isDirty || field.saving}
          onClick={onSave}
          style={{
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '13px',
            padding: '9px 20px',
            minHeight: '44px',
            borderRadius: '999px',
            border: 'none',
            background: isDirty ? 'var(--navy-800)' : 'var(--ink-100)',
            color: isDirty ? 'var(--linen-50)' : 'var(--ink-400)',
            cursor: isDirty ? 'pointer' : 'default',
            transition: 'all var(--trans)',
          }}
        >
          {field.saving ? 'Saving\u2026' : 'Save'}
        </button>
      </div>
    </div>
  );
}
