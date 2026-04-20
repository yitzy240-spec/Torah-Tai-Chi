import Link from 'next/link';
import type { SystemHealth, ServiceHealth } from '@/lib/health';

interface Props {
  health: SystemHealth;
}

function allOk(h: SystemHealth): boolean {
  const checks = [h.supabase, h.storyblok, h.buffer, h.modal].filter(
    (c): c is ServiceHealth => c !== null,
  );
  return checks.every((c) => c.ok);
}

function redServices(h: SystemHealth): Array<{ name: string; error?: string; isBuffer?: boolean }> {
  const out: Array<{ name: string; error?: string; isBuffer?: boolean }> = [];
  if (!h.supabase.ok)   out.push({ name: 'Supabase',  error: h.supabase.error });
  if (h.storyblok && !h.storyblok.ok) out.push({ name: 'Storyblok', error: h.storyblok.error });
  if (h.buffer && !h.buffer.ok)       out.push({ name: 'Buffer',    error: h.buffer.error, isBuffer: true });
  if (h.modal  && !h.modal.ok)        out.push({ name: 'Modal',     error: h.modal.error });
  return out;
}

const DOT_BASE: React.CSSProperties = {
  display: 'inline-block',
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  marginRight: '7px',
  verticalAlign: 'middle',
  flexShrink: 0,
};

export function SystemHealthStrip({ health }: Props) {
  const ok = allOk(health);
  const red = redServices(health);

  return (
    <div
      aria-label="System status"
      style={{
        fontFamily: 'var(--ff-display)',
        fontStyle: 'italic',
        fontSize: '12.5px',
        color: ok ? 'var(--ink-400)' : 'var(--ink-600)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0 18px',
        alignItems: 'center',
        marginBottom: '28px',
        lineHeight: 1.5,
        fontVariationSettings: '"opsz" 14, "SOFT" 60',
      }}
    >
      {ok ? (
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <span style={{ ...DOT_BASE, background: 'var(--jade, #3c8c5e)' }} />
          All systems green
        </span>
      ) : (
        red.map((svc) => (
          <span key={svc.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0' }}>
            <span style={{ ...DOT_BASE, background: '#c0392b' }} />
            {svc.isBuffer ? (
              <>
                Attention: Buffer needs reconnect{' '}
                <Link
                  href="/settings/buffer"
                  style={{
                    fontStyle: 'normal',
                    fontSize: '11.5px',
                    color: 'var(--cedar-600)',
                    marginLeft: '5px',
                    textDecoration: 'underline',
                    textDecorationColor: 'var(--cedar-300)',
                    textUnderlineOffset: '3px',
                  }}
                >
                  Fix →
                </Link>
              </>
            ) : (
              <>
                {svc.name} unavailable
                {svc.error ? ` — ${svc.error}` : ''}
              </>
            )}
          </span>
        ))
      )}
    </div>
  );
}
