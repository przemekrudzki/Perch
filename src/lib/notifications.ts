import type {
  ApprovalState,
  CIStatus,
  DashboardPR,
  TimelineEventKind,
} from '../types/dashboard';

export type NotificationKind =
  | 'comment'
  | 'ci-fail'
  | 'merged'
  | 'approved'
  | 'changes';

/** Timeline kinds that count as "someone commented" for notifications. */
const COMMENT_KINDS: ReadonlySet<TimelineEventKind> = new Set<TimelineEventKind>(
  ['comment', 'review-comment', 'inline-comment']
);

/**
 * Epoch-ms of the most recent comment authored by someone *other than*
 * the viewer, or 0 if there is none. Basing the comment rule on this
 * (rather than the raw `commentCount`) means the viewer's own comments
 * never fire a self-notification.
 */
function latestForeignCommentMs(
  pr: DashboardPR,
  viewerLogin: string | null
): number {
  // Inbox summaries carry activity metadata without downloading the timeline.
  if (pr.lastForeignCommentAt !== undefined) {
    return pr.lastForeignCommentAt ? Date.parse(pr.lastForeignCommentAt) : 0;
  }
  let latest = 0;
  for (const event of pr.timeline) {
    if (!COMMENT_KINDS.has(event.kind)) continue;
    if (viewerLogin && event.author.login === viewerLogin) continue;
    const t = Date.parse(event.at);
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return latest;
}

/** The slice of a PR we diff between consecutive polls. */
export interface PRSnapshot {
  /** Epoch-ms of the latest non-viewer comment (see above). */
  lastForeignCommentMs: number;
  ciStatus: CIStatus;
  approvalState: ApprovalState;
  isMerged: boolean;
}

export interface NotificationEvent {
  prId: string;
  prNumber: number;
  repoNameWithOwner: string;
  title: string;
  url: string;
  kind: NotificationKind;
}

export function snapshotPR(
  pr: DashboardPR,
  viewerLogin: string | null
): PRSnapshot {
  return {
    lastForeignCommentMs: latestForeignCommentMs(pr, viewerLogin),
    ciStatus: pr.ciStatus,
    approvalState: pr.approvalState,
    isMerged: pr.isMerged,
  };
}

/**
 * Snapshot only the PRs the viewer authored — the only PRs notifications
 * fire for. Keyed by PR id.
 */
export function snapshotAuthored(
  prs: DashboardPR[],
  viewerLogin: string | null
): Map<string, PRSnapshot> {
  const out = new Map<string, PRSnapshot>();
  for (const pr of prs) {
    if (pr.viewerIsAuthor) out.set(pr.id, snapshotPR(pr, viewerLogin));
  }
  return out;
}

/**
 * Diff the previous per-poll snapshot against the current PRs and return
 * the notification events that should fire. Pure — fires nothing itself.
 *
 * Rules (all scoped to viewer-authored PRs):
 * - comment: a new comment from someone other than the viewer appeared
 *   (the viewer's own comments never fire — that's the whole point of
 *   diffing `lastForeignCommentMs` rather than the raw `commentCount`)
 * - ci-fail: ciStatus transitioned *into* 'failure' (success/pending never fire)
 * - merged:  isMerged flipped false -> true
 * - approved/changes: approvalState transitioned into that state
 *
 * A PR absent from `prev` (first time seen) yields no events, so the first
 * poll after load is silent.
 */
export function computeNotifications(
  prev: Map<string, PRSnapshot>,
  next: DashboardPR[],
  viewerLogin: string | null
): NotificationEvent[] {
  const events: NotificationEvent[] = [];
  for (const pr of next) {
    if (!pr.viewerIsAuthor) continue;
    const before = prev.get(pr.id);
    if (!before) continue;

    const base = {
      prId: pr.id,
      prNumber: pr.number,
      repoNameWithOwner: pr.repoNameWithOwner,
      title: pr.title,
      url: pr.url,
    };

    if (latestForeignCommentMs(pr, viewerLogin) > before.lastForeignCommentMs) {
      events.push({ ...base, kind: 'comment' });
    }
    if (pr.ciStatus === 'failure' && before.ciStatus !== 'failure') {
      events.push({ ...base, kind: 'ci-fail' });
    }
    if (pr.isMerged && !before.isMerged) {
      events.push({ ...base, kind: 'merged' });
    }
    if (pr.approvalState === 'approved' && before.approvalState !== 'approved') {
      events.push({ ...base, kind: 'approved' });
    }
    if (pr.approvalState === 'changes' && before.approvalState !== 'changes') {
      events.push({ ...base, kind: 'changes' });
    }
  }
  return events;
}
