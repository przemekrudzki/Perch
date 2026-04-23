export type BucketId =
  | 'waiting'
  | 'ready'
  | 'blocked'
  | 'inreview'
  | 'stale'
  | 'team'
  | 'other';

export type CIStatus = 'success' | 'failure' | 'pending' | 'none';

export type ApprovalState = 'approved' | 'pending' | 'changes';

export type LabelTone = 'err' | 'warn' | 'ok' | 'info' | 'violet' | 'neutral';

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
  | 'comment';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  author: DashboardUser;
  at: string;
  body?: string;
}

export interface DashboardPR {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  updatedAt: string;
  createdAt: string;
  repoNameWithOwner: string;
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
  /** The review request for the viewer, set when viewer was requested. */
  viewerRequestedAt?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commitCount: number;
  /** Opened + reviews + comments, sorted by time ascending. */
  timeline: TimelineEvent[];
}

export interface Bucket {
  id: BucketId;
  title: string;
  color: string;
  items: DashboardPR[];
  meta?: string;
}
