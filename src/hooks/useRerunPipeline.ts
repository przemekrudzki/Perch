import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { rerunPipeline, type RerunResult } from '../lib/rerun';
import { useUIStore } from '../store';

export interface RerunPipelineVars {
  /** owner/name of the repo the PR lives in. */
  repoNameWithOwner: string;
  /** SHA of the PR's head commit — DashboardPR.headSha. */
  headSha: string;
}

/**
 * Re-run all Actions workflows for a PR's head commit. Works on green
 * pipelines too (the point: redeploy nightly-killed branch sandboxes).
 * On success the dashboard query is invalidated so the CI chip flips
 * to "Running" on the next fetch instead of lying green for a minute.
 */
export function useRerunPipeline(): UseMutationResult<
  RerunResult,
  Error,
  RerunPipelineVars
> {
  const token = useUIStore((s) => s.token);
  const queryClient = useQueryClient();

  return useMutation<RerunResult, Error, RerunPipelineVars>({
    mutationFn: async ({ repoNameWithOwner, headSha }) => {
      if (!token) throw new Error('Missing token');
      return rerunPipeline(token, repoNameWithOwner, headSha);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
      ]);
    },
  });
}
