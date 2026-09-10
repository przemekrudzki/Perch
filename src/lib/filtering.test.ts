import { describe, expect, it } from 'vitest';
import { filterPRs } from './filtering';
import type { DashboardPR } from '../types/dashboard';

function makePR(
  id: string,
  author: string,
  overrides: Partial<DashboardPR> = {}
): DashboardPR {
  return {
    id,
    number: 1,
    title: 'Improve the dashboard',
    url: `https://github.com/acme/perch/pull/${id}`,
    jiraTicketKey: null,
    isDraft: false,
    mergeable: 'MERGEABLE',
    updatedAt: '2026-07-22T12:00:00Z',
    createdAt: '2026-07-22T10:00:00Z',
    repoNameWithOwner: 'acme/perch',
    mergeMethod: 'SQUASH',
    author: { login: author, av: 'a' },
    viewerIsAuthor: false,
    viewerIsRequestedReviewer: false,
    approvalCount: 0,
    reviewerCount: 0,
    approvalState: 'pending',
    viewerReviewState: 'none',
    ciStatus: 'none',
    labels: [],
    reviewers: [],
    waitingTimeMs: 0,
    escalate: false,
    isMerged: false,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commitCount: 1,
    headRefName: 'feature',
    headSha: 'abc123',
    baseRefName: 'main',
    commentCount: 0,
    lastCommitAt: null,
    lastCommentAt: null,
    timeline: [],
    ...overrides,
  };
}

describe('filterPRs', () => {
  const alice = makePR('alice-open', 'Alice');
  const aliceMerged = makePR('alice-merged', 'alice', {
    isMerged: true,
    mergedAt: '2026-07-22T11:00:00Z',
  });
  const bob = makePR('bob-open', 'bob', {
    title: 'Fix the settings panel',
    labels: [{ name: 'frontend', tone: 'info', color: '6aa9ff' }],
  });
  const prs = [alice, aliceMerged, bob];

  it.each(['817', '#817', ' 817 ', ' #817 '])(
    'matches the exact PR number with query %s',
    (query) => {
      const target = makePR('target', 'alice', { number: 817 });
      const other = makePR('other', 'alice', { number: 1817 });

      expect(
        filterPRs([target, other], { query, authorLogin: null })
      ).toEqual([target]);
    }
  );

  it('combines PR-number matching with the author filter', () => {
    const target = makePR('target', 'alice', { number: 817 });
    const otherAuthor = makePR('other', 'bob', { number: 817 });

    expect(
      filterPRs([target, otherAuthor], { query: '817', authorLogin: 'alice' })
    ).toEqual([target]);
  });

  it('matches an author exactly and case-insensitively', () => {
    expect(
      filterPRs(prs, { query: '', authorLogin: 'ALICE' }).map((pr) => pr.id)
    ).toEqual(['alice-open', 'alice-merged']);
  });

  it('does not treat the author filter as a substring search', () => {
    expect(
      filterPRs([alice, makePR('al', 'al')], {
        query: '',
        authorLogin: 'al',
      }).map((pr) => pr.id)
    ).toEqual(['al']);
  });

  it('combines free-text and author filters', () => {
    expect(
      filterPRs(prs, { query: 'dashboard', authorLogin: 'alice' }).map(
        (pr) => pr.id
      )
    ).toEqual(['alice-open', 'alice-merged']);

    expect(
      filterPRs(prs, { query: 'frontend', authorLogin: 'alice' })
    ).toEqual([]);
  });

  it('preserves all PRs when both filters are empty', () => {
    expect(filterPRs(prs, { query: '  ', authorLogin: null })).toEqual(prs);
  });
});
