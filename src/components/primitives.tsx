import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  ApprovalState,
  CIStatus,
  DashboardLabel,
  DashboardUser,
  LabelTone,
} from '../types/dashboard';

export const TONE_STYLE: Record<
  LabelTone,
  { c: string; b: string; bd: string }
> = {
  err: { c: 'var(--err)', b: 'var(--err-bg)', bd: 'var(--err-line)' },
  warn: { c: 'var(--warn)', b: 'var(--warn-bg)', bd: 'var(--warn-line)' },
  ok: { c: 'var(--ok)', b: 'var(--ok-bg)', bd: 'var(--ok-line)' },
  info: { c: 'var(--info)', b: 'var(--info-bg)', bd: 'var(--info-line)' },
  violet: {
    c: 'var(--violet)',
    b: 'var(--violet-bg)',
    bd: 'var(--violet-line)',
  },
  neutral: { c: 'var(--fg-1)', b: 'var(--bg-3)', bd: 'var(--line-2)' },
};

interface AvatarProps {
  user: DashboardUser;
  size?: number;
  ring?: boolean;
  title?: string;
}

export function Avatar({ user, size = 20, ring, title }: AvatarProps) {
  const initial = (user.login || '?')[0]!.toUpperCase();
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: '50%',
    color: '#0b0d10',
    fontSize: Math.round(size * 0.5),
    fontWeight: 600,
    fontFamily: 'var(--font-sans)',
    boxShadow: ring ? '0 0 0 2px var(--bg-1)' : undefined,
    userSelect: 'none',
    flexShrink: 0,
    overflow: 'hidden',
  };
  if (user.avatarUrl) {
    return (
      <span
        className={`av-${user.av}`}
        style={style}
        title={title ?? `@${user.login}`}
      >
        <img
          src={user.avatarUrl}
          alt=""
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </span>
    );
  }
  return (
    <span
      className={`av-${user.av}`}
      style={style}
      title={title ?? `@${user.login}`}
      aria-label={title ?? `@${user.login}`}
    >
      {initial}
    </span>
  );
}

export function AvatarStack({
  users,
  max = 3,
  size = 18,
  gap = 4,
}: {
  users: DashboardUser[];
  max?: number;
  size?: number;
  /** Pixels between avatars. Positive = spaced, negative = overlapping. */
  gap?: number;
}) {
  const shown = users.slice(0, max);
  const over = users.length - shown.length;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      {shown.map((u, i) => (
        <Avatar key={`${u.login}-${i}`} user={u} size={size} />
      ))}
      {over > 0 && (
        <span
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: 'var(--bg-3)',
            color: 'var(--fg-1)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.round(size * 0.48),
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            flexShrink: 0,
          }}
        >
          +{over}
        </span>
      )}
    </span>
  );
}

export function LabelPill({
  label,
}: {
  label: DashboardLabel;
}) {
  const t = TONE_STYLE[label.tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 7px',
        borderRadius: 4,
        border: `1px solid ${t.bd}`,
        background: t.b,
        color: t.c,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        whiteSpace: 'nowrap',
      }}
    >
      {label.name}
    </span>
  );
}

export function ApprovalChip({
  state,
  done,
  total,
}: {
  state: ApprovalState;
  done: number;
  total: number;
}) {
  let tone: LabelTone;
  let label: ReactNode;
  let icon: ReactNode;

  if (state === 'approved') {
    tone = 'ok';
    label = (
      <>
        {done}/{total}
      </>
    );
    icon = (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path
          d="M2 5.2L4.2 7.2 8 2.8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  } else if (state === 'changes') {
    tone = 'err';
    label = <>changes</>;
    icon = (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path
          d="M5 2.5V5.5M5 7.3V7.7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  } else {
    tone = total > 0 && done > 0 ? 'warn' : 'neutral';
    label = (
      <>
        {done}/{total}
      </>
    );
    icon = (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <circle
          cx="5"
          cy="5"
          r="3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeDasharray="1.5 1.5"
        />
      </svg>
    );
  }
  const t = TONE_STYLE[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 20,
        padding: '0 7px',
        borderRadius: 4,
        border: `1px solid ${t.bd}`,
        background: t.b,
        color: t.c,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {icon}
      {label}
    </span>
  );
}

export function CIStatusChip({
  state,
  compact = false,
}: {
  state: CIStatus;
  compact?: boolean;
}) {
  const map: Record<CIStatus, { c: string; label: string }> = {
    success: { c: 'var(--ok)', label: 'pass' },
    failure: { c: 'var(--err)', label: 'fail' },
    pending: { c: 'var(--warn)', label: 'pending' },
    none: { c: 'var(--fg-3)', label: 'no ci' },
  };
  const s = map[state];
  const icon =
    state === 'success' ? (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="5" stroke={s.c} strokeWidth="1.3" />
        <path
          d="M3.6 6.2L5.3 7.8 8.4 4.4"
          stroke={s.c}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : state === 'failure' ? (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="5" stroke={s.c} strokeWidth="1.3" />
        <path
          d="M4.3 4.3L7.7 7.7M7.7 4.3L4.3 7.7"
          stroke={s.c}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ) : state === 'pending' ? (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle
          cx="6"
          cy="6"
          r="5"
          stroke={s.c}
          strokeWidth="1.3"
          strokeDasharray="2 1.5"
        />
      </svg>
    ) : (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="5" stroke={s.c} strokeWidth="1.2" />
      </svg>
    );
  if (compact) {
    return (
      <span
        title={`CI ${s.label}`}
        style={{ display: 'inline-flex', color: s.c }}
        aria-label={`CI ${s.label}`}
      >
        {icon}
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        color: s.c,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        fontWeight: 500,
      }}
    >
      {icon}
      {s.label}
    </span>
  );
}

export function DraftChip() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 18,
        padding: '0 6px',
        borderRadius: 4,
        border: '1px solid var(--line-2)',
        color: 'var(--fg-2)',
        fontSize: 10.5,
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      <svg width="8" height="8" viewBox="0 0 8 8">
        <circle
          cx="4"
          cy="4"
          r="2.5"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
      Draft
    </span>
  );
}

/**
 * Stale chip rendered next to the row title when no commits and no
 * comments have landed in the last 48h. Predicate lives in
 * `lib/bucketing.ts` (`isStale`); this is the visual.
 */
export function StaleChip() {
  return (
    <span
      title="No commits or comments in the last 48 hours"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 18,
        padding: '0 6px',
        borderRadius: 4,
        border: '1px solid var(--line-2)',
        background: 'var(--bg-2)',
        color: 'var(--fg-2)',
        fontSize: 10.5,
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
        <circle
          cx="4.5"
          cy="4.5"
          r="3.5"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M4.5 2.5V4.5L5.7 5.4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
      Stale
    </span>
  );
}

export function EscalateGlyph() {
  return (
    <span
      title="Waiting >24h"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        color: 'var(--warn)',
        fontSize: 10.5,
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '-0.01em',
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M5 3V5.2L6.5 6.2"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
      24h+
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 14,
        height: 14,
        padding: '0 3px',
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        borderRadius: 3,
        fontSize: 10,
        color: 'var(--fg-1)',
        fontFamily: 'var(--font-mono)',
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  );
}

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Hover delay before showing, ms. Default 150. */
  delay?: number;
}

/**
 * Lightweight hover tooltip. Renders into a portal so it escapes any
 * scroll containers, and auto-flips above the trigger when close to
 * the bottom of the viewport.
 */
export function Tooltip({ content, children, delay = 150 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);

  function show(): void {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (triggerRef.current) {
        setRect(triggerRef.current.getBoundingClientRect());
      }
      setOpen(true);
    }, delay);
  }
  function hide(): void {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setOpen(false);
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        style={{ display: 'inline-flex' }}
      >
        {children}
      </span>
      {open && rect && createPortal(
        <TooltipSurface rect={rect}>{content}</TooltipSurface>,
        document.body
      )}
    </>
  );
}

function TooltipSurface({
  rect,
  children,
}: {
  rect: DOMRect;
  children: ReactNode;
}) {
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeBelow = spaceBelow > 160;
  const top = placeBelow ? rect.bottom + 6 : rect.top - 6;
  const left = rect.left + rect.width / 2;
  return (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        top,
        left,
        transform: placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        background: 'var(--bg-1)',
        border: '1px solid var(--line-2)',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 11.5,
        color: 'var(--fg-1)',
        pointerEvents: 'none',
        boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
        zIndex: 1000,
        maxWidth: 280,
        minWidth: 160,
        lineHeight: 1.5,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {children}
    </div>
  );
}

export function Shimmer({
  w,
  h,
  r = 3,
}: {
  w: number | string;
  h: number;
  r?: number;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: w,
        height: h,
        borderRadius: r,
        background:
          'linear-gradient(90deg, var(--bg-3) 0%, var(--bg-4) 50%, var(--bg-3) 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s ease-in-out infinite',
      }}
    />
  );
}
