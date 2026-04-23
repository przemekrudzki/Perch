import { describe, expect, it } from 'vitest';
import { transformDashboard } from './transform';
import type { GqlDashboardResponse, GqlPullRequest } from '../types/github';

function makeGqlPR(overrides: Partial<GqlPullRequest> = {}): GqlPullRequest {
  const now = new Date().toISOString();
  const base: GqlPullRequest = {
    id: 'PR_1',
    number: 1,
    title: 'Example',
    url: 'https://github.com/example/repo/pull/1',
    isDraft: false,
    mergeable: 'MERGEABLE',
    updatedAt: now,
    createdAt: now,
    repository: { nameWithOwner: 'example/repo', isArchived: false },
    author: { login: 'alice' },
    assignees: { nodes: [] },
    reviewRequests: { nodes: [] },
    reviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    labels: { nodes: [] },
  };
  return { ...base, ...overrides };
}

function makeResponse(prs: GqlPullRequest[]): GqlDashboardResponse {
  return {
    viewer: {
      login: 'me',
      avatarUrl: '',
      pullRequests: { nodes: prs },
    },
    reviewRequested: { nodes: [] },
    rateLimit: { remaining: 5000, resetAt: new Date().toISOString() },
  };
}

describe('transformDashboard', () => {
  it('drops PRs from archived repositories', () => {
    const active = makeGqlPR({ id: 'LIVE' });
    const archived = makeGqlPR({
      id: 'DEAD',
      repository: { nameWithOwner: 'example/old', isArchived: true },
    });
    const out = transformDashboard(makeResponse([active, archived]));
    expect(out.prs.map((p) => p.id)).toEqual(['LIVE']);
  });

  it('dedupes a PR that appears in multiple result sets', () => {
    const pr = makeGqlPR({ id: 'SAME' });
    const res: GqlDashboardResponse = {
      viewer: {
        login: 'me',
        avatarUrl: '',
        pullRequests: { nodes: [pr] },
      },
      reviewRequested: { nodes: [pr] },
      teamPrs: { nodes: [pr] },
      rateLimit: { remaining: 5000, resetAt: new Date().toISOString() },
    };
    const out = transformDashboard(res);
    expect(out.prs).toHaveLength(1);
  });
});
