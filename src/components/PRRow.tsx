import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import type { DashboardPR, DashboardReviewer } from '../types/dashboard';
import {
  ApprovalChip,
  Avatar,
  AvatarStack,
  CIStatusChip,
  DraftChip,
  EscalateGlyph,
  Kbd,
  LabelPill,
  Tooltip,
} from './primitives';

interface PRRowProps {
  pr: DashboardPR;
  focused: boolean;
  /** True when the PR wasn't present in the previous visit's snapshot. */
  isNew: boolean;
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

export function PRRow({ pr, focused, isNew, onSelect, onOpen }: PRRowProps) {
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
    display: 'flex',
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
      {/* Left: new-indicator + author + title + repo + labels */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          // Shrink when the row is tight; don't grow past content so the
          // indicators sit right next to the title.
          flex: '0 1 auto',
        }}
      >
        <span
          aria-hidden={!isNew}
          title={isNew ? 'New since your last visit' : undefined}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: isNew ? 'var(--accent)' : 'transparent',
            boxShadow: isNew ? '0 0 0 3px rgba(106,169,255,0.22)' : 'none',
            flexShrink: 0,
          }}
        />
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

      {/* Approval + CI + reviewers sit right next to the title area. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <Tooltip content={<ApprovalTooltip pr={pr} />}>
          <ApprovalChip
            state={pr.approvalState}
            done={pr.approvalCount}
            total={Math.max(pr.reviewerCount, pr.approvalCount)}
          />
        </Tooltip>
        <CIStatusChip state={pr.ciStatus} compact />
        <AvatarStack users={pr.reviewers} max={3} size={18} />
      </div>

      {/* Escalation + time pinned to the far right via margin-left: auto. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginLeft: 'auto',
          flexShrink: 0,
        }}
      >
        {pr.escalate && <EscalateGlyph />}
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
      </div>

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

function ApprovalTooltip({ pr }: { pr: DashboardPR }) {
  const { approvalState, approvalCount, reviewerCount, reviewers } = pr;

  let headline: ReactNode;
  if (approvalState === 'changes') {
    headline = (
      <span style={{ color: 'var(--err)' }}>Changes requested</span>
    );
  } else if (approvalState === 'approved') {
    headline = (
      <span style={{ color: 'var(--ok)' }}>
        Approved by {approvalCount} of {reviewerCount}
      </span>
    );
  } else if (reviewerCount === 0) {
    headline = <span>No reviewers assigned</span>;
  } else {
    headline = (
      <span>
        {approvalCount} of {reviewerCount} approved
      </span>
    );
  }

  return (
    <div>
      <div style={{ fontWeight: 600, color: 'var(--fg-0)' }}>{headline}</div>
      {reviewers.length > 0 && (
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {reviewers.map((r) => (
            <ReviewerLine key={r.login} reviewer={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewerLine({ reviewer }: { reviewer: DashboardReviewer }) {
  const meta = REVIEWER_STATE_META[reviewer.state];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: meta.color,
          flexShrink: 0,
        }}
      />
      <span className="mono" style={{ color: 'var(--fg-1)' }}>
        @{reviewer.login}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ color: meta.color }}>{meta.label}</span>
    </div>
  );
}

const REVIEWER_STATE_META: Record<
  DashboardReviewer['state'],
  { color: string; label: string }
> = {
  approved: { color: 'var(--ok)', label: 'approved' },
  changes: { color: 'var(--err)', label: 'requested changes' },
  commented: { color: 'var(--info)', label: 'commented' },
  requested: { color: 'var(--fg-3)', label: 'awaiting' },
  pending: { color: 'var(--fg-3)', label: 'pending' },
};
