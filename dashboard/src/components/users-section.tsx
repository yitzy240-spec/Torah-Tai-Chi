'use client';

import { useState, useTransition } from 'react';
import { addUser, removeUser, type ProvisionedUser } from '@/app/actions/manage-users';

interface UsersSectionProps {
  initialUsers: ProvisionedUser[];
}

function formatJoined(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const DEFAULT_NEW_PASSWORD = 'TorahTC1';

export function UsersSection({ initialUsers }: UsersSectionProps) {
  const [users, setUsers] = useState(initialUsers);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState(DEFAULT_NEW_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addUser(email, name || undefined, password);
      if (result.error) { setError(result.error); return; }
      // Optimistic add; revalidatePath() in the action will sync on next nav
      setUsers((prev) => [
        ...prev,
        {
          id: `pending-${Date.now()}`,
          email: email.trim().toLowerCase(),
          name: name.trim() || null,
          createdAt: new Date().toISOString(),
          isSelf: false,
        },
      ]);
      setEmail('');
      setName('');
      setPassword(DEFAULT_NEW_PASSWORD);
    });
  }

  function handleRemove(user: ProvisionedUser) {
    if (!confirm(`Remove ${user.email}? They will immediately lose access.`)) return;
    setError(null);
    setRemovingId(user.id);
    startTransition(async () => {
      const result = await removeUser(user.id);
      if (result.error) {
        setError(result.error);
        setRemovingId(null);
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setRemovingId(null);
    });
  }

  return (
    <div>
      {/* User list */}
      <div style={{ marginBottom: '24px' }}>
        {users.length === 0 ? (
          <p
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '13.5px',
              color: 'var(--ink-400)',
              margin: 0,
            }}
          >
            No users yet.
          </p>
        ) : (
          users.map((u) => (
            <div
              key={u.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '14px 0',
                borderBottom: '1px dotted var(--ink-100)',
                minHeight: '44px',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'var(--ink-100)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--ink-500)',
                  flexShrink: 0,
                  textTransform: 'uppercase',
                }}
              >
                {(u.name?.[0] || u.email[0] || '?').toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontWeight: 500,
                    fontSize: '15px',
                    color: 'var(--ink-900)',
                    fontVariationSettings: '"opsz" 18, "SOFT" 20',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {u.name || u.email}
                  {u.isSelf && (
                    <span
                      style={{
                        marginLeft: '8px',
                        fontFamily: 'var(--ff-body)',
                        fontSize: '10.5px',
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        color: 'var(--ink-400)',
                        fontWeight: 400,
                      }}
                    >
                      You
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontStyle: 'italic',
                    fontSize: '12.5px',
                    color: 'var(--ink-400)',
                    marginTop: '2px',
                    fontVariationSettings: '"opsz" 14, "SOFT" 50',
                  }}
                >
                  {u.name ? `${u.email} · joined ${formatJoined(u.createdAt)}` : `Joined ${formatJoined(u.createdAt)}`}
                </div>
              </div>
              {!u.isSelf && (
                <button
                  type="button"
                  onClick={() => handleRemove(u)}
                  disabled={isPending && removingId === u.id}
                  style={{
                    fontFamily: 'var(--ff-body)',
                    fontSize: '13px',
                    color: 'var(--tassel)',
                    background: 'transparent',
                    border: 'none',
                    cursor: isPending && removingId === u.id ? 'wait' : 'pointer',
                    padding: '8px 12px',
                    opacity: isPending && removingId === u.id ? 0.5 : 1,
                    transition: 'opacity var(--trans)',
                  }}
                >
                  {isPending && removingId === u.id ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add user form */}
      <form
        onSubmit={handleAdd}
        style={{
          padding: '18px 20px',
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-md)',
          background: 'var(--linen-50)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '15px',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 18, "SOFT" 20',
          }}
        >
          Add user
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '10px', alignItems: 'start' }}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@torahtaichi.com"
            autoComplete="off"
            style={{
              padding: '10px 14px',
              minHeight: '44px',
              fontFamily: 'var(--ff-body)',
              fontSize: '14px',
              color: 'var(--ink-900)',
              background: 'var(--linen-50)',
              border: '1px solid var(--ink-200)',
              borderRadius: 'var(--r-md)',
              outline: 'none',
              transition: 'border-color var(--trans)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--navy-800)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--ink-200)')}
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            autoComplete="off"
            style={{
              padding: '10px 14px',
              minHeight: '44px',
              fontFamily: 'var(--ff-body)',
              fontSize: '14px',
              color: 'var(--ink-900)',
              background: 'var(--linen-50)',
              border: '1px solid var(--ink-200)',
              borderRadius: 'var(--r-md)',
              outline: 'none',
              transition: 'border-color var(--trans)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--navy-800)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--ink-200)')}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'start' }}>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Starting password (min 8 chars)"
            autoComplete="off"
            spellCheck={false}
            style={{
              padding: '10px 14px',
              minHeight: '44px',
              fontFamily: 'var(--ff-body)',
              fontSize: '14px',
              color: 'var(--ink-900)',
              background: 'var(--linen-50)',
              border: '1px solid var(--ink-200)',
              borderRadius: 'var(--r-md)',
              outline: 'none',
              transition: 'border-color var(--trans)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--navy-800)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--ink-200)')}
          />
          <button
            type="submit"
            disabled={isPending || !email || password.length < 8}
            style={{
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: '14px',
              padding: '11px 22px',
              minHeight: '44px',
              borderRadius: '999px',
              border: '1px solid var(--navy-800)',
              background: isPending || !email || password.length < 8 ? 'var(--ink-300)' : 'var(--navy-800)',
              color: 'var(--linen-50)',
              cursor: isPending || !email || password.length < 8 ? 'not-allowed' : 'pointer',
              transition: 'all var(--trans)',
              boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
              whiteSpace: 'nowrap',
            }}
          >
            {isPending && !removingId ? 'Adding…' : 'Add user'}
          </button>
        </div>
        {error && (
          <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--tassel)', margin: 0 }}>
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
