import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboard, fetchMerged } from '../lib/github';
import { transformDashboard } from '../lib/transform';
import { bucketize } from '../lib/bucketing';
import type { Bucket, DashboardPR } from '../types/dashboard';
import type { Scope } from '../lib/storage';

export interface DashboardData {
  viewer: { login: string; avatarUrl: string };
  prs: DashboardPR[];
  buckets: Bucket[];
  rateLimit: { remaining: number; resetAt: string };
  fetchedAt: number;
}

interface Args {
  token: string | null;
  scope: Scope;
  orgs: string[];
  notificationsEnabled?: boolean;
}

export function usePRs({
  token,
  scope,
  orgs,
  notificationsEnabled = false,
}: Args) {
  const effectiveScope: Scope = orgs.length === 0 ? 'inbox' : scope;
  const open = useQuery<DashboardData, Error>({
    queryKey: ['dashboard', token, effectiveScope, orgs.join(','), 'open'],
    enabled: Boolean(token),
    refetchInterval: 60_000,
    refetchIntervalInBackground: notificationsEnabled,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    queryFn: async () => {
      if (!token) throw new Error('Missing token');
      const res = await fetchDashboard(token, {
        scope: effectiveScope,
        orgs,
      });
      const { viewer, prs, rateLimit } = transformDashboard(res);
      return {
        viewer,
        prs,
        buckets: bucketize(prs),
        rateLimit,
        fetchedAt: Date.now(),
      };
    },
    retry: (failureCount, err) => {
      const msg = String(err?.message ?? err);
      if (msg.toLowerCase().includes('bad credentials')) return false;
      if (msg.includes('401')) return false;
      return failureCount < 2;
    },
  });
  const merged = useQuery({
    queryKey: ['dashboard', token, effectiveScope, orgs.join(','), 'merged'],
    enabled: Boolean(token),
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: notificationsEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!token) throw new Error('Missing token');
      return transformDashboard(await fetchMerged(token, { scope: effectiveScope, orgs }));
    },
    retry: false,
  });
  const data = useMemo(() => {
    if (!open.data) return undefined;
    // A merged result wins over an older open snapshot of the same PR.
    const byId = new Map(open.data.prs.map((pr) => [pr.id, pr]));
    for (const pr of merged.data?.prs ?? []) byId.set(pr.id, pr);
    const prs = [...byId.values()];
    return { ...open.data, prs, buckets: bucketize(prs) };
  }, [open.data, merged.data]);
  const refetchOpen = open.refetch;
  const refetchMerged = merged.refetch;
  const refetch = useCallback(
    () => Promise.all([refetchOpen(), refetchMerged()]),
    [refetchOpen, refetchMerged]
  );
  return {
    ...open,
    data,
    refetch,
    mergedError: merged.error,
    mergedLoading: merged.isLoading,
    retryMerged: merged.refetch,
  };

}
