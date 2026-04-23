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
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    repository: { nameWithOwner: 'example/repo', isArchived: false },
    author: { login: 'alice' },
    assignees: { nodes: [] },
    reviewRequests: { nodes: [] },
    reviews: { nodes: [] },
    comments: { nodes: [] },
    commits: {
      totalCount: 1,
      nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }],
    },
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

  it('builds a timeline: opened + reviews + comments, sorted by time', () => {
    const t0 = '2026-04-20T10:00:00Z';
    const t1 = '2026-04-20T11:00:00Z';
    const t2 = '2026-04-20T12:00:00Z';
    const t3 = '2026-04-20T13:00:00Z';
    const pr = makeGqlPR({
      createdAt: t0,
      updatedAt: t3,
      reviews: {
        nodes: [
          {
            author: { login: 'bob' },
            state: 'CHANGES_REQUESTED',
            submittedAt: t1,
            body: 'Please fix the migration',
          },
          {
            author: { login: 'carol' },
            state: 'COMMENTED',
            submittedAt: t2,
            body: '',
          },
        ],
      },
      comments: {
        nodes: [
          {
            id: 'C1',
            author: { login: 'dave' },
            body: 'Thanks for the fix!',
            createdAt: t3,
          },
        ],
      },
    });
    const out = transformDashboard(makeResponse([pr]));
    const tl = out.prs[0]!.timeline;
    expect(tl.map((e) => e.kind)).toEqual([
      'opened',
      'review-changes',
      'comment',
    ]);
    expect(tl[1]!.body).toBe('Please fix the migration');
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
