import type { CSSProperties, MouseEvent } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import type { DashboardPR } from '../types/dashboard';
import {
  ApprovalChip,
  Avatar,
  AvatarStack,
  CIStatusChip,
  DraftChip,
  EscalateGlyph,
  Kbd,
  LabelPill,
} from './primitives';

interface PRRowProps {
  pr: DashboardPR;
  focused: boolean;
  onSelect: () => void;
  /** Double-click opens the PR in a new tab. */
  onOpen: () => void;
}

function relTime(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: false })
      .replace(' minutes', 'm')
      .replace(' minute', 'm')
      .replace(' hours', 'h')
      .replace(' hour', 'h')
      .replace(' days', 'd')
      .replace(' day', 'd')
      .replace(' seconds', 's')
      .replace(' second', 's')
      .replace(' months', 'mo')
      .replace(' month', 'mo')
      .replace(' years', 'y')
      .replace(' year', 'y');
  } catch {
    return '';
  }
}

export function PRRow({ pr, focused, onSelect, onOpen }: PRRowProps) {
  const bg = focused ? 'var(--bg-3)' : 'transparent';

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    // Blur so focus doesn't get trapped on the row and steal keystrokes
    // (`e`, `Enter`) from the global keyboard handler.
    (e.currentTarget as HTMLElement).blur();
    onSelect();
  }

  function handleDoubleClick() {
    onOpen();
  }

  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0,1fr) auto auto auto auto auto',
    alignItems: 'center',
    gap: 14,
    height: 'var(--row-h)',
    padding: '0 14px',
    background: bg,
    borderLeft: focused
      ? '2px solid var(--accent)'
      : '2px solid transparent',
    borderBottom: '1px solid var(--line-1)',
    cursor: 'pointer',
    position: 'relative',
    outline: 'none',
  };

  const labels = pr.labels.slice(0, 2);
  const extraLabels = pr.labels.length - labels.length;

  return (
    <div
      role="row"
      aria-selected={focused}
      tabIndex={-1}
      data-pr-id={pr.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={rowStyle}
      onMouseEnter={(e) => {
        if (!focused) (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)';
      }}
      onMouseLeave={(e) => {
        if (!focused) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {/* Left: author + title + repo + labels */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Avatar user={pr.author} size={20} />
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 11.5,
              color: 'var(--fg-3)',
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            #{pr.number}
          </span>
          <span
            style={{
              fontSize: 13,
              color: 'var(--fg-0)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
              flexShrink: 1,
            }}
          >
            {pr.title}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--fg-3)',
              flexShrink: 0,
            }}
          >
            {pr.repoNameWithOwner}
          </span>
          {pr.isDraft && <DraftChip />}
          {labels.map((l, i) => (
            <LabelPill key={`${l.name}-${i}`} label={l} />
          ))}
          {extraLabels > 0 && (
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
              +{extraLabels}
            </span>
          )}
        </div>
      </div>

      {/* Approval */}
      <ApprovalChip
        state={pr.approvalState}
        done={pr.approvalCount}
        total={Math.max(pr.reviewerCount, pr.approvalCount)}
      />

      {/* CI */}
      <CIStatusChip state={pr.ciStatus} compact />

      {/* Reviewers */}
      <AvatarStack users={pr.reviewers} max={3} size={18} />

      {/* Escalation */}
      <span style={{ width: 44, textAlign: 'right' }}>
        {pr.escalate && <EscalateGlyph />}
      </span>

      {/* Time */}
      <span
        className="mono num"
        style={{
          fontSize: 11,
          color: pr.escalate ? 'var(--warn)' : 'var(--fg-2)',
          fontWeight: 500,
          minWidth: 48,
          textAlign: 'right',
        }}
      >
        {relTime(pr.updatedAt)}
      </span>

      {focused && (
        <div
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            padding: '2px 6px',
            background: 'var(--bg-1)',
            border: '1px solid var(--accent)',
            borderRadius: 4,
            color: 'var(--accent)',
            fontSize: 10.5,
            fontFamily: 'var(--font-mono)',
            pointerEvents: 'none',
          }}
        >
          <Kbd>↵</Kbd> open <span style={{ opacity: 0.5 }}>·</span>{' '}
          <Kbd>e</Kbd> expand
        </div>
      )}
    </div>
  );
}
