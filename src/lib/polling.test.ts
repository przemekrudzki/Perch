import { afterEach, describe, expect, it, vi } from 'vitest';
import { budgetInterval, createDashboardPolling, PollingPausedError, rateLimitRetryAt } from './polling';

const now = Date.parse('2026-11-06T12:00:00Z');
const budget = { cost: 5, remaining: 4000, resetAt: new Date(now + 3_600_000).toISOString() };
afterEach(() => vi.restoreAllMocks());

describe('budget-aware polling', () => {
  it('uses fast foreground and slower background intervals when affordable', () => {
    expect(budgetInterval(budget, 15_000, now)).toBe(15_000);
    expect(budgetInterval(budget, 60_000, now)).toBe(60_000);
    expect(budgetInterval(undefined, 15_000, now)).toBe(60_000);
  });
  it('paces expensive queries while reserving half the budget', () => {
    expect(budgetInterval({ ...budget, cost: 39 }, 15_000, now)).toBe(70_200);
    expect(budgetInterval({ ...budget, remaining: 100 }, 15_000, now)).toBe(360_000);
  });
  it('waits for reset when a query cannot be afforded and recovers after reset', () => {
    expect(budgetInterval({ ...budget, remaining: 0 }, 15_000, now)).toBe(3_601_000);
    expect(budgetInterval(budget, 15_000, now + 3_601_000)).toBe(15_000);
  });
  it('honors reset and retry-after headers and backs off secondary limits', () => {
    const response = { status: 403, headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((now + 600_000) / 1000) }) };
    expect(rateLimitRetryAt({ response }, now, 0)).toBe(now + 601_000);
    expect(rateLimitRetryAt({ response: { status: 429, headers: new Headers({ 'retry-after': '180' }) } }, now, 0)).toBe(now + 180_000);
    expect(rateLimitRetryAt(new Error('secondary rate limit'), now, 2)).toBe(now + 240_000);
    expect(rateLimitRetryAt(new Error('Network error'), now, 0)).toBeUndefined();
  });
  it('blocks both query kinds during cooldown, including manual calls, then resumes', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const polling = createDashboardPolling();
    await expect(polling.run('open', async () => { throw new Error('rate limit exceeded'); })).rejects.toBeInstanceOf(PollingPausedError);
    const fetch = vi.fn(async () => ({ rateLimit: budget }));
    await expect(polling.run('merged', fetch)).rejects.toBeInstanceOf(PollingPausedError);
    expect(fetch).not.toHaveBeenCalled();
    expect(polling.interval('open', 15_000)).toBe(60_000);
    clock.mockReturnValue(now + 60_000);
    await polling.run('open', fetch);
    expect(fetch).toHaveBeenCalledOnce();
    expect(polling.interval('open', 15_000)).toBe(15_000);
  });
  it('keeps separate query costs and the lower remaining budget for out-of-order responses', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const polling = createDashboardPolling();
    await polling.run('open', async () => ({ rateLimit: { ...budget, cost: 39, remaining: 2000 } }));
    await polling.run('merged', async () => ({ rateLimit: { ...budget, cost: 2, remaining: 2100 } }));
    expect(polling.interval('open', 15_000)).toBe(140_400);
    expect(polling.interval('merged', 300_000)).toBe(300_000);
  });
});
