import { describe, expect, it } from 'vitest';
import { transformDashboard, buildTimeline } from './transform';
import type { GqlDashboardResponse, GqlPullRequest, GqlPRSummary } from '../types/github';

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
    headRefName: 'feature/example',
    headRefOid: 'abc123def456',
    baseRefName: 'main',
    repository: {
      nameWithOwner: 'example/repo',
      isArchived: false,
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
    },
    author: { login: 'alice' },
    assignees: { nodes: [] },
    reviewRequests: { nodes: [] },
    reviews: { nodes: [] },
    comments: { nodes: [] },
    commits: {
      totalCount: 1,
      nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }],
    },
    headRef: { target: { committedDate: now } },
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
  it('transforms an open-only response without conversation bodies', () => {
    const summary: GqlPRSummary = {
      ...makeGqlPR({ body: 'See KRIT-123', totalCommentsCount: 42 }),
      comments: { nodes: [
        { createdAt: '2026-09-10T12:00:00Z', author: { login: 'teammate' } },
        { createdAt: '2026-09-10T13:00:00Z', author: { login: 'me' } },
      ] },
      reviews: { nodes: [{
        id: 'review', author: { login: 'reviewer' }, state: 'APPROVED',
        submittedAt: '2026-09-10T10:00:00Z',
        comments: { nodes: [{ createdAt: '2026-09-10T11:00:00Z' }] },
      }] },
    };
    const response = makeResponse([]);
    delete response.mergedAuthored;
    delete response.mergedReviewed;
    response.viewer.pullRequests.nodes = [summary];
    const pr = transformDashboard(response).prs[0]!;
    expect(pr.approvalCount).toBe(1);
    expect(pr.commentCount).toBe(42);
    expect(pr.lastCommentAt).toBe('2026-09-10T13:00:00Z');
    expect(pr.lastForeignCommentAt).toBe('2026-09-10T12:00:00Z');
    expect(pr.jiraTicketKey).toBe('KRIT-123');
    expect(pr.timeline).toEqual([]);
  });

  it('infers the Jira ticket from branch, title, then description', () => {
    const fromBranch = makeGqlPR({
      id: 'BRANCH',
      headRefName: 'feature/krit-1431-discard-draft',
      title: 'KRIT-1460 Add attachment drawer',
      body: 'Resolves KRIT-1314.',
    });
    const fromTitle = makeGqlPR({
      id: 'TITLE',
      headRefName: 'feature/attachment-drawer',
      title: 'KRIT-1460 Add attachment drawer',
      body: 'Resolves KRIT-1314.',
    });
    const fromBody = makeGqlPR({
      id: 'BODY',
      headRefName: 'feature/attachment-drawer',
      title: 'Add attachment drawer',
      body: 'Resolves KRIT-1314.',
    });
    const withoutTicket = makeGqlPR({ id: 'NONE' });

    const out = transformDashboard(
      makeResponse([fromBranch, fromTitle, fromBody, withoutTicket])
    );

    expect(out.prs.map((pr) => [pr.id, pr.jiraTicketKey])).toEqual([
      ['BRANCH', 'KRIT-1431'],
      ['TITLE', 'KRIT-1460'],
      ['BODY', 'KRIT-1314'],
      ['NONE', null],
    ]);
  });

  it('drops PRs from archived repositories', () => {
    const active = makeGqlPR({ id: 'LIVE' });
    const archived = makeGqlPR({
      id: 'DEAD',
      repository: {
        nameWithOwner: 'example/old',
        isArchived: true,
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
      },
    });
    const out = transformDashboard(makeResponse([active, archived]));
    expect(out.prs.map((p) => p.id)).toEqual(['LIVE']);
  });

  it('uses the first merge method enabled by the repository', () => {
    const squashOnly = makeGqlPR({
      repository: {
        nameWithOwner: 'example/repo',
        isArchived: false,
        mergeCommitAllowed: false,
        squashMergeAllowed: true,
        rebaseMergeAllowed: false,
      },
    });

    expect(transformDashboard(makeResponse([squashOnly])).prs[0]!.mergeMethod).toBe(
      'SQUASH',
    );
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
    const tl = buildTimeline(pr);
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

  it('excludes known account-style bots like @cursor from reviewer tallies', () => {
    const pr = makeGqlPR({
      author: { login: 'alice' },
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'cursor' }, // no [bot] suffix
            state: 'COMMENTED',
            submittedAt: '2026-04-25T10:00:00Z',
            body: 'Cursor Bugbot review.',
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
    expect(out.reviewers.map((r) => r.login)).toEqual(['bob']);
    expect(out.reviewerCount).toBe(1);
  });

  it('excludes @coderabbitai from reviewer tallies', () => {
    const pr = makeGqlPR({
      author: { login: 'alice' },
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'coderabbitai' }, // no [bot] suffix
            state: 'COMMENTED',
            submittedAt: '2026-04-25T10:00:00Z',
            body: 'Actionable comments posted: 3',
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
    expect(out.reviewers.map((r) => r.login)).toEqual(['bob']);
    expect(out.reviewerCount).toBe(1);
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
    const reviewKinds = buildTimeline(pr).map((e) => e.kind);
    expect(reviewKinds).toContain('review-comment');
  });

  it('keeps a standing CHANGES_REQUESTED verdict when the reviewer comments afterwards', () => {
    // Real-world repro (kritik#407): a reviewer requests changes, then
    // leaves one more inline comment seconds later. GitHub records the
    // follow-up as a separate COMMENTED review, but the PR is still
    // blocked — a comment never clears a standing verdict.
    const pr = makeGqlPR({
      author: { login: 'alice' },
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'bob' },
            state: 'CHANGES_REQUESTED',
            submittedAt: '2026-07-13T21:18:14Z',
            body: '',
            comments: { nodes: [] },
          },
          {
            id: 'R2',
            author: { login: 'bob' },
            state: 'COMMENTED',
            submittedAt: '2026-07-13T21:18:42Z',
            body: '',
            comments: {
              nodes: [
                {
                  id: 'RC1',
                  body: 'one more thing',
                  path: 'src/x.ts',
                  line: 3,
                  originalLine: 3,
                  createdAt: '2026-07-13T21:18:42Z',
                },
              ],
            },
          },
        ],
      },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.approvalState).toBe('changes');
    expect(out.reviewers.find((r) => r.login === 'bob')!.state).toBe('changes');
  });

  it('keeps a standing APPROVED verdict when the reviewer comments afterwards', () => {
    const pr = makeGqlPR({
      author: { login: 'alice' },
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'bob' },
            state: 'APPROVED',
            submittedAt: '2026-07-13T10:00:00Z',
            body: '',
            comments: { nodes: [] },
          },
          {
            id: 'R2',
            author: { login: 'bob' },
            state: 'COMMENTED',
            submittedAt: '2026-07-13T11:00:00Z',
            body: 'follow-up thought',
            comments: { nodes: [] },
          },
        ],
      },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.approvalState).toBe('approved');
    expect(out.approvalCount).toBe(1);
    expect(out.reviewers.find((r) => r.login === 'bob')!.state).toBe('approved');
  });

  it('lets a newer opinionated review replace an older verdict', () => {
    // changes → (comment) → approve must land on approved.
    const pr = makeGqlPR({
      author: { login: 'alice' },
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'bob' },
            state: 'CHANGES_REQUESTED',
            submittedAt: '2026-07-13T10:00:00Z',
            body: '',
            comments: { nodes: [] },
          },
          {
            id: 'R2',
            author: { login: 'bob' },
            state: 'COMMENTED',
            submittedAt: '2026-07-13T11:00:00Z',
            body: 'replying to your fix',
            comments: { nodes: [] },
          },
          {
            id: 'R3',
            author: { login: 'bob' },
            state: 'APPROVED',
            submittedAt: '2026-07-13T12:00:00Z',
            body: '',
            comments: { nodes: [] },
          },
        ],
      },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.approvalState).toBe('approved');
    expect(out.reviewers.find((r) => r.login === 'bob')!.state).toBe('approved');
  });

  it("keeps the viewer's own verdict when they comment afterwards", () => {
    const pr = makeGqlPR({
      author: { login: 'alice' },
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'me' },
            state: 'CHANGES_REQUESTED',
            submittedAt: '2026-07-13T10:00:00Z',
            body: '',
            comments: { nodes: [] },
          },
          {
            id: 'R2',
            author: { login: 'me' },
            state: 'COMMENTED',
            submittedAt: '2026-07-13T11:00:00Z',
            body: 'ping',
            comments: { nodes: [] },
          },
        ],
      },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.viewerReviewState).toBe('changes');
  });

  it('recovers a verdict that fell out of the reviews window via latestOpinionatedReviews', () => {
    // On chatty PRs the CHANGES_REQUESTED review can age out of
    // reviews(last: 20) while follow-up chatter stays in. The
    // latestOpinionatedReviews connection still carries the verdict.
    const pr = makeGqlPR({
      author: { login: 'alice' },
      reviews: {
        nodes: [
          {
            id: 'R2',
            author: { login: 'bob' },
            state: 'COMMENTED',
            submittedAt: '2026-07-13T22:00:00Z',
            body: 'still discussing',
            comments: { nodes: [] },
          },
        ],
      },
      latestOpinionatedReviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'bob' },
            state: 'CHANGES_REQUESTED',
            submittedAt: '2026-07-13T21:18:14Z',
          },
        ],
      },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.approvalState).toBe('changes');
    expect(out.reviewers.find((r) => r.login === 'bob')!.state).toBe('changes');
  });

  it('attaches the PR description to the opened timeline event', () => {
    const pr = makeGqlPR({
      body: 'Resolves KRIT-487. Migrates the LTI launcher to v1.3.',
    });
    const tl = buildTimeline(pr);
    expect(tl[0]!.kind).toBe('opened');
    expect(tl[0]!.body).toContain('KRIT-487');
  });

  it('omits the opened body when the description is empty', () => {
    const pr = makeGqlPR({ body: '   \n\n  ' });
    const tl = buildTimeline(pr);
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
    const tl = buildTimeline(pr);
    const kinds = tl.map((e) => e.kind);
    // Two inline-comment events after "opened"; no review-level event
    // because the top-level body was empty.
    expect(kinds).toEqual(['opened', 'inline-comment', 'inline-comment']);
    expect(tl[1]!.path).toBe('src/foo.ts');
    expect(tl[1]!.line).toBe(42);
  });

  it('marks inline comment side based on which line field is set', () => {
    const pr = makeGqlPR({
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'bob' },
            state: 'COMMENTED',
            submittedAt: '2026-04-25T11:00:00Z',
            body: '',
            comments: {
              nodes: [
                // New-side: `line` is set.
                {
                  id: 'C_NEW',
                  body: 'on the addition',
                  path: 'src/x.ts',
                  line: 30,
                  originalLine: null,
                  createdAt: '2026-04-25T11:00:01Z',
                },
                // Old-side: only `originalLine` is set (rare; comment
                // on a deleted line).
                {
                  id: 'C_OLD',
                  body: 'on the deletion',
                  path: 'src/x.ts',
                  line: null as unknown as number,
                  originalLine: 30,
                  createdAt: '2026-04-25T11:00:02Z',
                },
              ],
            },
          },
        ],
      },
    });
    const tl = buildTimeline(pr).filter(
      (e) => e.kind === 'inline-comment'
    );
    expect(tl).toHaveLength(2);
    expect(tl[0]!.line).toBe(30);
    expect(tl[0]!.side).toBe('new');
    expect(tl[1]!.line).toBe(30);
    expect(tl[1]!.side).toBe('old');
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
      mergedTeam: { nodes: [pr] },
      rateLimit: { remaining: 5000, resetAt: new Date().toISOString() },
    };
    const out = transformDashboard(res);
    expect(out.prs).toHaveLength(1);
  });

  it('derives lastCommitAt from headRef.target.committedDate', () => {
    const committed = '2026-04-25T12:34:56Z';
    const pr = makeGqlPR({
      headRef: { target: { committedDate: committed } },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.lastCommitAt).toBe(committed);
  });

  it('returns null lastCommitAt when headRef is missing', () => {
    const pr = makeGqlPR({ headRef: null });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.lastCommitAt).toBeNull();
  });

  it('derives lastCommentAt as the max across issue, review, and inline timestamps', () => {
    const t1 = '2026-04-20T10:00:00Z'; // issue comment
    const t2 = '2026-04-21T10:00:00Z'; // review submission
    const t3 = '2026-04-22T10:00:00Z'; // inline review comment (most recent)
    const pr = makeGqlPR({
      comments: {
        nodes: [
          { id: 'C1', author: { login: 'a' }, body: 'hi', createdAt: t1 },
        ],
      },
      reviews: {
        nodes: [
          {
            id: 'R1',
            author: { login: 'b' },
            state: 'COMMENTED',
            submittedAt: t2,
            body: 'looking',
            comments: {
              nodes: [
                {
                  id: 'IC1',
                  body: 'nit',
                  path: 'src/x.ts',
                  line: 1,
                  originalLine: 1,
                  createdAt: t3,
                },
              ],
            },
          },
        ],
      },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.lastCommentAt).toBe(t3);
  });

  it('returns null lastCommentAt for a PR with no comments or reviews', () => {
    const pr = makeGqlPR({
      comments: { nodes: [] },
      reviews: { nodes: [] },
    });
    const out = transformDashboard(makeResponse([pr])).prs[0]!;
    expect(out.lastCommentAt).toBeNull();
  });

  it('surfaces team-merged PRs the viewer never touched', () => {
    // PR merged by a teammate in a tracked org. Doesn't appear in
    // mergedAuthored or mergedReviewed because the viewer wasn't
    // involved — only in mergedTeam.
    const teammateMerge = makeGqlPR({
      id: 'TEAM_MERGED',
      state: 'MERGED',
      mergedAt: '2026-04-22T10:00:00Z',
      author: { login: 'someone-else' },
    });
    const res: GqlDashboardResponse = {
      viewer: {
        login: 'me',
        avatarUrl: '',
        pullRequests: { nodes: [] },
      },
      reviewRequested: { nodes: [] },
      mergedAuthored: { nodes: [] },
      mergedReviewed: { nodes: [] },
      mergedTeam: { nodes: [teammateMerge] },
      rateLimit: { remaining: 5000, resetAt: new Date().toISOString() },
    };
    const out = transformDashboard(res);
    expect(out.prs).toHaveLength(1);
    expect(out.prs[0]!.id).toBe('TEAM_MERGED');
    expect(out.prs[0]!.isMerged).toBe(true);
  });
});
