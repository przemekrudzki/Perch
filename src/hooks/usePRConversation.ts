import { useQuery } from '@tanstack/react-query';
import { fetchConversation } from '../lib/github';
import { buildTimeline } from '../lib/transform';
import { useUIStore } from '../store';

/** Mounted only for the selected drawer; cache is isolated by account and PR. */
export function usePRConversation(id: string, updatedAt: string) {
  const token = useUIStore((s) => s.token);
  return useQuery({
    queryKey: ['pr-conversation', token, id, updatedAt],
    enabled: Boolean(token),
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      if (!token) throw new Error('Missing token');
      return buildTimeline(await fetchConversation(token, id, signal));
    },
    retry: false,
  });
}
