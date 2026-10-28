import { useQuery } from '@tanstack/react-query';
import { fetchPipeline } from '../lib/pipeline';
import { useUIStore } from '../store';
import type { DashboardPR } from '../types/dashboard';

export function usePipeline(pr: DashboardPR, detail = false) {
  const token = useUIStore((s) => s.token);
  return useQuery({
    queryKey: ['pipeline', token, pr.repoNameWithOwner, pr.headSha],
    enabled: Boolean(
      token &&
      pr.headSha &&
      (detail || (!pr.isMerged && pr.ciStatus === 'pending')),
    ),
    queryFn: ({ signal }) =>
      fetchPipeline(token!, pr.repoNameWithOwner, pr.headSha, signal),
    staleTime: 30_000,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      const active = query.state.data?.some(
        (run) => run.status !== 'completed',
      );
      return active || pr.ciStatus === 'pending'
        ? detail
          ? 15_000
          : 60_000
        : false;
    },
    refetchIntervalInBackground: false,
    retry: false,
  });
}
