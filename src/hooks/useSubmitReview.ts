import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { submitReview, type ReviewEvent } from '../lib/github';
import { useUIStore } from '../store';

export interface SubmitReviewVars {
  /** GraphQL node id of the PR — DashboardPR.id. */
  pullRequestId: string;
  /** The review verdict to submit. */
  event: ReviewEvent;
  /** Review message. Empty allowed for APPROVE; required for the others (gated upstream). */
  body: string;
}

/**
 * Submit a PR review and refresh the dashboard on success. No
 * optimistic update: GitHub is the single source of truth, and
 * invalidating the query keeps the modal's Approval card and the list
 * in sync without hand-maintained patches.
 */
export function useSubmitReview(): UseMutationResult<
  void,
  Error,
  SubmitReviewVars
> {
  const token = useUIStore((s) => s.token);
  const queryClient = useQueryClient();

  return useMutation<void, Error, SubmitReviewVars>({
    mutationFn: async ({ pullRequestId, event, body }) => {
      if (!token) throw new Error('Missing token');
      return submitReview(token, pullRequestId, event, body);
    },
    onSuccess: async (_data, { pullRequestId }) => {
      // Prefix match: usePRs keys its query ['dashboard', token, scope,
      // orgs], so ['dashboard'] invalidates every variant. Awaited so the
      // mutation stays pending until the refreshed list is in flight.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['pr-conversation', token, pullRequestId] }),
      ]);
    },
  });
}
