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

export interface GqlReview {
  author: GqlUser | null;
  state: ReviewState;
  submittedAt: string | null;
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
  mergeable: MergeableState;
  updatedAt: string;
  createdAt: string;
  repository: { nameWithOwner: string; isArchived: boolean };
  author: (GqlUser & { __typename?: string }) | null;
  assignees: { nodes: GqlUser[] };
  reviewRequests: { nodes: GqlReviewRequest[] };
  reviews: { nodes: GqlReview[] };
  commits: { nodes: GqlCommit[] };
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
  rateLimit: { remaining: number; resetAt: string };
}
