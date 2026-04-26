import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useUIStore } from '../store';
import { usePRs } from '../hooks/usePRs';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useNewPRs } from '../hooks/useNewPRs';
import { useTitleAndFavicon } from '../hooks/useTitleAndFavicon';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { HeadlineBand } from './HeadlineBand';
import { BucketSection, EMPTY_TEXT } from './BucketSection';
import { PRDetail } from './PRDetail';
import { Settings } from './Settings';
import { HelpOverlay } from './HelpOverlay';
import { LoadingSkeleton } from './LoadingSkeleton';
import { ErrorBanner } from './ErrorBanner';
import { bucketize } from '../lib/bucketing';
import type { DashboardPR } from '../types/dashboard';

export function Dashboard() {
  const token = useUIStore((s) => s.token);
  const setToken = useUIStore((s) => s.setToken);
  const scope = useUIStore((s) => s.scope);
  const orgs = useUIStore((s) => s.orgs);
  const selectedPRId = useUIStore((s) => s.selectedPRId);
  const setSelectedPRId = useUIStore((s) => s.setSelectedPRId);
  const detailOpen = useUIStore((s) => s.detailOpen);
  const setDetailOpen = useUIStore((s) => s.setDetailOpen);
  const searchQuery = useUIStore((s) => s.searchQuery);

  const query = usePRs({ token, scope, orgs });

  // Keep a ticking "Xs ago" label without refetching constantly.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const lastUpdatedLabel = query.data
    ? formatDistanceToNowStrict(new Date(query.data.fetchedAt)) + ' ago'
    : '—';

  const filtered = useMemo<DashboardPR[]>(() => {
    if (!query.data) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return query.data.prs;
    return query.data.prs.filter((pr) => {
      return (
        pr.title.toLowerCase().includes(q) ||
        pr.repoNameWithOwner.toLowerCase().includes(q) ||
        pr.author.login.toLowerCase().includes(q) ||
        pr.labels.some((l) => l.name.toLowerCase().includes(q))
      );
    });
  }, [query.data, searchQuery]);

  const buckets = useMemo(
    () => (searchQuery ? bucketize(filtered) : query.data?.buckets ?? []),
    [searchQuery, filtered, query.data]
  );

  const selectedPR = useMemo(
    () => filtered.find((p) => p.id === selectedPRId) ?? null,
    [filtered, selectedPRId]
  );

  // Reset selection if it falls out of the filtered set.
  useEffect(() => {
    if (!selectedPRId) return;
    if (!filtered.some((p) => p.id === selectedPRId)) {
      setSelectedPRId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedPRId, setSelectedPRId]);

  const refetch = query.refetch;
  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  useKeyboardNav({ buckets, onRefresh });

  const allIds = useMemo(() => filtered.map((p) => p.id), [filtered]);
  const newIds = useNewPRs(allIds);

  const waitingCount = useMemo(
    () => buckets.find((b) => b.id === 'waiting')?.items.length ?? 0,
    [buckets]
  );
  useTitleAndFavicon(waitingCount);

  const totalOpen =
    query.data?.prs.filter((p) => !p.isMerged).length ?? 0;
  const isAuthError = query.error
    ? /bad credentials|401|unauthorized/i.test(query.error.message)
    : false;
  const isRateLimited = query.error
    ? /rate limit|403/i.test(query.error.message)
    : false;

  // Suppress unused-now warning (reserved for future ticking UI needs).
  void now;

  return (
    <div
      className="pr-app"
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        background: 'var(--bg-0)',
      }}
    >
      <Sidebar
        prs={query.data?.prs ?? []}
        viewerLogin={query.data?.viewer.login ?? null}
        viewerAvatarUrl={query.data?.viewer.avatarUrl}
      />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <Header
          total={totalOpen}
          lastUpdatedLabel={lastUpdatedLabel}
          refreshing={query.isFetching}
          onRefresh={() => void query.refetch()}
          viewerLogin={query.data?.viewer.login ?? null}
          viewerAvatarUrl={query.data?.viewer.avatarUrl}
        />

        {query.data && <HeadlineBand buckets={buckets} />}

        {query.error && isAuthError && (
          <ErrorBanner
            tone="err"
            title="GitHub token rejected"
            body="Your Personal Access Token is invalid or has expired. Reset it and paste a new one."
            actionLabel="Reset token"
            onAction={() => setToken(null)}
          />
        )}

        {query.error && isRateLimited && (
          <ErrorBanner
            tone="warn"
            title="Hitting GitHub's rate limit"
            body="Auto-refresh paused. It will resume automatically once the rate window resets."
          />
        )}

        {query.error && !isAuthError && !isRateLimited && (
          <ErrorBanner
            tone="err"
            title="Couldn't reach GitHub"
            body={query.error.message}
            actionLabel="Retry"
            onAction={() => void query.refetch()}
          />
        )}

        <div
          className="scroll-zone"
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {query.isLoading && <LoadingSkeleton />}
          {!query.isLoading && query.data && (
            <>
              {totalOpen === 0 && !searchQuery ? (
                <AllCaughtUp />
              ) : (
                buckets.map((bucket) => (
                  <BucketSection
                    key={bucket.id}
                    bucket={bucket}
                    selectedPRId={selectedPRId}
                    newIds={newIds}
                    onSelect={(id) => {
                      setSelectedPRId(id);
                      setDetailOpen(true);
                    }}
                    onOpen={(url) =>
                      window.open(url, '_blank', 'noopener,noreferrer')
                    }
                    emptyText={EMPTY_TEXT[bucket.id]}
                  />
                ))
              )}
            </>
          )}
        </div>
      </main>

      {detailOpen && selectedPR && (
        <PRDetail pr={selectedPR} onClose={() => setDetailOpen(false)} />
      )}

      <Settings rateLimit={query.data?.rateLimit} />
      <HelpOverlay />
    </div>
  );
}

function AllCaughtUp() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 48,
        color: 'var(--fg-2)',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'var(--ok-bg)',
          border: '1px solid var(--ok-line)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ok)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M4 9.5L7.5 13 14 5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div style={{ fontSize: 15, color: 'var(--fg-0)', fontWeight: 600 }}>
        All caught up
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
        No open pull requests need your attention.
      </div>
    </div>
  );
}
