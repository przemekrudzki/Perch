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
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    updatedAt: now,
    createdAt: now,
    mergedAt: null,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    totalCommentsCount: 0,
    body: '',
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
    mergedAuthored: { nodes: [] },
    mergedReviewed: { nodes: [] },
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
            id: 'R1',
            author: { login: 'bob' },
            state: 'CHANGES_REQUESTED',
            submittedAt: t1,
            body: 'Please fix the migration',
            comments: { nodes: [] },
          },
          {
            id: 'R2',
            author: { login: 'carol' },
            state: 'COMMENTED',
            submittedAt: t2,
            body: '',
            comments: { nodes: [] },
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

  it('excludes the PR author from reviewer/approval tallies', () => {
    // Author somehow surfaces in the reviews connection (e.g. they
    // submitted review-thread comments on their own PR).
    const pr = makeGqlPR({
      author: { login: 'alice' },
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'alice' },
            state: 'COMMENTED',
            submittedAt: '2026-04-25T10:00:00Z',
            body: 'self-note',
            comments: { nodes: [] },
          },
          {
            id: 'R2',
            author: { login: 'bob' },
            state: 'APPROVED',
            submittedAt: '2026-04-25T11:00:00Z',
            body: '',
            comments: { nodes: [] },
          },
        ],
      },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.approvalCount).toBe(1);
    expect(out.reviewerCount).toBe(1); // not 2 — author shouldn't count
    expect(out.reviewers.map((r) => r.login)).toEqual(['bob']);
  });

  it('excludes [bot] reviewers from approval tallies but keeps them in the timeline', () => {
    const pr = makeGqlPR({
      author: { login: 'alice' },
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'cursor[bot]' },
            state: 'COMMENTED',
            submittedAt: '2026-04-25T10:00:00Z',
            body: 'Cursor Bugbot has reviewed your changes.',
            comments: { nodes: [] },
          },
          {
            id: 'R2',
            author: { login: 'bob' },
            state: 'APPROVED',
            submittedAt: '2026-04-25T11:00:00Z',
            body: '',
            comments: { nodes: [] },
          },
        ],
      },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.approvalCount).toBe(1);
    expect(out.reviewerCount).toBe(1); // bot doesn't count
    expect(out.reviewers.map((r) => r.login)).toEqual(['bob']);
    // Timeline should still surface what the bot said
    const reviewKinds = out.timeline.map((e) => e.kind);
    expect(reviewKinds).toContain('review-comment');
  });

  it('attaches the PR description to the opened timeline event', () => {
    const pr = makeGqlPR({
      body: 'Resolves KRIT-487. Migrates the LTI launcher to v1.3.',
    });
    const tl = transformDashboard(makeResponse([pr])).prs[0]!.timeline;
    expect(tl[0]!.kind).toBe('opened');
    expect(tl[0]!.body).toContain('KRIT-487');
  });

  it('omits the opened body when the description is empty', () => {
    const pr = makeGqlPR({ body: '   \n\n  ' });
    const tl = transformDashboard(makeResponse([pr])).prs[0]!.timeline;
    expect(tl[0]!.kind).toBe('opened');
    expect(tl[0]!.body).toBeUndefined();
  });

  it('flags merged PRs and preserves mergedAt', () => {
    const mergedPR = makeGqlPR({
      id: 'MERGED',
      state: 'MERGED',
      mergedAt: '2026-04-22T10:00:00Z',
    });
    const res = {
      viewer: {
        login: 'me',
        avatarUrl: '',
        pullRequests: { nodes: [] },
      },
      reviewRequested: { nodes: [] },
      mergedAuthored: { nodes: [] },
      mergedReviewed: { nodes: [mergedPR] },
      rateLimit: { remaining: 5000, resetAt: new Date().toISOString() },
    };
    const out = transformDashboard(res);
    expect(out.prs).toHaveLength(1);
    expect(out.prs[0]!.isMerged).toBe(true);
    expect(out.prs[0]!.mergedAt).toBe('2026-04-22T10:00:00Z');
  });

  it('dedupes a PR that appears in both mergedAuthored and mergedReviewed', () => {
    const pr = makeGqlPR({
      id: 'DOUBLE',
      state: 'MERGED',
      mergedAt: '2026-04-22T10:00:00Z',
    });
    const res = {
      viewer: {
        login: 'me',
        avatarUrl: '',
        pullRequests: { nodes: [] },
      },
      reviewRequested: { nodes: [] },
      mergedAuthored: { nodes: [pr] },
      mergedReviewed: { nodes: [pr] },
      rateLimit: { remaining: 5000, resetAt: new Date().toISOString() },
    };
    const out = transformDashboard(res);
    expect(out.prs).toHaveLength(1);
  });

  it('surfaces inline review comments even when the review body is empty', () => {
    const pr = makeGqlPR({
      createdAt: '2026-04-20T10:00:00Z',
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'bob' },
            state: 'COMMENTED',
            submittedAt: '2026-04-20T11:00:00Z',
            body: '',
            comments: {
              nodes: [
                {
                  id: 'RC1',
                  body: 'nit: naming',
                  path: 'src/foo.ts',
                  line: 42,
                  originalLine: 42,
                  createdAt: '2026-04-20T11:00:05Z',
                },
                {
                  id: 'RC2',
                  body: 'also: null check',
                  path: 'src/bar.ts',
                  line: 17,
                  originalLine: null,
                  createdAt: '2026-04-20T11:00:10Z',
                },
              ],
            },
          },
        ],
      },
    });
    const tl = transformDashboard(makeResponse([pr])).prs[0]!.timeline;
    const kinds = tl.map((e) => e.kind);
    // Two inline-comment events after "opened"; no review-level event
    // because the top-level body was empty.
    expect(kinds).toEqual(['opened', 'inline-comment', 'inline-comment']);
    expect(tl[1]!.path).toBe('src/foo.ts');
    expect(tl[1]!.line).toBe(42);
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
      mergedAuthored: { nodes: [pr] },
      mergedReviewed: { nodes: [pr] },
      rateLimit: { remaining: 5000, resetAt: new Date().toISOString() },
    };
    const out = transformDashboard(res);
    expect(out.prs).toHaveLength(1);
  });
});
