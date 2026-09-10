import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useUIStore } from '../store';
import { usePRs } from '../hooks/usePRs';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useNewPRs } from '../hooks/useNewPRs';
import { useNewComments } from '../hooks/useNewComments';
import { useTitleAndFavicon } from '../hooks/useTitleAndFavicon';
import { useDesktopNotifications } from '../hooks/useDesktopNotifications';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { HeadlineBand } from './HeadlineBand';
import { BucketSection, EMPTY_TEXT } from './BucketSection';
import { PRDetail } from './PRDetail';
import { Settings } from './Settings';
import { HelpOverlay } from './HelpOverlay';
import { LoadingSkeleton } from './LoadingSkeleton';
import { ErrorBanner } from './ErrorBanner';
import { bucketize, flattenForNav } from '../lib/bucketing';
import { redactToken } from '../lib/storage';
import { filterPRs } from '../lib/filtering';
import type { DashboardPR, DashboardUser } from '../types/dashboard';

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
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const authorFilter = useUIStore((s) => s.authorFilter);
  const setAuthorFilter = useUIStore((s) => s.setAuthorFilter);
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled);

  const query = usePRs({ token, scope, orgs, notificationsEnabled });

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
    return filterPRs(query.data.prs, {
      query: searchQuery,
      authorLogin: authorFilter?.login ?? null,
    });
  }, [query.data, searchQuery, authorFilter]);

  const hasActiveFilter = Boolean(searchQuery.trim() || authorFilter);

  const buckets = useMemo(
    () => (hasActiveFilter ? bucketize(filtered) : query.data?.buckets ?? []),
    [hasActiveFilter, filtered, query.data]
  );

  const toggleAuthorFilter = useCallback(
    (author: DashboardUser) => {
      const alreadyActive =
        authorFilter?.login.toLowerCase() === author.login.toLowerCase();
      setAuthorFilter(alreadyActive ? null : author);
    },
    [authorFilter, setAuthorFilter]
  );

  // The author lens is backed by the complete Team result. Clear it if
  // tracked orgs are removed while the Team tab is active.
  useEffect(() => {
    if (authorFilter && (scope !== 'all' || orgs.length === 0)) {
      setAuthorFilter(null);
    }
  }, [authorFilter, orgs.length, scope, setAuthorFilter]);

  const selectedPR = useMemo(
    () => filtered.find((p) => p.id === selectedPRId) ?? null,
    [filtered, selectedPRId]
  );

  // The same flat list `useKeyboardNav` walks for j/k. Drives the
  // modal's prev/next chevrons + counter so they stay in lockstep
  // with keyboard nav (and vice-versa).
  const collapsedBuckets = useUIStore((s) => s.collapsedBuckets);
  const navList = useMemo(
    () => flattenForNav(buckets, collapsedBuckets),
    [buckets, collapsedBuckets]
  );
  const navIndex = selectedPRId
    ? navList.findIndex((p) => p.id === selectedPRId)
    : -1;
  const prevNavId = navIndex > 0 ? navList[navIndex - 1]!.id : null;
  const nextNavId =
    navIndex >= 0 && navIndex < navList.length - 1
      ? navList[navIndex + 1]!.id
      : null;

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

  const openPR = useCallback(
    (id: string) => {
      setSelectedPRId(id);
      setDetailOpen(true);
    },
    [setSelectedPRId, setDetailOpen]
  );

  useDesktopNotifications(
    query.data?.prs ?? [],
    notificationsEnabled,
    query.data?.viewer.login ?? null,
    openPR
  );

  // Persist new/comment baselines from the complete fetched dataset. A
  // temporary view filter must not make hidden PRs look new next visit.
  const allIds = useMemo(
    () => query.data?.prs.map((p) => p.id) ?? [],
    [query.data]
  );
  const newIds = useNewPRs(allIds);
  const { deltas: newCommentDeltas, markAsRead: markCommentsRead } =
    useNewComments(query.data?.prs ?? []);

  // When the drawer opens (or the selected PR changes while it's open),
  // mark that PR's comments as read so the +N delta clears immediately.
  useEffect(() => {
    if (detailOpen && selectedPRId) {
      markCommentsRead(selectedPRId);
    }
  }, [detailOpen, selectedPRId, markCommentsRead]);

  const waitingCount = useMemo(
    () => buckets.find((b) => b.id === 'waiting')?.items.length ?? 0,
    [buckets]
  );
  const hasFresh = newIds.size > 0 || newCommentDeltas.size > 0;
  useTitleAndFavicon({ waitingCount, hasFresh });

  const totalOpen =
    query.data?.prs.filter((p) => !p.isMerged).length ?? 0;
  const shownOpen = filtered.filter((p) => !p.isMerged).length;
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
          shownTotal={shownOpen}
          lastUpdatedLabel={lastUpdatedLabel}
          refreshing={query.isFetching}
          onRefresh={() => void query.refetch()}
          viewerLogin={query.data?.viewer.login ?? null}
          viewerAvatarUrl={query.data?.viewer.avatarUrl}
          authorFilter={authorFilter}
          onClearAuthorFilter={() => setAuthorFilter(null)}
        />

        {query.data && <HeadlineBand buckets={buckets} />}
        {query.mergedLoading && <div role="status" style={{ padding: 12, color: 'var(--fg-2)' }}>Loading recently merged PRs…</div>}
        {query.mergedError && <ErrorBanner tone="warn" title="Couldn't refresh recently merged PRs" body={(query.mergedError.message.split(token || '\0').join(token ? redactToken(token) : ''))} actionLabel="Retry" onAction={() => void query.retryMerged()} />}

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
              {filtered.length === 0 && !hasActiveFilter ? (
                <AllCaughtUp />
              ) : filtered.length === 0 && hasActiveFilter ? (
                <NoFilterMatches
                  authorLogin={authorFilter?.login ?? null}
                  hasSearch={Boolean(searchQuery.trim())}
                  onClear={() => {
                    setAuthorFilter(null);
                    setSearchQuery('');
                  }}
                />
              ) : (
                buckets.map((bucket) => (
                  <BucketSection
                    key={bucket.id}
                    bucket={bucket}
                    selectedPRId={selectedPRId}
                    newIds={newIds}
                    newCommentDeltas={newCommentDeltas}
                    onSelect={(id) => {
                      setSelectedPRId(id);
                      setDetailOpen(true);
                    }}
                    onOpen={(url) =>
                      window.open(url, '_blank', 'noopener,noreferrer')
                    }
                    authorFilterLogin={authorFilter?.login ?? null}
                    onAuthorFilter={
                      scope === 'all' && orgs.length > 0
                        ? toggleAuthorFilter
                        : undefined
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
        <PRDetail
          pr={selectedPR}
          onClose={() => setDetailOpen(false)}
          navIndex={navIndex}
          navTotal={navList.length}
          onNavigate={(id) => setSelectedPRId(id)}
          prevId={prevNavId}
          nextId={nextNavId}
        />
      )}

      <Settings rateLimit={query.data?.rateLimit} />
      <HelpOverlay />
    </div>
  );
}

function NoFilterMatches({
  authorLogin,
  hasSearch,
  onClear,
}: {
  authorLogin: string | null;
  hasSearch: boolean;
  onClear: () => void;
}) {
  const description = authorLogin
    ? hasSearch
      ? `No PRs by @${authorLogin} match this search.`
      : `No PRs by @${authorLogin} are in the current Team result.`
    : 'No PRs match this search.';

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
      <span style={{ fontSize: 13 }}>{description}</span>
      <button
        type="button"
        onClick={onClear}
        style={{
          height: 28,
          padding: '0 10px',
          border: '1px solid var(--line-2)',
          borderRadius: 6,
          background: 'var(--bg-2)',
          color: 'var(--fg-1)',
          cursor: 'pointer',
          fontSize: 11.5,
        }}
      >
        Clear filters
      </button>
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
