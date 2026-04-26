import type { DashboardPR } from '../types/dashboard';

interface SidebarProps {
  prs: DashboardPR[];
  viewerLogin: string | null;
  viewerAvatarUrl?: string;
}

export function Sidebar({
  prs,
  viewerLogin,
  viewerAvatarUrl,
}: SidebarProps) {
  // Exclude merged PRs from counts — Inbox/My PRs/Reviewing/repo
  // tallies are about *open* work, not historical activity.
  const open = prs.filter((p) => !p.isMerged);
  const mine = open.filter((p) => p.viewerIsAuthor);
  const reviewing = open.filter((p) => !p.viewerIsAuthor);

  const repoCounts = new Map<string, number>();
  for (const pr of open) {
    repoCounts.set(
      pr.repoNameWithOwner,
      (repoCounts.get(pr.repoNameWithOwner) ?? 0) + 1
    );
  }
  const repos = Array.from(repoCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const views = [
    { id: 'inbox', name: 'Inbox', count: open.length, active: true },
    { id: 'mine', name: 'My PRs', count: mine.length },
    { id: 'review', name: 'Reviewing', count: reviewing.length },
  ];

  return (
    <aside
      style={{
        width: 228,
        borderRight: '1px solid var(--line-1)',
        background: 'var(--bg-1)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 10px 12px 14px',
        gap: 4,
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          height: 32,
          padding: '0 4px',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: 'linear-gradient(135deg, var(--accent), var(--violet))',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-fg)',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
          }}
        >
          ⌥
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>
          Perch
        </span>
      </div>

      {/* Viewer card */}
      {viewerLogin && (
        <div
          style={{
            padding: '6px 8px',
            marginBottom: 6,
            border: '1px solid var(--line-1)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--bg-2)',
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              background: 'var(--violet)',
              color: '#0b0d10',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {viewerAvatarUrl ? (
              <img
                src={viewerAvatarUrl}
                alt=""
                width={16}
                height={16}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              viewerLogin[0]?.toUpperCase()
            )}
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--fg-0)',
              fontWeight: 500,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {viewerLogin}
          </span>
        </div>
      )}

      <SidebarSection title="Views" />
      {views.map((v) => (
        <SidebarItem
          key={v.id}
          active={v.active}
          name={v.name}
          count={v.count}
          icon={
            v.id === 'inbox' ? (
              <IconInbox />
            ) : v.id === 'mine' ? (
              <IconBranch />
            ) : (
              <IconEye />
            )
          }
        />
      ))}

      {repos.length > 0 && (
        <>
          <SidebarSection title="Repositories" action={`${repos.length}`} />
          {repos.map((r) => (
            <SidebarItem
              key={r[0]}
              name={r[0].split('/').pop() ?? r[0]}
              count={r[1]}
              mono
              icon={<IconRepo />}
            />
          ))}
        </>
      )}

      <span style={{ flex: 1 }} />
    </aside>
  );
}

function SidebarSection({
  title,
  action,
}: {
  title: string;
  action?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 8px 4px 8px',
        fontSize: 10,
        color: 'var(--fg-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontWeight: 600,
      }}
    >
      {title}
      <span style={{ flex: 1 }} />
      {action && (
        <span className="mono" style={{ fontSize: 10, color: 'var(--fg-4)' }}>
          {action}
        </span>
      )}
    </div>
  );
}

function SidebarItem({
  name,
  count,
  active,
  icon,
  mono,
}: {
  name: string;
  count?: number;
  active?: boolean;
  icon: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        height: 28,
        padding: '0 8px',
        borderRadius: 5,
        background: active ? 'var(--bg-3)' : 'transparent',
        color: active ? 'var(--fg-0)' : 'var(--fg-1)',
        // No cursor: pointer here — sidebar entries are read-only stats
        // for now (only the inbox view exists). Don't hint at click
        // affordance until they actually do something.
        position: 'relative',
      }}
    >
      {active && (
        <span
          style={{
            position: 'absolute',
            left: -14,
            top: 6,
            bottom: 6,
            width: 2,
            background: 'var(--accent)',
            borderRadius: '0 2px 2px 0',
          }}
        />
      )}
      <span
        style={{
          width: 14,
          height: 14,
          display: 'inline-flex',
          color: active ? 'var(--accent)' : 'var(--fg-2)',
        }}
      >
        {icon}
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: active ? 500 : 400,
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      {count != null && (
        <span
          className="mono num"
          style={{
            fontSize: 10.5,
            color: 'var(--fg-3)',
            minWidth: 18,
            textAlign: 'right',
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function IconInbox() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M2 3h10v5l-3-1H5l-3 1V3z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconBranch() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="4" cy="3" r="1.3" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="11" r="1.3" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10" cy="5" r="1.3" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M4 4.5v5M4 9V7a2 2 0 012-2h2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconEye() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M1.5 7s1.8-3.5 5.5-3.5S12.5 7 12.5 7 10.7 10.5 7 10.5 1.5 7 1.5 7z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function IconRepo() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M3 2h7a1 1 0 011 1v9l-1.5-1-1.5 1-1.5-1-1.5 1V3a1 1 0 011-1zM3 2a1 1 0 00-1 1v9a1 1 0 001 1"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
