import type { Bucket, BucketId, DashboardPR } from '../types/dashboard';

/**
 * Threshold for the Stale lens: a PR is considered drifting when both
 * activity signals (last commit and last comment) are older than this.
 * 48 hours is intentionally aggressive — it's a "nobody touched this
 * since the day before yesterday" signal.
 */
export const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/**
 * Assign a primary bucket to a PR. Rules are evaluated in priority order;
 * first match wins. Stale is intentionally NOT in this chain — it's a
 * secondary lens computed separately by `bucketize`, so a PR can appear
 * in both Stale and its primary bucket.
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

    // 4. In review: any other authored PR. Stale-as-primary used to
    //    live here; it's now an independent lens.
    return 'inreview';
  }

  // 5. Needs reviewers: open team PR that's hungry for review attention
  //    — fewer than 2 reviewers and the viewer hasn't been pulled in yet.
  //    Surfaces "I could pick this one up" candidates from the team scope.
  if (
    !pr.isDraft &&
    !pr.viewerIsRequestedReviewer &&
    pr.viewerReviewState === 'none' &&
    pr.reviewers.length < 2
  ) {
    return 'needsreview';
  }

  // 6. Team: any non-authored PR that fell through. Covers teammate PRs
  //    the viewer hasn't touched AND ones the viewer already reviewed
  //    (approved / requested changes / commented).
  return 'team';
}

/**
 * "Ready to merge" predicate — open PR that is approved, green, mergeable,
 * not draft. Independent of authorship so the header stat can reflect any
 * PR in the list (yours or a teammate's) that's safe to ship.
 */
export function isReadyToMerge(pr: DashboardPR): boolean {
  if (pr.isMerged) return false;
  if (pr.isDraft) return false;
  if (pr.approvalState === 'changes') return false;
  if (pr.ciStatus !== 'success') return false;
  if (pr.mergeable !== 'MERGEABLE') return false;
  return pr.approvalCount >= 1;
}

/**
 * Stale lens: open PR with no activity on either axis (commits, comments)
 * within the threshold window. Authorship-agnostic. A PR can appear in
 * Stale AND in its primary bucket — Stale is reflective ("this is
 * drifting"), not a primary classification.
 *
 * Falls back to `createdAt` when the PR has no comments yet, so a brand-
 * new PR that nobody looked at lands in Stale once it crosses the
 * threshold.
 */
export function isStale(
  pr: DashboardPR,
  now: number = Date.now(),
  thresholdMs: number = STALE_THRESHOLD_MS
): boolean {
  if (pr.isMerged) return false;
  const cutoff = now - thresholdMs;
  const createdMs = Date.parse(pr.createdAt);
  const commitMs = pr.lastCommitAt ? Date.parse(pr.lastCommitAt) : createdMs;
  const commentMs = pr.lastCommentAt
    ? Date.parse(pr.lastCommentAt)
    : createdMs;
  // A PR opened less than `thresholdMs` ago is by definition not stale —
  // even if commit/comment fallbacks would suggest otherwise (defensive).
  if (Number.isFinite(createdMs) && createdMs >= cutoff) return false;
  return commitMs < cutoff && commentMs < cutoff;
}

export interface BucketPlan {
  id: BucketId;
  title: string;
  color: string;
}

// Stale used to be a section here; it's now a per-row chip rendered
// in PRRow via `isStale(pr)`. The predicate is still exported so
// callers (HeadlineBand stat, the chip itself) share one definition.
export const BUCKET_PLAN: BucketPlan[] = [
  { id: 'waiting', title: 'Waiting on me', color: 'var(--bucket-primary)' },
  { id: 'ready', title: 'Ready to merge', color: 'var(--bucket-merge)' },
  { id: 'blocked', title: 'Blocked', color: 'var(--bucket-block)' },
  { id: 'inreview', title: 'My PRs in review', color: 'var(--bucket-review)' },
  { id: 'needsreview', title: 'Needs reviewers', color: 'var(--warn)' },
  { id: 'team', title: 'Team', color: 'var(--info)' },
  { id: 'other', title: 'Other', color: 'var(--fg-3)' },
  { id: 'merged', title: 'Recently merged', color: 'var(--violet)' },
];

const BUCKET_ORDER: Record<BucketId, number> = {
  waiting: 0,
  ready: 1,
  blocked: 2,
  inreview: 3,
  needsreview: 4,
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

/**
 * Bucket a list of PRs, returning an ordered array of buckets (empty
 * ones kept). Buckets are mutually exclusive — `bucketOf` is
 * first-match. Drift signal (`isStale`) is rendered as a chip on the
 * row inside whichever bucket the PR actually belongs to, not as a
 * separate section.
 */
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

/**
 * Flatten buckets into a single ordered, deduplicated PR list for
 * keyboard nav and modal prev/next. Walks buckets in display order,
 * skips collapsed ones, and dedupes by PR id (defensive — buckets
 * are mutually exclusive today, but the dedupe keeps callers honest
 * if that ever changes again).
 */
export function flattenForNav(
  buckets: Bucket[],
  collapsed: ReadonlySet<string>
): DashboardPR[] {
  const seen = new Set<string>();
  const out: DashboardPR[] = [];
  for (const b of buckets) {
    if (collapsed.has(b.id)) continue;
    for (const pr of b.items) {
      if (seen.has(pr.id)) continue;
      seen.add(pr.id);
      out.push(pr);
    }
  }
  return out;
}

function bucketMeta(id: BucketId, items: DashboardPR[]): string | undefined {
  if (id === 'waiting') {
    const over24 = items.filter((p) => p.escalate).length;
    return over24 > 0 ? `${over24} over 24h` : undefined;
  }
  if (id === 'ready' && items.length > 0) return 'Safe to merge';
  if (id === 'needsreview' && items.length > 0) return 'Light on reviewers';
  if (id === 'team' && items.length > 0) return 'From tracked orgs';
  if (id === 'merged' && items.length > 0) return 'Last 7 days';
  return undefined;
}
