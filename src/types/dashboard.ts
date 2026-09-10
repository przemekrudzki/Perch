export type BucketId =
  | 'waiting'
  | 'ready'
  | 'blocked'
  | 'inreview'
  | 'needsreview'
  | 'team'
  | 'merged'
  | 'other';

export type CIStatus = 'success' | 'failure' | 'pending' | 'none';

export type ApprovalState = 'approved' | 'pending' | 'changes';

export type LabelTone = 'err' | 'warn' | 'ok' | 'info' | 'violet' | 'neutral';

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';

export interface DashboardUser {
  login: string;
  avatarUrl?: string;
  /** Deterministic avatar gradient class key ('a'..'h'). */
  av: string;
}

export interface DashboardReviewer extends DashboardUser {
  state: ApprovalState | 'commented' | 'requested';
  submittedAt?: string;
}

export interface DashboardLabel {
  name: string;
  tone: LabelTone;
  color: string;
}

export type TimelineEventKind =
  | 'opened'
  | 'review-approved'
  | 'review-changes'
  | 'review-comment'
  | 'inline-comment'
  | 'comment';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  author: DashboardUser;
  at: string;
  body?: string;
  /** File path for inline-comment events. */
  path?: string;
  /** Diff line for inline-comment events. */
  line?: number;
  /**
   * Which side of the diff the inline comment was left on. `'new'`
   * = the post-change side (most common); `'old'` = a comment on a
   * deleted line. Drives the Diff tab anchoring so comments don't
   * duplicate when both sides happen to share a line number.
   */
  side?: 'old' | 'new';
}

export interface DashboardPR {
  id: string;
  number: number;
  title: string;
  url: string;
  /** Kritik Jira ticket inferred from branch, title, or description. */
  jiraTicketKey: string | null;
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  updatedAt: string;
  createdAt: string;
  repoNameWithOwner: string;
  /** First merge method enabled by the repository, in GitHub's default order. */
  mergeMethod: MergeMethod;
  author: DashboardUser;
  viewerIsAuthor: boolean;
  viewerIsRequestedReviewer: boolean;
  /** Approvals from reviewers, counted distinctly per reviewer. */
  approvalCount: number;
  /** Total reviewer seats (requested + people who already reviewed). */
  reviewerCount: number;
  approvalState: ApprovalState;
  viewerReviewState: ApprovalState | 'commented' | 'none';
  ciStatus: CIStatus;
  labels: DashboardLabel[];
  reviewers: DashboardReviewer[];
  waitingTimeMs: number;
  /** Escalate if waiting on viewer >24h. */
  escalate: boolean;
  /** True when the PR is in the MERGED state. */
  isMerged: boolean;
  /** When the PR was merged, when applicable. */
  mergedAt?: string;
  /** The review request for the viewer, set when viewer was requested. */
  viewerRequestedAt?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commitCount: number;
  /** Source branch name (the one being merged in). */
  headRefName: string;
  /** SHA of the head commit — used to find the PR's Actions runs. */
  headSha: string;
  /** Target branch name (usually main / master). */
  baseRefName: string;
  /** Total conversation — issue comments + review thread comments. */
  commentCount: number;
  /**
   * ISO timestamp of the latest commit on the source branch
   * (`headRef.target.committedDate`). Null when the branch is gone.
   * Drives the Stale lens.
   */
  lastCommitAt: string | null;
  /**
   * ISO timestamp of the most recent human activity on the PR — the
   * latest of: issue comments, review submissions, inline review
   * comments. Null when the PR has no comments or reviews yet (in
   * which case the Stale lens falls back to `createdAt`).
   */
  lastCommentAt: string | null;
  /** Latest conversation activity by someone other than the viewer. */
  lastForeignCommentAt?: string | null;
  /** Drawer conversation, loaded separately; inbox summaries leave this empty. */
  timeline: TimelineEvent[];
}

export interface Bucket {
  id: BucketId;
  title: string;
  color: string;
  items: DashboardPR[];
  meta?: string;
}
