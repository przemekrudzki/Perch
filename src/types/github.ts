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
  repository: { nameWithOwner: string; isArchived: boolean };
  author: (GqlUser & { __typename?: string }) | null;
  assignees: { nodes: GqlUser[] };
  reviewRequests: { nodes: GqlReviewRequest[] };
  reviews: { nodes: GqlReview[] };
  comments: { nodes: GqlIssueComment[] };
  commits: { totalCount: number; nodes: GqlCommit[] };
  labels: { nodes: GqlLabel[] };
}

export interface GqlDashboardResponse {
  viewer: {
    login: string;
    avatarUrl: string;
    pullRequests: { nodes: GqlPullRequest[] };
  };
  reviewRequested: { nodes: GqlPullRequest[] };
  /** Present only when the @include(if: $includeTeam) branch is selected. */
  teamPrs?: { nodes: GqlPullRequest[] };
  mergedAuthored: { nodes: GqlPullRequest[] };
  mergedReviewed: { nodes: GqlPullRequest[] };
  rateLimit: { remaining: number; resetAt: string };
}
