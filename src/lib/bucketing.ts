import type { Bucket, BucketId, DashboardPR } from '../types/dashboard';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Assign a bucket to a PR. Rules are evaluated in priority order;
 * first match wins. See instructions.md for the spec.
 */
export function bucketOf(pr: DashboardPR): BucketId {
  // 0. Merged: PR is done — always wins so it never gets evaluated
  //    against the open-PR rules below.
  if (pr.isMerged) return 'merged';

  // 1. Waiting on me: viewer is a requested reviewer and hasn't acted.
  if (pr.viewerIsRequestedReviewer && !pr.viewerIsAuthor) {
    const acted =
      pr.viewerReviewState === 'approved' ||
      pr.viewerReviewState === 'changes';
    if (!acted) return 'waiting';
  }

  if (pr.viewerIsAuthor) {
    // 2. Blocked: author sees CHANGES_REQUESTED or failing CI.
    if (pr.approvalState === 'changes' || pr.ciStatus === 'failure') {
      return 'blocked';
    }

    // 3. Ready to merge: approved + green + mergeable + not draft.
    //    (approvalState 'changes' already short-circuited above.)
    if (
      pr.approvalCount >= 1 &&
      pr.ciStatus === 'success' &&
      pr.mergeable === 'MERGEABLE' &&
      !pr.isDraft
    ) {
      return 'ready';
    }

    // 4. In review: freshly-authored PR that isn't blocked or ready.
    if (pr.waitingTimeMs < SEVEN_DAYS_MS) {
      return 'inreview';
    }

    // 5. Stale: my own authored PR aging in my queue.
    return 'stale';
  }

  // 6. Team: any non-authored PR that fell through. Covers teammate PRs
  //    the viewer hasn't touched AND ones the viewer already reviewed
  //    (approved / requested changes / commented).
  return 'team';
}

export interface BucketPlan {
  id: BucketId;
  title: string;
  color: string;
}

export const BUCKET_PLAN: BucketPlan[] = [
  { id: 'waiting', title: 'Waiting on me', color: 'var(--bucket-primary)' },
  { id: 'ready', title: 'Ready to merge', color: 'var(--bucket-merge)' },
  { id: 'blocked', title: 'Blocked', color: 'var(--bucket-block)' },
  { id: 'inreview', title: 'My PRs in review', color: 'var(--bucket-review)' },
  { id: 'stale', title: 'Stale', color: 'var(--bucket-stale)' },
  { id: 'team', title: 'Team', color: 'var(--info)' },
  { id: 'other', title: 'Other', color: 'var(--fg-3)' },
  { id: 'merged', title: 'Recently merged', color: 'var(--violet)' },
];

const BUCKET_ORDER: Record<BucketId, number> = {
  waiting: 0,
  ready: 1,
  blocked: 2,
  inreview: 3,
  stale: 4,
  team: 5,
  other: 6,
  merged: 7,
};

function sortPRs(a: DashboardPR, b: DashboardPR): number {
  // Merged PRs: most recent first (retrospective "what just shipped?").
  if (a.isMerged && b.isMerged) {
    const aT = a.mergedAt ? Date.parse(a.mergedAt) : 0;
    const bT = b.mergedAt ? Date.parse(b.mergedAt) : 0;
    return bT - aT;
  }
  // Escalated (waiting >24h) first, then oldest updatedAt first within a bucket.
  if (a.escalate !== b.escalate) return a.escalate ? -1 : 1;
  return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
}

/** Bucket a list of PRs, returning an ordered array of buckets (empty ones kept). */
export function bucketize(prs: DashboardPR[]): Bucket[] {
  const groups = new Map<BucketId, DashboardPR[]>();
  for (const plan of BUCKET_PLAN) groups.set(plan.id, []);

  for (const pr of prs) {
    const id = bucketOf(pr);
    groups.get(id)!.push(pr);
  }

  const out: Bucket[] = [];
  for (const plan of BUCKET_PLAN) {
    const items = groups.get(plan.id)!;
    items.sort(sortPRs);
    out.push({
      id: plan.id,
      title: plan.title,
      color: plan.color,
      items,
      meta: bucketMeta(plan.id, items),
    });
  }
  out.sort((a, b) => BUCKET_ORDER[a.id] - BUCKET_ORDER[b.id]);
  return out;
}

function bucketMeta(id: BucketId, items: DashboardPR[]): string | undefined {
  if (id === 'waiting') {
    const over24 = items.filter((p) => p.escalate).length;
    return over24 > 0 ? `${over24} over 24h` : undefined;
  }
  if (id === 'ready' && items.length > 0) return 'Safe to merge';
  if (id === 'stale' && items.length > 0) return '7+ days';
  if (id === 'team' && items.length > 0) return 'From tracked orgs';
  if (id === 'merged' && items.length > 0) return 'Last 7 days';
  return undefined;
}
