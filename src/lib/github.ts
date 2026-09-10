import { GraphQLClient } from 'graphql-request';
import type { GqlDashboardResponse, GqlConversation } from '../types/github';
import type { Scope } from './storage';
import type { ReviewEvent } from './reviewActions';

export type { ReviewEvent } from './reviewActions';

export const GITHUB_ENDPOINT = 'https://api.github.com/graphql';

const PR_SUMMARY_FIELDS = /* GraphQL */ `
  fragment PRFields on PullRequest {
    id
    number
    title
    url
    isDraft
    state
    mergeable
    updatedAt
    createdAt
    mergedAt
    additions
    deletions
    changedFiles
    totalCommentsCount
    body
    headRefName
    headRefOid
    baseRefName
    repository {
      nameWithOwner
      isArchived
      mergeCommitAllowed
      squashMergeAllowed
      rebaseMergeAllowed
    }
    author {
      login
      ... on User { avatarUrl }
    }
    reviewRequests(first: 10) {
      nodes {
        requestedReviewer {
          __typename
          ... on User { login avatarUrl }
          ... on Team { name }
        }
      }
    }
    latestOpinionatedReviews(last: 10) {
      nodes {
        id
        author { login }
        state
        submittedAt
      }
    }
    reviews(last: 20) {
      nodes {
        id
        author { login ... on User { avatarUrl } }
        state
        submittedAt
        comments(last: 1) { nodes { createdAt } }
      }
    }
    comments(last: 20) { nodes { createdAt author { login } } }
    commits(last: 1) {
      totalCount
      nodes {
        commit {
          statusCheckRollup { state }
        }
      }
    }
    headRef {
      target {
        ... on Commit { committedDate }
      }
    }
    labels(first: 10) {
      nodes { name color }
    }
  }
`;

export const DASHBOARD_QUERY = /* GraphQL */ `
  query PRDashboard(
    $searchQuery: String!
    $teamSearchQuery: String!
    $includeTeam: Boolean!
  ) {
    viewer {
      login
      avatarUrl
      pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes { ...PRFields }
      }
    }
    reviewRequested: search(query: $searchQuery, type: ISSUE, first: 50) {
      nodes {
        ... on PullRequest { ...PRFields }
      }
    }
    teamPrs: search(query: $teamSearchQuery, type: ISSUE, first: 50)
      @include(if: $includeTeam) {
      nodes {
        ... on PullRequest { ...PRFields }
      }
    }
    rateLimit {
      remaining
      resetAt
    }
  }

  ${PR_SUMMARY_FIELDS}
`;

export const SEARCH_QUERY = 'is:open is:pr review-requested:@me archived:false';

/** Rolling window for the "Recently merged" bucket, in days. */
export const MERGED_WINDOW_DAYS = 7;

function mergedThresholdIso(windowDays: number): string {
  const threshold = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  return threshold.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Two "recently merged" queries instead of one `(author:@me OR
 * reviewed-by:@me)` — GitHub's search `OR` is unreliable when mixed
 * with other qualifiers, so we split and dedupe client-side.
 */
export function buildMergedAuthoredQuery(
  windowDays: number = MERGED_WINDOW_DAYS
): string {
  return `is:pr is:merged archived:false author:@me merged:>${mergedThresholdIso(windowDays)}`;
}

export function buildMergedReviewedQuery(
  windowDays: number = MERGED_WINDOW_DAYS
): string {
  return `is:pr is:merged archived:false reviewed-by:@me merged:>${mergedThresholdIso(windowDays)}`;
}

/**
 * Team-scope merged search: anything merged in the tracked orgs in the
 * window, regardless of whether the viewer authored or reviewed it.
 * Returns an empty string when there are no orgs to scope to — callers
 * should guard the @include flag on a non-empty value.
 */
export function buildMergedTeamQuery(
  orgs: string[],
  windowDays: number = MERGED_WINDOW_DAYS
): string {
  const cleaned = orgs
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => `org:${o}`);
  if (cleaned.length === 0) return '';
  return `is:pr is:merged archived:false ${cleaned.join(' ')} merged:>${mergedThresholdIso(windowDays)}`;
}

export function createClient(token: string): GraphQLClient {
  return new GraphQLClient(GITHUB_ENDPOINT, {
    headers: {
      authorization: `Bearer ${token}`,
      'user-agent': 'perch-dashboard',
    },
  });
}

export async function testConnection(token: string): Promise<{ login: string }> {
  const client = createClient(token);
  const data = await client.request<{ viewer: { login: string } }>(
    'query { viewer { login } }'
  );
  return data.viewer;
}

export const SUBMIT_REVIEW_MUTATION = /* GraphQL */ `
  mutation SubmitReview(
    $pullRequestId: ID!
    $event: PullRequestReviewEvent!
    $body: String
  ) {
    addPullRequestReview(
      input: { pullRequestId: $pullRequestId, event: $event, body: $body }
    ) {
      pullRequestReview {
        id
        state
      }
    }
  }
`;

/**
 * Submit a review on a PR. `addPullRequestReview` both creates and
 * submits in one call when `event` is provided, so there's no separate
 * "create draft then submit" step. `pullRequestId` is the GraphQL node
 * id carried on every DashboardPR (`pr.id`). Throws on GraphQL/HTTP
 * error; callers surface it (redacting the PAT first).
 */
export async function submitReview(
  token: string,
  pullRequestId: string,
  event: ReviewEvent,
  body: string,
): Promise<void> {
  const client = createClient(token);
  await client.request<{
    addPullRequestReview: { pullRequestReview: { id: string; state: string } | null };
  }>(SUBMIT_REVIEW_MUTATION, {
    pullRequestId,
    event,
    // Normalize whitespace before sending: this helper owns the
    // payload the API receives. APPROVE permits an empty body; the
    // other verdicts are gated upstream by reviewActionEnabled.
    body: body.trim(),
  });
}

export const MERGE_PULL_REQUEST_MUTATION = /* GraphQL */ `
  mutation MergePullRequest(
    $pullRequestId: ID!
    $expectedHeadOid: GitObjectID!
    $mergeMethod: PullRequestMergeMethod!
  ) {
    mergePullRequest(
      input: {
        pullRequestId: $pullRequestId
        expectedHeadOid: $expectedHeadOid
        mergeMethod: $mergeMethod
      }
    ) {
      pullRequest {
        id
        mergedAt
      }
    }
  }
`;

/**
 * Merge a PR at the exact head commit shown in Perch. Supplying
 * `expectedHeadOid` makes GitHub reject the mutation if new commits
 * landed after the dashboard was fetched, forcing the user to review
 * the updated head before trying again.
 */
export async function mergePullRequest(
  token: string,
  pullRequestId: string,
  expectedHeadOid: string,
  mergeMethod: 'MERGE' | 'SQUASH' | 'REBASE',
): Promise<void> {
  const client = createClient(token);
  await client.request(MERGE_PULL_REQUEST_MUTATION, {
    pullRequestId,
    expectedHeadOid,
    mergeMethod,
  });
}

export const CONVERT_TO_DRAFT_MUTATION = /* GraphQL */ `
  mutation ConvertToDraft($pullRequestId: ID!) {
    convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
      pullRequest {
        id
        isDraft
      }
    }
  }
`;

export const MARK_READY_MUTATION = /* GraphQL */ `
  mutation MarkReady($pullRequestId: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
      pullRequest {
        id
        isDraft
      }
    }
  }
`;

/**
 * Flip a PR between draft and ready-for-review. GitHub splits this
 * across two mutations that take identical input, so one function with
 * a boolean beats two near-identical exports. `pullRequestId` is the
 * GraphQL node id carried on every DashboardPR (`pr.id`). Throws on
 * GraphQL/HTTP error; callers surface it (redacting the PAT first).
 *
 * Converting to draft makes GitHub dismiss the PR's pending review
 * requests — the caller warns before doing it.
 */
export async function setDraftState(
  token: string,
  pullRequestId: string,
  draft: boolean,
): Promise<void> {
  const client = createClient(token);
  await client.request(draft ? CONVERT_TO_DRAFT_MUTATION : MARK_READY_MUTATION, {
    pullRequestId,
  });
}

/** Build a GitHub search query that returns open PRs across the given orgs. */
export function buildTeamSearchQuery(orgs: string[]): string {
  const cleaned = orgs
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => `org:${o}`);
  if (cleaned.length === 0) return '';
  return `is:open is:pr archived:false ${cleaned.join(' ')}`;
}

export interface FetchOptions {
  scope: Scope;
  orgs: string[];
}

export async function fetchDashboard(
  token: string,
  opts: FetchOptions = { scope: 'inbox', orgs: [] }
): Promise<GqlDashboardResponse> {
  const client = createClient(token);
  const teamSearchQuery = buildTeamSearchQuery(opts.orgs);
  const includeTeam = opts.scope === 'all' && teamSearchQuery.length > 0;
  return client.request<GqlDashboardResponse>(DASHBOARD_QUERY, {
    searchQuery: SEARCH_QUERY,
    // Must be a valid non-empty string even when unused — @include is evaluated
    // server-side but the variable is still validated as non-null String.
    teamSearchQuery: teamSearchQuery || 'is:open is:pr',
    includeTeam,
  });
}

export const CONVERSATION_QUERY = /* GraphQL */ `
  query PRConversation($id: ID!) {
    node(id: $id) {
      ... on PullRequest {
        id
        createdAt
        body
        author { login ... on User { avatarUrl } }
        reviews(last: 20) {
          nodes {
            id
            author {
              login
              ... on User { avatarUrl }
            }
            state
            submittedAt
            body
            comments(first: 10) {
              nodes {
                id
                body
                path
                line
                originalLine
                createdAt
              }
            }
          }
        }
        comments(last: 20) {
          nodes {
            id
            author {
              login
              ... on User { avatarUrl }
            }
            body
            createdAt
          }
        }
      }
    }
  }
`;

export async function fetchConversation(token: string, id: string, signal?: AbortSignal): Promise<GqlConversation> {
  const result = await createClient(token).request<{ node: GqlConversation | null }>({
    document: CONVERSATION_QUERY, variables: { id }, signal,
  });
  if (!result.node) throw new Error('This pull request is no longer accessible.');
  return result.node;
}

export const MERGED_QUERY = /* GraphQL */ `
  query MergedPRs($mergedAuthoredQuery: String!, $mergedReviewedQuery: String!, $mergedTeamQuery: String!, $includeTeam: Boolean!) {
    viewer { login avatarUrl }
    mergedAuthored: search(query: $mergedAuthoredQuery, type: ISSUE, first: 30) {
      nodes {
        ... on PullRequest { ...PRFields }
      }
    }
    mergedReviewed: search(query: $mergedReviewedQuery, type: ISSUE, first: 30) {
      nodes {
        ... on PullRequest { ...PRFields }
      }
    }
    mergedTeam: search(query: $mergedTeamQuery, type: ISSUE, first: 30)
      @include(if: $includeTeam) {
      nodes {
        ... on PullRequest { ...PRFields }
      }
    }
    rateLimit { remaining resetAt }
  }
  ${PR_SUMMARY_FIELDS}
`;

export async function fetchMerged(token: string, opts: FetchOptions): Promise<GqlDashboardResponse> {
  const teamQuery = buildMergedTeamQuery(opts.orgs);
  const result = await createClient(token).request<Omit<GqlDashboardResponse, 'reviewRequested' | 'viewer'> & {
    viewer: { login: string; avatarUrl: string };
  }>(MERGED_QUERY, {
    mergedAuthoredQuery: buildMergedAuthoredQuery(),
    mergedReviewedQuery: buildMergedReviewedQuery(),
    mergedTeamQuery: teamQuery || 'is:pr is:merged',
    includeTeam: opts.scope === 'all' && Boolean(teamQuery),
  });
  return { ...result, viewer: { ...result.viewer, pullRequests: { nodes: [] } }, reviewRequested: { nodes: [] } };
}
