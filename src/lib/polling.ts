/** GitHub's measured cost and remaining hourly GraphQL budget. */
export interface PollingBudget {
  cost: number;
  remaining: number;
  resetAt: string;
}

export class PollingPausedError extends Error {
  constructor(public readonly retryAt: number) {
    super('GitHub rate limit reached. Refresh will resume automatically.');
  }
}

export function budgetInterval(budget: PollingBudget | undefined, base: number, now: number): number {
  if (!budget) return Math.max(base, 60_000);
  const untilReset = Date.parse(budget.resetAt) - now;
  if (!Number.isFinite(untilReset) || untilReset <= 0) return base;
  // Reserve half the remaining budget for merged PRs, details, and other clients.
  if (budget.remaining < Math.max(1, budget.cost)) return Math.max(base, untilReset + 1_000);
  return Math.max(base, Math.ceil(Math.max(1, budget.cost) * untilReset / (budget.remaining * 0.5)));
}

export function rateLimitRetryAt(error: unknown, now: number, failures: number): number | undefined {
  const err = error as {
    message?: string;
    response?: { status?: number; headers?: Headers; errors?: { type?: string; message?: string }[] };
  } | null;
  const headers = err?.response?.headers;
  const remaining = headers?.get('x-ratelimit-remaining');
  const limited = remaining === '0' || err?.response?.status === 429 ||
    err?.response?.errors?.some((item) => item.type === 'RATE_LIMITED') ||
    /rate.?limit|secondary rate|abuse detection/i.test(err?.message ?? '');
  if (!limited) return undefined;
  const reset = remaining === '0' ? (Number(headers?.get('x-ratelimit-reset')) || 0) * 1_000 : 0;
  const retry = (Number(headers?.get('retry-after')) || 0) * 1_000;
  return Math.max(now + Math.min(60_000 * 2 ** failures, 3_600_000), reset + 1_000, now + retry);
}

/** Shared by the open and merged queries, including manual/focus refreshes. */
export function createDashboardPolling() {
  let budget: PollingBudget | undefined;
  const costs = { open: 0, merged: 0 };
  let retryAt = 0;
  let failures = 0;
  return {
    interval(kind: 'open' | 'merged', base: number, now = Date.now()) {
      return Math.max(
        retryAt - now,
        budgetInterval(budget && { ...budget, cost: costs[kind] || budget.cost }, base, now),
      );
    },
    async run<T extends { rateLimit: PollingBudget }>(kind: 'open' | 'merged', fetch: () => Promise<T>): Promise<T> {
      if (Date.now() < retryAt) throw new PollingPausedError(retryAt);
      try {
        const result = await fetch();
        const next = result.rateLimit;
        // Concurrent responses can arrive out of order within the same window.
        budget = budget?.resetAt === next.resetAt
          ? { ...next, remaining: Math.min(budget.remaining, next.remaining) }
          : next;
        costs[kind] = next.cost;
        if (next.remaining === 0) retryAt = Date.parse(next.resetAt) + 1_000;
        failures = 0;
        return result;
      } catch (error) {
        const nextRetry = rateLimitRetryAt(error, Date.now(), failures);
        if (nextRetry !== undefined) {
          retryAt = Math.max(retryAt, nextRetry);
          failures++;
          throw new PollingPausedError(retryAt);
        }
        throw error;
      }
    },
  };
}
