import type {
  GqlDashboardResponse,
  GqlLabel,
  GqlPRSummary,
  GqlConversation,
  GqlUser,
  ReviewState,
} from '../types/github';
import type {
  ApprovalState,
  CIStatus,
  DashboardLabel,
  DashboardPR,
  DashboardReviewer,
  DashboardUser,
  LabelTone,
  TimelineEvent,
  TimelineEventKind,
} from '../types/dashboard';
import { findJiraTicketKey } from './jira';

const AV_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/**
 * GitHub Apps post under a `<name>[bot]` login, but some review-bots
 * (Cursor, Claude, etc.) use plain user accounts that don't follow
 * the convention. Maintain an explicit allowlist for those, in
 * addition to the `[bot]` suffix matcher. Compared case-insensitively.
 */
const KNOWN_BOT_LOGINS = new Set<string>(['cursor', 'coderabbitai']);

/**
 * GitHub Apps post reviews under a `<name>[bot]` login. They aren't
 * humans we should count toward an "N of M approved" ratio.
 */
export function isBotLogin(login: string | null | undefined): boolean {
  if (!login) return false;
  if (login.endsWith('[bot]')) return true;
  if (KNOWN_BOT_LOGINS.has(login.toLowerCase())) return true;
  return false;
}

/** Should this login count toward reviewer/approval tallies on this PR? */
function countsAsReviewer(
  login: string,
  authorLogin: string | null | undefined
): boolean {
  if (!login) return false;
  if (login === authorLogin) return false;
  if (isBotLogin(login)) return false;
  return true;
}

/** Deterministic gradient picker from login — matches design's 8 avatar gradients. */
export function avatarKey(login: string): string {
  if (!login) return 'a';
  let hash = 0;
  for (let i = 0; i < login.length; i++) {
    hash = (hash * 31 + login.charCodeAt(i)) >>> 0;
  }
  return AV_KEYS[hash % AV_KEYS.length]!;
}

function toUser(u: GqlUser | null | undefined): DashboardUser {
  if (!u) return { login: 'ghost', av: 'a' };
  return {
    login: u.login,
    avatarUrl: u.avatarUrl,
    av: avatarKey(u.login),
  };
}

const WARN_HEX = /^(d|e|f)/i;
const BLOCKED_NAMES = new Set(['blocked', 'do-not-merge', 'dnm']);

function hexLuma(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Map a GitHub label color to one of our semantic tones. */
function labelTone(label: GqlLabel): LabelTone {
  const name = label.name.toLowerCase();
  if (BLOCKED_NAMES.has(name)) return 'err';
  if (name.includes('bug')) return 'err';
  if (name.includes('perf') || name.includes('enhancement')) return 'ok';
  if (name.includes('qa') || name.includes('needs-')) return 'warn';
  if (name.includes('doc')) return 'info';
  if (name.includes('lti')) return 'violet';

  const hex = label.color || '888888';
  const l = hexLuma(hex);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  if (r > g + 40 && r > b + 40) return 'err';
  if (g > r + 20 && g > b) return 'ok';
  if (b > r + 30 && b > g) return 'info';
  if (r > 200 && g > 140 && b < 120 && WARN_HEX.test(hex)) return 'warn';
  if (l > 0.75) return 'warn';
  return 'neutral';
}

function toLabel(l: GqlLabel): DashboardLabel {
  return {
    name: l.name,
    color: l.color,
    tone: labelTone(l),
  };
}

function mapCI(state: string | null | undefined): CIStatus {
  switch (state) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'ERROR':
      return 'failure';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'none';
  }
}

interface LatestReview {
  state: ReviewState;
  submittedAt: string | null;
  author: GqlUser;
}

/**
 * Opinionated states carry a verdict. Mirrors GitHub's semantics: a
 * COMMENTED review never clears a standing APPROVED/CHANGES_REQUESTED
 * (dismissal flips the review itself to DISMISSED, which does).
 */
function isVerdict(state: ReviewState): boolean {
  return (
    state === 'APPROVED' || state === 'CHANGES_REQUESTED' || state === 'DISMISSED'
  );
}

/**
 * Current review-state per reviewer login (submitted reviews only).
 * A reviewer's standing state is their latest *opinionated* review;
 * COMMENTED only surfaces when they never gave a verdict.
 */
function latestReviewByLogin(pr: GqlPRSummary): Map<string, LatestReview> {
  const map = new Map<string, LatestReview>();
  const apply = (r: {
    author: GqlUser | null;
    state: ReviewState;
    submittedAt: string | null;
  }): void => {
    if (!r.author) return;
    const prev = map.get(r.author.login);
    let replace = false;
    if (!prev) {
      replace = true;
    } else if (isVerdict(r.state) !== isVerdict(prev.state)) {
      // A verdict outranks chatter regardless of timestamps.
      replace = isVerdict(r.state);
    } else {
      const prevT = prev.submittedAt ? Date.parse(prev.submittedAt) : 0;
      const curT = r.submittedAt ? Date.parse(r.submittedAt) : 0;
      replace = curT >= prevT;
    }
    if (replace) {
      map.set(r.author.login, {
        state: r.state,
        submittedAt: r.submittedAt,
        author: r.author,
      });
    }
  };
  for (const r of pr.reviews.nodes) apply(r);
  // Standing verdicts can age out of reviews(last: N) on chatty PRs;
  // latestOpinionatedReviews carries them regardless of chat volume.
  for (const r of pr.latestOpinionatedReviews?.nodes ?? []) apply(r);
  return map;
}

/**
 * Transform a raw GraphQL PR into the flattened dashboard shape.
 * `reviewRequestedSet` is the set of PR ids where the viewer is currently requested.
 */
export function transformPR(
  pr: GqlPRSummary,
  viewerLogin: string,
  reviewRequestedSet: Set<string>
): DashboardPR {
  const authorLogin = pr.author?.login;
  const isCountable = (login: string): boolean =>
    countsAsReviewer(login, authorLogin);

  const latestByLogin = latestReviewByLogin(pr);
  const approvedLogins = new Set<string>();
  const changesLogins = new Set<string>();

  for (const [login, r] of latestByLogin) {
    if (!isCountable(login)) continue;
    if (r.state === 'APPROVED') approvedLogins.add(login);
    if (r.state === 'CHANGES_REQUESTED') changesLogins.add(login);
  }

  const requestedUsers: GqlUser[] = [];
  for (const req of pr.reviewRequests.nodes) {
    const rr = req.requestedReviewer;
    if (!rr) continue;
    if ((rr as { __typename?: string }).__typename === 'User') {
      const u = rr as unknown as GqlUser;
      if (!isCountable(u.login)) continue;
      requestedUsers.push(u);
    }
  }
  const requestedUserLogins = requestedUsers.map((u) => u.login);

  const allReviewerLogins = new Set<string>([
    ...requestedUserLogins,
    ...Array.from(latestByLogin.keys()).filter(isCountable),
  ]);

  const approvalCount = approvedLogins.size;
  const reviewerCount = allReviewerLogins.size;

  let approvalState: ApprovalState;
  if (changesLogins.size > 0) approvalState = 'changes';
  else if (approvalCount > 0 && approvalCount >= reviewerCount && reviewerCount > 0)
    approvalState = 'approved';
  else approvalState = 'pending';

  const viewerLatest = latestByLogin.get(viewerLogin);
  let viewerReviewState: DashboardPR['viewerReviewState'] = 'none';
  if (viewerLatest) {
    if (viewerLatest.state === 'APPROVED') viewerReviewState = 'approved';
    else if (viewerLatest.state === 'CHANGES_REQUESTED') viewerReviewState = 'changes';
    else if (viewerLatest.state === 'COMMENTED') viewerReviewState = 'commented';
    else viewerReviewState = 'pending';
  }

  const viewerIsRequestedReviewer =
    reviewRequestedSet.has(pr.id) || requestedUserLogins.includes(viewerLogin);

  const author = toUser(pr.author);
  const viewerIsAuthor = pr.author?.login === viewerLogin;

  const reviewers: DashboardReviewer[] = [];
  const seen = new Set<string>();
  for (const u of requestedUsers) {
    if (seen.has(u.login)) continue;
    seen.add(u.login);
    reviewers.push({
      ...toUser(u),
      state: 'requested',
    });
  }
  for (const [login, r] of latestByLogin) {
    if (!isCountable(login)) continue;
    if (seen.has(login)) continue;
    seen.add(login);
    let s: DashboardReviewer['state'] = 'pending';
    if (r.state === 'APPROVED') s = 'approved';
    else if (r.state === 'CHANGES_REQUESTED') s = 'changes';
    else if (r.state === 'COMMENTED') s = 'commented';
    reviewers.push({
      ...toUser(r.author),
      state: s,
      submittedAt: r.submittedAt ?? undefined,
    });
  }

  const ciState =
    pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null;
  const ciStatus = mapCI(ciState);

  const updatedMs = Date.parse(pr.updatedAt);
  const waitingTimeMs = Math.max(0, Date.now() - updatedMs);
  const escalate = viewerIsRequestedReviewer && waitingTimeMs > 24 * 60 * 60 * 1000;

  const isMerged = pr.state === 'MERGED';

  // Activity signals for the Stale lens.
  // `lastCommitAt` = tip of the source branch (committedDate). Null when
  // the branch is gone or the field came back null.
  const lastCommitAt = pr.headRef?.target?.committedDate ?? null;
  // `lastCommentAt` = max(issue comments, review submissions, inline
  // review comments). Null when nothing has been said yet.
  let lastCommentMs = 0;
  let lastCommentAt: string | null = null;
  const recordActivity = (ts: string | null | undefined): void => {
    if (!ts) return;
    const ms = Date.parse(ts);
    if (!Number.isFinite(ms)) return;
    if (ms > lastCommentMs) {
      lastCommentMs = ms;
      lastCommentAt = ts;
    }
  };
  for (const c of pr.comments.nodes) recordActivity(c.createdAt);
  for (const r of pr.reviews.nodes) {
    recordActivity(r.submittedAt);
    for (const ic of r.comments.nodes) recordActivity(ic.createdAt);
  }

  let lastForeignCommentAt: string | null = null;
  const recordForeign = (at: string | null, login: string | undefined): void => {
    if (!at || !login || login === viewerLogin) return;
    if (!lastForeignCommentAt || Date.parse(at) > Date.parse(lastForeignCommentAt)) lastForeignCommentAt = at;
  };
  for (const c of pr.comments.nodes) recordForeign(c.createdAt, c.author?.login);
  for (const r of pr.reviews.nodes) {
    if (r.state === 'COMMENTED') recordForeign(r.submittedAt, r.author?.login);
    for (const c of r.comments.nodes) recordForeign(c.createdAt, r.author?.login);
  }

  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    jiraTicketKey: findJiraTicketKey(pr.headRefName, pr.title, pr.body),
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    updatedAt: pr.updatedAt,
    createdAt: pr.createdAt,
    repoNameWithOwner: pr.repository.nameWithOwner,
    mergeMethod: pr.repository.mergeCommitAllowed
      ? 'MERGE'
      : pr.repository.squashMergeAllowed
        ? 'SQUASH'
        : 'REBASE',
    author,
    viewerIsAuthor,
    viewerIsRequestedReviewer,
    approvalCount,
    reviewerCount,
    approvalState,
    viewerReviewState,
    ciStatus,
    labels: pr.labels.nodes.map(toLabel),
    reviewers,
    waitingTimeMs,
    escalate,
    isMerged,
    mergedAt: pr.mergedAt ?? undefined,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commitCount: pr.commits.totalCount,
    commentCount: pr.totalCommentsCount ?? 0,
    lastCommitAt,
    lastCommentAt,
    lastForeignCommentAt,
    headRefName: pr.headRefName,
    headSha: pr.headRefOid,
    baseRefName: pr.baseRefName,
    timeline: [],
  };
}

/**
 * Assemble the drawer timeline: opened + reviews (approved / changes /
 * commented-with-body) + general issue comments, sorted ascending.
 */
export function buildTimeline(
  pr: GqlConversation,
  author: DashboardUser = toUser(pr.author)
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: `${pr.id}-opened`,
      kind: 'opened',
      author,
      at: pr.createdAt,
      // The PR description rides with the opened event so it reads as
      // "author opened this PR saying X" in the timeline narrative.
      body: pr.body?.trim() ? pr.body : undefined,
    },
  ];

  for (const r of pr.reviews.nodes) {
    if (!r.author || !r.submittedAt) continue;
    const reviewAuthor = toUser(r.author);
    const trimmedBody = r.body.trim();
    const inlineCount = r.comments.nodes.length;

    // Emit the review-level event when it carries signal (approval,
    // request-changes, or a non-empty commented body, or there were
    // inline comments). Empty COMMENTED reviews with no inline comments
    // are submission artifacts from pending-review flows — skip those.
    let kind: TimelineEventKind | null = null;
    switch (r.state) {
      case 'APPROVED':
        kind = 'review-approved';
        break;
      case 'CHANGES_REQUESTED':
        kind = 'review-changes';
        break;
      case 'COMMENTED':
        if (trimmedBody.length > 0) kind = 'review-comment';
        break;
      default:
        break; // PENDING, DISMISSED — skip
    }
    if (kind) {
      events.push({
        id: r.id,
        kind,
        author: reviewAuthor,
        at: r.submittedAt,
        body: trimmedBody || undefined,
      });
    } else if (inlineCount === 0) {
      // No review-level signal and no inline comments — drop entirely.
      continue;
    }

    // Surface each inline review comment as its own event so a reviewer
    // who only left diff nits still shows up in the timeline.
    for (const c of r.comments.nodes) {
      if (!c.body || c.body.trim().length === 0) continue;
      // GitHub's `line` is the new-side (head) line; `originalLine`
      // is the old-side line. If `line` is non-null the comment was
      // left on the right side of the diff; if only `originalLine`
      // is set, it was on the left (deletion) side. We carry the
      // distinction so the Diff tab can anchor without duplicating
      // when both sides share a line number.
      const newSideLine = c.line;
      const oldSideLine = c.originalLine;
      const side: 'new' | 'old' | undefined =
        newSideLine != null
          ? 'new'
          : oldSideLine != null
            ? 'old'
            : undefined;
      const line = newSideLine ?? oldSideLine ?? undefined;
      events.push({
        id: c.id,
        kind: 'inline-comment',
        author: reviewAuthor,
        at: c.createdAt,
        body: c.body,
        path: c.path,
        ...(line != null ? { line } : {}),
        ...(side ? { side } : {}),
      });
    }
  }

  for (const c of pr.comments.nodes) {
    if (!c.author || !c.body) continue;
    events.push({
      id: c.id,
      kind: 'comment',
      author: toUser(c.author),
      at: c.createdAt,
      body: c.body,
    });
  }

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return events;
}

/**
 * Transform the whole dashboard response. Dedupes PRs that appear across
 * viewer.pullRequests, reviewRequested, and (optionally) teamPrs (by id).
 */
export function transformDashboard(res: GqlDashboardResponse): {
  viewer: { login: string; avatarUrl: string };
  prs: DashboardPR[];
  rateLimit: { remaining: number; resetAt: string };
} {
  const viewerLogin = res.viewer.login;
  const requestedIds = new Set<string>(
    res.reviewRequested.nodes.filter((n) => n && n.id).map((n) => n.id)
  );

  const byId = new Map<string, GqlPRSummary>();
  const addNode = (pr: GqlPRSummary | null | undefined): void => {
    if (!pr || !pr.id) return;
    // Drop PRs from archived repos. `search` already filters these via
    // `archived:false`, but the direct `viewer.pullRequests` field does not.
    if (pr.repository?.isArchived) return;
    if (!byId.has(pr.id)) byId.set(pr.id, pr);
  };
  for (const pr of res.viewer.pullRequests.nodes) addNode(pr);
  for (const pr of res.reviewRequested.nodes) addNode(pr);
  if (res.teamPrs) {
    for (const pr of res.teamPrs.nodes) addNode(pr);
  }
  for (const pr of res.mergedAuthored?.nodes ?? []) addNode(pr);
  for (const pr of res.mergedReviewed?.nodes ?? []) addNode(pr);
  if (res.mergedTeam) {
    for (const pr of res.mergedTeam.nodes) addNode(pr);
  }

  const prs = Array.from(byId.values()).map((pr) =>
    transformPR(pr, viewerLogin, requestedIds)
  );

  return {
    viewer: { login: viewerLogin, avatarUrl: res.viewer.avatarUrl },
    prs,
    rateLimit: res.rateLimit,
  };
}
