import type { Bucket } from '../types/dashboard';
import { useUIStore } from '../store';
import { PRRow } from './PRRow';

interface Props {
  bucket: Bucket;
  selectedPRId: string | null;
  newIds: Set<string>;
  onSelect: (id: string) => void;
  onOpen: (url: string) => void;
  emptyText?: string;
}

export function BucketSection({
  bucket,
  selectedPRId,
  newIds,
  onSelect,
  onOpen,
  emptyText,
}: Props) {
  const collapsedBuckets = useUIStore((s) => s.collapsedBuckets);
  const toggleBucket = useUIStore((s) => s.toggleBucket);
  const collapsed = collapsedBuckets.has(bucket.id);
  const empty = bucket.items.length === 0;

  // Hide most buckets when empty so a quiet day doesn't show five
  // ceremonial empty sections. Waiting-on-me and Stale stay visible
  // because their empty state is a positive signal ("all caught up").
  if (HIDE_WHEN_EMPTY.has(bucket.id) && empty) return null;

  return (
    <section>
      <button
        onClick={() => toggleBucket(bucket.id)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          userSelect: 'none',
          borderTop: '1px solid var(--line-1)',
          background: 'var(--bg-1)',
          color: 'inherit',
          border: 'none',
          textAlign: 'left',
        }}
        aria-expanded={!collapsed}
        aria-controls={`bucket-${bucket.id}`}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: bucket.color,
            flexShrink: 0,
            boxShadow: `0 0 0 3px ${bucket.color}22`,
          }}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--fg-0)',
            letterSpacing: '-0.005em',
          }}
        >
          {bucket.title}
        </span>
        <span
          className="mono num"
          style={{
            fontSize: 11,
            color: 'var(--fg-2)',
            fontWeight: 500,
            padding: '1px 6px',
            background: 'var(--bg-3)',
            borderRadius: 3,
            minWidth: 20,
            textAlign: 'center',
          }}
        >
          {bucket.items.length}
        </span>
        <span style={{ flex: 1 }} />
        {bucket.meta && (
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{bucket.meta}</span>
        )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          style={{
            transform: collapsed ? 'rotate(-90deg)' : 'none',
            transition: 'transform .12s',
            color: 'var(--fg-3)',
          }}
        >
          <path
            d="M2 3.5L5 6.5 8 3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {!collapsed && (
        <div id={`bucket-${bucket.id}`}>
          {empty ? (
            <BucketEmpty text={emptyText ?? 'All clear.'} />
          ) : (
            bucket.items.map((pr) => (
              <PRRow
                key={pr.id}
                pr={pr}
                focused={selectedPRId === pr.id}
                isNew={newIds.has(pr.id)}
                onSelect={() => onSelect(pr.id)}
                onOpen={() => onOpen(pr.url)}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function BucketEmpty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '14px 14px 16px 36px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
        color: 'var(--fg-2)',
        borderBottom: '1px solid var(--line-1)',
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        style={{ color: 'var(--ok)' }}
      >
        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M3.6 6.2L5.3 7.8 8.4 4.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{text}</span>
    </div>
  );
}

const HIDE_WHEN_EMPTY = new Set<string>([
  'ready',
  'blocked',
  'inreview',
  'team',
  'merged',
  'other',
]);

export const EMPTY_TEXT: Record<string, string> = {
  waiting: "You're all caught up. Nothing waiting on you.",
  ready: 'Nothing ready right now. Ship something.',
  blocked: 'No blockers. Clear runway.',
  inreview: 'Nothing in review.',
  stale: 'Nothing aging. You keep a tidy queue.',
  team: '',
  merged: 'Nothing merged in the last 7 days.',
  other: '',
};
