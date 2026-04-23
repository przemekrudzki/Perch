import { useEffect, useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useUIStore } from '../store';
import { redactToken } from '../lib/storage';
import { Kbd } from './primitives';
import { VERSION, commitUrl } from '../version';

interface Props {
  rateLimit?: { remaining: number; resetAt: string };
}

export function Settings({ rateLimit }: Props) {
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const token = useUIStore((s) => s.token);
  const setToken = useUIStore((s) => s.setToken);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const scope = useUIStore((s) => s.scope);
  const setScope = useUIStore((s) => s.setScope);
  const orgs = useUIStore((s) => s.orgs);
  const setOrgs = useUIStore((s) => s.setOrgs);

  const [orgsInput, setOrgsInput] = useState(orgs.join(', '));

  useEffect(() => {
    if (settingsOpen) setOrgsInput(orgs.join(', '));
  }, [settingsOpen, orgs]);

  function commitOrgs() {
    const next = orgsInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setOrgs(next);
  }

  if (!settingsOpen) return null;

  function onResetToken() {
    const ok = window.confirm(
      'Sign out of Perch? Your token will be removed from this browser.'
    );
    if (!ok) return;
    setToken(null);
    setSettingsOpen(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflow: 'auto',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 10,
          boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
        }}
        className="scroll-zone"
      >
        <header
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--line-1)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Settings</h2>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => setSettingsOpen(false)}
            aria-label="Close"
            title="Close (Esc)"
            style={{
              width: 26,
              height: 26,
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: 'var(--fg-2)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </header>

        <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Group title="Scope">
            <Row
              label="View"
              meta={
                orgs.length === 0
                  ? 'Add tracked orgs below to enable the broader view'
                  : `Inbox = your PRs + review-requested. Team = all open PRs in tracked orgs.`
              }
            >
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  padding: 3,
                  background: 'var(--bg-2)',
                  border: '1px solid var(--line-1)',
                  borderRadius: 6,
                }}
              >
                <SegBtn
                  active={scope === 'inbox' || orgs.length === 0}
                  onClick={() => setScope('inbox')}
                >
                  Inbox
                </SegBtn>
                <SegBtn
                  active={scope === 'all' && orgs.length > 0}
                  onClick={() => {
                    if (orgs.length > 0) setScope('all');
                  }}
                >
                  Team
                </SegBtn>
              </div>
            </Row>
            <Row
              label="Tracked orgs"
              meta="Comma-separated logins, e.g. anthropics, vercel"
            >
              <input
                value={orgsInput}
                onChange={(e) => setOrgsInput(e.target.value)}
                onBlur={commitOrgs}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitOrgs();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="anthropics, vercel"
                spellCheck={false}
                autoComplete="off"
                style={{
                  width: 220,
                  height: 28,
                  padding: '0 10px',
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-1)',
                  borderRadius: 5,
                  color: 'var(--fg-0)',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  outline: 'none',
                }}
              />
            </Row>
          </Group>

          <Group title="Appearance">
            <Row label="Theme" meta="Stored on this device">
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  padding: 3,
                  background: 'var(--bg-2)',
                  border: '1px solid var(--line-1)',
                  borderRadius: 6,
                }}
              >
                <SegBtn
                  active={theme === 'dark'}
                  onClick={() => setTheme('dark')}
                >
                  Dark
                </SegBtn>
                <SegBtn
                  active={theme === 'light'}
                  onClick={() => setTheme('light')}
                >
                  Light
                </SegBtn>
              </div>
            </Row>
          </Group>

          <Group title="GitHub token">
            <Row label="Stored token" meta="Resetting clears localStorage">
              <span
                className="mono"
                style={{ fontSize: 12, color: 'var(--fg-2)' }}
              >
                {token ? redactToken(token) : '—'}
              </span>
            </Row>
            <div>
              <button
                onClick={onResetToken}
                style={{
                  height: 28,
                  padding: '0 12px',
                  borderRadius: 5,
                  border: '1px solid var(--err-line)',
                  background: 'var(--err-bg)',
                  color: 'var(--err)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Reset token
              </button>
            </div>
          </Group>

          {rateLimit && (
            <Group title="API rate limit">
              <Row label="Remaining">
                <span className="mono" style={{ fontSize: 12, color: 'var(--fg-1)' }}>
                  {rateLimit.remaining}
                </span>
              </Row>
              <Row label="Resets at">
                <span className="mono" style={{ fontSize: 12, color: 'var(--fg-1)' }}>
                  {new Date(rateLimit.resetAt).toLocaleTimeString()}
                </span>
              </Row>
            </Group>
          )}

          <Group title="Build">
            <Row label="Version" meta="Click to open the commit on GitHub">
              <a
                href={commitUrl(VERSION.sha)}
                target="_blank"
                rel="noopener noreferrer"
                className="mono"
                style={{
                  fontSize: 12,
                  color: VERSION.dirty ? 'var(--warn)' : 'var(--accent)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title={VERSION.sha}
              >
                {VERSION.shortSha}
                {VERSION.dirty && (
                  <span style={{ color: 'var(--warn)' }}>·dirty</span>
                )}
                <ExternalLink size={10} />
              </a>
            </Row>
            <Row label="Branch">
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  color:
                    VERSION.branch === 'main'
                      ? 'var(--fg-1)'
                      : 'var(--warn)',
                }}
              >
                {VERSION.branch}
              </span>
            </Row>
            <Row label="Built">
              <span
                className="mono"
                style={{ fontSize: 12, color: 'var(--fg-2)' }}
                title={VERSION.builtAt}
              >
                {relBuildTime(VERSION.builtAt)}
              </span>
            </Row>
          </Group>

          <Group title="Keyboard shortcuts">
            <ShortcutRow keys={['j', 'k']} label="Move selection down / up" />
            <ShortcutRow keys={['↵']} label="Open selected PR on GitHub" />
            <ShortcutRow keys={['e']} label="Toggle detail drawer" />
            <ShortcutRow keys={['/']} label="Focus filter" />
            <ShortcutRow keys={['r']} label="Manual refresh" />
            <ShortcutRow keys={[',']} label="Open settings" />
            <ShortcutRow keys={['?']} label="Toggle shortcut help" />
            <ShortcutRow keys={['Esc']} label="Close drawer / modal" />
          </Group>
        </div>
      </div>
    </div>
  );
}

function relBuildTime(iso: string): string {
  try {
    return `${formatDistanceToNowStrict(new Date(iso))} ago`;
  } catch {
    return iso;
  }
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          fontSize: 10.5,
          color: 'var(--fg-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          border: '1px solid var(--line-1)',
          borderRadius: 8,
          background: 'var(--bg-2)',
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '8px 10px',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, color: 'var(--fg-0)', fontWeight: 500 }}>
          {label}
        </div>
        {meta && (
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
            {meta}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 10px',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--fg-1)', flex: 1 }}>{label}</span>
      <span style={{ display: 'inline-flex', gap: 4 }}>
        {keys.map((k, i) => (
          <Kbd key={`${k}-${i}`}>{k}</Kbd>
        ))}
      </span>
    </div>
  );
}

function SegBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 22,
        padding: '0 10px',
        border: 'none',
        borderRadius: 4,
        background: active ? 'var(--bg-4)' : 'transparent',
        color: active ? 'var(--fg-0)' : 'var(--fg-2)',
        fontSize: 11.5,
        fontWeight: active ? 500 : 400,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
