// Hand-typed GraphQL response shapes for the PRDashboard query.
// Kept narrow: only the fields we actually read.

export type ReviewState =
  | 'PENDING'
  | 'COMMENTED'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'DISMISSED';

export type StatusState =
  | 'EXPECTED'
  | 'ERROR'
  | 'FAILURE'
  | 'PENDING'
  | 'SUCCESS';

export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';

export interface GqlUser {
  login: string;
  avatarUrl?: string;
}

export interface GqlTeam {
  name: string;
}

export type GqlRequestedReviewer =
  | ({ __typename: 'User' } & GqlUser)
  | ({ __typename: 'Team' } & GqlTeam)
  | { __typename: string };

export interface GqlReviewComment {
  id: string;
  body: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  createdAt: string;
}

export interface GqlReview {
  id: string;
  author: GqlUser | null;
  state: ReviewState;
  submittedAt: string | null;
  body: string;
  comments: { nodes: GqlReviewComment[] };
}

/**
 * Node of `latestOpinionatedReviews` — GitHub returns each reviewer's
 * latest APPROVED/CHANGES_REQUESTED review (dismissed ones excluded).
 * No body/comments: it only exists to carry verdicts that may have
 * aged out of the `reviews(last: N)` window.
 */
export interface GqlOpinionatedReview {
  id: string;
  author: GqlUser | null;
  state: ReviewState;
  submittedAt: string | null;
}

export interface GqlIssueComment {
  id: string;
  author: GqlUser | null;
  body: string;
  createdAt: string;
}

export interface GqlLabel {
  name: string;
  color: string;
}

export interface GqlReviewRequest {
  requestedReviewer: GqlRequestedReviewer | null;
}

export interface GqlCommit {
  commit: {
    statusCheckRollup: { state: StatusState } | null;
  };
}

export interface GqlPullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  state: PullRequestState;
  mergeable: MergeableState;
  updatedAt: string;
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Total issue + review thread comments, as reported by GitHub. */
  totalCommentsCount: number;
  /** Raw Markdown body of the PR description; may be empty string. */
  body: string;
  /** Source branch (the branch being merged in). */
  headRefName: string;
  /** SHA of the head commit — keys REST lookups like Actions runs. */
  headRefOid: string;
  /** Target branch (usually `main`). */
  baseRefName: string;
  repository: {
    nameWithOwner: string;
    isArchived: boolean;
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
  };
  author: (GqlUser & { __typename?: string }) | null;
  assignees: { nodes: GqlUser[] };
  reviewRequests: { nodes: GqlReviewRequest[] };
  reviews: { nodes: GqlReview[] };
  latestOpinionatedReviews?: { nodes: GqlOpinionatedReview[] };
  comments: { nodes: GqlIssueComment[] };
  commits: { totalCount: number; nodes: GqlCommit[] };
  /**
   * Tip of the source branch. `target.committedDate` is the actual time
   * of the most recent commit pushed to the PR — used by the Stale
   * lens. May be null if the branch is missing (rare; deleted refs).
   */
  headRef?: {
    target: { committedDate?: string | null } | null;
  } | null;
  labels: { nodes: GqlLabel[] };
}

export type GqlConversation = Pick<GqlPullRequest, 'id' | 'createdAt' | 'body' | 'author' | 'reviews' | 'comments'>;

export type GqlPRSummary = Omit<GqlPullRequest, 'reviews' | 'comments' | 'assignees'> & {
  reviews: { nodes: (Omit<GqlReview, 'body' | 'comments'> & {
    comments: { nodes: Pick<GqlReviewComment, 'createdAt'>[] };
  })[] };
  comments: { nodes: Pick<GqlIssueComment, 'createdAt' | 'author'>[] };
};

export interface GqlDashboardResponse {
  viewer: {
    login: string;
    avatarUrl: string;
    pullRequests: { nodes: GqlPRSummary[] };
  };
  reviewRequested: { nodes: GqlPRSummary[] };
  /** Present only when the @include(if: $includeTeam) branch is selected. */
  teamPrs?: { nodes: GqlPRSummary[] };
  mergedAuthored?: { nodes: GqlPRSummary[] };
  mergedReviewed?: { nodes: GqlPRSummary[] };
  /** Present only when the @include(if: $includeTeam) branch is selected. */
  mergedTeam?: { nodes: GqlPRSummary[] };
  rateLimit: { remaining: number; resetAt: string };
}
