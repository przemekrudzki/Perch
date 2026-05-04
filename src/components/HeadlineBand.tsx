import type { Bucket } from '../types/dashboard';
import { TONE_STYLE } from './primitives';
import type { LabelTone } from '../types/dashboard';
import { isReadyToMerge, isStale } from '../lib/bucketing';

interface Props {
  buckets: Bucket[];
}

export function HeadlineBand({ buckets }: Props) {
  const find = (id: string) =>
    buckets.find((b) => b.id === id)?.items.length ?? 0;

  const waiting = find('waiting');

  // Count ready-to-merge across every bucket (not just `ready`, which is
  // scoped to the viewer's own authored PRs). A teammate's approved + green
  // PR sitting in Team should still bump this stat.
  const readyToMerge = buckets.reduce(
    (n, b) => n + b.items.filter(isReadyToMerge).length,
    0
  );

  // Stale used to be its own bucket; now it's a chip on each row.
  // The headline stat still rolls up the count so the user has a
  // single-glance "how many are drifting" number. Dedupe by id —
  // future-proof in case any consumer reintroduces a non-mutually-
  // exclusive bucket.
  const seenStale = new Set<string>();
  let stale = 0;
  for (const b of buckets) {
    for (const pr of b.items) {
      if (seenStale.has(pr.id)) continue;
      if (isStale(pr)) {
        seenStale.add(pr.id);
        stale += 1;
      }
    }
  }

  return (
    <div
      style={{
        padding: '16px 20px 14px 20px',
        borderBottom: '1px solid var(--line-1)',
        background: 'var(--bg-0)',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 20,
        flexWrap: 'wrap',
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--fg-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          Attention
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            className="num"
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--fg-0)',
            }}
          >
            {waiting}
          </span>
          <span style={{ fontSize: 13, color: 'var(--fg-1)' }}>
            {waiting === 1 ? 'PR waiting on you' : 'PRs waiting on you'}
          </span>
        </div>
      </div>

      <StatBlock label="Ready to merge" value={readyToMerge} tone="ok" />
      <StatBlock label="Blocked" value={find('blocked')} tone="err" />
      <StatBlock label="In review" value={find('inreview')} tone="violet" />
      <StatBlock label="Stale" value={stale} tone="neutral" />
      {find('team') > 0 && (
        <StatBlock label="Team" value={find('team')} tone="info" />
      )}
    </div>
  );
}

function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: LabelTone;
}) {
  const t = TONE_STYLE[tone];
  return (
    <div style={{ paddingLeft: 20, borderLeft: '1px solid var(--line-1)' }}>
      <div
        style={{
          fontSize: 10.5,
          color: 'var(--fg-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        className="num"
        style={{
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: value === 0 ? 'var(--fg-3)' : t.c,
        }}
      >
        {value}
      </div>
    </div>
  );
}
