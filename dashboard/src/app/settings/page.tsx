import { StanceToggle } from '@/components/stance-toggle';
import { DefaultQualitySection } from '@/components/default-quality-section';
import { UsersSection } from '@/components/users-section';
import { ChangePassword } from '@/components/change-password';
import { createClient } from '@/lib/supabase/server';
import { listUsers } from '@/app/actions/manage-users';
import { getStance, type Stance } from '@/lib/stance';

// Visual-only toggle component (no interactivity needed here)
function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <div
      role="switch"
      aria-checked={on}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '999px',
        background: on ? 'var(--jade)' : 'var(--ink-200)',
        position: 'relative',
        cursor: 'default',
        flexShrink: 0,
        transition: 'background var(--trans)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: 'white',
          top: '3px',
          left: on ? undefined : '3px',
          right: on ? '3px' : undefined,
          boxShadow: '0 1px 3px rgba(0,0,0,.15)',
          transition: 'transform var(--trans)',
        }}
      />
    </div>
  );
}

const SECTION_STYLE: React.CSSProperties = {
  marginBottom: '40px',
  paddingBottom: '36px',
  borderBottom: '1px solid var(--ink-100)',
};

const H2_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-display)',
  fontWeight: 500,
  fontSize: '20px',
  letterSpacing: '-0.015em',
  margin: '0 0 6px 0',
  color: 'var(--ink-900)',
  fontVariationSettings: '"opsz" 36, "SOFT" 30',
};

const DESC_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-display)',
  fontStyle: 'italic',
  fontSize: '14px',
  color: 'var(--ink-500)',
  margin: '0 0 20px 0',
  fontVariationSettings: '"opsz" 14, "SOFT" 50',
};

const STANCE_LABEL: Record<Stance, { name: string; sub: string }> = {
  handson: {
    name: 'Hands-on',
    sub: 'You initiate every step. Nothing ships without your action.',
  },
  reviewer: {
    name: 'Reviewer',
    sub: 'System drafts and generates weekly. You approve each video before it ships.',
  },
  batch: {
    name: 'Batch-ahead',
    sub: 'Generates several weeks at a time. Approved weeks ship without further check-in.',
  },
  auto: {
    name: 'Autopilot',
    sub: 'Full auto: generate, schedule, publish. Videos ship weekly without your approval.',
  },
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: defaultTierRow } = await supabase
    .from('site_content')
    .select('value')
    .eq('key', 'settings.default_tier')
    .single();
  const defaultTierKey: string = defaultTierRow?.value ?? '720p fast';

  const { users = [] } = await listUsers();
  const stance = await getStance();
  const stanceCopy = STANCE_LABEL[stance];

  return (
    <div className="stagger" style={{ maxWidth: '680px' }}>
      {/* Page header */}
      <div>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(36px, 5vw, 56px)',
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            margin: '0 0 44px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 110, "SOFT" 30',
          }}
        >
          Settings
          <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>.</em>
        </h1>
      </div>

      {/* STANCE */}
      <section style={SECTION_STYLE}>
        <h2 style={H2_STYLE}>Stance</h2>
        <p style={DESC_STYLE}>How involved you are in the weekly production cycle.</p>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            border: '1px solid var(--ink-100)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--linen-50)',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontWeight: 500,
                fontSize: '17px',
                color: 'var(--ink-900)',
                fontVariationSettings: '"opsz" 18, "SOFT" 30',
              }}
            >
              {stanceCopy.name}
            </div>
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '13.5px',
                color: 'var(--ink-500)',
                fontVariationSettings: '"opsz" 14, "SOFT" 50',
                marginTop: '4px',
              }}
            >
              {stanceCopy.sub}
            </div>
          </div>
          {/* StanceToggle renders its own "Change stance" button inline with
              the sage dot and current-stance copy. It lives at the right of
              the card so Yonah can switch without leaving Settings. */}
          <StanceToggle initialStance={stance} />
        </div>
      </section>

      {/* DEFAULT QUALITY */}
      <section style={SECTION_STYLE}>
        <h2 style={H2_STYLE}>Default quality</h2>
        <p style={DESC_STYLE}>Used when generating new videos. You can override per-video when approving.</p>
        <DefaultQualitySection currentTierKey={defaultTierKey} />
      </section>

      {/* BUDGET */}
      <section style={SECTION_STYLE}>
        <h2 style={H2_STYLE}>Budget</h2>
        <p style={DESC_STYLE}>Monthly video generation spend.</p>
        <div
          style={{
            padding: '20px 24px',
            border: '1px solid var(--ink-100)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--linen-50)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: '14px',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--ff-display)',
                fontWeight: 500,
                fontSize: '22px',
                color: 'var(--ink-900)',
                fontVariationSettings: '"opsz" 36, "SOFT" 30',
              }}
            >
              $80 / month
            </span>
            <span
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '14px',
                color: 'var(--ink-500)',
                fontVariationSettings: '"opsz" 14, "SOFT" 50',
              }}
            >
              $12.40 spent this month
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '8px',
              background: 'var(--ink-100)',
              borderRadius: '999px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: '15.5%',
                background: 'linear-gradient(90deg, var(--cedar-500), var(--cedar-400))',
                borderRadius: '999px',
              }}
            />
          </div>
        </div>
      </section>

      {/* NOTIFICATIONS */}
      <section style={SECTION_STYLE}>
        <h2 style={H2_STYLE}>Notifications</h2>
        <p style={DESC_STYLE}>How and when we reach you.</p>

        {[
          { label: 'Weekly digest', sub: 'Sunday at 7:00 am', on: true },
          { label: 'Video ready for review', sub: 'Notified when a video finishes generating', on: true },
          { label: 'Post published', sub: 'Confirmation after each channel publishes', on: false },
        ].map(({ label, sub, on }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 0',
              borderBottom: '1px dotted var(--ink-100)',
              minHeight: '44px',
            }}
          >
            <div>
              <div style={{ fontSize: '14px', color: 'var(--ink-900)' }}>{label}</div>
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
                {sub}
              </div>
            </div>
            <ToggleSwitch on={on} />
          </div>
        ))}
      </section>

      {/* USERS */}
      <section style={SECTION_STYLE}>
        <h2 style={H2_STYLE}>Users</h2>
        <p style={DESC_STYLE}>Who can sign in to the studio. New users get the default password — they can change it from this page after first sign-in.</p>
        <UsersSection initialUsers={users} />
      </section>

      {/* PASSWORD */}
      <section style={SECTION_STYLE}>
        <h2 style={H2_STYLE}>Password</h2>
        <p style={DESC_STYLE}>Change your sign-in password. At least 8 characters.</p>
        <ChangePassword />
      </section>

      {/* CONNECTED ACCOUNTS */}
      <section style={{ ...SECTION_STYLE, borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
        <h2 style={H2_STYLE}>Connected accounts</h2>
        <p style={DESC_STYLE}>Services that power the pipeline.</p>

        {[
          { initial: 'B', name: 'Buffer', status: 'Connected' },
          { initial: 'S', name: 'Supabase', status: 'Connected' },
        ].map(({ initial, name, status }) => (
          <div
            key={name}
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
                borderRadius: 'var(--r-sm)',
                background: 'var(--ink-100)',
                display: 'grid',
                placeItems: 'center',
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--ink-500)',
                flexShrink: 0,
              }}
            >
              {initial}
            </div>
            <span style={{ fontWeight: 500, color: 'var(--ink-900)' }}>{name}</span>
            <span
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: 'var(--jade)',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '13px',
                  color: 'var(--ink-400)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 50',
                }}
              >
                {status}
              </span>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

